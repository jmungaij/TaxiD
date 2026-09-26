import { useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import { supabase } from "@/integrations/supabase/client";
import RestrictedMarkdown from "@/components/marketing/RestrictedMarkdown";

/**
 * Instance-configurable onboarding message.
 *
 * Read from `public_onboarding_message()` — a read-only routine that exposes
 * exactly one field of platform settings to unauthenticated visitors. The
 * content is rendered through the restricted Markdown pipeline (React nodes,
 * never raw HTML). When the setting is empty this component renders nothing,
 * leaving the existing onboarding experience untouched.
 */
export function OnboardingWelcome({ className }: { className?: string }) {
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    supabase
      .rpc("public_onboarding_message")
      .then(({ data }) => {
        if (active && typeof data === "string" && data.trim()) setMessage(data);
      });
    return () => { active = false; };
  }, []);

  if (!message) return null;

  return (
    <Card className={`border-primary/30 bg-primary/5 p-5 ${className ?? ""}`}>
      <RestrictedMarkdown source={message} />
    </Card>
  );
}

export default OnboardingWelcome;
