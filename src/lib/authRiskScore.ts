// Fire-and-forget client wiring for the auth-risk-score edge function.
// Called after every sign-in / sign-up attempt (success or failure).
// Never blocks the UI; failures are logged to console only.
import { supabase } from "@/integrations/supabase/client";

type EventType =
  | "login"
  | "login_failed"
  | "mfa_challenge"
  | "mfa_success"
  | "password_reset"
  | "signup";

interface ScoreInput {
  event_type: EventType;
  user_id?: string | null;
  method?: string; // 'password' | 'magic_link' | 'google' | 'apple' | ...
  email?: string;
}

const DEVICE_KEY = "yalla.auth.knownDevices";

async function sha256(input: string): Promise<string> {
  const buf = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", buf);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function readKnownDevices(): string[] {
  try {
    const raw = localStorage.getItem(DEVICE_KEY);
    return raw ? (JSON.parse(raw) as string[]) : [];
  } catch {
    return [];
  }
}

function rememberDevice(fingerprint: string) {
  try {
    const list = readKnownDevices();
    if (!list.includes(fingerprint)) {
      list.push(fingerprint);
      localStorage.setItem(DEVICE_KEY, JSON.stringify(list.slice(-10)));
    }
  } catch {
    /* storage disabled — accept lower fidelity */
  }
}

/**
 * Sends a login/signup risk-scoring event. Fire-and-forget: never awaits the
 * network round-trip on the sign-in critical path.
 */
export function scoreAuthEvent(input: ScoreInput): void {
  void (async () => {
    try {
      const ua = navigator.userAgent;
      const lang = navigator.language;
      const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
      const screenSig = `${screen.width}x${screen.height}x${screen.colorDepth}`;
      const fingerprint = await sha256([ua, lang, tz, screenSig].join("|"));

      const known = readKnownDevices();
      const isNewDevice = !known.includes(fingerprint);

      const payload = {
        user_id: input.user_id ?? null,
        event_type: input.event_type,
        method: input.method ?? "password",
        user_agent: ua,
        fingerprint_hash: fingerprint,
        signals: {
          new_device: isNewDevice,
          new_country: false,
          impossible_travel: false,
          tor_or_vpn: false,
          ip_on_blocklist: false,
          failed_attempts_1h: 0,
          password_reused_breached: false,
          velocity_logins_5m: 0,
        },
      };

      // The scorer only accepts internal jobs or a verified end-user token.
      // Without a session (e.g. a failed password attempt) there is nothing to
      // authenticate with, so skip the call instead of provoking a 401.
      const { data: sessionData } = await supabase.auth.getSession();
      if (!sessionData.session) return;

      const { error } = await supabase.functions.invoke("auth-risk-score", {
        body: payload,
      });
      if (error) {
        console.warn("[authRiskScore] invoke failed", error);
        return;
      }

      // Only remember the device once the scorer has ingested it and only for
      // successful logins — so a hijacker signing in doesn't get auto-trusted.
      if (input.event_type === "login" || input.event_type === "signup") {
        rememberDevice(fingerprint);
      }
    } catch (e) {
      console.warn("[authRiskScore] client error", e);
    }
  })();
}
