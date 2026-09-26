import React from "react";
import { Sparkles, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

/**
 * AiAssistantPanel — Phase 2 (presentation shell only)
 * -------------------------------------------------------------
 * Visual shell that composes over existing AI/MCP services.
 * DOES NOT call any AI backend directly — callers wire onSubmit
 * to the existing AI service already registered in the app.
 */
export interface AiAssistantMessage {
  id: string;
  role: "user" | "assistant";
  content: React.ReactNode;
}

export interface AiAssistantPanelProps {
  title?: string;
  subtitle?: string;
  messages?: AiAssistantMessage[];
  placeholder?: string;
  disabled?: boolean;
  onSubmit?: (prompt: string) => void;
  suggestions?: string[];
  className?: string;
}

export function AiAssistantPanel({
  title = "AI Assistant",
  subtitle = "Ask anything about this workspace",
  messages = [],
  placeholder = "Ask a question or run a command…",
  disabled,
  onSubmit,
  suggestions = [],
  className,
}: AiAssistantPanelProps) {
  const [value, setValue] = React.useState("");

  const submit = () => {
    const v = value.trim();
    if (!v || !onSubmit) return;
    onSubmit(v);
    setValue("");
  };

  return (
    <aside
      className={cn(
        "enterprise-surface flex flex-col gap-4 p-5",
        "ring-1 ring-ai/20 shadow-ai",
        className,
      )}
      aria-label={title}
    >
      <header className="flex items-start gap-3">
        <div
          className="h-9 w-9 rounded-lg bg-gradient-ai grid place-items-center animate-ai-pulse shrink-0"
          aria-hidden="true"
        >
          <Sparkles className="h-4 w-4 text-ai-foreground" />
        </div>
        <div className="min-w-0">
          <div className="font-semibold text-sm text-foreground">{title}</div>
          <div className="text-xs text-muted-foreground">{subtitle}</div>
        </div>
      </header>

      <div
        className="flex-1 min-h-[160px] max-h-[320px] overflow-y-auto space-y-3 rounded-lg bg-muted/40 p-3"
        role="log"
        aria-live="polite"
      >
        {messages.length === 0 ? (
          <p className="text-xs text-muted-foreground italic">
            No conversation yet. Try a suggestion below.
          </p>
        ) : (
          messages.map((m) => (
            <div
              key={m.id}
              className={cn(
                "text-sm rounded-md px-3 py-2 max-w-[92%]",
                m.role === "assistant"
                  ? "bg-card text-card-foreground border border-border"
                  : "bg-primary text-primary-foreground ml-auto",
              )}
            >
              {m.content}
            </div>
          ))
        )}
      </div>

      {suggestions.length > 0 && (
        <ul className="flex flex-wrap gap-2" aria-label="Suggestions">
          {suggestions.map((s) => (
            <li key={s}>
              <button
                type="button"
                onClick={() => onSubmit?.(s)}
                className="text-xs px-2.5 py-1 rounded-full bg-secondary text-secondary-foreground hover:bg-ai/10 hover:text-ai transition-colors"
              >
                {s}
              </button>
            </li>
          ))}
        </ul>
      )}

      <form
        onSubmit={(e) => { e.preventDefault(); submit(); }}
        className="flex items-center gap-2"
      >
        <label htmlFor="ai-assistant-input" className="sr-only">Prompt</label>
        <Input
          id="ai-assistant-input"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={placeholder}
          disabled={disabled}
          className="h-10"
        />
        <Button
          type="submit"
          size="icon"
          disabled={disabled || !value.trim()}
          aria-label="Send prompt"
          className="bg-gradient-ai text-ai-foreground hover:opacity-90"
        >
          <Send className="h-4 w-4" aria-hidden="true" />
        </Button>
      </form>
    </aside>
  );
}

export default AiAssistantPanel;
