import { useEffect, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { CheckCircle2, Loader2 } from "lucide-react";
import {
  CONTACT,
  CONTACT_FAILURE_MESSAGE,
  ENQUIRY_CATEGORIES,
  categoryTeam,
} from "@/config/contact";

const schema = z.object({
  name: z.string().trim().min(1, "Required").max(120),
  email: z.string().trim().email("Enter a valid email").max(255),
  company: z.string().trim().max(200).optional(),
  phone: z.string().trim().max(40).optional(),
  employee_count: z.string().trim().max(40).optional(),
  subject: z.string().trim().max(200).optional(),
  category: z.string().trim().max(40).optional(),
  message: z.string().trim().min(10, "Tell us a little more").max(4000),
});

type FormValues = z.infer<typeof schema>;

interface Props {
  type?: "contact" | "demo" | "sales" | "support" | "partner";
  sourcePage: string;
  showCompany?: boolean;
  showEmployeeCount?: boolean;
  /** Shows the enquiry-category selector. The server derives the destination inbox. */
  showCategory?: boolean;
  /** Preselected enquiry category (e.g. corporate pages default to corporate sales). */
  defaultCategory?: string;
  submitLabel?: string;
  heading?: string;
  subheading?: string;
  /** Fired on first meaningful keystroke — used for funnel analytics. */
  onStarted?: () => void;
  /** Fired once the lead is stored and routed by the contact-submission service. */
  onSubmitted?: (result: { submissionId?: string }) => void;
  /** Fired when the lead could not be stored. */
  onFailed?: (reason: string) => void;
}

const EMP = ["1-10", "11-50", "51-200", "201-1,000", "1,000+"];

const TEAM_LABEL: Record<"support" | "sales" | "hr", string> = {
  support: "Support team",
  sales: "Sales team",
  hr: "Recruitment team",
};

export function ContactForm({
  type = "contact",
  sourcePage,
  showCompany = false,
  showEmployeeCount = false,
  showCategory = false,
  defaultCategory,
  submitLabel = "Send message",
  heading,
  subheading,
  onStarted,
  onSubmitted,
  onFailed,
}: Props) {

  const [done, setDone] = useState(false);
  const startedRef = useRef(false);
  const notifyStarted = () => {
    if (startedRef.current) return;
    startedRef.current = true;
    onStarted?.();
  };
  const mountedAtRef = useRef<number>(Date.now());
  const honeypotRef = useRef<HTMLInputElement>(null);
  useEffect(() => { mountedAtRef.current = Date.now(); }, []);
  const {
    register,
    handleSubmit,
    setValue,
    watch,
    formState: { errors, isSubmitting },
    reset,
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      category:
        defaultCategory ??
        (type === "sales" || type === "demo" ? "corporate_sales" : type === "partner" ? "partnership" : type === "support" ? "customer_support" : "general"),
    },

  });

  const employeeCount = watch("employee_count");
  const category = watch("category") ?? "general";
  const team = categoryTeam(category);
  const [routedTeam, setRoutedTeam] = useState<"support" | "sales" | "hr">(team);

  const onSubmit = async (values: FormValues) => {
    const elapsed_ms = Date.now() - mountedAtRef.current;
    const website = honeypotRef.current?.value ?? "";
    const { data, error } = await supabase.functions.invoke("contact-submission", {
      body: { ...values, type, source_page: sourcePage, elapsed_ms, website },
    });
    if (error || (data && (data as { error?: string }).error)) {
      const code = (data as { error?: string } | null)?.error;
      if (code === "rate_limited") {
        toast({ title: "Too many submissions", description: "Please try again in a few minutes.", variant: "destructive" });
      } else {
        toast({ title: "Could not send", description: CONTACT_FAILURE_MESSAGE, variant: "destructive" });
      }
      onFailed?.(code ?? "submit_failed");
      return;
    }
    const serverTeam = (data as { routed_to?: "support" | "sales" | "hr" } | null)?.routed_to;
    setRoutedTeam(serverTeam ?? team);
    setDone(true);
    reset();
    startedRef.current = false;
    onSubmitted?.({ submissionId: (data as { id?: string } | null)?.id });
    toast({ title: "Message received", description: "Our team will be in touch shortly." });
  };

  if (done) {
    return (
      <div className="rounded-xl border border-border bg-card p-8 text-center">
        <CheckCircle2 className="h-10 w-10 text-primary mx-auto mb-3" aria-hidden="true" />
        <h3 className="text-xl font-semibold mb-1">Thanks — we've got it.</h3>
        <p className="text-muted-foreground text-sm">
          Your enquiry has been routed to the Yalla Mobility {TEAM_LABEL[routedTeam]}. We respond within one business day.
        </p>
        <p className="text-muted-foreground text-xs mt-2">
          Need us sooner? Call {CONTACT.phoneDisplay} or email {CONTACT.supportEmail}.
        </p>
        <Button variant="ghost" className="mt-4" onClick={() => setDone(false)}>
          Send another
        </Button>
      </div>
    );
  }


  return (
    <form onSubmit={handleSubmit(onSubmit)} onInput={notifyStarted} className="rounded-xl border border-border bg-card p-6 md:p-8 space-y-5">
      {/* Honeypot — visually hidden, autocomplete off; bots fill, humans don't */}
      <div aria-hidden="true" style={{ position: "absolute", left: "-10000px", width: 1, height: 1, overflow: "hidden" }}>
        <label htmlFor="website-hp">Website</label>
        <input id="website-hp" ref={honeypotRef} type="text" tabIndex={-1} autoComplete="off" />
      </div>
      {heading && (
        <div>
          <h3 className="text-xl font-semibold">{heading}</h3>
          {subheading && <p className="text-sm text-muted-foreground mt-1">{subheading}</p>}
        </div>
      )}

      <div className="grid md:grid-cols-2 gap-4">
        <div>
          <Label htmlFor="name">Full name</Label>
          <Input id="name" autoComplete="name" {...register("name")} aria-invalid={!!errors.name} />
          {errors.name && <p className="text-xs text-destructive mt-1">{errors.name.message}</p>}
        </div>
        <div>
          <Label htmlFor="email">Work email</Label>
          <Input id="email" type="email" autoComplete="email" {...register("email")} aria-invalid={!!errors.email} />
          {errors.email && <p className="text-xs text-destructive mt-1">{errors.email.message}</p>}
        </div>
      </div>

      {showCompany && (
        <div className="grid md:grid-cols-2 gap-4">
          <div>
            <Label htmlFor="company">Company</Label>
            <Input id="company" autoComplete="organization" {...register("company")} />
          </div>
          <div>
            <Label htmlFor="phone">Phone (optional)</Label>
            <Input id="phone" type="tel" autoComplete="tel" {...register("phone")} />
          </div>
        </div>
      )}

      {showCategory && (
        <div>
          <Label htmlFor="category">Enquiry category</Label>
          <Select value={category} onValueChange={(v) => { setValue("category", v); notifyStarted(); }}>
            <SelectTrigger id="category" aria-label="Enquiry category"><SelectValue placeholder="Select a category" /></SelectTrigger>
            <SelectContent>
              {ENQUIRY_CATEGORIES.map((c) => <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>)}
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground mt-1">
            Goes to our {TEAM_LABEL[team]}.
          </p>
        </div>
      )}

      {showEmployeeCount && (
        <div>
          <Label htmlFor="employee_count">Employees</Label>
          <Select value={employeeCount} onValueChange={(v) => { setValue("employee_count", v); notifyStarted(); }}>
            <SelectTrigger id="employee_count" aria-label="Number of employees"><SelectValue placeholder="Select size" /></SelectTrigger>
            <SelectContent>
              {EMP.map((e) => <SelectItem key={e} value={e}>{e}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      )}

      <div>
        <Label htmlFor="subject">Subject (optional)</Label>
        <Input id="subject" {...register("subject")} />
      </div>

      <div>
        <Label htmlFor="message">How can we help?</Label>
        <Textarea
          id="message"
          rows={5}
          {...register("message")}
          aria-invalid={!!errors.message}
          placeholder="Tell us about your use case, fleet size, region…"
        />
        {errors.message && <p className="text-xs text-destructive mt-1">{errors.message.message}</p>}
      </div>

      <Button type="submit" size="lg" disabled={isSubmitting} className="w-full md:w-auto">
        {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
        {submitLabel}
      </Button>
      <p className="text-xs text-muted-foreground">
        By submitting, you agree to our <a href="/legal/privacy" className="underline">Privacy Policy</a>. We respond within one business day.
      </p>
    </form>
  );
}
