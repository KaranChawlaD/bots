import { existsSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";
import type { Agent } from "../steel/agent.js";
import { logger } from "../log.js";
import { confirm } from "../safety.js";
import { ensureLoggedIn } from "./auth.js";
import { dismissOverlays, findFirst, requireFirst, typeSlowly } from "./page-utils.js";
import { selectors } from "./selectors.js";
import { KIJIJI_BASE } from "./urls.js";

const log = logger("post");

export const POST_AD_URL = `${KIJIJI_BASE}/p-post-ad.html`;

export interface ListingDraft {
  /** Which account posts it; the CLI resolves this to an agent. */
  account?: string;
  title: string;
  description: string;
  price: number | "free" | "contact";
  /** Typed into the category picker, then the first suggestion is taken. */
  category: string;
  /** Postal code or city typed into the location field. */
  location: string;
  /** Image paths, relative to the repo root or absolute. */
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
  await page.goto(POST_AD_URL, { waitUntil: "domcontentloaded" });
  await dismissOverlays(page);

  await chooseCategory(agent, draft.category);

  await typeSlowly(await requireFirst(page, "postTitleField", 30_000), draft.title);
  await typeSlowly(await requireFirst(page, "postDescriptionField"), draft.description);

  if (typeof draft.price === "number") {
    const priceField = await findFirst(page, "postPriceField", 10_000);
    if (priceField) await typeSlowly(priceField, String(draft.price));
    else log.warn("no price field on this category's form — continuing without one");
  }

  await fillLocation(agent, draft.location);
  await attachPhotos(agent, draft.photos ?? []);

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

  if (options.dryRun) {
    log.warn(`[${agent.account.id}] dry run — form filled but not published`);
    return { status: "draft-only", url: page.url(), title: draft.title, account: agent.account.id };
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

async function chooseCategory(agent: Agent, category: string): Promise<void> {
  const { page } = agent;
  const input = await findFirst(page, "postCategoryKeywordInput", 20_000);
  if (!input) {
    log.warn("no category picker on this page — assuming the form starts at the details step");
    return;
  }
  await typeSlowly(input, category);
  const suggestion = await findFirst(page, "postCategorySuggestion", 10_000);
  if (!suggestion) {
    throw new Error(
      `Kijiji suggested no category for "${category}". Try wording it the way Kijiji labels it, e.g. "Video games & consoles".`,
    );
  }
  await suggestion.click();
  const next = await findFirst(page, "postContinueButton", 8_000);
  if (next) await next.click();
  await page.waitForLoadState("domcontentloaded").catch(() => undefined);
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
