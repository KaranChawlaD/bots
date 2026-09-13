import { useState } from "react";
import { motion } from "motion/react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { TextInput } from "@/components/ui/field";
import ResultView from "@/components/app/ResultView";
import { answerJob, type Job } from "@/lib/api";
import { cn } from "@/lib/utils";

const statusStyle: Record<Job["status"], string> = {
  queued: "bg-muted text-muted-foreground",
  running: "bg-blue-500/15 text-blue-600 dark:text-blue-400",
  waiting: "bg-amber-500/15 text-amber-600 dark:text-amber-400",
  done: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400",
  failed: "bg-destructive/15 text-destructive",
};

const levelStyle: Record<string, string> = {
  info: "text-foreground/80",
  success: "text-emerald-600 dark:text-emerald-400",
  warn: "text-amber-600 dark:text-amber-400",
  error: "text-destructive",
  debug: "text-muted-foreground/60",
};

function Prompt({ job, onAnswered }: { job: Job; onAnswered: () => void }) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const prompt = job.prompt!;

  async function send(answer: { text: string } | { approved: boolean }) {
    setBusy(true);
    try {
      await answerJob(job.id, answer);
      onAnswered();
    } finally {
      setBusy(false);
    }
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: -8 }}
      animate={{ opacity: 1, y: 0 }}
      className="space-y-2 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3"
    >
      <pre className="whitespace-pre-wrap text-sm text-foreground">{prompt.question}</pre>
      {prompt.kind === "confirm" ? (
        <div className="flex gap-2">
          <Button size="sm" disabled={busy} onClick={() => send({ approved: true })}>
            Approve
          </Button>
          <Button size="sm" variant="ghost" disabled={busy} onClick={() => send({ approved: false })}>
            Cancel
          </Button>
        </div>
      ) : (
        <div className="flex gap-2">
          <TextInput
            autoFocus
            placeholder="code"
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && send({ text })}
          />
          <Button size="sm" disabled={busy} onClick={() => send({ text })}>
            Submit
          </Button>
        </div>
      )}
    </motion.div>
  );
}

export default function JobConsole({
  job,
  onPromptAnswered,
  onOpenListing,
  onDraftOffer,
  onSendOffer,
}: {
  job?: Job;
  onPromptAnswered: () => void;
  onOpenListing?: (url: string) => void;
  onDraftOffer?: (url: string) => void;
  onSendOffer?: (draft: { listing: string; text: string; account?: string }) => void;
}) {
  return (
    <Card className="flex h-full flex-col">
      <CardHeader>
        <div className="flex items-center justify-between gap-2">
          <CardTitle>Run</CardTitle>
          {job && (
            <span className={cn("rounded-full px-2.5 py-0.5 text-xs font-medium", statusStyle[job.status])}>
              {job.status}
            </span>
          )}
        </div>
        {job && <p className="truncate text-xs text-muted-foreground">{job.label}</p>}
      </CardHeader>
      <CardContent className="flex flex-1 flex-col gap-3">
        {!job && <p className="text-sm text-muted-foreground">Run a command to see it here.</p>}

        {job?.prompt && <Prompt job={job} onAnswered={onPromptAnswered} />}

        {job && job.lines.length > 0 && (
          <div className="max-h-56 space-y-0.5 overflow-auto rounded-lg bg-muted/30 p-3 font-mono text-xs">
            {job.lines
              .filter((line) => line.level !== "debug")
              .map((line, i) => (
                <div key={i} className={levelStyle[line.level] ?? "text-foreground/80"}>
                  <span className="text-muted-foreground/70">
                    {line.at.slice(11, 19)} [{line.scope}]
                  </span>{" "}
                  {line.message}
                </div>
              ))}
          </div>
        )}

        {job?.status === "failed" && <p className="text-sm text-destructive">{job.error}</p>}
        {job?.status === "done" && (
          <ResultView
            result={job.result}
            onOpenListing={onOpenListing}
            onDraftOffer={onDraftOffer}
            onSendOffer={onSendOffer}
          />
        )}
      </CardContent>
    </Card>
  );
}
