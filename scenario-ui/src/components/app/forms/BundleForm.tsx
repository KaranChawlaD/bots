import { useState } from "react";
import { Checkbox, Field, Row, Select, TextInput } from "@/components/ui/field";
import ParticleButton from "@/components/kokonutui/particle-button";
import type { AccountState } from "@/lib/api";

interface BuyerFields {
  percent: string;
  cite: boolean;
}

/** The usual buyers come pre-priced; clearing the field sits one out. */
const DEFAULT_PERCENT: Record<string, string> = {
  primary: "75",
  tertiary: "50",
};

export default function BundleForm({
  busy,
  accounts,
  onSubmit,
}: {
  busy: boolean;
  accounts: AccountState[];
  onSubmit: (params: Record<string, unknown>) => void;
}) {
  const [source, setSource] = useState("");
  const [seller, setSeller] = useState("");
  const [price, setPrice] = useState("");
  const [reusePhotos, setReusePhotos] = useState(true);
  const [fields, setFields] = useState<Record<string, BuyerFields>>({});

  // "Quaternary" is the usual seller; anything valid the picker was left on wins.
  const sellerId = accounts.some((a) => a.id === seller)
    ? seller
    : (accounts.find((a) => a.id === "quaternary")?.id ?? accounts[0]?.id ?? "");
  const buyers = accounts.filter((a) => a.id !== sellerId);

  const fieldFor = (id: string): BuyerFields =>
    fields[id] ?? { percent: DEFAULT_PERCENT[id] ?? "", cite: false };
  const update = (id: string, patch: Partial<BuyerFields>) =>
    setFields((prev) => ({ ...prev, [id]: { ...fieldFor(id), ...patch } }));

  // A buyer with a blank percent sits this one out.
  const interested = buyers.filter((a) => fieldFor(a.id).percent.trim() !== "");

  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        const perAgent = Object.fromEntries(
          interested.map((a) => [
            a.id,
            { percent: fieldFor(a.id).percent, priceMatch: fieldFor(a.id).cite },
          ]),
        );
        onSubmit({
          sourceListing: source,
          sellerAccount: sellerId,
          price,
          reusePhotos,
          perAgent,
          accounts: interested.map((a) => a.id),
        });
      }}
    >
      <Field
        label="Source listing"
        hint="The seller clones and publishes it; each buyer offers on the original ad."
      >
        <TextInput
          required
          placeholder="https://www.kijiji.ca/v-general-electronics/…/1700000000"
          value={source}
          onChange={(e) => setSource(e.target.value)}
        />
      </Field>

      <Row className="sm:grid-cols-2">
        <Field label="Sell it as">
          <Select value={sellerId} onChange={(e) => setSeller(e.target.value)}>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.label ?? a.id}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Their price" hint="Never copied from the source ad.">
          <TextInput
            required
            placeholder="45 / free / contact"
            value={price}
            onChange={(e) => setPrice(e.target.value)}
          />
        </Field>
      </Row>
      <Checkbox
        label="Reuse the source listing's photos"
        checked={reusePhotos}
        onChange={(e) => setReusePhotos(e.target.checked)}
      />

      {buyers.map((a) => {
        const f = fieldFor(a.id);
        return (
          <div key={a.id} className="space-y-3 rounded-lg border border-border p-3">
            <p className="text-sm font-medium text-foreground/90">{a.label ?? a.id}</p>
            <Field label="Percent of ask">
              <TextInput
                type="number"
                min={1}
                placeholder="—"
                value={f.percent}
                onChange={(e) => update(a.id, { percent: e.target.value })}
              />
            </Field>
            <Checkbox
              label="Cite cheaper live listings"
              checked={f.cite}
              onChange={(e) => update(a.id, { cite: e.target.checked })}
            />
          </div>
        );
      })}

      <ParticleButton
        type="submit"
        disabled={busy || !source.trim() || !price.trim() || !sellerId || interested.length === 0}
      >
        Run the bundle
      </ParticleButton>
      <p className="text-xs text-muted-foreground">
        One click does it all — the clone is published and each buyer's offer is sent, no further
        approval. A buyer with a blank percent sits out.
      </p>
    </form>
  );
}
