/**
 * PROVIDER PROVISIONING & CAPABILITY DIAGNOSTICS
 *
 * One panel per provider that answers the only question an operator has:
 * "why can't this publish yet, and what exactly do I do about it?"
 *
 * Each provider is a chain of independent checks — platform app secrets,
 * capability record, registered account, connection, stored token, OAuth scopes,
 * provider account id, publication mode. Every failing check carries its own
 * remedial action, so NOT_CONFIGURED / BLOCKED is never an opaque state.
 *
 * Credential handling: the token field is write-only. It is posted to a
 * service-role function that stores it in a table with no client policies, and
 * no surface — not this panel, not the diagnostics payload — can read it back.
 * Platform application secrets (client id / secret) are backend secrets and are
 * reported by name and presence only.
 */
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { useToast } from "@/hooks/use-toast";
import { AlertTriangle, CheckCircle2, ExternalLink, KeyRound, MinusCircle, XCircle } from "lucide-react";
import {
  revokeProviderCredentials,
  saveProviderCredentials,
  type ProviderDiagnostic,
} from "@/lib/social/publishing";

const CONFIG_TONE: Record<string, string> = {
  READY: "bg-success/15 text-success",
  BLOCKED: "bg-warning/15 text-warning",
  NOT_CONFIGURED: "bg-muted text-muted-foreground",
};

function CheckIcon({ state }: { state: string }) {
  if (state === "PASS") return <CheckCircle2 className="h-4 w-4 text-success" aria-hidden />;
  if (state === "WARN") return <AlertTriangle className="h-4 w-4 text-warning" aria-hidden />;
  if (state === "NA") return <MinusCircle className="h-4 w-4 text-muted-foreground" aria-hidden />;
  return <XCircle className="h-4 w-4 text-destructive" aria-hidden />;
}

interface Props {
  diagnostics: ProviderDiagnostic[];
  loading: boolean;
  error: string | null;
  onChanged: () => void | Promise<void>;
}

export default function ProviderProvisioningPanel({ diagnostics, loading, error, onChanged }: Props) {
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState<Record<string, { token: string; refresh: string; expires: string; scopes: string; extId: string; extName: string }>>(
    {},
  );

  const formFor = (accountId: string) =>
    form[accountId] ?? { token: "", refresh: "", expires: "", scopes: "", extId: "", extName: "" };

  const update = (accountId: string, patch: Partial<ReturnType<typeof formFor>>) =>
    setForm((f) => ({ ...f, [accountId]: { ...formFor(accountId), ...patch } }));

  async function save(accountId: string, defaultScopes: string[]) {
    const v = formFor(accountId);
    setBusy(true);
    try {
      const scopes = v.scopes.trim()
        ? v.scopes.split(/[\s,]+/).filter(Boolean)
        : defaultScopes;
      await saveProviderCredentials({
        accountId,
        accessToken: v.token.trim(),
        refreshToken: v.refresh.trim() || undefined,
        expiresAt: v.expires ? new Date(v.expires).toISOString() : null,
        scopes,
        externalAccountId: v.extId.trim() || null,
        externalAccountName: v.extName.trim() || null,
      });
      // Clear the token from browser memory the moment it is accepted.
      setForm((f) => ({ ...f, [accountId]: { token: "", refresh: "", expires: "", scopes: "", extId: "", extName: "" } }));
      toast({ title: "Credentials stored", description: "Token held server-side only; connection marked CONNECTED." });
      await onChanged();
    } catch (e) {
      toast({
        variant: "destructive",
        title: "Credentials refused",
        description: e instanceof Error ? e.message : "Unknown error",
      });
    } finally {
      setBusy(false);
    }
  }

  async function revoke(accountId: string) {
    setBusy(true);
    try {
      await revokeProviderCredentials(accountId, "Revoked from the provisioning panel");
      toast({ title: "Credentials revoked", description: "Token deleted and the account disconnected." });
      await onChanged();
    } catch (e) {
      toast({
        variant: "destructive",
        title: "Revocation failed",
        description: e instanceof Error ? e.message : "Unknown error",
      });
    } finally {
      setBusy(false);
    }
  }

  if (error) {
    return (
      <div role="alert" className="rounded-md border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive">
        Diagnostics unavailable: {error}
      </div>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Provider provisioning &amp; capability diagnostics</CardTitle>
        <CardDescription>
          A provider becomes publish-ready only when every check below passes. Platform application secrets are backend
          secrets (reported by name and presence); account tokens are write-only and never returned to this screen.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {loading && diagnostics.length === 0 && <p className="text-sm text-muted-foreground">Running diagnostics…</p>}

        <Accordion type="multiple" className="w-full">
          {diagnostics.map((d) => {
            const failing = d.checks.filter((c) => c.state === "FAIL").length;
            return (
              <AccordionItem key={d.platform_slug} value={d.platform_slug}>
                <AccordionTrigger>
                  <span className="flex flex-1 flex-wrap items-center gap-3 pr-3 text-left">
                    <span className="font-medium capitalize">{d.platform_slug}</span>
                    <Badge variant="secondary" className={CONFIG_TONE[d.configuration]}>
                      {d.configuration}
                    </Badge>
                    <span className="text-xs text-muted-foreground">
                      {failing === 0 ? "all checks pass" : `${failing} blocking check${failing === 1 ? "" : "s"}`}
                    </span>
                  </span>
                </AccordionTrigger>
                <AccordionContent className="space-y-5">
                  {/* -------- checks -------- */}
                  <ul className="space-y-2">
                    {d.checks.map((c) => (
                      <li key={c.id} className="flex gap-3 rounded-md border border-border p-3">
                        <CheckIcon state={c.state} />
                        <div className="min-w-0 space-y-1">
                          <div className="text-sm font-medium">{c.label}</div>
                          <div className="text-sm text-muted-foreground">{c.detail}</div>
                          {c.action && (
                            <div className="text-xs font-medium text-warning">Action required: {c.action}</div>
                          )}
                        </div>
                      </li>
                    ))}
                  </ul>

                  {/* -------- secrets & scopes -------- */}
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div className="rounded-md border border-border p-3">
                      <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        Platform application secrets
                      </div>
                      <ul className="mt-2 space-y-1 text-sm">
                        {d.required_secrets.map((s) => {
                          const missing = d.missing_secrets.includes(s);
                          return (
                            <li key={s} className="flex items-center gap-2">
                              {missing ? (
                                <XCircle className="h-3.5 w-3.5 text-destructive" aria-hidden />
                              ) : (
                                <CheckCircle2 className="h-3.5 w-3.5 text-success" aria-hidden />
                              )}
                              <span className="font-mono text-xs">{s}</span>
                              <span className="text-xs text-muted-foreground">{missing ? "missing" : "present"}</span>
                            </li>
                          );
                        })}
                        {d.required_secrets.length === 0 && (
                          <li className="text-sm text-muted-foreground">None required.</li>
                        )}
                      </ul>
                      {d.missing_secrets.length > 0 && (
                        <p className="mt-2 text-xs text-muted-foreground">
                          Ask the platform team to save these as backend secrets — they are application-wide, not
                          per-account, and are never entered in a page form.
                        </p>
                      )}
                    </div>

                    <div className="rounded-md border border-border p-3">
                      <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        Required OAuth scopes
                      </div>
                      <ul className="mt-2 space-y-1 text-sm">
                        {d.required_scopes.map((s) => {
                          const missing = d.missing_scopes.includes(s);
                          return (
                            <li key={s} className="flex items-center gap-2">
                              {missing ? (
                                <XCircle className="h-3.5 w-3.5 text-destructive" aria-hidden />
                              ) : (
                                <CheckCircle2 className="h-3.5 w-3.5 text-success" aria-hidden />
                              )}
                              <span className="font-mono text-xs">{s}</span>
                            </li>
                          );
                        })}
                        {d.required_scopes.length === 0 && (
                          <li className="text-sm text-muted-foreground">No publication scope required.</li>
                        )}
                      </ul>
                    </div>
                  </div>

                  {/* -------- provider guide -------- */}
                  {d.guide && (
                    <div className="rounded-md border border-border bg-muted/30 p-3 text-sm">
                      <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        How to obtain access
                      </div>
                      <dl className="mt-2 space-y-1">
                        <div><dt className="inline font-medium">App: </dt><dd className="inline text-muted-foreground">{d.guide.app}</dd></div>
                        <div><dt className="inline font-medium">Where: </dt><dd className="inline text-muted-foreground">{d.guide.console}</dd></div>
                        <div><dt className="inline font-medium">Token: </dt><dd className="inline text-muted-foreground">{d.guide.token}</dd></div>
                        <div><dt className="inline font-medium">Callbacks: </dt><dd className="inline text-muted-foreground">{d.guide.webhook}</dd></div>
                      </dl>
                      <a
                        href={d.guide.docs}
                        target="_blank"
                        rel="noreferrer noopener"
                        className="mt-2 inline-flex items-center gap-1 text-xs font-medium underline"
                      >
                        Provider documentation <ExternalLink className="h-3 w-3" aria-hidden />
                      </a>
                    </div>
                  )}

                  {/* -------- credential forms -------- */}
                  {d.accounts.length === 0 && (
                    <p className="text-sm text-muted-foreground">
                      No account registered for {d.platform_slug} — add and verify it in the Register tab before
                      connecting credentials.
                    </p>
                  )}

                  {d.accounts.map((a) => {
                    const v = formFor(a.account_id);
                    const idBase = `${d.platform_slug}-${a.account_id}`;
                    return (
                      <div key={a.account_id} className="space-y-3 rounded-md border border-border p-4">
                        <div className="flex flex-wrap items-center gap-2">
                          <KeyRound className="h-4 w-4 text-muted-foreground" aria-hidden />
                          <span className="font-medium">{a.handle ?? a.account_id}</span>
                          <Badge variant="outline">{a.connection_state}</Badge>
                          {a.has_credentials && (
                            <Badge variant="secondary" className={a.token_expired ? "bg-destructive/15 text-destructive" : "bg-success/15 text-success"}>
                              {a.token_expired ? "token expired" : "token stored"}
                            </Badge>
                          )}
                        </div>

                        <div className="grid gap-3 sm:grid-cols-2">
                          <div className="sm:col-span-2">
                            <Label htmlFor={`${idBase}-token`}>Access token (write-only)</Label>
                            <Input
                              id={`${idBase}-token`}
                              type="password"
                              autoComplete="off"
                              value={v.token}
                              onChange={(e) => update(a.account_id, { token: e.target.value })}
                              placeholder="Paste the provider access token"
                            />
                          </div>
                          <div>
                            <Label htmlFor={`${idBase}-refresh`}>Refresh token (optional)</Label>
                            <Input
                              id={`${idBase}-refresh`}
                              type="password"
                              autoComplete="off"
                              value={v.refresh}
                              onChange={(e) => update(a.account_id, { refresh: e.target.value })}
                            />
                          </div>
                          <div>
                            <Label htmlFor={`${idBase}-expires`}>Token expiry</Label>
                            <Input
                              id={`${idBase}-expires`}
                              type="datetime-local"
                              value={v.expires}
                              onChange={(e) => update(a.account_id, { expires: e.target.value })}
                            />
                          </div>
                          <div>
                            <Label htmlFor={`${idBase}-extid`}>Provider account id</Label>
                            <Input
                              id={`${idBase}-extid`}
                              value={v.extId}
                              onChange={(e) => update(a.account_id, { extId: e.target.value })}
                              placeholder={a.external_account_id ?? "Page / organisation / channel id"}
                            />
                          </div>
                          <div>
                            <Label htmlFor={`${idBase}-extname`}>Provider account name</Label>
                            <Input
                              id={`${idBase}-extname`}
                              value={v.extName}
                              onChange={(e) => update(a.account_id, { extName: e.target.value })}
                            />
                          </div>
                          <div className="sm:col-span-2">
                            <Label htmlFor={`${idBase}-scopes`}>Granted scopes</Label>
                            <Input
                              id={`${idBase}-scopes`}
                              value={v.scopes}
                              onChange={(e) => update(a.account_id, { scopes: e.target.value })}
                              placeholder={d.required_scopes.join(", ") || "no scope required"}
                            />
                            <p className="mt-1 text-xs text-muted-foreground">
                              Space or comma separated. Leave empty to record exactly the required scopes
                              {d.required_scopes.length ? ` (${d.required_scopes.join(", ")})` : ""}.
                            </p>
                          </div>
                        </div>

                        <div className="flex flex-wrap gap-2">
                          <Button
                            size="sm"
                            disabled={busy || v.token.trim().length < 12}
                            onClick={() => void save(a.account_id, d.required_scopes)}
                          >
                            Save credentials &amp; connect
                          </Button>
                          {a.has_credentials && (
                            <Button size="sm" variant="outline" disabled={busy} onClick={() => void revoke(a.account_id)}>
                              Revoke &amp; disconnect
                            </Button>
                          )}
                        </div>
                        <p className="text-xs text-muted-foreground">
                          Saved tokens cannot be displayed again — only rotated or revoked. Every save and revocation is
                          recorded in the social audit trail without the secret value.
                        </p>
                      </div>
                    );
                  })}
                </AccordionContent>
              </AccordionItem>
            );
          })}
        </Accordion>
      </CardContent>
    </Card>
  );
}
