import type { Page } from "playwright-core";
import type { Agent } from "../steel/agent.js";
import { logger } from "../log.js";
import { dismissOverlays, findFirst, textOf } from "./page-utils.js";
import { selectors } from "./selectors.js";
import { listingIdFromUrl, listingUrl, searchUrl, type SearchQuery } from "./urls.js";

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
    await page.goto(searchUrl(query, pageNumber), { waitUntil: "domcontentloaded" });
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
  const raw = await page.evaluate((cardSelectors: readonly string[]) => {
    const cards = cardSelectors
      .map((selector) => Array.from(document.querySelectorAll(selector)))
      .find((found) => found.length > 0);
    const text = (root: Element, selectors: string[]): string => {
      for (const selector of selectors) {
        const node = root.querySelector(selector);
        if (node?.textContent?.trim()) return node.textContent.trim();
      }
      return "";
    };
    return (cards ?? []).map((card) => {
      const link = card.querySelector<HTMLAnchorElement>('a[href*="/v-"], a[href*="adId="]');
      return {
        href: link?.href ?? "",
        title: text(card, ['[data-testid="listing-title"]', "h3", "h2", "a[title]"]),
        priceText: text(card, ['[data-testid="listing-price"]', ".price", '[class*="price"]']),
        location: text(card, ['[data-testid="listing-location"]', '[class*="location"]']),
        postedAt: text(card, ['[data-testid="listing-date"]', "time", '[class*="date"]']),
      };
    });
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
  await page.goto(url, { waitUntil: "domcontentloaded" });
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
