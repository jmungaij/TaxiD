/**
 * Partner lead → Recruitment 360 linkage.
 *
 * Every saved "Become a Partner" application is joined to a Recruitment 360
 * candidate by a database trigger, so the recruiter workspace always sees the
 * lead. Attaching that lead to a vacancy (requisition) is a recorded recruiter
 * action: `partner_lead_link_requisition` creates the recruitment application
 * server-side with the partner reference as its source. Nothing here decides
 * eligibility or creates records client-side.
 */
import { supabase } from "@/integrations/supabase/client";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

export interface PartnerLeadRow {
  id: string;
  reference: string;
  organisation_name: string;
  partner_type: string | null;
  category: string | null;
  contact_name: string;
  contact_email: string;
  contact_phone: string | null;
  country: string | null;
  city: string | null;
  status: string | null;
  created_at: string;
  link: {
    id: string;
    state: "CANDIDATE_LINKED" | "REQUISITION_LINKED";
    candidate_id: string;
    vacancy_id: string | null;
    application_id: string | null;
    linked_at: string;
    notes: string | null;
  } | null;
  candidate: { id: string; candidate_no: string; full_name: string; email: string | null } | null;
  vacancy: { id: string; title: string; vacancy_no: string } | null;
  application: { id: string; application_no: string; stage: string; status: string } | null;
}

export async function loadPartnerLeads(): Promise<PartnerLeadRow[]> {
  const apps = await db
    .from("partner_applications")
    .select(
      "id, reference, organisation_name, partner_type, category, contact_name, contact_email, contact_phone, country, city, status, created_at",
    )
    .order("created_at", { ascending: false })
    .limit(200);
  if (apps.error) throw new Error(apps.error.message);
  const rows = (apps.data ?? []) as PartnerLeadRow[];
  if (rows.length === 0) return [];

  const links = await db
    .from("partner_recruitment_links")
    .select("id, partner_application_id, candidate_id, vacancy_id, application_id, state, notes, linked_at")
    .in("partner_application_id", rows.map((r) => r.id));
  if (links.error) throw new Error(links.error.message);
  const linkRows = (links.data ?? []) as Array<Record<string, string | null>>;

  const candidateIds = linkRows.map((l) => l.candidate_id).filter(Boolean) as string[];
  const vacancyIds = linkRows.map((l) => l.vacancy_id).filter(Boolean) as string[];
  const applicationIds = linkRows.map((l) => l.application_id).filter(Boolean) as string[];

  const [cands, vacs, appl] = await Promise.all([
    candidateIds.length
      ? db.from("rec_candidates").select("id, candidate_no, full_name, email").in("id", candidateIds)
      : Promise.resolve({ data: [], error: null }),
    vacancyIds.length
      ? db.from("rec_vacancies").select("id, title, vacancy_no").in("id", vacancyIds)
      : Promise.resolve({ data: [], error: null }),
    applicationIds.length
      ? db.from("rec_applications").select("id, application_no, stage, status").in("id", applicationIds)
      : Promise.resolve({ data: [], error: null }),
  ]);

  const byId = <T extends { id: string }>(list: T[] | null) =>
    new Map((list ?? []).map((r) => [r.id, r]));
  const candidateMap = byId(cands.data as Array<{ id: string }> | null);
  const vacancyMap = byId(vacs.data as Array<{ id: string }> | null);
  const applicationMap = byId(appl.data as Array<{ id: string }> | null);

  return rows.map((row) => {
    const link = linkRows.find((l) => l.partner_application_id === row.id) ?? null;
    return {
      ...row,
      link: link ? (link as unknown as PartnerLeadRow["link"]) : null,
      candidate: link?.candidate_id
        ? ((candidateMap.get(link.candidate_id) ?? null) as PartnerLeadRow["candidate"])
        : null,
      vacancy: link?.vacancy_id
        ? ((vacancyMap.get(link.vacancy_id) ?? null) as PartnerLeadRow["vacancy"])
        : null,
      application: link?.application_id
        ? ((applicationMap.get(link.application_id) ?? null) as PartnerLeadRow["application"])
        : null,
    };
  });
}

export interface RequisitionOption {
  id: string;
  title: string;
  vacancy_no: string;
  status: string | null;
}

export async function loadRequisitionOptions(): Promise<RequisitionOption[]> {
  const { data, error } = await db
    .from("rec_vacancies")
    .select("id, title, vacancy_no, status")
    .order("created_at", { ascending: false })
    .limit(200);
  if (error) throw new Error(error.message);
  return (data ?? []) as RequisitionOption[];
}

export const LEAD_LINK_REFUSAL_COPY: Record<string, string> = {
  AUTHORIZATION_ERROR: "You do not hold the recruitment permission needed to link this lead.",
  PARTNER_APPLICATION_NOT_FOUND: "That partner application no longer exists.",
  VACANCY_NOT_FOUND: "Choose an existing vacancy.",
};

export async function linkLeadToRequisition(input: {
  partnerApplicationId: string;
  vacancyId: string;
  notes?: string;
}): Promise<{ candidate_id: string; application_id: string }> {
  const { data, error } = await db.rpc("partner_lead_link_requisition", {
    p: {
      partner_application_id: input.partnerApplicationId,
      vacancy_id: input.vacancyId,
      notes: input.notes ?? null,
    },
  });
  if (error) throw new Error(error.message);
  const result = (data ?? {}) as { ok?: boolean; code?: string; candidate_id?: string; application_id?: string };
  if (!result.ok) {
    throw new Error(LEAD_LINK_REFUSAL_COPY[result.code ?? ""] ?? "The lead could not be linked.");
  }
  return { candidate_id: result.candidate_id!, application_id: result.application_id! };
}
