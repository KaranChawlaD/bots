import type { Agent } from "../steel/agent.js";
import type { Limits } from "../config.js";
import { logger } from "../log.js";
import { checkSendLimits, confirm, recordSend } from "../safety.js";
import { ensureLoggedIn } from "./auth.js";
import { view, type ListingDetail } from "./listings.js";
import { dismissOverlays, findFirst, requireFirst, sleep, typeSlowly } from "./page-utils.js";
import { listingUrl } from "./urls.js";

const log = logger("messages");

export interface SendOptions {
  /** Fill the message box and stop short of sending. */
  dryRun?: boolean;
  /** Skip the interactive confirmation (approval for the whole run). */
  autoApprove?: boolean;
  limits: Limits;
}

export type SendOutcome =
  | { status: "sent"; listing: ListingDetail }
  | { status: "skipped"; listing?: ListingDetail; reason: string };

/**
 * Send one message from one of your accounts to the seller of one listing.
 * Never batches: every send passes the rate limits and an approval step.
 */
export async function sendMessage(
  agent: Agent,
  idOrUrl: string,
  body: string,
  options: SendOptions,
): Promise<SendOutcome> {
  const url = listingUrl(idOrUrl);
  const gate = checkSendLimits(agent.account.id, url, options.limits);
  if (!gate.allowed) return { status: "skipped", reason: gate.reason ?? "blocked by send limits" };
  if (gate.waitMs) {
    log.info(`[${agent.account.id}] cooling down ${Math.ceil(gate.waitMs / 1000)}s before sending`);
    await sleep(gate.waitMs);
  }

  await ensureLoggedIn(agent);
  const listing = await view(agent, url);

  if (!options.autoApprove && !options.dryRun) {
    const approved = await confirm(
      `\nSend from "${agent.account.id}" to seller of "${listing.title}" (${listing.priceText}):\n` +
        `${body}\n\nSend it?`,
    );
    if (!approved) return { status: "skipped", listing, reason: "declined at approval prompt" };
  }

  const { page } = agent;
  let field = await findFirst(page, "messageField", 5_000);
  if (!field) {
    // On a collapsed contact box the only control is the form's own submit,
    // which expands it. Safe to click only because there is no text box yet,
    // so there is nothing it could send.
    const opener =
      (await findFirst(page, "messageOpenButton", 10_000)) ??
      (await findFirst(page, "messageSendButton", 2_000));
    if (opener) {
      await opener.click();
      await dismissOverlays(page);
    }
    field = await requireFirst(page, "messageField", 15_000);
  }
  await typeSlowly(field, body);

  if (options.dryRun) {
    log.warn(`[${agent.account.id}] dry run — message typed but not sent`);
    return { status: "skipped", listing, reason: "dry run" };
  }

  await (await requireFirst(page, "messageSendButton")).click();
  const confirmed = await findFirst(page, "messageSentMarker", 15_000);
  if (!confirmed) {
    const stillOpen = await field.isVisible().catch(() => false);
    if (stillOpen && (await field.inputValue().catch(() => "")) === body) {
      throw new Error(
        `[${agent.account.id}] message to "${listing.title}" did not send — the composer still holds the text.`,
      );
    }
  }

  recordSend({
    accountId: agent.account.id,
    listingUrl: listing.url,
    ...(listing.id ? { listingId: listing.id } : {}),
    sentAt: new Date().toISOString(),
    preview: body.slice(0, 120),
  });
  log.info(`[${agent.account.id}] sent message on "${listing.title}"`);
  return { status: "sent", listing };
}
