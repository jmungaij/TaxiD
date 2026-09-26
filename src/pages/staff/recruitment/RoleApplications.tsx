import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { Download, Eye, FileText, Mail, Phone } from "lucide-react";

import { StaffPageHeader } from "@/components/staff/primitives";
import { Card, CardContent, CardDescription, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { signedDocumentUrl } from "@/lib/recruitment/documentControl";

/**
 * Recruitment 360 — role applications and candidate documents.
 *
 * One row per application on the selected vacancy with the candidate's contact
 * details and their uploaded documents. Document access is a short-lived signed
 * link minted only for recruitment staff, and every view or download is logged
 * by the database.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

interface ApplicationRow {
  id: string;
  application_no: string;
  stage: string;
  status: string;
  source: string | null;
  applied_at: string;
  candidate_id: string;
}

interface CandidateRow {
  id: string;
  candidate_no: string;
  full_name: string;
  email: string | null;
  phone: string | null;
  location: string | null;
}

interface DocumentRow {
  id: string;
  application_id: string | null;
  candidate_id: string;
  doc_key: string | null;
  doc_type: string | null;
  file_name: string | null;
  storage_path: string;
  verification_status: string | null;
  created_at: string;
}

const isCv = (d: DocumentRow) =>
  d.doc_type === "cv" || (d.doc_key ?? "").toLowerCase().includes("cv");

export default function RoleApplications() {
  const [vacancyId, setVacancyId] = useState("");
  const [search, setSearch] = useState("");

  const vacancies = useQuery({
    queryKey: ["rec", "role-applications", "vacancies"],
    queryFn: async () => {
      const { data, error } = await db
        .from("rec_vacancies")
        .select("id, title, vacancy_no, status")
        .order("created_at", { ascending: false })
        .limit(200);
      if (error) throw new Error(error.message);
      return (data ?? []) as Array<{ id: string; title: string; vacancy_no: string; status: string | null }>;
    },
  });

  const selected =
    vacancyId ||
    vacancies.data?.find((v) => v.title.toLowerCase().includes("corporate sales"))?.id ||
    vacancies.data?.[0]?.id ||
    "";

  const applications = useQuery({
    queryKey: ["rec", "role-applications", selected],
    enabled: Boolean(selected),
    queryFn: async () => {
      const apps = await db
        .from("rec_applications")
        .select("id, application_no, stage, status, source, applied_at, candidate_id")
        .eq("vacancy_id", selected)
        .order("applied_at", { ascending: false })
        .limit(300);
      if (apps.error) throw new Error(apps.error.message);
      const rows = (apps.data ?? []) as ApplicationRow[];
      if (rows.length === 0) return { rows, candidates: [] as CandidateRow[], documents: [] as DocumentRow[] };

      const [cands, docs] = await Promise.all([
        db.from("rec_candidates")
          .select("id, candidate_no, full_name, email, phone, location")
          .in("id", rows.map((r) => r.candidate_id)),
        db.from("rec_candidate_documents")
          .select("id, application_id, candidate_id, doc_key, doc_type, file_name, storage_path, verification_status, created_at")
          .in("application_id", rows.map((r) => r.id)),
      ]);
      if (cands.error) throw new Error(cands.error.message);
      if (docs.error) throw new Error(docs.error.message);
      return {
        rows,
        candidates: (cands.data ?? []) as CandidateRow[],
        documents: (docs.data ?? []) as DocumentRow[],
      };
    },
  });

  const open = async (doc: DocumentRow, purpose: "view" | "download") => {
    try {
      const url = await signedDocumentUrl(doc.storage_path, doc.id, purpose);
      window.open(url, "_blank", "noopener,noreferrer");
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  const list = useMemo(() => {
    const data = applications.data;
    if (!data) return [];
    const q = search.trim().toLowerCase();
    const byCandidate = new Map(data.candidates.map((c) => [c.id, c]));
    return data.rows
      .map((app) => ({
        app,
        candidate: byCandidate.get(app.candidate_id) ?? null,
        documents: data.documents.filter((d) => d.application_id === app.id),
      }))
      .filter(({ app, candidate }) =>
        !q ||
        [app.application_no, candidate?.full_name, candidate?.email, candidate?.candidate_no]
          .filter(Boolean)
          .some((v) => String(v).toLowerCase().includes(q)),
      );
  }, [applications.data, search]);

  return (
    <div className="space-y-6">
      <StaffPageHeader
        title="Applications & candidate CVs"
        lede="Open each application on a role, see the candidate and read their CV and supporting documents."
      />

      <Card>
        <CardHeader className="gap-4">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div className="space-y-2 min-w-[18rem]">
              <Label>Role</Label>
              <Select value={selected} onValueChange={setVacancyId}>
                <SelectTrigger><SelectValue placeholder="Choose a role" /></SelectTrigger>
                <SelectContent>
                  {(vacancies.data ?? []).map((v) => (
                    <SelectItem key={v.id} value={v.id}>{v.title} · {v.vacancy_no}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search candidate or application"
              className="max-w-xs"
            />
          </div>
          <CardDescription>
            Every document view and download is recorded against the candidate's file.
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {applications.isLoading && <div className="p-6 space-y-3">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-16 w-full" />)}</div>}
          {applications.isError && <p className="p-6 text-sm text-destructive">{(applications.error as Error).message}</p>}
          {!applications.isLoading && list.length === 0 && (
            <p className="p-6 text-sm text-muted-foreground">No applications on this role yet.</p>
          )}
          <div className="divide-y">
            {list.map(({ app, candidate, documents }) => {
              const cv = documents.find(isCv);
              const others = documents.filter((d) => !isCv(d));
              return (
                <div key={app.id} className="p-4 space-y-3">
                  <div className="flex flex-wrap items-start justify-between gap-4">
                    <div className="space-y-1 min-w-[16rem]">
                      <div className="font-medium">{candidate?.full_name ?? "Candidate record missing"}</div>
                      <p className="text-xs font-mono text-muted-foreground">
                        {app.application_no}
                        {candidate ? ` · ${candidate.candidate_no}` : ""}
                      </p>
                      <p className="text-sm text-muted-foreground flex flex-wrap items-center gap-3">
                        {candidate?.email && (
                          <span className="flex items-center gap-1"><Mail className="h-3.5 w-3.5" />{candidate.email}</span>
                        )}
                        {candidate?.phone && (
                          <span className="flex items-center gap-1"><Phone className="h-3.5 w-3.5" />{candidate.phone}</span>
                        )}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        Applied {new Date(app.applied_at).toLocaleDateString()} · source {app.source ?? "—"}
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant="secondary">{app.stage}</Badge>
                      <Badge variant="outline">{app.status}</Badge>
                      {cv ? (
                        <>
                          <Button size="sm" variant="outline" onClick={() => open(cv, "view")}>
                            <Eye className="h-4 w-4 mr-1" /> View CV
                          </Button>
                          <Button size="sm" variant="ghost" data-analytics="recruitment-cv-download" onClick={() => open(cv, "download")}>
                            <Download className="h-4 w-4 mr-1" /> Download
                          </Button>
                        </>
                      ) : (
                        <Badge variant="outline">No CV on file</Badge>
                      )}
                      <Button asChild size="sm">
                        <Link to={`/staff/recruitment/applications/${app.id}`}>Open application</Link>
                      </Button>
                    </div>
                  </div>

                  {others.length > 0 && (
                    <div className="flex flex-wrap gap-2">
                      {others.map((doc) => (
                        <Button key={doc.id} size="sm" variant="outline" onClick={() => open(doc, "view")}>
                          <FileText className="h-4 w-4 mr-1" />
                          {doc.file_name ?? doc.doc_key ?? "Document"}
                          {doc.verification_status ? ` · ${doc.verification_status}` : ""}
                        </Button>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
