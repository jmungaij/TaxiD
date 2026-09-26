// Step 2 — Corporate Business Information.
// Dynamic form:
//   • Legal Business Registration Type gate (Limited Company | Registered Business)
//   • Progressive disclosure of fields + required documents based on choice.
import { useEffect, useMemo } from "react";
import { useForm, type Resolver } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Building2, FileCheck2, Info } from "lucide-react";
import { useDraftCtx } from "./context";
import { KENYA_COUNTIES, BUSINESS_INDUSTRIES, BUSINESS_TYPES } from "./data";
import type { BusinessRegistrationType } from "./useRegistrationDraft";

const baseShape = {
  registered_name: z.string().trim().min(2, "Required").max(200),
  trading_name: z.string().trim().max(200).optional().or(z.literal("")),
  kra_pin: z.string().trim().regex(/^[A-Z0-9]{9,15}$/, "Enter a valid KRA PIN"),
  vat_number: z.string().trim().max(32).optional().or(z.literal("")),
  category: z.string().trim().min(1, "Required"),
  industry: z.string().trim().min(1, "Required"),
  business_type: z.string().trim().min(1, "Required"),
  employees: z.coerce.number().int().nonnegative().optional(),
  monthly_trips: z.coerce.number().int().nonnegative().optional(),
  monthly_budget: z.coerce.number().nonnegative().optional(),
  county: z.string().trim().min(1, "Required"),
  town: z.string().trim().min(1, "Required").max(120),
  street: z.string().trim().max(160).optional().or(z.literal("")),
  building: z.string().trim().max(120).optional().or(z.literal("")),
  floor: z.string().trim().max(32).optional().or(z.literal("")),
  office: z.string().trim().max(32).optional().or(z.literal("")),
  postal_address: z.string().trim().max(160).optional().or(z.literal("")),
};

const limitedSchema = z.object({
  ...baseShape,
  certificate_of_incorporation_number: z.string().trim().min(3, "Required").max(64),
});
const registeredSchema = z.object({
  ...baseShape,
  registration_number: z.string().trim().min(3, "Required").max(64),
});

type FormValues = z.infer<typeof limitedSchema> & Partial<z.infer<typeof registeredSchema>>;

export default function Step2Business() {
  const nav = useNavigate();
  const { draft, save } = useDraftCtx();
  const brt: BusinessRegistrationType | null = draft?.business_registration_type ?? null;

  const schema = useMemo(
    () => (brt === "registered_business" ? registeredSchema : limitedSchema),
    [brt],
  );

  const form = useForm<FormValues>({
    resolver: zodResolver(schema) as unknown as Resolver<FormValues, unknown, FormValues>,
  });

  useEffect(() => {
    if (draft?.business_info) form.reset(draft.business_info as FormValues);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft?.id, brt]);

  useEffect(() => {
    const sub = form.watch((values) => {
      const t = setTimeout(() => {
        save({ business_info: values as FormValues, current_step: 2 }).catch(() => {});
      }, 1500);
      return () => clearTimeout(t);
    });
    return () => sub.unsubscribe();
  }, [form, save]);

  const setBrt = async (v: BusinessRegistrationType) => {
    await save({ business_registration_type: v, current_step: 2 });
  };

  const onSubmit = form.handleSubmit(async (values) => {
    if (!brt) return;
    await save({
      business_info: values,
      current_step: 3,
      completed_steps: Array.from(new Set([...(draft?.completed_steps ?? []), 2])),
    });
    nav("/corporate/register/verification");
  });

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-xl font-semibold">Corporate business information</h2>
        <p className="text-sm text-muted-foreground">
          Yalla collects the correct legal documents based on your registration type.
        </p>
      </div>

      {/* Legal registration type gate — always shown first. */}
      <section aria-labelledby="brt" className="space-y-3">
        <h3 id="brt" className="text-base font-medium">How is your business legally registered? *</h3>
        <RadioGroup
          value={brt ?? ""}
          onValueChange={(v) => setBrt(v as BusinessRegistrationType)}
          className="grid gap-3 md:grid-cols-2"
        >
          <label
            htmlFor="brt-limited"
            className={`flex cursor-pointer items-start gap-3 rounded-lg border p-4 transition
              ${brt === "limited_company" ? "border-primary bg-primary/5" : "hover:border-primary/40"}`}
          >
            <RadioGroupItem id="brt-limited" value="limited_company" className="mt-1" />
            <div>
              <div className="flex items-center gap-2 font-medium">
                <Building2 className="h-4 w-4" aria-hidden /> Limited Company
              </div>
              <p className="text-xs text-muted-foreground">
                Registered under the Companies Act. We'll ask for your Certificate of Incorporation and current CR12.
              </p>
            </div>
          </label>
          <label
            htmlFor="brt-registered"
            className={`flex cursor-pointer items-start gap-3 rounded-lg border p-4 transition
              ${brt === "registered_business" ? "border-primary bg-primary/5" : "hover:border-primary/40"}`}
          >
            <RadioGroupItem id="brt-registered" value="registered_business" className="mt-1" />
            <div>
              <div className="flex items-center gap-2 font-medium">
                <FileCheck2 className="h-4 w-4" aria-hidden /> Registered Business
              </div>
              <p className="text-xs text-muted-foreground">
                Sole Proprietorship / Partnership / Business Name. We'll ask for your valid Single Business Permit.
              </p>
            </div>
          </label>
        </RadioGroup>

        {brt && (
          <Alert>
            <Info className="h-4 w-4" aria-hidden />
            <AlertTitle className="text-sm">
              {brt === "limited_company" ? "Documents required in Step 4" : "Document required in Step 4"}
            </AlertTitle>
            <AlertDescription className="text-xs">
              {brt === "limited_company"
                ? "Certificate of Incorporation and current CR12 (latest, from the Business Registration Service)."
                : "Valid, unexpired Single Business Permit from the relevant County Government — must show your registered business name."}
            </AlertDescription>
          </Alert>
        )}
      </section>

      {/* Rest of the form is only shown once a type is chosen. */}
      {brt && (
        <form onSubmit={onSubmit} className="space-y-8" noValidate>
          <section aria-labelledby="biz-details" className="space-y-4">
            <h3 id="biz-details" className="text-base font-medium">Business details</h3>
            <div className="grid gap-4 md:grid-cols-4">
              <Field className="md:col-span-2" label="Registered business name *" error={form.formState.errors.registered_name?.message}>
                <Input {...form.register("registered_name")} />
              </Field>
              <Field className="md:col-span-2" label="Trading name" error={form.formState.errors.trading_name?.message}>
                <Input {...form.register("trading_name")} />
              </Field>

              {brt === "limited_company" ? (
                <Field className="md:col-span-2" label="Certificate of Incorporation number *" error={form.formState.errors.certificate_of_incorporation_number?.message}>
                  <Input {...form.register("certificate_of_incorporation_number")} />
                </Field>
              ) : (
                <Field className="md:col-span-2" label="Business Registration number *" error={form.formState.errors.registration_number?.message}>
                  <Input {...form.register("registration_number")} />
                </Field>
              )}

              <Field label="KRA PIN *" error={form.formState.errors.kra_pin?.message}>
                <Input placeholder="e.g. A012345678B" {...form.register("kra_pin")} />
              </Field>
              <Field label="VAT number" error={form.formState.errors.vat_number?.message}>
                <Input {...form.register("vat_number")} />
              </Field>

              <Field label="Business type *" error={form.formState.errors.business_type?.message}>
                <Select value={form.watch("business_type") ?? ""} onValueChange={(v) => form.setValue("business_type", v, { shouldValidate: true })}>
                  <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
                  <SelectContent className="max-h-72">
                    {BUSINESS_TYPES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                  </SelectContent>
                </Select>
              </Field>
              <Field label="Industry *" error={form.formState.errors.industry?.message}>
                <Select value={form.watch("industry") ?? ""} onValueChange={(v) => form.setValue("industry", v, { shouldValidate: true })}>
                  <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
                  <SelectContent className="max-h-72">
                    {BUSINESS_INDUSTRIES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                  </SelectContent>
                </Select>
              </Field>
              <Field label="Category *" error={form.formState.errors.category?.message}>
                <Input placeholder="e.g. Corporate transport" {...form.register("category")} />
              </Field>

              <Field label="Employees" error={form.formState.errors.employees?.message}>
                <Input type="number" min={0} {...form.register("employees")} />
              </Field>
              <Field label="Expected monthly trips" error={form.formState.errors.monthly_trips?.message}>
                <Input type="number" min={0} {...form.register("monthly_trips")} />
              </Field>
              <Field label="Expected monthly budget (KES)" error={form.formState.errors.monthly_budget?.message}>
                <Input type="number" min={0} step="0.01" {...form.register("monthly_budget")} />
              </Field>
            </div>
          </section>

          <section aria-labelledby="biz-address" className="space-y-4">
            <h3 id="biz-address" className="text-base font-medium">Business address</h3>
            <div className="grid gap-4 md:grid-cols-4">
              <Field label="County *" error={form.formState.errors.county?.message}>
                <Select value={form.watch("county") ?? ""} onValueChange={(v) => form.setValue("county", v, { shouldValidate: true })}>
                  <SelectTrigger><SelectValue placeholder="Select county" /></SelectTrigger>
                  <SelectContent className="max-h-72">
                    {KENYA_COUNTIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                  </SelectContent>
                </Select>
              </Field>
              <Field label="Town *" error={form.formState.errors.town?.message}>
                <Input {...form.register("town")} />
              </Field>
              <Field className="md:col-span-2" label="Street / road" error={form.formState.errors.street?.message}>
                <Input {...form.register("street")} />
              </Field>
              <Field label="Building" error={form.formState.errors.building?.message}>
                <Input {...form.register("building")} />
              </Field>
              <Field label="Floor" error={form.formState.errors.floor?.message}>
                <Input {...form.register("floor")} />
              </Field>
              <Field label="Office" error={form.formState.errors.office?.message}>
                <Input {...form.register("office")} />
              </Field>
              <Field className="md:col-span-1" label="Postal address" error={form.formState.errors.postal_address?.message}>
                <Input {...form.register("postal_address")} />
              </Field>
            </div>
          </section>

          <div className="flex items-center justify-between border-t pt-4">
            <Button type="button" variant="ghost" onClick={() => nav("/corporate/register/personal")}>
              ← Back
            </Button>
            <Button type="submit" size="lg">Save &amp; continue → Verification</Button>
          </div>
        </form>
      )}
    </div>
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
