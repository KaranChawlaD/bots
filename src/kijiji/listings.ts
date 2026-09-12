import type { Page } from "playwright-core";
import type { Agent } from "../steel/agent.js";
import { logger } from "../log.js";
import { dismissOverlays, findFirst, requireFirst, textOf, typeSlowly } from "./page-utils.js";
import {
  KIJIJI_BASE,
  listingIdFromUrl,
  listingUrl,
  refineSearchUrl,
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

export async function search(agent: Agent, query: SearchQuery): Promise<ListingSummary[]> {
  const { page } = agent;
  const limit = query.limit ?? 25;

  await page.goto(KIJIJI_BASE, { waitUntil: "domcontentloaded" });
  await dismissOverlays(page);
  await typeSlowly(await requireFirst(page, "searchKeywordInput", 20_000), query.keywords);
  const submit = await findFirst(page, "searchSubmit", 5_000);
  if (submit) await submit.click();
  else await page.keyboard.press("Enter");
  await page.waitForLoadState("domcontentloaded");

  await page.goto(refineSearchUrl(page.url(), query), { waitUntil: "domcontentloaded" });
  await dismissOverlays(page);

  const results: ListingSummary[] = [];
  const seen = new Set<string>();
  while (results.length < limit) {
    for (const listing of await scrapeResultPage(page)) {
      if (seen.has(listing.url)) continue;
      seen.add(listing.url);
      results.push(listing);
      if (results.length >= limit) break;
    }
    if (results.length >= limit) break;
    const next = await findFirst(page, "nextPageLink", 3_000);
    if (!next) break;
    await next.click();
    await page.waitForLoadState("domcontentloaded");
  }

  log.info(`[${agent.account.id}] "${query.keywords}" → ${results.length} listings`);
  return results;
}

async function scrapeResultPage(page: Page): Promise<ListingSummary[]> {
  await findFirst(page, "searchResultCard", 15_000);
  const raw = await page.evaluate(() => {
    const cardSelectors = [
      '[data-testid="listing-card"]',
      "[data-listing-id]",
      'section[data-testid="srp-search-list"] li',
      "div.search-item",
    ];
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
  });

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

export async function view(agent: Agent, idOrUrl: string): Promise<ListingDetail> {
  const { page } = agent;
  const url = listingUrl(idOrUrl);
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await dismissOverlays(page);

  const priceText = await textOf(page, "listingPrice");
  const detail: ListingDetail = {
    ...(listingIdFromUrl(page.url()) ? { id: listingIdFromUrl(page.url()) } : {}),
    title: await textOf(page, "listingTitle", 15_000),
    ...(parsePrice(priceText) !== undefined ? { price: parsePrice(priceText) } : {}),
    priceText,
    location: await textOf(page, "listingLocation"),
    url: page.url(),
    postedAt: "",
    description: await textOf(page, "listingDescription"),
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

export function parsePrice(text: string): number | undefined {
  const match = /(\d[\d,\s]*(?:\.\d{2})?)/.exec(text.replace(/\u00a0/g, " "));
  if (!match?.[1]) return undefined;
  const value = Number(match[1].replace(/[,\s]/g, ""));
  return Number.isFinite(value) ? value : undefined;
}
