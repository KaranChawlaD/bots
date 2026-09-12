import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

export const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

dotenv.config({ path: resolve(projectRoot, ".env"), quiet: true });

export interface Account {
  /** Short handle used on the command line, e.g. "primary". */
  id: string;
  email: string;
  /** Name of the environment variable holding this account's password. */
  passwordEnv: string;
  label?: string;
  /**
   * Name of the environment variable holding the TOTP secret, if the account
   * uses an authenticator app for two-factor auth.
   */
  totpSecretEnv?: string;
  /** Steel proxy/region hints, applied per account so sessions stay consistent. */
  region?: string;
  proxyUrl?: string;
  userAgent?: string;
}

export interface Limits {
  /** Minimum seconds between two messages sent from the same account. */
  minSecondsBetweenMessages: number;
  /** Hard cap on messages one account may send per rolling 24h. */
  maxMessagesPerAccountPerDay: number;
  /** How many agent browsers may run at the same time. */
  maxConcurrentAgents: number;
}

export interface Settings {
  accounts: Account[];
  limits: Limits;
}

const defaultLimits: Limits = {
  minSecondsBetweenMessages: 90,
  maxMessagesPerAccountPerDay: 15,
  maxConcurrentAgents: 3,
};

export function accountsFilePath(): string {
  return process.env.KIJIJI_ACCOUNTS_FILE
    ? resolve(process.env.KIJIJI_ACCOUNTS_FILE)
    : resolve(projectRoot, "accounts.json");
}

export function loadSettings(): Settings {
  const path = accountsFilePath();
  if (!existsSync(path)) {
    throw new Error(
      `No accounts file at ${path}. Copy accounts.example.json to accounts.json and fill it in.`,
    );
  }
  const raw: unknown = JSON.parse(readFileSync(path, "utf8"));
  const parsed = raw as Partial<Settings> & { accounts?: unknown };
  const accounts = Array.isArray(parsed.accounts) ? (parsed.accounts as Account[]) : [];
  if (accounts.length === 0) {
    throw new Error(`No accounts configured in ${path}.`);
  }
  const seen = new Set<string>();
  for (const account of accounts) {
    if (!account.id || !account.email || !account.passwordEnv) {
      throw new Error(
        `Account entries need "id", "email" and "passwordEnv" (offending entry: ${JSON.stringify(account)}).`,
      );
    }
    if (seen.has(account.id)) {
      throw new Error(`Duplicate account id "${account.id}" in ${path}.`);
    }
    seen.add(account.id);
  }
  return { accounts, limits: { ...defaultLimits, ...(parsed.limits ?? {}) } };
}

export function selectAccounts(settings: Settings, ids: string[] | undefined): Account[] {
  if (!ids || ids.length === 0) return settings.accounts;
  return ids.map((id) => {
    const account = settings.accounts.find((candidate) => candidate.id === id);
    if (!account) {
      throw new Error(
        `Unknown account "${id}". Known accounts: ${settings.accounts.map((a) => a.id).join(", ")}.`,
      );
    }
    return account;
  });
}

export function accountPassword(account: Account): string {
  const password = process.env[account.passwordEnv];
  if (!password) {
    throw new Error(
      `Password for account "${account.id}" not found: set ${account.passwordEnv} in your environment or .env file.`,
    );
  }
  return password;
}

export function steelApiKey(): string {
  const key = process.env.STEEL_API_KEY;
  if (!key) {
    throw new Error("STEEL_API_KEY is not set. Put it in your environment or .env file.");
  }
  return key;
}
