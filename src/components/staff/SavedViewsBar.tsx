import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { BookmarkPlus, Trash2, Users2, Lock } from "lucide-react";
import { toast } from "sonner";
import {
  listSavedViews, saveView, deleteSavedView, sharingLabel, SHAREABLE_ROLES,
  type SavedView, type SavedViewKind, type SavedViewVisibility,
} from "@/lib/staff/savedViews";
import { useAuth } from "@/hooks/useAuth";

/**
 * Saved searches and saved workflow views, with role-based sharing.
 * A shared view shares the *configuration*, never the data: re-running it
 * resolves only what the reader is authorised to see.
 */
export function SavedViewsBar({
  kind,
  currentConfig,
  onApply,
  emptyHint,
}: {
  kind: SavedViewKind;
  /** Configuration captured when the employee saves the current view. */
  currentConfig: Record<string, unknown>;
  onApply: (config: Record<string, unknown>) => void;
  emptyHint?: string;
}) {
  const { user } = useAuth();
  const [views, setViews] = useState<SavedView[] | null>(null);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [visibility, setVisibility] = useState<SavedViewVisibility>("private");
  const [roles, setRoles] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  const refresh = useCallback(async () => {
    const res = await listSavedViews(kind);
    setViews(res.data ?? []);
    if (!res.ok) toast.error("Saved views could not be loaded", { description: res.reason });
  }, [kind]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const submit = async () => {
    setSaving(true);
    const res = await saveView({ kind, name, description, config: currentConfig, visibility, shared_roles: roles });
    setSaving(false);
    if (!res.ok || !res.data) {
      toast.error("This view was not saved", { description: res.reason });
      return;
    }
    toast.success(`Saved “${res.data.name}”`, {
      description: visibility === "roles" ? `Shared with ${roles.join(", ")}` : "Private to you",
    });
    setOpen(false);
    setName("");
    setDescription("");
    void refresh();
  };

  const remove = async (v: SavedView) => {
    const res = await deleteSavedView(v.id);
    if (!res.ok) {
      toast.error("This view was not deleted", { description: res.reason });
      return;
    }
    toast.success(`Deleted “${v.name}”`);
    void refresh();
  };

  return (
    <div className="mb-6 rounded-lg border bg-card p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
          Saved {kind === "search" ? "searches" : "workflow views"}
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button size="sm" variant="outline" className="h-8">
              <BookmarkPlus className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" /> Save current view
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>Save this {kind === "search" ? "search" : "workflow view"}</DialogTitle>
              <DialogDescription>
                The configuration is saved, not the results. Anyone you share it with still sees only
                the records their own access permits.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              <div>
                <Label htmlFor="saved-view-name">Name</Label>
                <Input
                  id="saved-view-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Expiring compliance documents — Nairobi"
                />
              </div>
              <div>
                <Label htmlFor="saved-view-desc">Why this view matters (optional)</Label>
                <Textarea
                  id="saved-view-desc"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  rows={2}
                  placeholder="Used in the weekly marketplace compliance review."
                />
              </div>
              <fieldset>
                <legend className="text-sm font-medium">Who can use it</legend>
                <RadioGroup
                  className="mt-2 space-y-2"
                  value={visibility}
                  onValueChange={(v) => setVisibility(v as SavedViewVisibility)}
                >
                  <div className="flex items-center gap-2">
                    <RadioGroupItem value="private" id="vis-private" />
                    <Label htmlFor="vis-private" className="font-normal">Private to me</Label>
                  </div>
                  <div className="flex items-center gap-2">
                    <RadioGroupItem value="roles" id="vis-roles" />
                    <Label htmlFor="vis-roles" className="font-normal">Share with specific roles</Label>
                  </div>
                </RadioGroup>
              </fieldset>
              {visibility === "roles" && (
                <div className="grid grid-cols-2 gap-2 rounded-md border p-3">
                  {SHAREABLE_ROLES.map((r) => (
                    <label key={r} className="flex items-center gap-2 text-xs">
                      <Checkbox
                        checked={roles.includes(r)}
                        onCheckedChange={(c) =>
                          setRoles((prev) => (c ? [...prev, r] : prev.filter((x) => x !== r)))
                        }
                        aria-label={`Share with ${r}`}
                      />
                      {r}
                    </label>
                  ))}
                </div>
              )}
            </div>
            <DialogFooter>
              <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
              <Button onClick={submit} disabled={saving}>{saving ? "Saving…" : "Save view"}</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {views === null ? (
        <p className="mt-2 text-xs text-muted-foreground">Loading saved views…</p>
      ) : views.length === 0 ? (
        <p className="mt-2 text-xs text-muted-foreground">
          {emptyHint ?? "Nothing saved yet. Configure a view, then save it for yourself or your team."}
        </p>
      ) : (
        <ul className="mt-3 space-y-2">
          {views.map((v) => (
            <li key={v.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-2">
              <div className="min-w-0">
                <button
                  type="button"
                  onClick={() => {
                    onApply(v.config);
                    toast.success(`Applied “${v.name}”`);
                  }}
                  className="truncate text-sm font-medium text-primary underline-offset-4 hover:underline"
                >
                  {v.name}
                </button>
                {v.description && <div className="truncate text-xs text-muted-foreground">{v.description}</div>}
              </div>
              <div className="flex items-center gap-2">
                <Badge variant="secondary" className="gap-1 text-[10px] font-normal">
                  {v.visibility === "roles" ? (
                    <Users2 className="h-3 w-3" aria-hidden="true" />
                  ) : (
                    <Lock className="h-3 w-3" aria-hidden="true" />
                  )}
                  {sharingLabel(v, user?.id)}
                </Badge>
                {v.owner_id === user?.id && (
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-7 w-7"
                    onClick={() => remove(v)}
                    aria-label={`Delete ${v.name}`}
                  >
                    <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                  </Button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default SavedViewsBar;
