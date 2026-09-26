/**
 * Recruitment 360 — requirement editor for a DRAFT requirement version.
 *
 * Requirements are never edited live: the database refuses any change to a
 * published version, so this editor is only offered on a draft. Each row states
 * the requirement in the candidate's words, whether it is a hard requirement,
 * what evidence we accept, and the confirmation the candidate must give.
 */
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Plus, Trash2 } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import {
  listRequirementRules, removeRequirementRule, saveRequirementRule,
  type RequirementRuleInput, type RequirementRuleRow,
} from "@/lib/recruitment/requirementVersions";

const BLANK: RequirementRuleInput = {
  doc_key: "",
  label: "",
  doc_class: "role_specific",
  doc_type: "supporting",
  mandatory: true,
  requires_verification: true,
  hard_requirement: true,
  evidence_kind: "document",
  requirement_text: "",
  declaration_prompt: "",
  response_required: true,
  accepted_evidence_types: [],
};

function RuleForm({
  setId, initial, onSaved, onCancel,
}: {
  setId: string;
  initial: RequirementRuleInput;
  onSaved: () => void;
  onCancel?: () => void;
}) {
  const [rule, setRule] = useState<RequirementRuleInput>(initial);
  const [types, setTypes] = useState((initial.accepted_evidence_types ?? []).join("\n"));

  const save = useMutation({
    mutationFn: () =>
      saveRequirementRule(setId, {
        ...rule,
        doc_key: rule.doc_key.trim(),
        label: rule.label.trim(),
        accepted_evidence_types: types.split("\n").map((t) => t.trim()).filter(Boolean),
      }),
    onSuccess: () => { toast.success("Requirement saved to the draft version"); onSaved(); },
    onError: (e: Error) => toast.error(e.message),
  });

  const set = (patch: Partial<RequirementRuleInput>) => setRule({ ...rule, ...patch });

  return (
    <div className="space-y-3 rounded-xl border border-border p-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor={`label-${rule.id ?? "new"}`}>Requirement title *</Label>
          <Input
            id={`label-${rule.id ?? "new"}`}
            value={rule.label}
            onChange={(e) => set({ label: e.target.value })}
            placeholder="Evidence of ride-hailing corporate sales experience"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`key-${rule.id ?? "new"}`}>Evidence key *</Label>
          <Input
            id={`key-${rule.id ?? "new"}`}
            value={rule.doc_key}
            onChange={(e) => set({ doc_key: e.target.value.replace(/[^a-z0-9_]/gi, "_").toLowerCase() })}
            placeholder="ride_hailing_sales_experience"
          />
        </div>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor={`text-${rule.id ?? "new"}`}>Requirement as the candidate reads it *</Label>
        <Textarea
          id={`text-${rule.id ?? "new"}`}
          rows={3}
          value={rule.requirement_text ?? ""}
          onChange={(e) => set({ requirement_text: e.target.value })}
          placeholder="Minimum 2 years of proven corporate sales experience in a ride-hailing or mobility platform."
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor={`prompt-${rule.id ?? "new"}`}>Candidate confirmation question</Label>
        <Input
          id={`prompt-${rule.id ?? "new"}`}
          value={rule.declaration_prompt ?? ""}
          onChange={(e) => set({ declaration_prompt: e.target.value })}
          placeholder="Do you confirm at least 2 years of corporate sales experience in a mobility platform?"
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor={`types-${rule.id ?? "new"}`}>Accepted evidence (one per line)</Label>
        <Textarea
          id={`types-${rule.id ?? "new"}`}
          rows={3}
          value={types}
          onChange={(e) => setTypes(e.target.value)}
          placeholder={"Employment contract or letter\nReference letter on company letterhead\nPayslips covering the period"}
        />
      </div>

      <div className="flex flex-wrap gap-5">
        <label className="flex items-center gap-2 text-sm">
          <Checkbox
            checked={rule.hard_requirement !== false}
            onCheckedChange={(c) => set({ hard_requirement: c === true })}
          />
          Hard requirement (candidate is not eligible without it)
        </label>
        <label className="flex items-center gap-2 text-sm">
          <Checkbox
            checked={rule.response_required !== false}
            onCheckedChange={(c) => set({ response_required: c === true })}
          />
          Candidate must confirm it
        </label>
        <label className="flex items-center gap-2 text-sm">
          <Checkbox
            checked={rule.requires_verification !== false}
            onCheckedChange={(c) => set({ requires_verification: c === true })}
          />
          Evidence must be verified by staff
        </label>
      </div>

      <div className="flex justify-end gap-2">
        {onCancel && (
          <Button variant="outline" size="sm" onClick={onCancel} data-analytics="none">Cancel</Button>
        )}
        <Button
          size="sm"
          disabled={!rule.label.trim() || !rule.doc_key.trim() || save.isPending}
          onClick={() => save.mutate()}
          data-analytics="none"
        >Save requirement</Button>
      </div>
    </div>
  );
}

export default function RequirementRuleEditor({ setId }: { setId: string }) {
  const qc = useQueryClient();
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);

  const rules = useQuery({
    queryKey: ["rec", "requirement-rules", setId],
    queryFn: () => listRequirementRules(setId),
  });

  const refresh = () => {
    setAdding(false);
    setEditing(null);
    void qc.invalidateQueries({ queryKey: ["rec", "requirement-rules", setId] });
    void qc.invalidateQueries({ queryKey: ["rec", "requirement-versions"] });
  };

  const remove = useMutation({
    mutationFn: (ruleId: string) => removeRequirementRule(ruleId),
    onSuccess: () => { toast.success("Requirement removed from the draft"); refresh(); },
    onError: (e: Error) => toast.error(e.message),
  });

  if (rules.isLoading) return <Skeleton className="h-32" />;

  return (
    <div className="space-y-3">
      {(rules.data ?? []).map((r: RequirementRuleRow) =>
        editing === r.id ? (
          <RuleForm key={r.id} setId={setId} initial={r} onSaved={refresh} onCancel={() => setEditing(null)} />
        ) : (
          <div key={r.id} className="rounded-xl border border-border p-3 space-y-1.5">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="text-sm font-medium">{r.label}</div>
                {r.requirement_text ? (
                  <p className="text-xs text-muted-foreground">{r.requirement_text}</p>
                ) : null}
              </div>
              <div className="flex items-center gap-1.5">
                {r.hard_requirement ? <Badge variant="outline" className="text-[10px]">Hard</Badge> : null}
                <Button size="sm" variant="outline" onClick={() => setEditing(r.id)} data-analytics="none">Edit</Button>
                <Button
                  size="sm" variant="outline" data-analytics="none"
                  disabled={remove.isPending}
                  onClick={() => remove.mutate(r.id)}
                  aria-label={`Remove ${r.label}`}
                >
                  <Trash2 className="h-3.5 w-3.5" aria-hidden />
                </Button>
              </div>
            </div>
            {(r.accepted_evidence_types ?? []).length > 0 ? (
              <div className="flex flex-wrap gap-1.5">
                {r.accepted_evidence_types!.map((t) => (
                  <Badge key={t} variant="secondary" className="text-[10px] font-normal">{t}</Badge>
                ))}
              </div>
            ) : null}
          </div>
        ),
      )}

      {adding ? (
        <RuleForm setId={setId} initial={BLANK} onSaved={refresh} onCancel={() => setAdding(false)} />
      ) : (
        <Button size="sm" variant="outline" onClick={() => setAdding(true)} data-analytics="none">
          <Plus className="mr-1 h-3.5 w-3.5" aria-hidden />Add requirement
        </Button>
      )}
      <p className="text-xs text-muted-foreground">
        Requirements can only be edited on a draft version. Publishing supersedes the previous
        version and leaves it immutable, so applications already bound to it are unaffected.
      </p>
    </div>
  );
}
