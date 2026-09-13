/**
 * Thin client for the real control panel API (src/ui/server.ts). This app
 * adds no backend of its own — every job below runs on your actual Kijiji
 * accounts through the existing job queue.
 */

export interface JobLine {
  at: string;
  level: "info" | "warn" | "error" | "debug" | "success";
  scope: string;
  message: string;
}

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
  lines: JobLine[];
  prompt?: JobPrompt;
  result?: unknown;
  error?: string;
  createdAt: string;
  finishedAt?: string;
}

export interface AccountState {
  id: string;
  email: string;
  label?: string;
  session: string;
  signedIn: boolean;
}

export interface SendRecord {
  sentAt: string;
  accountId: string;
  listingUrl: string;
  preview: string;
}

export interface Limits {
  minSecondsBetweenMessages: number;
  maxMessagesPerAccountPerDay: number;
  maxConcurrentAgents: number;
}

export interface AppState {
  accounts: AccountState[];
  limits: Limits;
  history: SendRecord[];
}

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: { "content-type": "application/json", ...init?.headers },
    credentials: "same-origin",
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(
      (body as { error?: string }).error ?? `${path} failed (${res.status})`,
    );
  }
  return res.json() as Promise<T>;
}

export function getAuth(): Promise<{ passwordRequired: boolean; authed: boolean }> {
  return api("/api/auth");
}

export async function login(password: string): Promise<void> {
  await api("/api/login", { method: "POST", body: JSON.stringify({ password }) });
}

export async function logout(): Promise<void> {
  await api("/api/logout", { method: "POST" });
}

export function getState(): Promise<AppState> {
  return api("/api/state");
}

export function startJob(type: string, params: Record<string, unknown>): Promise<Job> {
  return api("/api/jobs", { method: "POST", body: JSON.stringify({ type, params }) });
}

export function getJob(id: string): Promise<Job> {
  return api(`/api/jobs/${id}`);
}

export function answerJob(id: string, answer: { text: string } | { approved: boolean }): Promise<{ answered: boolean }> {
  return api(`/api/jobs/${id}/answer`, { method: "POST", body: JSON.stringify(answer) });
}

/** Polls a job to completion, calling `onUpdate` after every poll. */
export async function runJob(
  type: string,
  params: Record<string, unknown>,
  onUpdate?: (job: Job) => void,
): Promise<Job> {
  let job = await startJob(type, params);
  onUpdate?.(job);
  while (job.status === "queued" || job.status === "running" || job.status === "waiting") {
    await new Promise((resolve) => setTimeout(resolve, 900));
    job = await getJob(job.id);
    onUpdate?.(job);
  }
  return job;
}
