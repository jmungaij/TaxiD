/**
 * Corporate support ticket desk.
 *
 * Issues raised per corporate account with internal notes and a direct jump
 * into the assisted booking desk (opening an audited manage-as session) so a
 * support admin can resolve a booking problem in the same flow.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Loader2, MessageSquarePlus, Plus, RefreshCw, ShieldAlert, Ticket } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "@/hooks/use-toast";
import { invokeCorporateConsole, startManageAs } from "@/lib/corporate/manageAs";
import { ManageAsBanner } from "@/components/corporate/ManageAsBanner";

interface TicketRow {
  id: string;
  corporate_id: string;
  subject: string;
  category?: string | null;
  severity?: string | null;
  status?: string | null;
  booking_ref?: string | null;
  assigned_to?: string | null;
  created_at?: string | null;
  last_activity_at?: string | null;
}

interface NoteRow {
  id: string;
  ticket_id: string;
  author_email?: string | null;
  body: string;
  is_internal?: boolean | null;
  created_at?: string | null;
}

const STATUSES = ["open", "pending", "resolved", "closed"] as const;
const SEVERITIES = ["low", "medium", "high", "critical"] as const;
const CATEGORIES = ["general", "booking", "billing", "compliance", "technical"] as const;
const ANY = "__any__";

const when = (v?: string | null) =>
  v ? new Date(v).toLocaleString("en-KE", { dateStyle: "medium", timeStyle: "short" }) : "—";

const severityVariant = (s?: string | null) =>
  s === "critical" || s === "high" ? "destructive" : s === "medium" ? "secondary" : "outline";

export default function CorporateSupportDesk() {
  const [tickets, setTickets] = useState<TicketRow[]>([]);
  const [names, setNames] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<string>("open");
  const [query, setQuery] = useState("");

  const [selected, setSelected] = useState<TicketRow | null>(null);
  const [notes, setNotes] = useState<NoteRow[]>([]);
  const [noteBody, setNoteBody] = useState("");
  const [busy, setBusy] = useState(false);

  const [createOpen, setCreateOpen] = useState(false);
  const [newTicket, setNewTicket] = useState({
    corporate_id: "", subject: "", category: "general", severity: "medium", booking_ref: "", note: "",
  });

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await invokeCorporateConsole<{
        tickets: TicketRow[]; corporate_names: Record<string, string>;
      }>({ op: "tickets", limit: 200, ...(statusFilter !== ANY ? { status: statusFilter } : {}) });
      setTickets(res.tickets ?? []);
      setNames(res.corporate_names ?? {});
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [statusFilter]);

  useEffect(() => { void load(); }, [load]);

  const loadNotes = useCallback(async (ticketId: string) => {
    try {
      const res = await invokeCorporateConsole<{ notes: NoteRow[] }>({ op: "ticket_notes", ticket_id: ticketId });
      setNotes(res.notes ?? []);
    } catch (e) {
      toast({ title: "Could not load notes", description: (e as Error).message, variant: "destructive" });
    }
  }, []);

  function openTicket(ticket: TicketRow) {
    setSelected(ticket);
    setNotes([]);
    void loadNotes(ticket.id);
  }

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return tickets;
    return tickets.filter((t) =>
      [t.subject, t.booking_ref, t.category, names[t.corporate_id]]
        .filter(Boolean).some((v) => String(v).toLowerCase().includes(q)),
    );
  }, [tickets, query, names]);

  const grouped = useMemo(() => {
    const map = new Map<string, TicketRow[]>();
    for (const t of visible) {
      const key = t.corporate_id;
      map.set(key, [...(map.get(key) ?? []), t]);
    }
    return [...map.entries()].sort((a, b) => b[1].length - a[1].length);
  }, [visible]);

  async function addNote() {
    if (!selected || !noteBody.trim()) return;
    setBusy(true);
    try {
      await invokeCorporateConsole({ op: "ticket_note", ticket_id: selected.id, body: noteBody.trim(), is_internal: true });
      setNoteBody("");
      await loadNotes(selected.id);
      toast({ title: "Internal note added" });
    } catch (e) {
      toast({ title: "Note failed", description: (e as Error).message, variant: "destructive" });
    } finally {
      setBusy(false);
    }
  }

  async function updateTicket(patch: Record<string, unknown>) {
    if (!selected) return;
    setBusy(true);
    try {
      const res = await invokeCorporateConsole<{ ticket: TicketRow }>({
        op: "ticket_update", ticket_id: selected.id, ...patch,
      });
      setSelected(res.ticket);
      void load();
      toast({ title: "Ticket updated" });
    } catch (e) {
      toast({ title: "Update failed", description: (e as Error).message, variant: "destructive" });
    } finally {
      setBusy(false);
    }
  }

  async function createTicket() {
    if (!newTicket.corporate_id.trim() || !newTicket.subject.trim()) {
      toast({ title: "Corporate and subject are required", variant: "destructive" });
      return;
    }
    setBusy(true);
    try {
      await invokeCorporateConsole({
        op: "ticket_create",
        corporate_id: newTicket.corporate_id.trim(),
        subject: newTicket.subject.trim(),
        category: newTicket.category,
        severity: newTicket.severity,
        ...(newTicket.booking_ref.trim() ? { booking_ref: newTicket.booking_ref.trim() } : {}),
        ...(newTicket.note.trim() ? { note: newTicket.note.trim() } : {}),
      });
      setCreateOpen(false);
      setNewTicket({ corporate_id: "", subject: "", category: "general", severity: "medium", booking_ref: "", note: "" });
      void load();
      toast({ title: "Ticket created" });
    } catch (e) {
      toast({ title: "Could not create ticket", description: (e as Error).message, variant: "destructive" });
    } finally {
      setBusy(false);
    }
  }

  async function assistedBooking(ticket: TicketRow) {
    setBusy(true);
    try {
      await startManageAs(ticket.corporate_id, `Support ticket ${ticket.id.slice(0, 8)}`);
      window.location.assign("/dashboard/admin/corporates/assisted-booking");
    } catch (e) {
      toast({ title: "Could not start assisted session", description: (e as Error).message, variant: "destructive" });
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <ManageAsBanner />

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Corporate support desk</h1>
          <p className="text-sm text-muted-foreground">
            Issues per corporate account with internal notes and one-click assisted booking.
          </p>
        </div>
        <div className="flex gap-2">
          <Button size="sm" onClick={() => setCreateOpen(true)}>
            <Plus className="mr-2 h-4 w-4" /> New ticket
          </Button>
          <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading}>
            {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
            Refresh
          </Button>
        </div>
      </div>

      <Card>
        <CardHeader className="flex flex-row flex-wrap items-center gap-3">
          <CardTitle className="text-base">Queue</CardTitle>
          <div className="ml-auto flex flex-wrap gap-2">
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-[160px]" aria-label="Filter by status"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={ANY}>All statuses</SelectItem>
                {STATUSES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
              </SelectContent>
            </Select>
            <Input
              className="w-[220px]"
              placeholder="Search tickets…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              aria-label="Search tickets"
            />
          </div>
        </CardHeader>
        <CardContent className="space-y-6">
          {error && (
            <p className="flex items-center gap-2 text-sm text-destructive">
              <ShieldAlert className="h-4 w-4" /> {error}
            </p>
          )}
          {!loading && grouped.length === 0 && (
            <p className="py-8 text-center text-sm text-muted-foreground">No tickets in this view.</p>
          )}
          {grouped.map(([corporateId, list]) => (
            <div key={corporateId} className="space-y-2">
              <div className="flex items-center gap-2">
                <Ticket className="h-4 w-4 text-muted-foreground" />
                <Link className="font-medium underline-offset-2 hover:underline" to={`/dashboard/admin/corporates/${corporateId}`}>
                  {names[corporateId] ?? corporateId.slice(0, 8)}
                </Link>
                <Badge variant="outline">{list.length} open item{list.length === 1 ? "" : "s"}</Badge>
              </div>
              <div className="divide-y rounded-md border">
                {list.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => openTicket(t)}
                    className="flex w-full flex-wrap items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-muted/50"
                  >
                    <span className="font-medium">{t.subject}</span>
                    <Badge variant={severityVariant(t.severity)}>{t.severity ?? "medium"}</Badge>
                    <Badge variant="outline">{t.status ?? "open"}</Badge>
                    {t.booking_ref && <span className="text-xs text-muted-foreground">Ref {t.booking_ref}</span>}
                    <span className="ml-auto text-xs text-muted-foreground">{when(t.last_activity_at ?? t.created_at)}</span>
                  </button>
                ))}
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      {/* Ticket detail */}
      <Dialog open={!!selected} onOpenChange={(open) => { if (!open) setSelected(null); }}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{selected?.subject}</DialogTitle>
            <DialogDescription>
              {selected ? names[selected.corporate_id] ?? selected.corporate_id : ""} ·{" "}
              {selected?.category ?? "general"} · opened {when(selected?.created_at)}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="flex flex-wrap gap-2">
              {STATUSES.map((s) => (
                <Button
                  key={s}
                  size="sm"
                  variant={selected?.status === s ? "default" : "outline"}
                  disabled={busy}
                  onClick={() => void updateTicket({ status: s })}
                >
                  {s}
                </Button>
              ))}
              {selected && (
                <Button size="sm" variant="secondary" className="ml-auto" disabled={busy} onClick={() => void assistedBooking(selected)}>
                  Assisted booking
                </Button>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="ticket-note">Internal note</Label>
              <Textarea
                id="ticket-note"
                value={noteBody}
                onChange={(e) => setNoteBody(e.target.value)}
                placeholder="Visible to platform staff only"
              />
              <Button size="sm" disabled={busy || !noteBody.trim()} onClick={() => void addNote()}>
                <MessageSquarePlus className="mr-2 h-4 w-4" /> Add note
              </Button>
            </div>

            <div className="max-h-64 space-y-3 overflow-y-auto rounded-md border p-3">
              {notes.length === 0 && <p className="text-sm text-muted-foreground">No notes yet.</p>}
              {notes.map((n) => (
                <div key={n.id} className="text-sm">
                  <div className="text-xs text-muted-foreground">
                    {n.author_email ?? "Staff"} · {when(n.created_at)}
                  </div>
                  <p>{n.body}</p>
                </div>
              ))}
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Create ticket */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New support ticket</DialogTitle>
            <DialogDescription>Logged against a corporate account and audited.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="nt-corp">Corporate ID</Label>
              <Input
                id="nt-corp"
                value={newTicket.corporate_id}
                onChange={(e) => setNewTicket({ ...newTicket, corporate_id: e.target.value })}
                placeholder="UUID from the control tower"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="nt-subject">Subject</Label>
              <Input
                id="nt-subject"
                value={newTicket.subject}
                onChange={(e) => setNewTicket({ ...newTicket, subject: e.target.value })}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="nt-cat">Category</Label>
                <Select value={newTicket.category} onValueChange={(v) => setNewTicket({ ...newTicket, category: v })}>
                  <SelectTrigger id="nt-cat"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {CATEGORIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="nt-sev">Severity</Label>
                <Select value={newTicket.severity} onValueChange={(v) => setNewTicket({ ...newTicket, severity: v })}>
                  <SelectTrigger id="nt-sev"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {SEVERITIES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="nt-ref">Booking reference (optional)</Label>
              <Input
                id="nt-ref"
                value={newTicket.booking_ref}
                onChange={(e) => setNewTicket({ ...newTicket, booking_ref: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="nt-note">First internal note (optional)</Label>
              <Textarea
                id="nt-note"
                value={newTicket.note}
                onChange={(e) => setNewTicket({ ...newTicket, note: e.target.value })}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setCreateOpen(false)}>Cancel</Button>
            <Button disabled={busy} onClick={() => void createTicket()}>
              {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Create ticket
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
