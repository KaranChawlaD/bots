import type { SendRecord } from "@/lib/api";

export default function HistoryPanel({ history }: { history: SendRecord[] }) {
  if (history.length === 0) {
    return <p className="text-sm text-muted-foreground">Nothing sent yet.</p>;
  }

  return (
    <ul className="space-y-2">
      {history.map((record, i) => (
        <li
          key={`${record.listingUrl}-${record.sentAt}-${i}`}
          className="rounded-lg border border-border bg-background/60 p-3 text-sm"
        >
          <div className="text-xs text-muted-foreground">
            {record.sentAt} · {record.accountId}
          </div>
          <a
            href={record.listingUrl}
            target="_blank"
            rel="noreferrer"
            className="block truncate text-primary hover:underline"
          >
            {record.listingUrl}
          </a>
          <div className="mt-0.5 text-foreground/80">{record.preview}</div>
        </li>
      ))}
    </ul>
  );
}
