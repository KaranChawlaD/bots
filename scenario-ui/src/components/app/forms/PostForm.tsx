import { useState } from "react";
import { Checkbox, Field, Row, Select, TextArea, TextInput } from "@/components/ui/field";
import ParticleButton from "@/components/kokonutui/particle-button";
import type { AccountState } from "@/lib/api";

export default function PostForm({
  busy,
  accounts,
  onSubmit,
}: {
  busy: boolean;
  accounts: AccountState[];
  onSubmit: (params: Record<string, unknown>) => void;
}) {
  const [source, setSource] = useState("");
  const [reusePhotos, setReusePhotos] = useState(true);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [price, setPrice] = useState("");
  const [location, setLocation] = useState("");
  const [locationId, setLocationId] = useState("");
  const [category, setCategory] = useState("");
  const [photos, setPhotos] = useState("");
  const [dryRun, setDryRun] = useState(true);
  const [account, setAccount] = useState("");
  const chosen = accounts.some((a) => a.id === account) ? account : (accounts[0]?.id ?? "");
  const cloning = source.trim() !== "";
  const copied = cloning ? "Blank copies the source ad." : undefined;

  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit({
          sourceListing: source,
          reusePhotos,
          title,
          description,
          price,
          location,
          locationId,
          category,
          photos,
          dryRun,
          account: chosen,
        });
      }}
    >
      <Field
        label="Source listing"
        hint="Paste an existing ad to clone it — anything left blank below is copied from it, except the price."
      >
        <TextInput
          placeholder="https://www.kijiji.ca/v-view-details.html?adId=1700000000"
          value={source}
          onChange={(e) => setSource(e.target.value)}
        />
      </Field>
      <Field label="Title" hint={copied}>
        <TextInput required={!cloning} value={title} onChange={(e) => setTitle(e.target.value)} />
      </Field>
      <Field label="Description" hint={copied}>
        <TextArea required={!cloning} rows={4} value={description} onChange={(e) => setDescription(e.target.value)} />
      </Field>
      <Row className="sm:grid-cols-3">
        <Field label="Price" hint={cloning ? "Always your own." : undefined}>
          <TextInput
            required
            placeholder="45 / free / contact"
            value={price}
            onChange={(e) => setPrice(e.target.value)}
          />
        </Field>
        <Field label="Location" hint={copied}>
          <TextInput
            required={!cloning}
            placeholder="M5V 2T6"
            value={location}
            onChange={(e) => setLocation(e.target.value)}
          />
        </Field>
        <Field label="Location id">
          <TextInput placeholder="1700273" value={locationId} onChange={(e) => setLocationId(e.target.value)} />
        </Field>
      </Row>
      <Field label="Category" hint={copied}>
        <TextInput
          required={!cloning}
          placeholder="Buy & Sell > Video Games & Consoles > Nintendo Switch"
          value={category}
          onChange={(e) => setCategory(e.target.value)}
        />
      </Field>
      <Field
        label="Photos (paths, one per line)"
        hint={cloning ? "Your own paths win over the source ad's photos." : undefined}
      >
        <TextArea rows={2} value={photos} onChange={(e) => setPhotos(e.target.value)} />
      </Field>
      {cloning && (
        <Checkbox
          label="Reuse the source listing's photos"
          checked={reusePhotos}
          onChange={(e) => setReusePhotos(e.target.checked)}
        />
      )}
      <Field label="Post as" hint="The ad is published on one account — pick which.">
        <Select value={chosen} onChange={(e) => setAccount(e.target.value)}>
          {accounts.map((a) => (
            <option key={a.id} value={a.id}>
              {a.label ?? a.id}
            </option>
          ))}
        </Select>
      </Field>
      <Checkbox label="Dry run" checked={dryRun} onChange={(e) => setDryRun(e.target.checked)} />
      <ParticleButton
        type="submit"
        disabled={busy || !chosen || (!cloning && (!title.trim() || !category.trim()))}
      >
        Fill the ad form
      </ParticleButton>
      <p className="text-xs text-muted-foreground">Publishing asks for your approval first.</p>
    </form>
  );
}
