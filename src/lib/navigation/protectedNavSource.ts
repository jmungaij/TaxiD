/**
 * Discovery of PROTECTED portal navigation entries.
 *
 * The public header is not the whole navigation system: the authenticated admin
 * rail (business domains → YEOS workspaces) and the staff portal expose
 * hundreds of destinations behind a guard. This module enumerates them from the
 * same registries the app renders (`WORKSPACES`, `DOMAINS`) so the crawler can
 * resolve each entry to a canonical route, a capability and an RBAC envelope.
 *
 * Visibility roles are computed the way the sidebar computes them:
 *   - a workspace item inherits the workspace's `roles`
 *   - a domain `claim` inherits the domain's `roles`
 *   - an empty role list means "any authenticated user", which the contract
 *     treats as the widest possible audience.
 */
import { WORKSPACES } from "@/lib/workspaces/config";
import { DOMAINS } from "@/lib/navigation/domains";
import type { ProtectedNavInput } from "@/lib/navigation/navigationContract";

/** Roles that may reach any authenticated surface when none are declared. */
export const ANY_AUTHENTICATED = "__any_authenticated__";

export interface DiscoveredProtectedNav extends ProtectedNavInput {
  /** Owning business domain, when the entry is reachable from the rail. */
  domain?: string;
  /** True when a domain claims the path out of its owning workspace. */
  claimed: boolean;
}

export function discoverProtectedNav(): DiscoveredProtectedNav[] {
  const out: DiscoveredProtectedNav[] = [];
  const seen = new Set<string>();

  const push = (entry: DiscoveredProtectedNav) => {
    const key = `${entry.surface}::${entry.path}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push(entry);
  };

  /* Domain layer first: a claimed path is rendered ONLY in the claiming domain,
     so the claim is the authoritative surface for that destination. */
  const claimedPaths = new Set<string>();
  for (const domain of DOMAINS) {
    const roles = domain.roles.length ? [...domain.roles] : [ANY_AUTHENTICATED];
    push({
      path: domain.landing,
      label: `${domain.label} command dashboard`,
      surface: `domain(${domain.key})`,
      surfaceRoles: roles,
      domain: domain.key,
      claimed: false,
    });
    for (const claim of domain.claims ?? []) {
      for (const path of claim.paths) {
        claimedPaths.add(path.split("?")[0]);
        push({
          path,
          label: `${claim.section} — ${path}`,
          surface: `domain(${domain.key})`,
          surfaceRoles: roles,
          domain: domain.key,
          claimed: true,
        });
      }
    }
  }

  /* Workspace layer: overview + curated items. */
  const domainOfWorkspace = new Map<string, string>();
  for (const domain of DOMAINS) for (const ws of domain.workspaces) domainOfWorkspace.set(ws, domain.key);

  for (const ws of WORKSPACES) {
    const roles = ws.roles.length ? [...ws.roles] : [ANY_AUTHENTICATED];
    push({
      path: ws.overviewPath,
      label: `${ws.title} overview`,
      surface: `workspace(${ws.key})`,
      surfaceRoles: roles,
      domain: domainOfWorkspace.get(ws.key),
      claimed: false,
    });
    for (const item of ws.items) {
      push({
        path: item.path,
        label: item.label ?? item.path,
        surface: `workspace(${ws.key})`,
        surfaceRoles: roles,
        domain: domainOfWorkspace.get(ws.key),
        claimed: claimedPaths.has(item.path.split("?")[0]),
      });
    }
  }

  return out;
}
