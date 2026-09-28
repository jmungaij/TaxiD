/**
 * KENYA CORPORATE ADMIN PORTAL.
 *
 * One place for a TaxiD manager to act on business accounts:
 *   • applications awaiting a decision (approve / decline, with the reason kept),
 *   • the documents each application submitted and their scan state,
 *   • verified organisations, their account settings, and the sign-in rules
 *     their own administrators have proposed.
 *
 * Nothing here is decided in the browser. Applications are decided by the
 * corporate-kyb-review function (which also provisions the organisation, its
 * first administrator and their access on approval); settings and sign-in rules
 * go through corp_admin_org_settings_update and corp_admin_signin_policy_decide,
 * both of which re-check the caller's role server-side and write to the admin
 * action log.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { untypedDb } from "@/integrations/supabase/untyped";
import { RequireRole } from "@/components/auth/RequireRole";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { toast } from "sonner";
import {
  Building2, CheckCircle2, FileCheck, Loader2, RefreshCw, ShieldCheck, XCircle, Info, ExternalLink,
} from "lucide-react";

interface DraftRow {
  id: string;
  status: string;
  decision: string | null;
  submitted_at: string | null;
  business_registration_type: string | null;
  business_info: Record<string, unknown> | null;
  personal_info: Record<string, unknown> | null;
}
interface DocRow {
  id: string;
  slot_key: string;
  original_name: string | null;
  scan_status: string | null;
  verification_status: string | null;
  uploaded_at: string | null;
}
interface OrgRow {
  id: string;
  legal_name: string;
  trading_name: string | null;
  kra_pin: string | null;
  status: string;
  billing_email: string | null;
  credit_limit_cents: number | null;
  payment_terms_days: number | null;
  created_at: string;
}
interface PolicyRow {
  id: string;
  corporate_id: string | null;
  version: number;
  state: string;
  email_domains: string[] | null;
  password_enabled: boolean;
  passwordless_enabled: boolean;
  google_enabled: boolean;
  mfa_required: boolean;
  session_idle_minutes: number;
  session_absolute_hours: number;
  note: string | null;
  created_at: string;
}

const money = (cents: number | null | undefined) =>
  `KSh ${((cents ?? 0) / 100).toLocaleString("en-KE", { maximumFractionDigits: 0 })}`;

const when = (v: string | null | undefined) =>
  v ? new Date(v).toLocaleString("en-KE", { timeZone: "Africa/Nairobi" }) : "—";

const slotLabel = (key: string) => key.split("_").join(" ");

async function api<T = unknown>(op: string, extra: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await supabase.functions.invoke("corporate-kyb-review", {
    body: { op, ...extra },
  });
  if (error) throw new Error(error.message || "request_failed");
  return data as T;
}

export default function CorporateAdminPortal() {
  return (
    <RequireRole roles={["admin", "super_admin", "compliance_admin"]}>
      <Inner />
    </RequireRole>
  );
}

function Inner() {
  const [loading, setLoading] = useState(true);
  const [drafts, setDrafts] = useState<DraftRow[]>([]);
  const [docs, setDocs] = useState<Record<string, DocRow[]>>({});
  const [orgs, setOrgs] = useState<OrgRow[]>([]);
  const [policies, setPolicies] = useState<PolicyRow[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [reason, setReason] = useState<Record<string, string>>({});
  const [edit, setEdit] = useState<Record<string, { credit: string; terms: string }>>({});

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [list, orgRes, polRes] = await Promise.all([
        api<{ drafts: DraftRow[] }>("list", { status: "submitted" }).catch(() => ({ drafts: [] })),
        untypedDb
          .from("corporate_accounts")
          .select(
            "id,legal_name,trading_name,kra_pin,status,billing_email,credit_limit_cents,payment_terms_days,created_at",
          )
          .order("created_at", { ascending: false })
          .limit(100),
        untypedDb
          .from("identity_auth_policies")
          .select(
            "id,corporate_id,version,state,email_domains,password_enabled,passwordless_enabled,google_enabled,mfa_required,session_idle_minutes,session_absolute_hours,note,created_at",
          )
          .eq("scope", "ORGANISATION")
          .order("version", { ascending: false })
          .limit(200),
      ]);
      const rows = list.drafts ?? [];
      setDrafts(rows);
      setOrgs((orgRes.data ?? []) as OrgRow[]);
      setPolicies((polRes.data ?? []) as PolicyRow[]);

      // Documents for each waiting application, so a manager sees what arrived
      // without opening every submission one by one.
      const pairs = await Promise.all(
        rows.slice(0, 12).map(async (d) => {
          try {
            const res = await api<{ documents: DocRow[] }>("get", { draft_id: d.id });
            return [d.id, res.documents ?? []] as const;
          } catch {
            return [d.id, []] as const;
          }
        }),
      );
      setDocs(Object.fromEntries(pairs));
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const decide = async (draftId: string, decision: "approved" | "rejected") => {
    const note = (reason[draftId] ?? "").trim();
    if (decision === "rejected" && note.length < 3) {
      toast.error("A reason is required when declining an application");
      return;
    }
    setBusy(draftId);
    try {
      await api("decide_draft", { draft_id: draftId, decision, reason: note || null });
      toast.success(
        decision === "approved"
          ? "Approved — organisation, first administrator and access created"
          : "Application declined; the applicant has been told why",
      );
      setReason((r) => ({ ...r, [draftId]: "" }));
      await load();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const savePolicy = async (policyId: string, decision: "approved" | "rejected") => {
    setBusy(policyId);
    try {
      const { data, error } = await untypedDb.rpc("corp_admin_signin_policy_decide", {
        _policy_id: policyId,
        _decision: decision,
        _note: null,
      });
      if (error) throw new Error(error.message);
      const res = data as { ok?: boolean; reason?: string } | null;
      if (!res?.ok) throw new Error(res?.reason ?? "refused");
      toast.success(decision === "approved" ? "Sign-in rules are now in force" : "Proposal declined");
      await load();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const saveSettings = async (orgId: string) => {
    const form = edit[orgId];
    if (!form) return;
    setBusy(orgId);
    try {
      const { data, error } = await untypedDb.rpc("corp_admin_org_settings_update", {
        _corporate_id: orgId,
        _credit_limit_cents: form.credit === "" ? null : Math.round(Number(form.credit) * 100),
        _payment_terms_days: form.terms === "" ? null : Number(form.terms),
        _status: null,
      });
      if (error) throw new Error(error.message);
      const res = data as { ok?: boolean; reason?: string } | null;
      if (!res?.ok) throw new Error(res?.reason ?? "refused");
      toast.success("Account settings saved");
      setEdit((e) => { const { [orgId]: _drop, ...rest } = e; return rest; });
      await load();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const pendingDocs = useMemo(
    () =>
      Object.entries(docs).flatMap(([draftId, list]) =>
        list
          .filter((d) => (d.verification_status ?? "pending") === "pending")
          .map((d) => ({ ...d, draftId })),
      ),
    [docs],
  );

  const policiesByOrg = useMemo(() => {
    const m: Record<string, PolicyRow[]> = {};
    for (const p of policies) {
      if (!p.corporate_id) continue;
      (m[p.corporate_id] ??= []).push(p);
    }
    return m;
  }, [policies]);

  return (
    <div className="container mx-auto max-w-7xl px-4 py-6 space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold flex items-center gap-2">
            <Building2 className="h-6 w-6 text-primary" /> Corporate admin portal — Kenya
          </h1>
          <p className="text-sm text-muted-foreground">
            Approve business applications, see the documents they sent, and manage each verified
            organisation's account and sign-in rules.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button asChild size="sm" variant="outline">
            <Link to="/dashboard/admin/corporate-kyb">
              Full verification queue <ExternalLink className="ml-1 h-3 w-3" />
            </Link>
          </Button>
          <Button asChild size="sm" variant="outline">
            <Link to="/dashboard/corporate">
              Corporate dashboard <ExternalLink className="ml-1 h-3 w-3" />
            </Link>
          </Button>
          <Button size="sm" variant="outline" onClick={() => void load()} disabled={loading}>
            {loading ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
          </Button>
        </div>
      </div>

      {/* ----------------------------------------------------- applications */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm flex items-center gap-2">
            <FileCheck className="h-4 w-4 text-primary" /> Applications awaiting a decision ({drafts.length})
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {drafts.length === 0 ? (
            <p className="text-sm text-muted-foreground italic">
              {loading ? "Loading…" : "No business applications are waiting."}
            </p>
          ) : (
            drafts.map((d) => {
              const bi = (d.business_info ?? {}) as Record<string, string>;
              const pi = (d.personal_info ?? {}) as Record<string, string>;
              const list = docs[d.id] ?? [];
              return (
                <div key={d.id} className="rounded-lg border p-4 space-y-3">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <div className="font-medium">{bi.registered_name ?? "(no name given)"}</div>
                      <div className="text-xs text-muted-foreground">
                        {pi.full_name ?? "—"} · {pi.email ?? "—"} · submitted {when(d.submitted_at)}
                      </div>
                    </div>
                    <Badge variant="secondary">
                      {d.business_registration_type === "limited_company"
                        ? "Limited company"
                        : d.business_registration_type === "registered_business"
                          ? "Registered business"
                          : "Type not stated"}
                    </Badge>
                  </div>

                  <div className="text-xs text-muted-foreground">
                    {list.length === 0
                      ? "No documents recorded against this application."
                      : list
                          .map((doc) => `${slotLabel(doc.slot_key)} (${doc.scan_status ?? "not scanned"})`)
                          .join(" · ")}
                  </div>

                  <div className="grid gap-2 md:grid-cols-[1fr_auto_auto]">
                    <Textarea
                      rows={2}
                      placeholder="Reason — required when declining, kept on the record either way"
                      value={reason[d.id] ?? ""}
                      onChange={(e) => setReason((r) => ({ ...r, [d.id]: e.target.value }))}
                    />
                    <Button
                      size="sm"
                      disabled={busy === d.id}
                      onClick={() => void decide(d.id, "approved")}
                    >
                      <CheckCircle2 className="mr-1 h-4 w-4" /> Approve
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busy === d.id}
                      onClick={() => void decide(d.id, "rejected")}
                    >
                      <XCircle className="mr-1 h-4 w-4" /> Decline
                    </Button>
                  </div>
                </div>
              );
            })
          )}
        </CardContent>
      </Card>

      {/* ------------------------------------------------- pending documents */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm flex items-center gap-2">
            <ShieldCheck className="h-4 w-4 text-primary" /> Documents awaiting a check ({pendingDocs.length})
          </CardTitle>
        </CardHeader>
        <CardContent>
          {pendingDocs.length === 0 ? (
            <p className="text-sm text-muted-foreground italic">Nothing waiting to be checked.</p>
          ) : (
            <ul className="divide-y text-sm">
              {pendingDocs.map((doc) => (
                <li key={doc.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                  <div>
                    <div className="font-medium capitalize">{slotLabel(doc.slot_key)}</div>
                    <div className="text-xs text-muted-foreground">
                      uploaded {when(doc.uploaded_at)} · scan {doc.scan_status ?? "not scanned"}
                    </div>
                  </div>
                  <Button asChild size="sm" variant="outline">
                    <Link to="/dashboard/admin/corporate-kyb">Open to review</Link>
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {/* ------------------------------------------- verified organisations */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm flex items-center gap-2">
            <Building2 className="h-4 w-4 text-primary" /> Organisations ({orgs.length})
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {orgs.length === 0 ? (
            <p className="text-sm text-muted-foreground italic">No organisations yet.</p>
          ) : (
            orgs.map((o) => {
              const form = edit[o.id] ?? {
                credit: String((o.credit_limit_cents ?? 0) / 100),
                terms: String(o.payment_terms_days ?? 0),
              };
              const orgPolicies = policiesByOrg[o.id] ?? [];
              const active = orgPolicies.find((p) => p.state === "ACTIVE");
              const draft = orgPolicies.find((p) => p.state === "DRAFT");
              return (
                <div key={o.id} className="rounded-lg border p-4 space-y-3">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <div className="font-medium">{o.legal_name}</div>
                      <div className="text-xs text-muted-foreground">
                        {o.kra_pin ?? "KRA PIN not recorded"} · {o.billing_email ?? "no billing email"}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge variant={o.status === "ACTIVE" || o.status === "active" ? "default" : "secondary"}>
                        {o.status}
                      </Badge>
                      <Button asChild size="sm" variant="outline">
                        <Link to={`/dashboard/admin/corporates/${o.id}`}>Open account</Link>
                      </Button>
                    </div>
                  </div>

                  <div className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
                    <div>
                      <Label className="text-xs" htmlFor={`credit-${o.id}`}>Credit limit (KSh)</Label>
                      <Input
                        id={`credit-${o.id}`}
                        inputMode="decimal"
                        value={form.credit}
                        onChange={(e) => setEdit((s) => ({ ...s, [o.id]: { ...form, credit: e.target.value } }))}
                      />
                    </div>
                    <div>
                      <Label className="text-xs" htmlFor={`terms-${o.id}`}>Payment terms (days)</Label>
                      <Input
                        id={`terms-${o.id}`}
                        inputMode="numeric"
                        value={form.terms}
                        onChange={(e) => setEdit((s) => ({ ...s, [o.id]: { ...form, terms: e.target.value } }))}
                      />
                    </div>
                    <Button size="sm" disabled={busy === o.id} onClick={() => void saveSettings(o.id)}>
                      Save settings
                    </Button>
                  </div>

                  <div className="rounded-md bg-muted/40 p-3 text-xs space-y-2">
                    <div>
                      <span className="font-medium">Sign-in rules in force: </span>
                      {active
                        ? `v${active.version} — ${[
                            active.password_enabled && "password",
                            active.passwordless_enabled && "email link",
                            active.google_enabled && "Google",
                          ].filter(Boolean).join(", ")}${active.mfa_required ? " · second factor required" : ""} · ${active.session_idle_minutes} min idle / ${active.session_absolute_hours} h`
                        : "none — the platform default applies"}
                    </div>
                    {draft && (
                      <div className="flex flex-wrap items-center justify-between gap-2 rounded border bg-background p-2">
                        <div>
                          <span className="font-medium">Proposed v{draft.version}: </span>
                          {[
                            draft.password_enabled && "password",
                            draft.passwordless_enabled && "email link",
                            draft.google_enabled && "Google",
                          ].filter(Boolean).join(", ")}
                          {draft.mfa_required ? " · second factor required" : ""} ·{" "}
                          {(draft.email_domains ?? []).join(", ") || "no domain"} ·{" "}
                          {draft.session_idle_minutes} min idle / {draft.session_absolute_hours} h
                        </div>
                        <div className="flex gap-2">
                          <Button size="sm" disabled={busy === draft.id} onClick={() => void savePolicy(draft.id, "approved")}>
                            Put in force
                          </Button>
                          <Button size="sm" variant="outline" disabled={busy === draft.id} onClick={() => void savePolicy(draft.id, "rejected")}>
                            Decline
                          </Button>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </CardContent>
      </Card>

      <Alert>
        <Info className="h-4 w-4" />
        <AlertDescription className="text-xs">
          Approving an application creates the organisation, its first administrator and their access,
          and proposes sign-in rules for their email domain. Money records are never deleted — an
          organisation that should stop trading is closed, not removed.
        </AlertDescription>
      </Alert>
    </div>
  );
}
