/**
 * Staff 360 review notifications bell.
 *
 * Shows review requests, approvals and returns addressed to the selected
 * employee. Rows are written by a database trigger on `staff_work_reviews`, so
 * the bell reflects decisions made anywhere — and Realtime pushes them in
 * without a refresh.
 */
import { useCallback, useEffect, useState } from "react";
import { Bell, CheckCheck } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  listNotifications, markAllNotificationsRead, markNotificationRead,
  NOTIFICATION_LABEL, unreadCount, useReviewRealtime,
  type StaffNotification,
} from "@/lib/staff/org/notifications";

export function NotificationBell({
  staffId, onChanged,
}: { staffId: string; onChanged?: () => void }) {
  const [rows, setRows] = useState<StaffNotification[]>([]);
  const [open, setOpen] = useState(false);

  const load = useCallback(async () => {
    if (!staffId) return;
    try {
      setRows(await listNotifications(staffId));
    } catch {
      // A missing read grant must not break the queue itself.
      setRows([]);
    }
  }, [staffId]);

  useEffect(() => { void load(); }, [load]);

  useReviewRealtime(staffId, (n) => {
    void load();
    onChanged?.();
    if (n) toast.info(NOTIFICATION_LABEL[n.kind], { description: n.title });
  });

  const unread = unreadCount(rows);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" size="icon" className="relative" aria-label={`Review notifications${unread > 0 ? `, ${unread} unread` : ""}`}>
          <Bell className="h-4 w-4" />
          {unread > 0 && (
            <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-semibold text-primary-foreground">
              {unread > 9 ? "9+" : unread}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-96 p-0">
        <div className="flex items-center justify-between border-b px-4 py-3">
          <div className="text-sm font-semibold">Review activity</div>
          {unread > 0 && (
            <Button
              size="sm"
              variant="ghost"
              onClick={async () => {
                await markAllNotificationsRead(staffId);
                await load();
              }}
            >
              <CheckCheck className="mr-1.5 h-3.5 w-3.5" />Mark all read
            </Button>
          )}
        </div>
        <ScrollArea className="max-h-80">
          {rows.length === 0 ? (
            <p className="px-4 py-6 text-sm text-muted-foreground">
              No review activity yet. Submitting work for review, or a manager approving or returning it, appears here in real time.
            </p>
          ) : (
            <ul className="divide-y">
              {rows.map((n) => (
                <li key={n.id} className={`px-4 py-3 ${n.read_at ? "" : "bg-muted/40"}`}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <Badge variant={n.kind === "review_returned" ? "destructive" : "outline"} className="mb-1 text-[10px]">
                        {NOTIFICATION_LABEL[n.kind]}
                      </Badge>
                      <div className="truncate text-sm font-medium">{n.title}</div>
                      {n.body && <p className="mt-0.5 text-xs text-muted-foreground">{n.body}</p>}
                      <p className="mt-1 font-mono text-[10px] text-muted-foreground">
                        {n.source_of_record} · {new Date(n.created_at).toLocaleString("en-KE")}
                      </p>
                    </div>
                    {!n.read_at && (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={async () => { await markNotificationRead(n.id); await load(); }}
                      >
                        Read
                      </Button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </ScrollArea>
      </PopoverContent>
    </Popover>
  );
}
