/**
 * Charter webhook endpoints — admin console panel.
 *
 * Admin systems subscribe here to receive signed events whenever a cabin/seat,
 * aircraft gallery or ground package change is finalised. Every delivery is
 * HMAC-SHA256 signed and carries the actor_user_id plus before/after diffs.
 */
import { useEffect, useState } from "react";
import { charterApi, type CharterWebhookDelivery, type CharterWebhookEndpoint } from "@/lib/charter/api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { Webhook, Send, Trash2, RefreshCw, History } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "@/hooks/use-toast";

const EVENTS = [
  "charter.cabin_changed",
  "charter.gallery_selected",
  "charter.ground_package_changed",
  "charter.payment_initiated",
];

export function CharterWebhookPanel() {
  const [endpoints, setEndpoints] = useState<CharterWebhookEndpoint[]>([]);
  const [deliveries, setDeliveries] = useState<CharterWebhookDelivery[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [label, setLabel] = useState("");
  const [url, setUrl] = useState("");
  const [events, setEvents] = useState<string[]>(EVENTS);
  const [secret, setSecret] = useState<string | null>(null);
  // Replay: resend the last finalised event of a chosen type to one endpoint.
  const [replayEndpoint, setReplayEndpoint] = useState("");
  const [replayEvent, setReplayEvent] = useState(EVENTS[0]);
  const [replaying, setReplaying] = useState(false);
  const [replayResult, setReplayResult] = useState<
    { status: string; response_status: number | null; error: string | null; event_id: string } | null
  >(null);

  const replay = async (endpointId: string, eventType: string, deliveryId?: string) => {
    if (!endpointId) {
      toast({ title: "Pick an endpoint", description: "Choose where the replay should be delivered.", variant: "destructive" });
      return;
    }
    setReplaying(true);
    try {
      const res = await charterApi.replayWebhook({ endpoint_id: endpointId, event_type: deliveryId ? undefined : eventType, delivery_id: deliveryId });
      setReplayResult({
        status: res.status, response_status: res.response_status,
        error: res.error, event_id: res.replayed_event_id,
      });
      toast({
        title: res.status === "delivered" ? "Replay delivered" : "Replay failed",
        description: `${res.replayed_event_id} → HTTP ${res.response_status ?? "—"}${res.error ? ` · ${res.error}` : ""}`,
        variant: res.status === "delivered" ? "default" : "destructive",
      });
      await load();
    } catch (e) {
      toast({ title: "Replay failed", description: e instanceof Error ? e.message : "", variant: "destructive" });
    } finally {
      setReplaying(false);
    }
  };

  const load = async () => {
    setLoading(true);
    try {
      const res = await charterApi.listWebhooks();
      setEndpoints(res.endpoints);
      setDeliveries(res.deliveries);
    } catch (e) {
      toast({ title: "Could not load webhooks", description: e instanceof Error ? e.message : "", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, []);

  const save = async () => {
    setSaving(true);
    try {
      const res = await charterApi.saveWebhook({ label, url, events, active: true });
      setSecret(res.secret ?? null);
      setLabel("");
      setUrl("");
      toast({ title: "Endpoint saved", description: "Copy the signing secret now — it is shown once." });
      await load();
    } catch (e) {
      toast({ title: "Save failed", description: e instanceof Error ? e.message : "", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card>
      <CardHeader className="pb-3 flex-row items-center justify-between space-y-0">
        <CardTitle className="text-base flex items-center gap-2">
          <Webhook className="h-4 w-4 text-primary" /> Change event webhooks
        </CardTitle>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading}>
            <RefreshCw className={`h-4 w-4 mr-1.5 ${loading ? "animate-spin" : ""}`} /> Refresh
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={async () => {
              try {
                await charterApi.testWebhook();
                toast({ title: "Test event dispatched" });
                await load();
              } catch (e) {
                toast({ title: "Test failed", description: e instanceof Error ? e.message : "", variant: "destructive" });
              }
            }}
          >
            <Send className="h-4 w-4 mr-1.5" /> Send test
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 md:grid-cols-[1fr_2fr_auto] md:items-end">
          <div className="space-y-1.5">
            <Label htmlFor="wh-label">Label</Label>
            <Input id="wh-label" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Ops bus" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="wh-url">HTTPS endpoint</Label>
            <Input id="wh-url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://ops.example.com/hooks/charter" />
          </div>
          <Button onClick={() => void save()} disabled={saving || !url}>Add endpoint</Button>
        </div>

        <div className="flex flex-wrap gap-2">
          {EVENTS.map((ev) => (
            <label key={ev} className="flex items-center gap-2 rounded-lg border border-border/60 px-3 py-1.5 text-xs">
              <Switch
                checked={events.includes(ev)}
                onCheckedChange={(v) => setEvents((prev) => (v ? [...new Set([...prev, ev])] : prev.filter((e) => e !== ev)))}
              />
              {ev}
            </label>
          ))}
        </div>

        <div className="grid gap-3 rounded-xl border border-border/60 bg-muted/30 p-3 md:grid-cols-[1fr_1fr_auto] md:items-end">
          <div className="space-y-1.5">
            <Label>Replay destination</Label>
            <Select value={replayEndpoint} onValueChange={setReplayEndpoint}>
              <SelectTrigger><SelectValue placeholder="Select endpoint" /></SelectTrigger>
              <SelectContent>
                {endpoints.map((ep) => (
                  <SelectItem key={ep.id} value={ep.id}>{ep.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Event to resend</Label>
            <Select value={replayEvent} onValueChange={setReplayEvent}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {EVENTS.map((ev) => <SelectItem key={ev} value={ev}>{ev}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <Button variant="outline" onClick={() => void replay(replayEndpoint, replayEvent)} disabled={replaying}>
            <History className={`h-4 w-4 mr-1.5 ${replaying ? "animate-spin" : ""}`} /> Replay last event
          </Button>
          {replayResult && (
            <p className="md:col-span-3 text-xs text-muted-foreground">
              Last replay {replayResult.event_id} → <span className="font-medium">{replayResult.status}</span>
              {replayResult.response_status ? ` (HTTP ${replayResult.response_status})` : ""}
              {replayResult.error ? ` · ${replayResult.error}` : ""}
            </p>
          )}
        </div>

        {secret && (
          <p className="rounded-lg border border-status-warning/40 bg-status-warning/10 p-3 text-xs font-mono break-all">
            Signing secret (shown once): {secret}
          </p>
        )}

        {loading ? (
          <Skeleton className="h-24 w-full" />
        ) : (
          <div className="space-y-2">
            {endpoints.length === 0 && <p className="text-sm text-muted-foreground">No endpoints registered yet.</p>}
            {endpoints.map((ep) => (
              <div key={ep.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border/60 p-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium">{ep.label}</p>
                  <p className="truncate text-xs text-muted-foreground">{ep.url}</p>
                  <p className="text-[11px] text-muted-foreground">{ep.events.join(" · ")}</p>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant={ep.last_status === "delivered" ? "default" : "outline"}>
                    {ep.last_status ?? "never delivered"}
                  </Badge>
                  <Button
                    size="icon"
                    variant="ghost"
                    onClick={async () => {
                      await charterApi.deleteWebhook(ep.id).catch(() => undefined);
                      await load();
                    }}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}

        {deliveries.length > 0 && (
          <div className="space-y-1 pt-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Recent deliveries</p>
            {deliveries.slice(0, 10).map((d) => (
              <div key={d.id} className="flex flex-wrap items-center justify-between gap-2 text-xs">
                <span className="font-mono">{d.event_type}</span>
                <span className="text-muted-foreground">{d.reference ?? "—"}</span>
                <Badge variant={d.status === "delivered" ? "default" : "destructive"}>
                  {d.status}{d.response_status ? ` ${d.response_status}` : ""}
                </Badge>
                <span className="text-muted-foreground">{new Date(d.created_at).toLocaleString()}</span>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-6 px-2 text-[11px]"
                  disabled={replaying}
                  onClick={() => void replay(replayEndpoint || d.endpoint_id || "", d.event_type, d.id)}
                >
                  Replay
                </Button>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
