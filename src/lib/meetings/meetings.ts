/**
 * MEETINGS (client side)
 * ----------------------
 * One path for every TaxiD meeting — interviews, internal reviews, client and
 * partner meetings. For a Google Meet meeting nobody types a joining link: the
 * server mints it through the Google Calendar connector and emails an
 * iCalendar invitation, so Google Calendar, Outlook and Teams users all receive
 * a proper Yes / No / Maybe invitation.
 */
import { supabase } from "@/integrations/supabase/client";

export type MeetingPlatform = "google_meet" | "microsoft_teams" | "other_link" | "phone" | "in_person";
export type MeetingKind = "interview" | "internal" | "client" | "partner" | "other";

export const PLATFORM_LABELS: Record<MeetingPlatform, string> = {
  google_meet: "Google Meet (link created for you)",
  microsoft_teams: "Microsoft Teams (paste the link)",
  other_link: "Another platform (paste the link)",
  phone: "Telephone",
  in_person: "In person",
};

export const KIND_LABELS: Record<MeetingKind, string> = {
  interview: "Interview",
  internal: "Colleagues / internal",
  client: "Client meeting",
  partner: "Partner meeting",
  other: "Other",
};

export interface MeetingAttendee {
  email: string;
  name?: string | null;
  optional?: boolean;
}

export interface ScheduleMeetingInput {
  title: string;
  purpose?: string | null;
  meeting_kind: MeetingKind;
  platform: MeetingPlatform;
  starts_at: string;
  duration_minutes: number;
  timezone?: string;
  attendees: MeetingAttendee[];
  join_url?: string | null;
  account_id?: string | null;
  interview_id?: string | null;
  /** Create the joining link only — the invitation email is sent elsewhere. */
  mint_only?: boolean;
}

export interface ScheduledMeeting {
  ok: boolean;
  meeting_id: string;
  join_url: string | null;
  platform: MeetingPlatform;
  /** Google Calendar event id — present whenever the event was created. */
  external_event_id: string | null;
  /** Link to the event in Google Calendar, when Google returned one. */
  calendar_event_url?: string | null;
  /** Why the calendar event could not be created, when that happened. */
  calendar_note?: string | null;
  attendees: string[];
  /** True only when a real Google Calendar event exists for this meeting. */
  calendar_attached: boolean;
}

export interface MeetingRow {
  id: string;
  title: string;
  purpose: string | null;
  meeting_kind: string;
  platform: string;
  starts_at: string;
  duration_minutes: number;
  timezone: string;
  organiser_email: string;
  attendees: MeetingAttendee[];
  join_url: string | null;
  status: string;
  invite_sent_at: string | null;
  failure_reason: string | null;
}

/** Plain-language refusals, so nobody is left with a raw code. */
export const MEETING_REFUSALS: Record<string, string> = {
  NOT_AUTHORISED: "Only staff can send meeting invitations.",
  TITLE_REQUIRED: "Give the meeting a title.",
  START_TIME_REQUIRED: "Pick the date and time.",
  ATTENDEE_REQUIRED: "Add at least one person to invite.",
  ATTENDEE_EMAIL_INVALID: "One of the email addresses is not valid.",
  JOIN_LINK_REQUIRED: "Paste the joining link for that platform, or choose Google Meet and we create one.",
  CALENDAR_NOT_CONFIGURED: "Google Calendar is not connected, so a Meet link cannot be created.",
  CONFERENCE_NOT_CREATED: "Google did not return a Meet link. Nothing was sent.",
  MEET_LINK_NOT_CREATED: "The Google Meet link could not be created, so no invitation went out.",
  EMAIL_PROVIDER_NOT_CONFIGURED: "The email provider is not configured, so nothing can be sent.",
  INVITATION_NOT_DELIVERED: "The email provider refused the invitation. Nothing was delivered.",
};

export function meetingRefusal(message: string): string {
  const hit = Object.keys(MEETING_REFUSALS).find((k) => message.includes(k));
  return hit ? MEETING_REFUSALS[hit] : message;
}

export async function scheduleMeeting(input: ScheduleMeetingInput): Promise<ScheduledMeeting> {
  const { data, error } = await supabase.functions.invoke("schedule-meeting", { body: input });
  if (error) {
    let detail = error.message;
    const ctx = (error as { context?: { text?: () => Promise<string> } }).context;
    if (ctx?.text) {
      try {
        const body = await ctx.text();
        const parsed = JSON.parse(body) as { error?: string; detail?: string };
        detail = parsed.error ?? parsed.detail ?? body;
      } catch { /* keep the original message */ }
    }
    throw new Error(meetingRefusal(detail));
  }
  const result = data as ScheduledMeeting & { error?: string };
  if (result?.error) throw new Error(meetingRefusal(result.error));
  return result;
}

export async function listMeetings(limit = 20): Promise<MeetingRow[]> {
  const { data, error } = await supabase
    .from("org_meetings")
    .select(
      "id, title, purpose, meeting_kind, platform, starts_at, duration_minutes, timezone, organiser_email, attendees, join_url, status, invite_sent_at, failure_reason",
    )
    .order("starts_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(error.message);
  return (data ?? []) as unknown as MeetingRow[];
}
