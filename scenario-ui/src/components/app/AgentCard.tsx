import { useState } from "react";
import { motion } from "motion/react";
import { LiquidGlassCard } from "@/components/kokonutui/liquid-glass-card";
import Loader from "@/components/kokonutui/loader";
import { Button } from "@/components/ui/button";
import { ROLE_LABEL, type AgentRole } from "@/config/agents";
import { formatMoney, percentBelow } from "@/lib/format";
import { useCountUp } from "@/lib/useCountUp";
import {
  readOfferOutcome,
  readPostOutcome,
  type AgentRun,
} from "@/lib/scenario";
import { answerJob } from "@/lib/api";
import { cn } from "@/lib/utils";

/**
 * Written as literal class strings (not template-built) so Tailwind's
 * scanner can see and generate every one of them ahead of time.
 */
const ROLE_STYLES: Record<
  AgentRole,
  { avatar: string; label: string; border: string; glow: string; badge: string }
> = {
  lowball: {
    avatar: "bg-role-lowball/15 text-role-lowball",
    label: "text-role-lowball",
    border: "border-role-lowball/25",
    glow: "shadow-[0_0_40px_-12px_var(--role-lowball)]",
    badge: "bg-role-lowball/15 text-role-lowball",
  },
  fair: {
    avatar: "bg-role-fair/15 text-role-fair",
    label: "text-role-fair",
    border: "border-role-fair/25",
    glow: "shadow-[0_0_40px_-12px_var(--role-fair)]",
    badge: "bg-role-fair/15 text-role-fair",
  },
  poster: {
    avatar: "bg-role-poster/15 text-role-poster",
    label: "text-role-poster",
    border: "border-role-poster/25",
    glow: "shadow-[0_0_40px_-12px_var(--role-poster)]",
    badge: "bg-role-poster/15 text-role-poster",
  },
};

interface AgentCardProps {
  run: AgentRun;
  askingPrice?: number;
  delay?: number;
}

export default function AgentCard({ run, askingPrice, delay = 0 }: AgentCardProps) {
  const style = ROLE_STYLES[run.config.role];
  const isOffer = run.config.role === "lowball" || run.config.role === "fair";
  const offer = isOffer ? readOfferOutcome(run.job) : undefined;
  const post = run.config.role === "poster" ? readPostOutcome(run.job) : undefined;
  const animatedAmount = useCountUp(run.phase === "done" ? offer?.amount : undefined);
  const active = run.phase === "running" || run.phase === "queued";

  return (
    <motion.div
      initial={{ opacity: 0, y: 24, scale: 0.97 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ duration: 0.5, delay, ease: [0.16, 1, 0.3, 1] }}
      className="h-full"
    >
      <LiquidGlassCard
        className={cn(
          "h-full border transition-shadow duration-500",
          style.border,
          active ? style.glow : "shadow-none",
        )}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <span className={cn("flex size-9 shrink-0 items-center justify-center rounded-full text-sm font-semibold", style.avatar)}>
              {run.config.name.slice(0, 1)}
            </span>
            <div>
              <p className="font-medium leading-tight">{run.config.name}</p>
              <p className={cn("text-xs leading-tight", style.label)}>{ROLE_LABEL[run.config.role]}</p>
            </div>
          </div>
          <StatusPill phase={run.phase} />
        </div>

        <div className="mt-5 min-h-[92px]">
          {(run.phase === "idle" || run.phase === "queued") && (
            <p className="text-sm text-muted-foreground">
              {run.phase === "queued" ? "Waiting its turn — one live browser runs at a time." : "Ready."}
            </p>
          )}

          {run.phase === "running" && (
            <Loader
              size="sm"
              title="Working…"
              subtitle="A real browser is doing this live."
              className="items-start gap-3 p-0 text-left"
            />
          )}

          {run.phase === "waiting" && run.job?.prompt && (
            <PromptForm jobId={run.job.id} prompt={run.job.prompt} />
          )}

          {run.phase === "needs-setup" && (
            <p className="text-sm text-muted-foreground">
              {run.setupHint ?? "Needs configuration before it can run."}
            </p>
          )}

          {run.phase === "failed" && (
            <p className="text-sm text-destructive">{run.job?.error ?? "Something went wrong."}</p>
          )}

          {run.phase === "done" && isOffer && offer && (
            <div className="space-y-2">
              <div className="flex items-baseline gap-2">
                {askingPrice !== undefined && (
                  <span className="text-sm text-muted-foreground line-through">{formatMoney(askingPrice)}</span>
                )}
                <span className="text-2xl font-semibold tabular-nums">{formatMoney(animatedAmount)}</span>
              </div>
              {percentBelow(askingPrice, offer.amount) && (
                <span className={cn("inline-block rounded-full px-2 py-0.5 text-xs", style.badge)}>
                  {percentBelow(askingPrice, offer.amount)}
                </span>
              )}
              {offer.message && <p className="text-sm text-muted-foreground">“{offer.message}”</p>}
              <p className="text-xs text-muted-foreground/70">
                {offer.status === "skipped" && offer.reason === "dry run"
                  ? "Drafted and typed — not sent (dry run)."
                  : offer.status === "sent"
                    ? "Sent."
                    : offer.reason}
              </p>
            </div>
          )}

          {run.phase === "done" && post && (
            <div className="space-y-2">
              <p className="text-base font-medium">{post.title}</p>
              <span className={cn("inline-block rounded-full px-2 py-0.5 text-xs", style.badge)}>
                {post.status === "draft-only" ? "Draft ready — not published" : "Published"}
              </span>
            </div>
          )}
        </div>
      </LiquidGlassCard>
    </motion.div>
  );
}

function StatusPill({ phase }: { phase: AgentRun["phase"] }) {
  const label: Record<AgentRun["phase"], string> = {
    idle: "Ready",
    queued: "Queued",
    running: "Running",
    waiting: "Needs input",
    "needs-setup": "Needs setup",
    done: "Done",
    failed: "Failed",
  };
  const dotClass: Record<AgentRun["phase"], string> = {
    idle: "bg-muted-foreground/40",
    queued: "bg-amber-400 animate-pulse",
    running: "bg-primary animate-pulse",
    waiting: "bg-amber-400 animate-pulse",
    "needs-setup": "bg-muted-foreground/40",
    done: "bg-role-fair",
    failed: "bg-destructive",
  };
  return (
    <span className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
      <span className={cn("size-1.5 rounded-full", dotClass[phase])} />
      {label[phase]}
    </span>
  );
}

function PromptForm({ jobId, prompt }: { jobId: string; prompt: { kind: "text" | "confirm"; question: string } }) {
  const [value, setValue] = useState("");
  const [sent, setSent] = useState(false);

  if (sent) {
    return <p className="text-sm text-muted-foreground">Sent — waiting on the agent…</p>;
  }

  return (
    <div className="space-y-2">
      <p className="text-sm">{prompt.question}</p>
      {prompt.kind === "text" ? (
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            setSent(true);
            void answerJob(jobId, { text: value });
          }}
        >
          <input
            autoFocus
            className="w-full rounded-md border border-input bg-background/60 px-2 py-1 text-sm outline-none focus-visible:ring-1 focus-visible:ring-ring"
            onChange={(e) => setValue(e.target.value)}
            placeholder="Code"
            value={value}
          />
          <Button size="sm" type="submit">
            Send
          </Button>
        </form>
      ) : (
        <div className="flex gap-2">
          <Button
            size="sm"
            onClick={() => {
              setSent(true);
              void answerJob(jobId, { approved: true });
            }}
          >
            Approve
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              setSent(true);
              void answerJob(jobId, { approved: false });
            }}
          >
            Decline
          </Button>
        </div>
      )}
    </div>
  );
}
