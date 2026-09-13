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
  /**
   * Extra listings mixed into the pool before filtering — e.g. the other
   * agents' own active ads when clients sell similar items.
   */
  extraPool?: ListingSummary[];
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
): Comparable[] {
  const ask = target.price;
  if (ask === undefined) return [];
  const minPrice = ask * (options.minRatio ?? 0.5);
  const wanted = tokens(options.query ?? target.title);
  // Half the words is too loose: "carrying case for Nintendo Switch" shares two
  // of "nintendo switch dock" and is not the same item.
  const needed = Math.max(1, Math.ceil(wanted.size * 0.75));

  const seen = new Set<string>();
  return pool
    .filter((listing) => {
      if (listing.price === undefined) return false;
      if (listing.url === target.url) return false;
      if (target.id && listing.id === target.id) return false;
      if (listing.price >= ask || listing.price < minPrice) return false;
      if (seen.has(listing.url)) return false;
      const overlap = [...tokens(listing.title)].filter((word) => wanted.has(word)).length;
      if (overlap < needed) return false;
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

/** Searches Kijiji for cheaper listings of the same item as `target`. */
export async function findComparables(
  agent: Agent,
  target: Pick<ListingSummary, "title" | "price" | "url" | "id">,
  options: CompOptions = {},
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
  // of Canada, plus whatever extra pool the caller mixed in.
  const pool = [
    ...(options.extraPool ?? []),
    ...(await search(agent, {
      keywords,
      sort: "priceAsc",
      minPrice: Math.ceil(target.price * minRatio),
      maxPrice: Math.floor(target.price) - 1,
      limit: options.scan ?? 25,
      location: "canada",
    })),
  ];
  const comps = pickComparables(pool, target, options);
  log.debug(`${pool.length} candidate(s) in the pool, ${comps.length} survived the filters`);
  log.info(
    `[${agent.account.id}] "${keywords}" → ${comps.length} cheaper comparable(s) under $${target.price}`,
  );
  return comps;
}
