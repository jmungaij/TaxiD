import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { CheckCircle2, XCircle, Loader2 } from "lucide-react";

type State = "loading" | "valid" | "already" | "invalid" | "success" | "error";

export default function Unsubscribe() {
  const [params] = useSearchParams();
  const token = params.get("token");
  const [state, setState] = useState<State>("loading");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!token) { setState("invalid"); return; }
    const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/handle-email-unsubscribe?token=${encodeURIComponent(token)}`;
    fetch(url, { headers: { apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY } })
      .then((r) => r.json())
      .then((d) => {
        if (d.valid) setState("valid");
        else if (d.reason === "already_unsubscribed") setState("already");
        else setState("invalid");
      })
      .catch(() => setState("error"));
  }, [token]);

  const confirm = async () => {
    if (!token) return;
    setBusy(true);
    const { data, error } = await supabase.functions.invoke("handle-email-unsubscribe", { body: { token } });
    setBusy(false);
    if (error || !data?.success) setState("error");
    else setState("success");
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-primary/5 to-primary-glow/5 px-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>Email preferences</CardTitle>
          <CardDescription>Manage notifications from SAFARID Africa</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4 text-sm">
          {state === "loading" && <div className="flex items-center gap-2 text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />Checking your link…</div>}
          {state === "valid" && (
            <>
              <p>Click below to unsubscribe this address from SAFARID Africa emails. You'll still receive essential account and trip notifications.</p>
              <Button onClick={confirm} disabled={busy} className="w-full">{busy ? "Processing…" : "Confirm unsubscribe"}</Button>
            </>
          )}
          {state === "already" && <div className="flex items-center gap-2 text-muted-foreground"><CheckCircle2 className="h-5 w-5 text-status-success" />You're already unsubscribed.</div>}
          {state === "success" && <div className="flex items-center gap-2 text-status-success"><CheckCircle2 className="h-5 w-5" />You've been unsubscribed. Sorry to see you go.</div>}
          {state === "invalid" && <div className="flex items-center gap-2 text-destructive"><XCircle className="h-5 w-5" />This link is invalid or has expired.</div>}
          {state === "error" && <div className="flex items-center gap-2 text-destructive"><XCircle className="h-5 w-5" />Something went wrong. Please try again later.</div>}
        </CardContent>
      </Card>
    </div>
  );
}
