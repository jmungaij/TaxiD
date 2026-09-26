/**
 * Document readiness indicator for candidate cards.
 *
 * The percentage is a summary only — never a substitute for the requirement
 * checklist, so the tooltip lists exactly what is outstanding.
 */
import { useQuery } from "@tanstack/react-query";
import { FileCheck2, FileWarning } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  Tooltip, TooltipContent, TooltipProvider, TooltipTrigger,
} from "@/components/ui/tooltip";
import { screeningDocumentGate } from "@/lib/recruitment/documentControl";

export default function DocumentReadinessBadge({ applicationId }: { applicationId: string }) {
  const gate = useQuery({
    queryKey: ["recruitment", "document-gate", applicationId],
    queryFn: () => screeningDocumentGate(applicationId),
    staleTime: 30_000,
  });

  if (gate.isLoading || gate.isError || !gate.data) return null;

  const { completion_percent: percent, outstanding, allowed } = gate.data;
  const outstandingList = outstanding ?? [];

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <Badge variant={allowed ? "outline" : "destructive"} className="gap-1">
            {allowed ? (
              <FileCheck2 className="h-3 w-3" aria-hidden="true" />
            ) : (
              <FileWarning className="h-3 w-3" aria-hidden="true" />
            )}
            {percent}%
          </Badge>
        </TooltipTrigger>
        <TooltipContent className="max-w-xs">
          {outstandingList.length === 0 ? (
            <p className="text-xs">All mandatory documents provided.</p>
          ) : (
            <div className="text-xs">
              <p className="font-medium">Outstanding documents</p>
              <ul className="mt-1 list-disc pl-4">
                {outstandingList.map((o) => <li key={o}>{o}</li>)}
              </ul>
            </div>
          )}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
