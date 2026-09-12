export const KIJIJI_BASE = "https://www.kijiji.ca";
export const LOGIN_URL = `${KIJIJI_BASE}/t-login.html`;
export const MESSAGES_URL = `${KIJIJI_BASE}/m-msg-my-messages/`;

export interface SearchQuery {
  keywords: string;
  minPrice?: number;
  maxPrice?: number;
  /** Newest first by default. */
  sort?: "dateDesc" | "priceAsc" | "priceDesc";
  /** Max cards to collect across pages. */
  limit?: number;
}

/**
 * Search result pages are reached by driving the site's own search box (its URL
 * scheme changes often), then refined with query parameters on whatever URL
 * Kijiji lands on.
 */
export function refineSearchUrl(currentUrl: string, query: SearchQuery): string {
  const url = new URL(currentUrl);
  url.searchParams.set("sort", query.sort ?? "dateDesc");
  if (query.minPrice !== undefined || query.maxPrice !== undefined) {
    url.searchParams.set("price", `${query.minPrice ?? 0}__${query.maxPrice ?? ""}`);
  }
  return url.toString();
}

/** Accepts a full listing URL or a bare numeric ad id. */
export function listingUrl(idOrUrl: string): string {
  if (/^https?:\/\//.test(idOrUrl)) return idOrUrl;
  if (/^\d+$/.test(idOrUrl)) return `${KIJIJI_BASE}/v-view-details.html?adId=${idOrUrl}`;
  throw new Error(`"${idOrUrl}" is neither a listing URL nor a numeric ad id.`);
}

export function listingIdFromUrl(url: string): string | undefined {
  const fromQuery = /[?&]adId=(\d+)/.exec(url);
  if (fromQuery?.[1]) return fromQuery[1];
  const fromPath = /\/(\d{6,})(?:[/?#]|$)/.exec(url);
  return fromPath?.[1];
}
