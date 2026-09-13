import { useState } from "react";
import { Checkbox, Field, TextArea, TextInput } from "@/components/ui/field";
import ParticleButton from "@/components/kokonutui/particle-button";

export default function MessageForm({
  busy,
  onSubmit,
}: {
  busy: boolean;
  onSubmit: (params: Record<string, unknown>) => void;
}) {
  const [listing, setListing] = useState("");
  const [text, setText] = useState("");
  const [dryRun, setDryRun] = useState(true);

  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit({ listing, text, dryRun });
      }}
    >
      <Field label="Listing URL or ad id">
        <TextInput required value={listing} onChange={(e) => setListing(e.target.value)} />
      </Field>
      <Field label="Message">
        <TextArea required rows={5} value={text} onChange={(e) => setText(e.target.value)} />
      </Field>
      <Checkbox label="Dry run" checked={dryRun} onChange={(e) => setDryRun(e.target.checked)} />
      <ParticleButton type="submit" disabled={busy || !listing.trim() || !text.trim()}>
        Send from selected agent
      </ParticleButton>
    </form>
  );
}
