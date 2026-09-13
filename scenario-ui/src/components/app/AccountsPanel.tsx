import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import type { AccountState, Limits } from "@/lib/api";

export default function AccountsPanel({
  accounts,
  limits,
  selected,
  onToggle,
  onSignIn,
  signingIn,
}: {
  accounts: AccountState[];
  limits?: Limits;
  selected: Set<string>;
  onToggle: (id: string) => void;
  onSignIn: () => void;
  signingIn: boolean;
}) {
  return (
    <Card className="h-fit">
      <CardHeader>
        <CardTitle>Agents</CardTitle>
        {limits && (
          <p className="text-xs text-muted-foreground">
            {accounts.length} agent{accounts.length === 1 ? "" : "s"} · {limits.maxMessagesPerAccountPerDay}{" "}
            messages/account/day · {limits.minSecondsBetweenMessages}s between sends ·{" "}
            {limits.maxConcurrentAgents} browsers at once
          </p>
        )}
      </CardHeader>
      <CardContent className="space-y-3">
        <ul className="space-y-2">
          {accounts.length === 0 && (
            <li className="text-sm text-muted-foreground">No accounts configured.</li>
          )}
          {accounts.map((account) => (
            <li key={account.id}>
              <label className="flex cursor-pointer items-start gap-2.5 rounded-lg border border-transparent p-2 text-sm hover:border-border hover:bg-muted/40">
                <input
                  type="checkbox"
                  className="mt-0.5 size-4 rounded border-input accent-primary"
                  checked={selected.has(account.id)}
                  onChange={() => onToggle(account.id)}
                />
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1.5">
                    <span className="truncate font-medium">{account.label ?? account.id}</span>
                    <span
                      className={
                        "size-1.5 shrink-0 rounded-full " +
                        (account.signedIn ? "bg-emerald-500" : "bg-muted-foreground/40")
                      }
                      title={account.signedIn ? "signed in" : "not signed in"}
                    />
                  </span>
                  <span className="block text-xs text-muted-foreground/80">{account.session}</span>
                </span>
              </label>
            </li>
          ))}
        </ul>
        <Button
          variant="secondary"
          className="w-full"
          onClick={onSignIn}
          disabled={signingIn || accounts.length === 0}
        >
          {signingIn ? "Signing in…" : "Sign in selected"}
        </Button>
      </CardContent>
    </Card>
  );
}
