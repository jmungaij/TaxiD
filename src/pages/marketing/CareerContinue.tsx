/**
 * Candidate remediation centre — `/careers/continue?token=…`
 *
 * Reached from the message we send when OUR platform blocked a candidate. The
 * token is the credential: it resolves exactly one preserved application. The
 * page shows what was saved, which documents are already held, what is still
 * outstanding, and hands the candidate back into the application form on a
 * verified-current bundle.
 */
import { useEffect, useMemo } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, ArrowRight, CheckCircle2, FileCheck2, RefreshCw } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { MarketingPage } from "@/components/marketing/PageHero";
import {
  fetchRemediationCase,
  markRemediationResumed,
  remediationCauseCopy,
} from "@/lib/recruitment/candidateRemediation";
import { reloadToCurrentBuild } from "@/lib/recruitment/careersContract";
import { PUBLIC_VACANCY_QUERY_OPTIONS } from "@/lib/recruitment/publicApi";

export default function CareerContinue() {
  const [params] = useSearchParams();
  const token = params.get("token") ?? "";

  const caseQuery = useQuery({
    queryKey: ["public", "remediation-case", token],
    queryFn: () => fetchRemediationCase(token),
    enabled: token.length > 0,
    ...PUBLIC_VACANCY_QUERY_OPTIONS,
  });

  const found = caseQuery.data?.found === true;

  useEffect(() => {
    if (found) void markRemediationResumed(token);
  }, [found, token]);

  const copy = useMemo(() => remediationCauseCopy(caseQuery.data?.cause), [caseQuery.data?.cause]);

  if (!token) {
    return (
      <MarketingPage>
        <div className="container mx-auto px-4 py-24 max-w-2xl text-center">
          <h1 className="text-2xl font-bold mb-3">This link is incomplete</h1>
          <p className="text-muted-foreground mb-6">
            Open the link exactly as it appears in the message we sent you — it carries a private reference to your
            saved application.
          </p>
          <Button asChild><Link to="/careers">View current openings</Link></Button>
        </div>
      </MarketingPage>
    );
  }

  if (caseQuery.isLoading) {
    return (
      <MarketingPage>
        <div className="container mx-auto px-4 py-24 max-w-3xl space-y-4">
          <Skeleton className="h-10 w-2/3" /><Skeleton className="h-64" />
        </div>
      </MarketingPage>
    );
  }

  if (!found) {
    return (
      <MarketingPage>
        <div className="container mx-auto px-4 py-24 max-w-2xl text-center">
          <h1 className="text-2xl font-bold mb-3">We could not open this saved application</h1>
          <p className="text-muted-foreground mb-6">
            The link may have been retyped or truncated. Reply to the message we sent you and our recruitment team
            will restore your application.
          </p>
          <Button asChild><Link to="/careers">View current openings</Link></Button>
        </div>
      </MarketingPage>
    );
  }

  const c = caseQuery.data!;
  const applyPath = c.vacancy_slug ? `/careers/${c.vacancy_slug}/apply` : "/careers";
  const docs = c.documents_preserved ?? [];
  const missing = c.missing ?? [];
  const completed = c.status === "COMPLETED";

  return (
    <MarketingPage>
      <div className="container mx-auto px-4 py-20 max-w-3xl">
        <Badge variant="secondary" className="mb-4">Application reference {c.case_id?.slice(0, 8)}</Badge>
        <h1 className="text-3xl font-bold mb-3">{completed ? "Your application is complete" : copy.title}</h1>
        <p className="text-muted-foreground mb-8">
          {completed
            ? `We have received your application for ${c.vacancy_title ?? "this role"}. No further action is needed.`
            : copy.detail}
        </p>

        <div className="rounded-xl border border-border bg-card p-6 mb-6">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground mb-4">
            What we are holding for you
          </h2>
          <dl className="grid gap-3 sm:grid-cols-2 text-sm">
            <div>
              <dt className="text-muted-foreground">Role</dt>
              <dd className="font-medium">{c.vacancy_title ?? c.vacancy_slug ?? "—"}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Your email</dt>
              <dd className="font-medium break-all">{c.email}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Attempts preserved</dt>
              <dd className="font-medium tabular-nums">{c.attempt_count ?? 1}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Last saved</dt>
              <dd className="font-medium">
                {c.last_failed_at ? new Date(c.last_failed_at).toLocaleString() : "—"}
              </dd>
            </div>
          </dl>
        </div>

        <div className="rounded-xl border border-border bg-card p-6 mb-6">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground mb-4">
            Documents already received
          </h2>
          {docs.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No documents were captured before the interruption — you will be asked for them once.
            </p>
          ) : (
            <ul className="space-y-2">
              {docs.map((d, i) => (
                <li key={`${d.storage_path}-${i}`} className="flex items-start gap-2 text-sm">
                  <FileCheck2 className="h-4 w-4 mt-0.5 text-primary" aria-hidden="true" />
                  <span>
                    <span className="font-medium">{d.file_name}</span>
                    <span className="text-muted-foreground"> · {d.doc_key ?? d.doc_type}</span>
                    <span className="text-muted-foreground"> · verified and reusable</span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>

        {missing.length > 0 && (
          <div className="rounded-xl border border-border bg-card p-6 mb-6">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground mb-4">
              Still outstanding
            </h2>
            <ul className="space-y-2">
              {missing.map((m) => (
                <li key={m} className="flex items-start gap-2 text-sm">
                  <AlertTriangle className="h-4 w-4 mt-0.5 text-warning" aria-hidden="true" />
                  <span>{m}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {completed ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <CheckCircle2 className="h-4 w-4 text-primary" aria-hidden="true" />
            Submitted {c.completed_at ? new Date(c.completed_at).toLocaleString() : ""}
          </div>
        ) : (
          <div className="flex flex-wrap gap-3">
            <Button asChild disabled={!c.vacancy_open}>
              <Link to={`${applyPath}?resume=${c.case_id}`}>
                Continue my application <ArrowRight className="ml-2 h-4 w-4" aria-hidden="true" />
              </Link>
            </Button>
            <Button variant="outline" onClick={() => void reloadToCurrentBuild()}>
              <RefreshCw className="mr-2 h-4 w-4" aria-hidden="true" />
              Load the latest form
            </Button>
            <Button variant="ghost" asChild><Link to="/careers">Other openings</Link></Button>
          </div>
        )}

        {!c.vacancy_open && !completed && (
          <p className="mt-6 text-sm text-muted-foreground">
            This role has since closed for applications. Your details remain with our recruitment team for comparable
            openings.
          </p>
        )}
      </div>
    </MarketingPage>
  );
}
