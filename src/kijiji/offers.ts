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
}

export interface Offer {
  amount: number;
  askingPrice?: number;
  discountPercent?: number;
  message: string;
}

export function offerPrice(listing: Pick<ListingSummary, "price">, input: OfferInput): number {
  const roundTo = input.roundTo ?? 5;
  let amount: number;
  if (input.amount !== undefined) {
    amount = input.amount;
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

export function draftOffer(
  listing: Pick<ListingSummary, "title" | "price" | "priceText">,
  input: OfferInput,
): Offer {
  const amount = offerPrice(listing, input);
  const template = templates[(input.variant ?? 0) % templates.length]!;
  const body = template({ title: listing.title.trim(), amount });
  return {
    amount,
    ...(listing.price !== undefined ? { askingPrice: listing.price } : {}),
    ...(listing.price !== undefined
      ? { discountPercent: Math.round((1 - amount / listing.price) * 100) }
      : {}),
    message: input.note ? `${body}\n\n${input.note.trim()}` : body,
  };
}
