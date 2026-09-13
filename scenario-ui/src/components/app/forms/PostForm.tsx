import { useState } from "react";
import { Checkbox, Field, Row, TextArea, TextInput } from "@/components/ui/field";
import ParticleButton from "@/components/kokonutui/particle-button";

export default function PostForm({
  busy,
  onSubmit,
}: {
  busy: boolean;
  onSubmit: (params: Record<string, unknown>) => void;
}) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [price, setPrice] = useState("");
  const [location, setLocation] = useState("");
  const [locationId, setLocationId] = useState("");
  const [category, setCategory] = useState("");
  const [photos, setPhotos] = useState("");
  const [dryRun, setDryRun] = useState(true);

  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit({ title, description, price, location, locationId, category, photos, dryRun });
      }}
    >
      <Field label="Title">
        <TextInput required value={title} onChange={(e) => setTitle(e.target.value)} />
      </Field>
      <Field label="Description">
        <TextArea required rows={4} value={description} onChange={(e) => setDescription(e.target.value)} />
      </Field>
      <Row className="sm:grid-cols-3">
        <Field label="Price">
          <TextInput
            required
            placeholder="45 / free / contact"
            value={price}
            onChange={(e) => setPrice(e.target.value)}
          />
        </Field>
        <Field label="Location">
          <TextInput
            required
            placeholder="M5V 2T6"
            value={location}
            onChange={(e) => setLocation(e.target.value)}
          />
        </Field>
        <Field label="Location id">
          <TextInput placeholder="1700273" value={locationId} onChange={(e) => setLocationId(e.target.value)} />
        </Field>
      </Row>
      <Field label="Category">
        <TextInput
          required
          placeholder="Buy & Sell > Video Games & Consoles > Nintendo Switch"
          value={category}
          onChange={(e) => setCategory(e.target.value)}
        />
      </Field>
      <Field label="Photos (paths, one per line)">
        <TextArea rows={2} value={photos} onChange={(e) => setPhotos(e.target.value)} />
      </Field>
      <Checkbox label="Dry run" checked={dryRun} onChange={(e) => setDryRun(e.target.checked)} />
      <ParticleButton type="submit" disabled={busy || !title.trim() || !category.trim()}>
        Fill the ad form
      </ParticleButton>
      <p className="text-xs text-muted-foreground">Publishing asks for your approval first.</p>
    </form>
  );
}
