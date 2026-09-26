/**
 * CALENDAR — the month, week and day view of real commitments.
 *
 * Nothing here is a private diary entry: every dot on the calendar is a work
 * item or meeting recorded against this person in the work spine and the
 * commercial book, with the date the record itself carries. If a record has no
 * date, it is listed as undated rather than placed on a day it never had.
 */
import MeetingScheduler from "@/components/staff/meetings/MeetingScheduler";
import * as React from "react";
import { Link } from "react-router-dom";
import { CalendarDays, ChevronLeft, ChevronRight, Clock, Loader2, RefreshCw } from "lucide-react";

import { StaffPageHeader } from "@/components/staff/primitives";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import { useWorkspaceIntelligence } from "@/hooks/useWorkspaceIntelligence";
import { WorkspaceEmptyState } from "@/components/staff/workspace/WorkspaceEmptyState";
import type { WorkspaceItem } from "@/lib/workspace/intelligence";

/* ---------------------------------------------------------------- */

interface Entry {
  key: string;
  day: string;            // yyyy-mm-dd, local
  at: string | null;      // ISO
  title: string;
  subject: string | null;
  kind: "meeting" | "work";
  overdue: boolean;
  to: string;
  minutes: number;
}

const dayKey = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

const timeText = (iso: string | null) =>
  iso ? new Date(iso).toLocaleTimeString("en-KE", { hour: "2-digit", minute: "2-digit" }) : "No time recorded";

const MEETING_HINT = /(meeting|meet\b|call with|site visit|presentation|review with)/i;

function toEntries(items: readonly WorkspaceItem[], now: Date): { dated: Entry[]; undated: WorkspaceItem[] } {
  const dated: Entry[] = [];
  const undated: WorkspaceItem[] = [];
  for (const i of items) {
    if (!i.dueAt) {
      undated.push(i);
      continue;
    }
    const at = new Date(i.dueAt);
    if (Number.isNaN(at.getTime())) {
      undated.push(i);
      continue;
    }
    dated.push({
      key: i.key,
      day: dayKey(at),
      at: i.dueAt,
      title: i.title,
      subject: i.subject,
      kind: MEETING_HINT.test(i.title) ? "meeting" : "work",
      overdue: at.getTime() < now.getTime(),
      to: i.primaryAction.to,
      minutes: i.minutes,
    });
  }
  dated.sort((a, b) => (a.at ?? "").localeCompare(b.at ?? ""));
  return { dated, undated };
}

/** Six-week grid starting on the Monday of the week containing the 1st. */
function monthGrid(anchor: Date): Date[] {
  const first = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
  const offset = (first.getDay() + 6) % 7; // Monday-first
  const start = new Date(first);
  start.setDate(first.getDate() - offset);
  return Array.from({ length: 42 }, (_, n) => {
    const d = new Date(start);
    d.setDate(start.getDate() + n);
    return d;
  });
}

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function EntryRow({ entry }: { entry: Entry }) {
  return (
    <Link
      to={entry.to}
      className="block rounded-md border p-2.5 transition-colors hover:bg-muted/60"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="truncate text-sm font-medium">{entry.title}</div>
          <div className="truncate text-xs text-muted-foreground">
            {entry.subject ?? "No account recorded"} · {entry.minutes} min
          </div>
        </div>
        <div className="shrink-0 text-right">
          <div className="inline-flex items-center gap-1 text-xs text-muted-foreground">
            <Clock className="h-3 w-3" aria-hidden /> {timeText(entry.at)}
          </div>
          <div className="mt-1 flex justify-end gap-1">
            {entry.kind === "meeting" && (
              <Badge variant="outline" className="text-[10px]">Meeting</Badge>
            )}
            {entry.overdue && (
              <Badge variant="outline" className="border-destructive/40 text-[10px] text-destructive">
                Past due
              </Badge>
            )}
          </div>
        </div>
      </div>
    </Link>
  );
}

/* ---------------------------------------------------------------- */

export default function StaffCalendar() {
  const { items, loading, identityMissing, reload } = useWorkspaceIntelligence();
  const now = React.useMemo(() => new Date(), []);
  const [anchor, setAnchor] = React.useState(() => new Date());
  const [selected, setSelected] = React.useState(() => dayKey(new Date()));

  const { dated, undated } = React.useMemo(() => toEntries(items, now), [items, now]);

  const byDay = React.useMemo(() => {
    const map = new Map<string, Entry[]>();
    for (const e of dated) {
      const list = map.get(e.day) ?? [];
      list.push(e);
      map.set(e.day, list);
    }
    return map;
  }, [dated]);

  const grid = React.useMemo(() => monthGrid(anchor), [anchor]);
  const monthLabel = anchor.toLocaleDateString("en-KE", { month: "long", year: "numeric" });

  const weekDays = React.useMemo(() => {
    const base = new Date(anchor);
    const offset = (base.getDay() + 6) % 7;
    const start = new Date(base);
    start.setDate(base.getDate() - offset);
    return Array.from({ length: 7 }, (_, n) => {
      const d = new Date(start);
      d.setDate(start.getDate() + n);
      return d;
    });
  }, [anchor]);

  const selectedEntries = byDay.get(selected) ?? [];
  const monthCount = dated.filter(
    (e) => e.day.slice(0, 7) === `${anchor.getFullYear()}-${String(anchor.getMonth() + 1).padStart(2, "0")}`,
  ).length;

  const step = (months: number) => {
    const next = new Date(anchor);
    next.setDate(1);
    next.setMonth(next.getMonth() + months);
    setAnchor(next);
  };

  if (identityMissing) {
    return (
      <>
        <StaffPageHeader eyebrow="My work" title="Calendar" />
        <WorkspaceEmptyState
          title="Your staff record is not linked to this login"
          message="Your calendar is built from work recorded against your staff record, so nothing can be shown until an administrator links it."
        />
      </>
    );
  }

  return (
    <>
      <StaffPageHeader
        eyebrow="My work"
        title="Calendar"
        lede="Every commitment with a date, from your work queue, meetings and commercial book. Open a day to see what it holds."
        actions={
          <Button variant="outline" size="sm" onClick={reload} disabled={loading}>
            {loading ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-1.5 h-4 w-4" />}
            Refresh
          </Button>
        }
      />

      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Button variant="outline" size="icon" aria-label="Previous month" onClick={() => step(-1)}>
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <div className="min-w-40 text-center text-sm font-semibold">{monthLabel}</div>
          <Button variant="outline" size="icon" aria-label="Next month" onClick={() => step(1)}>
            <ChevronRight className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              const t = new Date();
              setAnchor(t);
              setSelected(dayKey(t));
            }}
          >
            Today
          </Button>
        </div>
        <p className="text-sm text-muted-foreground">
          {loading ? "Reading your commitments…" : `${monthCount} dated ${monthCount === 1 ? "commitment" : "commitments"} this month`}
        </p>
      </div>

      <Tabs defaultValue="month">
        <TabsList>
          <TabsTrigger value="month">Month</TabsTrigger>
          <TabsTrigger value="week">Week</TabsTrigger>
          <TabsTrigger value="undated">Undated</TabsTrigger>
        </TabsList>

        <TabsContent value="month" className="mt-6">
          <div className="grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
            <Card>
              <CardContent className="p-3">
                <div className="grid grid-cols-7 gap-1">
                  {WEEKDAYS.map((d) => (
                    <div key={d} className="pb-1 text-center text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                      {d}
                    </div>
                  ))}
                  {grid.map((d) => {
                    const key = dayKey(d);
                    const entries = byDay.get(key) ?? [];
                    const inMonth = d.getMonth() === anchor.getMonth();
                    const isToday = key === dayKey(now);
                    const overdue = entries.some((e) => e.overdue);
                    return (
                      <button
                        key={key}
                        type="button"
                        onClick={() => setSelected(key)}
                        className={cn(
                          "flex min-h-16 flex-col items-start gap-1 rounded-md border p-1.5 text-left transition-colors",
                          inMonth ? "bg-card" : "bg-muted/30 text-muted-foreground",
                          key === selected && "border-primary ring-1 ring-primary",
                          isToday && key !== selected && "border-primary/50",
                        )}
                        aria-label={`${d.toDateString()} — ${entries.length} commitments`}
                      >
                        <span className={cn("text-xs font-semibold", isToday && "text-primary")}>{d.getDate()}</span>
                        {entries.length > 0 && (
                          <span
                            className={cn(
                              "rounded px-1.5 py-0.5 text-[10px] font-medium",
                              overdue ? "bg-destructive/10 text-destructive" : "bg-primary/10 text-primary",
                            )}
                          >
                            {entries.length}
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">
                  {new Date(`${selected}T00:00:00`).toLocaleDateString("en-KE", {
                    weekday: "long", day: "numeric", month: "long",
                  })}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {selectedEntries.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Nothing is recorded for this day.</p>
                ) : (
                  selectedEntries.map((e) => <EntryRow key={e.key} entry={e} />)
                )}
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="week" className="mt-6">
          <div className="grid gap-3 md:grid-cols-7">
            {weekDays.map((d) => {
              const key = dayKey(d);
              const entries = byDay.get(key) ?? [];
              return (
                <Card key={key} className={cn(key === dayKey(now) && "border-primary/50")}>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm">
                      {d.toLocaleDateString("en-KE", { weekday: "short", day: "numeric" })}
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-2">
                    {entries.length === 0 ? (
                      <p className="text-xs text-muted-foreground">Clear</p>
                    ) : (
                      entries.map((e) => (
                        <Link
                          key={e.key}
                          to={e.to}
                          className={cn(
                            "block rounded-md border p-2 text-xs hover:bg-muted/60",
                            e.overdue && "border-destructive/40",
                          )}
                        >
                          <div className="font-medium leading-tight">{e.title}</div>
                          <div className="mt-0.5 text-muted-foreground">{timeText(e.at)}</div>
                        </Link>
                      ))
                    )}
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </TabsContent>

        <TabsContent value="undated" className="mt-6">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Commitments with no date recorded</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {undated.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  Everything assigned to you carries a date, so nothing is sitting outside the calendar.
                </p>
              ) : (
                undated.map((i) => (
                  <Link key={i.key} to={i.primaryAction.to} className="block rounded-md border p-2.5 hover:bg-muted/60">
                    <div className="text-sm font-medium">{i.title}</div>
                    <div className="text-xs text-muted-foreground">
                      {i.subject ?? "No account recorded"} · {i.why}
                    </div>
                  </Link>
                ))
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <section className="mt-8" aria-labelledby="book-client-meeting">
        <h2 id="book-client-meeting" className="mb-1 text-lg font-semibold">Book a meeting with a client</h2>
        <p className="mb-4 text-sm text-muted-foreground">
          Pick a time, add the client's email and choose Google Meet. A Meet link is created for you, the event lands on
          your calendar, and the client receives an invitation they can accept straight into their own calendar.
        </p>
        <MeetingScheduler defaultKind="client" />
      </section>

      <p className="mt-6 inline-flex items-center gap-2 text-xs text-muted-foreground">
        <CalendarDays className="h-3.5 w-3.5" aria-hidden />
        Meeting preparation and outcomes are recorded on the{" "}
        <Link to="/staff/workspace/meetings" className="underline">Meetings</Link> page.
      </p>
    </>
  );
}
