import type { Agent } from "../steel/agent.js";
import { accountPassword } from "../config.js";
import { logger } from "../log.js";
import { dismissOverlays, findFirst, requireFirst, typeSlowly } from "./page-utils.js";
import { totpCode } from "./totp.js";
import { KIJIJI_BASE, LOGIN_URL } from "./urls.js";

const log = logger("auth");

export async function isLoggedIn(agent: Agent): Promise<boolean> {
  const { page } = agent;
  if (!page.url().startsWith(KIJIJI_BASE)) {
    await page.goto(KIJIJI_BASE, { waitUntil: "domcontentloaded" });
  }
  await dismissOverlays(page);
  return (await findFirst(page, "loggedInMarker", 5_000)) !== undefined;
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

  await page.goto(LOGIN_URL, { waitUntil: "domcontentloaded" });
  await dismissOverlays(page);

  await typeSlowly(await requireFirst(page, "emailField", 20_000), account.email);
  await typeSlowly(await requireFirst(page, "passwordField"), accountPassword(account));
  await (await requireFirst(page, "submitLogin")).click();
  await page.waitForLoadState("domcontentloaded").catch(() => undefined);

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
