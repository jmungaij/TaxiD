import { useEffect, useState } from "react";
import { Loader2, Send } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

/** Pulls the "Message to rider" section out of the AI draft, falling back to the full text. */
export function extractRiderMessage(draft: string): string {
  const m = draft.match(/message to (the )?rider[^\n]*\n([\s\S]*)$/i);
  return (m ? m[2] : draft).replace(/^[#*\s:]+/, "").trim();
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function SendToRiderInbox({ draft, category }: { draft: string; category: string }) {
  const [email, setEmail] = useState("");
  const [subject, setSubject] = useState("Update on your TaxiD support request");
  const [body, setBody] = useState(() => extractRiderMessage(draft));
  const [busy, setBusy] = useState(false);

  useEffect(() => { setBody(extractRiderMessage(draft)); }, [draft]);

  async function send() {
    if (!EMAIL.test(email.trim())) { toast.error("Enter the rider's account email."); return; }
    if (!body.trim()) { toast.error("The message is empty."); return; }
    setBusy(true);
    const { data: u } = await supabase.auth.getUser();
    const { data: thread, error } = await supabase.from("support_threads")
      .insert({ rider_email: email.trim().toLowerCase(), subject: subject.trim() || "Support update", category })
      .select("id").single();
    if (!error && thread) {
      const { error: msgErr } = await supabase.from("support_messages")
        .insert({ thread_id: thread.id, sender_role: "staff", body: body.trim(), sender_id: u.user?.id });
      setBusy(false);
      if (msgErr) { toast.error("Conversation created, but the message failed to send."); return; }
      toast.success("Sent to the rider's in-app inbox");
      return;
    }
    setBusy(false);
    toast.error("Couldn't send. Only admins and support staff can message riders.");
  }

  return (
    <div className="mt-4 space-y-2 border-t pt-4">
      <span className="text-sm font-medium">Send to rider's inbox</span>
      <div className="space-y-1">
        <Label htmlFor="str-email">Rider account email</Label>
        <Input id="str-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
      </div>
      <div className="space-y-1">
        <Label htmlFor="str-subject">Subject</Label>
        <Input id="str-subject" value={subject} onChange={(e) => setSubject(e.target.value)} maxLength={200} />
      </div>
      <div className="space-y-1">
        <Label htmlFor="str-body">Message (edit before sending)</Label>
        <Textarea id="str-body" rows={6} value={body} onChange={(e) => setBody(e.target.value)} maxLength={8000} />
      </div>
      <Button size="sm" className="gap-2" onClick={() => void send()} disabled={busy}>
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />} Send to rider
      </Button>
    </div>
  );
}
