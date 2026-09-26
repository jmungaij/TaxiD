import { useEffect, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Save } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import RestrictedMarkdown from "@/components/marketing/RestrictedMarkdown";

const MAX = 4000;

/**
 * Settings → Branding → Onboarding message.
 *
 * Saves through `set_onboarding_message`, which enforces administrator-only
 * write access and records the change in the audit trail. The preview uses the
 * same restricted Markdown renderer as the public page, so what an admin sees
 * here is exactly what visitors get — with unsafe markup already stripped.
 */
export function OnboardingMessageCard() {
  const [value, setValue] = useState("");
  const [baseline, setBaseline] = useState("");
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase
      .from("platform_settings")
      .select("onboarding_welcome_message")
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle()
      .then(({ data }) => {
        const v = data?.onboarding_welcome_message ?? "";
        setValue(v);
        setBaseline(v);
        setLoading(false);
      });
  }, []);

  const save = async () => {
    setSaving(true);
    const { data, error } = await supabase.rpc("set_onboarding_message", { _message: value });
    setSaving(false);
    const env = (data ?? {}) as { ok?: boolean; message?: string };
    if (error || env.ok === false) {
      toast({ title: "Save failed", description: env.message ?? error?.message, variant: "destructive" });
      return;
    }
    setBaseline(value);
    toast({ title: value.trim() ? "Onboarding message published" : "Onboarding message cleared" });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Onboarding message</CardTitle>
        <CardDescription>
          Shown on the public onboarding page. Restricted Markdown only — paragraphs, <strong>bold</strong>,{" "}
          <em>italic</em>, lists and http(s) links. Leave empty to restore the default experience. No redeployment needed.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4 md:grid-cols-2">
        <div>
          <Label htmlFor="onboarding-message">Message</Label>
          <Textarea
            id="onboarding-message"
            rows={10}
            maxLength={MAX}
            disabled={loading}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder={"Welcome to **SAFARID**.\n\n- Upload your documents\n- [Read the guide](https://yalla.africa/docs)"}
          />
          <div className="mt-1 flex items-center justify-between text-xs text-muted-foreground">
            <span>{value.length} / {MAX}</span>
            {value !== baseline && <span className="text-status-warning">Unsaved changes</span>}
          </div>
        </div>
        <div>
          <Label>Preview</Label>
          <div className="mt-1.5 min-h-[10rem] rounded-md border border-border bg-muted/20 p-3">
            {value.trim() ? (
              <RestrictedMarkdown source={value} />
            ) : (
              <p className="text-sm text-muted-foreground">Empty — the existing onboarding experience is shown.</p>
            )}
          </div>
        </div>
        <div className="md:col-span-2">
          <Button onClick={save} disabled={saving || loading || value === baseline}>
            <Save className="mr-2 h-4 w-4" />
            {saving ? "Saving…" : "Save onboarding message"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

export default OnboardingMessageCard;
