import { Fragment, useMemo } from "react";
import { useLocation } from "react-router-dom";
import { ChevronRight, Home } from "lucide-react";
import { AppLink } from "@/components/nav/AppLink";
import { ROUTE_BY_PATH, routeFor, type RouteDef } from "@/lib/routes";
import { cn } from "@/lib/utils";

/** Hard parent overrides for paths whose visual parent isn't simply the path prefix. */
const PARENT_OVERRIDES: Record<string, string> = {
  "/driver/apply": "/drivers",
  "/driver/onboarding": "/drivers",
  "/driver/start": "/drivers",
  "/driver/earnings": "/drivers",
  "/driver/benefits": "/drivers",
  "/driver/training": "/drivers",
  "/driver/safety": "/drivers",
  "/driver/support": "/drivers",
  "/driver/wealth": "/drivers",
  "/driver/dashboard": "/drivers",
  "/driver": "/",
  "/rider": "/",
  "/dashboard/admin/dispatch/sim": "/dashboard/admin/dispatch",
  "/blog/corporate-travel-management-guide": "/corporates",
};

function inferParent(path: string): string | undefined {
  if (path === "/") return undefined;
  if (PARENT_OVERRIDES[path]) return PARENT_OVERRIDES[path];
  const segments = path.split("/").filter(Boolean);
  while (segments.length > 0) {
    segments.pop();
    const candidate = segments.length === 0 ? "/" : "/" + segments.join("/");
    if (ROUTE_BY_PATH.has(candidate)) return candidate;
  }
  return "/";
}

function buildChain(path: string): RouteDef[] {
  const chain: RouteDef[] = [];
  const seen = new Set<string>();
  let cursor: string | undefined = path;
  while (cursor && !seen.has(cursor)) {
    seen.add(cursor);
    const route = routeFor(cursor);
    // A detail URL (e.g. /rider/trips/:id) can resolve to the same RouteDef as
    // its parent segment — dedupe so crumbs stay unique (React key stability).
    if (route && !chain.some((r) => r.path === route.path)) chain.unshift(route);
    if (cursor === "/") break;
    cursor = inferParent(cursor);
  }
  // Always anchor with home
  if (chain[0]?.path !== "/") {
    const home = ROUTE_BY_PATH.get("/");
    if (home) chain.unshift(home);
  }
  return chain;
}


export interface BreadcrumbsProps {
  className?: string;
  /** Hide the breadcrumb on root or single-level pages. Default: true. */
  hideOnRoot?: boolean;
}

export function Breadcrumbs({ className, hideOnRoot = true }: BreadcrumbsProps) {
  const { pathname } = useLocation();
  const chain = useMemo(() => buildChain(pathname), [pathname]);

  if (hideOnRoot && chain.length <= 1) return null;

  return (
    <nav
      aria-label="Breadcrumb"
      className={cn(
        "flex items-center gap-1.5 text-sm text-muted-foreground overflow-x-auto whitespace-nowrap",
        className,
      )}
    >
      {chain.map((route, idx) => {
        const isLast = idx === chain.length - 1;
        const isHome = route.path === "/";
        return (
          <Fragment key={route.path}>
            {idx > 0 && <ChevronRight className="h-3.5 w-3.5 shrink-0 opacity-60" aria-hidden />}
            {isLast ? (
              <span
                aria-current="page"
                className="font-medium text-foreground inline-flex items-center gap-1"
              >
                {isHome && <Home className="h-3.5 w-3.5" aria-hidden />}
                {route.title}
              </span>
            ) : (
              <AppLink
                to={route.path}
                trackId={`breadcrumb:${route.path}`}
                trackLabel={route.title}
                className="hover:text-foreground transition-colors inline-flex items-center gap-1"
              >
                {isHome && <Home className="h-3.5 w-3.5" aria-hidden />}
                {isHome ? <span className="sr-only">Home</span> : route.title}
              </AppLink>
            )}
          </Fragment>
        );
      })}
    </nav>
  );
}

export default Breadcrumbs;
