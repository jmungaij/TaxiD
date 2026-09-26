/**
 * Report export control — one dropdown that downloads any `ReportTable`
 * as CSV or PDF.
 */
import * as React from "react";
import { Download, FileSpreadsheet, FileText, Loader2 } from "lucide-react";
import { toast } from "sonner";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  downloadReportCsv, downloadReportPdf, type ReportTable,
} from "@/lib/corporate/executiveExports";
import { AppButton } from "@/components/nav/AppButton";

export interface ReportExportMenuProps {
  label: string;
  /** Built lazily so large tables are only materialised on click. */
  build: () => ReportTable;
  disabled?: boolean;
  size?: "sm" | "default";
  variant?: "default" | "outline" | "secondary" | "ghost";
}

export function ReportExportMenu({
  label, build, disabled, size = "sm", variant = "outline",
}: ReportExportMenuProps) {
  const [busy, setBusy] = React.useState(false);

  const run = async (kind: "csv" | "pdf") => {
    setBusy(true);
    try {
      const table = build();
      if (kind === "csv") downloadReportCsv(table);
      else await downloadReportPdf(table);
      toast.success(`${table.title} exported as ${kind.toUpperCase()}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Export failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <AppButton analytics="executive_report_export_menu_open" action="dialog" size={size} variant={variant} aria-label={`${label} — download as CSV or PDF`} disabled={disabled || busy}>
          {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Download className="mr-2 h-4 w-4" />}
          {label}
        </AppButton>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onClick={() => void run("csv")}>
          <FileSpreadsheet className="mr-2 h-4 w-4" /> {`Download ${label} (CSV)`}
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => void run("pdf")}>
          <FileText className="mr-2 h-4 w-4" /> {`Download ${label} (PDF)`}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export default ReportExportMenu;
