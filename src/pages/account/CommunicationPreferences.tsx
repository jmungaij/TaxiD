/**
 * Communication preferences — recipient-facing control over optional email.
 *
 * Riders, drivers, corporate users and staff all use this surface. Security and
 * booking/receipt mail is mandatory (shown locked); every other category is a
 * per-address opt-in switch persisted through a server-side RPC scoped to the
 * signed-in user's own email.
 */
import { useCallback, useEffect, useState } from "react";
import { Helmet } from "react-helmet-async";
import { toast } from "sonner";
import { Lock, Mail, ShieldCheck } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import {
  CATEGORY_CATALOGUE,
  fetchMyPreferences,
  setMyPreference,
  type OptionalCategory,
  type PreferenceMap,
} from "@/lib/comms/preferences";

export default function CommunicationPreferences() {
  const [email, setEmail] = useState<string | null>(null);
  const [prefs, setPrefs] = useState<PreferenceMap | null>(null);
  const [saving, setSaving] = useState<string | null>(null);

  const load = useCallback(async () => {
    const { data } = await supabase.auth.getUser();
    const address = data?.user?.email ?? null;
    setEmail(address);
    if (!address) {
      setPrefs({});
      return;
    }
    try {
      setPrefs(await fetchMyPreferences(address));
    } catch (err) {
      console.error("Failed to load communication preferences", err);
      toast.error("Could not load your preferences.");
      setPrefs({});
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const toggle = async (category: OptionalCategory, next: boolean) => {
    setSaving(category);
    const previous = prefs?.[category] ?? true;
    setPrefs((p) => ({ ...(p ?? {}), [category]: next }));
    try {
      await setMyPreference(category, next);
      toast.success(next ? "You will receive these emails." : "You have opted out of these emails.");
    } catch (err) {
      setPrefs((p) => ({ ...(p ?? {}), [category]: previous }));
      toast.error(err instanceof Error ? err.message : "Could not save your preference.");
    } finally {
      setSaving(null);
    }
  };

  return (
    <main className="container mx-auto max-w-3xl space-y-6 px-4 py-10">
      <Helmet>
        <title>Email preferences | TaxiD</title>
        <meta
          name="description"
          content="Choose which optional TaxiD emails you receive. Security and booking receipts always remain on."
        />
        <link rel="canonical" href="https://taxid.us/account/communication-preferences" />
      </Helmet>

      <header className="space-y-2">
        <div className="flex items-center gap-2">
          <Mail className="h-5 w-5 text-primary" aria-hidden="true" />
          <h1 className="text-2xl font-bold">Email preferences</h1>
        </div>
        <p className="text-sm text-muted-foreground">
          {email
            ? `Preferences for ${email}. Changes apply immediately to every TaxiD service.`
            : "Sign in to manage which optional emails you receive."}
        </p>
      </header>

      {prefs === null ? (
        <div className="space-y-3">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-20 w-full" />
          ))}
        </div>
      ) : (
        <div className="space-y-4">
          {CATEGORY_CATALOGUE.map((cat) => (
            <Card key={cat.key}>
              <CardHeader className="flex flex-row items-start justify-between gap-4 space-y-0">
                <div className="space-y-1">
                  <CardTitle className="flex items-center gap-2 text-base">
                    {cat.label}
                    {cat.mandatory && (
                      <Badge variant="secondary" className="gap-1">
                        <Lock className="h-3 w-3" aria-hidden="true" /> Always on
                      </Badge>
                    )}
                  </CardTitle>
                  <CardDescription>{cat.description}</CardDescription>
                </div>
                <Switch
                  checked={cat.mandatory ? true : (prefs[cat.key] ?? true)}
                  disabled={cat.mandatory || !email || saving === cat.key}
                  aria-label={`${cat.label} emails`}
                  onCheckedChange={(next) => void toggle(cat.key as OptionalCategory, next)}
                />
              </CardHeader>
            </Card>
          ))}
        </div>
      )}

      <Card>
        <CardContent className="flex items-start gap-3 py-5 text-sm text-muted-foreground">
          <ShieldCheck className="mt-0.5 h-4 w-4 text-primary" aria-hidden="true" />
          <p>
            Security alerts and transaction receipts are required for your account and cannot be
            switched off. Bounced or complained addresses are suppressed automatically.
          </p>
        </CardContent>
      </Card>
    </main>
  );
}
