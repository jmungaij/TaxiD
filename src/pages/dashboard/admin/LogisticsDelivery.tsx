import { useCallback, useEffect, useMemo, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AlertTriangle, ClipboardCheck, KeyRound, PackageCheck, RefreshCw, Undo2, Warehouse } from "lucide-react";
import { toast } from "sonner";
import {
  DEFAULT_POD_POLICY,
  DISPOSITIONS,
  POD_REQUIREMENT_COPY,
  POD_REQUIREMENT_KEYS,
  RESOLUTION_STATES,
  activatePodPolicy,
  authorizeReturn,
  capturePod,
  dispositionBlockers,
  inspectReturn,
  issueOtp,
  listAttemptsAwaitingPod,
  listDeliveryNotifications,
  listMessageProviders,
  listOtps,
  listPackagesLite,
  listPodPolicies,
  listPodRecords,
  listReturnDispositions,
  listReturnInspections,
  listReturnReceipts,
  listReturns,
  listReturnsHubs,
  merchantApproveReturn,
  podMissingRequirements,
  providerConfigurationState,
  receiveReturnAtHub,
  resolutionNeedsFinance,
  resolveReturn,
  returnTransitionsFor,
  saveMessageProvider,
  savePodPolicyDraft,
  setReturnDisposition,
  transitionReturn,
  verifyOtp,
  type AttemptAwaitingPod,
  type DeliveryNotification,
  type Disposition,
  type MessageProvider,
  type OtpRow,
  type PackageLite,
  type PodDraft,
  type PodPolicy,
  type PodPolicyRow,
  type PodRecord,
  type ResolutionState,
  type ReturnDisposition,
  type ReturnInspection,
  type ReturnMovementStatus,
  type ReturnReceipt,
  type ReturnRow,
  type ReturnsHub,
} from "@/lib/logistics/delivery/finalMileEngine";

function StatusBadge({ value }: { value: string }) {
  const tone =
    ["delivered", "RESOLVED", "authorized", "verified", "CONFIGURED", "active"].includes(value)
      ? "default"
      : ["failed", "locked", "expired", "CANCELLED", "rejected"].includes(value)
        ? "destructive"
        : "outline";
  return <Badge variant={tone as "default" | "destructive" | "outline"}>{value.replace(/_/g, " ").toLowerCase()}</Badge>;
}

export default function LogisticsDelivery() {
  const [loading, setLoading] = useState(true);
  const [attempts, setAttempts] = useState<AttemptAwaitingPod[]>([]);
  const [pods, setPods] = useState<PodRecord[]>([]);
  const [otps, setOtps] = useState<OtpRow[]>([]);
  const [returns, setReturns] = useState<ReturnRow[]>([]);
  const [receipts, setReceipts] = useState<ReturnReceipt[]>([]);
  const [inspections, setInspections] = useState<ReturnInspection[]>([]);
  const [dispositions, setDispositions] = useState<ReturnDisposition[]>([]);
  const [policies, setPolicies] = useState<PodPolicyRow[]>([]);
  const [providers, setProviders] = useState<MessageProvider[]>([]);
  const [notifications, setNotifications] = useState<DeliveryNotification[]>([]);
  const [hubs, setHubs] = useState<ReturnsHub[]>([]);
  const [pkgs, setPkgs] = useState<Record<string, PackageLite>>({});

  const refresh = useCallback(async () => {
    setLoading(true);
    const [a, p, o, r, rc, ins, dsp, pol, prov, notif, hb] = await Promise.all([
      listAttemptsAwaitingPod(),
      listPodRecords(),
      listOtps(),
      listReturns(),
      listReturnReceipts(),
      listReturnInspections(),
      listReturnDispositions(),
      listPodPolicies(),
      listMessageProviders(),
      listDeliveryNotifications(),
      listReturnsHubs(),
    ]);
    setAttempts(a); setPods(p); setOtps(o); setReturns(r); setReceipts(rc);
    setInspections(ins); setDispositions(dsp); setPolicies(pol); setProviders(prov);
    setNotifications(notif); setHubs(hb);
    const ids = Array.from(new Set([
      ...a.map((x) => x.package_id),
      ...p.map((x) => x.package_id),
      ...r.map((x) => x.package_id),
    ]));
    setPkgs(await listPackagesLite(ids));
    setLoading(false);
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const smsProvider = providers.find((p) => p.channel === "sms") ?? null;
  const providerState = providerConfigurationState(smsProvider);

  const tracking = (id: string) => pkgs[id]?.tracking_number ?? id.slice(0, 8);

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <PackageCheck className="h-6 w-6" /> Final-Mile Delivery Control Centre
          </h1>
          <p className="text-sm text-muted-foreground">
            Attempts, proof of delivery, passcodes, returns, hub receipt, inspection and disposition —
            every action executes a server operation with its own audit trail.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => void refresh()} disabled={loading}>
          <RefreshCw className="h-4 w-4 mr-2" /> Refresh
        </Button>
      </div>

      {providerState !== "CONFIGURED" && (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription>
            Messaging adapter: <strong>{providerState.replace(/_/g, " ").toLowerCase()}</strong>. Passcodes are
            still issued and verified, but they cannot be sent to recipients until a provider is configured in
            the Provider tab. Nothing is reported as sent.
          </AlertDescription>
        </Alert>
      )}

      {loading ? (
        <Skeleton className="h-96 w-full" />
      ) : (
        <Tabs defaultValue="evidence">
          <TabsList className="flex-wrap">
            <TabsTrigger value="evidence">Evidence backlog</TabsTrigger>
            <TabsTrigger value="pod">Proof of delivery</TabsTrigger>
            <TabsTrigger value="otp">Passcodes</TabsTrigger>
            <TabsTrigger value="returns">Returns</TabsTrigger>
            <TabsTrigger value="hub">Hub &amp; inspection</TabsTrigger>
            <TabsTrigger value="policies">POD policies</TabsTrigger>
            <TabsTrigger value="provider">Provider</TabsTrigger>
            <TabsTrigger value="notifications">Notifications</TabsTrigger>
          </TabsList>

          <TabsContent value="evidence" className="space-y-3 pt-4">
            <EvidenceBacklog attempts={attempts} pkgs={pkgs} onDone={refresh} />
          </TabsContent>

          <TabsContent value="pod" className="pt-4">
            <Card className="divide-y">
              {pods.length === 0 && <p className="p-6 text-sm text-muted-foreground">No proof of delivery captured yet.</p>}
              {pods.map((pod) => (
                <div key={pod.id} className="p-4 text-sm flex items-start justify-between gap-4">
                  <div>
                    <div className="font-mono">{tracking(pod.package_id)}</div>
                    <div className="text-xs text-muted-foreground">
                      {pod.recipient_name ?? "—"} · policy v{pod.policy_version ?? "—"} ·{" "}
                      {new Date(pod.captured_at).toLocaleString()}
                    </div>
                    <div className="text-[11px] font-mono text-muted-foreground break-all">
                      hash {pod.integrity_hash.slice(0, 32)}…
                    </div>
                  </div>
                  <div className="flex gap-2 shrink-0">
                    {pod.otp_verified && <Badge variant="outline">passcode verified</Badge>}
                    <StatusBadge value={pod.status} />
                  </div>
                </div>
              ))}
            </Card>
          </TabsContent>

          <TabsContent value="otp" className="space-y-3 pt-4">
            <OtpPanel otps={otps} pkgs={pkgs} onDone={refresh} />
          </TabsContent>

          <TabsContent value="returns" className="space-y-3 pt-4">
            <ReturnsPanel
              returns={returns}
              hubs={hubs}
              pkgs={pkgs}
              inspections={inspections}
              onDone={refresh}
            />
          </TabsContent>

          <TabsContent value="hub" className="space-y-4 pt-4">
            <Card className="p-4">
              <h3 className="font-semibold mb-2 flex items-center gap-2"><Warehouse className="h-4 w-4" /> Hub receipts</h3>
              {receipts.length === 0 ? (
                <p className="text-sm text-muted-foreground">No returns received at a hub yet.</p>
              ) : receipts.map((r) => (
                <div key={r.id} className="py-2 text-sm border-b last:border-0">
                  {tracking(r.package_id)} · condition {r.condition} · seal {r.seal_state} ·{" "}
                  {new Date(r.received_at).toLocaleString()}
                  {r.custody_event_id && <Badge variant="outline" className="ml-2">custody recorded</Badge>}
                </div>
              ))}
            </Card>
            <Card className="p-4">
              <h3 className="font-semibold mb-2">Inspections</h3>
              {inspections.length === 0 ? (
                <p className="text-sm text-muted-foreground">No inspections completed yet.</p>
              ) : inspections.map((i) => (
                <div key={i.id} className="py-2 text-sm border-b last:border-0">
                  condition {i.condition} · seal {i.seal_condition} · packaging {i.packaging_condition}
                  {i.damage_found && <Badge variant="destructive" className="ml-2">damage</Badge>}
                  {i.missing_contents && <Badge variant="destructive" className="ml-2">missing contents</Badge>}
                </div>
              ))}
            </Card>
            <Card className="p-4">
              <h3 className="font-semibold mb-2">Dispositions</h3>
              {dispositions.length === 0 ? (
                <p className="text-sm text-muted-foreground">No dispositions recorded yet.</p>
              ) : dispositions.map((d) => (
                <div key={d.id} className="py-2 text-sm border-b last:border-0">
                  {d.disposition.replace(/_/g, " ").toLowerCase()} ·{" "}
                  {new Date(d.executed_at).toLocaleString()}
                  {d.authorization_note && <span className="text-muted-foreground"> — {d.authorization_note}</span>}
                </div>
              ))}
            </Card>
          </TabsContent>

          <TabsContent value="policies" className="pt-4">
            <PolicyPanel policies={policies} onDone={refresh} />
          </TabsContent>

          <TabsContent value="provider" className="pt-4">
            <ProviderPanel provider={smsProvider} onDone={refresh} />
          </TabsContent>

          <TabsContent value="notifications" className="pt-4">
            <Card className="divide-y">
              {notifications.length === 0 && (
                <p className="p-6 text-sm text-muted-foreground">No delivery notifications emitted yet.</p>
              )}
              {notifications.map((n) => (
                <div key={n.id} className="p-3 text-sm flex items-center justify-between gap-3">
                  <span className="font-mono text-xs">{n.event_name}</span>
                  <span className="text-xs text-muted-foreground">{new Date(n.created_at).toLocaleString()}</span>
                  <StatusBadge value={n.status} />
                </div>
              ))}
            </Card>
          </TabsContent>
        </Tabs>
      )}
    </div>
  );
}

/* ----------------------------- evidence ----------------------------- */

function EvidenceBacklog({
  attempts, pkgs, onDone,
}: { attempts: AttemptAwaitingPod[]; pkgs: Record<string, PackageLite>; onDone: () => Promise<void> }) {
  const [target, setTarget] = useState<AttemptAwaitingPod | null>(null);
  const delivered = attempts.filter((a) => a.outcome === "delivered");

  return (
    <>
      <Card className="divide-y">
        {attempts.length === 0 && (
          <p className="p-6 text-sm text-muted-foreground">Every recorded attempt has its evidence captured.</p>
        )}
        {attempts.map((a) => (
          <div key={a.id} className="p-4 flex items-center justify-between gap-4 text-sm">
            <div>
              <div className="font-mono">{pkgs[a.package_id]?.tracking_number ?? a.package_id.slice(0, 8)}</div>
              <div className="text-xs text-muted-foreground">
                attempt #{a.attempt_number} · {a.outcome}
                {a.reason_code ? ` · ${a.reason_code.replace(/_/g, " ").toLowerCase()}` : ""} ·{" "}
                {new Date(a.occurred_at).toLocaleString()}
              </div>
            </div>
            {a.outcome === "delivered" ? (
              <Button size="sm" onClick={() => setTarget(a)}>
                <ClipboardCheck className="h-4 w-4 mr-2" /> Capture POD
              </Button>
            ) : (
              <Badge variant="outline">no evidence required</Badge>
            )}
          </div>
        ))}
      </Card>
      {delivered.length > 0 && (
        <p className="text-xs text-muted-foreground">
          {delivered.length} delivered attempt(s) are awaiting evidence — these are reported as
          AWAITING_EVIDENCE, never as delivered.
        </p>
      )}
      {target && (
        <PodCaptureDialog
          attempt={target}
          pkg={pkgs[target.package_id]}
          onClose={() => setTarget(null)}
          onDone={onDone}
        />
      )}
    </>
  );
}

function PodCaptureDialog({
  attempt, pkg, onClose, onDone,
}: { attempt: AttemptAwaitingPod; pkg?: PackageLite; onClose: () => void; onDone: () => Promise<void> }) {
  const [policy, setPolicy] = useState<PodPolicy>(DEFAULT_POD_POLICY);
  const [configState, setConfigState] = useState<string>("NOT_CONFIGURED");
  const [draft, setDraft] = useState<PodDraft>({ recipient_name: attempt.recipient_name ?? "", files: [] });
  const [otpCode, setOtpCode] = useState("");
  const [busy, setBusy] = useState(false);
  const idempotencyKey = useMemo(() => `pod-${attempt.id}-${crypto.randomUUID()}`, [attempt.id]);

  useEffect(() => {
    let alive = true;
    void (async () => {
      const { loadEffectivePodPolicy } = await import("@/lib/logistics/delivery/finalMileEngine");
      const res = await loadEffectivePodPolicy(pkg?.module ?? "PARCEL_STANDARD");
      if (!alive || !res.ok || !res.data) return;
      setPolicy(res.data.policy);
      setConfigState(res.data.configuration_state);
    })();
    return () => { alive = false; };
  }, [pkg?.module]);

  const missing = podMissingRequirements(policy, draft);

  async function captureGeolocation() {
    if (!navigator.geolocation) { toast.error("This device cannot provide a location."); return; }
    navigator.geolocation.getCurrentPosition(
      (pos) => setDraft((d) => ({ ...d, lat: pos.coords.latitude, lng: pos.coords.longitude })),
      () => toast.error("Location permission was refused."),
    );
  }

  async function runVerifyOtp() {
    setBusy(true);
    const res = await verifyOtp(attempt.package_id, otpCode, attempt.id);
    setBusy(false);
    if (!res.ok) { toast.error(res.message ?? "The passcode could not be verified."); return; }
    setDraft((d) => ({ ...d, otpVerified: true }));
    toast.success("Passcode verified.");
  }

  async function submit() {
    setBusy(true);
    const res = await capturePod(attempt.id, draft, idempotencyKey);
    setBusy(false);
    if (!res.ok) {
      toast.error(res.message ?? "Proof of delivery was rejected.");
      return;
    }
    toast.success(res.data?.replayed ? "This proof was already captured." : "Proof of delivery recorded.");
    onClose();
    await onDone();
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Capture proof of delivery</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">
          {pkg?.tracking_number ?? attempt.package_id} · attempt #{attempt.attempt_number} · policy{" "}
          {configState.replace(/_/g, " ").toLowerCase()}
        </p>

        <div className="space-y-3">
          <div className="text-xs text-muted-foreground">
            Required by this service: {POD_REQUIREMENT_KEYS.filter((k) => policy[k]).map((k) => POD_REQUIREMENT_COPY[k]).join(", ") || "nothing beyond a record"}
          </div>

          <div className="space-y-1">
            <Label>Recipient name</Label>
            <Input value={draft.recipient_name ?? ""} onChange={(e) => setDraft({ ...draft, recipient_name: e.target.value })} />
          </div>
          {policy.require_recipient_relationship && (
            <div className="space-y-1">
              <Label>Recipient relationship / authority</Label>
              <Input value={draft.recipient_relationship ?? ""} onChange={(e) => setDraft({ ...draft, recipient_relationship: e.target.value })} />
            </div>
          )}
          {policy.require_id_reference && (
            <div className="space-y-1">
              <Label>ID / reference</Label>
              <Input value={draft.recipient_id_reference ?? ""} onChange={(e) => setDraft({ ...draft, recipient_id_reference: e.target.value })} />
            </div>
          )}
          {policy.require_signature && (
            <div className="space-y-1">
              <Label>Signature reference</Label>
              <Input placeholder="storage object path" value={draft.signature_ref ?? ""} onChange={(e) => setDraft({ ...draft, signature_ref: e.target.value })} />
            </div>
          )}
          {policy.require_photo && (
            <div className="space-y-1">
              <Label>Photo reference</Label>
              <Input
                placeholder="storage object path"
                onChange={(e) =>
                  setDraft({ ...draft, files: e.target.value ? [{ kind: "photo", object_ref: e.target.value }] : [] })
                }
              />
            </div>
          )}
          {policy.require_scan && (
            <div className="space-y-1">
              <Label>Scanned barcode</Label>
              <Input value={draft.scanned_barcode ?? ""} onChange={(e) => setDraft({ ...draft, scanned_barcode: e.target.value })} />
            </div>
          )}
          {policy.require_otp && (
            <div className="space-y-1">
              <Label>One-time passcode</Label>
              <div className="flex gap-2">
                <Input value={otpCode} onChange={(e) => setOtpCode(e.target.value)} placeholder="6 digits" />
                <Button variant="outline" onClick={() => void runVerifyOtp()} disabled={busy || otpCode.length < 4}>
                  Verify
                </Button>
              </div>
              {draft.otpVerified && <p className="text-xs text-primary">Passcode verified for this attempt.</p>}
            </div>
          )}
          <div className="space-y-1">
            <Label>Notes</Label>
            <Textarea rows={2} value={draft.notes ?? ""} onChange={(e) => setDraft({ ...draft, notes: e.target.value })} />
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => void captureGeolocation()}>Capture location</Button>
            <span className="text-xs text-muted-foreground">
              {draft.lat != null ? `${draft.lat.toFixed(5)}, ${draft.lng?.toFixed(5)}` : "not captured"}
            </span>
          </div>

          {missing.length > 0 && (
            <Alert variant="destructive">
              <AlertTriangle className="h-4 w-4" />
              <AlertDescription>
                Missing: {missing.map((m) => m.replace(/_/g, " ")).join(", ")}
              </AlertDescription>
            </Alert>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button onClick={() => void submit()} disabled={busy || missing.length > 0}>
            {busy ? "Recording…" : "Record proof of delivery"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ------------------------------- OTP -------------------------------- */

function OtpPanel({
  otps, pkgs, onDone,
}: { otps: OtpRow[]; pkgs: Record<string, PackageLite>; onDone: () => Promise<void> }) {
  const [packageId, setPackageId] = useState("");
  const [busy, setBusy] = useState(false);

  async function issue() {
    if (!packageId) return;
    setBusy(true);
    const res = await issueOtp(packageId);
    setBusy(false);
    if (!res.ok) { toast.error(res.message ?? "The passcode could not be issued."); return; }
    if (res.data?.manual_disclosure && res.data.code) {
      toast.warning(`No messaging provider configured — passcode ${res.data.code} must be given out-of-band. This disclosure is audited.`, { duration: 15000 });
    } else {
      toast.success("Passcode issued.");
    }
    await onDone();
  }

  return (
    <>
      <Card className="p-4 space-y-2">
        <Label>Issue a delivery passcode</Label>
        <div className="flex gap-2">
          <Input placeholder="package id" value={packageId} onChange={(e) => setPackageId(e.target.value)} />
          <Button onClick={() => void issue()} disabled={busy || !packageId}>
            <KeyRound className="h-4 w-4 mr-2" /> Issue
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          Passcodes are stored hashed, expire, count attempts, are locked after the cap and can never be
          replayed against another package.
        </p>
      </Card>
      <Card className="divide-y">
        {otps.length === 0 && <p className="p-6 text-sm text-muted-foreground">No passcodes issued yet.</p>}
        {otps.map((o) => (
          <div key={o.id} className="p-3 text-sm flex items-center justify-between gap-3">
            <span className="font-mono text-xs">{pkgs[o.package_id]?.tracking_number ?? o.package_id.slice(0, 8)}</span>
            <span className="text-xs text-muted-foreground">
              {o.purpose.replace(/_/g, " ")} · {o.attempts}/{o.max_attempts} attempts · expires{" "}
              {new Date(o.expires_at).toLocaleTimeString()}
            </span>
            <StatusBadge value={o.status} />
          </div>
        ))}
      </Card>
    </>
  );
}

/* ----------------------------- returns ------------------------------ */

function ReturnsPanel({
  returns, hubs, pkgs, inspections, onDone,
}: {
  returns: ReturnRow[];
  hubs: ReturnsHub[];
  pkgs: Record<string, PackageLite>;
  inspections: ReturnInspection[];
  onDone: () => Promise<void>;
}) {
  const [packageId, setPackageId] = useState("");
  const [reason, setReason] = useState("");
  const [hubId, setHubId] = useState<string>("");
  const [merchantApproval, setMerchantApproval] = useState(false);
  const [busy, setBusy] = useState(false);

  async function run(fn: () => Promise<{ ok: boolean; message?: string }>, success: string) {
    setBusy(true);
    const res = await fn();
    setBusy(false);
    if (!res.ok) { toast.error(res.message ?? "The operation was rejected."); return; }
    toast.success(success);
    await onDone();
  }

  return (
    <>
      <Card className="p-4 space-y-3">
        <h3 className="font-semibold flex items-center gap-2"><Undo2 className="h-4 w-4" /> Authorise a return</h3>
        <div className="grid gap-3 md:grid-cols-2">
          <div className="space-y-1">
            <Label>Package id</Label>
            <Input value={packageId} onChange={(e) => setPackageId(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label>Destination hub (returns processing)</Label>
            <Select value={hubId} onValueChange={setHubId}>
              <SelectTrigger><SelectValue placeholder={hubs.length ? "Select a hub" : "No returns-capable hub"} /></SelectTrigger>
              <SelectContent>
                {hubs.map((h) => <SelectItem key={h.id} value={h.id}>{h.code} — {h.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </div>
        <div className="space-y-1">
          <Label>Reason</Label>
          <Textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} />
        </div>
        <div className="flex items-center gap-2">
          <Switch checked={merchantApproval} onCheckedChange={setMerchantApproval} id="merchant-approval" />
          <Label htmlFor="merchant-approval" className="text-sm">Merchant approval required</Label>
        </div>
        <Button
          disabled={busy || !packageId || !reason}
          onClick={() => void run(
            () => authorizeReturn({
              packageId, reason, destinationHubId: hubId || null, merchantApprovalRequired: merchantApproval,
            }),
            "Return authorised.",
          )}
        >
          Authorise return
        </Button>
      </Card>

      <Card className="divide-y">
        {returns.length === 0 && <p className="p-6 text-sm text-muted-foreground">No returns yet.</p>}
        {returns.map((r) => (
          <ReturnRowCard
            key={r.id}
            row={r}
            hubs={hubs}
            tracking={pkgs[r.package_id]?.tracking_number ?? r.package_id.slice(0, 8)}
            hasInspection={inspections.some((i) => i.return_id === r.id)}
            busy={busy}
            run={run}
          />
        ))}
      </Card>
    </>
  );
}

function ReturnRowCard({
  row, hubs, tracking, hasInspection, busy, run,
}: {
  row: ReturnRow;
  hubs: ReturnsHub[];
  tracking: string;
  hasInspection: boolean;
  busy: boolean;
  run: (fn: () => Promise<{ ok: boolean; message?: string }>, success: string) => Promise<void>;
}) {
  const [hubId, setHubId] = useState(row.destination_hub_id ?? "");
  const [condition, setCondition] = useState("good");
  const [disposition, setDisposition] = useState<Disposition>("RETURN_TO_MERCHANT");
  const [resolution, setResolution] = useState<ResolutionState>("RESOLVED_RETURNED");
  const [financeRef, setFinanceRef] = useState("");
  const next = returnTransitionsFor(row.movement_status);
  const blockers = dispositionBlockers(DEFAULT_POD_POLICY, { status: row.movement_status, hasInspection });

  return (
    <div className="p-4 space-y-3 text-sm">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="font-mono">{row.return_number ?? "—"} · {tracking}</div>
          <div className="text-xs text-muted-foreground">{row.reason}</div>
        </div>
        <div className="flex gap-2">
          <StatusBadge value={row.authorization_status} />
          <StatusBadge value={row.movement_status} />
        </div>
      </div>

      {row.authorization_status === "pending" && (
        <div className="flex gap-2">
          <Button size="sm" disabled={busy}
            onClick={() => void run(() => merchantApproveReturn(row.id, true), "Merchant approval recorded.")}>
            Approve
          </Button>
          <Button size="sm" variant="outline" disabled={busy}
            onClick={() => void run(() => merchantApproveReturn(row.id, false), "Return rejected.")}>
            Reject
          </Button>
        </div>
      )}

      {next.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {next.map((s) => (
            <Button key={s} size="sm" variant="outline" disabled={busy}
              onClick={() => void run(() => transitionReturn(row.id, s as ReturnMovementStatus), `Return moved to ${s}.`)}>
              {s.replace(/_/g, " ").toLowerCase()}
            </Button>
          ))}
        </div>
      )}

      {["DISPATCHED", "IN_TRANSIT"].includes(row.movement_status) && (
        <div className="flex flex-wrap items-end gap-2">
          <div className="space-y-1">
            <Label className="text-xs">Receiving hub</Label>
            <Select value={hubId} onValueChange={setHubId}>
              <SelectTrigger className="w-56"><SelectValue placeholder="Select hub" /></SelectTrigger>
              <SelectContent>
                {hubs.map((h) => <SelectItem key={h.id} value={h.id}>{h.code}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Condition</Label>
            <Select value={condition} onValueChange={setCondition}>
              <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
              <SelectContent>
                {["good", "damaged", "partial", "unknown"].map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <Button size="sm" disabled={busy || !hubId}
            onClick={() => void run(() => receiveReturnAtHub({ returnId: row.id, hubId, condition }), "Return received at hub.")}>
            Receive at hub
          </Button>
        </div>
      )}

      {["HUB_RECEIVED", "INSPECTION"].includes(row.movement_status) && (
        <div className="flex flex-wrap items-end gap-2">
          <Button size="sm" variant="outline" disabled={busy}
            onClick={() => void run(() => inspectReturn({ returnId: row.id, condition }), "Inspection recorded.")}>
            Record inspection ({condition})
          </Button>
          <div className="space-y-1">
            <Label className="text-xs">Disposition</Label>
            <Select value={disposition} onValueChange={(v) => setDisposition(v as Disposition)}>
              <SelectTrigger className="w-56"><SelectValue /></SelectTrigger>
              <SelectContent>
                {DISPOSITIONS.map((d) => <SelectItem key={d} value={d}>{d.replace(/_/g, " ").toLowerCase()}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <Button size="sm" disabled={busy || blockers.length > 0}
            onClick={() => void run(() => setReturnDisposition(row.id, disposition), "Disposition recorded.")}>
            Record disposition
          </Button>
          {blockers.length > 0 && <span className="text-xs text-destructive">{blockers[0]}</span>}
        </div>
      )}

      {row.movement_status === "DISPOSITION" && (
        <div className="flex flex-wrap items-end gap-2">
          <div className="space-y-1">
            <Label className="text-xs">Resolution</Label>
            <Select value={resolution} onValueChange={(v) => setResolution(v as ResolutionState)}>
              <SelectTrigger className="w-64"><SelectValue /></SelectTrigger>
              <SelectContent>
                {RESOLUTION_STATES.map((s) => <SelectItem key={s} value={s}>{s.replace(/_/g, " ").toLowerCase()}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          {resolutionNeedsFinance(resolution) && (
            <div className="space-y-1">
              <Label className="text-xs">Settlement reference</Label>
              <Input className="w-56" value={financeRef} onChange={(e) => setFinanceRef(e.target.value)} />
            </div>
          )}
          <Button size="sm" disabled={busy || (resolutionNeedsFinance(resolution) && !financeRef)}
            onClick={() => void run(() => resolveReturn(row.id, resolution, financeRef || null), "Return resolved.")}>
            Resolve
          </Button>
        </div>
      )}

      {row.resolution_state && (
        <div className="text-xs text-muted-foreground">
          {row.resolution_state.replace(/_/g, " ").toLowerCase()}
          {row.financial_reference ? ` · settlement ${row.financial_reference}` : ""}
        </div>
      )}
    </div>
  );
}

/* ---------------------------- policies ------------------------------ */

function PolicyPanel({ policies, onDone }: { policies: PodPolicyRow[]; onDone: () => Promise<void> }) {
  const [offering, setOffering] = useState("");
  const [reqs, setReqs] = useState<PodPolicy>(DEFAULT_POD_POLICY);
  const [busy, setBusy] = useState(false);

  async function saveDraft() {
    setBusy(true);
    const res = await savePodPolicyDraft(offering, reqs);
    setBusy(false);
    if (!res.ok) { toast.error(res.message ?? "The policy could not be saved."); return; }
    toast.success("Draft policy version created.");
    await onDone();
  }

  return (
    <div className="space-y-4">
      <Card className="p-4 space-y-3">
        <h3 className="font-semibold">New policy version</h3>
        <div className="space-y-1">
          <Label>Service offering code</Label>
          <Input value={offering} onChange={(e) => setOffering(e.target.value)} placeholder="e.g. PARCEL_STANDARD" />
        </div>
        <div className="grid gap-2 md:grid-cols-2">
          {POD_REQUIREMENT_KEYS.map((k) => (
            <div key={k} className="flex items-center gap-2">
              <Switch id={k} checked={reqs[k]} onCheckedChange={(v) => setReqs({ ...reqs, [k]: v })} />
              <Label htmlFor={k} className="text-sm">{POD_REQUIREMENT_COPY[k]}</Label>
            </div>
          ))}
          <div className="flex items-center gap-2">
            <Switch
              id="requires_inspection"
              checked={reqs.requires_inspection_before_disposition}
              onCheckedChange={(v) => setReqs({ ...reqs, requires_inspection_before_disposition: v })}
            />
            <Label htmlFor="requires_inspection" className="text-sm">Inspection before disposition</Label>
          </div>
        </div>
        <Button onClick={() => void saveDraft()} disabled={busy || !offering}>Create draft version</Button>
      </Card>

      <Card className="divide-y">
        {policies.length === 0 && (
          <p className="p-6 text-sm text-muted-foreground">
            No POD policy configured — services fall back to a recorded name and location only (NOT_CONFIGURED).
          </p>
        )}
        {policies.map((p) => (
          <div key={p.id} className="p-4 text-sm flex items-center justify-between gap-3">
            <div>
              <div className="font-medium">{p.offering_code} · v{p.version}</div>
              <div className="text-xs text-muted-foreground">
                {POD_REQUIREMENT_KEYS.filter((k) => p[k]).map((k) => POD_REQUIREMENT_COPY[k]).join(", ") || "minimum record"}
              </div>
            </div>
            <div className="flex items-center gap-2">
              <StatusBadge value={p.status} />
              {p.status === "draft" && (
                <Button size="sm" onClick={async () => {
                  const res = await activatePodPolicy(p.id);
                  if (!res.ok) { toast.error(res.message ?? "Activation failed."); return; }
                  toast.success("Policy activated.");
                  await onDone();
                }}>Activate</Button>
              )}
            </div>
          </div>
        ))}
      </Card>
    </div>
  );
}

/* ---------------------------- provider ------------------------------ */

function ProviderPanel({ provider, onDone }: { provider: MessageProvider | null; onDone: () => Promise<void> }) {
  const [name, setName] = useState(provider?.provider ?? "");
  const [secret, setSecret] = useState(provider?.credentials_secret_name ?? "");
  const [sender, setSender] = useState(provider?.sender_identity ?? "");
  const [environment, setEnvironment] = useState(provider?.environment ?? "production");
  const [enabled, setEnabled] = useState(provider?.enabled ?? false);
  const [timeout, setTimeoutMs] = useState(provider?.timeout_ms ?? 10000);
  const [retries, setRetries] = useState(provider?.retry_max_attempts ?? 3);
  const [busy, setBusy] = useState(false);

  return (
    <Card className="p-4 space-y-3 max-w-2xl">
      <h3 className="font-semibold">SMS provider adapter</h3>
      <p className="text-xs text-muted-foreground">
        Credentials are never stored here — record the name of the stored secret and the backend reads it at
        send time. State today: <strong>{providerConfigurationState(provider).replace(/_/g, " ").toLowerCase()}</strong>.
      </p>
      <Separator />
      <div className="grid gap-3 md:grid-cols-2">
        <div className="space-y-1"><Label>Provider</Label><Input value={name} onChange={(e) => setName(e.target.value)} /></div>
        <div className="space-y-1"><Label>Sender identity</Label><Input value={sender} onChange={(e) => setSender(e.target.value)} /></div>
        <div className="space-y-1"><Label>Credentials secret name</Label><Input value={secret} onChange={(e) => setSecret(e.target.value)} /></div>
        <div className="space-y-1">
          <Label>Environment</Label>
          <Select value={environment} onValueChange={setEnvironment}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {["sandbox", "staging", "production"].map((e) => <SelectItem key={e} value={e}>{e}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1"><Label>Timeout (ms)</Label><Input type="number" value={timeout} onChange={(e) => setTimeoutMs(Number(e.target.value))} /></div>
        <div className="space-y-1"><Label>Max retries</Label><Input type="number" value={retries} onChange={(e) => setRetries(Number(e.target.value))} /></div>
      </div>
      <div className="flex items-center gap-2">
        <Switch id="provider-enabled" checked={enabled} onCheckedChange={setEnabled} />
        <Label htmlFor="provider-enabled" className="text-sm">Enabled</Label>
      </div>
      <Button
        disabled={busy || !name}
        onClick={async () => {
          setBusy(true);
          const res = await saveMessageProvider({
            id: provider?.id ?? null,
            channel: "sms",
            provider: name,
            environment,
            credentialsSecretName: secret || null,
            senderIdentity: sender || null,
            enabled,
            timeoutMs: timeout,
            retryMaxAttempts: retries,
            retryBackoffSeconds: provider?.retry_backoff_seconds ?? 30,
          });
          setBusy(false);
          if (!res.ok) { toast.error(res.message ?? "The provider could not be saved."); return; }
          toast.success("Provider configuration saved.");
          await onDone();
        }}
      >
        Save provider
      </Button>
    </Card>
  );
}
