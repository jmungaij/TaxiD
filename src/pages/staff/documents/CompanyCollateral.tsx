/**
 * Staff Documents → Company collateral.
 *
 * The approved, current company documents employees may share with prospects.
 * Every copy taken is logged so the business knows which version is in market.
 */
import { useEffect, useState } from "react";
import { Download, FileText, History } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ProfileDocumentViewer } from "@/components/collateral/ProfileDocumentViewer";
import {
  COMPANY_PROFILE_SLUG,
  fetchCollateralHistory,
  fetchPublishedCollateral,
  formatFileSize,
  logCollateralDownload,
  type Collateral,
} from "@/lib/collateral/companyProfile";

const StaffCompanyCollateral = () => {
  const [published, setPublished] = useState<Collateral[]>([]);
  const [history, setHistory] = useState<Collateral[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    void (async () => {
      const [pub, hist] = await Promise.all([
        fetchPublishedCollateral(),
        fetchCollateralHistory(COMPANY_PROFILE_SLUG),
      ]);
      setPublished(pub);
      setHistory(hist);
      setLoading(false);
    })();
  }, []);

  const current = published.find((p) => p.slug === COMPANY_PROFILE_SLUG) ?? published[0] ?? null;

  return (
    <div className="space-y-6 p-4 md:p-6">
      <header>
        <h1 className="text-2xl font-bold tracking-tight">Company collateral</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Approved documents you can share with clients and partners. Downloads are recorded.
        </p>
      </header>

      {loading && <p className="text-sm text-muted-foreground">Loading documents…</p>}

      {!loading && !current && (
        <Card>
          <CardHeader>
            <CardTitle>No published collateral yet</CardTitle>
            <CardDescription>
              Once a document is published it appears here for the whole team.
            </CardDescription>
          </CardHeader>
        </Card>
      )}

      {current && (
        <Card>
          <CardHeader>
            <div className="flex flex-wrap items-center gap-2">
              <FileText className="h-5 w-5 text-primary" aria-hidden="true" />
              <CardTitle>{current.title}</CardTitle>
              <Badge variant="outline">{current.version}</Badge>
              <Badge>Published</Badge>
            </div>
            <CardDescription>
              {current.description} · {current.page_count ?? "—"} pages · {formatFileSize(current.file_size)}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ProfileDocumentViewer
              url={current.file_url}
              title={current.title}
              className="h-[60vh] min-h-[440px]"
              downloadLabel="Download to share"
              onDownload={() => void logCollateralDownload(current.id, "staff_documents")}
            />
          </CardContent>
        </Card>
      )}

      {history.length > 1 && (
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <History className="h-5 w-5 text-primary" aria-hidden="true" />
              <CardTitle>Previous versions</CardTitle>
            </div>
            <CardDescription>Kept for reference — always share the published version.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {history
              .filter((h) => h.id !== current?.id)
              .map((h) => (
                <div key={h.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border p-3 text-sm">
                  <span className="flex items-center gap-2">
                    <Badge variant="outline">{h.version}</Badge> {h.title}
                    <span className="text-muted-foreground">({h.status})</span>
                  </span>
                  <Button size="sm" variant="ghost" asChild data-analytics="staff-collateral-history-download" onClick={() => void logCollateralDownload(h.id, "staff_documents_history")}>
                    <a href={h.file_url} download target="_blank" rel="noopener noreferrer" data-analytics="staff-collateral-history-download-link">

                      <Download className="mr-2 h-3.5 w-3.5" aria-hidden="true" /> Download
                    </a>
                  </Button>
                </div>
              ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
};

export default StaffCompanyCollateral;
