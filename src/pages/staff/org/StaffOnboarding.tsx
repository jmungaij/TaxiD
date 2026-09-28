/**
 * STAFF ONBOARDING — add an employee and create their login in one action.
 *
 * The browser never creates accounts or grants roles: it collects the details
 * and calls the guarded `staff-onboard` server function, which verifies the
 * caller is a platform administrator, creates the confirmed login, writes the
 * staff register entry with position, department and reporting line, grants the
 * platform role in the roles table, and records the action in the audit log.
 */
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { Copy, KeyRound, Loader2, ShieldCheck, UserPlus } from "lucide-react";

import { StaffPageHeader } from "@/components/staff/primitives";
import { AdminOnly } from "@/components/auth/AdminOnly";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { SelectField, TextField } from "@/components/staff/org/OrgForms";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { supabase } from "@/integrations/supabase/client";
import * as org from "@/lib/staff/org/api";
import { EMPLOYMENT_STATUSES, EMPLOYMENT_TYPES, titleise } from "@/lib/staff/org/types";

/** Platform roles an administrator may grant from this page. */
const ROLE_OPTIONS = [
  { value: "rider", label: "Employee (no elevated access)" },
  { value: "operations_manager", label: "Operations Manager" },
  { value: "operations_admin", label: "Operations Administrator" },
  { value: "corporate_manager", label: "Corporate Manager" },
  { value: "dispatch_manager", label: "Dispatch Manager" },
  { value: "fleet_manager", label: "Fleet Manager" },
  { value: "pricing_manager", label: "Pricing Manager" },
  { value: "finance_admin", label: "Finance Administrator" },
  { value: "compliance_admin", label: "Compliance Administrator" },
  { value: "general_manager", label: "General Manager" },
  { value: "director", label: "Director" },
  { value: "admin", label: "Platform Administrator" },
];

type Result = {
  staffId: string;
  staffNo: string;
  workEmail: string;
  role: string;
  temporaryPassword: string | null;
};

const EMPTY = {
  fullName: "",
  workEmail: "",
  personalEmail: "",
  phone: "",
  positionId: "",
  unitId: "",
  managerStaffId: "",
  role: "rider",
  employmentType: "permanent",
  employmentStatus: "active",
  startDate: "",
  location: "",
  password: "",
};

export default function StaffOnboarding() {
  const qc = useQueryClient();
  const [form, setForm] = useState({ ...EMPTY });
  const [created, setCreated] = useState<Result[]>([]);

  const unitsQ = useQuery({ queryKey: ["org", "units"], queryFn: org.listUnits });
  const posQ = useQuery({ queryKey: ["org", "positions"], queryFn: org.listPositions });
  const staffQ = useQuery({ queryKey: ["org", "staff"], queryFn: org.listStaff });

  const set = (k: keyof typeof EMPTY) => (v: string) => setForm((f) => ({ ...f, [k]: v }));

  const positionOptions = useMemo(
    () => (posQ.data ?? []).map((p) => ({ value: p.id, label: p.title })),
    [posQ.data],
  );
  const unitOptions = useMemo(
    () => (unitsQ.data ?? []).map((u) => ({ value: u.id, label: `${u.name} (${titleise(u.unit_type)})` })),
    [unitsQ.data],
  );
  const managerOptions = useMemo(
    () =>
      (staffQ.data ?? [])
        .filter((s) => s.employment_status === "active")
        .map((s) => ({ value: s.id, label: `${s.full_name} — ${s.staff_no}` })),
    [staffQ.data],
  );

  const onboard = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke("staff-onboard", {
        body: {
          fullName: form.fullName.trim(),
          workEmail: form.workEmail.trim(),
          personalEmail: form.personalEmail.trim() || null,
          phone: form.phone.trim() || null,
          positionId: form.positionId || null,
          unitId: form.unitId || null,
          managerStaffId: form.managerStaffId || null,
          role: form.role,
          employmentType: form.employmentType,
          employmentStatus: form.employmentStatus,
          startDate: form.startDate || null,
          location: form.location.trim() || null,
          password: form.password.trim() || null,
        },
      });
      if (error) {
        const detail = await (error as { context?: { text?: () => Promise<string> } }).context?.text?.();
        let message = error.message;
        try {
          const parsed = detail ? JSON.parse(detail) : null;
          if (parsed?.error) message = parsed.error;
        } catch {
          if (detail) message = detail;
        }
        throw new Error(message);
      }
      const payload = data as Result & { error?: string };
      if (payload?.error) throw new Error(payload.error);
      return payload;
    },
    onSuccess: (r) => {
      setCreated((prev) => [r, ...prev]);
      setForm({ ...EMPTY });
      qc.invalidateQueries({ queryKey: ["org"] });
      toast.success(`${r.staffNo} added — the login is ready`, {
        description: r.temporaryPassword
          ? "Copy the temporary password below and share it securely."
          : "The password you set is active immediately.",
      });
    },
    onError: (e: Error) => toast.error("Could not add this employee", { description: e.message }),
  });

  const ready =
    form.fullName.trim().length > 1 && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(form.workEmail.trim());

  return (
    <AdminOnly>
      <div className="space-y-6">
        <StaffPageHeader
          eyebrow="People & organisation"
          title="Staff onboarding"
          lede="Add an employee with their job title, department and reporting line. Their workspace login is created at the same time, confirmed and ready to use."
        />


        <Card>
          <CardContent className="space-y-5 pt-6">
            <div className="grid gap-4 md:grid-cols-2">
              <TextField label="Full name" value={form.fullName} onChange={set("fullName")} required placeholder="Jane Wanjiku Mwangi" />
              <TextField
                label="Work email (this is their login)"
                value={form.workEmail}
                onChange={set("workEmail")}
                required
                type="email"
                placeholder="jmwangi@taxid.us"
              />
              <TextField label="Personal email" value={form.personalEmail} onChange={set("personalEmail")} type="email" />
              <TextField label="Phone" value={form.phone} onChange={set("phone")} placeholder="+254…" />
            </div>

            <div className="grid gap-4 md:grid-cols-3">
              <SelectField
                label="Job title"
                value={form.positionId}
                onChange={set("positionId")}
                options={positionOptions}
                placeholder={posQ.isLoading ? "Loading…" : "Select an approved position"}
                hint="Titles come from the approved position list."
              />
              <SelectField
                label="Department"
                value={form.unitId}
                onChange={set("unitId")}
                options={unitOptions}
                placeholder={unitsQ.isLoading ? "Loading…" : "Select a department"}
              />
              <SelectField
                label="Reports to"
                value={form.managerStaffId}
                onChange={set("managerStaffId")}
                options={managerOptions}
                placeholder="Select their manager"
                hint="The manager sees this person on their My team page."
              />
            </div>

            <div className="grid gap-4 md:grid-cols-3">
              <SelectField
                label="Workspace access"
                value={form.role}
                onChange={set("role")}
                options={ROLE_OPTIONS}
                hint="Controls which workspace areas they can open."
              />
              <SelectField
                label="Employment type"
                value={form.employmentType}
                onChange={set("employmentType")}
                options={EMPLOYMENT_TYPES.map((v) => ({ value: v, label: titleise(v) }))}
              />
              <SelectField
                label="Employment status"
                value={form.employmentStatus}
                onChange={set("employmentStatus")}
                options={EMPLOYMENT_STATUSES.map((v) => ({ value: v, label: titleise(v) }))}
              />
            </div>

            <div className="grid gap-4 md:grid-cols-3">
              <TextField label="Start date" value={form.startDate} onChange={set("startDate")} type="date" />
              <TextField label="Location" value={form.location} onChange={set("location")} placeholder="Nairobi" />
              <TextField
                label="Set a password (optional)"
                value={form.password}
                onChange={set("password")}
                hint="Leave blank and a strong temporary password is generated for you."
              />
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-4">
              <p className="flex items-center gap-2 text-xs text-muted-foreground">
                <ShieldCheck className="h-4 w-4" aria-hidden />
                Only platform administrators can add employees, and every addition is recorded in the audit log.
              </p>
              <Button className="gap-2" disabled={!ready || onboard.isPending} onClick={() => onboard.mutate()}>
                {onboard.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserPlus className="h-4 w-4" />}
                Add employee &amp; create login
              </Button>
            </div>
          </CardContent>
        </Card>

        {created.length > 0 && (
          <Card>
            <CardContent className="pt-6">
              <h2 className="flex items-center gap-2 text-sm font-semibold">
                <KeyRound className="h-4 w-4" aria-hidden /> Added in this session
              </h2>
              <p className="mt-1 text-xs text-muted-foreground">
                Temporary passwords are shown once — copy and share them securely, then ask the employee to change it after signing in.
              </p>
              <Table className="mt-4">
                <TableHeader>
                  <TableRow>
                    <TableHead>Staff no.</TableHead>
                    <TableHead>Login</TableHead>
                    <TableHead>Access</TableHead>
                    <TableHead>Temporary password</TableHead>
                    <TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {created.map((r) => (
                    <TableRow key={r.staffId}>
                      <TableCell className="font-medium">{r.staffNo}</TableCell>
                      <TableCell>{r.workEmail}</TableCell>
                      <TableCell>
                        <Badge variant="outline">{titleise(r.role)}</Badge>
                      </TableCell>
                      <TableCell className="font-mono text-xs">
                        {r.temporaryPassword ? (
                          <span className="inline-flex items-center gap-2">
                            {r.temporaryPassword}
                            <Button
                              size="icon"
                              variant="ghost"
                              className="h-6 w-6"
                              onClick={() => {
                                void navigator.clipboard.writeText(r.temporaryPassword!);
                                toast.success("Password copied");
                              }}
                            >
                              <Copy className="h-3 w-3" />
                            </Button>
                          </span>
                        ) : (
                          <span className="text-muted-foreground">Set by you</span>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        <Button asChild size="sm" variant="outline">
                          <Link to={`/staff/org/people/${r.staffId}`}>Open profile</Link>
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        )}
      </div>
    </AdminOnly>
  );
}
