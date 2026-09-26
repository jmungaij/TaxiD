/**
 * MEETING SCHEDULER PANEL
 * -----------------------
 * Any staff mailbox can arrange a virtual meeting here — interviews, colleague
 * reviews, client or partner meetings. Choosing Google Meet means the joining
 * link is created by Google when the invitation is sent; nobody types one in.
 * Teams (or any other platform) is supported by pasting that platform's link,
 * and every attendee still receives a standard calendar invitation.
 */
import * as React from "react";
import { CalendarPlus, Loader2, Video } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  KIND_LABELS,
  PLATFORM_LABELS,
  listMeetings,
  scheduleMeeting,
  type MeetingKind,
  type MeetingPlatform,
  type MeetingRow,
} from "@/lib/meetings/meetings";

const toIso = (local: string) => new Date(local).toISOString();

const whenLabel = (iso: string, zone: string) =>
  new Intl.DateTimeFormat("en-GB", {
    timeZone: zone, day: "numeric", month: "short", hour: "2-digit", minute: "2-digit",
  }).format(new Date(iso));

export default function MeetingScheduler({ accountId = null, defaultKind = "internal" }: { accountId?: string | null; defaultKind?: MeetingKind }) {
  const [title, setTitle] = React.useState("");
  const [purpose, setPurpose] = React.useState("");
  const [kind, setKind] = React.useState<MeetingKind>(defaultKind);
  const [platform, setPlatform] = React.useState<MeetingPlatform>("google_meet");
  const [when, setWhen] = React.useState("");
  const [duration, setDuration] = React.useState("30");
  const [emails, setEmails] = React.useState("");
  const [joinUrl, setJoinUrl] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [rows, setRows] = React.useState<MeetingRow[]>([]);

  const refresh = React.useCallback(async () => {
    try {
      setRows(await listMeetings(8));
    } catch {
      setRows([]);
    }
  }, []);

  React.useEffect(() => { void refresh(); }, [refresh]);

  const send = async () => {
    const attendees = emails
      .split(/[,;\s]+/)
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean)
      .map((email) => ({ email }));
    if (!title.trim()) { toast.error("Give the meeting a title."); return; }
    if (!when) { toast.error("Pick the date and time."); return; }
    if (!attendees.length) { toast.error("Add at least one email address."); return; }

    setBusy(true);
    try {
      const result = await scheduleMeeting({
        title: title.trim(),
        purpose: purpose.trim() || null,
        meeting_kind: kind,
        platform,
        starts_at: toIso(when),
        duration_minutes: Number(duration) || 30,
        timezone: "Africa/Nairobi",
        attendees,
        join_url: joinUrl.trim() || null,
        account_id: accountId,
      });
      const people = `${result.attendees.length} ${result.attendees.length === 1 ? "person" : "people"}`;
      if (result.calendar_attached) {
        toast.success(
          result.join_url
            ? `On the calendar and sent to ${people}, with the joining link.`
            : `On the calendar and sent to ${people}.`,
        );
      } else {
        toast.success(`Invitation sent to ${people}, but it is not on the Google Calendar yet.`);
      }
      setTitle(""); setPurpose(""); setEmails(""); setJoinUrl(""); setWhen("");
      await refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "The invitation was not sent.");
    } finally {
      setBusy(false);
    }
  };

  const needsLink = platform === "microsoft_teams" || platform === "other_link";

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Video className="h-4 w-4 text-primary" /> Meetings and invitations
        </CardTitle>
        <CardDescription>
          Every meeting you send here is created on the company Google Calendar and everyone invited is
          added to that event. Choose Google Meet and Google mints the joining link for you; for any other
          platform paste the link and it travels on the same calendar event and email invitation.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <Label htmlFor="mtg-title">Title</Label>
            <Input id="mtg-title" value={title} onChange={(e) => setTitle(e.target.value)}
              placeholder="Corporate mobility review" />
          </div>
          <div>
            <Label>Kind</Label>
            <Select value={kind} onValueChange={(v) => setKind(v as MeetingKind)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {Object.entries(KIND_LABELS).map(([v, l]) => (
                  <SelectItem key={v} value={v}>{l}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Platform</Label>
            <Select value={platform} onValueChange={(v) => setPlatform(v as MeetingPlatform)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {Object.entries(PLATFORM_LABELS).map(([v, l]) => (
                  <SelectItem key={v} value={v}>{l}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label htmlFor="mtg-when">When</Label>
            <Input id="mtg-when" type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} />
          </div>
          <div>
            <Label htmlFor="mtg-duration">Minutes</Label>
            <Input id="mtg-duration" type="number" min={10} max={600} value={duration}
              onChange={(e) => setDuration(e.target.value)} />
          </div>
          {needsLink && (
            <div className="sm:col-span-2">
              <Label htmlFor="mtg-link">Joining link</Label>
              <Input id="mtg-link" value={joinUrl} onChange={(e) => setJoinUrl(e.target.value)}
                placeholder="https://teams.microsoft.com/l/meetup-join/..." />
            </div>
          )}
          <div className="sm:col-span-2">
            <Label htmlFor="mtg-emails">Who to invite</Label>
            <Input id="mtg-emails" value={emails} onChange={(e) => setEmails(e.target.value)}
              placeholder="admin@yalla.africa, client@example.com" />
          </div>
          <div className="sm:col-span-2">
            <Label htmlFor="mtg-purpose">Agenda (optional)</Label>
            <Textarea id="mtg-purpose" rows={2} value={purpose} onChange={(e) => setPurpose(e.target.value)} />
          </div>
        </div>

        <Button onClick={() => void send()} disabled={busy}>
          {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CalendarPlus className="mr-2 h-4 w-4" />}
          Send meeting invitation
        </Button>

        {rows.length > 0 && (
          <div className="space-y-2 border-t border-border pt-3">
            <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Recent meetings</div>
            {rows.map((m) => (
              <div key={m.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border p-2 text-sm">
                <div className="min-w-0">
                  <div className="truncate font-medium">{m.title}</div>
                  <div className="text-xs text-muted-foreground">
                    {whenLabel(m.starts_at, m.timezone)} · {m.duration_minutes} min · {m.attendees.length} invited
                    {m.failure_reason ? ` · ${m.failure_reason}` : ""}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant={m.status === "sent" ? "default" : m.status === "failed" ? "destructive" : "secondary"}>
                    {m.status === "sent" ? "Invitation sent" : m.status === "failed" ? "Not delivered" : m.status}
                  </Badge>
                  {m.join_url && (
                    <a href={m.join_url} target="_blank" rel="noreferrer" className="text-xs font-semibold text-primary underline">
                      Join
                    </a>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
