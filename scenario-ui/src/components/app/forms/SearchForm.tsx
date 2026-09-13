import { useState } from "react";
import { Field, Row, Select, TextInput } from "@/components/ui/field";
import ParticleButton from "@/components/kokonutui/particle-button";

export default function SearchForm({
  busy,
  accountName,
  onSubmit,
}: {
  busy: boolean;
  accountName: string;
  onSubmit: (params: Record<string, unknown>) => void;
}) {
  const [keywords, setKeywords] = useState("");
  const [limit, setLimit] = useState("10");
  const [minPrice, setMinPrice] = useState("");
  const [maxPrice, setMaxPrice] = useState("");
  const [sort, setSort] = useState("");

  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit({ keywords, limit, minPrice, maxPrice, sort });
      }}
    >
      <Field label="Keywords">
        <TextInput
          required
          placeholder="ps5 controller"
          value={keywords}
          onChange={(e) => setKeywords(e.target.value)}
        />
      </Field>
      <Row className="sm:grid-cols-4">
        <Field label="Limit">
          <TextInput type="number" min={1} value={limit} onChange={(e) => setLimit(e.target.value)} />
        </Field>
        <Field label="Min $">
          <TextInput type="number" value={minPrice} onChange={(e) => setMinPrice(e.target.value)} />
        </Field>
        <Field label="Max $">
          <TextInput type="number" value={maxPrice} onChange={(e) => setMaxPrice(e.target.value)} />
        </Field>
        <Field label="Sort">
          <Select value={sort} onChange={(e) => setSort(e.target.value)}>
            <option value="">Kijiji default</option>
            <option value="dateDesc">Newest</option>
            <option value="priceAsc">Cheapest</option>
            <option value="priceDesc">Dearest</option>
          </Select>
        </Field>
      </Row>
      <ParticleButton type="submit" disabled={busy || !keywords.trim()}>
        Search with {accountName}
      </ParticleButton>
    </form>
  );
}
