import { useState } from "react";
import { Checkbox, Field, Row, TextArea, TextInput } from "@/components/ui/field";
import ParticleButton from "@/components/kokonutui/particle-button";
import type { AccountState } from "@/lib/api";

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
  const [percent, setPercent] = useState("85");
  const [amount, setAmount] = useState("");
  const [floor, setFloor] = useState("");
  const [ceiling, setCeiling] = useState("");
  const [note, setNote] = useState("");
  const [priceMatch, setPriceMatch] = useState(false);
  const [everyAgent, setEveryAgent] = useState(false);
  const [perAgent, setPerAgent] = useState<Record<string, string>>({});
  const [comps, setComps] = useState("3");

  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        const overrides = Object.fromEntries(
          Object.entries(perAgent)
            .filter(([, v]) => v.trim() !== "")
            .map(([id, v]) => [id, { percent: v }]),
        );
        onSubmit({
          listings, percent, amount, floor, ceiling, note, priceMatch, everyAgent, comps,
          draftOnly: true,
          ...(Object.keys(overrides).length > 0 ? { perAgent: overrides } : {}),
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
      <Row className="sm:grid-cols-4">
        <Field label="Percent of ask">
          <TextInput type="number" value={percent} onChange={(e) => setPercent(e.target.value)} />
        </Field>
        <Field label="Or fixed $">
          <TextInput type="number" value={amount} onChange={(e) => setAmount(e.target.value)} />
        </Field>
        <Field label="Floor $">
          <TextInput type="number" value={floor} onChange={(e) => setFloor(e.target.value)} />
        </Field>
        <Field label="Ceiling $">
          <TextInput type="number" value={ceiling} onChange={(e) => setCeiling(e.target.value)} />
        </Field>
      </Row>
      <Field label="Note (optional)">
        <TextInput
          placeholder="Can pick up this weekend."
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
      </Field>
      <Row className="sm:grid-cols-3 sm:items-center">
        <Checkbox
          label="Cite cheaper live listings"
          checked={priceMatch}
          onChange={(e) => setPriceMatch(e.target.checked)}
        />
        <Field label="Comps">
          <TextInput type="number" min={1} value={comps} onChange={(e) => setComps(e.target.value)} />
        </Field>
        <Checkbox
          label="Offer from every selected agent"
          checked={everyAgent}
          onChange={(e) => setEveryAgent(e.target.checked)}
        />
      </Row>
      {everyAgent && !amount.trim() && (
        <Field
          label="Percent of ask per agent"
          hint="Each client can offer a different share of the asking price — blank uses the value above."
        >
          <div className="grid gap-2 sm:grid-cols-2">
            {accounts.map((a) => (
              <div key={a.id} className="flex items-center gap-2">
                <span className="w-28 shrink-0 truncate text-xs text-muted-foreground" title={a.email}>
                  {a.label ?? a.id}
                </span>
                <TextInput
                  type="number"
                  min={1}
                  max={100}
                  placeholder={percent || "85"}
                  value={perAgent[a.id] ?? ""}
                  onChange={(e) =>
                    setPerAgent((prev) => ({ ...prev, [a.id]: e.target.value }))
                  }
                />
              </div>
            ))}
          </div>
        </Field>
      )}
      <ParticleButton type="submit" disabled={busy || !listings.trim()}>
        Draft offers
      </ParticleButton>
      <p className="text-xs text-muted-foreground">
        Drafts land in the run panel on the right — send each one from the Message tab after you approve it.
      </p>
    </form>
  );
}
