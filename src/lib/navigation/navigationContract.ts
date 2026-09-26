/**
 * Platform Navigation Integrity Contract.
 *
 * Generalizes the former footer-only contract into ONE contract every
 * navigation surface (header mega panels, footer, sitemap, sign-in gateway,
 * staff portal) is validated against.
 *
 * A navigation destination is only legitimate when ALL of the following hold:
 *   1. it resolves to a registered canonical route (never a redirect alias),
 *   2. the route has a class (PUBLIC / PUBLIC_UNINDEXED / AUTHENTICATED /
 *      ROLE_PROTECTED / INTERNAL) — see routeClassification.ts,
 *   3. it is bound to a capability that exists in the capability registry,
 *   4. every verb the LABEL promises is a verb that capability declares
 *      (no false promises: "Track" with no tracking backend, "Book" on a
 *      brochure page, etc.),
 *   5. an authenticated destination is surfaced through a login gateway that
 *      preserves the target (navHref), never as a dead end.
 *
 * The contract is enforced by:
 *   - src/lib/navigation/__tests__/navigation-integrity.test.ts (unit gate)
 *   - scripts/navigation-crawl.ts (CI crawler + report)
 *   - e2e/nav-permission-matrix.spec.ts (role × route × auth-state matrix)
 */
import { CAPABILITIES, promisedVerbs, type Capability, type CapabilityVerb } from "./capabilityRegistry";
import { FOOTER_CONTRACT, type FooterClassification } from "./footerContract";
import { classifyRoute, REDIRECT_ALIASES, type RouteClass } from "./routeClassification";

/** Page model: what kind of surface the destination actually is. */
export type PageType = FooterClassification;

/**
 * Capability binding rules, evaluated in order. Prefix/pattern rules keep the
 * contract resilient: a newly authored nav item inherits its domain capability
 * automatically, and anything that matches no rule fails the gate loudly
 * instead of shipping unbound.
 */
export const CAPABILITY_BINDINGS: { re: RegExp; capabilityId: string }[] = [
  /* Exact, highest-signal destinations first. */
  { re: /^\/dashboard\/corporate-charter/, capabilityId: "corporate.finance" },
  { re: /^\/rider$/, capabilityId: "ride.book" },
  { re: /^\/rider\/airport$/, capabilityId: "ride.book" },
  { re: /^\/rider\/schedule$/, capabilityId: "ride.book" },
  { re: /^\/rider\/trips$/, capabilityId: "ride.history" },
  { re: /^\/rider\/wallet$/, capabilityId: "ride.wallet" },
  { re: /^\/rider\/(favorites|rewards)$/, capabilityId: "ride.loyalty" },
  { re: /^\/rider\/safety$/, capabilityId: "ride.marketing" },
  { re: /^\/dashboard\/rider/, capabilityId: "ride.portal" },
  { re: /^\/riders\/corporate$/, capabilityId: "corporate.programme" },
  { re: /^\/riders(\/|$)/, capabilityId: "ride.marketing" },

  { re: /^\/corporate\/register/, capabilityId: "corporate.onboarding" },
  { re: /^\/corporate\/(login|access-required)/, capabilityId: "identity.auth" },
  { re: /^\/clients\/login$/, capabilityId: "identity.auth" },
  { re: /^\/dashboard\/corporate\/(approvals|policies)/, capabilityId: "corporate.approvals" },
  { re: /^\/dashboard\/corporate\/(wallet|invoicing|expense-codes)/, capabilityId: "corporate.finance" },
  { re: /^\/dashboard\/corporate/, capabilityId: "corporate.manage" },
  { re: /^\/(corporates|enterprise|corporate)$/, capabilityId: "corporate.marketing" },
  { re: /^\/corporate-travel-management$/, capabilityId: "corporate.marketing" },
  { re: /^\/enterprise\/demo$/, capabilityId: "corporate.marketing" },

  { re: /^\/charter\/search$/, capabilityId: "charter.compare" },
  { re: /^\/charter\/smartfare$/, capabilityId: "charter.book" },
  { re: /^\/charter\/booking-status$/, capabilityId: "charter.manage" },
  { re: /^\/charter\/login$/, capabilityId: "identity.auth" },
  { re: /^\/dashboard\/charter\/(operator-portal|analytics)/, capabilityId: "charter.operator" },
  { re: /^\/dashboard\/charter/, capabilityId: "charter.manage" },
  { re: /^\/charter\/(car-rentals|equipment-rentals|event-rentals|aircraft-leasing|heavy-machinery-leasing|truck-hauler-leasing)$/, capabilityId: "rentals.marketing" },
  { re: /^\/charter(\/|$)/, capabilityId: "charter.marketing" },

  { re: /^\/rentals\/(marketplace|self-drive|bus-coach)$/, capabilityId: "rentals.compare" },
  { re: /^\/rentals\/(corporate-leasing|chauffeur)$/, capabilityId: "rentals.lease" },
  { re: /^\/rentals(\/|$)/, capabilityId: "rentals.marketing" },

  { re: /^\/delivery\/(package|courier)$/, capabilityId: "logistics.send" },
  { re: /^\/delivery\/ops/, capabilityId: "logistics.operate" },
  { re: /^\/delivery\/portal$/, capabilityId: "logistics.partner" },
  { re: /^\/delivery(\/|$)/, capabilityId: "logistics.marketing" },
  { re: /^\/logistics(\/|$)/, capabilityId: "logistics.marketing" },

  { re: /^\/marketplace(\/|$)/, capabilityId: "marketplace.browse" },

  { re: /^\/driver\/apply$/, capabilityId: "driver.apply" },
  { re: /^\/driver\/start$/, capabilityId: "driver.apply" },
  { re: /^\/driver\/(training|support|safety|benefits|earnings|onboarding)$/, capabilityId: "driver.enablement" },
  { re: /^\/dashboard\/driver/, capabilityId: "driver.portal" },
  { re: /^\/drivers(\/|$)/, capabilityId: "partner.marketing" },
  { re: /^\/partners\/apply$/, capabilityId: "partner.onboarding" },
  { re: /^\/partners(\/|$)/, capabilityId: "partner.marketing" },
  { re: /^\/partner\/workspace/, capabilityId: "partner.workspace" },
  { re: /^\/provider\/capacity/, capabilityId: "partner.workspace" },
  { re: /^\/operator(\/|$)/, capabilityId: "partner.workspace" },

  { re: /^\/pricing$/, capabilityId: "content.pricing" },
  { re: /^\/(support|faq|contact|safety)$/, capabilityId: "content.support" },
  { re: /^\/(developers(\/ai-assistants)?|api-docs)$/, capabilityId: "content.developers" },
  { re: /^\/careers/, capabilityId: "careers.apply" },
  { re: /^\/legal\//, capabilityId: "content.legal" },
  { re: /^\/(about|news|blog|compliance|security|investors|sustainability)(\/|$)/, capabilityId: "content.company" },

  { re: /^\/auth/, capabilityId: "identity.auth" },
  { re: /^\/staff(\/|$)/, capabilityId: "staff.operate" },

  /* Protected admin portal — the sidebar (workspaces + domains) is crawled and
     bound with the same rigour as the public header. Ordered most specific
     first; the trailing rule guarantees no admin destination ships unbound. */
  { re: /^\/dashboard\/admin\/charter-retry-timeline$/, capabilityId: "platform.finance" },
  { re: /^\/dashboard\/[\w/-]*(payment|payout|paybill|settlement|invoic|refund|reconcil|revenue|tax|journal|ledger)/, capabilityId: "platform.finance" },
  // Corporate business controls, relocated from the public header into the
  // admin rail. Declared ahead of the broad /dashboard/admin/... buckets so the
  // governance capability (approvals & policy) stays explicitly promised.
  { re: /^\/dashboard\/admin\/corporates\/approvals/, capabilityId: "corporate.approvals" },
  { re: /^\/dashboard\/admin\/corporate-wallet-finance/, capabilityId: "corporate.finance" },
  { re: /^\/dashboard\/[\w/-]*(ccb|rfq|quotation)/, capabilityId: "platform.commercial" },
  { re: /^\/dashboard\/admin\/(pricing|rate-cards|asset-pricing|smartfare|commercial|charter-pricing)/, capabilityId: "platform.commercial" },
  { re: /^\/dashboard\/admin\/(finance|payouts|settlement|reconciliation|invoic|wallet|tax|revenue|refund)/, capabilityId: "platform.finance" },
  { re: /^\/dashboard\/admin\/(trust|safety|fraud|compliance|security|kyc|risk|audit)/, capabilityId: "platform.trust" },
  { re: /^\/dashboard\/admin\/(analytics|intelligence|insights|reports|forecast|executive)/, capabilityId: "platform.intelligence" },
  { re: /^\/dashboard\/admin\/(riders?|drivers?|people|partners|support|corporate|recruit)/, capabilityId: "platform.people" },
  { re: /^\/dashboard\/admin\/(fleet|vehicle|charter|rental|leasing|asset|flight|aircraft)/, capabilityId: "platform.assets" },
  { re: /^\/dashboard\/admin\/(delivery|logistics|courier|package|parcel)/, capabilityId: "platform.logistics" },
  { re: /^\/dashboard\/admin\/(ops|operations|dispatch|noc|sla|fos|monitor|incident)/, capabilityId: "platform.operate" },
  { re: /^\/dashboard\/admin(\/|$)/, capabilityId: "platform.administer" },
  { re: /^\/dashboard\/(marketplace|vendors?)/, capabilityId: "marketplace.browse" },
  { re: /^\/dashboard\/delivery/, capabilityId: "platform.logistics" },
  { re: /^\/dashboard\/(finance|payments)/, capabilityId: "platform.finance" },
  { re: /^\/dashboard\/fleet/, capabilityId: "platform.assets" },
  { re: /^\/dashboard(\/|$)/, capabilityId: "platform.administer" },
];

export function capabilityIdFor(path: string): string | undefined {
  return CAPABILITY_BINDINGS.find((b) => b.re.test(path))?.capabilityId;
}

export function capabilityForPath(path: string): Capability | undefined {
  const id = capabilityIdFor(path);
  return id ? CAPABILITIES[id] : undefined;
}

export interface NavContractRecord {
  path: string;
  label: string;
  routeClass: RouteClass;
  pageType?: PageType;
  capabilityId?: string;
  promises: CapabilityVerb[];
  violations: string[];
}

export interface NavDestinationInput {
  path: string;
  label: string;
  /** Surface the destination was authored on (header, footer, sitemap…). */
  surface: string;
  requiresAuth?: boolean;
  external?: boolean;
  /** The href actually rendered (navHref output) — used for gateway checks. */
  href?: string;
}

/**
 * Audits ONE navigation destination against the contract. Returns every
 * violation so a report can list them all rather than failing on the first.
 */
export function auditDestination(input: NavDestinationInput): NavContractRecord {
  const { path, label } = input;
  const violations: string[] = [];

  const classification = classifyRoute(path);
  const capabilityId = capabilityIdFor(path);
  const capability = capabilityId ? CAPABILITIES[capabilityId] : undefined;
  const promises = promisedVerbs(label);

  if (classification.unregistered) {
    violations.push(`unregistered route: ${path} is not declared in src/lib/routes.ts`);
  }
  if (REDIRECT_ALIASES[path]) {
    violations.push(`links to redirect alias ${path} — use canonical ${REDIRECT_ALIASES[path]}`);
  }
  if (!capabilityId) {
    violations.push(`no capability binding for ${path} (add a rule to CAPABILITY_BINDINGS)`);
  } else if (!capability) {
    violations.push(`capability "${capabilityId}" is not declared in the capability registry`);
  }
  if (capability) {
    for (const verb of promises) {
      if (!capability.verbs.includes(verb)) {
        violations.push(
          `false promise: label "${label}" promises "${verb}" but capability ${capability.id} only supports ${capability.verbs.join("/")}`,
        );
      }
    }
  }
  if (input.requiresAuth && input.href) {
    const gatewayOk = /^\/(auth|corporate\/login|charter\/login|delivery\/portal)\?redirect=/.test(input.href);
    if (!gatewayOk) {
      violations.push(`authenticated destination ${path} is not surfaced through a login gateway carrying ?redirect=`);
    }
  }
  if (!input.requiresAuth && !input.external && classification.routeClass === "ROLE_PROTECTED") {
    violations.push(
      `${path} is ROLE_PROTECTED (${classification.rolesAllowed.join(", ")}) but is authored as a public destination`,
    );
  }
  if (!input.requiresAuth && !input.external && classification.routeClass === "AUTHENTICATED") {
    violations.push(
      `${path} is session-gated at runtime but is authored as a public destination — a guest would be refused after clicking`,
    );
  }

  return {
    path,
    label,
    routeClass: classification.routeClass,
    pageType: FOOTER_CONTRACT[path]?.classification,
    capabilityId,
    promises,
    violations,
  };
}

/** Audits a whole surface and returns only the records that violate. */
export function auditSurface(inputs: NavDestinationInput[]): NavContractRecord[] {
  return inputs.filter((i) => !i.external).map(auditDestination);
}

/* ======================================================================
 * PROTECTED PORTAL NAVIGATION
 * ----------------------------------------------------------------------
 * The admin rail (workspaces + business domains) and the staff portal are
 * navigation surfaces too. They carry a stricter contract than public nav:
 *   1. the destination must be a registered route,
 *   2. it must NOT be PUBLIC — an admin menu pointing at an unguarded route
 *      is an authorization hole, not a convenience,
 *   3. it must be bound to a capability (a real backend surface),
 *   4. at least one role able to SEE the entry must be a role the route guard
 *      ADMITS. The sidebar filters each item against the guard (DashboardLayout
 *      → canAccess), so a narrower guard is legitimate; a guard that admits
 *      NOBODY on the surface is a dead entry and fails the contract.
 * ====================================================================== */

export interface ProtectedNavInput {
  path: string;
  label: string;
  /** Which surface authored it: workspace key, domain key, staff portal… */
  surface: string;
  /** Roles that can SEE the entry (workspace/domain visibility roles). */
  surfaceRoles: string[];
}

export interface ProtectedNavRecord extends NavContractRecord {
  surface: string;
  surfaceRoles: string[];
  /** Roles the route registry admits. */
  routeRoles: readonly string[];
  /**
   * Roles that can see the SURFACE but are refused by the route guard. The
   * sidebar filters these per item (DashboardLayout → canAccess), so this is a
   * narrowing record, not a defect — unless it narrows to nobody.
   */
  narrowedRoles: string[];
  /** Roles that can both see the entry and pass the route guard. */
  admittedRoles: string[];
}

export function auditProtectedDestination(input: ProtectedNavInput): ProtectedNavRecord {
  const path = input.path.split("?")[0].split("#")[0];
  const classification = classifyRoute(path);
  const capabilityId = capabilityIdFor(path);
  const capability = capabilityId ? CAPABILITIES[capabilityId] : undefined;
  const promises = promisedVerbs(input.label);
  const routeRoles = classification.rolesAllowed;
  const violations: string[] = [];

  if (classification.unregistered) {
    violations.push(`unregistered route: ${path} is not declared in src/lib/routes.ts`);
  }
  if (REDIRECT_ALIASES[path]) {
    violations.push(`links to redirect alias ${path} — use canonical ${REDIRECT_ALIASES[path]}`);
  }
  if (!classification.unregistered && classification.routeClass === "PUBLIC") {
    violations.push(`${path} is surfaced inside a protected portal (${input.surface}) but the route is PUBLIC — guard it or move it`);
  }
  if (!capabilityId) {
    violations.push(`no capability binding for ${path} (add a rule to CAPABILITY_BINDINGS)`);
  } else if (!capability) {
    violations.push(`capability "${capabilityId}" is not declared in the capability registry`);
  }
  if (capability) {
    for (const verb of promises) {
      if (!capability.verbs.includes(verb)) {
        violations.push(
          `false promise: label "${input.label}" promises "${verb}" but capability ${capability.id} only supports ${capability.verbs.join("/")}`,
        );
      }
    }
  }

  const guardOpen = classification.unregistered || routeRoles.length === 0;
  const narrowedRoles = guardOpen
    ? []
    : input.surfaceRoles.filter((r) => !(routeRoles as string[]).includes(r));
  const admittedRoles = guardOpen
    ? [...input.surfaceRoles]
    : input.surfaceRoles.filter((r) => (routeRoles as string[]).includes(r));

  // A dead entry: nobody who can see the surface can pass the guard. The item
  // would render for no one, or (worse) render and always be refused.
  if (!guardOpen && admittedRoles.length === 0) {
    violations.push(
      `dead entry: ${input.surface} is visible to ${input.surfaceRoles.join(", ")} but ${path} admits only ${routeRoles.join(", ")} — no viewer of this surface can open it`,
    );
  }

  return {
    path,
    label: input.label,
    surface: input.surface,
    surfaceRoles: input.surfaceRoles,
    routeRoles,
    narrowedRoles,
    admittedRoles,
    routeClass: classification.routeClass,
    pageType: FOOTER_CONTRACT[path]?.classification,
    capabilityId,
    promises,
    violations,
  };
}

export function auditProtectedSurface(inputs: ProtectedNavInput[]): ProtectedNavRecord[] {
  return inputs.map(auditProtectedDestination);
}
