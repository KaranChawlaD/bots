import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";

const COOKIE = "kijiji_ui";
/** Rotating per-process key: restarting the server signs everyone out. */
const signingKey = randomBytes(32);
const sessionMaxAgeMs = 12 * 60 * 60 * 1000;

/** Slows down guessing without keeping per-client state. */
const attempts = { failures: 0, blockedUntil: 0 };

export function uiPassword(): string {
  const password = process.env.UI_PASSWORD?.trim();
  if (!password) {
    throw new Error(
      "Set UI_PASSWORD in .env before starting the control panel — it drives real accounts.",
    );
  }
  return password;
}

function sameString(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

function sign(payload: string): string {
  return createHmac("sha256", signingKey).update(payload).digest("base64url");
}

function issueToken(): string {
  const expiresAt = String(Date.now() + sessionMaxAgeMs);
  return `${expiresAt}.${sign(expiresAt)}`;
}

function tokenValid(token: string): boolean {
  const [expiresAt, signature] = token.split(".");
  if (!expiresAt || !signature) return false;
  if (!sameString(signature, sign(expiresAt))) return false;
  return Number(expiresAt) > Date.now();
}

function cookies(req: IncomingMessage): Record<string, string> {
  const header = req.headers.cookie ?? "";
  const out: Record<string, string> = {};
  for (const part of header.split(";")) {
    const [name, ...rest] = part.trim().split("=");
    if (name) out[name] = decodeURIComponent(rest.join("="));
  }
  return out;
}

export function isAuthed(req: IncomingMessage): boolean {
  const token = cookies(req)[COOKIE];
  return Boolean(token && tokenValid(token));
}

/**
 * Checks the submitted password and sets the session cookie. Returns the
 * seconds to wait when too many wrong guesses have come in.
 */
export function login(res: ServerResponse, password: unknown): { ok: boolean; retryAfter?: number } {
  const now = Date.now();
  if (now < attempts.blockedUntil) {
    return { ok: false, retryAfter: Math.ceil((attempts.blockedUntil - now) / 1000) };
  }
  if (typeof password !== "string" || !sameString(password, uiPassword())) {
    attempts.failures += 1;
    if (attempts.failures >= 5) {
      attempts.blockedUntil = now + 60_000;
      attempts.failures = 0;
    }
    return { ok: false };
  }
  attempts.failures = 0;
  // Secure is left off so this still works over plain http on a LAN address;
  // put it behind a tunnel or a reverse proxy for anything beyond that.
  res.setHeader(
    "set-cookie",
    `${COOKIE}=${issueToken()}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${sessionMaxAgeMs / 1000}`,
  );
  return { ok: true };
}

export function logout(res: ServerResponse): void {
  res.setHeader("set-cookie", `${COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`);
}
