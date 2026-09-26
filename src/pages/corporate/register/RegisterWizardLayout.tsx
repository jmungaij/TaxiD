// Shared layout for the corporate registration wizard.
// Renders the step tracker, resume/autosave status, and <Outlet /> for the
// current step. Routes: /corporate/register/(personal|business|verification|documents|review)
import { Outlet, NavLink, useNavigate, useLocation } from "react-router-dom";
import { useEffect } from "react";
import { STEP_LABELS, STEP_PATHS, useRegistrationDraft } from "./useRegistrationDraft";
import { Card } from "@/components/ui/card";
import { CheckCircle2, Circle, Loader2 } from "lucide-react";
import { RegistrationDraftContext } from "./context";

export default function RegisterWizardLayout() {
  const nav = useNavigate();
  const { pathname } = useLocation();
  const draftCtx = useRegistrationDraft();

  // If the draft is already submitted, applicants shouldn't be editing the
  // wizard — bounce them to the status page (avoids REG-409 on autosave).
  useEffect(() => {
    if (draftCtx.loading || !draftCtx.draft) return;
    if (draftCtx.draft.status && draftCtx.draft.status !== "draft") {
      // Preserve intent so the status page can show the "already submitted"
      // banner instead of silently redirecting.
      nav("/corporate/register/status?reason=already_submitted", { replace: true });
      return;
    }
    const inWizard = pathname.startsWith("/corporate/register/");
    if (!inWizard) return;
    const desired = STEP_PATHS[Math.max(0, (draftCtx.draft.current_step ?? 1) - 1)];
    if (desired && !pathname.endsWith(`/${desired}`)) {
      // Only redirect once on initial load — don't fight the user's navigation.
      const currentSlug = pathname.split("/").pop();
      if (currentSlug === "personal") nav(`/corporate/register/${desired}`, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftCtx.loading]);


  return (
    <RegistrationDraftContext.Provider value={draftCtx}>
      <main className="min-h-screen bg-background">
        <div className="container mx-auto max-w-5xl px-4 py-10">
          <header className="mb-8 text-center">
            <h1 className="text-3xl font-semibold tracking-tight">Yalla Mobility Corporate</h1>
            <p className="text-sm text-muted-foreground mt-1">
              Register your organization to manage employee travel, packages, and mobility.
            </p>
          </header>

          <ol className="mb-8 grid grid-cols-1 gap-2 md:grid-cols-5" aria-label="Registration progress">
            {STEP_PATHS.map((slug, idx) => {
              const stepNum = idx + 1;
              const done = draftCtx.draft?.completed_steps?.includes(stepNum);
              const active = pathname.endsWith(`/${slug}`);
              return (
                <li key={slug}>
                  <NavLink
                    to={`/corporate/register/${slug}`}
                    className={`flex items-center gap-2 rounded-lg border p-3 text-sm transition
                      ${active ? "border-primary bg-primary/5 text-foreground" : "border-border text-muted-foreground hover:border-primary/40"}`}
                    aria-current={active ? "step" : undefined}
                  >
                    {done ? (
                      <CheckCircle2 className="h-4 w-4 text-primary" aria-hidden />
                    ) : (
                      <Circle className="h-4 w-4" aria-hidden />
                    )}
                    <span className="font-medium">Step {stepNum}</span>
                    <span className="hidden md:inline text-xs">· {STEP_LABELS[stepNum]}</span>
                  </NavLink>
                </li>
              );
            })}
          </ol>

          <Card className="p-6 md:p-8">
            <Outlet />
          </Card>

          <p className="mt-4 text-center text-xs text-muted-foreground" aria-live="polite">
            {draftCtx.saving ? (
              <span className="inline-flex items-center gap-1"><Loader2 className="h-3 w-3 animate-spin" aria-hidden /> Saving…</span>
            ) : draftCtx.lastSavedAt ? (
              <>Autosaved at {draftCtx.lastSavedAt.toLocaleTimeString()}. You can safely close this page and resume later.</>
            ) : draftCtx.loading ? (
              <>Loading your draft…</>
            ) : (
              <>Your progress is autosaved on this device. Resume any time from this link.</>
            )}
          </p>
        </div>
      </main>
    </RegistrationDraftContext.Provider>
  );
}
