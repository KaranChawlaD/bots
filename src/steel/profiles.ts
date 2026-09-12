import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type Steel from "steel-sdk";
import { projectRoot } from "../config.js";

export type SessionContext = NonNullable<Steel.SessionCreateParams["sessionContext"]>;

export interface StoredProfile {
  accountId: string;
  savedAt: string;
  context: SessionContext;
}

function profilesDir(): string {
  const dir = process.env.KIJIJI_PROFILES_DIR
    ? resolve(process.env.KIJIJI_PROFILES_DIR)
    : resolve(projectRoot, "profiles");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true, mode: 0o700 });
  return dir;
}

export function profilePath(accountId: string): string {
  return resolve(profilesDir(), `${accountId}.json`);
}

export function loadProfile(accountId: string): StoredProfile | undefined {
  const path = profilePath(accountId);
  if (!existsSync(path)) return undefined;
  return JSON.parse(readFileSync(path, "utf8")) as StoredProfile;
}

export function saveProfile(accountId: string, context: SessionContext): void {
  const profile: StoredProfile = { accountId, savedAt: new Date().toISOString(), context };
  writeFileSync(profilePath(accountId), JSON.stringify(profile, null, 2), { mode: 0o600 });
}

export function profileAge(profile: StoredProfile): string {
  const ms = Date.now() - new Date(profile.savedAt).getTime();
  const hours = Math.floor(ms / 3_600_000);
  if (hours < 1) return `${Math.max(1, Math.floor(ms / 60_000))}m ago`;
  if (hours < 48) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}
