/**
 * Internal design-governance surface: deterministic gallery of every status
 * tone in every supported treatment. Used by the visual-regression suite to
 * catch traffic-light border regressions in light AND dark themes.
 *
 * Not linked from navigation; excluded from the sitemap.
 */
import { useEffect, useState } from "react";
import { Helmet } from "react-helmet-async";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import StatusBorder from "@/components/common/StatusBorder";
import StatusBadge from "@/components/common/StatusBadge";
import { STATUS_TONE_KEYS, toneClasses } from "@/lib/design/statusTone";
import { Button } from "@/components/ui/button";

const BADGE_STATUSES = [
  "active", "inactive", "blocked", "available", "busy",
  "offline", "scheduled", "in_progress", "completed", "cancelled",
] as const;

export default function StatusTokens() {
  const [dark, setDark] = useState(false);

  useEffect(() => {
    const root = document.documentElement;
    const had = root.classList.contains("dark");
    root.classList.toggle("dark", dark);
    return () => { root.classList.toggle("dark", had); };
  }, [dark]);

  return (
    <main className="min-h-screen bg-background text-foreground p-8 space-y-8">
      <Helmet>
        <title>Status Token Gallery | TaxiD Design Governance</title>
        <meta name="robots" content="noindex,nofollow" />
      </Helmet>

      <header className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Status Token Gallery</h1>
          <p className="text-sm text-muted-foreground">
            Canonical traffic-light tones sourced from <code>statusTone.ts</code>.
          </p>
        </div>
        <Button
          variant="outline"
          data-testid="status-theme-toggle"
          onClick={() => setDark((d) => !d)}
        >
          {dark ? "Light theme" : "Dark theme"}
        </Button>
      </header>

      <section data-testid="status-borders" className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Status borders
        </h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {STATUS_TONE_KEYS.map((tone) => (
            <StatusBorder key={tone} tone={tone} tinted className="p-4">
              <div className={`text-sm font-semibold ${toneClasses(tone).text}`}>{tone}</div>
              <div className="text-xs text-muted-foreground">border · tint · text</div>
            </StatusBorder>
          ))}
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {STATUS_TONE_KEYS.map((tone) => (
            <StatusBorder key={`${tone}-strong`} tone={tone} strong className="p-4">
              <div className={`text-sm font-semibold ${toneClasses(tone).text}`}>{tone} · strong</div>
            </StatusBorder>
          ))}
        </div>
      </section>

      <section data-testid="status-badges" className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Status badges
        </h2>
        <div className="flex flex-wrap gap-2">
          {BADGE_STATUSES.map((s) => (
            <StatusBadge key={s} status={s} />
          ))}
        </div>
      </section>

      <section data-testid="status-callouts" className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Callout cards
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {(["success", "warning", "danger"] as const).map((tone) => (
            <Card key={tone} className={toneClasses(tone).border}>
              <CardHeader className="pb-2">
                <CardTitle className="text-xs font-medium text-muted-foreground">
                  {tone} callout
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className={`text-2xl font-bold ${toneClasses(tone).text}`}>
                  {tone === "success" ? 98 : tone === "warning" ? 78 : 42}
                  <span className="text-sm font-normal text-muted-foreground">/100</span>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </section>
    </main>
  );
}
