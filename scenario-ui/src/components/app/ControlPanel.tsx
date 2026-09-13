import { useCallback, useEffect, useRef, useState } from "react";
import BeamsBackground from "@/components/kokonutui/beams-background";
import { Card, CardContent } from "@/components/ui/card";
import { TabBar } from "@/components/ui/tabs";
import AccountsPanel from "@/components/app/AccountsPanel";
import JobConsole from "@/components/app/JobConsole";
import HistoryPanel from "@/components/app/HistoryPanel";
import SearchForm from "@/components/app/forms/SearchForm";
import ListingForm from "@/components/app/forms/ListingForm";
import OfferForm from "@/components/app/forms/OfferForm";
import MessageForm from "@/components/app/forms/MessageForm";
import PostForm from "@/components/app/forms/PostForm";
import { getJob, getState, startJob, type AppState, type Job } from "@/lib/api";

const TABS = [
  { id: "search", label: "Search" },
  { id: "view", label: "Listing" },
  { id: "offer", label: "Offer" },
  { id: "message", label: "Message" },
  { id: "post", label: "Post" },
  { id: "history", label: "History" },
];

export default function ControlPanel({ onSignOut }: { onSignOut?: () => void }) {
  const [state, setState] = useState<AppState>();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [tab, setTab] = useState("search");
  const [job, setJob] = useState<Job>();
  const [signingIn, setSigningIn] = useState(false);
  const pollTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const refreshState = useCallback(async () => {
    const next = await getState();
    setState(next);
    setSelected((prev) => (prev.size === 0 ? new Set(next.accounts.map((a) => a.id)) : prev));
  }, []);

  useEffect(() => {
    void refreshState();
    const interval = setInterval(() => void refreshState(), 15_000);
    return () => clearInterval(interval);
  }, [refreshState]);

  useEffect(() => () => clearTimeout(pollTimer.current), []);

  function trackJob(id: string) {
    const poll = async () => {
      const updated = await getJob(id);
      setJob(updated);
      if (updated.status === "done" || updated.status === "failed") {
        void refreshState();
        return;
      }
      pollTimer.current = setTimeout(poll, 900);
    };
    clearTimeout(pollTimer.current);
    pollTimer.current = setTimeout(poll, 900);
  }

  async function run(type: string, params: Record<string, unknown>) {
    const started = await startJob(type, { ...params, accounts: Array.from(selected) });
    setJob(started);
    trackJob(started.id);
  }

  function toggleAccount(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function signIn() {
    setSigningIn(true);
    try {
      await run("login", {});
    } finally {
      setSigningIn(false);
    }
  }

  const busy = job?.status === "queued" || job?.status === "running" || job?.status === "waiting";

  return (
    <BeamsBackground className="bg-background" intensity="subtle">
      <div className="mx-auto flex min-h-screen w-full max-w-6xl flex-col gap-6 px-4 py-8 md:py-12">
        <header className="flex items-center justify-between">
          <h1 className="bg-gradient-to-r from-foreground to-foreground/60 bg-clip-text text-2xl font-semibold text-transparent">
            kijiji agents
          </h1>
          {onSignOut && (
            <button
              className="text-xs text-muted-foreground hover:text-foreground"
              onClick={onSignOut}
            >
              Sign out
            </button>
          )}
        </header>

        <div className="grid flex-1 gap-6 lg:grid-cols-[260px_1fr_340px]">
          <AccountsPanel
            accounts={state?.accounts ?? []}
            limits={state?.limits}
            selected={selected}
            onToggle={toggleAccount}
            onSignIn={signIn}
            signingIn={signingIn}
          />

          <Card>
            <CardContent className="space-y-4 pt-1">
              <TabBar tabs={TABS} active={tab} onChange={setTab} />

              {tab === "search" && <SearchForm busy={busy} onSubmit={(p) => run("search", p)} />}
              {tab === "view" && <ListingForm busy={busy} onSubmit={(p) => run("view", p)} />}
              {tab === "offer" && <OfferForm busy={busy} onSubmit={(p) => run("offer", p)} />}
              {tab === "message" && <MessageForm busy={busy} onSubmit={(p) => run("message", p)} />}
              {tab === "post" && <PostForm busy={busy} onSubmit={(p) => run("post", p)} />}
              {tab === "history" && <HistoryPanel history={state?.history ?? []} />}
            </CardContent>
          </Card>

          <JobConsole job={job} onPromptAnswered={() => job && trackJob(job.id)} />
        </div>
      </div>
    </BeamsBackground>
  );
}
