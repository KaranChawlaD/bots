import type { Locator, Page } from "playwright-core";
import { selectors, type SelectorKey } from "./selectors.js";

/**
 * Navigate and fail loudly when Kijiji's edge blocks the browser's IP, which
 * otherwise looks identical to "this search has no results".
 */
export async function open(page: Page, url: string): Promise<void> {
  const response = await page.goto(url, { waitUntil: "domcontentloaded" });
  const status = response?.status();
  if (status === 429 || status === 403) {
    throw new Error(
      `Kijiji answered ${status} for ${url}: the browser's IP is blocked. ` +
        `Give the account a residential "proxyUrl", or set "useProxy": true to use Steel's proxies.`,
    );
  }
}

/** First selector in the fallback list that resolves to a visible element. */
export async function findFirst(
  page: Page,
  key: SelectorKey,
  timeoutMs = 10_000,
): Promise<Locator | undefined> {
  const deadline = Date.now() + timeoutMs;
  do {
    for (const selector of selectors[key]) {
      const locator = page.locator(selector).first();
      if (await locator.isVisible().catch(() => false)) return locator;
    }
    await page.waitForTimeout(250);
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
 * keystroke is a round trip to the remote browser, so a quoted offer of several
 * hundred characters would take minutes: set the bulk in one go and only type
 * the tail, which is what React-backed fields need to see anyway.
 */
export async function typeSlowly(locator: Locator, value: string): Promise<void> {
  const TYPED_TAIL = 40;
  await locator.click();
  await locator.fill("");
  const tail = value.length > 120 ? value.slice(-TYPED_TAIL) : value;
  if (tail.length < value.length) {
    await locator.fill(value.slice(0, value.length - tail.length));
  }
  await locator.pressSequentially(tail, { delay: 30, timeout: 60_000 });
}

export async function dismissOverlays(page: Page): Promise<void> {
  const dismissers = [
    'button:has-text("Accept all")',
    'button:has-text("Accept All")',
    'button:has-text("I agree")',
    '[data-testid="cookie-banner"] button',
    'button[aria-label="Close"]',
  ];
  for (const selector of dismissers) {
    const locator = page.locator(selector).first();
    if (await locator.isVisible().catch(() => false)) {
      await locator.click({ timeout: 3_000 }).catch(() => undefined);
    }
  }
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
