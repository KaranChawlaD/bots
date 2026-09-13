#!/usr/bin/env tsx
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { extname, join, normalize, resolve } from "node:path";
import { loadSettings, projectRoot, selectAccounts, type Account, type Settings } from "../config.js";
import { logger } from "../log.js";
import { runAcrossAgents } from "../agents/pool.js";
import { describe, withAgent, type Agent } from "../steel/agent.js";
import { loadProfile, profileAge } from "../steel/profiles.js";
import { ensureLoggedIn, isLoggedIn } from "../kijiji/auth.js";
import {
  search,
  view,
  ownListings,
  type ListingDetail,
  type ListingSummary,
} from "../kijiji/listings.js";
import { draftOffer, type OfferInput } from "../kijiji/offers.js";
import { findComparables, matchingListings, type Comparable, type CompOptions } from "../kijiji/comps.js";
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

interface DraftedOffer {
  account: string;
  listing: string;
  text: string;
}

/** params.offers is the drafted batch shown after an offer run. */
function draftedOffers(params: Record<string, unknown>): DraftedOffer[] {
  const raw = params.offers;
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((entry) => {
    const draft = entry as Partial<DraftedOffer> | null;
    return typeof draft?.account === "string" &&
      draft.account !== "" &&
      typeof draft.listing === "string" &&
      draft.listing !== "" &&
      typeof draft.text === "string" &&
      draft.text.trim() !== ""
      ? [{ account: draft.account, listing: draft.listing, text: draft.text }]
      : [];
  });
}

/**
 * Clone-mode photos come down over plain HTTP into a temp dir — the upload
 * field wants local paths, and the OS reclaims the files on its own schedule.
 */
async function downloadPhotos(urls: string[]): Promise<string[]> {
  const dir = await mkdtemp(join(tmpdir(), "kijiji-post-"));
  const paths: string[] = [];
  for (const [index, url] of urls.slice(0, 10).entries()) {
    try {
      const res = await fetch(url);
      if (!res.ok || !(res.headers.get("content-type") ?? "").startsWith("image/")) continue;
      const path = join(dir, `photo-${index + 1}${extname(new URL(url).pathname) || ".jpg"}`);
      await writeFile(path, Buffer.from(await res.arrayBuffer()));
      paths.push(path);
    } catch (error) {
      log.warn(`  photo ${index + 1} would not download (${describe(error)})`);
    }
  }
  if (paths.length > 0) log.info(`  cloned ${paths.length} photo(s) from the source ad`);
  return paths;
}

/**
 * Post and bundle build the draft the same way: the form's own fields win,
 * and whatever is left blank falls back to the source ad's scraped values.
 */
async function buildListingDraft(
  agent: Agent,
  params: Record<string, unknown>,
  price: ListingDraft["price"],
): Promise<{ draft: ListingDraft; detail?: ListingDetail }> {
  const source = str(params, "sourceListing");
  const base: Partial<ListingDraft> = {};
  let photos = lines(params, "photos");
  let detail: ListingDetail | undefined;
  if (source) {
    detail = await view(agent, source);
    base.title = detail.title;
    base.description = detail.description;
    base.location = detail.location;
    // The source's breadcrumb walks the same category tree; the title is
    // the fallback seed, which lets Kijiji suggest a category instead.
    base.category = detail.category ?? detail.title;
    log.info(
      `cloning "${detail.title}" — category "${base.category}", ${detail.photos.length} photo(s) found`,
    );
    if (bool(params, "reusePhotos") && photos.length === 0 && detail.photos.length > 0) {
      photos = await downloadPhotos(detail.photos);
      if (photos.length === 0) log.warn("  source photos would not download — posting without them");
    }
  }
  const draft: ListingDraft = {
    title: str(params, "title") ?? base.title ?? "",
    description: str(params, "description") ?? base.description ?? "",
    category: str(params, "category") ?? base.category ?? "",
    location: str(params, "location") ?? base.location ?? "",
    price,
    ...(num(params, "locationId") !== undefined ? { locationId: num(params, "locationId") } : {}),
    ...(photos.length > 0 ? { photos } : {}),
  };
  validateDraft(draft);
  return { draft, detail };
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

    const overrideFor = (accountId: string): Record<string, unknown> | undefined => {
      const raw = perAgent[accountId];
      return raw && typeof raw === "object" && !Array.isArray(raw)
        ? (raw as Record<string, unknown>)
        : undefined;
    };
    const wantsComps = (accountId: string): boolean => {
      const override = overrideFor(accountId);
      return override ? bool(override, "priceMatch") : priceMatch;
    };

    // The fourth account carries most of the inventory — when comps are on,
    // its own live ads join the pool and a match gets flagged on the outcome.
    const sellerAccount =
      settings.accounts.find((a) => a.id === (str(params, "sellerAccount") ?? "quaternary")) ??
      settings.accounts[3];
    let ownAds: ListingSummary[] = [];
    if (sellerAccount && accounts.some((a) => wantsComps(a.id))) {
      try {
        ownAds = await withAgent(sellerAccount, { showViewer: true }, async (agent) => {
          await ensureLoggedIn(agent);
          return ownListings(agent);
        });
      } catch (error) {
        log.warn(
          `couldn't read ${sellerAccount.id}'s ads (${describe(error)}) — comps ignore them`,
        );
      }
    }

    const outcomes: Array<Record<string, unknown>> = [];
    for (const [index, item] of work.entries()) {
      const { target, account } = item;
      log.info(`offer ${index + 1}/${work.length} — ${account.id} → ${target}`);
      try {
        const outcome = await withAgent(account, { showViewer: true }, async (agent) => {
          const listing = await view(agent, target);
          const override = overrideFor(account.id);
          const citesComps = wantsComps(account.id);
          // Comps are a nice-to-have: a failed hunt must not sink the draft.
          let comparables: Comparable[] = [];
          let ownMatch: ListingSummary | undefined;
          if (citesComps) {
            try {
              const own = matchingListings(ownAds, listing);
              ownMatch = own[0];
              if (ownMatch) {
                log.info(
                  `  ${sellerAccount?.id ?? "seller"} also lists this — ${ownMatch.priceText || "no price"}`,
                );
              }
              comparables = await findComparables(agent, listing, comps, own);
              if (comparables.length === 0) {
                log.warn("  no cheaper comparable listings found — offering off the ask instead");
              }
            } catch (error) {
              log.warn(`  comp hunt failed (${describe(error)}) — offering off the ask instead`);
            }
          }
          const offer = draftOffer(listing, {
            ...offerInputFor(input, override),
            priceMatch: citesComps,
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
          return { offer, sent, ownMatch };
        });
        outcomes.push({
          account: account.id,
          listing: target,
          amount: outcome.offer.amount,
          comparables: outcome.offer.comparables ?? [],
          message: outcome.offer.message,
          status: outcome.sent ? outcome.sent.status : "drafted",
          ...(outcome.ownMatch
            ? {
                note: `${sellerAccount?.id ?? "the fourth account"} is already selling this${outcome.ownMatch.priceText ? ` at ${outcome.ownMatch.priceText}` : ""}`,
              }
            : {}),
          ...(outcome.sent?.status === "skipped" ? { reason: outcome.sent.reason } : {}),
        });
      } catch (error) {
        outcomes.push({ account: account.id, listing: target, status: "failed", reason: describe(error) });
        log.error(`  failed: ${describe(error)}`);
      }
    }
    return outcomes;
  },

  /**
   * Sends a batch of already-drafted offers back to back. The button that
   * queued this job is the approval, so per-send confirms are skipped —
   * per-account rate limits still apply.
   */
  async sendOffers(params) {
    const settings = loadSettings();
    const drafts = draftedOffers(params);
    if (drafts.length === 0) throw new Error("No drafted offers to send.");
    const dryRun = bool(params, "dryRun");

    const outcomes: Array<Record<string, unknown>> = [];
    for (const [index, draft] of drafts.entries()) {
      log.info(`offer ${index + 1}/${drafts.length} — ${draft.account} → ${draft.listing}`);
      try {
        const account = selectAccounts(settings, [draft.account])[0]!;
        const sent = await withAgent(account, { showViewer: true }, (agent) =>
          sendMessage(agent, draft.listing, draft.text, {
            limits: settings.limits,
            dryRun,
            autoApprove: true,
          }),
        );
        outcomes.push({
          account: draft.account,
          listing: draft.listing,
          status: sent.status,
          ...(sent.status === "skipped" ? { reason: sent.reason } : {}),
        });
        if (sent.status === "skipped") log.warn(`  skipped: ${sent.reason}`);
      } catch (error) {
        outcomes.push({
          account: draft.account,
          listing: draft.listing,
          status: "failed",
          reason: describe(error),
        });
        log.error(`  failed: ${describe(error)}`);
      }
    }
    return outcomes;
  },

  /**
   * Clone mode: sourceListing names an existing ad that supplies whatever the
   * form left blank — title, description, category path, location, photos.
   * The price is always the caller's own.
   */
  async post(params) {
    const settings = loadSettings();
    const price = str(params, "price") === "free" || str(params, "price") === "contact"
      ? (str(params, "price") as "free" | "contact")
      : num(params, "price");
    if (price === undefined) throw new Error('Set a price, or "free" / "contact".');
    const account = oneAccount(settings, params);
    const dryRun = bool(params, "dryRun");

    return withAgent(account, { showViewer: true }, async (agent) => {
      const { draft } = await buildListingDraft(agent, params, price);
      return postListing(agent, draft, { dryRun });
    });
  },

  /**
   * The whole deal in one click: the seller account clones the source ad at
   * its own price and publishes it, then every buying account sends an offer
   * on the source ad at its percent of ask. The button press is the approval
   * for both — no per-step confirms.
   */
  async bundle(params) {
    const settings = loadSettings();
    const source = str(params, "sourceListing");
    if (!source) throw new Error("Enter the listing to clone.");
    const price = str(params, "price") === "free" || str(params, "price") === "contact"
      ? (str(params, "price") as "free" | "contact")
      : num(params, "price");
    if (price === undefined) throw new Error('Set the seller\'s price, or "free" / "contact".');
    const sellerId = str(params, "sellerAccount") ?? "quaternary";
    const sellerAccount = selectAccounts(settings, [sellerId])[0];
    if (!sellerAccount) throw new Error(`No account named "${sellerId}".`);
    const buyers = accountsFor(settings, params).filter((a) => a.id !== sellerAccount.id);
    if (buyers.length === 0) throw new Error("Give at least one buying account a percent.");
    const input = offerInput(params);
    const comps = compOptions(params);
    const perAgent = perAgentParams(params);

    const outcomes: Array<Record<string, unknown>> = [];

    // Step one — clone and publish. Keep the scraped detail around so the
    // buyers' offers are priced off it without a second view.
    let detail: ListingDetail | undefined;
    try {
      const posted = await withAgent(sellerAccount, { showViewer: true }, async (agent) => {
        const built = await buildListingDraft(agent, params, price);
        const result = await postListing(agent, built.draft, { autoApprove: true });
        return { ...built, result };
      });
      detail = posted.detail;
      outcomes.push({
        account: sellerAccount.id,
        listing: source,
        status: posted.result.status,
        ...(typeof price === "number" ? { amount: price } : {}),
        note: `cloned this ad${posted.result.url ? ` → ${posted.result.url}` : ""}`,
      });
    } catch (error) {
      outcomes.push({
        account: sellerAccount.id,
        listing: source,
        status: "failed",
        reason: describe(error),
      });
      log.error(`clone failed (${describe(error)}) — buyers still offer on the source`);
    }

    // Step two — each buyer offers on the source ad at its own percent.
    for (const [index, account] of buyers.entries()) {
      log.info(`buyer ${index + 1}/${buyers.length} — ${account.id} → ${source}`);
      try {
        const outcome = await withAgent(account, { showViewer: true }, async (agent) => {
          const listing = detail ?? (await view(agent, source));
          const raw = perAgent[account.id];
          const override =
            raw && typeof raw === "object" && !Array.isArray(raw)
              ? (raw as Record<string, unknown>)
              : undefined;
          const citesComps = override ? bool(override, "priceMatch") : false;
          let comparables: Comparable[] = [];
          if (citesComps) {
            try {
              comparables = await findComparables(agent, listing, comps);
              if (comparables.length === 0) {
                log.warn("  no cheaper comparable listings found — offering off the ask instead");
              }
            } catch (error) {
              log.warn(`  comp hunt failed (${describe(error)}) — offering off the ask instead`);
            }
          }
          const offer = draftOffer(listing, {
            ...offerInputFor(input, override),
            priceMatch: citesComps,
            comparables,
            variant: index,
            ...(account.style ? { style: account.style } : {}),
          });
          log.info(
            `  asking ${listing.priceText || "—"} → offering $${offer.amount}` +
              `${comparables.length > 0 ? `, citing ${comparables.length} cheaper listing(s)` : ""}`,
          );
          const sent = await sendMessage(agent, source, offer.message, {
            limits: settings.limits,
            autoApprove: true,
          });
          return { offer, sent };
        });
        outcomes.push({
          account: account.id,
          listing: source,
          amount: outcome.offer.amount,
          comparables: outcome.offer.comparables ?? [],
          message: outcome.offer.message,
          status: outcome.sent.status,
          ...(outcome.sent.status === "skipped" ? { reason: outcome.sent.reason } : {}),
        });
      } catch (error) {
        outcomes.push({ account: account.id, listing: source, status: "failed", reason: describe(error) });
        log.error(`  failed: ${describe(error)}`);
      }
    }
    return outcomes;
  },
};

function jobLabel(request: JobRequest): string {
  const { type, params } = request;
  if (type === "search") return `search "${str(params, "keywords") ?? ""}"`;
  if (type === "view") return `view ${str(params, "listing") ?? ""}`;
  if (type === "message") return `message ${str(params, "listing") ?? ""}`;
  if (type === "offer") {
    const who = ids(params, "accounts")?.join(", ") ?? str(params, "account");
    return `offer on ${lines(params, "listings").length} listing(s)${who ? ` via ${who}` : ""}`;
  }
  if (type === "sendOffers") {
    return `send ${draftedOffers(params).length} drafted offer(s)`;
  }
  if (type === "post") {
    const source = str(params, "sourceListing");
    return `post "${str(params, "title") ?? (source ? `clone of ${source}` : "")}"`;
  }
  if (type === "bundle") return `bundle clone+offers on ${str(params, "sourceListing") ?? ""}`;
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
