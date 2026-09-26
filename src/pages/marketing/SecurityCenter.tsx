import { useState } from "react";
import { Link } from "react-router-dom";
import { Shield, AlertTriangle, CheckCircle2, ArrowRight } from "lucide-react";
import { MarketingPage, PageHero } from "@/components/marketing/PageHero";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";

type Channel = "email" | "sms" | "whatsapp" | "phone_call" | "website" | "social_media" | "other";
type Artifact = "url" | "email_address" | "phone_number" | "sender_name" | "screenshot" | "other";

const OFFICIAL = {
  domains: ["yalla-africa.lovable.app", "yallaride.co.ke", "yallaride.com"],
  sms_sender: "SAFARID",
  support_email: "support@yalla.africa",
};

export default function SecurityCenter() {
  const [channel, setChannel] = useState<Channel>("sms");
  const [artifactType, setArtifactType] = useState<Artifact>("url");
  const [artifactValue, setArtifactValue] = useState("");
  const [reporterEmail, setReporterEmail] = useState("");
  const [description, setDescription] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submittedRef, setSubmittedRef] = useState<string | null>(null);

  const [verifyValue, setVerifyValue] = useState("");
  const [verifyResult, setVerifyResult] = useState<null | { ok: boolean; reason: string }>(null);

  async function submitReport() {
    if (artifactValue.trim().length < 2) {
      toast({ title: "Please enter what to report", variant: "destructive" });
      return;
    }
    setSubmitting(true);
    try {
      const { data, error } = await supabase.functions.invoke("phishing-report-intake", {
        body: {
          channel, artifact_type: artifactType, artifact_value: artifactValue.trim(),
          reporter_email: reporterEmail || undefined,
          description: description || undefined,
        },
      });
      if (error) throw error;
      setSubmittedRef((data as { report_number?: string })?.report_number ?? null);
      setArtifactValue(""); setDescription("");
      toast({ title: "Report received", description: "Our trust team will investigate within 24h." });
    } catch (e) {
      toast({ title: "Could not submit", description: (e as Error).message, variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  }

  function verify() {
    const v = verifyValue.trim().toLowerCase();
    if (!v) { setVerifyResult(null); return; }
    if (v.includes("@")) {
      const domain = v.split("@")[1] ?? "";
      const ok = OFFICIAL.domains.some((d) => domain === d || domain.endsWith("." + d));
      setVerifyResult({ ok, reason: ok ? "This email domain matches an official SAFARID domain." : "This domain is NOT one of our official domains. Treat the message as suspicious." });
      return;
    }
    if (/^https?:\/\//.test(v) || v.includes(".")) {
      const host = v.replace(/^https?:\/\//, "").split("/")[0];
      const ok = OFFICIAL.domains.some((d) => host === d || host.endsWith("." + d));
      setVerifyResult({ ok, reason: ok ? "Link belongs to an official SAFARID domain." : "This URL does NOT match any of our official domains. Do not enter credentials." });
      return;
    }
    if (/^\+?\d[\d\s-]{4,}$/.test(v)) {
      setVerifyResult({ ok: false, reason: "We never call or SMS asking for your password, PIN, or OTP. Hang up if anyone does." });
      return;
    }
    setVerifyResult({ ok: false, reason: "Could not classify. When in doubt, contact " + OFFICIAL.support_email + "." });
  }

  return (
    <MarketingPage>
      <PageHero eyebrow="Security Center" title="Stay safe on SAFARID" subtitle="Report phishing, verify suspicious messages, and learn how we protect your account.">
        <div className="flex flex-wrap gap-3">
          <Button asChild size="lg" className="bg-ice text-primary hover:bg-ice/90">
            <a href="#report"><Shield className="mr-2 h-4 w-4" />Report phishing</a>
          </Button>
          <Button asChild size="lg" variant="outline" className="border-ice/70 text-ice hover:bg-ice/20">
            <a href="#verify">Verify a message</a>
          </Button>
        </div>
      </PageHero>

      <section className="container mx-auto px-4 py-12 grid gap-6 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><CheckCircle2 className="h-5 w-5 text-status-success" />What we will never do</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm text-muted-foreground">
            <p>• Ask for your password, PIN, or OTP — by call, SMS, WhatsApp, or email.</p>
            <p>• Send you a link to "reactivate" your account outside our official domains.</p>
            <p>• Demand payment via personal M-Pesa numbers. Our paybill is fixed.</p>
            <p>• Threaten to suspend your account unless you click a link immediately.</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><Shield className="h-5 w-5 text-primary" />Official channels</CardTitle>
            <CardDescription>Only trust messages from these sources.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-1 text-sm">
            <p><strong>Domains:</strong> {OFFICIAL.domains.join(", ")}</p>
            <p><strong>SMS sender:</strong> {OFFICIAL.sms_sender}</p>
            <p><strong>Support email:</strong> {OFFICIAL.support_email}</p>
          </CardContent>
        </Card>
      </section>

      <section id="verify" className="container mx-auto px-4 py-12">
        <Card className="max-w-2xl mx-auto">
          <CardHeader>
            <CardTitle>Is this from SAFARID?</CardTitle>
            <CardDescription>Paste a link, email address, or phone number you received.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex gap-2">
              <Input value={verifyValue} onChange={(e) => setVerifyValue(e.target.value)} placeholder="https://... or user@example.com or +2547..." />
              <Button onClick={verify}>Check</Button>
            </div>
            {verifyResult && (
              <div className={`rounded-lg border p-3 text-sm flex gap-2 ${verifyResult.ok ? "border-status-success/40 bg-status-success/5 text-status-success" : "border-status-danger/40 bg-status-danger/5 text-status-danger"}`}>
                {verifyResult.ok ? <CheckCircle2 className="h-5 w-5 shrink-0 mt-0.5" /> : <AlertTriangle className="h-5 w-5 shrink-0 mt-0.5" />}
                <span>{verifyResult.reason}</span>
              </div>
            )}
          </CardContent>
        </Card>
      </section>

      <section id="report" className="container mx-auto px-4 py-12">
        <Card className="max-w-2xl mx-auto">
          <CardHeader>
            <CardTitle>Report a phishing attempt</CardTitle>
            <CardDescription>Tell us what you saw. Our trust team investigates every report and pursues takedowns.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-3 md:grid-cols-2">
              <div>
                <Label>Channel</Label>
                <Select value={channel} onValueChange={(v) => setChannel(v as Channel)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {(["email","sms","whatsapp","phone_call","website","social_media","other"] as Channel[]).map(c => (
                      <SelectItem key={c} value={c}>{c.replace("_"," ")}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Artifact type</Label>
                <Select value={artifactType} onValueChange={(v) => setArtifactType(v as Artifact)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {(["url","email_address","phone_number","sender_name","screenshot","other"] as Artifact[]).map(a => (
                      <SelectItem key={a} value={a}>{a.replace("_"," ")}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div>
              <Label>Suspicious link, address, or number</Label>
              <Input value={artifactValue} onChange={(e) => setArtifactValue(e.target.value)} placeholder="e.g. http://yalla-secure.fake.com" />
            </div>
            <div>
              <Label>Your email (optional, for follow-up)</Label>
              <Input value={reporterEmail} onChange={(e) => setReporterEmail(e.target.value)} type="email" placeholder="you@example.com" />
            </div>
            <div>
              <Label>What happened?</Label>
              <Textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={4} placeholder="Describe the message and how you received it." />
            </div>
            <Button onClick={submitReport} disabled={submitting} className="w-full">
              {submitting ? "Submitting…" : "Submit report"}
            </Button>
            {submittedRef && (
              <div className="rounded-lg border border-status-success/40 bg-status-success/5 p-3 text-sm text-status-success">
                Thank you. Your report reference is <strong>{submittedRef}</strong>. Save it for future correspondence.
              </div>
            )}
          </CardContent>
        </Card>
      </section>

      <section className="bg-primary text-primary-foreground py-16">
        <div className="container mx-auto px-4 text-center max-w-2xl">
          <h2 className="text-3xl font-bold mb-3">Protect your account</h2>
          <p className="opacity-90 mb-6">Enable two-factor authentication, review trusted devices, and check recent logins from your account settings.</p>
          <Button asChild size="lg" className="bg-ice text-primary hover:bg-ice/90">
            <Link to="/dashboard">Open account security <ArrowRight className="ml-2 h-4 w-4" /></Link>
          </Button>
        </div>
      </section>
    </MarketingPage>
  );
}
