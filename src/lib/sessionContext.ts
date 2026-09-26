// Lightweight client-side session fingerprint used for forensic audit rows.
// Not a security boundary — used to enrich admin_login_events / access_denials.

export function getDeviceId(): string {
  if (typeof window === "undefined") return "ssr";
  const k = "yalla.deviceId";
  let id = window.localStorage.getItem(k);
  if (!id) {
    id = (crypto.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`);
    window.localStorage.setItem(k, id);
  }
  return id;
}

export function parseUserAgent(ua: string): { browser: string; os: string } {
  let browser = "unknown";
  let os = "unknown";
  if (/Edg\//.test(ua)) browser = "Edge";
  else if (/Chrome\//.test(ua)) browser = "Chrome";
  else if (/Safari\//.test(ua)) browser = "Safari";
  else if (/Firefox\//.test(ua)) browser = "Firefox";

  if (/Windows/.test(ua)) os = "Windows";
  else if (/Mac OS X/.test(ua)) os = "macOS";
  else if (/Android/.test(ua)) os = "Android";
  else if (/iPhone|iPad|iOS/.test(ua)) os = "iOS";
  else if (/Linux/.test(ua)) os = "Linux";
  return { browser, os };
}

export function getSessionContext() {
  const ua = typeof navigator !== "undefined" ? navigator.userAgent : "";
  return { device_id: getDeviceId(), user_agent: ua, ...parseUserAgent(ua) };
}
