import type { Page } from "playwright-core";
import type { Agent } from "../steel/agent.js";
import { logger } from "../log.js";
import { ensureLoggedIn } from "./auth.js";
import { dismissOverlays, findFirst, open, textOf } from "./page-utils.js";
import { selectors } from "./selectors.js";
import {
  KIJIJI_BASE,
  listingIdFromUrl,
  listingUrl,
  searchUrl,
  type SearchQuery,
} from "./urls.js";

const log = logger("listings");

export interface ListingSummary {
  id?: string;
  title: string;
  price?: number;
  priceText: string;
  location: string;
  url: string;
  postedAt: string;
}

export interface ListingDetail extends ListingSummary {
  description: string;
  seller: string;
  viewedBy: string;
  viewedAt: string;
}

const MAX_SEARCH_PAGES = 20;

export async function search(agent: Agent, query: SearchQuery): Promise<ListingSummary[]> {
  const { page } = agent;
  const limit = query.limit ?? 25;
  const results: ListingSummary[] = [];
  const seen = new Set<string>();

  for (let pageNumber = 1; pageNumber <= MAX_SEARCH_PAGES; pageNumber += 1) {
    await open(page, searchUrl(query, pageNumber));
    await dismissOverlays(page);
    const cards = await scrapeResultPage(page);
    if (cards.length === 0) break;
    for (const listing of cards) {
      if (seen.has(listing.url)) continue;
      seen.add(listing.url);
      results.push(listing);
      if (results.length >= limit) break;
    }
    if (results.length >= limit) break;
  }

  log.info(`[${agent.account.id}] "${query.keywords}" → ${results.length} listings`);
  return results;
}

async function scrapeResultPage(page: Page): Promise<ListingSummary[]> {
  if (!(await findFirst(page, "searchResultCard", 15_000))) return [];
  // Everything inside evaluate() stays anonymous and inline: named helpers get
  // rewritten to reference a bundler shim that doesn't exist in the browser.
  const raw = await page.evaluate((cardSelectors: readonly string[]) => {
    const cards = cardSelectors
      .map((selector) => Array.from(document.querySelectorAll(selector)))
      .find((found) => found.length > 0);
    return (cards ?? []).map((card) => ({
      href:
        card.querySelector<HTMLAnchorElement>('a[href*="/v-"], a[href*="adId="]')?.href ?? "",
      title:
        ['[data-testid="listing-title"]', "h3", "h2", "a[title]"]
          .map((selector) => card.querySelector(selector)?.textContent?.trim() ?? "")
          .find((value) => value) ?? "",
      priceText:
        ['[data-testid="listing-price"]', ".price", '[class*="price"]']
          .map((selector) => card.querySelector(selector)?.textContent?.trim() ?? "")
          .find((value) => value) ?? "",
      location:
        ['[data-testid="listing-location"]', '[class*="location"]']
          .map((selector) => card.querySelector(selector)?.textContent?.trim() ?? "")
          .find((value) => value) ?? "",
      postedAt:
        ['[data-testid="listing-date"]', "time", '[class*="date"]']
          .map((selector) => card.querySelector(selector)?.textContent?.trim() ?? "")
          .find((value) => value) ?? "",
    }));
  }, selectors.searchResultCard);

  return raw
    .filter((card) => card.href && card.title)
    .map((card) => ({
      ...(listingIdFromUrl(card.href) ? { id: listingIdFromUrl(card.href) } : {}),
      title: card.title,
      ...(parsePrice(card.priceText) !== undefined ? { price: parsePrice(card.priceText) } : {}),
      priceText: card.priceText,
      location: card.location,
      url: card.href,
      postedAt: card.postedAt,
    }));
}

/**
 * The account's own active ads from /m-my-ads, so an offer can cite the other
 * clients' live postings as comparables. Only the first page is read — the
 * point is a representative pool, not an inventory.
 */
export async function myAds(agent: Agent): Promise<ListingSummary[]> {
  const { page } = agent;
  // /m-my-ads bounces to the login host when the saved session has expired,
  // which would otherwise scrape as "zero ads".
  await ensureLoggedIn(agent);
  await open(page, `${KIJIJI_BASE}/m-my-ads/active/1`);
  await dismissOverlays(page);
  // The ads list renders client-side — wait for a real ad link, or the
  // scrape below runs against an empty page.
  await page
    .waitForSelector('a[href*="adId="], a[href*="/v-"]', { timeout: 15_000 })
    .catch(() => undefined);
  const raw = await page.evaluate(() => {
    // Walk ancestors until one contains a price; the ad title's link may sit
    // several wrappers deep inside the card that carries the price text.
    const priceNear = (el: Element): string => {
      let node: Element | null = el;
      for (let depth = 0; depth < 5 && node; depth += 1) {
        const hit = /\$[\d,]+(?:\.\d{2})?/.exec(
          (node.textContent ?? "").replace(/\s+/g, " "),
        );
        if (hit) return hit[0];
        node = node.parentElement;
      }
      return "";
    };
    const anchors = Array.from(
      document.querySelectorAll<HTMLAnchorElement>('a[href*="adId="], a[href*="/v-"]'),
    );
    return anchors
      .map((anchor) => ({
        href: anchor.href,
        title: (anchor.textContent ?? "").trim(),
        priceText: priceNear(anchor),
      }))
      .filter((entry) => entry.href && entry.title.length > 2);
  });

  const seen = new Set<string>();
  const ads: ListingSummary[] = [];
  for (const entry of raw) {
    if (seen.has(entry.href)) continue;
    seen.add(entry.href);
    ads.push({
      ...(listingIdFromUrl(entry.href) ? { id: listingIdFromUrl(entry.href) } : {}),
      title: entry.title,
      ...(parsePrice(entry.priceText) !== undefined
        ? { price: parsePrice(entry.priceText) }
        : {}),
      priceText: entry.priceText,
      location: "",
      url: entry.href,
      postedAt: "",
    });
  }
  for (const ad of ads) log.debug(`[${agent.account.id}] own ad: "${ad.title}" ${ad.priceText}`);
  log.info(`[${agent.account.id}] ${ads.length} active ad(s) of their own`);
  return ads;
}

interface ProductLd {
  "@type"?: string;
  name?: string;
  description?: string;
  offers?: {
    price?: string | number;
    priceCurrency?: string;
    availableAtOrFrom?: { name?: string; address?: { streetAddress?: string } };
  };
}

function isProductLd(value: unknown): value is ProductLd {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as { "@type"?: unknown })["@type"] === "Product"
  );
}

/**
 * Listing pages embed schema.org Product JSON-LD, which survives markup
 * churn better than the rendered DOM. Falls back to selectors per field.
 */
async function structuredListing(page: Page): Promise<ProductLd | undefined> {
  const blocks = await page
    .locator('script[type="application/ld+json"]')
    .allTextContents()
    .catch(() => [] as string[]);
  for (const block of blocks) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(block);
    } catch {
      continue;
    }
    const candidates = Array.isArray(parsed) ? parsed : [parsed];
    const product = candidates.find(isProductLd);
    if (product) return product;
  }
  return undefined;
}

export async function view(agent: Agent, idOrUrl: string): Promise<ListingDetail> {
  const { page } = agent;
  const url = listingUrl(idOrUrl);
  await open(page, url);
  await dismissOverlays(page);

  const product = await structuredListing(page);
  const offer = product?.offers;
  const structuredPrice = offer?.price === undefined ? undefined : Number(offer.price);
  const place = offer?.availableAtOrFrom;

  const priceText = (await textOf(page, "listingPrice")) || formatPrice(structuredPrice);
  const price = parsePrice(priceText) ?? structuredPrice;
  const detail: ListingDetail = {
    ...(listingIdFromUrl(page.url()) ? { id: listingIdFromUrl(page.url()) } : {}),
    title: (await textOf(page, "listingTitle", 15_000)) || (product?.name ?? "").trim(),
    ...(price !== undefined && Number.isFinite(price) ? { price } : {}),
    priceText,
    location:
      (await textOf(page, "listingLocation")) ||
      place?.address?.streetAddress ||
      place?.name ||
      "",
    url: page.url(),
    postedAt: "",
    description: (await textOf(page, "listingDescription")) || (product?.description ?? ""),
    seller: await textOf(page, "listingSeller"),
    viewedBy: agent.account.id,
    viewedAt: new Date().toISOString(),
  };
  if (!detail.title) {
    throw new Error(`No listing content at ${url} — it may be removed or region-locked.`);
  }
  log.info(`[${agent.account.id}] viewed "${detail.title}" (${detail.priceText || "no price"})`);
  return detail;
}

function formatPrice(price: number | undefined): string {
  if (price === undefined || !Number.isFinite(price)) return "";
  return `$${price.toFixed(2).replace(/\.00$/, "")}`;
}

export function parsePrice(text: string): number | undefined {
  const match = /(\d[\d,\s]*(?:\.\d{2})?)/.exec(text.replace(/\u00a0/g, " "));
  if (!match?.[1]) return undefined;
  const value = Number(match[1].replace(/[,\s]/g, ""));
  return Number.isFinite(value) ? value : undefined;
}
