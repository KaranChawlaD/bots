import { useState } from "react";
import { Checkbox, Field, Row, TextArea, TextInput } from "@/components/ui/field";
import ParticleButton from "@/components/kokonutui/particle-button";
import type { AccountState } from "@/lib/api";

interface AgentFields {
  percent: string;
  amount: string;
  cite: boolean;
}

const EMPTY: AgentFields = { percent: "", amount: "", cite: false };

export default function OfferForm({
  busy,
  accounts,
  initialListings = "",
  onSubmit,
}: {
  busy: boolean;
  accounts: AccountState[];
  initialListings?: string;
  onSubmit: (params: Record<string, unknown>) => void;
}) {
  const [listings, setListings] = useState(initialListings);
  const [fields, setFields] = useState<Record<string, AgentFields>>({});

  const fieldFor = (id: string): AgentFields => fields[id] ?? EMPTY;
  const update = (id: string, patch: Partial<AgentFields>) =>
    setFields((prev) => ({ ...prev, [id]: { ...fieldFor(id), ...patch } }));

  // Blank percent AND blank fixed means that agent isn't interested — no draft.
  const interested = accounts.filter((a) => {
    const f = fieldFor(a.id);
    return f.percent.trim() !== "" || f.amount.trim() !== "";
  });

  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        const perAgent = Object.fromEntries(
          interested.map((a) => {
            const f = fieldFor(a.id);
            return [
              a.id,
              {
                ...(f.percent.trim() ? { percent: f.percent } : {}),
                ...(f.amount.trim() ? { amount: f.amount } : {}),
                priceMatch: f.cite,
              },
            ];
          }),
        );
        onSubmit({
          listings,
          accounts: interested.map((a) => a.id),
          perAgent,
          everyAgent: true,
          draftOnly: true,
        });
      }}
    >
      <Field label="Listings (one per line)">
        <TextArea
          required
          rows={3}
          placeholder={"https://www.kijiji.ca/v-view-details.html?adId=1700000000"}
          value={listings}
          onChange={(e) => setListings(e.target.value)}
        />
      </Field>

      {accounts.map((a) => {
        const f = fieldFor(a.id);
        return (
          <div key={a.id} className="space-y-3 rounded-lg border border-border p-3">
            <div>
              <p className="text-sm font-medium text-foreground/90">{a.label ?? a.id}</p>
            </div>
            <Row className="sm:grid-cols-2">
              <Field label="Percent of ask">
                <TextInput
                  type="number"
                  min={1}
                  placeholder="—"
                  value={f.percent}
                  onChange={(e) => update(a.id, { percent: e.target.value })}
                />
              </Field>
              <Field label="Fixed $">
                <TextInput
                  type="number"
                  min={1}
                  placeholder="—"
                  value={f.amount}
                  onChange={(e) => update(a.id, { amount: e.target.value })}
                />
              </Field>
            </Row>
            <Checkbox
              label="Cite cheaper live listings"
              checked={f.cite}
              onChange={(e) => update(a.id, { cite: e.target.checked })}
            />
          </div>
        );
      })}

      <ParticleButton type="submit" disabled={busy || !listings.trim() || interested.length === 0}>
        Draft offers
      </ParticleButton>
      <p className="text-xs text-muted-foreground">
        An agent with both fields blank sits this one out. Drafts land in the run panel on the
        right — send each one from the Message tab, or hit Send all to send them all.
      </p>
    </form>
  );
}
