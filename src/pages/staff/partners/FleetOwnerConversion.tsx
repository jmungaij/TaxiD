/**
 * PARTNER APPLICATION → FLEET OWNER CONVERSION — staff console.
 *
 * Every row is a real `partner_applications` record. Nothing is counted from a
 * constant, no state is inferred from the applicant's own text, and refusals
 * stay on screen until the operator acts on them. Conversion hands the case to
 * the existing Fleet Owner application chain — it never approves anything.
 */
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowUpRight, Loader2, ShieldAlert } from "lucide-react";
import { toast } from "sonner";

import { StaffPageHeader } from "@/components/staff/primitives";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import {
  REVIEW_ACTION_LABEL, convertToFleetOwner, listPartnerApplicationCases,
  listPartnerApplicationEvents, refusalText, reviewPartnerApplication,
  type PartnerApplicationCase, type PartnerReviewAction,
} from "@/lib/partners/conversion";

const STAGE_ORDER = ["NEW", "UNDER_REVIEW", "INFO_REQUESTED", "QUALIFIED", "ONBOARDING", "REJECTED"] as const;
type Stage = (typeof STAGE_ORDER)[number];

const stageOf = (a: PartnerApplicationCase): Stage =>
  (a.review_status as Stage | null) ?? "NEW";

const ACTIONS: PartnerReviewAction[] = ["REVIEW", "REQUEST_INFO", "QUALIFY", "REJECT"];

function ApplicationCard({ app }: { app: PartnerApplicationCase }) {
  const qc = useQueryClient();
  const [note, setNote] = useState("");
  const [refusal, setRefusal] = useState<string | null>(null);
  const [openLog, setOpenLog] = useState(false);

  const events = useQuery({
    queryKey: ["partner-app-events", app.id],
    queryFn: () => listPartnerApplicationEvents(app.id),
    enabled: openLog,
  });

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ["partner-app-cases"] });
    void qc.invalidateQueries({ queryKey: ["partner-app-events", app.id] });
  };

  const review = useMutation({
    mutationFn: (action: PartnerReviewAction) => reviewPartnerApplication(app.id, action, note || null),
    onSuccess: (res) => {
      if (res.ok) {
        setRefusal(null);
        setNote("");
        toast.success(`Application ${app.reference} → ${String(res.status)}`);
      } else {
        setRefusal(refusalText(res));
      }
      invalidate();
    },
    onError: (e: Error) => setRefusal(e.message),
  });

  const convert = useMutation({
    mutationFn: () => convertToFleetOwner(app.id),
    onSuccess: (res) => {
      if (res.ok) {
        setRefusal(null);
        toast.success(
          res.already_converted
            ? `Already converted — ${String(res.application_reference)}`
            : `Fleet Owner application ${String(res.application_reference)} created`,
        );
      } else {
        setRefusal(refusalText(res));
      }
      invalidate();
    },
    onError: (e: Error) => setRefusal(e.message),
  });

  const busy = review.isPending || convert.isPending;
  const stage = stageOf(app);

  return (
    <li className="space-y-3 py-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-medium">{app.organisation_name}</p>
          <p className="text-xs text-muted-foreground">
            <span className="font-mono">{app.reference}</span> · {app.contact_name} · {app.contact_email} ·{" "}
            {app.contact_phone}
          </p>
          <p className="text-xs text-muted-foreground">
            {[app.city, app.country, app.partner_type, app.network_category, app.maturity_level]
              .filter(Boolean)
              .join(" · ") || "No location or category recorded"}
          </p>
          {app.intent_bring ? (
            <p className="mt-1 text-xs text-muted-foreground">Brings: {app.intent_bring}</p>
          ) : null}
          {app.requirements ? (
            <p className="mt-1 text-xs text-muted-foreground">Stated needs: {app.requirements}</p>
          ) : null}
        </div>
        <div className="flex flex-col items-end gap-1">
          <Badge variant="outline" className="text-[10px] uppercase">{stage.split("_").join(" ")}</Badge>
          {app.carrier_application_id ? (
            <Badge variant="outline" className="border-success/50 text-[10px] text-success">
              Fleet Owner application created
            </Badge>
          ) : null}
        </div>
      </div>

      {app.review_notes ? (
        <p className="rounded-md bg-muted/50 p-2 text-xs text-muted-foreground">
          Last review note: {app.review_notes}
        </p>
      ) : null}

      {refusal ? (
        <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/5 p-2 text-xs text-destructive">
          <ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
          <span>{refusal}</span>
        </div>
      ) : null}

      <Textarea
        value={note}
        onChange={(e) => setNote(e.target.value)}
        rows={2}
        placeholder="Review note — required to request information or reject"
        className="text-xs"
      />

      <div className="flex flex-wrap gap-2">
        {ACTIONS.map((a) => (
          <Button
            key={a}
            size="sm"
            variant={a === "QUALIFY" ? "default" : a === "REJECT" ? "outline" : "outline"}
            disabled={busy}
            onClick={() => review.mutate(a)}
          >
            {review.isPending ? <Loader2 className="mr-1 h-3 w-3 animate-spin" aria-hidden /> : null}
            {REVIEW_ACTION_LABEL[a]}
          </Button>
        ))}
        <Button size="sm" disabled={busy} onClick={() => convert.mutate()}>
          {convert.isPending ? <Loader2 className="mr-1 h-3 w-3 animate-spin" aria-hidden /> : null}
          Create Fleet Owner application
        </Button>
        {app.carrier_application_id ? (
          <Button size="sm" variant="ghost" asChild>
            <Link to="/dashboard/admin/carrier-applications">
              Open onboarding queue <ArrowUpRight className="ml-1 h-3 w-3" aria-hidden />
            </Link>
          </Button>
        ) : null}
        <Button size="sm" variant="ghost" onClick={() => setOpenLog((o) => !o)}>
          {openLog ? "Hide history" : "Review history"}
        </Button>
      </div>

      {openLog ? (
        <div className="rounded-md border p-2">
          {events.isLoading ? (
            <Skeleton className="h-10 w-full" />
          ) : events.data && events.data.length > 0 ? (
            <ul className="space-y-1 text-xs text-muted-foreground">
              {events.data.map((e) => (
                <li key={e.id}>
                  <span className="font-mono">{new Date(e.created_at).toLocaleString()}</span> · {e.action}
                  {e.status_from || e.status_to ? ` · ${e.status_from ?? "—"} → ${e.status_to ?? "—"}` : ""}
                  {e.note ? ` · ${e.note}` : ""}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-xs text-muted-foreground">No review actions recorded yet.</p>
          )}
        </div>
      ) : null}
    </li>
  );
}

export default function FleetOwnerConversion() {
  const cases = useQuery({ queryKey: ["partner-app-cases"], queryFn: listPartnerApplicationCases });

  const counts = useMemo(() => {
    const rows = cases.data ?? [];
    const map = new Map<Stage, number>();
    for (const s of STAGE_ORDER) map.set(s, 0);
    for (const r of rows) map.set(stageOf(r), (map.get(stageOf(r)) ?? 0) + 1);
    return map;
  }, [cases.data]);

  return (
    <div className="space-y-6 p-6">
      <StaffPageHeader
        title="Partner interest → Fleet Owner onboarding"
        lede="Review public partner applications and convert qualified ones into Fleet Owner applications. Conversion creates the onboarding case only — approval, compliance and activation stay where they are."
      />

      {cases.isLoading ? (
        <Skeleton className="h-24 w-full" />
      ) : cases.error ? (
        <Card className="border-destructive/40">
          <CardContent className="pt-6 text-sm text-destructive">
            Could not load partner applications: {(cases.error as Error).message}
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
            {STAGE_ORDER.map((s) => (
              <Card key={s}>
                <CardContent className="pt-5">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                    {s.split("_").join(" ")}
                  </p>
                  <p className="mt-1 text-2xl font-semibold tabular-nums">{counts.get(s) ?? 0}</p>
                </CardContent>
              </Card>
            ))}
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Applications ({cases.data?.length ?? 0})</CardTitle>
            </CardHeader>
            <CardContent>
              {(cases.data?.length ?? 0) === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No partner applications have been submitted yet.
                </p>
              ) : (
                <ul className="divide-y">
                  {cases.data!.map((a) => (
                    <ApplicationCard key={a.id} app={a} />
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
