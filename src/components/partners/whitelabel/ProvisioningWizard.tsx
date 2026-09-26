/**
 * TENANT PROVISIONING WIZARD.
 *
 * The wizard is a progress surface over a server-side transaction; it does not
 * itself create anything step by step. Creation happens once, atomically; the
 * steps that follow verify what the transaction claims, and any failure after
 * creation triggers `partner_wl_abort_provisioning` so a half-built tenant is
 * never left behind. The provisioning log survives the rollback, so the attempt
 * remains auditable.
 */
import { useState } from "react";
import { AlertTriangle, CheckCircle2, Copy, Loader2, RotateCcw, ShieldCheck } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";

import {
  WIZARD_STEPS, runProvisioningWizard, validateTenantCode,
  type StepState, type WizardOutcome,
} from "@/lib/partners/whiteLabelOps";
import type { ProvisionResult } from "@/lib/partners/whiteLabelTenants";

interface Props {
  partnerId: string;
  /** Called once a tenant has been provisioned successfully. */
  onProvisioned?: (result: ProvisionResult) => void;
  trigger?: React.ReactNode;
}

type StepView = { state: StepState; detail?: string };

const STATE_LABEL: Record<StepState, string> = {
  pending: "Waiting",
  running: "Running",
  done: "Passed",
  failed: "Failed",
  rolled_back: "Rolled back",
};

export default function ProvisioningWizard({ partnerId, onProvisioned, trigger }: Props) {
  const [open, setOpen] = useState(false);
  const [code, setCode] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [markets, setMarkets] = useState("KE");
  const [services, setServices] = useState("");
  const [running, setRunning] = useState(false);
  const [steps, setSteps] = useState<Record<string, StepView>>({});
  const [outcome, setOutcome] = useState<WizardOutcome | null>(null);

  const codeError = code ? validateTenantCode(code.trim().toLowerCase()) : null;
  const completed = WIZARD_STEPS.filter((s) => steps[s.key]?.state === "done").length;
  const percent = Math.round((completed / WIZARD_STEPS.length) * 100);

  const reset = () => {
    setSteps({});
    setOutcome(null);
  };

  const run = async () => {
    setRunning(true);
    reset();
    const result = await runProvisioningWizard(
      {
        partnerId,
        tenantCode: code.trim().toLowerCase(),
        displayName: displayName.trim(),
        markets: markets.split(",").map((m) => m.trim().toUpperCase()).filter(Boolean),
        services: services.split(",").map((s) => s.trim()).filter(Boolean),
      },
      (p) => setSteps((prev) => ({ ...prev, [p.step]: { state: p.state, detail: p.detail } })),
    );
    setRunning(false);
    setOutcome(result);
    if (result.ok && result.result) {
      toast.success(`Tenant ${result.result.tenant_code} provisioned`);
      onProvisioned?.(result.result);
    } else {
      toast.error(result.rolledBack ? "Provisioning failed and was rolled back" : "Provisioning failed");
    }
  };

  const secret = outcome?.result?.credential?.client_secret;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (running) return;
        setOpen(next);
        if (!next) reset();
      }}
    >
      <DialogTrigger asChild>
        {trigger ?? <Button><ShieldCheck className="mr-2 h-4 w-4" />Provision tenant</Button>}
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Provision a white-label tenant</DialogTitle>
          <DialogDescription>
            Creates the tenant record, brand configuration, isolated sandbox and production
            environments and one sandbox credential in a single transaction. If a verification step
            fails, the tenant is rolled back and the attempt stays in the provisioning log.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="wl-code">Tenant code</Label>
            <Input
              id="wl-code"
              value={code}
              placeholder="acme-mobility"
              onChange={(e) => setCode(e.target.value)}
              disabled={running}
              aria-invalid={!!codeError}
              aria-describedby={codeError ? "wl-code-error" : undefined}
            />
            {codeError && (
              <p id="wl-code-error" className="text-xs text-destructive">{codeError}</p>
            )}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="wl-name">Display name</Label>
            <Input
              id="wl-name" value={displayName} placeholder="Acme Mobility"
              onChange={(e) => setDisplayName(e.target.value)} disabled={running}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="wl-markets">Markets (comma separated)</Label>
            <Input
              id="wl-markets" value={markets} onChange={(e) => setMarkets(e.target.value)} disabled={running}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="wl-services">Services (comma separated)</Label>
            <Input
              id="wl-services" value={services} placeholder="rides, delivery"
              onChange={(e) => setServices(e.target.value)} disabled={running}
            />
          </div>
        </div>

        <div className="space-y-3 rounded-lg border p-4">
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm font-medium">Provisioning steps</p>
            <span className="text-xs text-muted-foreground">{completed}/{WIZARD_STEPS.length}</span>
          </div>
          <Progress value={percent} aria-label="Provisioning progress" />
          <ol className="space-y-3">
            {WIZARD_STEPS.map((step, index) => {
              const view = steps[step.key] ?? { state: "pending" as StepState };
              return (
                <li key={step.key} className="flex gap-3">
                  <span className="mt-0.5">
                    {view.state === "running" && <Loader2 className="h-4 w-4 animate-spin text-primary" />}
                    {view.state === "done" && <CheckCircle2 className="h-4 w-4 text-primary" />}
                    {view.state === "failed" && <AlertTriangle className="h-4 w-4 text-destructive" />}
                    {view.state === "rolled_back" && <RotateCcw className="h-4 w-4 text-destructive" />}
                    {view.state === "pending" && (
                      <span className="flex h-4 w-4 items-center justify-center text-xs text-muted-foreground">
                        {index + 1}
                      </span>
                    )}
                  </span>
                  <div className="min-w-0 space-y-0.5">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-sm font-medium">{step.title}</p>
                      <Badge variant={view.state === "failed" || view.state === "rolled_back" ? "destructive" : "outline"}>
                        {STATE_LABEL[view.state]}
                      </Badge>
                    </div>
                    <p className="text-xs text-muted-foreground">{view.detail ?? step.assurance}</p>
                  </div>
                </li>
              );
            })}
          </ol>
        </div>

        {outcome && !outcome.ok && (
          <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-4 text-sm">
            <p className="font-medium text-destructive">Provisioning failed at “{outcome.failedStep}”.</p>
            <p className="mt-1 text-muted-foreground">{outcome.error}</p>
            <p className="mt-2 text-xs text-muted-foreground">
              {outcome.rolledBack
                ? "The partial tenant was removed. The attempt remains in the provisioning log."
                : "No tenant was created."}
            </p>
          </div>
        )}

        {secret && (
          <div className="space-y-2 rounded-lg border border-primary/40 bg-primary/5 p-4">
            <p className="text-sm font-medium">Sandbox client secret — shown once</p>
            <p className="text-xs text-muted-foreground">
              Store it in your secret manager now. Yalla keeps only a hash; it cannot be shown again.
            </p>
            <div className="flex items-center gap-2">
              <code className="min-w-0 flex-1 truncate rounded bg-muted px-2 py-1 text-xs">{secret}</code>
              <Button
                size="sm" variant="outline"
                onClick={() => {
                  void navigator.clipboard.writeText(secret);
                  toast.success("Client secret copied");
                }}
              >
                <Copy className="mr-2 h-3.5 w-3.5" />Copy
              </Button>
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)} disabled={running}>
            {outcome?.ok ? "Done" : "Cancel"}
          </Button>
          <Button
            onClick={() => void run()}
            disabled={running || !!codeError || !code.trim() || !displayName.trim() || !!outcome?.ok}
          >
            {running && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {outcome && !outcome.ok ? "Retry provisioning" : "Start provisioning"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
