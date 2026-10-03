import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { toast } from "@/hooks/use-toast";
import { FileSpreadsheet, Download } from "lucide-react";

const HEADERS = ["email", "full_name", "phone", "employee_code", "department", "role", "title"];

/** Minimal CSV parser (quotes, commas, newlines in quotes). */
export function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = []; let row: string[] = []; let cur = ""; let q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"' && text[i + 1] === '"') { cur += '"'; i++; } else if (c === '"') q = false; else cur += c; }
    else if (c === '"') q = true;
    else if (c === ",") { row.push(cur); cur = ""; }
    else if (c === "\n" || c === "\r") { if (c === "\r" && text[i + 1] === "\n") i++; row.push(cur); rows.push(row); row = []; cur = ""; }
    else cur += c;
  }
  if (cur || row.length) { row.push(cur); rows.push(row); }
  const [head, ...body] = rows.filter((r) => r.some((x) => x.trim()));
  if (!head) return [];
  const keys = head.map((h) => h.trim().toLowerCase().replace(/[\s-]+/g, "_").replace(/^name$/, "full_name"));
  return body.map((r) => Object.fromEntries(keys.map((k, i) => [k, (r[i] ?? "").trim()])));
}

export function HrImportDialog({ corporateId, onDone }: { corporateId: string; onDone: () => void }) {
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<Record<string, string>[]>([]);
  const [suspendMissing, setSuspendMissing] = useState(false);
  const [busy, setBusy] = useState(false);

  const template = () => {
    const blob = new Blob([HEADERS.join(",") + "\njane.doe@yalla.africa,Jane Doe,+254700000000,EMP001,Finance,employee,Accountant\n"], { type: "text/csv" });
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = "staff-list-template.csv"; a.click();
  };

  const run = async () => {
    setBusy(true);
    const { data, error } = await supabase.rpc("corporate_employees_import", { _corp: corporateId, _rows: rows, _suspend_missing: suspendMissing });
    setBusy(false);
    const r = data as { ok?: boolean; error?: string; added?: number; updated?: number; skipped?: number; suspended?: number } | null;
    if (error || !r?.ok) { toast({ title: "Import failed", description: error?.message ?? r?.error, variant: "destructive" }); return; }
    toast({ title: "Staff list imported", description: `${r.added} added · ${r.updated} updated · ${r.skipped} skipped${suspendMissing ? ` · ${r.suspended} suspended` : ""}` });
    setOpen(false); setRows([]); onDone();
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button variant="outline" className="gap-2"><FileSpreadsheet className="h-4 w-4" /> Import HR list</Button></DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Import staff from HR spreadsheet</DialogTitle>
          <DialogDescription>Upload a CSV (save your Excel sheet as CSV). Existing staff are updated by email; new people are added as invited and get access when they sign in with their work email.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <Button size="sm" variant="ghost" className="gap-1" onClick={template}><Download className="h-3 w-3" /> Download template</Button>
          <input type="file" accept=".csv,text/csv" onChange={async (e) => { const f = e.target.files?.[0]; if (f) setRows(parseCsv(await f.text())); }} />
          {rows.length > 0 && <p className="text-sm">{rows.length} rows ready · columns: {Object.keys(rows[0]).join(", ")}</p>}
          <label className="flex items-center gap-2 text-sm"><Checkbox checked={suspendMissing} onCheckedChange={(v) => setSuspendMissing(!!v)} /> Suspend staff not in this file (the Director is never suspended)</label>
        </div>
        <DialogFooter><Button disabled={!rows.length || busy} onClick={run}>{busy ? "Importing…" : "Import"}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
