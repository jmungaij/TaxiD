/**
 * LEAD CONTACT REPLY — the public page behind the contact link in an outreach
 * message. The random token in the link is the credential: it resolves exactly
 * one lead and lets that contact reply. No lead can be enumerated from here.
 */
import * as React from "react";
import { useSearchParams } from "react-router-dom";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { CONTACT } from "@/config/contact";
import { contactLinkReply, contactLinkView } from "@/lib/sales/leadDesk";
import ClientRequestPortal from "@/components/sales/ClientRequestPortal";
import BrandLogo from "@/components/brand/BrandLogo";

type Intent = "REPLIED" | "INTERESTED" | "NOT_INTERESTED" | "INFORMATION";

const INTENTS: { id: Intent; label: string }[] = [
  { id: "INTERESTED", label: "We are interested — get in touch" },
  { id: "INFORMATION", label: "Send me more information" },
  { id: "REPLIED", label: "Replying with a question" },
  { id: "NOT_INTERESTED", label: "Not interested at the moment" },
];

export default function LeadContactReply() {
  const [params] = useSearchParams();
  const token = params.get("token") ?? "";
  const [intent, setIntent] = React.useState<Intent>("INTERESTED");
  const [body, setBody] = React.useState("");
  const [senderName, setSenderName] = React.useState("");
  const [sent, setSent] = React.useState(false);

  React.useEffect(() => {
    document.title = "Your SAFARID portal | SAFARID";
  }, []);

  const view = useQuery({
    queryKey: ["lead-contact-view", token],
    queryFn: () => contactLinkView(token),
    enabled: Boolean(token),
  });

  const reply = useMutation({
    mutationFn: () =>
      contactLinkReply({ token, body: body.trim(), sender_name: senderName.trim() || undefined, intent }),
    onSuccess: (res) => {
      if (res.ok) setSent(true);
    },
  });

  const shell = (children: React.ReactNode) => (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col justify-center px-4 py-12">
      <div className="mb-6">
        <BrandLogo />
      </div>
      {children}
      <p className="mt-6 text-xs text-muted-foreground">
        SAFARID · {CONTACT.salesEmail} · {CONTACT.phoneDisplay}
      </p>
    </main>
  );

  if (!token)
    return shell(
      <Card>
        <CardContent className="pt-6 text-sm">
          This link is incomplete. Please use the link exactly as it appears in our message, or write
          to {CONTACT.salesEmail}.
        </CardContent>
      </Card>,
    );

  if (view.isLoading) return shell(<Skeleton className="h-56 w-full" />);

  if (view.error || !view.data?.ok)
    return shell(
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">This link is no longer valid</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          Please reply to the email you received, or write to {CONTACT.salesEmail} and we will pick it
          up.
        </CardContent>
      </Card>,
    );

  const lead = view.data;
  const thread = lead.thread ?? [];
  const fmt = (iso: string) =>
    new Date(iso).toLocaleString("en-KE", {
      dateStyle: "medium",
      timeStyle: "short",
      timeZone: "Africa/Nairobi",
    });

  const statusLine =
    lead.contact_state === "REPLIED"
      ? "Your reply is with the specialist looking after your account. They will come back to you."
      : lead.contact_state === "NOT_INTERESTED"
        ? "We have recorded that this is not for you now. You can still write to us here at any time."
        : lead.contact_state === "CONTACTED"
          ? "We have written to you and are waiting to hear back."
          : "We have not spoken yet.";

  const conversation = thread.length > 0 && (
    <Card className="mt-4">
      <CardHeader>
        <CardTitle className="text-base">Your conversation with us</CardTitle>
        <CardDescription>Reference {lead.lead_ref}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {thread.map((m) => (
          <div
            key={`${m.created_at}-${m.direction}`}
            className={
              m.direction === "INBOUND"
                ? "rounded-md border border-primary/30 bg-primary/5 p-3"
                : "rounded-md border bg-muted/30 p-3"
            }
          >
            <p className="text-xs text-muted-foreground">
              {m.author} · {fmt(m.created_at)}
            </p>
            {m.subject && <p className="mt-1 text-sm font-medium">{m.subject}</p>}
            <p className="mt-1 whitespace-pre-line text-sm">{m.body}</p>
          </div>
        ))}
      </CardContent>
    </Card>
  );

  const requestPortal = (
    <ClientRequestPortal
      token={token}
      organisation={lead.organisation_name}
      contactName={lead.contact_name}
      requests={lead.requests ?? []}
      onSubmitted={() => void view.refetch()}
    />
  );

  if (sent)
    return shell(
      <>
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Thank you — your reply is with us</CardTitle>
            <CardDescription>
              Reference {lead.lead_ref}. The specialist who wrote to you now sees your message and
              will come back to you. You can return to this link at any time to add to the
              conversation.
            </CardDescription>
          </CardHeader>
        </Card>
        {conversation}
        <Button className="mt-4 self-start" variant="outline" onClick={() => { setSent(false); setBody(""); void view.refetch(); }}>
          Write another message
        </Button>
        {requestPortal}
      </>,
    );

  return shell(
    <>
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">Your SAFARID portal</CardTitle>
        <CardDescription>
          {lead.organisation_name}
          {lead.service_interest ? ` · ${lead.service_interest}` : ""}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="rounded-md border bg-muted/40 p-3 text-sm">
          <p className="font-medium">Where things stand</p>
          <p className="text-muted-foreground">{statusLine}</p>
        </div>

        {lead.information_request && (
          <div className="rounded-md border bg-muted/40 p-3 text-sm">
            <p className="font-medium">We asked you for:</p>
            <p className="text-muted-foreground">{lead.information_request}</p>
          </div>
        )}


        <div className="space-y-2">
          <Label>How would you like to respond?</Label>
          <div className="flex flex-wrap gap-1.5">
            {INTENTS.map((i) => (
              <Button
                key={i.id}
                type="button"
                size="sm"
                variant={intent === i.id ? "secondary" : "outline"}
                onClick={() => setIntent(i.id)}
              >
                {i.label}
              </Button>
            ))}
          </div>
        </div>

        <div>
          <Label htmlFor="name">Your name</Label>
          <Input
            id="name"
            placeholder={lead.contact_name ?? ""}
            value={senderName}
            onChange={(e) => setSenderName(e.target.value)}
          />
        </div>

        <div>
          <Label htmlFor="msg">Your message</Label>
          <Textarea
            id="msg"
            rows={6}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="Tell us what you need, or ask us anything."
          />
        </div>

        {reply.error && (
          <p className="text-sm text-destructive">
            Your reply was not sent. Please try again, or write to {CONTACT.salesEmail}.
          </p>
        )}
        {reply.data && !reply.data.ok && (
          <p className="text-sm text-destructive">Please write a short message before sending.</p>
        )}

        <Button disabled={body.trim().length < 3 || reply.isPending} onClick={() => reply.mutate()}>
          Send reply
        </Button>
      </CardContent>
    </Card>
    {conversation}
    {requestPortal}
    </>,
  );
}
