export function formatMoney(value: number | undefined): string {
  if (value === undefined || !Number.isFinite(value)) return "—";
  return `$${value.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}

export function percentBelow(ask: number | undefined, offer: number | undefined): string | undefined {
  if (!ask || offer === undefined || ask <= 0) return undefined;
  const pct = Math.round((1 - offer / ask) * 100);
  if (pct <= 0) return undefined;
  return `${pct}% below asking`;
}
