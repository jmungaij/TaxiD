/**
 * Staff 360 review notifications.
 *
 * `staff_notifications` rows are written by a database trigger on
 * `staff_work_reviews`, so a review request, approval or return notifies both
 * the employee and the reviewing manager even when the decision is recorded
 * outside this interface. The table is append-only — only `read_at` may change.
 */
import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

export type NotificationKind =
  | "review_requested" | "review_approved" | "review_returned"
  | "corrective_reported" | "corrective_resolved"
  | "decision_requested" | "decision_recorded";

export interface StaffNotification {
  id: string;
  recipient_staff_id: string | null;
  recipient_user_id: string | null;
  actor_staff_id: string | null;
  kind: NotificationKind;
  title: string;
  body: string | null;
  work_item_id: string | null;
  review_id: string | null;
  source_of_record: string;
  source_record_id: string | null;
  read_at: string | null;
  created_at: string;
}

export const NOTIFICATION_LABEL: Record<NotificationKind, string> = {
  review_requested: "Review requested",
  review_approved: "Approved on review",
  review_returned: "Returned on review",
  corrective_reported: "Corrective action reported",
  corrective_resolved: "Corrective action resolved",
  decision_requested: "Decision requested",
  decision_recorded: "Decision recorded",
};

/** Notifications addressed to one employee, newest first. */
export async function listNotifications(staffId: string, limit = 50): Promise<StaffNotification[]> {
  const { data, error } = await db
    .from("staff_notifications")
    .select("*")
    .eq("recipient_staff_id", staffId)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(error.message);
  return (data ?? []) as StaffNotification[];
}

export async function markNotificationRead(id: string) {
  const { error } = await db
    .from("staff_notifications")
    .update({ read_at: new Date().toISOString() })
    .eq("id", id);
  if (error) throw new Error(error.message);
}

export async function markAllNotificationsRead(staffId: string) {
  const { error } = await db
    .from("staff_notifications")
    .update({ read_at: new Date().toISOString() })
    .eq("recipient_staff_id", staffId)
    .is("read_at", null);
  if (error) throw new Error(error.message);
}

export const unreadCount = (rows: StaffNotification[]) => rows.filter((n) => !n.read_at).length;

/**
 * Live review status. Subscribes to notifications addressed to this employee
 * and to their work items, so the queue and the bell update the moment a
 * manager records a decision.
 */
export function useReviewRealtime(staffId: string | null | undefined, onChange: (n?: StaffNotification) => void) {
  const [connected, setConnected] = useState(false);
  // Keep the latest handler in a ref so a new closure per render does not
  // force the realtime channel to re-subscribe.
  const handler = useRef(onChange);
  handler.current = onChange;

  useEffect(() => {
    if (!staffId) return;
    const channel = supabase
      .channel(`staff360-reviews-${staffId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "staff_notifications", filter: `recipient_staff_id=eq.${staffId}` },
        (payload) => handler.current(payload.new as StaffNotification),
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "staff_work_items", filter: `staff_id=eq.${staffId}` },
        () => handler.current(),
      )
      .subscribe((status) => setConnected(status === "SUBSCRIBED"));

    return () => { void supabase.removeChannel(channel); };
  }, [staffId]);

  return { connected };
}
