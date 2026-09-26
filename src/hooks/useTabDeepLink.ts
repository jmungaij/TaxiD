import { useCallback, useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";

/**
 * Deep-linkable tabs with accessible in-page navigation.
 *
 * - Reads `?tab=` (and `#section`) on mount so CTAs from other pages can
 *   auto-activate the right tab and scroll to the matching section.
 * - `goTo(tab, sectionId)` activates a tab, updates the URL, smooth-scrolls to
 *   the section and moves keyboard focus to it (focus management for a11y).
 */
export function useTabDeepLink(tabs: readonly string[], fallback: string) {
  const location = useLocation();
  const navigate = useNavigate();
  const initial = (() => {
    const param = new URLSearchParams(location.search).get("tab");
    return param && tabs.includes(param) ? param : fallback;
  })();
  const [tab, setTab] = useState(initial);

  const scrollToSection = useCallback((sectionId?: string) => {
    if (!sectionId) return;
    // Wait a frame so the newly activated tab panel is mounted.
    requestAnimationFrame(() => {
      const el = document.getElementById(sectionId);
      if (!el) return;
      const prefersReduced = window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;
      el.scrollIntoView({ behavior: prefersReduced ? "auto" : "smooth", block: "start" });
      if (!el.hasAttribute("tabindex")) el.setAttribute("tabindex", "-1");
      el.focus({ preventScroll: true });
    });
  }, []);

  // Respond to tab/hash changes coming from the URL (deep links, back button).
  useEffect(() => {
    const param = new URLSearchParams(location.search).get("tab");
    if (param && tabs.includes(param) && param !== tab) setTab(param);
    const hash = location.hash.replace("#", "");
    if (hash) scrollToSection(hash);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.search, location.hash]);

  const goTo = useCallback(
    (nextTab: string, sectionId?: string) => {
      if (tabs.includes(nextTab)) setTab(nextTab);
      navigate(
        { pathname: location.pathname, search: `?tab=${nextTab}`, hash: sectionId ? `#${sectionId}` : "" },
        { replace: false },
      );
      scrollToSection(sectionId);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [location.pathname, navigate, scrollToSection],
  );

  const onTabChange = useCallback(
    (next: string) => {
      setTab(next);
      navigate({ pathname: location.pathname, search: `?tab=${next}`, hash: "" }, { replace: true });
    },
    [location.pathname, navigate],
  );

  return { tab, setTab, onTabChange, goTo, scrollToSection };
}
