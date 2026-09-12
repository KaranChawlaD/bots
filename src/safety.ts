import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { projectRoot, type Limits } from "./config.js";
import { listingIdFromUrl } from "./kijiji/urls.js";

export interface SendRecord {
  accountId: string;
  listingUrl: string;
  /** Kijiji ad id, so the same listing reached by a different URL still counts. */
  listingId?: string;
  sentAt: string;
  preview: string;
}

function historyPath(): string {
  const dir = resolve(projectRoot, "data");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return resolve(dir, "sent-messages.json");
}

export function sendHistory(): SendRecord[] {
  const path = historyPath();
  if (!existsSync(path)) return [];
  return JSON.parse(readFileSync(path, "utf8")) as SendRecord[];
}

export function recordSend(record: SendRecord): void {
  const history = sendHistory();
  history.push(record);
  writeFileSync(historyPath(), JSON.stringify(history, null, 2));
}

export function alreadyMessaged(accountId: string, listingUrl: string): SendRecord | undefined {
  const id = listingIdFromUrl(listingUrl);
  return sendHistory().find(
    (record) =>
      record.accountId === accountId &&
      (record.listingUrl === listingUrl ||
        (id !== undefined && (record.listingId ?? listingIdFromUrl(record.listingUrl)) === id)),
  );
}

export interface GateResult {
  allowed: boolean;
  reason?: string;
  /** Milliseconds to wait before this account may send again. */
  waitMs?: number;
}

/** Per-account throttling: one conversation per listing, spaced out, capped daily. */
export function checkSendLimits(
  accountId: string,
  listingUrl: string,
  limits: Limits,
): GateResult {
  const duplicate = alreadyMessaged(accountId, listingUrl);
  if (duplicate) {
    return {
      allowed: false,
      reason: `account "${accountId}" already messaged this listing on ${duplicate.sentAt}`,
    };
  }
  const history = sendHistory().filter((record) => record.accountId === accountId);
  const dayAgo = Date.now() - 24 * 3_600_000;
  const last24h = history.filter((record) => new Date(record.sentAt).getTime() > dayAgo);
  if (last24h.length >= limits.maxMessagesPerAccountPerDay) {
    return {
      allowed: false,
      reason: `account "${accountId}" hit its daily cap of ${limits.maxMessagesPerAccountPerDay} messages`,
    };
  }
  const last = history.at(-1);
  if (last) {
    const elapsed = Date.now() - new Date(last.sentAt).getTime();
    const required = limits.minSecondsBetweenMessages * 1_000;
    if (elapsed < required) return { allowed: true, waitMs: required - elapsed };
  }
  return { allowed: true };
}

/** Read a one-off value (a verification code) from the terminal. */
export async function ask(question: string): Promise<string> {
  if (!process.stdin.isTTY) {
    throw new Error(`${question} — but stdin is not a terminal. Re-run interactively.`);
  }
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    return (await rl.question(`${question} `)).trim();
  } finally {
    rl.close();
  }
}

/** Ask on the terminal before a message actually goes out. */
export async function confirm(question: string): Promise<boolean> {
  if (!process.stdin.isTTY) {
    throw new Error(
      "Confirmation needed but stdin is not a terminal. Re-run interactively, or pass --yes to approve this run.",
    );
  }
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = (await rl.question(`${question} [y/N] `)).trim().toLowerCase();
    return answer === "y" || answer === "yes";
  } finally {
    rl.close();
  }
}
