import { formatMoney } from "@/lib/format";
import { Button } from "@/components/ui/button";
import type { SendRecord } from "@/lib/api";

interface ListingLike {
  url?: unknown;
  title?: unknown;
  priceText?: unknown;
  price?: unknown;
}

interface OfferLike {
  account?: unknown;
  listing?: unknown;
  amount?: unknown;
  message?: unknown;
  status?: unknown;
  reason?: unknown;
  note?: unknown;
  comparables?: unknown;
}

function isListing(value: unknown): value is ListingLike & { url: string; title: string } {
  const v = value as ListingLike | null;
  return Boolean(v && typeof v.url === "string" && typeof v.title === "string");
}

function collectListings(result: unknown): Array<ListingLike & { url: string; title: string }> {
  if (isListing(result)) return [result];
  if (Array.isArray(result) && result.every((entry) => Array.isArray((entry as { value?: unknown })?.value))) {
    return (result as Array<{ value: unknown[] }>).flatMap((entry) => entry.value).filter(isListing);
  }
  if (Array.isArray(result) && result.every(isListing)) return result.filter(isListing);
  return [];
}

/** Offer outcomes look like { account, listing, amount, message, status }. */
function isOffer(value: unknown): value is OfferLike & { listing: string; status: string } {
  const v = value as OfferLike | null;
  return Boolean(v && typeof v.listing === "string" && typeof v.status === "string");
}

function collectOffers(result: unknown): Array<OfferLike & { listing: string; status: string }> {
  if (Array.isArray(result) && result.every(isOffer)) return result;
  return [];
}

const actionClass =
  "text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline";

/** Ad id from a listing URL or a bare numeric id — matches the server side. */
function adIdOf(url: string): string | undefined {
  const fromQuery = /[?&]adId=(\d+)/.exec(url);
  if (fromQuery?.[1]) return fromQuery[1];
  const fromPath = /\/(\d{6,})(?:[/?#]|$)/.exec(url);
  if (fromPath?.[1]) return fromPath[1];
  return /^\d+$/.test(url) ? url : undefined;
}

function alreadySent(
  offer: OfferLike & { listing: string },
  history: SendRecord[] | undefined,
): boolean {
  if (!history || typeof offer.account !== "string") return false;
  const adId = adIdOf(offer.listing);
  return history.some(
    (record) =>
      record.accountId === offer.account &&
      (record.listingUrl === offer.listing ||
        (adId !== undefined && adIdOf(record.listingUrl) === adId)),
  );
}

export default function ResultView({
  result,
  history,
  onOpenListing,
  onDraftOffer,
  onSendOffer,
  onSendAllOffers,
}: {
  result: unknown;
  history?: SendRecord[];
  onOpenListing?: (url: string) => void;
  onDraftOffer?: (url: string) => void;
  onSendOffer?: (draft: { listing: string; text: string; account?: string }) => void;
  onSendAllOffers?: (drafts: Array<{ account: string; listing: string; text: string }>) => void;
}) {
  if (result === undefined || result === null) return null;

  const listings = collectListings(result);
  if (listings.length > 0) {
    return (
      <div className="grid gap-2 sm:grid-cols-2">
        {listings.map((listing, i) => (
          <div
            key={`${listing.url}-${i}`}
            className="rounded-lg border border-border bg-background/60 p-3 text-sm transition-colors hover:border-primary/40 hover:bg-muted/40"
          >
            <div className="font-medium tabular-nums text-primary">
              {typeof listing.price === "number"
                ? formatMoney(listing.price)
                : (listing.priceText as string) || "—"}
            </div>
            <div className="mt-0.5 line-clamp-2 text-foreground/90">{listing.title}</div>
            <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1">
              <a
                href={listing.url}
                target="_blank"
                rel="noreferrer"
                className={actionClass}
              >
                Open in new tab
              </a>
              {onOpenListing && (
                <button type="button" className={actionClass} onClick={() => onOpenListing(listing.url)}>
                  Open in Listing tab
                </button>
              )}
              {onDraftOffer && (
                <button type="button" className={actionClass} onClick={() => onDraftOffer(listing.url)}>
                  Draft offer
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
    );
  }

  const offers = collectOffers(result);
  if (offers.length > 0) {
    const sendable = offers.filter(
      (offer): offer is OfferLike & { listing: string; status: string; account: string; message: string } =>
        offer.status === "drafted" &&
        !alreadySent(offer, history) &&
        typeof offer.account === "string" &&
        typeof offer.message === "string" &&
        offer.message !== "",
    );
    return (
      <div className="space-y-2">
        {onSendAllOffers && sendable.length > 0 && (
          <div className="flex items-center justify-between gap-2 rounded-lg border border-border bg-muted/30 p-2">
            <p className="text-xs text-muted-foreground">
              {sendable.length} draft{sendable.length === 1 ? "" : "s"} ready
            </p>
            <Button
              type="button"
              size="sm"
              onClick={() =>
                onSendAllOffers(
                  sendable.map((offer) => ({
                    account: offer.account,
                    listing: offer.listing,
                    text: offer.message,
                  })),
                )
              }
            >
              Send all
            </Button>
          </div>
        )}
        {offers.map((offer, i) => (
          <div
            key={`${offer.listing}-${i}`}
            className="rounded-lg border border-border bg-background/60 p-3 text-sm"
          >
            <div className="flex items-center justify-between gap-2">
              <span className="font-medium tabular-nums text-primary">
                {typeof offer.amount === "number" ? formatMoney(offer.amount) : "Offer"}
              </span>
              <span className="text-xs text-muted-foreground">
                {[offer.account, offer.status]
                  .filter((part): part is string => typeof part === "string" && part !== "")
                  .join(" · ")}
              </span>
            </div>
            <a
              href={offer.listing}
              target="_blank"
              rel="noreferrer"
              className="mt-1 block truncate text-xs text-muted-foreground underline-offset-2 hover:underline"
            >
              {offer.listing}
            </a>
            {typeof offer.message === "string" && offer.message && (
              <p className="mt-2 whitespace-pre-wrap rounded-md bg-muted/40 p-2 text-xs leading-relaxed">
                {offer.message}
              </p>
            )}
            {typeof offer.reason === "string" && offer.reason && (
              <p className="mt-1 text-xs text-amber-600 dark:text-amber-400">{offer.reason}</p>
            )}
            {typeof offer.note === "string" && offer.note && (
              <p className="mt-1 text-xs text-sky-600 dark:text-sky-400">{offer.note}</p>
            )}
            {offer.status === "drafted" && alreadySent(offer, history) && (
              <p className="mt-2 text-xs font-medium text-emerald-600 dark:text-emerald-400">
                sent
              </p>
            )}
            {onSendOffer &&
              offer.status === "drafted" &&
              !alreadySent(offer, history) &&
              typeof offer.message === "string" && (
              <button
                type="button"
                className={`mt-2 ${actionClass}`}
                onClick={() =>
                  onSendOffer({
                    listing: offer.listing,
                    text: offer.message as string,
                    ...(typeof offer.account === "string" ? { account: offer.account } : {}),
                  })
                }
              >
                Send via Message tab
              </button>
            )}
          </div>
        ))}
      </div>
    );
  }

  return (
    <pre className="max-h-96 overflow-auto rounded-lg bg-muted/50 p-3 text-xs leading-relaxed text-foreground/90">
      {JSON.stringify(result, null, 2)}
    </pre>
  );
}
