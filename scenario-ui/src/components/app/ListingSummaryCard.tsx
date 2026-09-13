import { motion } from "motion/react";
import { LiquidGlassCard } from "@/components/kokonutui/liquid-glass-card";
import { formatMoney } from "@/lib/format";

export interface ListingSummary {
  title: string;
  price?: number;
  priceText: string;
  location: string;
  description: string;
  url: string;
}

export default function ListingSummaryCard({ listing }: { listing: ListingSummary }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: -12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
    >
      <LiquidGlassCard className="border border-white/10">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">The listing</p>
            <h2 className="mt-1 truncate text-xl font-semibold">{listing.title}</h2>
            <p className="mt-1 text-sm text-muted-foreground">{listing.location || "Location unknown"}</p>
          </div>
          <div className="text-right">
            <p className="text-2xl font-semibold tabular-nums">
              {listing.price !== undefined ? formatMoney(listing.price) : listing.priceText || "—"}
            </p>
            <a
              className="text-xs text-primary hover:underline"
              href={listing.url}
              rel="noreferrer"
              target="_blank"
            >
              View on Kijiji
            </a>
          </div>
        </div>
        {listing.description && (
          <p className="mt-3 line-clamp-2 text-sm text-muted-foreground">{listing.description}</p>
        )}
      </LiquidGlassCard>
    </motion.div>
  );
}
