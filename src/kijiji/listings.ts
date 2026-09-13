import type { Page } from "playwright-core";
import type { Agent } from "../steel/agent.js";
import { logger } from "../log.js";
import { dismissOverlays, findFirst, open, textOf } from "./page-utils.js";
import { selectors } from "./selectors.js";
import { listingIdFromUrl, listingUrl, MY_ADS_URL, searchUrl, type SearchQuery } from "./urls.js";

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
  /** Photo URLs straight from the ad — references, not downloads. */
  photos: string[];
  /** Breadcrumb path like "Buy & Sell > Electronics > Chargers", when shown. */
  category?: string;
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
    const before = results.length;
    for (const listing of cards) {
      if (seen.has(listing.url)) continue;
      seen.add(listing.url);
      results.push(listing);
      if (results.length >= limit) break;
    }
    if (results.length >= limit) break;
    // Kijiji pads later pages with reshuffled or out-of-band results rather
    // than ever serving an empty one — once a page adds nothing new, crawling
    // on just burns requests until the IP gets 429'd.
    if (results.length === before) break;
    // Sorted price-ascending, a page whose cheapest listing already exceeds
    // the ceiling means nothing later can qualify.
    if (query.sort === "priceAsc" && query.maxPrice !== undefined) {
      const prices = cards
        .map((card) => card.price)
        .filter((price): price is number => price !== undefined);
      if (prices.length > 0 && Math.min(...prices) > query.maxPrice) break;
    }
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

interface ProductLd {
  "@type"?: string;
  name?: string;
  description?: string;
  image?: unknown;
  offers?: {
    price?: string | number;
    priceCurrency?: string;
    availableAtOrFrom?: { name?: string; address?: { streetAddress?: string } };
  };
}

interface BreadcrumbLd {
  "@type"?: string;
  itemListElement?: Array<{ position?: number; name?: string; item?: { name?: string } }>;
}

function isProductLd(value: unknown): value is ProductLd {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as { "@type"?: unknown })["@type"] === "Product"
  );
}

/**
 * Listing pages embed schema.org JSON-LD, which survives markup churn better
 * than the rendered DOM. Falls back to selectors per field.
 */
async function structuredBlocks(page: Page): Promise<unknown[]> {
  const blocks = await page
    .locator('script[type="application/ld+json"]')
    .allTextContents()
    .catch(() => [] as string[]);
  const parsed: unknown[] = [];
  for (const block of blocks) {
    try {
      const value: unknown = JSON.parse(block);
      parsed.push(...(Array.isArray(value) ? value : [value]));
    } catch {
      continue;
    }
  }
  return parsed;
}

/** schema.org image entries arrive as strings, ImageObjects, or arrays of either. */
function imageUrls(value: unknown): string[] {
  const list = Array.isArray(value) ? value : [value];
  return list
    .flatMap((entry) => {
      if (typeof entry === "string") return [entry];
      const url = (entry as { url?: unknown } | null)?.url;
      return typeof url === "string" ? [url] : [];
    })
    .filter((url) => /^https?:\/\//.test(url));
}

/** og:image / twitter:image meta tags — a backup when JSON-LD skips photos. */
async function metaImageUrls(page: Page): Promise<string[]> {
  return page
    .locator('meta[property="og:image"], meta[name="twitter:image"]')
    .evaluateAll((nodes) =>
      nodes
        .map((node) => node.getAttribute("content") ?? "")
        .filter((url) => /^https?:\/\//.test(url)),
    )
    .catch(() => [] as string[]);
}

/** Crumbs that name the site or a place — never a sellable category. */
const nonCategoryCrumbs = new Set([
  "home",
  "kijiji",
  "canada",
  "ontario",
  "quebec",
  "british columbia",
  "alberta",
  "manitoba",
  "saskatchewan",
  "nova scotia",
  "new brunswick",
  "prince edward island",
  "newfoundland and labrador",
  "newfoundland",
  "yukon",
  "northwest territories",
  "nunavut",
]);

/**
 * Breadcrumb names → a posting-tree category path. The trail usually opens
 * with the site, province and city and closes on the ad itself — none of
 * those are categories, so they're dropped against the ad's title, location
 * and a list of places. Leaf crumbs carry the location again as a suffix
 * ("General Electronics for City of Toronto"), which is stripped the same way.
 */
function cleanCrumbs(names: string[], title: string, location: string): string[] {
  const t = title.trim().toLowerCase();
  const l = location.trim().toLowerCase();
  const locWord = l.split(/[\s,]+/).find((word) => word.length > 2) ?? "";
  return names
    .map((name) => {
      // "… for City of Toronto" — but only when the place actually is the ad's
      // location, so a real category like "For Trade" suffixes survive.
      const stripped = locWord
        ? name.replace(/\s+for\s+(.+)$/i, (whole, place: string) =>
            place.toLowerCase().includes(locWord) ? "" : whole,
          )
        : name;
      return stripped.trim();
    })
    .filter((name) => {
      const n = name.toLowerCase();
      if (n === "" || nonCategoryCrumbs.has(n)) return false;
      if (/^ad (id|#)\b/.test(n) || /^\d+$/.test(n)) return false;
      if (/^city of\b|\((gta|area)\)$/.test(n)) return false;
      // The title crumb is sometimes truncated with an ellipsis, leaving only
      // a prefix of the real title — the length floor keeps short real
      // categories ("Phones" inside "Phones and chargers") from being dropped.
      if (t && (n === t || n.startsWith(t) || (n.length > 12 && t.startsWith(n)))) return false;
      if (l && (n === l || l.includes(n) || n.includes(l))) return false;
      return true;
    });
}

/** "Buy & Sell > Electronics > …" from the BreadcrumbList block, if present. */
function breadcrumbPath(blocks: unknown[], title: string, location: string): string | undefined {
  const crumbs = blocks.find(
    (block): block is BreadcrumbLd => (block as BreadcrumbLd | null)?.["@type"] === "BreadcrumbList",
  );
  const names = cleanCrumbs(
    [...(crumbs?.itemListElement ?? [])]
      .sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
      .map((el) => el.name ?? el.item?.name ?? ""),
    title,
    location,
  );
  return names.length > 0 ? names.join(" > ") : undefined;
}

/** Kijiji doesn't always ship BreadcrumbList JSON-LD — read the rendered trail. */
async function domBreadcrumbPath(
  page: Page,
  title: string,
  location: string,
): Promise<string | undefined> {
  for (const selector of selectors.listingBreadcrumb) {
    const names = await page.locator(selector).allInnerTexts().catch(() => [] as string[]);
    const path = cleanCrumbs(names, title, location).join(" > ");
    if (path) return path;
  }
  return undefined;
}

export async function view(agent: Agent, idOrUrl: string): Promise<ListingDetail> {
  const { page } = agent;
  const url = listingUrl(idOrUrl);
  await open(page, url);
  await dismissOverlays(page);

  const blocks = await structuredBlocks(page);
  const product = blocks.find(isProductLd);
  const offer = product?.offers;
  const structuredPrice = offer?.price === undefined ? undefined : Number(offer.price);
  const place = offer?.availableAtOrFrom;

  const priceText = (await textOf(page, "listingPrice")) || formatPrice(structuredPrice);
  const price = parsePrice(priceText) ?? structuredPrice;
  const title = (await textOf(page, "listingTitle", 15_000)) || (product?.name ?? "").trim();
  const location =
    (await textOf(page, "listingLocation")) ||
    place?.address?.streetAddress ||
    place?.name ||
    "";
  const category =
    breadcrumbPath(blocks, title, location) ??
    (await domBreadcrumbPath(page, title, location));
  const detail: ListingDetail = {
    ...(listingIdFromUrl(page.url()) ? { id: listingIdFromUrl(page.url()) } : {}),
    title,
    ...(price !== undefined && Number.isFinite(price) ? { price } : {}),
    priceText,
    location,
    url: page.url(),
    postedAt: "",
    description: (await textOf(page, "listingDescription")) || (product?.description ?? ""),
    seller: await textOf(page, "listingSeller"),
    viewedBy: agent.account.id,
    viewedAt: new Date().toISOString(),
    photos: [...new Set([...imageUrls(product?.image), ...(await metaImageUrls(page))])],
    ...(category ? { category } : {}),
  };
  if (!detail.title) {
    throw new Error(`No listing content at ${url} — it may be removed or region-locked.`);
  }
  log.info(`[${agent.account.id}] viewed "${detail.title}" (${detail.priceText || "no price"})`);
  return detail;
}

/**
 * The signed-in account's own live ads — used to check whether a client is
 * already selling the item an offer would price-match against.
 */
export async function ownListings(agent: Agent): Promise<ListingSummary[]> {
  const { page } = agent;
  await open(page, MY_ADS_URL);
  await dismissOverlays(page);
  const raw = await page
    .evaluate(() => {
      const links = Array.from(
        document.querySelectorAll<HTMLAnchorElement>('a[href*="/v-"], a[href*="adId="]'),
      );
      return links.map((a) => {
        const card = a.closest("li, article, tr, [class*='card' i], [class*='item' i]") ?? a;
        return {
          href: a.href,
          title: (
            card.querySelector("h2, h3, h4, [class*='title' i]")?.textContent ??
            a.textContent ??
            ""
          ).trim(),
          priceText:
            ['[data-testid="listing-price"]', ".price", '[class*="price" i]']
              .map((s) => card.querySelector(s)?.textContent?.trim() ?? "")
              .find((v) => v) ?? "",
          location: card.querySelector('[class*="location" i]')?.textContent?.trim() ?? "",
        };
      });
    })
    .catch(() => [] as Array<{ href: string; title: string; priceText: string; location: string }>);

  const seen = new Set<string>();
  const listings: ListingSummary[] = [];
  for (const row of raw) {
    if (!row.href || seen.has(row.href)) continue;
    seen.add(row.href);
    const price = parsePrice(row.priceText);
    listings.push({
      ...(listingIdFromUrl(row.href) ? { id: listingIdFromUrl(row.href) } : {}),
      title: row.title,
      ...(price !== undefined ? { price } : {}),
      priceText: row.priceText,
      location: row.location,
      url: row.href,
      postedAt: "",
    });
  }
  log.info(`[${agent.account.id}] ${listings.length} live ad(s) on the account`);
  return listings;
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
