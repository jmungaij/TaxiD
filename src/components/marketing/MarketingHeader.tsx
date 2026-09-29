import { useEffect, useRef, useState } from "react";
import { Link, NavLink, useLocation } from "react-router-dom";
import { Menu, X, ChevronDown, ChevronLeft, ChevronRight, Smartphone, LogIn, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { appLink } from "@/lib/appLinks";
import { trackAppDownload } from "@/lib/appDownloadTracking";
import BrandLogo from "@/components/brand/BrandLogo";
import {
  buildPrimaryNav,
  isNavItemActive,
  trackNavClick,
  GET_STARTED,
  navHref,
  SIGN_IN_GROUPS,
  STAFF_ACCESS,
  type NavChild,
  type NavItem,

} from "@/lib/navigation/primaryNav";

// Mega-menu placements (attributed separately from the header dropdown).
const RIDER_ANDROID_URL = appLink({ audience: "rider", platform: "android", placement: "mega_menu_ride" });
const RIDER_IOS_URL = appLink({ audience: "rider", platform: "ios", placement: "mega_menu_ride" });
const DRIVER_ANDROID_URL = appLink({ audience: "driver", platform: "android", placement: "mega_menu_drive" });
const DRIVER_IOS_URL = appLink({ audience: "driver", platform: "ios", placement: "mega_menu_drive" });

// Header "Get the App" dropdown placements.
const HEADER_RIDER_ANDROID = appLink({ audience: "rider", platform: "android", placement: "header" });
const HEADER_DRIVER_ANDROID = appLink({ audience: "driver", platform: "android", placement: "header" });

const nav = buildPrimaryNav({
  riderAndroid: RIDER_ANDROID_URL,
  riderIos: RIDER_IOS_URL,
  driverAndroid: DRIVER_ANDROID_URL,
  driverIos: DRIVER_IOS_URL,
});

/**
 * Panels are viewport-clamped: `min()` keeps wide panels inside narrow laptop
 * viewports instead of overflowing the window, and the column count degrades
 * gracefully so no group is ever clipped.
 */
const PANEL_WIDTH: Record<number, string> = {
  2: "w-[min(600px,calc(100vw-3rem))] grid grid-cols-2 gap-6",
  3: "w-[min(860px,calc(100vw-3rem))] grid grid-cols-2 lg:grid-cols-3 gap-6",
  4: "w-[min(1080px,calc(100vw-3rem))] grid grid-cols-2 xl:grid-cols-4 gap-5",
};


const MarketingHeader = () => {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState<string | null>(null);
  const [mobileCategory, setMobileCategory] = useState<NavItem | null>(null);

  const [appOpen, setAppOpen] = useState(false);
  const [signInOpen, setSignInOpen] = useState(false);
  const { pathname, search } = useLocation();
  const [isScrolled, setIsScrolled] = useState(false);
  // Keyboard navigation: triggers are refocused on Escape, panels receive focus
  // when a category is opened with Enter/Space/ArrowDown.
  const triggerRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const panelRefs = useRef<Record<string, HTMLDivElement | null>>({});
  /**
   * Hover intent. Wide (4-column) panels are centred under the header rather
   * than anchored to their trigger, so the pointer necessarily crosses header
   * chrome that belongs to neither the trigger nor the panel. Closing on the
   * first `mouseleave` made those panels unreachable — the panel disappeared
   * the moment the pointer left the trigger. A short close delay (cancelled by
   * re-entering either the trigger or the panel) keeps the menu reachable while
   * still closing promptly on a genuine exit.
   */
  const closeTimer = useRef<number | null>(null);
  const cancelClose = () => {
    if (closeTimer.current !== null) {
      window.clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
  };
  const openMenu = (label: string) => {
    cancelClose();
    setActive(label);
  };
  const scheduleClose = () => {
    cancelClose();
    closeTimer.current = window.setTimeout(() => setActive(null), 240);
  };
  useEffect(() => cancelClose, []);


  // Glass navigation: transparent at rest, ultra-thin frosted glass on scroll.
  useEffect(() => {
    const onScroll = () => setIsScrolled(window.scrollY > 24);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  // A navigation dismisses any open panel, regardless of the pending close timer.
  useEffect(() => {
    cancelClose();
    setActive(null);
  }, [pathname, search]);


  const renderChild = (section: string, c: NavChild, surface: "desktop" | "mobile" = "desktop") => {
    const isActive = isNavItemActive(c.to, pathname, search);
    const base = cn(
      "block rounded-md px-2 py-2 transition-colors",
      isActive ? "bg-primary/10" : "hover:bg-muted",
    );
    const body = (
      <>
        <div className={cn("text-sm font-medium flex items-center gap-1.5", isActive ? "text-primary" : "text-foreground")}>
          {c.label}
          {c.requiresAuth && (
            <span className="text-[9px] uppercase tracking-wide text-muted-foreground/70">Sign in</span>
          )}
        </div>
        {c.desc && <div className="text-xs text-muted-foreground mt-0.5">{c.desc}</div>}
      </>
    );
    return c.external ? (
      <a
        key={c.to + c.label}
        href={c.to}
        target="_blank"
        rel="noreferrer"
        className={base}
        onClick={() => trackNavClick(section, c, surface)}
      >
        {body}
      </a>
    ) : (
      <Link
        key={c.to + c.label}
        to={navHref(c)}
        aria-current={isActive ? "page" : undefined}
        aria-label={c.requiresAuth ? `${c.label} — sign in required` : undefined}
        className={base}
        onClick={() => trackNavClick(section, c, surface)}
      >
        {body}
      </Link>
    );
  };


  return (
    <header
      className={cn(
        "sticky top-0 z-50 w-full border-b transition-[border-color,box-shadow] duration-500 ease-enterprise-out",
        "text-nav-foreground bg-nav-strong",
        isScrolled ? "border-nav-border/70 shadow-[var(--shadow-md)]" : "border-nav-border/40",
      )}
    >

      <div className="container mx-auto flex h-16 items-center justify-between px-4">
        <Link to="/" className="flex items-center" aria-label="TaxiD home">
          <BrandLogo
            tone="light"
            priority
            className="h-7 sm:h-8 md:h-9 max-w-[170px]"
          />
        </Link>

        <nav className="hidden xl:flex items-center gap-0.5" aria-label="Primary">
          {nav.map((item, navIndex) => {
            if (item.groups) {
              const isOpen = active === item.label;
              const panelId = `nav-panel-${item.label.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}`;
              const cols = item.cols ?? Math.min(4, item.groups.length);
              const sectionActive = item.groups.some((g) =>
                g.items.some((c) => isNavItemActive(c.to, pathname, search)),
              );
              return (
                <div
                  key={item.label}
                  className="relative"
                  onMouseEnter={() => openMenu(item.label)}
                  onMouseLeave={scheduleClose}
                  // Keyboard users open the panel by focusing the trigger, so a
                  // focus entering the group must cancel any pending close.
                  onFocus={() => cancelClose()}
                  // Close only when focus genuinely leaves the trigger *and* the
                  // panel — tabbing between links inside the panel must not close
                  // it, which is why this checks the incoming focus target rather
                  // than closing on every blur.
                  onBlur={(e) => {
                    const next = e.relatedTarget as Node | null;
                    if (next && e.currentTarget.contains(next)) return;
                    cancelClose();
                    setActive(null);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Escape") {
                      cancelClose();
                      setActive(null);
                      triggerRefs.current[item.label]?.focus();
                      return;
                    }
                    if (e.key === "Tab") return; // native order is correct
                    const panel = panelRefs.current[item.label];
                    const links = panel
                      ? Array.from(panel.querySelectorAll<HTMLAnchorElement>("a[href]"))
                      : [];
                    if (links.length === 0) return;
                    const idx = links.indexOf(document.activeElement as HTMLAnchorElement);
                    const focusAt = (i: number) => {
                      e.preventDefault();
                      links[(i + links.length) % links.length].focus();
                    };
                    // Roving arrow navigation inside the open panel.
                    if (idx >= 0 && (e.key === "ArrowDown" || e.key === "ArrowRight")) focusAt(idx + 1);
                    else if (idx >= 0 && (e.key === "ArrowUp" || e.key === "ArrowLeft")) focusAt(idx - 1);
                    else if (e.key === "Home") focusAt(0);
                    else if (e.key === "End") focusAt(links.length - 1);
                    else if (idx === 0 && e.key === "ArrowUp") {
                      e.preventDefault();
                      triggerRefs.current[item.label]?.focus();
                    }
                  }}
                >

                  <button
                    type="button"
                    ref={(el) => { triggerRefs.current[item.label] = el; }}
                    aria-haspopup="true"
                    aria-expanded={isOpen}
                    aria-controls={isOpen ? panelId : undefined}
                    aria-current={sectionActive ? "true" : undefined}
                    aria-label={`${item.label}${sectionActive ? " — current section" : ""}`}
                    onClick={() => (isOpen ? (cancelClose(), setActive(null)) : openMenu(item.label))}
                    onKeyDown={(e) => {
                      if (e.key === "ArrowDown" || e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        setActive(item.label);
                        // Move focus into the panel on the next paint.
                        requestAnimationFrame(() => {
                          panelRefs.current[item.label]
                            ?.querySelector<HTMLAnchorElement>("a[href]")
                            ?.focus();
                        });
                      }
                    }}
                    className={cn(
                      "relative px-2.5 py-2 text-[13px] font-medium rounded-md inline-flex items-center gap-1 whitespace-nowrap focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring transition-colors",
                      sectionActive || isOpen
                        ? "text-nav-foreground bg-nav-foreground/15"
                        : "text-nav-foreground/80 hover:text-nav-foreground hover:bg-nav-foreground/10",
                      // Active-section indicator: a persistent underline that
                      // survives hover/open state changes.
                      sectionActive &&
                        "after:absolute after:inset-x-2 after:-bottom-0.5 after:h-0.5 after:rounded-full after:bg-nav-accent",
                    )}
                  >
                    {item.label} <ChevronDown className="h-3 w-3" aria-hidden />
                  </button>

                  {isOpen && (
                    <div
                      id={panelId}
                      ref={(el) => { panelRefs.current[item.label] = el; }}
                      role="group"
                      aria-label={item.label}
                      onMouseEnter={() => openMenu(item.label)}
                      onMouseLeave={scheduleClose}
                      className={cn(
                        "pt-2",
                        // Four-column panels are wider than the space between a
                        // late trigger and the viewport's left edge, so they are
                        // centred under the header instead of anchored to the
                        // trigger — otherwise the first column renders off-screen.
                        // The centred variant spans the viewport as a
                        // pointer-transparent shell with a full-width hover
                        // bridge, so travelling from the trigger to a panel that
                        // is not directly beneath it never crosses dead space.
                        cols >= 4
                          ? "fixed left-0 right-0 top-16 flex justify-center pointer-events-none"
                          : cn("absolute top-full", navIndex >= nav.length / 2 ? "right-0" : "left-0"),
                      )}
                    >
                      {cols >= 4 && (
                        <div
                          aria-hidden
                          className="pointer-events-auto absolute inset-x-0 top-0 h-3"
                          onMouseEnter={() => openMenu(item.label)}
                        />
                      )}
                      <div className={cn(
                        "rounded-2xl border border-border bg-popover/95 backdrop-blur-xl shadow-2xl p-5 max-w-[calc(100vw-2rem)]",
                        cols >= 4 && "pointer-events-auto",
                      )}>

                        {item.desc && (
                          <div className="mb-4 flex items-start justify-between gap-6 border-b border-border pb-3">
                            <div>
                              <div className="text-sm font-semibold text-foreground">{item.label}</div>
                              <p className="mt-0.5 text-xs text-muted-foreground max-w-xl">{item.desc}</p>
                            </div>
                            {item.featured && (
                              <Link
                                to={navHref(item.featured as NavChild)}
                                onClick={() => trackNavClick(item.label, item.featured as NavChild, "desktop")}
                                className={/* brand-allow-orange: conversion CTA */ "shrink-0 inline-flex items-center gap-1.5 rounded-lg bg-signal px-3 py-2 text-xs font-semibold text-signal-foreground hover:bg-signal/90"}
                              >
                                {item.featured.label}
                                <ArrowRight className="h-3.5 w-3.5" aria-hidden />
                              </Link>
                            )}
                          </div>
                        )}
                        <div className={cn(PANEL_WIDTH[cols] ?? PANEL_WIDTH[3])}>
                          {item.groups.map((g, gi) => (
                            <div key={gi}>
                              {g.heading && (
                                <div className="px-2 pb-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                                  {g.heading}
                                </div>
                              )}
                              {g.items.map((c) => renderChild(item.label, c))}
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  )}

                </div>
              );
            }
            return (
              <NavLink
                key={item.to}
                to={item.to!}
                className={({ isActive }) =>
                  cn(
                    "px-2.5 py-2 text-[13px] font-medium rounded-md transition-colors",
                    isActive
                      ? "text-nav-foreground bg-nav-foreground/15"
                      : "text-nav-foreground/80 hover:text-nav-foreground hover:bg-nav-foreground/10",
                  )
                }
              >
                {item.label}
              </NavLink>
            );
          })}
        </nav>

        <div className="hidden md:flex min-w-0 shrink items-center gap-2">
          {/* Resources → Staff Access → Sign In. The formal gateway into the
              authenticated staff environment; authority is resolved server-side.
              Held back until 2xl so the action cluster never pushes the brand
              bar past the viewport at 1024–1440. */}
          <NavLink
            to={STAFF_ACCESS.to}
            data-analytics="header_staff_access"
            onClick={() => trackNavClick("Staff Access", STAFF_ACCESS, "desktop")}
            className={({ isActive }) =>
              cn(
                "hidden 2xl:inline-flex px-2.5 py-2 text-[13px] font-medium rounded-md transition-colors",
                isActive
                  ? "text-nav-foreground bg-nav-foreground/15"
                  : "text-nav-foreground/80 hover:text-nav-foreground hover:bg-nav-foreground/10",
              )
            }
          >

            {STAFF_ACCESS.label}
          </NavLink>
          <div
            className="relative"
            onMouseEnter={() => setSignInOpen(true)}
            onMouseLeave={() => setSignInOpen(false)}
          >
            <Button
              variant="ghost"
              size="sm"
              type="button"
              aria-haspopup="menu"
              aria-expanded={signInOpen}
              onClick={() => setSignInOpen((o) => !o)}
              className="gap-1.5 text-nav-foreground hover:bg-nav-foreground/10 hover:text-nav-foreground"
            >
              <LogIn className="h-4 w-4" aria-hidden /> Sign In
              <ChevronDown className="h-3 w-3" aria-hidden />
            </Button>
            {signInOpen && (
              <div className="absolute right-0 top-full pt-2">
                <div className="w-[22rem] rounded-2xl border border-border bg-popover/95 backdrop-blur-xl shadow-2xl p-3" role="menu" aria-label="Sign in">
                  <div className="px-2 pb-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                    How do you use TaxiD?
                  </div>
                  <div className="space-y-2">
                    {SIGN_IN_GROUPS.map((g) => (
                      <div key={g.key}>
                        <div className="px-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground/80">
                          {g.heading}
                        </div>
                        {g.items.map((c) => renderChild("Sign In", c))}
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>
          <Button
            asChild
            size="sm"
            variant="outline"
            className="border-nav-foreground/30 bg-transparent text-nav-foreground hover:bg-nav-foreground/10 hover:text-nav-foreground"
          >
            <Link to={GET_STARTED.to} data-analytics="header_get_started">{GET_STARTED.label}</Link>
          </Button>
          <div
            className="relative hidden 2xl:block"

            onMouseEnter={() => setAppOpen(true)}
            onMouseLeave={() => setAppOpen(false)}
          >
            <Button
              size="sm"
              type="button"
              aria-expanded={appOpen}
              aria-haspopup="menu"
              data-analytics="header_get_the_app"
              onClick={() => setAppOpen((o) => !o)}
              className={/* brand-allow-orange: conversion CTA */ "bg-signal text-signal-foreground hover:bg-signal/90 shadow-enterprise gap-1.5"}
            >
              <Smartphone className="h-4 w-4" />
              Get the App
              <ChevronDown className="h-3 w-3" />
            </Button>

            {appOpen && (
              <div className="absolute right-0 top-full pt-2">
                <div className="w-80 rounded-xl border border-border bg-popover shadow-xl p-4 space-y-3">
                  <div>
                    <div className="text-sm font-semibold text-foreground">Rider App</div>
                    <div className="text-xs text-muted-foreground mb-2">
                      Book rides, rentals and deliveries.
                    </div>
                    <div className="flex gap-2">
                       <a href={HEADER_RIDER_ANDROID} target="_blank" rel="noreferrer" onClick={() => trackAppDownload("rider", "header")} className="inline-flex items-center gap-1 text-xs px-3 py-1.5 rounded-md border border-border hover:bg-muted">
                        <Smartphone className="h-3.5 w-3.5" /> Get Rider on Google Play
                      </a>
                    </div>
                  </div>
                  <div className="border-t border-border pt-3">
                    <div className="text-sm font-semibold text-foreground">Driver App</div>
                    <div className="text-xs text-muted-foreground mb-2">
                      Drive, deliver and earn.
                    </div>
                    <div className="flex gap-2">
                       <a href={HEADER_DRIVER_ANDROID} target="_blank" rel="noreferrer" onClick={() => trackAppDownload("driver", "header")} className="inline-flex items-center gap-1 text-xs px-3 py-1.5 rounded-md border border-border hover:bg-muted">
                        <Smartphone className="h-3.5 w-3.5" /> Get Driver on Google Play
                      </a>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        <button
          type="button"
          className="xl:hidden rounded-md p-2 text-nav-foreground hover:bg-nav-foreground/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          onClick={() => { setOpen(!open); setMobileCategory(null); }}
          aria-expanded={open}
          aria-controls="mobile-nav-drawer"
          aria-label={open ? "Close navigation menu" : "Open navigation menu"}
        >
          {open ? <X className="h-5 w-5" aria-hidden /> : <Menu className="h-5 w-5" aria-hidden />}
        </button>

      </div>

      {open && (
        <div id="mobile-nav-drawer" className="xl:hidden border-t border-nav-border/60 bg-nav-strong max-h-[80vh] overflow-y-auto">

          {/* Two-level drill-down: Category → destinations, with explicit back. */}
          {mobileCategory ? (
            <nav className="container mx-auto px-4 py-4" aria-label={mobileCategory.label}>
              <button
                type="button"
                onClick={() => setMobileCategory(null)}
                className="mb-2 inline-flex items-center gap-1.5 rounded-md px-2 py-2 text-sm font-medium text-nav-foreground/85 hover:bg-nav-foreground/10"
              >
                <ChevronLeft className="h-4 w-4" aria-hidden /> All categories
              </button>
              <div className="px-2 pb-3">
                <div className="text-base font-semibold text-nav-foreground">{mobileCategory.label}</div>
                {mobileCategory.desc && (
                  <p className="mt-0.5 text-xs text-nav-muted-foreground">{mobileCategory.desc}</p>
                )}
              </div>
              {mobileCategory.featured && (
                <Link
                  to={navHref(mobileCategory.featured as NavChild)}
                  onClick={() => { trackNavClick(mobileCategory.label, mobileCategory.featured as NavChild, "mobile"); setOpen(false); }}
                  className={/* brand-allow-orange: conversion CTA */ "mb-3 flex items-center justify-between rounded-lg bg-signal px-3 py-2.5 text-sm font-semibold text-signal-foreground"}
                >
                  {mobileCategory.featured.label}
                  <ArrowRight className="h-4 w-4" aria-hidden />
                </Link>
              )}
              {mobileCategory.groups!.map((g, gi) => (
                <div key={gi} className="py-1">
                  {g.heading && (
                    <div className="px-2 py-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-nav-muted-foreground">
                      {g.heading}
                    </div>
                  )}
                  {g.items.map((c) => {
                    const isActive = isNavItemActive(c.to, pathname, search);
                    const cls = cn(
                      "block px-4 py-2.5 text-sm rounded-md",
                      isActive
                        ? "text-nav-foreground bg-nav-foreground/15"
                        : "text-nav-foreground/85 hover:text-nav-foreground hover:bg-nav-foreground/10",
                    );
                    return c.external ? (
                      <a
                        key={c.to + c.label}
                        href={c.to}
                        target="_blank"
                        rel="noreferrer"
                        onClick={() => { trackNavClick(mobileCategory.label, c, "mobile"); setOpen(false); }}
                        className={cls}
                      >
                        {c.label}
                      </a>
                    ) : (
                      <Link
                        key={c.to + c.label}
                        to={navHref(c)}
                        aria-current={isActive ? "page" : undefined}
                        aria-label={c.requiresAuth ? `${c.label} — sign in required` : undefined}
                        onClick={() => { trackNavClick(mobileCategory.label, c, "mobile"); setOpen(false); }}
                        className={cls}
                      >
                        {c.label}
                        {c.requiresAuth && (
                          <span className="ml-1.5 text-[9px] uppercase tracking-wide text-nav-muted-foreground/80">
                            Sign in
                          </span>
                        )}
                      </Link>
                    );
                  })}
                </div>
              ))}
            </nav>
          ) : (
            <nav className="container mx-auto px-4 py-4 flex flex-col gap-1" aria-label="Primary mobile">
              {nav.map((item) => {
                const sectionActive = !!item.groups?.some((g) =>
                  g.items.some((c) => isNavItemActive(c.to, pathname, search)),
                );
                return item.groups ? (
                  <button
                    key={item.label}
                    type="button"
                    onClick={() => setMobileCategory(item)}
                    aria-haspopup="true"
                    aria-current={sectionActive ? "true" : undefined}
                    aria-label={`${item.label} — ${item.groups.reduce((n, g) => n + g.items.length, 0)} destinations${sectionActive ? ", current section" : ""}`}
                    className={cn(
                      "flex min-h-11 items-center justify-between rounded-md px-3 py-3 text-sm font-medium hover:bg-nav-foreground/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                      sectionActive
                        ? "text-nav-foreground bg-nav-foreground/15 border-l-2 border-nav-accent"
                        : "text-nav-foreground/90",
                    )}
                  >
                    <span className="truncate">{item.label}</span>
                    <ChevronRight className="h-4 w-4 shrink-0" aria-hidden />
                  </button>
                ) : (
                  <Link
                    key={item.to}
                    to={item.to!}
                    onClick={() => setOpen(false)}
                    className="px-3 py-3 text-sm font-medium text-nav-foreground/85 hover:text-nav-foreground hover:bg-nav-foreground/10 rounded-md"
                  >
                    {item.label}
                  </Link>
                );
              })}
              <Link
                to={STAFF_ACCESS.to}
                onClick={() => { trackNavClick("Staff Access", STAFF_ACCESS, "mobile"); setOpen(false); }}
                className="px-3 py-3 text-sm font-medium text-nav-foreground/85 hover:text-nav-foreground hover:bg-nav-foreground/10 rounded-md"
              >
                {STAFF_ACCESS.label}
              </Link>
              <div className="py-1 border-t border-nav-border/60 mt-2">
                <div className="px-3 py-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-nav-muted-foreground">
                  Sign In
                </div>
                {SIGN_IN_GROUPS.map((g) => (
                  <div key={g.key}>
                    <div className="px-5 pt-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-nav-muted-foreground">
                      {g.heading}
                    </div>
                    {g.items.map((c) => (
                      <Link
                        key={c.to + c.label}
                        to={c.to}
                        onClick={() => { trackNavClick("Sign In", c, "mobile"); setOpen(false); }}
                        className="block px-5 py-2 text-sm text-nav-foreground/85 hover:text-nav-foreground hover:bg-nav-foreground/10 rounded-md"
                      >
                        {c.label}
                      </Link>
                    ))}
                  </div>
                ))}
              </div>
              <div className="flex flex-col gap-2 pt-3 border-t border-nav-border/60 mt-2">
                <Button asChild className={/* brand-allow-orange: conversion CTA */ "bg-signal text-signal-foreground hover:bg-signal/90"}>
                  <Link to={GET_STARTED.to} onClick={() => setOpen(false)}>{GET_STARTED.label}</Link>
                </Button>
              </div>
            </nav>
          )}
        </div>
      )}

    </header>
  );
};

export default MarketingHeader;
