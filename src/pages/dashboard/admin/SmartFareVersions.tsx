import { useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import {
  DEFAULT_SMARTFARE_CONFIG, loadSmartFareVersions, formatKes,
  type SmartFareConfigVersion,
} from "@/lib/charter/smartFare";
import { diffVersions, diffConfigs } from "@/lib/charter/pricingVersionDiff";
import {
  listPricingAudit, verifyPricingAuditChain, pricingAuditToCsv,
} from "@/lib/charter/pricingAuditLog";

const DEFAULTS: SmartFareConfigVersion = {
  version: 0,
  savedAt: new Date(0).toISOString(),
  actor: "platform",
  note: "SmartFare defaults",
  config: DEFAULT_SMARTFARE_CONFIG,
} as SmartFareConfigVersion;

/**
 * Admin console: SmartFare configuration version diff + immutable pricing
 * audit chain. Shows what changed between two published configurations and how
 * those changes moved real RFQ quotes.
 */
export default function SmartFareVersions() {
  const versions = useMemo(() => [DEFAULTS, ...loadSmartFareVersions()], []);
  const [fromV, setFromV] = useState(String(versions[Math.max(0, versions.length - 2)].version));
  const [toV, setToV] = useState(String(versions[versions.length - 1].version));

  const before = versions.find((v) => String(v.version) === fromV) ?? DEFAULTS;
  const after = versions.find((v) => String(v.version) === toV) ?? DEFAULTS;
  const diff = useMemo(
    () => (before.version === after.version
      ? diffConfigs(before.config, after.config, { fromVersion: before.version, toVersion: after.version })
      : diffVersions(before, after)),
    [before, after],
  );

  const audit = useMemo(() => listPricingAudit().slice().reverse(), []);
  const chain = useMemo(() => verifyPricingAuditChain(listPricingAudit()), []);

  const exportAudit = () => {
    const blob = new Blob([pricingAuditToCsv(listPricingAudit())], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "smartfare-pricing-audit.csv";
    a.click();
    URL.revokeObjectURL(url);
    toast.success("Pricing audit chain exported");
  };

  return (
    <div className="space-y-6 p-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">SmartFare™ version diff & pricing audit</h1>
        <p className="text-sm text-muted-foreground">
          Compare any two published SmartFare v2.0 configurations, see the effect on representative RFQ
          quotes, and inspect the immutable log of every priced mission.
        </p>
      </header>

      <Card>
        <CardHeader className="pb-3"><CardTitle className="text-base">Compare configurations</CardTitle></CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2">
          <div>
            <Label className="text-xs text-muted-foreground">Baseline version</Label>
            <Select value={fromV} onValueChange={setFromV}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {versions.map((v) => (
                  <SelectItem key={`f${v.version}`} value={String(v.version)}>
                    v{v.version} · {new Date(v.savedAt).toLocaleString("en-KE")}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs text-muted-foreground">Comparison version</Label>
            <Select value={toV} onValueChange={setToV}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {versions.map((v) => (
                  <SelectItem key={`t${v.version}`} value={String(v.version)}>
                    v{v.version} · {new Date(v.savedAt).toLocaleString("en-KE")}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between gap-2">
            <CardTitle className="text-base">Changed fields</CardTitle>
            <Badge variant="secondary">{diff.changed.length} change{diff.changed.length === 1 ? "" : "s"}</Badge>
          </div>
        </CardHeader>
        <CardContent>
          {diff.changed.length === 0 && (
            <p className="text-sm text-muted-foreground">These two versions are identical.</p>
          )}
          {diff.changed.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-xs uppercase text-muted-foreground">
                  <tr>
                    <th className="py-2 text-left">Field</th>
                    <th className="py-2 text-right">v{before.version}</th>
                    <th className="py-2 text-right">v{after.version}</th>
                    <th className="py-2 text-right">Move</th>
                  </tr>
                </thead>
                <tbody>
                  {diff.changed.map((c) => (
                    <tr key={c.key} className="border-t border-border">
                      <td className="py-2">{c.label}</td>
                      <td className="py-2 text-right text-muted-foreground">{String(c.before ?? "—")}</td>
                      <td className="py-2 text-right font-medium">{String(c.after ?? "—")}</td>
                      <td className={`py-2 text-right ${(c.deltaPct ?? 0) > 0 ? "text-destructive" : "text-primary"}`}>
                        {c.deltaPct === null ? "—" : `${c.deltaPct > 0 ? "+" : ""}${c.deltaPct}%`}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between gap-2">
            <CardTitle className="text-base">Effect on RFQ quotes (corporate, 6 pax)</CardTitle>
            <Badge variant={diff.averageQuoteMovePct > 0 ? "destructive" : "default"}>
              avg {diff.averageQuoteMovePct > 0 ? "+" : ""}{diff.averageQuoteMovePct}%
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          {diff.impact.map((i) => (
            <div key={i.routeId} className="flex flex-wrap items-center justify-between gap-2 border-b border-border pb-2 last:border-0">
              <span>{i.route}</span>
              <span className="text-muted-foreground">
                {formatKes(i.before)} → <span className="font-medium text-foreground">{formatKes(i.after)}</span>
              </span>
              <span className={i.delta > 0 ? "text-destructive" : i.delta < 0 ? "text-primary" : "text-muted-foreground"}>
                {i.delta > 0 ? "+" : ""}{formatKes(i.delta)} ({i.deltaPct > 0 ? "+" : ""}{i.deltaPct}%)
              </span>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <CardTitle className="text-base">Immutable pricing audit log</CardTitle>
            <div className="flex items-center gap-2">
              <Badge variant={chain.ok ? "default" : "destructive"}>{chain.message}</Badge>
              <Button data-analytics="smartfareversions.export_csv" size="sm" variant="outline" onClick={exportAudit}>Export CSV</Button>
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            Each record commits to the previous record's hash, capturing the operator rate card version,
            missing components and the admin configuration in force at quote time.
          </p>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          {audit.length === 0 && (
            <p className="text-muted-foreground">No priced missions recorded yet.</p>
          )}
          {audit.slice(0, 40).map((r) => (
            <div key={r.id} className="rounded-md border border-border p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-medium">#{r.seq} · {r.missionRef}</span>
                <span className="text-muted-foreground">{new Date(r.at).toLocaleString("en-KE")}</span>
              </div>
              <p className="text-xs text-muted-foreground">
                {r.route} · {r.aircraftLabel} · {r.segment} · {formatKes(r.total)} · {r.reason.replace("_", " ")}
              </p>
              <p className="text-xs text-muted-foreground">
                Rate card {r.rateCardId ?? "none"} (v{r.rateCardVersion ?? "n/a"}) · config v{r.configVersion} ·
                coverage {r.operatorCoveragePct}% ·{" "}
                <span className={r.canFinalise ? "text-primary" : "text-status-warning"}>
                  {r.canFinalise ? "binding eligible" : "indicative"}
                </span>
              </p>
              {r.missingFields.length > 0 && (
                <p className="text-xs text-muted-foreground">Missing: {r.missingFields.join(", ")}</p>
              )}
              <p className="font-mono text-[10px] text-muted-foreground">
                prev {r.prevHash} → {r.hash}
              </p>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
