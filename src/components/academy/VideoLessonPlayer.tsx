import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { CheckCircle2, PlayCircle, AlertCircle } from "lucide-react";
import { toast } from "@/hooks/use-toast";

export interface AcademyVideo {
  id: string;
  lesson_id: string;
  title: string | null;
  url: string;
  provider: string;
  duration_seconds: number;
  min_watch_percent: number;
  checkpoints: number[] | unknown;
  is_mandatory?: boolean;
}

const CHECKPOINTS = [20, 40, 60, 80, 100];

function extractYouTubeId(url: string): string | null {
  try {
    const u = new URL(url);
    if (u.hostname.includes("youtu.be")) return u.pathname.slice(1) || null;
    const v = u.searchParams.get("v");
    if (v) return v;
    const m = u.pathname.match(/\/(embed|shorts)\/([\w-]{6,})/);
    if (m) return m[2];
    return null;
  } catch {
    return null;
  }
}

declare global {
  interface Window {
    YT?: any;
    onYouTubeIframeAPIReady?: () => void;
  }
}

function loadYT(): Promise<any> {
  return new Promise((resolve) => {
    if (window.YT?.Player) return resolve(window.YT);
    const exist = document.getElementById("yt-iframe-api");
    if (!exist) {
      const s = document.createElement("script");
      s.id = "yt-iframe-api";
      s.src = "https://www.youtube.com/iframe_api";
      document.head.appendChild(s);
    }
    const prev = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      prev?.();
      resolve(window.YT);
    };
  });
}

export function VideoLessonPlayer({
  video,
  onCompleted,
}: {
  video: AcademyVideo;
  onCompleted?: () => void;
}) {
  const [passed, setPassed] = useState<number[]>([]);
  const [percent, setPercent] = useState(0);
  const [done, setDone] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<any>(null);
  const timerRef = useRef<number | null>(null);
  const passedRef = useRef<number[]>([]);

  const ytId = video.provider === "youtube" ? extractYouTubeId(video.url) : null;
  const fallback = !ytId; // search URL, yalla internal, or non-yt provider

  async function recordCheckpoint(pct: number, watchedSec: number) {
    if (passedRef.current.includes(pct)) return;
    passedRef.current = [...passedRef.current, pct];
    setPassed([...passedRef.current]);
    const { error } = await supabase.rpc("training_record_video_watch", {
      _video_id: video.id,
      _watched_seconds: Math.floor(watchedSec),
      _watched_percent: pct,
      _checkpoint: `cp_${pct}`,
    });
    if (error) {
      toast({ title: "Checkpoint failed", description: error.message, variant: "destructive" });
      return;
    }
    if (pct >= video.min_watch_percent) {
      setDone(true);
      onCompleted?.();
      toast({ title: "Lesson complete", description: "Progress saved." });
    }
  }

  // Load completion state on mount
  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from("video_completion_logs")
        .select("watched_percent, checkpoints_passed, completed")
        .eq("video_id", video.id)
        .maybeSingle();
      if (data) {
        const pcts: number[] = Array.isArray(data.checkpoints_passed)
          ? (data.checkpoints_passed as any[])
              .map((c) => parseInt(String(c).replace("cp_", ""), 10))
              .filter((n) => !Number.isNaN(n))
          : [];
        passedRef.current = pcts;
        setPassed(pcts);
        setPercent(data.watched_percent ?? 0);
        setDone(!!data.completed);
      }
    })();
  }, [video.id]);

  // YouTube player
  useEffect(() => {
    if (fallback || !ytId || !containerRef.current) return;
    let mounted = true;
    (async () => {
      const YT = await loadYT();
      if (!mounted || !containerRef.current) return;
      playerRef.current = new YT.Player(containerRef.current, {
        videoId: ytId,
        playerVars: { rel: 0, modestbranding: 1, controls: 1 },
        events: {
          onReady: () => {
            timerRef.current = window.setInterval(() => {
              const p = playerRef.current;
              if (!p?.getCurrentTime) return;
              const cur = p.getCurrentTime();
              const dur = p.getDuration() || video.duration_seconds || 1;
              const pct = Math.min(100, Math.round((cur / dur) * 100));
              setPercent(pct);
              for (const cp of CHECKPOINTS) {
                if (pct >= cp && !passedRef.current.includes(cp)) {
                  void recordCheckpoint(cp, cur);
                }
              }
            }, 2000);
          },
        },
      });
    })();
    return () => {
      mounted = false;
      if (timerRef.current) window.clearInterval(timerRef.current);
      try { playerRef.current?.destroy?.(); } catch { /* noop */ }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ytId, fallback]);

  const nextCp = CHECKPOINTS.find((c) => !passed.includes(c));

  return (
    <div className="space-y-3 rounded-lg border bg-card p-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <PlayCircle className="h-5 w-5 text-primary" />
          <span className="font-medium text-sm">{video.title ?? "Training video"}</span>
          {video.is_mandatory && <Badge variant="destructive" className="text-[10px]">Mandatory</Badge>}
        </div>
        <span className="text-xs text-muted-foreground">
          Min watch {video.min_watch_percent}%
        </span>
      </div>

      {fallback ? (
        <div className="rounded-md border border-dashed bg-muted/40 p-6 text-center text-sm space-y-3">
          <div className="flex items-center justify-center gap-2 text-muted-foreground">
            <AlertCircle className="h-4 w-4" />
            {video.provider === "yalla"
              ? "Internal SAFARID video — coming soon. Use the manual checkpoints below to acknowledge each section."
              : "External resource — open it in a new tab and confirm each section."}
          </div>
          <Button asChild size="sm" variant="outline" disabled={video.url.startsWith("internal_")}>
            <a href={video.url} target="_blank" rel="noreferrer">Open resource</a>
          </Button>
          {nextCp !== undefined && (
            <div>
              <Button
                size="sm"
                onClick={() => recordCheckpoint(nextCp, (video.duration_seconds * nextCp) / 100)}
              >
                Acknowledge checkpoint {nextCp}%
              </Button>
            </div>
          )}
        </div>
      ) : (
        <div className="aspect-video w-full overflow-hidden rounded-md bg-ink">
          <div ref={containerRef} className="h-full w-full" />
        </div>
      )}

      <div>
        <div className="flex justify-between text-xs text-muted-foreground mb-1">
          <span>Watched {percent}%</span>
          <span>
            Checkpoints {passed.length}/{CHECKPOINTS.length}
          </span>
        </div>
        <Progress value={percent} className="h-2" />
        <div className="mt-2 flex gap-1">
          {CHECKPOINTS.map((cp) => (
            <div
              key={cp}
              className={`flex-1 text-center text-[10px] py-1 rounded ${
                passed.includes(cp)
                  ? "bg-primary/15 text-primary font-medium"
                  : "bg-muted text-muted-foreground"
              }`}
            >
              {cp}%
            </div>
          ))}
        </div>
      </div>

      {done && (
        <div className="flex items-center gap-2 text-sm text-status-success">
          <CheckCircle2 className="h-4 w-4" /> Lesson completed and certified
        </div>
      )}
    </div>
  );
}
