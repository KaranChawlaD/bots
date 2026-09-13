import type { AgentConfig } from "@/config/agents";
import type { Job } from "@/lib/api";

export type AgentPhase =
  | "idle"
  | "queued"
  | "running"
  | "waiting"
  | "needs-setup"
  | "done"
  | "failed";

export interface OfferOutcome {
  account: string;
  listing: string;
  amount?: number;
  message?: string;
  status?: string;
  reason?: string;
}

export interface PostOutcome {
  status: "posted" | "draft-only";
  url: string;
  title: string;
  account: string;
}

export interface AgentRun {
  config: AgentConfig;
  phase: AgentPhase;
  job?: Job;
  setupHint?: string;
}

export function readOfferOutcome(job: Job | undefined): OfferOutcome | undefined {
  const outcomes = job?.result as OfferOutcome[] | undefined;
  return Array.isArray(outcomes) ? outcomes[0] : undefined;
}

export function readPostOutcome(job: Job | undefined): PostOutcome | undefined {
  return job?.result as PostOutcome | undefined;
}
