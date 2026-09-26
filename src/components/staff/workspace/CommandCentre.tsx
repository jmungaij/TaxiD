/**
 * STAGE 7 — COMMAND CENTRE (Ctrl/Cmd + K).
 *
 * A single keyboard entry point over the authoritative index built in
 * commandCentre.ts. Selecting a result navigates to the system of record. When
 * a domain is withheld from the account, the palette says so rather than
 * returning a partial list silently.
 */
import * as React from "react";
import { useNavigate } from "react-router-dom";
import { Braces, CalendarDays, FileSignature, FileText, ListChecks, Mail, Target } from "lucide-react";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command";
import { Badge } from "@/components/ui/badge";
import { searchCommands, type CommandEntry, type CommandKind } from "@/lib/workspace/commandCentre";

const ICON: Record<CommandKind, React.ComponentType<{ className?: string }>> = {
  opportunity: Target,
  quote: FileText,
  contract: FileSignature,
  meeting: CalendarDays,
  email: Mail,
  work: ListChecks,
  destination: Braces,
};

export function useCommandCentre() {
  const [open, setOpen] = React.useState(false);
  React.useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() === "k" && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        setOpen((v) => !v);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  return { open, setOpen };
}

export interface CommandCentreProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  index: CommandEntry[];
  /** Domains withheld by access control — declared, never estimated. */
  blindSpots?: string[];
  loading?: boolean;
}

export function CommandCentre({ open, onOpenChange, index, blindSpots = [], loading }: CommandCentreProps) {
  const navigate = useNavigate();
  const [query, setQuery] = React.useState("");
  const groups = React.useMemo(() => searchCommands(index, query), [index, query]);

  React.useEffect(() => {
    if (!open) setQuery("");
  }, [open]);

  const go = (to: string) => {
    onOpenChange(false);
    navigate(to);
  };

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange}>
      <CommandInput
        placeholder="Search mail, opportunities, quotes, contracts, meetings and your work…"
        value={query}
        onValueChange={setQuery}
      />
      <CommandList>
        <CommandEmpty>
          {loading
            ? "Reading your records…"
            : "No record in your book matches that. Nothing is guessed here — try a customer name, a quote number or a stage."}
        </CommandEmpty>
        {groups.map((group, groupIndex) => (
          <React.Fragment key={group.kind}>
            {groupIndex > 0 && <CommandSeparator />}
            <CommandGroup heading={group.label}>
              {group.entries.map((entry) => {
                const Icon = ICON[entry.kind];
                return (
                  <CommandItem key={entry.id} value={`${entry.label} ${entry.keywords.join(" ")}`} onSelect={() => go(entry.to)}>
                    <Icon className="mr-2 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                    <span className="min-w-0 flex-1 truncate">
                      {entry.label}
                      {entry.sublabel && <span className="ml-2 text-xs text-muted-foreground">{entry.sublabel}</span>}
                    </span>
                    {entry.tag && (
                      <Badge variant="outline" className="ml-2 shrink-0 text-[10px]">
                        {entry.tag}
                      </Badge>
                    )}
                  </CommandItem>
                );
              })}
            </CommandGroup>
          </React.Fragment>
        ))}
        {blindSpots.length > 0 && (
          <div className="border-t px-3 py-2 text-xs text-muted-foreground">
            Not searchable on this account: {blindSpots.join(", ")} — ask an administrator for commercial read access.
          </div>
        )}
      </CommandList>
    </CommandDialog>
  );
}
