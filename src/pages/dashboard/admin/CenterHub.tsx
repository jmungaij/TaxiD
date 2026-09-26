import { useMemo } from "react";
import { Link } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ADMIN_CENTERS, ROUTES, canAccess, type AdminCenter } from "@/lib/routes";
import { useAuth } from "@/hooks/useAuth";
import { ArrowRight } from "lucide-react";

interface Props {
  center: AdminCenter;
  title?: string;
  description?: string;
}

export default function CenterHub({ center, title, description }: Props) {
  const { roles } = useAuth();
  const meta = ADMIN_CENTERS.find((c) => c.key === center);
  const isAggregator = center === "super_admin" || center === "home";
  const items = useMemo(
    () =>
      ROUTES
        .filter((r) => r.group === "admin" && !r.internalAlias && canAccess(r, roles))
        .filter((r) => (isAggregator ? r.center !== center : r.center === center))
        .sort((a, b) => (a.sortOrder ?? 999) - (b.sortOrder ?? 999)),
    [center, isAggregator, roles]
  );

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">{title ?? meta?.label ?? "Command Center"}</h1>
        {description && <p className="text-sm text-muted-foreground mt-1">{description}</p>}
      </div>

      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {items.map((r) => (
          <Link key={r.path} to={r.path} className="group">
            <Card className="h-full transition-all hover:border-primary hover:shadow-md">
              <CardHeader className="pb-2">
                <CardTitle className="text-base flex items-center justify-between">
                  <span>{r.title}</span>
                  <ArrowRight className="h-4 w-4 opacity-0 group-hover:opacity-100 transition-opacity" />
                </CardTitle>
              </CardHeader>
              <CardContent className="text-xs text-muted-foreground font-mono">{r.path}</CardContent>
            </Card>
          </Link>
        ))}
        {items.length === 0 && (
          <div className="col-span-full text-sm text-muted-foreground">
            No modules in this center are available for your role.
          </div>
        )}
      </div>
    </div>
  );
}
