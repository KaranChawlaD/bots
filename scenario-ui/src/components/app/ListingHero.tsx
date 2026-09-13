import { useState } from "react";
import { motion } from "motion/react";
import ShimmerText from "@/components/kokonutui/shimmer-text";
import ParticleButton from "@/components/kokonutui/particle-button";

interface ListingHeroProps {
  onSubmit: (listing: string) => void;
  loading: boolean;
}

export default function ListingHero({ onSubmit, loading }: ListingHeroProps) {
  const [value, setValue] = useState("");

  return (
    <div className="mx-auto flex max-w-2xl flex-col items-center text-center">
      <ShimmerText
        text="Four agents. One listing."
        className="text-4xl font-semibold tracking-tight md:text-6xl"
      />
      <motion.p
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.3, duration: 0.5 }}
        className="-mt-4 max-w-md text-sm text-muted-foreground"
      >
        Drop in a Kijiji listing. Two agents lowball it, one makes a fair offer,
        and one lists the same item to compete with it — for real, on your accounts.
      </motion.p>

      <motion.form
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.45, duration: 0.5 }}
        className="mt-8 flex w-full items-center gap-2 rounded-full border border-white/10 bg-white/5 p-1.5 pl-5 shadow-[0_0_60px_-24px_var(--primary)] backdrop-blur-md focus-within:border-primary/40"
        onSubmit={(e) => {
          e.preventDefault();
          if (value.trim() && !loading) onSubmit(value.trim());
        }}
      >
        <input
          className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          disabled={loading}
          onChange={(e) => setValue(e.target.value)}
          placeholder="Kijiji listing URL or ad id"
          value={value}
        />
        <ParticleButton
          className="shrink-0 rounded-full"
          disabled={loading || !value.trim()}
          successDuration={600}
          type="submit"
        >
          {loading ? "Running…" : "Run scenario"}
        </ParticleButton>
      </motion.form>

      <p className="mt-3 text-xs text-muted-foreground/70">
        Dry run — every offer is drafted and the listing is filled in, nothing is sent or published.
      </p>
    </div>
  );
}
