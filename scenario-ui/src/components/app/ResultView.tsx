import { formatMoney } from "@/lib/format";

interface ListingLike {
  url?: unknown;
  title?: unknown;
  priceText?: unknown;
  price?: unknown;
}

function isListing(value: unknown): value is ListingLike & { url: string; title: string } {
  const v = value as ListingLike | null;
  return Boolean(v && typeof v.url === "string" && typeof v.title === "string");
}

function collectListings(result: unknown): Array<ListingLike & { url: string; title: string }> {
  if (Array.isArray(result) && result.every((entry) => Array.isArray((entry as { value?: unknown })?.value))) {
    return (result as Array<{ value: unknown[] }>).flatMap((entry) => entry.value).filter(isListing);
  }
  if (Array.isArray(result) && result.every(isListing)) return result.filter(isListing);
  return [];
}

export default function ResultView({ result }: { result: unknown }) {
  if (result === undefined || result === null) return null;

  const listings = collectListings(result);
  if (listings.length > 0) {
    return (
      <div className="grid gap-2 sm:grid-cols-2">
        {listings.map((listing, i) => (
          <a
            key={`${listing.url}-${i}`}
            href={listing.url}
            target="_blank"
            rel="noreferrer"
            className="block rounded-lg border border-border bg-background/60 p-3 text-sm transition-colors hover:border-primary/40 hover:bg-muted/40"
          >
            <div className="font-medium tabular-nums text-primary">
              {typeof listing.price === "number"
                ? formatMoney(listing.price)
                : (listing.priceText as string) || "—"}
            </div>
            <div className="mt-0.5 line-clamp-2 text-foreground/90">{listing.title}</div>
          </a>
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
