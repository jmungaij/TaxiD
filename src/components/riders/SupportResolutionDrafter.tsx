import { useState } from "react";
import { Loader2, Sparkles, Copy } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { SendToRiderInbox } from "./SendToRiderInbox";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";

const CATEGORIES = [
  ["fare_dispute", "Fare dispute / overcharge"],
  ["driver_conduct", "Driver conduct"],
  ["lost_item", "Lost item"],
  ["safety", "Safety incident"],
  ["payment", "Payment / wallet"],
  ["no_show", "Driver no-show / cancellation"],
  ["general", "Other"],
] as const;

export function SupportResolutionDrafter() {
  const [rider, setRider] = useState("");
  const [category, setCategory] = useState("general");
  const [trip, setTrip] = useState("");
  const [issue, setIssue] = useState("");
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!issue.trim()) { setError("Describe the rider's issue first."); return; }
    setBusy(true); setError(null); setDraft("");
    const { data, error: err } = await supabase.functions.invoke("rider-support-draft", {
      body: { rider, category, trip, issue },
    });
    setBusy(false);
    if (err) {
      let msg = "Couldn't draft a resolution. Please try again.";
      try {
        const ctx = (err as { context?: Response }).context;
        const j = ctx ? await ctx.json() : null;
        if (j?.error) msg = j.error;
      } catch { /* keep default */ }
      setError(msg);
      return;
    }
    setDraft((data as { draft?: string })?.draft ?? "");
  };

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <div className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <Label htmlFor="srd-rider">Rider (name, ID or phone)</Label>
            <Input id="srd-rider" value={rider} onChange={(e) => setRider(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label>Issue type</Label>
            <Select value={category} onValueChange={setCategory}>
              <SelectTrigger aria-label="Issue type"><SelectValue /></SelectTrigger>
              <SelectContent>
                {CATEGORIES.map(([v, l]) => <SelectItem key={v} value={v}>{l}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </div>
        <div className="space-y-1">
          <Label htmlFor="srd-trip">Trip details</Label>
          <Textarea id="srd-trip" rows={4} value={trip} onChange={(e) => setTrip(e.target.value)}
            placeholder="Booking number, pickup → drop-off, date/time, fare charged, driver, payment method…" />
        </div>
        <div className="space-y-1">
          <Label htmlFor="srd-issue">Issue description</Label>
          <Textarea id="srd-issue" rows={5} value={issue} onChange={(e) => setIssue(e.target.value)}
            placeholder="What the rider reported, in their words…" />
        </div>
        <Button onClick={() => void submit()} disabled={busy} className="gap-2">
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
          {busy ? "Drafting…" : "Draft resolution"}
        </Button>
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      </div>
      <div className="rounded-lg border bg-muted/30 p-4 min-h-[16rem]">
        <div className="flex items-center justify-between mb-2">
          <span className="text-sm font-medium">AI-drafted resolution</span>
          {draft && (
            <Button size="sm" variant="ghost" className="gap-1"
              onClick={() => { void navigator.clipboard.writeText(draft); toast.success("Draft copied"); }}>
              <Copy className="h-3 w-3" /> Copy
            </Button>
          )}
        </div>
        {draft
          ? <pre className="whitespace-pre-wrap font-sans text-sm">{draft}</pre>
          : <p className="text-sm text-muted-foreground">The draft appears here. Always review it before sending to the rider.</p>}
        {draft && <SendToRiderInbox draft={draft} category={category} />}
      </div>
    </div>
  );
}
