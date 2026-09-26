/**
 * KEYBOARD SHORTCUT HELP — the cockpit is operable without the mouse, so the
 * keys have to be discoverable. Opens on `?` (or the header button) and lists
 * exactly the shortcuts My Workspace binds, with the condition each one needs.
 */
import * as React from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Keyboard } from "lucide-react";

export interface ShortcutRow {
  keys: string;
  action: string;
  when: string;
}

export const COCKPIT_SHORTCUTS: ShortcutRow[] = [
  { keys: "F", action: "Start Focus Mode on the recommended work", when: "No session running" },
  { keys: "E", action: "End the running session and record effort", when: "Session running" },
  { keys: "R", action: "Resolve the top blocked item", when: "Something is blocked" },
  { keys: "D", action: "Request a decision on the top blocked item", when: "Something is blocked" },
  { keys: "?", action: "Show or hide this shortcut list", when: "Any time" },
];

/** Binds `?` to a toggle, ignoring keystrokes typed into fields. */
export function useShortcutHelpToggle(): [boolean, (v: boolean) => void] {
  const [open, setOpen] = React.useState(false);
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const el = e.target as HTMLElement | null;
      if (el && (el.isContentEditable || /^(input|textarea|select)$/i.test(el.tagName))) return;
      if (e.key !== "?") return;
      e.preventDefault();
      setOpen((v) => !v);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  return [open, setOpen];
}

export function ShortcutHelpOverlay({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg" data-testid="shortcut-help-overlay">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Keyboard className="h-4 w-4 text-primary" aria-hidden /> Keyboard shortcuts
          </DialogTitle>
          <DialogDescription>
            Shortcuts stay inert while you are typing, so they never fire mid-sentence.
          </DialogDescription>
        </DialogHeader>
        <ul className="divide-y">
          {COCKPIT_SHORTCUTS.map((s) => (
            <li key={s.keys} className="flex items-start justify-between gap-4 py-2.5">
              <div>
                <p className="text-sm font-medium">{s.action}</p>
                <p className="text-xs text-muted-foreground">{s.when}</p>
              </div>
              <kbd className="rounded border bg-muted px-2 py-1 font-mono text-xs font-semibold">
                {s.keys}
              </kbd>
            </li>
          ))}
        </ul>
      </DialogContent>
    </Dialog>
  );
}

export default ShortcutHelpOverlay;
