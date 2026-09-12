import type { Comparable } from "./comps.js";
import type { ListingSummary } from "./listings.js";

export interface OfferInput {
  /** Offer this exact dollar amount, regardless of the asking price. */
  amount?: number;
  /** Offer this percentage of the asking price (e.g. 85 for 15% under ask). */
  percent?: number;
  /** Never offer below this. */
  floor?: number;
  /** Never offer above this. */
  ceiling?: number;
  /** Rounded to this step so offers read like real numbers. */
  roundTo?: number;
  /** Extra line appended to the draft, e.g. "I can pick up tonight in Scarborough." */
  note?: string;
  /** Picks which wording variant is used, so repeated runs aren't identical. */
  variant?: number;
  /** Cheaper live listings of the same item, quoted in the message. */
  comparables?: Comparable[];
  /** Price off the cheapest comparable instead of a percentage of the ask. */
  priceMatch?: boolean;
}

export interface Offer {
  amount: number;
  askingPrice?: number;
  discountPercent?: number;
  comparables?: Comparable[];
  message: string;
}

function cheapest(comparables: Comparable[] | undefined): Comparable | undefined {
  return [...(comparables ?? [])].sort((a, b) => a.price - b.price)[0];
}

export function offerPrice(listing: Pick<ListingSummary, "price">, input: OfferInput): number {
  const roundTo = input.roundTo ?? 5;
  let amount: number;
  const match = input.priceMatch ? cheapest(input.comparables) : undefined;
  if (input.amount !== undefined) {
    amount = input.amount;
  } else if (match) {
    amount = match.price;
  } else if (listing.price !== undefined) {
    amount = (listing.price * (input.percent ?? 85)) / 100;
  } else {
    throw new Error(
      "This listing has no readable price, so an offer percentage can't be applied — pass --amount instead.",
    );
  }
  amount = Math.round(amount / roundTo) * roundTo;
  if (input.floor !== undefined) amount = Math.max(amount, input.floor);
  if (input.ceiling !== undefined) amount = Math.min(amount, input.ceiling);
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error(`Computed a nonsensical offer (${amount}) for "${listing.price ?? "no price"}".`);
  }
  return amount;
}

const templates: Array<(context: { title: string; amount: number }) => string> = [
  ({ title, amount }) =>
    `Hi! I'm interested in your ${title}. Would you take $${amount} for it? I can pay cash and pick up at a time that works for you.`,
  ({ title, amount }) =>
    `Hello — is the ${title} still available? I'd be able to do $${amount} cash if that works for you. Happy to come to you.`,
  ({ title, amount }) =>
    `Hi there, nice listing. I can offer $${amount} and pick it up this week — let me know if that's workable.`,
];

/**
 * Quotes the cheaper listings so the seller can check them: each one is a live
 * ad with its own price and link, not a claim they have to take on faith.
 */
function comparableLines(comparables: Comparable[]): string {
  const listed = comparables
    .map((comp) => `- ${comp.priceText || `$${comp.price}`} — ${comp.title.trim()}\n  ${comp.url}`)
    .join("\n");
  const lead =
    comparables.length === 1
      ? "I'm comparing it with this one that's up right now:"
      : "I'm comparing it with these that are up right now:";
  return `${lead}\n${listed}`;
}

export function draftOffer(
  listing: Pick<ListingSummary, "title" | "price" | "priceText">,
  input: OfferInput,
): Offer {
  const amount = offerPrice(listing, input);
  const template = templates[(input.variant ?? 0) % templates.length]!;
  let body = template({ title: listing.title.trim(), amount });
  const comparables = input.comparables ?? [];
  if (comparables.length > 0) {
    body = `${body}\n\n${comparableLines(comparables)}\n\nAny chance you could match that? Yours is closer to me, so I'd rather buy from you.`;
  }
  return {
    amount,
    ...(comparables.length > 0 ? { comparables } : {}),
    ...(listing.price !== undefined ? { askingPrice: listing.price } : {}),
    ...(listing.price !== undefined
      ? { discountPercent: Math.round((1 - amount / listing.price) * 100) }
      : {}),
    message: input.note ? `${body}\n\n${input.note.trim()}` : body,
  };
}
