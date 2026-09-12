import type { Agent } from "../steel/agent.js";
import { accountPassword } from "../config.js";
import { logger } from "../log.js";
import { ask } from "../safety.js";
import { dismissOverlays, findFirst, open, requireFirst, typeSlowly } from "./page-utils.js";
import { totpCode } from "./totp.js";
import { KIJIJI_BASE, LOGIN_URL } from "./urls.js";

const log = logger("auth");

/**
 * Kijiji's own pages are heavy, and rendering one only to look at the header
 * costs about ten seconds. An account-only page fetched with the browser's
 * cookies answers the same question in one request: it serves the page when
 * signed in and bounces to the login host when not.
 */
async function signedInPerCookies(agent: Agent): Promise<boolean | undefined> {
  const response = await agent.page.request
    .get(`${KIJIJI_BASE}/m-my-ads/active/1`, { maxRedirects: 0, timeout: 15_000 })
    .catch(() => undefined);
  if (!response) return undefined;
  const status = response.status();
  if (status === 200) return true;
  if (status >= 300 && status < 400) return false;
  return undefined;
}

export async function isLoggedIn(agent: Agent): Promise<boolean> {
  const { page } = agent;
  const quick = await signedInPerCookies(agent);
  if (quick !== undefined) return quick;
  if (!page.url().startsWith(KIJIJI_BASE)) {
    await open(page, KIJIJI_BASE);
  }
  await dismissOverlays(page);
  // The signed-out header is only worth a glance; waiting belongs on the
  // signed-in markers, which is the case worth being sure about.
  if (await findFirst(page, "signedOutMarker", 0)) return false;
  return (await findFirst(page, "loggedInMarker", 8_000)) !== undefined;
}

/**
 * Make sure this agent's browser is signed in as its account, reusing the
 * saved profile when it is still valid and logging in with credentials when it
 * is not.
 */
export async function ensureLoggedIn(agent: Agent): Promise<void> {
  if (await isLoggedIn(agent)) {
    log.info(`[${agent.account.id}] already signed in`);
    return;
  }
  const { page, account } = agent;
  log.info(`[${account.id}] signing in as ${account.email}`);

  await open(page, LOGIN_URL);
  await dismissOverlays(page);

  await typeSlowly(await requireFirst(page, "emailField", 20_000), account.email);
  await typeSlowly(await requireFirst(page, "passwordField"), accountPassword(account));
  await (await requireFirst(page, "submitLogin")).click();
  await page.waitForLoadState("domcontentloaded").catch(() => undefined);

  await handleEmailVerification(agent);
  await handleTwoFactor(agent);

  if (!(await isLoggedIn(agent))) {
    throw new Error(
      `[${account.id}] sign-in did not complete (now at ${page.url()}). ` +
        `Run with --viewer and watch the Steel session to see what Kijiji asked for.`,
    );
  }
  await agent.persistProfile();
  log.info(`[${account.id}] signed in, profile saved`);
}

/**
 * Kijiji interrupts sign-in with a code mailed to the account, which no stored
 * secret can produce: request it, then wait for whoever is running the command
 * to read their inbox. `KIJIJI_EMAIL_CODE` skips the prompt for unattended runs.
 */
async function handleEmailVerification(agent: Agent): Promise<void> {
  const { page, account } = agent;
  const request = await findFirst(page, "emailCodeRequest", 8_000);
  if (!request) return;

  log.info(`[${account.id}] Kijiji wants an emailed verification code — requesting one`);
  await request.click();
  const field = await requireFirst(page, "emailCodeField", 30_000);

  const code =
    process.env.KIJIJI_EMAIL_CODE ??
    (await ask(`[${account.id}] Enter the code Kijiji emailed to ${account.email}:`));
  if (!code) throw new Error(`[${account.id}] no verification code given.`);

  await typeSlowly(field, code);
  const submit = await findFirst(page, "submitLogin", 5_000);
  if (submit) await submit.click();
  await page.waitForLoadState("domcontentloaded").catch(() => undefined);
}

async function handleTwoFactor(agent: Agent): Promise<void> {
  const { page, account } = agent;
  const field = await findFirst(page, "totpField", 8_000);
  if (!field) return;

  if (!account.totpSecretEnv) {
    throw new Error(
      `[${account.id}] Kijiji asked for a two-factor code. Add "totpSecretEnv" to the account ` +
        `in accounts.json and set that environment variable to the authenticator secret.`,
    );
  }
  const secret = process.env[account.totpSecretEnv];
  if (!secret) {
    throw new Error(`[${account.id}] ${account.totpSecretEnv} is not set.`);
  }
  log.info(`[${account.id}] entering two-factor code`);
  await typeSlowly(field, totpCode(secret));
  const submit = await findFirst(page, "submitLogin", 5_000);
  if (submit) await submit.click();
  await page.waitForLoadState("domcontentloaded").catch(() => undefined);
}
