import { useState } from "react";
import { Checkbox, Field, Select, TextArea, TextInput } from "@/components/ui/field";
import ParticleButton from "@/components/kokonutui/particle-button";
import type { AccountState } from "@/lib/api";

export default function MessageForm({
  busy,
  accounts,
  onSubmit,
}: {
  busy: boolean;
  accounts: AccountState[];
  onSubmit: (params: Record<string, unknown>) => void;
}) {
  const [listing, setListing] = useState("");
  const [text, setText] = useState("");
  const [dryRun, setDryRun] = useState(true);
  const [account, setAccount] = useState("");
  const chosen = accounts.some((a) => a.id === account) ? account : (accounts[0]?.id ?? "");

  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit({ listing, text, dryRun, account: chosen });
      }}
    >
      <Field label="Listing URL or ad id">
        <TextInput required value={listing} onChange={(e) => setListing(e.target.value)} />
      </Field>
      <Field label="Message">
        <TextArea required rows={5} value={text} onChange={(e) => setText(e.target.value)} />
      </Field>
      <Field label="Send from" hint="Messages go out from one account — pick which.">
        <Select value={chosen} onChange={(e) => setAccount(e.target.value)}>
          {accounts.map((a) => (
            <option key={a.id} value={a.id}>
              {a.label ?? a.id} — {a.email}
            </option>
          ))}
        </Select>
      </Field>
      <Checkbox label="Dry run" checked={dryRun} onChange={(e) => setDryRun(e.target.checked)} />
      <ParticleButton type="submit" disabled={busy || !listing.trim() || !text.trim() || !chosen}>
        Send message
      </ParticleButton>
    </form>
  );
}
