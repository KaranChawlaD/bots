import { useState } from "react";
import { Field, TextInput } from "@/components/ui/field";
import ParticleButton from "@/components/kokonutui/particle-button";

export default function ListingForm({
  busy,
  onSubmit,
}: {
  busy: boolean;
  onSubmit: (params: Record<string, unknown>) => void;
}) {
  const [listing, setListing] = useState("");

  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit({ listing });
      }}
    >
      <Field label="Listing URL or ad id">
        <TextInput
          required
          placeholder="https://www.kijiji.ca/v-view-details.html?adId=1700000000"
          value={listing}
          onChange={(e) => setListing(e.target.value)}
        />
      </Field>
      <ParticleButton type="submit" disabled={busy || !listing.trim()}>
        Open listing
      </ParticleButton>
    </form>
  );
}
