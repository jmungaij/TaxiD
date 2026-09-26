/**
 * Global Cmd+K command palette.
 *
 * Authorization is enforced SERVER-SIDE by the `command-palette-search` edge
 * function. The client sends every visible entry to the function; the
 * function returns only entries the user's role + capability matrix allows
 * and writes denials to `command_access_logs` / `command_denials` /
 * `access_denials` (hash-chained). The previous client-side role filter is
 * removed.
 */
import * as React from "react";
import { useNavigate } from "react-router-dom";
import {
  CommandDialog, CommandEmpty, CommandGroup, CommandInput,
  CommandItem, CommandList, CommandSeparator,
} from "@/components/ui/command";
import { searchableEntries, type NavMeta } from "@/lib/navigation-registry";
import { supabase } from "@/integrations/supabase/client";
import { getDeviceId } from "@/lib/sessionContext";
import { trackCta } from "@/lib/cta";

type Result = { path: string; title: string; group: string; section: string | null };

export function CommandPalette() {
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState("");
  const [results, setResults] = React.useState<Result[]>([]);
  const navigate = useNavigate();

  React.useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen(v => !v);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  // Build the full client-side catalog once; ABAC happens on the server.
  const entries = React.useMemo<NavMeta[]>(() => searchableEntries(), []);

  React.useEffect(() => {
    if (!open) return;
    let cancelled = false;
    const t = window.setTimeout(async () => {
      try {
        const { data, error } = await supabase.functions.invoke<{
          results: Result[];
        }>("command-palette-search", {
          body: {
            query,
            entries: entries.map(e => ({
              path: e.path,
              title: e.title,
              group: e.group,
              section: e.section ?? null,
              required_roles: e.roles ?? [],
              required_capabilities: [],
              keywords: e.keywords ?? [],
            })),
            context: { device_id: getDeviceId() },
          },
        });
        if (cancelled) return;
        if (error || !data) { setResults([]); return; }
        setResults(data.results ?? []);
      } catch { if (!cancelled) setResults([]); }
    }, 150);
    return () => { cancelled = true; window.clearTimeout(t); };
  }, [query, open, entries]);

  const grouped = React.useMemo(() => {
    const g: Record<string, Result[]> = {};
    for (const r of results) {
      const key = r.group === "admin" && r.section ? `Admin · ${r.section}` :
                  r.group.charAt(0).toUpperCase() + r.group.slice(1);
      (g[key] ??= []).push(r);
    }
    return g;
  }, [results]);

  const go = (r: Result) => {
    setOpen(false);
    void trackCta({ buttonName: `cmdk_${r.path}`, actionType: "navigate", target: r.path });
    navigate(r.path);
  };

  return (
    <CommandDialog open={open} onOpenChange={setOpen}>
      <CommandInput
        placeholder="Search pages, sections, actions…  (⌘K)"
        value={query}
        onValueChange={setQuery}
      />
      <CommandList>
        <CommandEmpty>No authorized results.</CommandEmpty>
        {Object.entries(grouped).map(([group, items], i) => (
          <React.Fragment key={group}>
            {i > 0 && <CommandSeparator />}
            <CommandGroup heading={group}>
              {items.map(r => (
                <CommandItem
                  key={r.path}
                  value={`${r.title} ${r.path}`}
                  onSelect={() => go(r)}
                >
                  <span className="flex-1">{r.title}</span>
                  <span className="text-xs text-muted-foreground">{r.path}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          </React.Fragment>
        ))}
      </CommandList>
    </CommandDialog>
  );
}
