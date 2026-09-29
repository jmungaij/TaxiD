# TaxiD Staff Access and Role-Governance Remediation

## Goal
Make the existing Staff Access, Staff 360, and super-admin capabilities discoverable to properly authorized staff while preserving authentication, row-level security, and server-side role enforcement.

## Changes
1. **Restore Staff Access visibility**
   - Show the existing **Staff Access** entry in the desktop header at normal laptop widths, not only ultra-wide screens.
   - Keep the existing mobile Staff Access entry and verify both variants reach the canonical `/staff/access` gateway.
   - Avoid duplicate navigation entries.

2. **Standardize authorized staff access**
   - Treat the existing `super_admin` role as the platform's Staff 360 workspace-management authority; do not invent a browser-controlled role.
   - Ensure Staff 360, administration, backend operations, support-agent, corporate, driver, and rider entry points recognize a signed-in super administrator where appropriate.
   - Preserve role-specific restrictions for ordinary riders, drivers, corporate users, and support agents.
   - Keep every privileged page behind its existing route guard and every data action behind database policies or protected routines.

3. **Securely provision the designated account**
   - Use the existing authentication service for `ustaxid@gmail.com`; do not place its password in source, migrations, browser storage, logs, or UI text.
   - Reuse the account if it exists; otherwise create it through the normal secure account flow.
   - Ensure the verified account receives the existing `super_admin` and `admin` grants server-side and can resolve all legitimate staff workspaces.
   - Test sign-in through the Staff Access page and compatible role-based portals without exposing the credential.

4. **Audit hidden and unreachable functionality**
   - Classify hidden, disabled, feature-flagged, orphaned, development-only, incomplete, deprecated, and security-sensitive surfaces.
   - Restore navigation only for production-ready capabilities already supported by routes and backend authorization.
   - Keep incomplete, debug, test, and unsupported transactional controls unavailable.
   - Add or adjust regression tests for navigation visibility and route authorization.

5. **Verify the complete chain**
   - Test desktop and mobile Staff Access visibility.
   - Test authentication, refresh persistence, direct-route authorization, permitted portal access, rejection of unauthorized users, and logout.
   - Run the existing test suite and confirm the live preview build is healthy.

## Technical details
- Role authority remains in `public.user_roles`, `has_role`, and `has_any_role`; frontend checks are presentation only.
- Any schema or policy change will use a reviewed migration with explicit grants and RLS preserved.
- Existing Staff 360 role/workspace definitions and canonical route registries remain the source of truth.
- The supplied password is treated as a secret and is never committed or repeated in implementation output.

## Boundaries
- No blanket removal of role checks, feature flags, or hidden states.
- No invented modules or exposure of unfinished pages.
- No service-role keys, passwords, or privileged tokens in client code.
- No unrelated redesign or database work.
