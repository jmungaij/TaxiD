/**
 * QUALIFY AND OPEN AS A DEAL.
 *
 * One button on the lead row. It asks only for the two things a deal cannot
 * exist without: the value and what qualified the customer. Everything else is
 * carried over from the lead itself, so no figure is invented on the way.
 */
import * as React from "react";
import { Loader2, Target } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { qualifyAndOpenDeal, qualifyRefusal } from "@/lib/sales/qualify";

export function QualifyDealDialog({
  leadId,
  organisation,
  currentValueKes,
  alreadyOpen,
  onOpened,
}: {
  leadId: string;
  organisation: string;
  currentValueKes?: number | null;
  /** True when this lead already carries a deal; the button then explains rather than duplicating. */
  alreadyOpen?: boolean;
  onOpened?: () => void;
}) {
  const { toast } = useToast();
  const [open, setOpen] = React.useState(false);
  const [value, setValue] = React.useState(currentValueKes ? String(currentValueKes) : "");
  const [note, setNote] = React.useState("");
  const [saving, setSaving] = React.useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const deal = await qualifyAndOpenDeal({
        leadId,
        estimatedValueKes: Number(value || 0),
        note: note.trim(),
      });
      toast({
        title: deal.idempotent ? "Already a deal" : "Deal opened",
        description: deal.idempotent
          ? `${organisation} already has a deal open.`
          : `${organisation} is now a live deal${deal.opportunity_ref ? ` (${deal.opportunity_ref})` : ""}.`,
      });
      setOpen(false);
      setNote("");
      onOpened?.();
    } catch (err) {
      toast({
        title: "Deal not opened",
        description: qualifyRefusal(err instanceof Error ? err.message : String(err)),
        variant: "destructive",
      });
    }
    setSaving(false);
  };

  if (alreadyOpen) {
    return (
      <Button size="sm" variant="ghost" disabled className="text-xs">
        <Target className="mr-1 h-3.5 w-3.5" aria-hidden /> Deal open
      </Button>
    );
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline" className="text-xs">
          <Target className="mr-1 h-3.5 w-3.5" aria-hidden /> Qualify and open as a deal
        </Button>
      </DialogTrigger>
      <DialogContent>
        <form onSubmit={submit}>
          <DialogHeader>
            <DialogTitle>Open {organisation} as a deal</DialogTitle>
            <DialogDescription>
              A deal only exists once there is a value behind it and a reason the customer is qualified.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-3">
            <div>
              <Label htmlFor="qd-value">Value you can stand behind (KSh)</Label>
              <Input
                id="qd-value"
                inputMode="decimal"
                value={value}
                onChange={(e) => setValue(e.target.value.replace(/[^\d.]/g, ""))}
                placeholder="e.g. 450000"
                required
              />
            </div>
            <div>
              <Label htmlFor="qd-note">What qualified them?</Label>
              <Textarea
                id="qd-note"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Who you spoke to, what they need, when they want to start."
                rows={3}
                required
              />
            </div>
          </div>
          <DialogFooter>
            <Button type="submit" disabled={saving}>
              {saving && <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" aria-hidden />}
              Open the deal
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export default QualifyDealDialog;
