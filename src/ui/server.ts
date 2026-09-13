#!/usr/bin/env tsx
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize, resolve } from "node:path";
import { loadSettings, projectRoot, selectAccounts, type Account, type Settings } from "../config.js";
import { logger } from "../log.js";
import { runAcrossAgents } from "../agents/pool.js";
import { describe, withAgent } from "../steel/agent.js";
import { loadProfile, profileAge } from "../steel/profiles.js";
import { ensureLoggedIn, isLoggedIn } from "../kijiji/auth.js";
import { search, view } from "../kijiji/listings.js";
import { draftOffer, type OfferInput } from "../kijiji/offers.js";
import { findComparables, type CompOptions } from "../kijiji/comps.js";
import { sendMessage } from "../kijiji/messages.js";
import { postListing, validateDraft, type ListingDraft } from "../kijiji/post.js";
import { sendHistory } from "../safety.js";
import { answerJob, getJob, listJobs, startJob } from "./jobs.js";
import { isAuthed, login, logout, passwordRequired } from "./auth.js";

const log = logger("ui");
const webRoot = resolve(projectRoot, "scenario-ui/dist");

/**
 * The UI is a single-page app: the static shell (HTML/JS/CSS) carries no
 * account data, so it's served to anyone. It calls /api/auth on load and
 * renders its own password gate — only the /api/* routes below that touch
 * account data are gated by isAuthed.
 */
const publicPaths = new Set(["/api/login", "/api/auth"]);

const mimeTypes: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
  ".json": "application/json; charset=utf-8",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".map": "application/json; charset=utf-8",
};

interface JobRequest {
  type: string;
  params: Record<string, unknown>;
}

function str(params: Record<string, unknown>, key: string): string | undefined {
  const value = params[key];
  return typeof value === "string" && value.trim() !== "" ? value.trim() : undefined;
}

function num(params: Record<string, unknown>, key: string): number | undefined {
  const value = params[key];
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value))) {
    return Number(value);
  }
  return undefined;
}

function bool(params: Record<string, unknown>, key: string): boolean {
  return params[key] === true || params[key] === "true";
}

function ids(params: Record<string, unknown>, key: string): string[] | undefined {
  const value = params[key];
  if (!Array.isArray(value)) return undefined;
  const list = value.filter((entry): entry is string => typeof entry === "string" && entry !== "");
  return list.length > 0 ? list : undefined;
}

function lines(params: Record<string, unknown>, key: string): string[] {
  const value = params[key];
  if (Array.isArray(value)) {
    return value.filter((entry): entry is string => typeof entry === "string" && entry.trim() !== "");
  }
  if (typeof value !== "string") return [];
  return value
    .split(/[\s,]+/)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function offerInput(params: Record<string, unknown>): OfferInput {
  const amount = num(params, "amount");
  const percent = num(params, "percent");
  if (amount !== undefined && percent !== undefined) {
    throw new Error("Use either a fixed amount or a percentage of the ask, not both.");
  }
  return {
    ...(amount !== undefined ? { amount } : { percent: percent ?? 85 }),
    ...(num(params, "floor") !== undefined ? { floor: num(params, "floor") } : {}),
    ...(num(params, "ceiling") !== undefined ? { ceiling: num(params, "ceiling") } : {}),
    ...(num(params, "roundTo") !== undefined ? { roundTo: num(params, "roundTo") } : {}),
    ...(str(params, "note") ? { note: str(params, "note") } : {}),
  };
}

/**
 * One account's overrides on top of the shared offer input — a different
 * percent-of-ask per client, a different floor, its own note. Amount and
 * percent stay mutually exclusive: whichever the override sets wins.
 */
function offerInputFor(base: OfferInput, raw: unknown): OfferInput {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return base;
  const params = raw as Record<string, unknown>;
  const merged = { ...base };
  const amount = num(params, "amount");
  const percent = num(params, "percent");
  if (amount !== undefined) {
    merged.amount = amount;
    delete merged.percent;
  } else if (percent !== undefined) {
    merged.percent = percent;
    delete merged.amount;
  }
  const floor = num(params, "floor");
  if (floor !== undefined) merged.floor = floor;
  const ceiling = num(params, "ceiling");
  if (ceiling !== undefined) merged.ceiling = ceiling;
  const note = str(params, "note");
  if (note) merged.note = note;
  return merged;
}

/** params.perAgent maps account id → partial offer input. */
function perAgentParams(params: Record<string, unknown>): Record<string, unknown> {
  const raw = params.perAgent;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  return raw as Record<string, unknown>;
}

function compOptions(params: Record<string, unknown>): CompOptions {
  return {
    ...(num(params, "comps") !== undefined ? { limit: num(params, "comps") } : {}),
    ...(str(params, "compsQuery") ? { query: str(params, "compsQuery") } : {}),
    ...(num(params, "compsMinRatio") !== undefined ? { minRatio: num(params, "compsMinRatio") } : {}),
  };
}

function accountsFor(settings: Settings, params: Record<string, unknown>): Account[] {
  return selectAccounts(settings, ids(params, "accounts"));
}

function oneAccount(settings: Settings, params: Record<string, unknown>): Account {
  const chosen = ids(params, "accounts") ?? (str(params, "account") ? [str(params, "account")!] : []);
  if (chosen.length > 1) throw new Error("This command runs on a single account.");
  return chosen.length === 1 ? selectAccounts(settings, chosen)[0]! : settings.accounts[0]!;
}

const handlers: Record<string, (params: Record<string, unknown>) => Promise<unknown>> = {
  async login(params) {
    const settings = loadSettings();
    const accounts = accountsFor(settings, params);
    return runAcrossAgents(
      accounts,
      {
        showViewer: true,
        maxConcurrent: settings.limits.maxConcurrentAgents,
        useSavedProfile: true,
      },
      async (agent) => {
        await ensureLoggedIn(agent);
        return { signedIn: await isLoggedIn(agent), viewer: agent.viewerUrl };
      },
    );
  },

  async search(params) {
    const settings = loadSettings();
    const keywords = str(params, "keywords");
    if (!keywords) throw new Error("Enter something to search for.");
    const sort = str(params, "sort") as "dateDesc" | "priceAsc" | "priceDesc" | undefined;
    return runAcrossAgents(
      accountsFor(settings, params),
      { showViewer: true, maxConcurrent: settings.limits.maxConcurrentAgents },
      (agent) =>
        search(agent, {
          keywords,
          limit: num(params, "limit") ?? 25,
          ...(num(params, "minPrice") !== undefined ? { minPrice: num(params, "minPrice") } : {}),
          ...(num(params, "maxPrice") !== undefined ? { maxPrice: num(params, "maxPrice") } : {}),
          ...(sort ? { sort } : {}),
        }),
    );
  },

  async view(params) {
    const settings = loadSettings();
    const target = str(params, "listing");
    if (!target) throw new Error("Enter a listing URL or ad id.");
    return withAgent(oneAccount(settings, params), { showViewer: true }, (agent) =>
      view(agent, target),
    );
  },

  async message(params) {
    const settings = loadSettings();
    const target = str(params, "listing");
    const text = str(params, "text");
    if (!target) throw new Error("Enter a listing URL or ad id.");
    if (!text) throw new Error("Write the message first.");
    const account = oneAccount(settings, params);
    return withAgent(account, { showViewer: true }, (agent) =>
      sendMessage(agent, target, text, { limits: settings.limits, dryRun: bool(params, "dryRun") }),
    );
  },

  /** Offers go out one listing at a time, each approved in the browser. */
  async offer(params) {
    const settings = loadSettings();
    const targets = lines(params, "listings");
    if (targets.length === 0) throw new Error("Add at least one listing URL or ad id.");
    const accounts = accountsFor(settings, params);
    const input = offerInput(params);
    const priceMatch = bool(params, "priceMatch");
    const comps = compOptions(params);
    const dryRun = bool(params, "dryRun");
    // Draft-only mode: the panel reviews each message and sends it as its own
    // job, so the offer run never sends on its own.
    const draftOnly = bool(params, "draftOnly");
    // Every-agent mode: one offer per selected account for each listing, so
    // the same listing can be offered on by every agent at once.
    const everyAgent = bool(params, "everyAgent");
    const perAgent = perAgentParams(params);

    const work = everyAgent
      ? targets.flatMap((target) => accounts.map((account) => ({ target, account })))
      : targets.map((target, index) => ({ target, account: accounts[index % accounts.length]! }));

    const outcomes: Array<Record<string, unknown>> = [];
    for (const [index, item] of work.entries()) {
      const { target, account } = item;
      log.info(`offer ${index + 1}/${work.length} — ${account.id} → ${target}`);
      try {
        const outcome = await withAgent(account, { showViewer: true }, async (agent) => {
          const listing = await view(agent, target);
          const comparables = priceMatch ? await findComparables(agent, listing, comps) : [];
          if (priceMatch && comparables.length === 0) {
            log.warn("  no cheaper comparable listings found — offering off the ask instead");
          }
          const offer = draftOffer(listing, {
            ...offerInputFor(input, perAgent[account.id]),
            priceMatch,
            comparables,
            variant: index,
            ...(account.style ? { style: account.style } : {}),
          });
          log.info(
            `  asking ${listing.priceText || "—"} → offering $${offer.amount}` +
              `${comparables.length > 0 ? `, citing ${comparables.length} cheaper listing(s)` : ""}`,
          );
          const sent = draftOnly
            ? undefined
            : await sendMessage(agent, listing.url, offer.message, {
                limits: settings.limits,
                dryRun,
              });
          return { offer, sent };
        });
        outcomes.push({
          account: account.id,
          listing: target,
          amount: outcome.offer.amount,
          comparables: outcome.offer.comparables ?? [],
          message: outcome.offer.message,
          status: outcome.sent ? outcome.sent.status : "drafted",
          ...(outcome.sent?.status === "skipped" ? { reason: outcome.sent.reason } : {}),
        });
      } catch (error) {
        outcomes.push({ account: account.id, listing: target, status: "failed", reason: describe(error) });
        log.error(`  failed: ${describe(error)}`);
      }
    }
    return outcomes;
  },

  async post(params) {
    const settings = loadSettings();
    const price = str(params, "price") === "free" || str(params, "price") === "contact"
      ? (str(params, "price") as "free" | "contact")
      : num(params, "price");
    if (price === undefined) throw new Error('Set a price, or "free" / "contact".');
    const draft: ListingDraft = {
      title: str(params, "title") ?? "",
      description: str(params, "description") ?? "",
      category: str(params, "category") ?? "",
      location: str(params, "location") ?? "",
      price,
      ...(num(params, "locationId") !== undefined ? { locationId: num(params, "locationId") } : {}),
      ...(lines(params, "photos").length > 0 ? { photos: lines(params, "photos") } : {}),
    };
    validateDraft(draft);
    const account = oneAccount(settings, params);
    return withAgent(account, { showViewer: true }, (agent) =>
      postListing(agent, draft, { dryRun: bool(params, "dryRun") }),
    );
  },
};

function jobLabel(request: JobRequest): string {
  const { type, params } = request;
  if (type === "search") return `search "${str(params, "keywords") ?? ""}"`;
  if (type === "view") return `view ${str(params, "listing") ?? ""}`;
  if (type === "message") return `message ${str(params, "listing") ?? ""}`;
  if (type === "offer") {
    const account = str(params, "account");
    return `offer on ${lines(params, "listings").length} listing(s)${account ? ` via ${account}` : ""}`;
  }
  if (type === "post") return `post "${str(params, "title") ?? ""}"`;
  return type;
}

async function readBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  if (chunks.length === 0) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown>;
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(payload),
  });
  res.end(payload);
}

function state(): unknown {
  const settings = loadSettings();
  return {
    accounts: settings.accounts.map((account) => {
      const profile = loadProfile(account.id);
      return {
        id: account.id,
        email: account.email,
        ...(account.label ? { label: account.label } : {}),
        session: profile ? `saved ${profileAge(profile)}` : "no saved session",
        signedIn: Boolean(profile),
      };
    }),
    limits: settings.limits,
    history: sendHistory().slice(-50).reverse(),
  };
}

async function serveStatic(pathname: string, res: ServerResponse): Promise<void> {
  const relative = pathname === "/" ? "index.html" : normalize(pathname).replace(/^([/\\.]+)/, "");
  const file = join(webRoot, relative);
  if (!file.startsWith(webRoot)) {
    sendJson(res, 403, { error: "forbidden" });
    return;
  }
  try {
    const body = await readFile(file);
    res.writeHead(200, {
      "content-type": mimeTypes[extname(file)] ?? "application/octet-stream",
      "content-length": body.byteLength,
    });
    res.end(body);
  } catch {
    sendJson(res, 404, { error: `no such file: ${relative}` });
  }
}

async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? "/", "http://localhost");
  const path = url.pathname;

  if (req.method === "POST" && path === "/api/login") {
    const body = await readBody(req);
    const attempt = login(res, body.password);
    if (attempt.ok) sendJson(res, 200, { ok: true });
    else if (attempt.retryAfter) sendJson(res, 429, { error: `too many attempts — wait ${attempt.retryAfter}s` });
    else sendJson(res, 401, { error: "wrong password" });
    return;
  }
  if (req.method === "POST" && path === "/api/logout") {
    logout(res);
    sendJson(res, 200, { ok: true });
    return;
  }

  if (path.startsWith("/api/") && !publicPaths.has(path) && !isAuthed(req)) {
    sendJson(res, 401, { error: "sign in" });
    return;
  }

  if (req.method === "GET" && path === "/api/auth") {
    sendJson(res, 200, { passwordRequired: passwordRequired(), authed: isAuthed(req) });
    return;
  }

  if (req.method === "GET" && path === "/api/state") {
    sendJson(res, 200, state());
    return;
  }
  if (req.method === "GET" && path === "/api/jobs") {
    sendJson(res, 200, { jobs: listJobs() });
    return;
  }
  const jobMatch = /^\/api\/jobs\/([\w-]+)$/.exec(path);
  if (req.method === "GET" && jobMatch) {
    const job = getJob(jobMatch[1]!);
    if (!job) sendJson(res, 404, { error: "unknown job" });
    else sendJson(res, 200, job);
    return;
  }
  const answerMatch = /^\/api\/jobs\/([\w-]+)\/answer$/.exec(path);
  if (req.method === "POST" && answerMatch) {
    const body = await readBody(req);
    const answered = answerJob(
      answerMatch[1]!,
      typeof body.text === "string" ? { text: body.text } : { approved: body.approved === true },
    );
    sendJson(res, answered ? 200 : 409, { answered });
    return;
  }
  if (req.method === "POST" && path === "/api/jobs") {
    const body = await readBody(req);
    const type = typeof body.type === "string" ? body.type : "";
    const params = (body.params ?? {}) as Record<string, unknown>;
    const handler = handlers[type];
    if (!handler) {
      sendJson(res, 400, { error: `unknown command "${type}"` });
      return;
    }
    sendJson(res, 200, startJob(type, jobLabel({ type, params }), () => handler(params)));
    return;
  }
  if (req.method === "GET") {
    await serveStatic(path, res);
    return;
  }
  sendJson(res, 405, { error: "method not allowed" });
}

const port = Number(process.env.PORT ?? 5173);
const host = process.env.HOST ?? "127.0.0.1";

createServer((req, res) => {
  handle(req, res).catch((error: unknown) => {
    log.error(describe(error));
    if (!res.headersSent) sendJson(res, 500, { error: describe(error) });
  });
}).listen(port, host, () => {
  log.info(`control panel on http://${host}:${port}`);
  if (passwordRequired()) log.info("a password is required to open it");
  else log.warn("no UI_PASSWORD set — anyone who can reach this port drives your accounts");
});
