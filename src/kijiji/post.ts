import { existsSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";
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
  status: "posted" | "draft-only";
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

  await chooseCategory(agent, draft);
  await ensureSiteLocation(agent, draft);

  const titleField = await findFirst(page, "postTitleField", 30_000);
  if (titleField) await typeSlowly(titleField, draft.title);
  else log.debug("title already carried over from the category step");
  await typeSlowly(await requireFirst(page, "postDescriptionField"), draft.description);

  if (typeof draft.price === "number") {
    const priceField = await findFirst(page, "postPriceField", 10_000);
    if (priceField) await typeSlowly(priceField, String(draft.price));
    else log.warn("no price field on this category's form — continuing without one");
  }

  await fillLocation(agent, draft.location);
  await attachPhotos(agent, draft.photos ?? []);

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
  await page.waitForLoadState("domcontentloaded").catch(() => undefined);
  const confirmed = await findFirst(page, "postSuccessMarker", 30_000);
  if (!confirmed) {
    throw new Error(
      `[${agent.account.id}] no confirmation after submitting "${draft.title}" (now at ${page.url()}). ` +
        `Check the account's My Ads page before retrying — it may have posted anyway.`,
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
  const input = await findFirst(page, "postTitleSeedField", 20_000);
  if (!input) {
    log.warn("no category picker on this page — assuming the form starts at the details step");
    return;
  }
  await typeSlowly(input, draft.title);
  const reveal = await findFirst(page, "postContinueButton", 8_000);
  if (reveal) await reveal.click();

  const path = draft.category
    .split(/\s*[>›/]\s*/)
    .map((part) => part.trim())
    .filter(Boolean);
  for (const [index, step] of path.entries()) {
    // The leaf category navigates to the details form; any remaining steps of a
    // path Kijiji short-circuits are then already behind us.
    if (onDetailsForm(page)) break;
    const option = await matchingOption(agent, step);
    if (!option) {
      if (index > 0) {
        throw new Error(
          `Kijiji offers no "${step}" under "${path.slice(0, index).join(" > ")}". ` +
            `Check the category path in the draft against Kijiji's own list.`,
        );
      }
      const fallback = await findFirst(page, "postCategorySuggestion", 10_000);
      if (!fallback) {
        throw new Error(
          `Kijiji offered no category for "${draft.title}". Try a title that names the item plainly.`,
        );
      }
      log.warn(`no category matched "${step}" — taking Kijiji's own suggestion`);
      await clickCategory(fallback);
      await sleep(1_500);
      break;
    }
    await clickCategory(option);
    await sleep(1_500);
  }
  await page.waitForURL(/p-post-ad\.html/, { timeout: 30_000 }).catch(() => undefined);
  if (!onDetailsForm(page)) {
    throw new Error(
      `Category "${draft.category}" did not lead to the posting form (still at ${page.url()}).`,
    );
  }
  log.info(`[${agent.account.id}] category chosen, on the posting form`);
}

function onDetailsForm(page: Agent["page"]): boolean {
  return page.url().includes("p-post-ad.html");
}

/**
 * Clicking a category tears the page down under Playwright, which then waits
 * out the full timeout on a click that already did its job.
 */
async function clickCategory(option: Locator): Promise<void> {
  await option.click({ timeout: 10_000, noWaitAfter: true }).catch(() => undefined);
}

/**
 * The option in the currently shown level of the category tree named
 * `category`. Kijiji's suggested category is deliberately excluded: its label
 * carries the whole breadcrumb, so it matches parents it is not.
 */
async function matchingOption(agent: Agent, category: string): Promise<Locator | undefined> {
  const { page } = agent;
  const wanted = category.trim().toLowerCase();
  if (!(await findFirst(page, "postCategoryOption", 10_000))) return undefined;
  for (const selector of selectors.postCategoryOption) {
    const options = page.locator(selector);
    const count = await options.count().catch(() => 0);
    for (let index = 0; index < count; index += 1) {
      const option = options.nth(index);
      const label = (await option.innerText().catch(() => "")).trim().toLowerCase();
      if (label === wanted) return option;
    }
  }
  return undefined;
}

/**
 * A browser with no area set gets Kijiji's province picker instead of the ad
 * form, so set the area from the draft and come back.
 */
async function ensureSiteLocation(agent: Agent, draft: ListingDraft): Promise<void> {
  const { page } = agent;
  if (!(await findFirst(page, "siteLocationPrompt", 5_000))) return;
  if (!draft.locationId) {
    throw new Error(
      `Kijiji wants an area before it shows the ad form. Add "locationId" to the draft — ` +
        `the number in any Kijiji city URL, e.g. /b-city-of-toronto/l1700273 → 1700273.`,
    );
  }
  const form = page.url();
  log.info(`[${agent.account.id}] setting the browser's area to ${draft.locationId}`);
  await open(page, `${KIJIJI_BASE}/b-canada/l${draft.locationId}`);
  await dismissOverlays(page);
  await open(page, form);
  await dismissOverlays(page);
  if (await findFirst(page, "siteLocationPrompt", 5_000)) {
    throw new Error(
      `Kijiji still wants an area after setting locationId ${draft.locationId} — check that id.`,
    );
  }
}

async function fillLocation(agent: Agent, location: string): Promise<void> {
  const { page } = agent;
  const field = await findFirst(page, "postLocationField", 8_000);
  if (!field) {
    log.debug("location already set from the account profile");
    return;
  }
  await typeSlowly(field, location);
  const suggestion = await findFirst(page, "postLocationSuggestion", 6_000);
  if (suggestion) await suggestion.click();
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
