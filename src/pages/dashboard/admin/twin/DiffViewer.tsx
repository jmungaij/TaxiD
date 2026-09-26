// Side-by-side diff viewer for per-domain artifact samples and validation diffs.
// Compares the first two sample rows in an artifact (or before/after snapshots)
// and highlights per-key differences.
import { useMemo } from "react";
import { Badge } from "@/components/ui/badge";

type Row = Record<string, unknown>;

function fmt(v: unknown): string {
  if (v === null || v === undefined) return "—";
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

export interface DiffPair {
  label: string;
  left: Row;
  right: Row;
  leftLabel?: string;
  rightLabel?: string;
}

export function SideBySideDiff({ pair }: { pair: DiffPair }) {
  const keys = useMemo(
    () => Array.from(new Set([...Object.keys(pair.left ?? {}), ...Object.keys(pair.right ?? {})])).sort(),
    [pair]
  );
  return (
    <div className="border rounded-md overflow-hidden">
      <div className="grid grid-cols-[160px_1fr_1fr] text-xs font-semibold bg-muted/50 border-b">
        <div className="px-3 py-2">{pair.label}</div>
        <div className="px-3 py-2 border-l">{pair.leftLabel ?? "Left"}</div>
        <div className="px-3 py-2 border-l">{pair.rightLabel ?? "Right"}</div>
      </div>
      <div className="max-h-80 overflow-auto font-mono text-[11px] leading-relaxed">
        {keys.map((k) => {
          const l = fmt(pair.left?.[k]);
          const r = fmt(pair.right?.[k]);
          const differs = l !== r;
          return (
            <div
              key={k}
              className={`grid grid-cols-[160px_1fr_1fr] border-b last:border-b-0 ${
                differs ? "bg-status-warning/10 dark:bg-status-warning/20" : ""
              }`}
            >
              <div className="px-3 py-1.5 text-muted-foreground truncate">{k}</div>
              <div className={`px-3 py-1.5 border-l ${differs ? "text-status-danger dark:text-status-danger" : ""}`}>{l}</div>
              <div className={`px-3 py-1.5 border-l ${differs ? "text-status-success dark:text-status-success" : ""}`}>{r}</div>
            </div>
          );
        })}
        {keys.length === 0 && <div className="p-4 text-muted-foreground">No fields to compare.</div>}
      </div>
      <div className="px-3 py-1.5 text-[10px] text-muted-foreground bg-muted/30 border-t flex gap-3">
        <span><Badge variant="outline" className="mr-1">amber</Badge> field differs</span>
        <span>{keys.filter((k) => fmt(pair.left?.[k]) !== fmt(pair.right?.[k])).length} of {keys.length} fields differ</span>
      </div>
    </div>
  );
}
