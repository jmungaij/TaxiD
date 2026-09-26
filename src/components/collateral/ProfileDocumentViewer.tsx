/**
 * Embedded PDF viewer for company collateral. Browsers that cannot display a
 * PDF inline still get a working download link, so the document is never a
 * dead end.
 */
import { Download, FileText } from "lucide-react";
import { Button } from "@/components/ui/button";

export interface ProfileDocumentViewerProps {
  url: string;
  title: string;
  /** Viewer height utility classes. */
  className?: string;
  onDownload?: () => void;
  downloadLabel?: string;
}

export function ProfileDocumentViewer({
  url,
  title,
  className = "h-[70vh] min-h-[520px]",
  onDownload,
  downloadLabel = "Download the profile (PDF)",
}: ProfileDocumentViewerProps) {
  return (
    <div className="space-y-4">
      <div className={`overflow-hidden rounded-xl border border-border bg-muted/30 ${className}`}>
        <object data={url} type="application/pdf" className="h-full w-full" aria-label={title}>
          <div className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center">
            <FileText className="h-10 w-10 text-primary" aria-hidden="true" />
            <p className="text-sm text-muted-foreground">
              Your browser can’t display the document here. Download it instead.
            </p>
            <Button asChild onClick={onDownload}>
              <a href={url} download target="_blank" rel="noopener noreferrer">
                {downloadLabel}
              </a>
            </Button>
          </div>
        </object>
      </div>
      <Button asChild size="lg" onClick={onDownload} data-analytics="collateral-download-profile">
        <a href={url} download target="_blank" rel="noopener noreferrer">
          <Download className="mr-2 h-4 w-4" aria-hidden="true" />
          {downloadLabel}
        </a>
      </Button>
    </div>
  );
}

export default ProfileDocumentViewer;
