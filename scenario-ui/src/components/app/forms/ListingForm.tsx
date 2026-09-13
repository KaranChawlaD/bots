import { useState } from "react";
import { Field, Select, TextInput } from "@/components/ui/field";
import ParticleButton from "@/components/kokonutui/particle-button";
import type { AccountState } from "@/lib/api";

export default function ListingForm({
  busy,
  accounts,
  listing,
  onListingChange,
  onSubmit,
}: {
  busy: boolean;
  accounts: AccountState[];
  listing: string;
  onListingChange: (value: string) => void;
  onSubmit: (params: Record<string, unknown>) => void;
}) {
  const [account, setAccount] = useState("");
  const chosen = accounts.some((a) => a.id === account) ? account : (accounts[0]?.id ?? "");

  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit({ listing, account: chosen });
      }}
    >
      <Field label="Listing URL or ad id">
        <TextInput
          required
          placeholder="https://www.kijiji.ca/v-view-details.html?adId=1700000000"
          value={listing}
          onChange={(e) => onListingChange(e.target.value)}
        />
      </Field>
      <Field label="Agent" hint="Viewing runs on one browser — pick which account opens it.">
        <Select value={chosen} onChange={(e) => setAccount(e.target.value)}>
          {accounts.map((a) => (
            <option key={a.id} value={a.id}>
              {a.label ?? a.id} — {a.email}
            </option>
          ))}
        </Select>
      </Field>
      <ParticleButton type="submit" disabled={busy || !listing.trim() || !chosen}>
        Open listing
      </ParticleButton>
    </form>
  );
}
