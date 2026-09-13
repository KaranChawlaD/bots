import { useState } from "react";
import { motion } from "motion/react";
import { LiquidGlassCard } from "@/components/kokonutui/liquid-glass-card";
import { Button } from "@/components/ui/button";
import { login } from "@/lib/api";

export default function PasswordGate({ onSignedIn }: { onSignedIn: () => void }) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(undefined);
    try {
      await login(password);
      onSignedIn();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sign-in failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <motion.div
        initial={{ opacity: 0, y: 16, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
      >
        <LiquidGlassCard className="w-80 border border-white/10">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">Kijiji Agents</p>
          <h1 className="mt-1 text-lg font-semibold">Sign in to continue</h1>
          <form className="mt-4 space-y-3" onSubmit={submit}>
            <input
              autoFocus
              className="w-full rounded-md border border-input bg-background/60 px-3 py-2 text-sm outline-none focus-visible:ring-1 focus-visible:ring-ring"
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Control panel password"
              type="password"
              value={password}
            />
            {error && <p className="text-sm text-destructive">{error}</p>}
            <Button className="w-full" disabled={busy || !password} type="submit">
              {busy ? "Signing in…" : "Sign in"}
            </Button>
          </form>
        </LiquidGlassCard>
      </motion.div>
    </div>
  );
}
