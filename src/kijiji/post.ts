import { existsSync, mkdirSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";
import { projectRoot } from "../config.js";
import type { Locator } from "playwright-core";
import type { Agent } from "../steel/agent.js";
import { logger } from "../log.js";
import { confirm } from "../safety.js";
import { ensureLoggedIn } from "./auth.js";
import {
  dismissOverlays,
  findFirst,
  open,
  requireFirst,
  sleep,
  typeSlowly,
} from "./page-utils.js";
import { selectors } from "./selectors.js";
import { KIJIJI_BASE } from "./urls.js";
import { ownListings, type ListingSummary } from "./listings.js";

const log = logger("post");

/** "Post ad" starts on the category step; /p-post-ad.html redirects here. */
export const POST_AD_URL = `${KIJIJI_BASE}/p-select-category.html`;

export interface ListingDraft {
  /** Which account posts it; the CLI resolves this to an agent. */
  account?: string;
  title: string;
  description: string;
  price: number | "free" | "contact";
  /**
   * Kijiji category. Either a single label matched against what Kijiji suggests
   * for the title, or the full path to walk its category tree, e.g.
   * "Buy & Sell > Video Games & Consoles > Nintendo Switch".
   */
  category: string;
  /** Postal code or city typed into the location field. */
  location: string;
  /**
   * Kijiji's numeric id for the area you post from, taken from any Kijiji city
   * URL (e.g. /b-city-of-toronto/l1700273 → 1700273). Kijiji refuses to render
   * the ad form until the browser has an area set, so a fresh profile needs it.
   */
  locationId?: number | string;
  /** Image paths, absolute or relative to the working directory. */
  photos?: string[];
}

export interface PostResult {
  status: "posted" | "draft-only" | "pending";
  url: string;
  title: string;
  account: string;
}

export function validateDraft(draft: ListingDraft): void {
  const missing = (["title", "description", "category", "location"] as const).filter(
    (field) => !draft[field] || String(draft[field]).trim() === "",
  );
  if (missing.length > 0) {
    throw new Error(`Listing draft is missing: ${missing.join(", ")}.`);
  }
  if (typeof draft.price === "number" && !(draft.price >= 0)) {
    throw new Error(`Listing price must be zero or more, got ${draft.price}.`);
  }
  for (const photo of draft.photos ?? []) {
    if (!existsSync(photoPath(photo))) throw new Error(`Photo not found: ${photoPath(photo)}`);
  }
}

function photoPath(photo: string): string {
  return isAbsolute(photo) ? photo : resolve(process.cwd(), photo);
}

export interface PostOptions {
  /** Fill the whole form and stop before publishing. */
  dryRun?: boolean;
  /** Skip the confirmation prompt. */
  autoApprove?: boolean;
}

/** Create one listing on one of your accounts, for an item you actually have. */
export async function postListing(
  agent: Agent,
  draft: ListingDraft,
  options: PostOptions = {},
): Promise<PostResult> {
  validateDraft(draft);
  await ensureLoggedIn(agent);

  const { page } = agent;
  await open(page, POST_AD_URL);
  await dismissOverlays(page);

  // A browser with no area set gets Kijiji's province picker instead of the
  // category step — settle it first or the title seed lands in the site
  // search box and nothing about categories ever renders.
  await ensureSiteLocation(agent, draft);
  await chooseCategory(agent, draft);
  // The picker also gates the post-ad URL itself: a profile with no area
  // cookie sails through the category step, then gets province-picked there.
  await ensureSiteLocation(agent, draft);

  const titleField = await findFirst(page, "postTitleField", 15_000);
  if (titleField) await typeSlowly(titleField, draft.title);
  else log.debug("title already carried over from the category step");
  const descriptionField = await findFirst(page, "postDescriptionField", 15_000);
  if (!descriptionField) {
    await dumpFormFields(page);
    const shot = await debugShot(page, "form");
    throw new Error(
      `no description field on ${page.url()} — Kijiji's form markup changed` +
        (shot ? ` (screenshot: ${shot})` : ""),
    );
  }
  await typeSlowly(descriptionField, draft.description);

  if (typeof draft.price === "number") {
    const priceField = await findFirst(page, "postPriceField", 4_000);
    if (priceField) await typeSlowly(priceField, String(draft.price));
    else log.warn("no price field on this category's form — continuing without one");
  }

  await fillLocation(agent, draft.location);
  await attachPhotos(agent, draft.photos ?? []);

  // A required field left blank still submits — and Kijiji eats the post with
  // a generic error — so prove the fields took before clicking.
  if (titleField) {
    const titleValue = await titleField.inputValue().catch(() => "");
    if (!titleValue.trim()) {
      log.warn("title field was empty — retyping the draft title");
      await typeSlowly(titleField, draft.title);
    }
  }
  const descriptionValue = await descriptionField
    .inputValue()
    .catch(() => descriptionField.innerText().catch(() => ""));
  if (!descriptionValue.trim()) {
    throw new Error(
      `description field stayed empty on ${page.url()} — Kijiji rejects ads without one`,
    );
  }

  if (options.dryRun) {
    log.warn(`[${agent.account.id}] dry run — form filled but not published`);
    return { status: "draft-only", url: page.url(), title: draft.title, account: agent.account.id };
  }

  if (!options.autoApprove) {
    const priceLabel = typeof draft.price === "number" ? `$${draft.price}` : draft.price;
    const approved = await confirm(
      `\nPost from "${agent.account.id}":\n  ${draft.title} — ${priceLabel} — ${draft.location}\n` +
        `  ${draft.description.slice(0, 200)}${draft.description.length > 200 ? "…" : ""}\n\nPublish it?`,
    );
    if (!approved) {
      return { status: "draft-only", url: page.url(), title: draft.title, account: agent.account.id };
    }
  }

  await (await requireFirst(page, "postSubmitButton")).click();
  await settleSubmission(page);
  const confirmed = !(await onDetailsForm(page)) && (await findFirst(page, "postSuccessMarker", 10_000));
  if (!confirmed) {
    // Read the landing page before anything navigates away — Kijiji's verdict
    // ("under review", "verify your phone", a block) lives in that text.
    const shot = await debugShot(page, "after-submit");
    const pulse = await pagePulse(page);
    if (pulse) log.warn(`post-submit page says: ${pulse}`);
    // Kijiji's error page lies often enough to be worth checking My Ads —
    // the ad sometimes goes live anyway.
    const live = await findOnMyAds(agent, draft.title);
    if (live) {
      log.info(`[${agent.account.id}] ad is live despite the error: ${live.url}`);
      return { status: "posted", url: live.url, title: draft.title, account: agent.account.id };
    }
    if (/under review|being reviewed|pending|verify/i.test(pulse)) {
      log.warn(`[${agent.account.id}] ad held for review — not live yet`);
      return { status: "pending", url: page.url(), title: draft.title, account: agent.account.id };
    }
    const complaints = await formComplaints(page);
    throw new Error(
      `[${agent.account.id}] no confirmation after submitting "${draft.title}" (now at ${page.url()}). ` +
        (complaints ? `Kijiji says: ${complaints}. ` : "") +
        (pulse ? `Page read: "${pulse}". ` : "") +
        `Checked My Ads — the ad is not live.` +
        (shot ? ` Screenshot: ${shot}.` : ""),
    );
  }

  log.info(`[${agent.account.id}] posted "${draft.title}"`);
  return { status: "posted", url: page.url(), title: draft.title, account: agent.account.id };
}

/**
 * Kijiji's first posting step takes the ad title, and only reveals categories
 * once that title is submitted: one guessed category plus the full tree to
 * browse. A draft naming a path walks the tree; a single label is matched
 * against whatever is on screen.
 */
async function chooseCategory(agent: Agent, draft: ListingDraft): Promise<void> {
  const { page } = agent;
  const input = await findFirst(page, "postTitleSeedField", 12_000);
  if (!input) {
    log.warn("no category picker on this page — assuming the form starts at the details step");
    return;
  }
  await typeSlowly(input, draft.title);
  const reveal = await findFirst(page, "postContinueButton", 5_000);
  if (reveal) await reveal.click();
  // Some builds reveal suggestions on Enter rather than a separate button.
  else await input.press("Enter").catch(() => undefined);

  const path = draft.category
    .split(/\s*[>›/]\s*/)
    .map((part) => part.trim())
    .filter(Boolean);
  for (const [index, step] of path.entries()) {
    // The leaf category navigates to the details form; any remaining steps of a
    // path Kijiji short-circuits are then already behind us.
    if (await onDetailsForm(page)) break;
    const option = await matchingOption(agent, step);
    if (!option) {
      // A cloned breadcrumb path won't always line up with the posting tree —
      // before dying on an unmatched step, take Kijiji's own guess for the
      // title if it offered one.
      const fallback = await findFirst(page, "postCategorySuggestion", 6_000);
      if (fallback) {
        log.warn(`no category matched "${step}" — taking Kijiji's own suggestion`);
        await clickCategory(fallback);
        await sleep(400);
        break;
      }
      const shot = await debugShot(page, "category");
      const suffix = shot ? ` Screenshot saved to ${shot}.` : "";
      if (index > 0) {
        throw new Error(
          `Kijiji offers no "${step}" under "${path.slice(0, index).join(" > ")}". ` +
            `Check the category path in the draft against Kijiji's own list.${suffix}`,
        );
      }
      throw new Error(
        `Kijiji offered no category for "${draft.title}". Try a title that names the item plainly.${suffix}`,
      );
    }
    await clickCategory(option);
    await sleep(400);
  }
  await page.waitForURL(/p-post-ad\.html/, { timeout: 30_000 }).catch(() => undefined);
  if (!(await onDetailsForm(page))) {
    const shot = await debugShot(page, "category");
    throw new Error(
      `Category "${draft.category}" did not lead to the posting form (still at ${page.url()}).` +
        (shot ? ` Screenshot saved to ${shot}.` : ""),
    );
  }
  log.info(`[${agent.account.id}] category chosen, on the posting form`);
}

/**
 * A published ad leaves the form for its own page; a rejected one stays put and
 * says so, and there is no point waiting out the rest of the timeout then.
 */
async function settleSubmission(page: Agent["page"]): Promise<void> {
  const deadline = Date.now() + 45_000;
  while (Date.now() < deadline) {
    if (!(await onDetailsForm(page))) return;
    if (await findFirst(page, "postFormError", 0)) return;
    await sleep(500);
  }
}

/**
 * p-post-ad.html is the form — but the URL flickers through redirects getting
 * there (and again leaving it), so the description field is the real signal.
 */
async function onDetailsForm(page: Agent["page"]): Promise<boolean> {
  if (page.url().includes("p-post-ad.html")) return true;
  return Boolean(await findFirst(page, "postDescriptionField", 800));
}

/**
 * The text of whatever page a submission landed on — its banners and notices
 * are how Kijiji says "under review" or "verify your phone" out loud.
 */
async function pagePulse(page: Agent["page"]): Promise<string> {
  const text = await page
    .evaluate(() => document.body?.innerText ?? "")
    .catch(() => "");
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 10)
    .slice(0, 12)
    .join(" | ")
    .slice(0, 600);
}

/**
 * Post-verify: Kijiji sometimes shows an error page for an ad that posted,
 * and new ads take a moment to index into My Ads — so poll a few times
 * before declaring the post dead. Title equality is enough: My Ads only
 * ever holds this account's own ads.
 */
async function findOnMyAds(agent: Agent, title: string): Promise<ListingSummary | undefined> {
  const wanted = normalizeCategory(title);
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const ads = await ownListings(agent);
      const hit = ads.find((ad) => normalizeCategory(ad.title) === wanted);
      if (hit) return hit;
    } catch (error) {
      log.debug(`my-ads check failed (${error instanceof Error ? error.message : error})`);
    }
    if (attempt < 2) {
      log.debug("ad not on My Ads yet — giving it a few seconds to index");
      await sleep(10_000);
    }
  }
  return undefined;
}

/** Log every form field's attributes so a selector miss shows the real markup. */
async function dumpFormFields(page: Agent["page"]): Promise<void> {
  const fields = await page
    .locator("input, textarea, select")
    .evaluateAll((els) =>
      els.map((el) => ({
        tag: el.tagName.toLowerCase(),
        type: el.getAttribute("type"),
        name: el.getAttribute("name"),
        id: el.id || undefined,
        testid: el.getAttribute("data-testid"),
      })),
    )
    .catch(() => []);
  log.warn(`fields on page: ${JSON.stringify(fields)}`);
}

/** A screenshot for post-mortem — the flow changed under us, or markup did. */
async function debugShot(page: Agent["page"], tag: string): Promise<string | undefined> {
  try {
    const dir = resolve(projectRoot, "data");
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    const path = resolve(dir, `debug-${tag}-${Date.now()}.png`);
    await page.screenshot({ path, fullPage: true });
    return path;
  } catch {
    return undefined;
  }
}

/**
 * Clicking a category tears the page down under Playwright, which then waits
 * out the full timeout on a click that already did its job.
 */
async function clickCategory(option: Locator): Promise<void> {
  await option.click({ timeout: 10_000, noWaitAfter: true }).catch(() => undefined);
}

/** "Buy & Sell" in a breadcrumb vs "Buy and Sell" in the tree — same category. */
function normalizeCategory(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/**
 * The option in the currently shown level of the category tree named
 * `category`. Kijiji's suggested category is deliberately excluded: its label
 * carries the whole breadcrumb, so it matches parents it is not.
 */
async function matchingOption(agent: Agent, category: string): Promise<Locator | undefined> {
  const { page } = agent;
  const wanted = normalizeCategory(category);
  if (!(await findFirst(page, "postCategoryOption", 6_000))) return undefined;
  for (const selector of selectors.postCategoryOption) {
    const options = page.locator(selector);
    // One call for every label: a category level holds dozens of them, and
    // asking each in turn is a round trip each.
    const labels = await options.allInnerTexts().catch(() => [] as string[]);
    const hit = labels.findIndex((label) => normalizeCategory(label) === wanted);
    if (hit !== -1) return options.nth(hit);
  }
  return undefined;
}

/**
 * A browser with no area set gets Kijiji's province picker instead of the ad
 * form, so set the area from the draft and come back.
 */
/** The business's default market — a draft can name another area by id. */
const DEFAULT_LOCATION_ID = 1700273;

async function ensureSiteLocation(agent: Agent, draft: ListingDraft): Promise<void> {
  const { page } = agent;
  if (!(await findFirst(page, "siteLocationPrompt", 1_500))) return;
  const locationId = draft.locationId ?? DEFAULT_LOCATION_ID;
  const form = page.url();
  log.info(`[${agent.account.id}] setting the browser's area to ${locationId}`);
  await open(page, `${KIJIJI_BASE}/b-canada/l${locationId}`);
  await dismissOverlays(page);
  await open(page, form);
  await dismissOverlays(page);
  if (await findFirst(page, "siteLocationPrompt", 1_500)) {
    throw new Error(
      `Kijiji still wants an area after setting locationId ${locationId} — check that id.`,
    );
  }
}

/**
 * Kijiji only accepts a location picked from its own autocomplete — typing the
 * postal code alone leaves the ad without coordinates and the form refuses to
 * submit. A full postal code sometimes returns nothing, so shorter prefixes are
 * tried until the menu opens.
 */
async function fillLocation(agent: Agent, location: string): Promise<void> {
  const { page } = agent;
  const field = await findFirst(page, "postLocationField", 8_000);
  if (!field) {
    log.debug("location already set from the account profile");
    return;
  }
  const wanted = location.toLowerCase().replace(/\s+/g, "");
  // Kijiji answers to the first half of a postal code; the whole of it often
  // matches nothing, so the shorter query goes first. A cloned location like
  // "Toronto, ON M5V 3L9" also tries its bare city name before the full string.
  const attempts = [
    location.split(",")[0] ?? location,
    location.split(/\s+/)[0] ?? location,
    location,
    location.replace(/\s+/g, ""),
  ];
  for (const attempt of [...new Set(attempts)]) {
    await field.click();
    await field.fill("");
    await field.pressSequentially(attempt, { delay: 40 });
    const options = await locationOptions(agent);
    if (options.length === 0) continue;
    const exact = await firstMatching(options, wanted);
    await (exact ?? options[0]!).click();
    log.info(`[${agent.account.id}] location set from Kijiji's suggestions`);
    return;
  }
  throw new Error(
    `Kijiji suggested no location for "${location}" — use a postal code or city it recognises.`,
  );
}

async function locationOptions(agent: Agent): Promise<Locator[]> {
  const { page } = agent;
  if (!(await findFirst(page, "postLocationSuggestion", 2_500))) return [];
  for (const selector of selectors.postLocationSuggestion) {
    const found = await page.locator(selector).all();
    if (found.length > 0) return found;
  }
  return [];
}

async function firstMatching(options: Locator[], wanted: string): Promise<Locator | undefined> {
  const labels = await Promise.all(
    options.map((option) =>
      option
        .innerText()
        .catch(() => "")
        .then((text) => text.toLowerCase().replace(/\s+/g, "")),
    ),
  );
  const hit = labels.findIndex((label) => label.includes(wanted));
  return hit === -1 ? undefined : options[hit];
}

/** Whatever the form is complaining about, so a rejected submit says why. */
async function formComplaints(page: Agent["page"]): Promise<string> {
  const messages = await page
    .evaluate(() => {
      const texts = Array.from(document.querySelectorAll('[role="alert"], [class*="error" i]'))
        .map((el) => (el.textContent ?? "").replace(/\s+/g, " ").trim())
        .filter((text) => text.length > 0 && text.length < 160);
      const fields = Array.from(document.querySelectorAll("[aria-invalid='true']")).map(
        (el) => `field "${el.id || el.getAttribute("name") || el.tagName}" is rejected`,
      );
      return Array.from(new Set([...texts, ...fields]));
    })
    .catch(() => [] as string[]);
  return messages.slice(0, 5).join("; ");
}

async function attachPhotos(agent: Agent, photos: string[]): Promise<void> {
  if (photos.length === 0) return;
  const { page } = agent;
  for (const selector of selectors.postPhotoInput) {
    const input = page.locator(selector).first();
    if ((await input.count()) === 0) continue;
    await input.setInputFiles(photos.map(photoPath));
    log.info(`[${agent.account.id}] attached ${photos.length} photo(s)`);
    return;
  }
  log.warn("no photo upload field found — posting without photos");
}
