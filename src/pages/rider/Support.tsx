import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { LifeBuoy, ShieldAlert, Send, Loader2, Phone, Mail, MessageCircle } from "lucide-react";
import { RiderShell } from "@/components/rider/RiderShell";
import { SupportThreadView } from "@/components/support/SupportThreadView";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { CONTACT, PHONE_TEL, SUPPORT_MAILTO, WHATSAPP_LINK } from "@/config/contact";

const categories = [
  { value: "trip", label: "Trip or driver" },
  { value: "fare", label: "Fare or refund" },
  { value: "payment", label: "Wallet or payment" },
  { value: "lost_item", label: "Lost item" },
  { value: "booking", label: "Booking" },
  { value: "account", label: "Account" },
  { value: "safety", label: "Safety incident (not an emergency)" },
  { value: "other", label: "Something else" },
] as const;

interface Case { id: string; subject: string; category: string; status: string; updated_at: string; }

export default function RiderSupportPage() {
  const { user } = useAuth();
  const [cases, setCases] = useState<Case[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [category, setCategory] = useState("");
  const [subject, setSubject] = useState("");
  const [reference, setReference] = useState("");
  const [description, setDescription] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    if (!user) return;
    const { data, error: queryError } = await supabase.from("support_threads")
      .select("id,subject,category,status,updated_at")
      .eq("rider_user_id", user.id).order("updated_at", { ascending: false });
    if (queryError) setError("Your reports could not be loaded. Please try again.");
    else { setCases((data ?? []) as Case[]); setError(""); }
    setLoading(false);
  }, [user]);

  useEffect(() => { void load(); }, [load]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!user?.email || !category || subject.trim().length < 4 || description.trim().length < 10) {
      setError("Choose a topic, add a title of at least 4 characters, and describe the issue in at least 10 characters.");
      return;
    }
    setBusy(true); setError("");
    const { data: thread, error: createError } = await supabase.from("support_threads").insert({
      rider_user_id: user.id, rider_email: user.email.toLowerCase(), created_by: user.id,
      subject: subject.trim().slice(0, 200), category, status: "open",
    }).select("id").single();
    if (createError || !thread) {
      setError("Your report could not be sent. Please try again."); setBusy(false); return;
    }
    const body = [reference.trim() ? `Reference: ${reference.trim().slice(0, 80)}` : "", description.trim()].filter(Boolean).join("\n\n");
    const { error: messageError } = await supabase.from("support_messages").insert({
      thread_id: thread.id, sender_id: user.id, sender_role: "rider", body: body.slice(0, 5000),
    });
    if (messageError) {
      setError("Your report was opened, but the details were not sent. Open it below and send your message again.");
    } else {
      setCategory(""); setSubject(""); setReference(""); setDescription("");
    }
    setSelected(thread.id); setBusy(false); void load();
  }

  const current = cases.find((item) => item.id === selected);

  return <RiderShell><div className="space-y-6">
    <div><h1 className="flex items-center gap-2 text-2xl font-semibold"><LifeBuoy className="h-6 w-6 text-primary" /> Rider support</h1>
      <p className="text-sm text-muted-foreground">Get help with your trips, payments, bookings and account.</p></div>
    <div className="flex flex-wrap items-center justify-between gap-3 border-l-4 border-destructive bg-destructive/5 p-4">
      <p className="flex items-center gap-2 text-sm"><ShieldAlert className="h-5 w-5 shrink-0 text-destructive" /> In immediate danger? Call 999 or 112 first.</p>
      <Button asChild size="sm" variant="destructive"><a href="tel:999">Call 999</a></Button>
    </div>
    <div className="grid gap-3 sm:grid-cols-3">
      <a href={PHONE_TEL} className="flex items-center gap-2 border p-3 text-sm hover:bg-muted"><Phone className="h-4 w-4 text-primary" /> {CONTACT.phoneDisplay}</a>
      <a href={SUPPORT_MAILTO} className="flex items-center gap-2 border p-3 text-sm hover:bg-muted"><Mail className="h-4 w-4 text-primary" /> {CONTACT.supportEmail}</a>
      <a href={WHATSAPP_LINK} target="_blank" rel="noreferrer" className="flex items-center gap-2 border p-3 text-sm hover:bg-muted"><MessageCircle className="h-4 w-4 text-primary" /> WhatsApp support</a>
    </div>
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
      <section><h2 className="mb-3 font-semibold">Report a problem</h2>
        <form onSubmit={submit} className="space-y-4 border p-4">
          <div className="space-y-1"><Label htmlFor="case-category">Topic</Label><Select value={category} onValueChange={setCategory}><SelectTrigger id="case-category"><SelectValue placeholder="Choose a topic" /></SelectTrigger><SelectContent>{categories.map((item) => <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>)}</SelectContent></Select></div>
          <div className="space-y-1"><Label htmlFor="case-subject">Short title</Label><Input id="case-subject" value={subject} maxLength={200} onChange={(event) => setSubject(event.target.value)} required /></div>
          <div className="space-y-1"><Label htmlFor="case-reference">Trip or payment reference (optional)</Label><Input id="case-reference" value={reference} maxLength={80} onChange={(event) => setReference(event.target.value)} /></div>
          <div className="space-y-1"><Label htmlFor="case-description">What happened?</Label><Textarea id="case-description" value={description} maxLength={4000} rows={5} onChange={(event) => setDescription(event.target.value)} required /></div>
          <Button type="submit" disabled={busy}>{busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Send className="mr-2 h-4 w-4" />} Send report</Button>
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        </form>
      </section>
      <section><div className="mb-3 flex items-center justify-between"><h2 className="font-semibold">My reports</h2><Button asChild variant="link" size="sm"><Link to="/rider/inbox">Support inbox</Link></Button></div>
        {loading ? <p className="text-sm text-muted-foreground">Loading reports…</p> : cases.length === 0 ? <p className="border p-5 text-sm text-muted-foreground">You have no reports yet.</p> : <div className="space-y-2">
          {cases.map((item) => <Card key={item.id} className="overflow-hidden">
            <Button variant="ghost" onClick={() => setSelected(selected === item.id ? null : item.id)} className="h-auto w-full justify-between gap-2 whitespace-normal p-4 text-left">
              <span className="min-w-0"><span className="block font-medium">{item.subject}</span><span className="block text-xs text-muted-foreground">{categories.find((c) => c.value === item.category)?.label ?? item.category} · {new Date(item.updated_at).toLocaleDateString("en-KE")}</span></span>
              <Badge variant={item.status === "open" ? "default" : "secondary"}>{item.status}</Badge>
            </Button>
            {current?.id === item.id && <div className="border-t p-4"><SupportThreadView key={item.id} threadId={item.id} viewer="rider" canReply={item.status === "open"} /></div>}
          </Card>)}
        </div>}
      </section>
    </div>
  </div></RiderShell>;
}