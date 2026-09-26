/**
 * Realtime Connection Health — monitors all active Supabase channels, shows
 * status and last-event timestamps per stream, and logs failures.
 */
import * as React from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Activity, AlertTriangle, CheckCircle2 } from "lucide-react";
import { logSubscriptionHealth, type ChannelStatus } from "@/lib/subscriptionHealth";
import { useExecMetrics } from "@/providers/ExecutiveMetricsProvider";

interface StreamHealth {
  stream: string;
  status: ChannelStatus;
  lastEventAt: string | null;
  error?: string;
}

const STREAMS = [
  { stream: "events", table: "event_store" },
  { stream: "alerts", table: "alerts_events" },
];

export function RealtimeHealthWidget() {
  const exec = useExecMetrics();
  const [streams, setStreams] = React.useState<Record<string, StreamHealth>>({
    events: { stream: "events", status: "reconnecting", lastEventAt: null },
    alerts: { stream: "alerts", status: "reconnecting", lastEventAt: null },
  });

  React.useEffect(() => {
    const channels = STREAMS.map(({ stream, table }) => {
      const ch = supabase
        .channel(`health-${stream}`)
        .on("postgres_changes", { event: "*", schema: "public", table }, () => {
          const ts = new Date().toISOString();
          setStreams((s) => ({ ...s, [stream]: { ...s[stream], lastEventAt: ts } }));
        })
        .subscribe((status) => {
          const mapped: ChannelStatus =
            status === "SUBSCRIBED" ? "connected" :
            status === "CHANNEL_ERROR" ? "error" :
            status === "TIMED_OUT" ? "timeout" :
            status === "CLOSED" ? "disconnected" : "reconnecting";
          setStreams((s) => ({ ...s, [stream]: { ...s[stream], status: mapped } }));
          if (mapped !== "connected") {
            void logSubscriptionHealth({
              stream, channel: `health-${stream}`, status: mapped,
              error: status,
            });
          } else {
            void logSubscriptionHealth({
              stream, channel: `health-${stream}`, status: "connected",
            });
          }
        });
      return ch;
    });
    return () => { channels.forEach((c) => supabase.removeChannel(c)); };
  }, []);

  // Reflect main exec channel
  React.useEffect(() => {
    setStreams((s) => ({
      ...s,
      events: {
        ...s.events,
        status: exec.connected ? "connected" : "reconnecting",
        lastEventAt: exec.lastEventAt ?? s.events.lastEventAt,
      },
    }));
  }, [exec.connected, exec.lastEventAt]);

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Activity className="h-4 w-4 text-primary" /> Realtime Connection Health
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {Object.values(streams).map((s) => {
          const ok = s.status === "connected";
          const age = s.lastEventAt
            ? Math.round((Date.now() - new Date(s.lastEventAt).getTime()) / 1000)
            : null;
          return (
            <div key={s.stream} className="flex items-center justify-between rounded border p-2 text-sm">
              <div className="flex items-center gap-2">
                {ok ? <CheckCircle2 className="h-4 w-4 text-status-success" />
                    : <AlertTriangle className="h-4 w-4 text-status-warning" />}
                <span className="font-medium capitalize">{s.stream}</span>
              </div>
              <div className="flex items-center gap-2">
                <Badge variant={ok ? "default" : "destructive"}>{s.status}</Badge>
                <span className="text-xs text-muted-foreground">
                  {age == null ? "no events yet" : `last: ${age}s ago`}
                </span>
              </div>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
