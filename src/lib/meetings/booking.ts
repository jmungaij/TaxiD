import { supabase } from "@/integrations/supabase/client";

export type PublicHost = { id: string; name: string; role: string | null; verified?: boolean };
export type PublicType = { id: string; slug: string; name: string; description: string | null; department: string | null; duration_minutes: number; hosts: PublicHost[] };

export const BOOKING_ERRORS: Record<string, string> = {
  SLOT_TAKEN: "That time was just taken. Please pick another.",
  DAILY_LIMIT: "You have reached today's booking limit. Please email sales@safarid.org.",
  USE_STAFF_CALENDAR: "SAFARID staff should book from the staff Meetings page.",
  CALENDAR_UNAVAILABLE: "Our calendar is unavailable right now. Please try again shortly.",
  NOT_FOUND: "This booking link is not valid.",
  NOT_ACTIVE: "This meeting is no longer active.",
  ALREADY_STARTED: "This meeting has already started.",
  NOT_STAFF: "Only staff can book on behalf of a client.",
  validation_failed: "Please check the details and try again.",
};

export async function bookingCall<T = any>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke("book-a-meeting", { body });
  if (error) {
    let code = "SERVER_ERROR";
    try { code = (await (error as { context: Response }).context.json()).error ?? code; } catch { /* ignore */ }
    throw new Error(code);
  }
  return data as T;
}

export const errText = (e: unknown, fallback = "Something went wrong. Please try again.") =>
  BOOKING_ERRORS[(e as Error)?.message] ?? fallback;

export const nairobiDate = (d: Date) => new Date(d.getTime() + 3 * 3600_000).toISOString().slice(0, 10);
export const timeLabel = (iso: string) =>
  new Date(iso).toLocaleTimeString("en-KE", { hour: "2-digit", minute: "2-digit", timeZone: "Africa/Nairobi" });
export const dateTimeLabel = (iso: string) =>
  new Date(iso).toLocaleString("en-KE", { dateStyle: "full", timeStyle: "short", timeZone: "Africa/Nairobi" });

export function nextDays(n = 21): string[] {
  const out: string[] = [];
  for (let i = 0; i < n; i++) out.push(nairobiDate(new Date(Date.now() + i * 86400_000)));
  return out;
}
