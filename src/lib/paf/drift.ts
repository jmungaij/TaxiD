/**
 * Policy drift detection — compares the latest paf_runs snapshot with the
 * previous one and surfaces new tables, dropped policies, changed grants,
 * added realtime publications, and shifting SECURITY DEFINER surface area.
 */
export interface DriftSnapshot {
  tables: string[];
  policies: Array<{ table: string; name: string; qual: string; with_check: string }>;
  realtime_publication: string[];
  security_definer: string[];
  grants: Record<string, string[]>;
}

export interface DriftReport {
  new_tables: string[];
  removed_tables: string[];
  new_policies: string[];
  removed_policies: string[];
  changed_policies: string[];
  new_realtime: string[];
  removed_realtime: string[];
  new_definer: string[];
  changed_grants: Array<{ table: string; before: string[]; after: string[] }>;
}

export function toSnapshot(inv: any): DriftSnapshot {
  return {
    tables: (inv.tables ?? []).map((t: any) => t.name).sort(),
    policies: (inv.policies ?? []).map((p: any) => ({
      table: p.table, name: p.name, qual: p.qual ?? "", with_check: p.with_check ?? "",
    })),
    realtime_publication: (inv.realtime_publication ?? []).slice().sort(),
    security_definer: (inv.security_definer ?? []).map((d: any) => d.name).sort(),
    grants: inv.grants ?? {},
  };
}

export function computeDrift(prev: DriftSnapshot | null, next: DriftSnapshot): DriftReport {
  const p = prev ?? { tables: [], policies: [], realtime_publication: [], security_definer: [], grants: {} };
  const prevPolKeys = new Set(p.policies.map((x) => `${x.table}.${x.name}`));
  const nextPolKeys = new Set(next.policies.map((x) => `${x.table}.${x.name}`));
  const changedPolicies: string[] = [];
  for (const np of next.policies) {
    const match = p.policies.find((x) => x.table === np.table && x.name === np.name);
    if (match && (match.qual !== np.qual || match.with_check !== np.with_check)) {
      changedPolicies.push(`${np.table}.${np.name}`);
    }
  }
  const changedGrants: DriftReport["changed_grants"] = [];
  const allTables = new Set([...Object.keys(p.grants), ...Object.keys(next.grants)]);
  for (const t of allTables) {
    const a = (p.grants[t] ?? []).slice().sort();
    const b = (next.grants[t] ?? []).slice().sort();
    if (JSON.stringify(a) !== JSON.stringify(b)) changedGrants.push({ table: t, before: a, after: b });
  }
  return {
    new_tables: next.tables.filter((t) => !p.tables.includes(t)),
    removed_tables: p.tables.filter((t) => !next.tables.includes(t)),
    new_policies: [...nextPolKeys].filter((k) => !prevPolKeys.has(k)),
    removed_policies: [...prevPolKeys].filter((k) => !nextPolKeys.has(k)),
    changed_policies: changedPolicies,
    new_realtime: next.realtime_publication.filter((t) => !p.realtime_publication.includes(t)),
    removed_realtime: p.realtime_publication.filter((t) => !next.realtime_publication.includes(t)),
    new_definer: next.security_definer.filter((f) => !p.security_definer.includes(f)),
    changed_grants: changedGrants,
  };
}
