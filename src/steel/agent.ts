import Steel from "steel-sdk";
import { chromium } from "playwright-core";
import type { Browser, BrowserContext, Page } from "playwright-core";
import type { Account } from "../config.js";
import { steelApiKey } from "../config.js";
import { logger } from "../log.js";
import { loadProfile, saveProfile } from "./profiles.js";

const log = logger("steel");

let client: Steel | undefined;

export function steelClient(): Steel {
  if (!client) {
    client = new Steel({
      steelAPIKey: steelApiKey(),
      ...(process.env.STEEL_BASE_URL ? { baseURL: process.env.STEEL_BASE_URL } : {}),
    });
  }
  return client;
}

export interface AgentOptions {
  /** Keep the browser visible in Steel's session viewer and print the link. */
  showViewer?: boolean;
  /** Session lifetime in milliseconds. */
  timeoutMs?: number;
  /** Start from the account's saved cookies/localStorage. Defaults to true. */
  useSavedProfile?: boolean;
  /** Persist the session context back to disk on close. Defaults to true. */
  saveProfileOnClose?: boolean;
}

/**
 * One browser agent bound to one Kijiji account: a Steel cloud browser plus a
 * Playwright page connected to it over CDP.
 */
export class Agent {
  private constructor(
    readonly account: Account,
    readonly sessionId: string,
    readonly viewerUrl: string | undefined,
    private readonly browser: Browser,
    readonly context: BrowserContext,
    readonly page: Page,
    private readonly saveOnClose: boolean,
  ) {}

  static async open(account: Account, options: AgentOptions = {}): Promise<Agent> {
    const steel = steelClient();
    const profile = options.useSavedProfile === false ? undefined : loadProfile(account.id);

    const session = await steel.sessions.create({
      timeout: options.timeoutMs ?? 15 * 60_000,
      solveCaptcha: true,
      blockAds: true,
      ...(profile ? { sessionContext: profile.context } : {}),
      ...(account.userAgent ? { userAgent: account.userAgent } : {}),
      ...(account.proxyUrl ? { proxyUrl: account.proxyUrl } : { useProxy: true }),
      ...(account.region ? { region: account.region } : {}),
    });

    log.info(
      `[${account.id}] session ${session.id}${profile ? " (restored profile)" : " (fresh profile)"}`,
    );
    if (options.showViewer && session.debugUrl) log.info(`[${account.id}] viewer ${session.debugUrl}`);

    const browser = await chromium.connectOverCDP(connectUrl(session.websocketUrl));
    const context = browser.contexts()[0];
    if (!context) throw new Error(`Steel session ${session.id} exposed no browser context.`);
    const page = context.pages()[0] ?? (await context.newPage());
    page.setDefaultTimeout(45_000);

    return new Agent(
      account,
      session.id,
      session.debugUrl,
      browser,
      context,
      page,
      options.saveProfileOnClose !== false,
    );
  }

  /** Pull the live cookies/storage out of Steel and write them to disk. */
  async persistProfile(): Promise<void> {
    const context = await steelClient().sessions.context(this.sessionId);
    saveProfile(this.account.id, context);
    log.debug(`[${this.account.id}] profile saved`);
  }

  async close(): Promise<void> {
    try {
      if (this.saveOnClose) await this.persistProfile();
    } catch (error) {
      log.warn(`[${this.account.id}] could not save profile: ${describe(error)}`);
    }
    try {
      await this.browser.close();
    } catch {
      /* the session is released below regardless */
    }
    try {
      await steelClient().sessions.release(this.sessionId);
      log.debug(`[${this.account.id}] session released`);
    } catch (error) {
      log.warn(`[${this.account.id}] could not release session ${this.sessionId}: ${describe(error)}`);
    }
  }
}

function connectUrl(websocketUrl: string): string {
  const url = new URL(websocketUrl);
  if (!url.searchParams.has("apiKey")) url.searchParams.set("apiKey", steelApiKey());
  return url.toString();
}

export function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Open an agent, run the callback, then always close the session. */
export async function withAgent<T>(
  account: Account,
  options: AgentOptions,
  run: (agent: Agent) => Promise<T>,
): Promise<T> {
  const agent = await Agent.open(account, options);
  try {
    return await run(agent);
  } finally {
    await agent.close();
  }
}
