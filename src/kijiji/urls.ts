export const KIJIJI_BASE = "https://www.kijiji.ca";
export const LOGIN_URL = `${KIJIJI_BASE}/consumer/login`;
export const MESSAGES_URL = `${KIJIJI_BASE}/m-msg-my-messages/`;

export interface SearchQuery {
  keywords: string;
  minPrice?: number;
  maxPrice?: number;
  /** Newest first by default. */
  sort?: "dateDesc" | "priceAsc" | "priceDesc";
  /** Max cards to collect across pages. */
  limit?: number;
  /** Toronto listings by default; "canada" hunts nationwide. */
  location?: "toronto" | "canada";
}

/** Keyword segment of a search URL: "PS5 controller" -> "ps5-controller". */
function keywordSlug(keywords: string): string {
  const slug = keywords
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (!slug) throw new Error("Search keywords cannot be empty.");
  return slug;
}

/**
 * Searches cover the City of Toronto ("l1700273") unless a caller is gauging
 * prices — comparable-hunting looks nationwide ("l0", all of Canada).
 */
const LOCATIONS = {
  toronto: { path: "b-city-of-toronto", locationId: "l1700273" },
  canada: { path: "b-canada", locationId: "l0" },
} as const;

/**
 * Keyword search across all categories:
 * https://www.kijiji.ca/b-city-of-toronto/<keywords>/k0l1700273 , page N as a
 * "/page-N" segment in front of the trailing "k0l<locationId>".
 */
export function searchUrl(query: SearchQuery, pageNumber = 1): string {
  const page = pageNumber > 1 ? `/page-${pageNumber}` : "";
  const location = LOCATIONS[query.location ?? "toronto"];
  const url = new URL(
    `${KIJIJI_BASE}/${location.path}/${keywordSlug(query.keywords)}${page}/k0${location.locationId}`,
  );
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
