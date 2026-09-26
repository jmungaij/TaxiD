import { useEffect, useMemo, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  createSelfWork,
  searchAccounts,
  workTemplatesFor,
  type AccountOption,
  type WorkPriority,
} from "@/lib/workspace/workEngine";

const PRIORITIES: WorkPriority[] = ["critical", "high", "medium", "low"];

/**
 * SELF-ASSIGNMENT.
 *
 * An employee is never idle because nothing was assigned: they can raise their
 * own work in two clicks. Templates are role-aware, and linking a real customer
 * account is what makes the work count commercially.
 */
export function CreateWorkDialog({
  open,
  onOpenChange,
  roleKey,
  presetTitle,
  presetAccountId,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  roleKey?: string | null;
  presetTitle?: string | null;
  presetAccountId?: string | null;
  onCreated: (workItemId: string) => void;
}) {
  const templates = useMemo(() => workTemplatesFor(roleKey), [roleKey]);
  const [templateKey, setTemplateKey] = useState(templates[0]?.key ?? "admin_task");
  const template = templates.find((t) => t.key === templateKey) ?? templates[0];

  const [title, setTitle] = useState(presetTitle ?? "");
  const [priority, setPriority] = useState<WorkPriority>(template?.priority ?? "medium");
  const [due, setDue] = useState("");
  const [notes, setNotes] = useState("");
  const [accountId, setAccountId] = useState<string>(presetAccountId ?? "");
  const [accounts, setAccounts] = useState<AccountOption[]>([]);
  const [accountQuery, setAccountQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setTitle(presetTitle ?? "");
    setAccountId(presetAccountId ?? "");
    setError(null);
  }, [open, presetTitle, presetAccountId]);

  useEffect(() => {
    if (!open) return;
    let live = true;
    const t = setTimeout(() => {
      searchAccounts(accountQuery)
        .then((rows) => live && setAccounts(rows))
        .catch(() => live && setAccounts([]));
    }, 200);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [open, accountQuery]);

  useEffect(() => {
    if (template) setPriority(template.priority);
  }, [templateKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const submit = async () => {
    if (!template) return;
    setBusy(true);
    setError(null);
    const res = await createSelfWork({
      workKind: template.workKind,
      title: title.trim() || template.label,
      requiredAction: template.requiredAction,
      priority,
      dueAt: due ? new Date(due).toISOString() : null,
      description: notes.trim() || null,
      accountId: accountId || null,
    });
    setBusy(false);
    if (res.ok !== true) {
      setError(res.error);
      return;
    }
    onCreated(res.workItemId);
    onOpenChange(false);
    setTitle("");
    setNotes("");
    setDue("");
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Create work for myself</DialogTitle>
          <DialogDescription>
            It enters your queue immediately, is prioritised with everything else, and is recorded
            against the customer when you link an account.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label>Type of work</Label>
            <div className="grid gap-2 sm:grid-cols-2">
              {templates.map((t) => (
                <button
                  key={t.key}
                  type="button"
                  onClick={() => setTemplateKey(t.key)}
                  className={`rounded-lg border p-3 text-left text-sm transition-colors ${
                    templateKey === t.key
                      ? "border-primary bg-primary/5 ring-1 ring-primary/30"
                      : "hover:bg-muted/60"
                  }`}
                >
                  <div className="font-medium">{t.label}</div>
                  <div className="mt-0.5 text-xs text-muted-foreground">{t.helper}</div>
                  <div className="mt-1 text-[11px] text-muted-foreground">~{t.minutes} min</div>
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="work-title">Title</Label>
            <Input
              id="work-title"
              value={title}
              placeholder={template?.label ?? "What needs doing?"}
              onChange={(e) => setTitle(e.target.value)}
            />
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>Priority</Label>
              <Select value={priority} onValueChange={(v) => setPriority(v as WorkPriority)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PRIORITIES.map((p) => (
                    <SelectItem key={p} value={p}>
                      {p}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="work-due">Due</Label>
              <Input
                id="work-due"
                type="datetime-local"
                value={due}
                onChange={(e) => setDue(e.target.value)}
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="work-account">Customer account (optional)</Label>
            <Input
              id="work-account"
              value={accountQuery}
              placeholder="Search accounts…"
              onChange={(e) => setAccountQuery(e.target.value)}
            />
            <div className="max-h-32 space-y-1 overflow-auto">
              {accounts.map((a) => (
                <button
                  key={a.id}
                  type="button"
                  onClick={() => setAccountId(a.id === accountId ? "" : a.id)}
                  className={`block w-full rounded-md px-2 py-1.5 text-left text-sm ${
                    accountId === a.id ? "bg-primary/10 font-medium" : "hover:bg-muted"
                  }`}
                >
                  {a.name}
                </button>
              ))}
              {accounts.length === 0 && (
                <p className="px-2 py-1 text-xs text-muted-foreground">No matching accounts.</p>
              )}
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="work-notes">Context (optional)</Label>
            <Textarea
              id="work-notes"
              rows={3}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Anything the next person would need to know."
            />
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={busy}>
            {busy ? "Creating…" : "Create and add to my day"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
