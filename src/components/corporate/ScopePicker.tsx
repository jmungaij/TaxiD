import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export interface DeptOption { id: string; name: string }

export function useDepartments(corporateId: string | null) {
  const [depts, setDepts] = useState<DeptOption[]>([]);
  useEffect(() => {
    if (!corporateId) return;
    let active = true;
    (async () => {
      const { data } = await supabase
        .from("corporate_departments")
        .select("id,name")
        .eq("corporate_id", corporateId)
        .order("name");
      if (active) setDepts((data ?? []) as DeptOption[]);
    })();
    return () => { active = false; };
  }, [corporateId]);
  return depts;
}

export default function ScopePicker({
  value, onChange, depts,
}: {
  value: string; // "corporate" or a department id
  onChange: (v: string) => void;
  depts: DeptOption[];
}) {
  return (
    <div className="space-y-1.5 max-w-xs">
      <Label>Applies to</Label>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger aria-label="Choose who these settings apply to">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="corporate">Whole organisation</SelectItem>
          {depts.map((d) => (
            <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
