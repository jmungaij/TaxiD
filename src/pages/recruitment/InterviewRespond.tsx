/**
 * Public candidate response — /recruitment/respond?token=…
 *
 * The candidate confirms, asks to reschedule, or declines an interview using a
 * single-use token that only exists as a hash in the database. The token is
 * inspected first so the candidate sees exactly what they are responding to,
 * and the response itself is applied by a governed database function which
 * enforces expiry, single use and versioned supersession (a superseded
 * invitation can no longer be answered).
 */
import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Helmet } from "react-helmet-async";
import { CalendarClock, CheckCircle2, Clock, Loader2, XCircle } from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  inspectCandidateToken,
  respondToInvitation,
  type CandidateActionContext,
  type CandidateResponse,
} from "@/lib/recruitment/lettersPublic";
import { CONTACT } from "@/config/contact";

const INVALID_COPY: Record<string, string> = {
  not_found: "This response link is not recognised. It may have been replaced by a newer invitation.",
  expired: "This response link has expired. Please contact us and we will re-issue your invitation.",
  superseded: "A newer invitation has been issued, so this link is no longer active.",
};

const RESPONSE_COPY: Record<CandidateResponse, string> = {
  confirmed: "Thank you — your attendance is confirmed and the panel has been notified.",
  reschedule_requested: "Thank you — your reschedule request has been sent to the recruitment team.",
  declined: "Thank you for letting us know. Your response has been recorded.",
};

export default function InterviewRespond() {
  const [params] = useSearchParams();
  const token = params.get("token") ?? "";

  const [context, setContext] = useState<CandidateActionContext | null>(null);
  const [loading, setLoading] = useState(Boolean(token));
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState<CandidateResponse | null>(null);
  const [outcome, setOutcome] = useState<CandidateResponse | null>(null);

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setError(null);
    try {
      setContext(await inspectCandidateToken(token));
    } catch (e) {
      setError(e instanceof Error ? e.message : "We could not open this invitation.");
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => { void load(); }, [load]);

  const submit = async (response: CandidateResponse) => {
    if (response === "reschedule_requested" && !note.trim()) {
      setError("Please tell us which times would work so we can reschedule.");
      return;
    }
    setBusy(response);
    setError(null);
    try {
      await respondToInvitation(token, response, note.trim() || undefined);
      setOutcome(response);
      await load();
    } catch (e) {
      const message = e instanceof Error ? e.message : "Your response could not be recorded.";
      setError(INVALID_COPY[message] ?? message);
    } finally {
      setBusy(null);
    }
  };

  const interview = context?.interview;
  const answered = Boolean(outcome) || Boolean(context?.already_responded);

  return (
    <main className="min-h-screen bg-background px-4 py-16">
      <Helmet>
        <title>Respond to your Yalla Mobility interview invitation</title>
        <meta
          name="description"
          content="Confirm, reschedule or decline your Yalla Mobility interview invitation using the secure link issued with your letter."
        />
        <meta name="robots" content="noindex,nofollow" />
      </Helmet>

      <div className="mx-auto w-full max-w-2xl">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-primary">
          Yalla Mobility · Recruitment
        </p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight">Interview response</h1>

        {!token && (
          <p className="mt-4 text-sm text-muted-foreground">
            This page needs the secure link sent with your invitation letter. Please open the link from
            your email, or contact {CONTACT.supportEmail} for a new one.
          </p>
        )}

        {loading && (
          <div className="mt-8 space-y-3">
            <Skeleton className="h-8 w-1/2" />
            <Skeleton className="h-24 w-full" />
          </div>
        )}

        {!loading && context && !context.valid && (
          <Card className="mt-8 border-destructive/40">
            <CardContent className="pt-6">
              <p className="flex items-center gap-2 font-semibold text-destructive">
                <Clock className="h-4 w-4" aria-hidden="true" /> Link no longer active
              </p>
              <p className="mt-2 text-sm text-muted-foreground">
                {INVALID_COPY[context.reason ?? ""] ?? "This response link is no longer valid."}
              </p>
              <p className="mt-3 text-sm text-muted-foreground">
                Email {CONTACT.supportEmail} or call {CONTACT.phoneDisplay} and we will help.
              </p>
            </CardContent>
          </Card>
        )}

        {!loading && context?.valid && (
          <Card className="mt-8">
            <CardHeader>
              <CardTitle className="text-base">
                {context.vacancy_title ? `Interview — ${context.vacancy_title}` : "Your interview"}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-5">
              <dl className="grid gap-3 text-sm sm:grid-cols-2">
                <div>
                  <dt className="text-xs text-muted-foreground">Candidate</dt>
                  <dd className="font-medium">{context.candidate_name ?? "—"}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">Letter reference</dt>
                  <dd className="font-medium">{context.document_ref ?? "—"}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">Scheduled</dt>
                  <dd className="font-medium">
                    {interview?.scheduled_at
                      ? new Date(interview.scheduled_at).toLocaleString()
                      : "To be confirmed"}
                    {interview?.timezone ? ` (${interview.timezone})` : ""}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">Format</dt>
                  <dd className="font-medium">
                    {interview?.mode ? interview.mode.replace(/_/g, " ") : "—"}
                    {interview?.duration_minutes ? ` · ${interview.duration_minutes} minutes` : ""}
                  </dd>
                </div>
                {interview?.location && (
                  <div className="sm:col-span-2">
                    <dt className="text-xs text-muted-foreground">Location</dt>
                    <dd className="font-medium">{interview.location}</dd>
                  </div>
                )}
                {interview?.meeting_link && (
                  <div className="sm:col-span-2">
                    <dt className="text-xs text-muted-foreground">Meeting link</dt>
                    <dd className="break-all font-medium">{interview.meeting_link}</dd>
                  </div>
                )}
              </dl>

              {answered ? (
                <div className="rounded-md border border-success/40 bg-success/5 p-4" role="status" aria-live="polite">
                  <p className="flex items-center gap-2 font-semibold text-success">
                    <CheckCircle2 className="h-4 w-4" aria-hidden="true" /> Response recorded
                  </p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {RESPONSE_COPY[(outcome ?? context.previous_action) as CandidateResponse] ??
                      "Your response has been recorded."}
                  </p>
                  {context.previous_action && (
                    <Badge variant="outline" className="mt-2 text-[10px]">
                      {context.previous_action.replace(/_/g, " ")}
                    </Badge>
                  )}
                </div>
              ) : (
                <>
                  <div>
                    <Label htmlFor="respond-note">
                      Message for the recruitment team (required if you need another time)
                    </Label>
                    <Textarea
                      id="respond-note"
                      rows={4}
                      value={note}
                      onChange={(e) => setNote(e.target.value)}
                      placeholder="For example: I am available Tuesday or Wednesday after 2pm."
                    />
                  </div>

                  {error && (
                    <p className="text-sm text-destructive" role="alert">{error}</p>
                  )}

                  <div className="flex flex-wrap gap-3">
                    <Button onClick={() => void submit("confirmed")} disabled={busy !== null}>
                      {busy === "confirmed"
                        ? <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
                        : <CheckCircle2 className="mr-2 h-4 w-4" aria-hidden="true" />}
                      Confirm my attendance
                    </Button>
                    <Button
                      variant="outline"
                      onClick={() => void submit("reschedule_requested")}
                      disabled={busy !== null}
                    >
                      <CalendarClock className="mr-2 h-4 w-4" aria-hidden="true" />
                      Request a different time
                    </Button>
                    <Button
                      variant="ghost"
                      onClick={() => void submit("declined")}
                      disabled={busy !== null}
                    >
                      <XCircle className="mr-2 h-4 w-4" aria-hidden="true" />
                      Decline this interview
                    </Button>
                  </div>
                </>
              )}
            </CardContent>
          </Card>
        )}

        {!loading && error && !context && (
          <p className="mt-6 text-sm text-destructive" role="alert">{error}</p>
        )}

        <p className="mt-6 text-xs text-muted-foreground">
          Need help? Email {CONTACT.supportEmail} or call {CONTACT.phoneDisplay}.
        </p>
      </div>
    </main>
  );
}
