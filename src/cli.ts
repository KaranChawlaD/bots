#!/usr/bin/env tsx
import { readFileSync } from "node:fs";
import { flagBool, flagList, flagNumber, flagString, parseArgs, type ParsedArgs } from "./args.js";
import { loadSettings, selectAccounts, type Account, type Settings } from "./config.js";
import { logger, success } from "./log.js";
import { runAcrossAgents } from "./agents/pool.js";
import { Agent, describe, withAgent } from "./steel/agent.js";
import { loadProfile, profileAge } from "./steel/profiles.js";
import { ensureLoggedIn, isLoggedIn } from "./kijiji/auth.js";
import { search, view } from "./kijiji/listings.js";
import { sendMessage } from "./kijiji/messages.js";
import { sendHistory } from "./safety.js";

const log = logger("cli");

const usage = `
kijiji — steel.dev browser agents for your own Kijiji accounts

  npm run kijiji -- <command> [options]

Commands
  accounts                       List configured accounts and saved sessions
  login   [--account a,b]        Sign each agent in and save its session profile
  search  <keywords>             Search listings (one agent per account, in parallel)
            [--account a,b] [--limit 25] [--min-price N] [--max-price N]
            [--sort dateDesc|priceAsc|priceDesc] [--json]
  view    <listing-url|adId>     Open one listing and print its details [--account a]
  message <listing-url|adId>     Send one message to that listing's seller
            --text "..." | --text-file path  [--account a] [--dry-run] [--yes]
  run     <plan.json>            Work through a plan of per-account message tasks
            [--dry-run] [--yes]
  history                        Show what each account has already messaged

Global options
  --viewer      Print the Steel session viewer URL and keep the browser watchable
  --help        Show this help

Sends are always one at a time, rate limited per account, and confirmed on the
terminal unless you pass --yes for that run.
`;

interface PlanTask {
  account: string;
  listing: string;
  message: string;
}

async function main(): Promise<number> {
  const args = parseArgs(process.argv.slice(2));
  if (args.command === "help" || flagBool(args, "help")) {
    process.stdout.write(`${usage}\n`);
    return 0;
  }

  const settings = loadSettings();
  const showViewer = flagBool(args, "viewer");

  switch (args.command) {
    case "accounts":
      return commandAccounts(settings);
    case "login":
      return commandLogin(settings, args, showViewer);
    case "search":
      return commandSearch(settings, args, showViewer);
    case "view":
      return commandView(settings, args, showViewer);
    case "message":
      return commandMessage(settings, args, showViewer);
    case "run":
      return commandRun(settings, args, showViewer);
    case "history":
      return commandHistory();
    default:
      log.error(`Unknown command "${args.command}".`);
      process.stdout.write(`${usage}\n`);
      return 1;
  }
}

function commandAccounts(settings: Settings): number {
  for (const account of settings.accounts) {
    const profile = loadProfile(account.id);
    const state = profile ? `session saved ${profileAge(profile)}` : "no saved session";
    process.stdout.write(
      `${account.id.padEnd(14)} ${account.email.padEnd(32)} ${state}${account.label ? ` — ${account.label}` : ""}\n`,
    );
  }
  return 0;
}

async function commandLogin(
  settings: Settings,
  args: ParsedArgs,
  showViewer: boolean,
): Promise<number> {
  const accounts = selectAccounts(settings, flagList(args, "account"));
  const results = await runAcrossAgents(
    accounts,
    { showViewer, maxConcurrent: settings.limits.maxConcurrentAgents, useSavedProfile: true },
    async (agent) => {
      await ensureLoggedIn(agent);
      return await isLoggedIn(agent);
    },
  );
  const failed = results.filter((result) => result.error || result.value !== true);
  for (const result of results) {
    process.stdout.write(
      `${result.accountId.padEnd(14)} ${result.error ? `failed: ${result.error}` : "signed in"}\n`,
    );
  }
  if (failed.length === 0) success(`All ${results.length} agents signed in.`);
  return failed.length === 0 ? 0 : 1;
}

async function commandSearch(
  settings: Settings,
  args: ParsedArgs,
  showViewer: boolean,
): Promise<number> {
  const keywords = args.positionals.join(" ").trim();
  if (!keywords) throw new Error('search needs keywords, e.g. search "ps5 controller".');
  const accounts = selectAccounts(settings, flagList(args, "account"));
  const sort = flagString(args, "sort") as "dateDesc" | "priceAsc" | "priceDesc" | undefined;

  const results = await runAcrossAgents(
    accounts,
    { showViewer, maxConcurrent: settings.limits.maxConcurrentAgents },
    (agent) =>
      search(agent, {
        keywords,
        limit: flagNumber(args, "limit") ?? 25,
        ...(flagNumber(args, "min-price") !== undefined
          ? { minPrice: flagNumber(args, "min-price") }
          : {}),
        ...(flagNumber(args, "max-price") !== undefined
          ? { maxPrice: flagNumber(args, "max-price") }
          : {}),
        ...(sort ? { sort } : {}),
      }),
  );

  if (flagBool(args, "json")) {
    process.stdout.write(`${JSON.stringify(results, null, 2)}\n`);
    return results.some((result) => result.error) ? 1 : 0;
  }
  for (const result of results) {
    process.stdout.write(`\n== ${result.accountId} ==\n`);
    if (result.error) {
      process.stdout.write(`  failed: ${result.error}\n`);
      continue;
    }
    for (const listing of result.value ?? []) {
      process.stdout.write(
        `  ${(listing.priceText || "—").padEnd(12)} ${listing.title}\n      ${listing.url}\n`,
      );
    }
  }
  return results.some((result) => result.error) ? 1 : 0;
}

async function commandView(
  settings: Settings,
  args: ParsedArgs,
  showViewer: boolean,
): Promise<number> {
  const target = args.positionals[0];
  if (!target) throw new Error("view needs a listing URL or ad id.");
  const account = singleAccount(settings, args);
  const detail = await withAgent(account, { showViewer }, (agent) => view(agent, target));
  process.stdout.write(`${JSON.stringify(detail, null, 2)}\n`);
  return 0;
}

async function commandMessage(
  settings: Settings,
  args: ParsedArgs,
  showViewer: boolean,
): Promise<number> {
  const target = args.positionals[0];
  if (!target) throw new Error("message needs a listing URL or ad id.");
  const body = messageBody(args);
  const account = singleAccount(settings, args);

  const outcome = await withAgent(account, { showViewer }, (agent) =>
    sendMessage(agent, target, body, {
      limits: settings.limits,
      dryRun: flagBool(args, "dry-run"),
      autoApprove: flagBool(args, "yes"),
    }),
  );
  if (outcome.status === "sent") {
    success(`Sent from ${account.id} on "${outcome.listing.title}".`);
    return 0;
  }
  log.warn(`Not sent: ${outcome.reason}`);
  return 0;
}

async function commandRun(
  settings: Settings,
  args: ParsedArgs,
  showViewer: boolean,
): Promise<number> {
  const planPath = args.positionals[0];
  if (!planPath) throw new Error("run needs a path to a plan JSON file.");
  const tasks = JSON.parse(readFileSync(planPath, "utf8")) as PlanTask[];
  if (!Array.isArray(tasks) || tasks.length === 0) throw new Error(`${planPath} has no tasks.`);

  const dryRun = flagBool(args, "dry-run");
  const autoApprove = flagBool(args, "yes");
  let sent = 0;
  let skipped = 0;

  // Tasks run one at a time: each send is a real conversation with a person.
  for (const [index, task] of tasks.entries()) {
    const account = selectAccounts(settings, [task.account])[0]!;
    log.info(`task ${index + 1}/${tasks.length} — ${task.account} → ${task.listing}`);
    try {
      const outcome = await withAgent(account, { showViewer }, (agent) =>
        sendMessage(agent, task.listing, task.message, {
          limits: settings.limits,
          dryRun,
          autoApprove,
        }),
      );
      if (outcome.status === "sent") sent += 1;
      else {
        skipped += 1;
        log.warn(`  skipped: ${outcome.reason}`);
      }
    } catch (error) {
      skipped += 1;
      log.error(`  failed: ${describe(error)}`);
    }
  }
  success(`Plan finished: ${sent} sent, ${skipped} skipped.`);
  return 0;
}

function commandHistory(): number {
  const history = sendHistory();
  if (history.length === 0) {
    process.stdout.write("No messages sent yet.\n");
    return 0;
  }
  for (const record of history) {
    process.stdout.write(
      `${record.sentAt} ${record.accountId.padEnd(14)} ${record.listingUrl}\n    ${record.preview}\n`,
    );
  }
  return 0;
}

function singleAccount(settings: Settings, args: ParsedArgs): Account {
  const ids = flagList(args, "account");
  if (!ids || ids.length === 0) {
    const first = settings.accounts[0]!;
    log.info(`no --account given, using "${first.id}"`);
    return first;
  }
  if (ids.length > 1) throw new Error("this command takes a single --account.");
  return selectAccounts(settings, ids)[0]!;
}

function messageBody(args: ParsedArgs): string {
  const file = flagString(args, "text-file");
  const inline = flagString(args, "text");
  const body = (file ? readFileSync(file, "utf8") : inline)?.trim();
  if (!body) throw new Error('message needs --text "..." or --text-file path.');
  return body;
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error: unknown) => {
    log.error(describe(error));
    if (process.env.KIJIJI_DEBUG && error instanceof Error) log.error(error.stack ?? "");
    process.exitCode = 1;
  });

/** Agent is re-exported so scripts can drive the same primitives the CLI uses. */
export { Agent };
