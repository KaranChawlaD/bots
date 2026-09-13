import { useState } from "react";
import { Checkbox, Field, Row, TextArea, TextInput } from "@/components/ui/field";
import ParticleButton from "@/components/kokonutui/particle-button";

export default function OfferForm({
  busy,
  onSubmit,
}: {
  busy: boolean;
  onSubmit: (params: Record<string, unknown>) => void;
}) {
  const [listings, setListings] = useState("");
  const [percent, setPercent] = useState("85");
  const [amount, setAmount] = useState("");
  const [floor, setFloor] = useState("");
  const [ceiling, setCeiling] = useState("");
  const [note, setNote] = useState("");
  const [priceMatch, setPriceMatch] = useState(false);
  const [comps, setComps] = useState("3");
  const [dryRun, setDryRun] = useState(true);

  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit({ listings, percent, amount, floor, ceiling, note, priceMatch, comps, dryRun });
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
        <Checkbox label="Dry run" checked={dryRun} onChange={(e) => setDryRun(e.target.checked)} />
      </Row>
      <ParticleButton type="submit" disabled={busy || !listings.trim()}>
        Draft offers
      </ParticleButton>
      <p className="text-xs text-muted-foreground">
        Each send is shown to you for approval before it goes out.
      </p>
    </form>
  );
}
