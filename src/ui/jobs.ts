import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { projectRoot } from "../config.js";
import { addLogSink, type LogLine } from "../log.js";
import { setPrompter } from "../safety.js";
import { describe } from "../steel/agent.js";

export type JobStatus = "queued" | "running" | "waiting" | "done" | "failed";

export interface JobPrompt {
  kind: "text" | "confirm";
  question: string;
}

export interface Job {
  id: string;
  type: string;
  label: string;
  status: JobStatus;
  lines: LogLine[];
  prompt?: JobPrompt;
  result?: unknown;
  error?: string;
  createdAt: string;
  finishedAt?: string;
}

type Answer = { text: string } | { approved: boolean };

interface JobState extends Job {
  resolvePrompt?: (answer: Answer) => void;
}

const jobs = new Map<string, JobState>();
const order: string[] = [];
/** One job at a time: every job opens cloud browsers that cost money. */
const queue: Array<() => Promise<void>> = [];
let busy = false;

export function listJobs(limit = 20): Job[] {
  return order
    .slice(-limit)
    .reverse()
    .map((id) => publicJob(jobs.get(id)!));
}

export function getJob(id: string): Job | undefined {
  const job = jobs.get(id);
  return job ? publicJob(job) : undefined;
}

function publicJob(job: JobState): Job {
  const { resolvePrompt: _ignored, ...rest } = job;
  return rest;
}

export function startJob(
  type: string,
  label: string,
  run: () => Promise<unknown>,
): Job {
  const job: JobState = {
    id: randomUUID(),
    type,
    label,
    status: "queued",
    lines: [],
    createdAt: new Date().toISOString(),
  };
  jobs.set(job.id, job);
  order.push(job.id);

  queue.push(async () => {
    job.status = "running";
    const stopLogging = addLogSink((line) => {
      job.lines.push(line);
      if (job.lines.length > 500) job.lines.shift();
    });
    setPrompter({
      ask: (question) => waitForAnswer(job, { kind: "text", question }).then(readText),
      confirm: (question) => waitForAnswer(job, { kind: "confirm", question }).then(readApproved),
    });
    try {
      job.result = await run();
      job.status = "done";
    } catch (error) {
      job.error = describe(error);
      job.status = "failed";
    } finally {
      persistJob(job);
      setPrompter(undefined);
      stopLogging();
      delete job.prompt;
      delete job.resolvePrompt;
      job.finishedAt = new Date().toISOString();
    }
  });
  void drain();
  return publicJob(job);
}

async function drain(): Promise<void> {
  if (busy) return;
  busy = true;
  try {
    for (let next = queue.shift(); next; next = queue.shift()) {
      await next();
    }
  } finally {
    busy = false;
  }
}

function waitForAnswer(job: JobState, prompt: JobPrompt): Promise<Answer> {
  job.prompt = prompt;
  job.status = "waiting";
  return new Promise<Answer>((resolve) => {
    job.resolvePrompt = (answer) => {
      delete job.prompt;
      delete job.resolvePrompt;
      job.status = "running";
      resolve(answer);
    };
  });
}

function readText(answer: Answer): string {
  return "text" in answer ? answer.text : "";
}

function readApproved(answer: Answer): boolean {
  return "approved" in answer ? answer.approved : false;
}

/** Finished jobs outlive the process — the log is the only post-mortem we get. */
function persistJob(job: JobState): void {
  try {
    const dir = resolve(projectRoot, "data/jobs");
    mkdirSync(dir, { recursive: true });
    writeFileSync(resolve(dir, `${job.id}.json`), JSON.stringify(publicJob(job), null, 2));
  } catch {
    // Persistence is diagnostic only — never let it sink a finished job.
  }
}

export function answerJob(id: string, answer: Answer): boolean {
  const job = jobs.get(id);
  if (!job?.resolvePrompt) return false;
  job.resolvePrompt(answer);
  return true;
}
