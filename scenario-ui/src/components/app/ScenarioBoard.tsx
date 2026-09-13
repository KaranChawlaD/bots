import { useState } from "react";
import { motion } from "motion/react";
import BeamsBackground from "@/components/kokonutui/beams-background";
import { Button } from "@/components/ui/button";
import ListingHero from "@/components/app/ListingHero";
import ListingSummaryCard, { type ListingSummary } from "@/components/app/ListingSummaryCard";
import AgentCard from "@/components/app/AgentCard";
import { AGENTS, POSTER_DEFAULTS } from "@/config/agents";
import { runJob, type Job } from "@/lib/api";
import type { AgentRun } from "@/lib/scenario";

function initialRuns(): Record<string, AgentRun> {
  return Object.fromEntries(AGENTS.map((config) => [config.account, { config, phase: "idle" as const }]));
}

export default function ScenarioBoard({ onSignOut }: { onSignOut?: () => void }) {
  const [listing, setListing] = useState<ListingSummary>();
  const [listingLoading, setListingLoading] = useState(false);
  const [listingError, setListingError] = useState<string>();
  const [runs, setRuns] = useState<Record<string, AgentRun>>(initialRuns);

  function patchRun(account: string, patch: Partial<AgentRun>) {
    setRuns((prev) => ({ ...prev, [account]: { ...prev[account], ...patch } }));
  }

  async function runAgent(config: (typeof AGENTS)[number], listingDetail: ListingSummary) {
    patchRun(config.account, { phase: "queued", job: undefined });
    const onUpdate = (job: Job) => patchRun(config.account, { job, phase: job.status });

    if (config.role === "poster") {
      if (!POSTER_DEFAULTS.category.trim()) {
        patchRun(config.account, {
          phase: "needs-setup",
          setupHint: "Set POSTER_DEFAULTS.category in scenario-ui/src/config/agents.ts so this agent knows what to list under.",
        });
        return;
      }
      await runJob(
        "post",
        {
          account: config.account,
          title: listingDetail.title,
          description: listingDetail.description || `Similar to: ${listingDetail.title}`,
          price: listingDetail.price ?? "contact",
          location: listingDetail.location,
          category: POSTER_DEFAULTS.category,
          ...(POSTER_DEFAULTS.locationId ? { locationId: POSTER_DEFAULTS.locationId } : {}),
          dryRun: true,
        },
        onUpdate,
      );
      return;
    }

    await runJob(
      "offer",
      {
        listings: [listingDetail.url],
        account: config.account,
        percent: config.percent,
        note: config.note,
        dryRun: true,
      },
      onUpdate,
    );
  }

  async function runScenario(input: string) {
    setListing(undefined);
    setListingError(undefined);
    setRuns(initialRuns());
    setListingLoading(true);

    const viewJob = await runJob("view", { listing: input, account: AGENTS[0]!.account });
    setListingLoading(false);

    if (viewJob.status !== "done") {
      setListingError(viewJob.error ?? "Could not open that listing.");
      return;
    }

    const detail = viewJob.result as ListingSummary;
    setListing(detail);
    await Promise.all(AGENTS.map((config) => runAgent(config, detail)));
  }

  return (
    <BeamsBackground className="bg-background" intensity="subtle">
      <div className="mx-auto flex min-h-screen w-full max-w-5xl flex-col px-4 py-10 md:py-16">
        {onSignOut && (
          <button
            className="self-end text-xs text-muted-foreground hover:text-foreground"
            onClick={onSignOut}
          >
            Sign out
          </button>
        )}

        <motion.div layout className="flex flex-1 flex-col justify-center gap-10">
          <ListingHero onSubmit={runScenario} loading={listingLoading} />

          {listingError && (
            <p className="mx-auto max-w-md text-center text-sm text-destructive">{listingError}</p>
          )}

          {listing && (
            <div className="space-y-6">
              <ListingSummaryCard listing={listing} />
              <div className="grid gap-4 sm:grid-cols-2">
                {AGENTS.map((config, index) => (
                  <AgentCard
                    key={config.account}
                    askingPrice={listing.price}
                    delay={index * 0.08}
                    run={runs[config.account]!}
                  />
                ))}
              </div>
              {!listingLoading && (
                <div className="flex justify-center pt-2">
                  <Button
                    variant="outline"
                    onClick={() => {
                      setListing(undefined);
                      setRuns(initialRuns());
                    }}
                  >
                    Run another
                  </Button>
                </div>
              )}
            </div>
          )}
        </motion.div>
      </div>
    </BeamsBackground>
  );
}
