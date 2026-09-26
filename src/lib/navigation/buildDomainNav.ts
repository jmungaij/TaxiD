/**
 * Folds the role/tier-filtered YEOS workspace groups into the eight business
 * domains rendered by the sidebar. Pure function — no data fetching, no routing
 * side effects, so it is unit-testable and cannot invent destinations.
 */
import { DOMAINS, CLAIMED_PATHS, type DomainDefinition } from "./domains";
import type { WorkspaceDefinition } from "@/lib/workspaces/types";

export interface DomainNavItem {
  path: string;
  label: string;
  icon?: string;
  section: string;
}

export interface DomainNavGroup {
  domain: DomainDefinition;
  items: DomainNavItem[];
}

export interface VisibleWorkspaceGroup {
  workspace: WorkspaceDefinition;
  items: { path: string; label: string; icon?: string; section?: string }[];
}

export function buildDomainNav(
  groups: VisibleWorkspaceGroup[],
  roles: string[],
): DomainNavGroup[] {
  const byPath = new Map<string, DomainNavItem>();
  for (const g of groups) {
    for (const it of g.items) {
      if (byPath.has(it.path)) continue;
      byPath.set(it.path, {
        path: it.path,
        label: it.label,
        icon: it.icon,
        section: it.section ?? g.workspace.title,
      });
    }
  }
  const groupByKey = new Map(groups.map((g) => [g.workspace.key, g]));

  const result: DomainNavGroup[] = [];
  for (const domain of DOMAINS) {
    if (domain.roles.length > 0 && !domain.roles.some((r) => roles.includes(r))) continue;

    const items: DomainNavItem[] = [];

    // 1. Explicitly claimed destinations (one feature → one canonical location).
    for (const claim of domain.claims ?? []) {
      for (const path of claim.paths) {
        const item = byPath.get(path);
        if (item) items.push({ ...item, section: claim.section });
      }
    }

    // 2. Whole workspaces absorbed by this domain, minus anything claimed
    //    elsewhere so no destination is duplicated across the rail.
    const multi = domain.workspaces.length > 1;
    for (const key of domain.workspaces) {
      const group = groupByKey.get(key);
      if (!group) continue;
      for (const it of group.items) {
        if (CLAIMED_PATHS.has(it.path)) continue;
        items.push({
          path: it.path,
          label: it.label,
          icon: it.icon,
          section: multi ? group.workspace.title : (it.section ?? group.workspace.title),
        });
      }
    }

    if (items.length === 0) continue;
    result.push({ domain, items });
  }
  return result;
}
