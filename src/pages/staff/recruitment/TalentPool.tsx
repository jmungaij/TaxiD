import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { Users, MessageSquare, Star, Plus } from "lucide-react";
import { toast } from "sonner";

import { StaffPageHeader } from "@/components/staff/primitives";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";

import * as rec from "@/lib/recruitment/api";
import { daysSince, titleise } from "@/lib/recruitment/types";

const IDLE_DAYS = 60;

/**
 * Talent pool — qualified candidates kept warm between vacancies. Engagement is
 * recorded, so "re-engage" is measurable rather than aspirational.
 */
export default function RecruitmentTalentPool() {
  const qc = useQueryClient();
  const pool = useQuery({ queryKey: ["rec", "talent-pool"], queryFn: rec.listTalentPoolEntries });
  const candidates = useQuery({ queryKey: ["rec", "candidates"], queryFn: rec.listCandidates });

  const [search, setSearch] = useState("");
  const [addOpen, setAddOpen] = useState(false);
  const [addForm, setAddForm] = useState({ candidateId: "", tags: "", reason: "" });

  const candidate = (id: string) => (candidates.data ?? []).find((c) => c.id === id);

  const rows = useMemo(() => {
    const term = search.trim().toLowerCase();
    return (pool.data ?? []).filter((e) => {
      if (!term) return true;
      const c = candidate(e.candidate_id);
      return (
        c?.full_name?.toLowerCase().includes(term) ||
        e.tags?.some((t) => t.toLowerCase().includes(term)) ||
        e.potential_roles?.some((r) => r.toLowerCase().includes(term))
      );
    });
  }, [pool.data, candidates.data, search]);

  const idle = rows.filter((e) => !e.last_engaged_at || daysSince(e.last_engaged_at) >= IDLE_DAYS);

  const engage = useMutation({
    mutationFn: (entry: rec.RecTalentPoolEntry) => rec.markTalentPoolEngaged(entry),
    onSuccess: () => {
      toast.success("Engagement recorded.");
      qc.invalidateQueries({ queryKey: ["rec", "talent-pool"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const add = useMutation({
    mutationFn: () => {
      if (!addForm.candidateId) throw new Error("Choose a candidate to add.");
      if (!addForm.reason.trim()) throw new Error("Say why this candidate belongs in the pool.");
      return rec.addToTalentPool(
        addForm.candidateId,
        addForm.tags.split(",").map((t) => t.trim()).filter(Boolean),
        addForm.reason.trim(),
      );
    },
    onSuccess: () => {
      toast.success("Candidate added to the talent pool.");
      setAddOpen(false);
      setAddForm({ candidateId: "", tags: "", reason: "" });
      qc.invalidateQueries({ queryKey: ["rec"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="p-6 lg:p-8">
      <StaffPageHeader
        eyebrow="Recruitment 360"
        title="Talent pool"
        lede="Qualified candidates managed over time — tagged by capability, rated, and tracked by last engagement."
        actions={
          <Button onClick={() => setAddOpen(true)}>
            <Plus className="mr-1 h-4 w-4" aria-hidden="true" /> Add candidate
          </Button>
        }
      />

      <div className="grid gap-4 md:grid-cols-3">
        <StatTile label="Pooled candidates" value={(pool.data ?? []).length} />
        <StatTile label={`Not engaged in ${IDLE_DAYS} days`} value={idle.length} />
        <StatTile
          label="Average rating"
          value={
            (pool.data ?? []).filter((e) => e.rating != null).length
              ? Number(
                  (
                    (pool.data ?? []).reduce((s, e) => s + (e.rating ?? 0), 0) /
                    (pool.data ?? []).filter((e) => e.rating != null).length
                  ).toFixed(1),
                )
              : 0
          }
        />
      </div>

      <div className="mt-6 max-w-sm">
        <Label htmlFor="pool-search" className="sr-only">Search the talent pool</Label>
        <Input id="pool-search" value={search} onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by name, tag or potential role" />
      </div>

      <Card className="mt-4">
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Users className="h-4 w-4" aria-hidden="true" /> Pool ({rows.length})
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {pool.isLoading ? (
            <div className="space-y-3 p-4">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-16" />)}</div>
          ) : rows.length === 0 ? (
            <div className="p-6 text-sm text-muted-foreground">
              The talent pool is empty. Candidates you park at evaluation stage land here, or add one directly.
            </div>
          ) : (
            <ul className="divide-y divide-border">
              {rows.map((e) => {
                const c = candidate(e.candidate_id);
                const idleDays = e.last_engaged_at ? daysSince(e.last_engaged_at) : null;
                return (
                  <li key={e.id} className="flex flex-wrap items-center justify-between gap-3 p-4">
                    <div className="min-w-0">
                      <p className="text-sm font-medium truncate">{c?.full_name ?? e.candidate_id}</p>
                      <p className="text-xs text-muted-foreground">
                        {titleise(e.status)}
                        {idleDays != null ? ` · engaged ${idleDays} day(s) ago` : " · never engaged"}
                        {e.entry_reason ? ` · ${e.entry_reason}` : ""}
                      </p>
                      {e.tags?.length ? (
                        <div className="mt-1 flex flex-wrap gap-1">
                          {e.tags.map((t) => <Badge key={t} variant="outline" className="text-[10px]">{t}</Badge>)}
                        </div>
                      ) : null}
                    </div>
                    <div className="flex items-center gap-2">
                      {e.rating != null && (
                        <Badge variant="outline" className="gap-1">
                          <Star className="h-3 w-3" aria-hidden="true" /> {e.rating}
                        </Badge>
                      )}
                      <Button size="sm" variant="outline" onClick={() => engage.mutate(e)} disabled={engage.isPending}>
                        Mark engaged
                      </Button>
                      <Button size="sm" variant="ghost" asChild>
                        <Link to={`/staff/recruitment/communications?candidate=${e.candidate_id}`}>
                          <MessageSquare className="mr-1 h-4 w-4" aria-hidden="true" /> Contact
                        </Link>
                      </Button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>

      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add to talent pool</DialogTitle>
            <DialogDescription>Pooled candidates stay on the register with their consent state intact.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label htmlFor="pool-candidate">Candidate</Label>
              <select
                id="pool-candidate"
                className="mt-1 h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                value={addForm.candidateId}
                onChange={(e) => setAddForm({ ...addForm, candidateId: e.target.value })}
              >
                <option value="">Select a candidate…</option>
                {(candidates.data ?? []).map((c) => (
                  <option key={c.id} value={c.id}>{c.full_name}</option>
                ))}
              </select>
            </div>
            <div>
              <Label htmlFor="pool-tags">Tags (comma separated)</Label>
              <Input id="pool-tags" value={addForm.tags}
                onChange={(e) => setAddForm({ ...addForm, tags: e.target.value })}
                placeholder="operations, nairobi, fleet" />
            </div>
            <div>
              <Label htmlFor="pool-reason">Reason for pooling</Label>
              <Textarea id="pool-reason" rows={3} value={addForm.reason}
                onChange={(e) => setAddForm({ ...addForm, reason: e.target.value })} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setAddOpen(false)}>Cancel</Button>
            <Button onClick={() => add.mutate()} disabled={add.isPending}>
              {add.isPending ? "Adding…" : "Add to pool"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function StatTile({ label, value }: { label: string; value: number }) {
  return (
    <Card>
      <CardContent className="p-5">
        <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
        <p className="mt-2 text-3xl font-semibold tabular-nums">{value}</p>
      </CardContent>
    </Card>
  );
}
