import { type ReactNode, useEffect, useMemo } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  WORKSPACE360_TABS,
  WORKSPACE360_TAB_LABELS,
  type Workspace360Tab,
  isWorkspace360Tab,
  normalizeWorkspace360Tab,
} from "@/lib/workspace360/tabs";
import { trackWorkspace360TabLanding } from "@/lib/workspace360/links";
import {
  readLastWorkspace360Tab,
  writeLastWorkspace360Tab,
} from "@/lib/workspace360/prefs";
import { workspace360BasePath, type Workspace360Domain } from "@/lib/workspace360/domains";

export interface Workspace360KPI {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
}

export interface Workspace360TabConfig {
  tab: Workspace360Tab;
  render: () => ReactNode;
  /** Hide from the tab strip (e.g. domain has no data source yet). */
  hidden?: boolean;
}

export interface Workspace360ShellProps {
  domain: Workspace360Domain;
  entityId: string;
  title: string;
  subtitle?: string;
  initials?: string;
  statusBadges?: { label: string; className?: string }[];
  kpis?: Workspace360KPI[];
  actions?: ReactNode;
  tabs: Workspace360TabConfig[];
  directoryLabel?: string;
}

export function Workspace360Shell({
  domain,
  entityId,
  title,
  subtitle,
  initials,
  statusBadges,
  kpis,
  actions,
  tabs,
  directoryLabel = "Directory",
}: Workspace360ShellProps) {
  const [searchParams, setSearchParams] = useSearchParams();
  const rawTabParam = searchParams.get("tab");
  const availableTabs = useMemo(
    () => new Set(tabs.filter((t) => !t.hidden).map((t) => t.tab)),
    [tabs],
  );

  // Fallback chain: URL → last-opened persisted tab → default overview.
  const effectiveRaw = rawTabParam ?? readLastWorkspace360Tab(domain);
  const normalized = normalizeWorkspace360Tab(effectiveRaw);
  const active: Workspace360Tab = availableTabs.has(normalized)
    ? normalized
    : "overview";

  useEffect(() => {
    if (rawTabParam !== null && !isWorkspace360Tab(rawTabParam)) {
      setSearchParams(
        (p) => {
          p.delete("tab");
          return p;
        },
        { replace: true },
      );
    }
  }, [rawTabParam, setSearchParams]);

  useEffect(() => {
    if (!entityId) return;
    trackWorkspace360TabLanding(domain, entityId, active, rawTabParam);
    writeLastWorkspace360Tab(domain, active);
  }, [domain, entityId, active, rawTabParam]);

  const initialsFallback = (initials || title.slice(0, 2)).toUpperCase();

  return (
    <div className="space-y-6">
      <div className="sticky top-0 z-10 bg-background/95 backdrop-blur border-b -mx-6 px-6 py-4">
        <div className="flex flex-wrap items-center gap-4">
          <Button variant="ghost" size="sm" asChild>
            <Link to={workspace360BasePath(domain)}>
              <ArrowLeft className="h-4 w-4 mr-1" /> {directoryLabel}
            </Link>
          </Button>
          <Avatar className="h-12 w-12">
            <AvatarFallback>{initialsFallback}</AvatarFallback>
          </Avatar>
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-xl font-bold">{title}</h1>
              {statusBadges?.map((b, i) => (
                <Badge key={i} className={b.className} variant={b.className ? undefined : "outline"}>
                  {b.label}
                </Badge>
              ))}
            </div>
            {subtitle && (
              <div className="text-xs text-muted-foreground">{subtitle}</div>
            )}
          </div>
          <div className="ml-auto flex gap-2 flex-wrap items-center">
            {kpis?.map((k, i) => (
              <div
                key={i}
                className="flex items-center gap-2 rounded-md border px-3 py-1.5 text-xs"
              >
                <k.icon className="h-3.5 w-3.5 text-muted-foreground" />
                <span className="text-muted-foreground">{k.label}</span>
                <span className="font-semibold">{k.value}</span>
              </div>
            ))}
            {actions && <div className="flex gap-1">{actions}</div>}
          </div>
        </div>
      </div>

      <Tabs
        value={active}
        onValueChange={(v) =>
          setSearchParams(
            (p) => {
              p.set("tab", v);
              return p;
            },
            { replace: true },
          )
        }
      >
        <TabsList className="flex flex-wrap h-auto">
          {WORKSPACE360_TABS.filter((t) => availableTabs.has(t)).map((t) => (
            <TabsTrigger key={t} value={t}>
              {WORKSPACE360_TAB_LABELS[t]}
            </TabsTrigger>
          ))}
        </TabsList>

        {tabs
          .filter((t) => !t.hidden)
          .map((t) => (
            <TabsContent key={t.tab} value={t.tab}>
              {t.render()}
            </TabsContent>
          ))}
      </Tabs>
    </div>
  );
}

export function Workspace360EmptyPanel({
  title,
  description,
}: {
  title: string;
  description?: string;
}) {
  return (
    <Card>
      <CardContent className="pt-6 text-center text-sm text-muted-foreground">
        <div className="font-semibold text-foreground mb-1">{title}</div>
        {description && <div>{description}</div>}
      </CardContent>
    </Card>
  );
}
