import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { ShieldCheck, KeyRound, Loader2 } from "lucide-react";

interface SettingsStatus {
  environment: string;
  short_code: string | null;
  updated_at: string;
  consumer_key_set: boolean;
  consumer_secret_set: boolean;
  passkey_set: boolean;
  b2c_initiator_name_set: boolean;
  b2c_security_credential_set: boolean;
  etims_device_serial_set: boolean;
  b2c_short_code_set?: boolean;
  etims_api_key_set?: boolean;
  etims_base_url_set?: boolean;
  etims_webhook_secret_set?: boolean;
  etims_device_mode_set?: boolean;
}

const FIELDS = [
  { key: "short_code", label: "Short Code / PayBill", placeholder: "4573823", setFlag: null },
  { key: "consumer_key", label: "Consumer Key", placeholder: "Paste the new consumer key", setFlag: "consumer_key_set" },
  { key: "consumer_secret", label: "Consumer Secret", placeholder: "Paste the new consumer secret", setFlag: "consumer_secret_set" },
  { key: "passkey", label: "Passkey", placeholder: "Paste the new passkey", setFlag: "passkey_set" },
  { key: "b2c_initiator_name", label: "B2C Initiator Name (payouts)", placeholder: "From your Safaricom B2C account", setFlag: "b2c_initiator_name_set" },
  { key: "b2c_security_credential", label: "B2C Security Credential (payouts)", placeholder: "Encrypted credential from Safaricom", setFlag: "b2c_security_credential_set" },
  { key: "b2c_short_code", label: "B2C Payout Short Code", placeholder: "Your separate payouts short code (not PayBill 4573823)", setFlag: "b2c_short_code_set" },
  { key: "etims_device_serial", label: "eTIMS Device Serial (KRA)", placeholder: "From your KRA eTIMS registration", setFlag: "etims_device_serial_set" },
  { key: "etims_device_mode", label: "eTIMS Device Type (OSCU or VSCU)", placeholder: "OSCU", setFlag: "etims_device_mode_set" },
  { key: "etims_base_url", label: "eTIMS Connection Address", placeholder: "https://… (from KRA or your eTIMS provider)", setFlag: "etims_base_url_set" },
  { key: "etims_api_key", label: "eTIMS Access Key", placeholder: "From KRA or your eTIMS provider", setFlag: "etims_api_key_set" },
  { key: "etims_webhook_secret", label: "eTIMS Confirmation Secret", placeholder: "Shared secret for KRA confirmations", setFlag: "etims_webhook_secret_set" },
] as const;

export default function PaymentCredentials() {
  const [status, setStatus] = useState<SettingsStatus | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const callFunction = async (method: "GET" | "POST", body?: unknown) => {
    const { data: sessionData } = await supabase.auth.getSession();
    const token = sessionData.session?.access_token;
    if (!token) throw new Error("You must be signed in");
    const res = await supabase.functions.invoke("payment-credentials", {
      method,
      body: method === "POST" ? (body as Record<string, unknown>) : undefined,
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.error) throw new Error(res.error.message);
    return res.data;
  };

  const loadStatus = async () => {
    setLoading(true);
    try {
      const data = await callFunction("GET");
      const prod = (data.settings as SettingsStatus[]).find((s) => s.environment === "production") ?? null;
      setStatus(prod);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not load settings");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void loadStatus(); }, []);

  const save = async () => {
    const payload = Object.fromEntries(Object.entries(values).filter(([, v]) => v.trim() !== ""));
    if (Object.keys(payload).length === 0) {
      toast.error("Enter at least one credential to save");
      return;
    }
    setSaving(true);
    try {
      await callFunction("POST", { environment: "production", ...payload });
      toast.success("Credentials saved securely");
      setValues({});
      await loadStatus();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save credentials");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mx-auto max-w-2xl space-y-6 p-6">
      <div className="flex items-center gap-3">
        <ShieldCheck className="h-8 w-8 text-primary" />
        <div>
          <h1 className="text-2xl font-bold">Payment Credentials</h1>
          <p className="text-sm text-muted-foreground">
            M-Pesa (Safaricom Daraja) and KRA eTIMS credentials. Values are write-only — they are stored
            in the backend and never shown here again.
          </p>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <KeyRound className="h-5 w-5" /> Current status
          </CardTitle>
          <CardDescription>Production environment{status?.short_code ? ` · Short code ${status.short_code}` : ""}</CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex items-center gap-2 text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</div>
          ) : (
            <div className="flex flex-wrap gap-2">
              {FIELDS.filter((f) => f.setFlag).map((f) => (
                <Badge key={f.key} variant={status?.[f.setFlag as keyof SettingsStatus] ? "default" : "outline"}>
                  {f.label}: {status?.[f.setFlag as keyof SettingsStatus] ? "Set" : "Not set"}
                </Badge>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Enter new credentials</CardTitle>
          <CardDescription>
            Fill in only the fields you are changing. Leave the rest blank to keep the current values.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {FIELDS.map((f) => (
            <div key={f.key} className="space-y-1">
              <Label htmlFor={f.key}>{f.label}</Label>
              <Input
                id={f.key}
                type="password"
                autoComplete="off"
                placeholder={f.placeholder}
                value={values[f.key] ?? ""}
                onChange={(e) => setValues((prev) => ({ ...prev, [f.key]: e.target.value }))}
              />
            </div>
          ))}
          <Button onClick={save} disabled={saving} className="w-full">
            {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            Save credentials securely
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
