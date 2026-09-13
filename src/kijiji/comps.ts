import type { Agent } from "../steel/agent.js";
import { logger } from "../log.js";
import { search, type ListingSummary } from "./listings.js";

const log = logger("comps");

export interface Comparable {
  title: string;
  price: number;
  priceText: string;
  location: string;
  url: string;
}

export interface CompOptions {
  /** Search wording to use instead of one derived from the listing title. */
  query?: string;
  /** How many comparables to cite. */
  limit?: number;
  /** How many search results to look through. */
  scan?: number;
  /**
   * Ignore anything cheaper than this fraction of the asking price — those are
   * usually accessories, parts or a different model rather than a real comp.
   */
  minRatio?: number;
}

const stopWords = new Set([
  "a",
  "an",
  "and",
  "brand",
  "cheap",
  "excellent",
  "for",
  "good",
  "great",
  "in",
  "like",
  "mint",
  "new",
  "obo",
  "of",
  "perfect",
  "sale",
  "selling",
  "the",
  "to",
  "used",
  "with",
]);

/** Turns a listing title into search wording: the words that identify the item. */
export function compQuery(title: string): string {
  const words = title
    .toLowerCase()
    .replace(/[^a-z0-9+\s]/g, " ")
    .split(/\s+/)
    .filter((word) => word.length > 1 && !stopWords.has(word));
  return words.slice(0, 6).join(" ");
}

function tokens(text: string): Set<string> {
  return new Set(compQuery(text).split(" ").filter(Boolean));
}

/** Why pooled listings were dropped — surfaced so an empty comp list is explainable. */
export interface CompDropStats {
  noPrice: number;
  isTarget: number;
  notCheaper: number;
  tooCheap: number;
  duplicate: number;
  weakTitle: number;
}

/**
 * Picks the genuinely comparable, genuinely cheaper listings out of a pool.
 * Everything cited has to be a live listing the seller can check themselves,
 * so this filters hard: same-ish item, real price, cheaper, not suspiciously
 * cheap, cheapest first.
 */
export function pickComparables(
  pool: ListingSummary[],
  target: Pick<ListingSummary, "title" | "price" | "url" | "id">,
  options: CompOptions = {},
  dropped?: CompDropStats,
): Comparable[] {
  const ask = target.price;
  if (ask === undefined) return [];
  const minPrice = ask * (options.minRatio ?? 0.5);
  const wanted = tokens(options.query ?? target.title);
  // Require a clear majority of the target's identifying words — half was too
  // loose ("carrying case for Nintendo Switch" shares two of "nintendo switch
  // dock"), three-quarters was too tight ("Switch dock charger" is the same
  // item under different phrasing).
  const needed = Math.max(wanted.size >= 2 ? 2 : 1, Math.ceil(wanted.size * 0.6));
  const drop = (key: keyof CompDropStats): false => {
    if (dropped) dropped[key] += 1;
    return false;
  };

  const seen = new Set<string>();
  return pool
    .filter((listing) => {
      if (listing.price === undefined) return drop("noPrice");
      if (listing.url === target.url || (target.id && listing.id === target.id)) {
        return drop("isTarget");
      }
      if (listing.price >= ask) return drop("notCheaper");
      if (listing.price < minPrice) return drop("tooCheap");
      if (seen.has(listing.url)) return drop("duplicate");
      const overlap = [...tokens(listing.title)].filter((word) => wanted.has(word)).length;
      if (overlap < needed) return drop("weakTitle");
      seen.add(listing.url);
      return true;
    })
    .sort((a, b) => a.price! - b.price!)
    .slice(0, options.limit ?? 3)
    .map((listing) => ({
      title: listing.title,
      price: listing.price!,
      priceText: listing.priceText,
      location: listing.location,
      url: listing.url,
    }));
}

/** Listings in the pool whose titles identify the same item as the target. */
export function matchingListings<T extends Pick<ListingSummary, "title">>(
  pool: T[],
  target: Pick<ListingSummary, "title">,
  query?: string,
): T[] {
  const wanted = tokens(query ?? target.title);
  const needed = Math.max(wanted.size >= 2 ? 2 : 1, Math.ceil(wanted.size * 0.6));
  return pool.filter(
    (listing) => [...tokens(listing.title)].filter((word) => wanted.has(word)).length >= needed,
  );
}

/** Searches Kijiji for cheaper listings of the same item as `target`. */
export async function findComparables(
  agent: Agent,
  target: Pick<ListingSummary, "title" | "price" | "url" | "id">,
  options: CompOptions = {},
  extraPool: ListingSummary[] = [],
): Promise<Comparable[]> {
  if (target.price === undefined) {
    log.warn(`"${target.title}" has no readable price — nothing to compare against`);
    return [];
  }
  const keywords = options.query ?? compQuery(target.title);
  if (!keywords) {
    log.warn(`could not derive search wording from "${target.title}" — pass --comps-query`);
    return [];
  }
  const minRatio = options.minRatio ?? 0.5;
  // Price-matching gauges the market, not the neighbourhood: comps hunt all
  // of Canada rather than the Toronto-scoped browsing search.
  const pool = [
    ...(await search(agent, {
      keywords,
      sort: "priceAsc",
      minPrice: Math.ceil(target.price * minRatio),
      maxPrice: Math.floor(target.price) - 1,
      limit: options.scan ?? 25,
      location: "canada",
    })),
    ...extraPool,
  ];
  const dropped: CompDropStats = {
    noPrice: 0,
    isTarget: 0,
    notCheaper: 0,
    tooCheap: 0,
    duplicate: 0,
    weakTitle: 0,
  };
  const comps = pickComparables(pool, target, options, dropped);
  const reasons = Object.entries(dropped)
    .filter(([, count]) => count > 0)
    .map(([reason, count]) => `${count} ${reason}`)
    .join(", ");
  log.info(
    `[${agent.account.id}] "${keywords}" → ${comps.length} cheaper comparable(s) under ` +
      `$${target.price} (pool of ${pool.length}${reasons ? `, dropped: ${reasons}` : ""})`,
  );
  return comps;
}
