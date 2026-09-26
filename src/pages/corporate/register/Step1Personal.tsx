// Step 1 — Authorized Officer / Personal Information.
// - React Hook Form + Zod validation.
// - Autosaves every 1.5s of idle keystrokes.
// - "Save & continue" advances to Step 2 and records step 1 as completed.
import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useDraftCtx } from "./context";
import { KENYA_COUNTIES } from "./data";

const TITLES = ["Professor", "Dr.", "Mr.", "Mrs.", "Ms.", "Hon.", "Eng.", "Rev.", "Other"] as const;

const schema = z.object({
  title: z.string().min(1, "Required"),
  first_name: z.string().trim().min(1, "Required").max(80),
  middle_name: z.string().trim().max(80).optional().or(z.literal("")),
  last_name: z.string().trim().min(1, "Required").max(80),
  corporate_email: z.string().trim().email("Enter a valid email").max(255),
  personal_email: z.string().trim().email("Enter a valid email").max(255),
  corporate_phone: z.string().trim().min(7, "Enter a valid phone").max(20),
  personal_phone: z.string().trim().min(7, "Enter a valid phone").max(20),
  position: z.string().trim().min(2, "Required").max(120),
  department: z.string().trim().max(120).optional().or(z.literal("")),
  employee_number: z.string().trim().max(64).optional().or(z.literal("")),
  country: z.string().trim().min(1, "Required"),
  county: z.string().trim().min(1, "Required"),
  town: z.string().trim().min(1, "Required").max(120),
  street: z.string().trim().max(160).optional().or(z.literal("")),
  building: z.string().trim().max(120).optional().or(z.literal("")),
  floor: z.string().trim().max(32).optional().or(z.literal("")),
  office: z.string().trim().max(32).optional().or(z.literal("")),
  postal_code: z.string().trim().max(16).optional().or(z.literal("")),
  landmark: z.string().trim().max(160).optional().or(z.literal("")),
});
type FormValues = z.infer<typeof schema>;

export default function Step1Personal() {
  const nav = useNavigate();
  const { draft, save } = useDraftCtx();

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { country: "Kenya" },
  });

  useEffect(() => {
    if (draft?.personal_info) form.reset({ country: "Kenya", ...draft.personal_info } as FormValues);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft?.id]);

  // Autosave: watch form and debounce-save.
  useEffect(() => {
    const sub = form.watch((values) => {
      const t = setTimeout(() => {
        save({ personal_info: values as FormValues, current_step: 1 }).catch(() => {});
      }, 1500);
      return () => clearTimeout(t);
    });
    return () => sub.unsubscribe();
  }, [form, save]);

  const onSubmit = form.handleSubmit(async (values) => {
    await save({
      personal_info: values,
      current_step: 2,
      completed_steps: Array.from(new Set([...(draft?.completed_steps ?? []), 1])),
    });
    nav("/corporate/register/business");
  });

  return (
    <form onSubmit={onSubmit} className="space-y-8" noValidate>
      <div>
        <h2 className="text-xl font-semibold">Create your account</h2>
        <p className="text-sm text-muted-foreground">Register as an authorized corporate representative.</p>
      </div>

      <section aria-labelledby="personal-details" className="space-y-4">
        <h3 id="personal-details" className="text-base font-medium">Personal details</h3>

        <div className="grid gap-4 md:grid-cols-4">
          <Field label="Title *" error={form.formState.errors.title?.message}>
            <Select value={form.watch("title") ?? ""} onValueChange={(v) => form.setValue("title", v, { shouldValidate: true })}>
              <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
              <SelectContent>
                {TITLES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
              </SelectContent>
            </Select>
          </Field>
          <Field className="md:col-span-1" label="First name *" error={form.formState.errors.first_name?.message}>
            <Input autoComplete="given-name" {...form.register("first_name")} />
          </Field>
          <Field label="Middle name" error={form.formState.errors.middle_name?.message}>
            <Input autoComplete="additional-name" {...form.register("middle_name")} />
          </Field>
          <Field label="Last name *" error={form.formState.errors.last_name?.message}>
            <Input autoComplete="family-name" {...form.register("last_name")} />
          </Field>

          <Field label="Corporate email *" error={form.formState.errors.corporate_email?.message}>
            <Input type="email" autoComplete="work email" {...form.register("corporate_email")} />
          </Field>
          <Field label="Personal email *" error={form.formState.errors.personal_email?.message}>
            <Input type="email" autoComplete="email" {...form.register("personal_email")} />
          </Field>
          <Field label="Corporate phone *" error={form.formState.errors.corporate_phone?.message}>
            <Input type="tel" autoComplete="work tel" {...form.register("corporate_phone")} />
          </Field>
          <Field label="Personal phone *" error={form.formState.errors.personal_phone?.message}>
            <Input type="tel" autoComplete="tel" {...form.register("personal_phone")} />
          </Field>

          <Field className="md:col-span-2" label="Position in the organisation *" error={form.formState.errors.position?.message}>
            <Input placeholder="e.g. Finance Director" {...form.register("position")} />
          </Field>
          <Field label="Department" error={form.formState.errors.department?.message}>
            <Input {...form.register("department")} />
          </Field>
          <Field label="Employee number" error={form.formState.errors.employee_number?.message}>
            <Input {...form.register("employee_number")} />
          </Field>
        </div>
      </section>

      <section aria-labelledby="operating-location" className="space-y-4">
        <h3 id="operating-location" className="text-base font-medium">Operating location</h3>
        <div className="grid gap-4 md:grid-cols-4">
          <Field label="Country *" error={form.formState.errors.country?.message}>
            <Select value={form.watch("country") ?? "Kenya"} onValueChange={(v) => form.setValue("country", v, { shouldValidate: true })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="Kenya">Kenya</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          <Field label="County *" error={form.formState.errors.county?.message}>
            <Select value={form.watch("county") ?? ""} onValueChange={(v) => form.setValue("county", v, { shouldValidate: true })}>
              <SelectTrigger><SelectValue placeholder="Select county" /></SelectTrigger>
              <SelectContent className="max-h-72">
                {KENYA_COUNTIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Town / City *" error={form.formState.errors.town?.message}>
            <Input {...form.register("town")} />
          </Field>
          <Field label="Postal code" error={form.formState.errors.postal_code?.message}>
            <Input {...form.register("postal_code")} />
          </Field>

          <Field className="md:col-span-2" label="Street / road" error={form.formState.errors.street?.message}>
            <Input {...form.register("street")} />
          </Field>
          <Field label="Building name" error={form.formState.errors.building?.message}>
            <Input {...form.register("building")} />
          </Field>
          <Field label="Floor / office" error={form.formState.errors.floor?.message}>
            <Input placeholder="e.g. 3rd / 3A" {...form.register("floor")} />
          </Field>
          <Field className="md:col-span-4" label="Nearby landmark" error={form.formState.errors.landmark?.message}>
            <Input {...form.register("landmark")} />
          </Field>
        </div>
      </section>

      <div className="flex items-center justify-between border-t pt-4">
        <p className="text-xs text-muted-foreground">All fields marked * are required.</p>
        <Button type="submit" size="lg">Save &amp; continue → Business</Button>
      </div>
    </form>
  );
}

function Field({ label, error, children, className = "" }: { label: string; error?: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={`space-y-1 ${className}`}>
      <Label className="text-xs font-medium">{label}</Label>
      {children}
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}
