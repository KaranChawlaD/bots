import type { Locator, Page } from "playwright-core";
import { selectors, type SelectorKey } from "./selectors.js";

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

/** Type like a person rather than pasting the whole string at once. */
export async function typeSlowly(locator: Locator, value: string): Promise<void> {
  await locator.click();
  await locator.fill("");
  await locator.pressSequentially(value, { delay: 35 });
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
