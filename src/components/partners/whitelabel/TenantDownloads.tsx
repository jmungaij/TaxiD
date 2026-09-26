/**
 * TENANT ARTEFACT DOWNLOADS — versioned specs, webhook schemas, migration diffs.
 *
 * Every artefact is generated from the canonical contract at download time, so
 * a file can never describe a surface the platform does not publish. The tenant
 * code is stamped into the artefact, which makes a saved file unambiguous later.
 */
import { useMemo, useState } from "react";
import { Download, FileJson, FileText, GitCompare } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

import { WHITE_LABEL_RELEASES, currentWhiteLabelRelease, diffWhiteLabelReleases } from "@/lib/partners/whiteLabelApi";
import {
  diffArtifacts, downloadWlArtifact, tenantOpenApiArtifact, webhookContractArtifact,
  type WlArtifact,
} from "@/lib/partners/whiteLabelReports";

const STATUS_VARIANT: Record<string, "default" | "secondary" | "outline"> = {
  current: "default",
  supported: "secondary",
  deprecated: "outline",
};

export default function TenantDownloads({ tenantCode }: { tenantCode?: string }) {
  const current = currentWhiteLabelRelease();
  const [version, setVersion] = useState(current.version);
  const [fromVersion, setFromVersion] = useState(
    WHITE_LABEL_RELEASES.find((r) => r.version !== current.version)?.version ?? current.version,
  );

  const diff = useMemo(
    () => diffWhiteLabelReleases(fromVersion, version),
    [fromVersion, version],
  );

  const grab = (artifact: WlArtifact | null) => {
    if (!artifact) {
      toast.error("Nothing to download for that selection");
      return;
    }
    downloadWlArtifact(artifact);
    toast.success(`${artifact.filename} downloaded`);
  };

  const release = WHITE_LABEL_RELEASES.find((r) => r.version === version) ?? current;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileJson className="h-4 w-4 text-primary" /> Versioned specification
          </CardTitle>
          <CardDescription>
            The OpenAPI document for one release, with the mandatory tenant header applied and your
            tenant code as the header example.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="wl-spec-version">Release</Label>
              <Select value={version} onValueChange={setVersion}>
                <SelectTrigger id="wl-spec-version"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {WHITE_LABEL_RELEASES.map((r) => (
                    <SelectItem key={r.version} value={r.version}>
                      {r.version} · {r.status}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-end gap-2">
              <Button onClick={() => grab(tenantOpenApiArtifact(version, tenantCode))}>
                <Download className="mr-2 h-4 w-4" />OpenAPI 3.1
              </Button>
              <Button variant="outline" onClick={() => grab(webhookContractArtifact(tenantCode))}>
                <Download className="mr-2 h-4 w-4" />Webhook schemas
              </Button>
            </div>
          </div>

          <div className="rounded-lg border p-4 text-sm">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant={STATUS_VARIANT[release.status] ?? "outline"}>{release.status}</Badge>
              <span className="text-muted-foreground">released {release.releasedOn}</span>
              {release.sunsetOn && (
                <span className="text-muted-foreground">· sunset {release.sunsetOn}</span>
              )}
              <span className="text-muted-foreground">· {release.operations.length} operations</span>
            </div>
            <p className="mt-2 text-muted-foreground">{release.headline}</p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <GitCompare className="h-4 w-4 text-primary" /> Changelog diff and migration report
          </CardTitle>
          <CardDescription>
            Breaking changes are listed first, then operations added and removed between the two
            releases. Download as JSON for tooling or Markdown for your change record.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="space-y-1.5">
              <Label htmlFor="wl-diff-from">From</Label>
              <Select value={fromVersion} onValueChange={setFromVersion}>
                <SelectTrigger id="wl-diff-from"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {WHITE_LABEL_RELEASES.map((r) => (
                    <SelectItem key={r.version} value={r.version}>{r.version}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="wl-diff-to">To</Label>
              <Select value={version} onValueChange={setVersion}>
                <SelectTrigger id="wl-diff-to"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {WHITE_LABEL_RELEASES.map((r) => (
                    <SelectItem key={r.version} value={r.version}>{r.version}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-end gap-2">
              {diffArtifacts(fromVersion, version, tenantCode).map((a) => (
                <Button
                  key={a.filename}
                  variant={a.mime === "text/markdown" ? "outline" : "default"}
                  onClick={() => grab(a)}
                >
                  {a.mime === "text/markdown"
                    ? <FileText className="mr-2 h-4 w-4" />
                    : <Download className="mr-2 h-4 w-4" />}
                  {a.mime === "text/markdown" ? "Markdown" : "JSON"}
                </Button>
              ))}
            </div>
          </div>

          {!diff || fromVersion === version ? (
            <p className="text-sm text-muted-foreground">
              Select two different releases to see a diff.
            </p>
          ) : (
            <div className="space-y-4 text-sm">
              <div>
                <p className="font-medium">Breaking changes ({diff.breakingChanges.length})</p>
                {diff.breakingChanges.length === 0 ? (
                  <p className="text-muted-foreground">None — this upgrade is backward compatible.</p>
                ) : (
                  <ul className="mt-1 space-y-1 text-muted-foreground">
                    {diff.breakingChanges.map((c, i) => (
                      <li key={`${c.domain}-${i}`}>
                        <Badge variant="destructive" className="mr-2">{c.domain}</Badge>{c.summary}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <p className="font-medium">Operations added ({diff.addedOperations.length})</p>
                  <ul className="mt-1 space-y-0.5 text-xs text-muted-foreground">
                    {diff.addedOperations.length === 0 && <li>None</li>}
                    {diff.addedOperations.map((o) => <li key={o}><code>{o}</code></li>)}
                  </ul>
                </div>
                <div>
                  <p className="font-medium">Operations removed ({diff.removedOperations.length})</p>
                  <ul className="mt-1 space-y-0.5 text-xs text-muted-foreground">
                    {diff.removedOperations.length === 0 && <li>None</li>}
                    {diff.removedOperations.map((o) => <li key={o}><code>{o}</code></li>)}
                  </ul>
                </div>
              </div>
              {diff.otherChanges.length > 0 && (
                <div>
                  <p className="font-medium">Other changes ({diff.otherChanges.length})</p>
                  <ul className="mt-1 space-y-1 text-muted-foreground">
                    {diff.otherChanges.map((c, i) => (
                      <li key={`${c.domain}-other-${i}`}>
                        <Badge variant="outline" className="mr-2">{c.domain}</Badge>{c.summary}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
