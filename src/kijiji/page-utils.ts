import type { Locator, Page } from "playwright-core";
import { selectors, type SelectorKey } from "./selectors.js";

/** Kijiji's edge rejected the browser's IP — the job leg can retry via proxy. */
export class BlockedError extends Error {}

/**
 * Navigate and fail loudly when Kijiji's edge blocks the browser's IP, which
 * otherwise looks identical to "this search has no results".
 */
export async function open(page: Page, url: string): Promise<void> {
  const response = await page.goto(url, { waitUntil: "domcontentloaded" });
  const status = response?.status();
  if (status === 429 || status === 403) {
    throw new BlockedError(
      `Kijiji answered ${status} for ${url}: the browser's IP is blocked. ` +
        `Give the account a residential "proxyUrl", or set "useProxy": true to use Steel's proxies.`,
    );
  }
}

/**
 * First selector in the fallback list that resolves to a visible element. The
 * candidates are checked in one batch rather than one at a time: against a
 * remote browser each check is a round trip, and a list that misses costs as
 * many of them as it is long.
 */
export async function findFirst(
  page: Page,
  key: SelectorKey,
  timeoutMs = 10_000,
): Promise<Locator | undefined> {
  const candidates = selectors[key].map((selector) => page.locator(selector).first());
  const deadline = Date.now() + timeoutMs;
  do {
    const visible = await Promise.all(
      candidates.map((locator) => locator.isVisible().catch(() => false)),
    );
    const hit = visible.indexOf(true);
    if (hit !== -1) return candidates[hit];
    await page.waitForTimeout(200);
  } while (Date.now() < deadline);
  return undefined;
}

export async function requireFirst(
  page: Page,
  key: SelectorKey,
  timeoutMs = 10_000,
): Promise<Locator> {
  const locator = await findFirst(page, key, timeoutMs);
  if (!locator) {
    throw new Error(
      `Could not find "${key}" on ${page.url()}. Kijiji's markup may have changed — update src/kijiji/selectors.ts.`,
    );
  }
  return locator;
}

export async function textOf(page: Page, key: SelectorKey, timeoutMs = 3_000): Promise<string> {
  const locator = await findFirst(page, key, timeoutMs);
  if (!locator) return "";
  return (await locator.innerText().catch(() => "")).trim();
}

/**
 * Type like a person rather than pasting the whole string at once. Every
 * keystroke is a round trip to the remote browser, so only the tail is typed —
 * enough for React-backed fields to see real key events — and the rest is set
 * in one go.
 */
export async function typeSlowly(locator: Locator, value: string, tailLength = 8): Promise<void> {
  await locator.click();
  const tail = value.length > tailLength ? value.slice(-tailLength) : value;
  await locator.fill(value.slice(0, value.length - tail.length));
  await locator.pressSequentially(tail, { delay: 20, timeout: 60_000 });
}

const DISMISSERS =
  'button:has-text("Accept all"), button:has-text("Accept All"), button:has-text("I agree"), ' +
  '[data-testid="cookie-banner"] button, button[aria-label="Close"]';

export async function dismissOverlays(page: Page): Promise<void> {
  const locator = page.locator(DISMISSERS).first();
  if (await locator.isVisible().catch(() => false)) {
    await locator.click({ timeout: 3_000 }).catch(() => undefined);
  }
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
