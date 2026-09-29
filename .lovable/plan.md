# TaxiD landing, booking, business, and administration upgrade

## Goal
Bring the homepage into close visual alignment with the supplied TaxiD reference, while replacing decorative booking paths with secure, stored workflows that riders, organisations, and administrators can use end to end.

## Build scope

### 1. Forensic landing-page remediation
- Make the supplied reference composition the homepage’s primary and continuous experience from header to footer.
- Remove the duplicated generic sections currently appended after the reference-style experience.
- Align the header with the six reference service categories and retain accessible desktop/mobile navigation.
- Refine hero proportions, service cards, Africa network section, business panel, booking area, partner section, curves, spacing, image treatment, and sapphire/cyan/gold hierarchy.
- Curate the footer into clear Services, Business, Partners, Developers, and Company groups while preserving valid existing destinations.
- Preserve TaxiD’s multicolour logo, local artwork, factual copy, and existing rider/driver app destinations.

### 2. Real homepage booking forms
- Replace the current redirect-only tabs with forms tailored to Rides, Business, Airport, and Charter.
- Rides will collect the fields needed to create a real trip request and continue through the existing secure fare/booking flow.
- Airport will collect transfer and flight details and store an airport booking tied to the signed-in rider.
- Business and Charter will create stored organisation requests rather than decorative URL handoffs.
- Signed-out visitors will be taken through sign-in and returned to the intended form with their entered context preserved where safe.
- Add clear validation, loading, success, and failure states.

### 3. Business account and quote workflow
- Keep the existing organisation creation flow, then extend it with organisation members so access can be scoped to one organisation.
- Store fleet, vehicle, charter, delivery, and logistics requests with route, service date, quantity, requirements, status, and administrative handling details.
- Let organisations view pending, in-review, completed, and cancelled requests/orders in Power Business.
- Make the Power Business metrics and charts read the organisation’s real requests and permitted trip records; do not present enquiry value as revenue.

### 4. Governed admin backend
- Add secure super-admin role assignment and revocation routines with audit records and denied-attempt records.
- Add admin access rules and governed actions for reviewing organisation accounts and progressing quote requests.
- Build a focused admin operations screen for organisations, quotes, and trips with search, filtering, details, and permitted status actions.
- Keep roles in `user_roles`; organisation membership remains separate and scoped to its organisation.
- Link the new controls from the existing Backend Operations Centre and administration navigation.

### 5. Google Play click analytics
- Record Rider and Driver Google Play clicks from homepage, header, footer, and other existing app buttons with audience and placement.
- Extend the protected Backend Operations response with Rider clicks, Driver clicks, total clicks, and placement breakdown for the selected time window.
- Show these values in the Backend Operations Centre without exposing visitor-identifying data.

### 6. Real account and fleet-quote verification
- Use the current signed-in account, as selected, to create a clearly labelled TaxiD test organisation and submit a fleet quote.
- Confirm the stored organisation and request in the database.
- Confirm the pending request appears in the Power Business dashboard.
- Confirm an authorised administrator can see the organisation, quote, and relevant trip management screens.
- If the current account is not signed in or lacks the needed role, complete all implementation and mark only that authenticated verification step as blocked rather than weakening access controls.

## Technical details
- Apply schema, grants, row-level access policies, role routines, audit support, and request-management routines through one or more reviewed migrations.
- Use existing `trip_requests`, `trip_quotes`, `trip_bookings`, `airport_bookings`, `business_organisations`, `business_requests`, and `user_roles` where their semantics are correct; extend rather than duplicate.
- Use server-authoritative ownership and role checks. Never accept caller-supplied ownership or client-side role claims.
- Track public app-link clicks through a narrowly scoped event write path; aggregate counts only through the super-admin backend function.
- Keep the current loose client typing strategy until the full historical schema is restored.
- Record structural decisions in `AGENTS.md` and keep the multi-part task status in `roadmap.md`.

## Verification
- Run the existing test suite and add targeted tests for tab routing/submission, app-click tracking, business requests, and admin status controls.
- Check current build diagnostics after edits.
- Verify the homepage visually at 1280px desktop and representative mobile widths against the supplied reference, checking no overlap or horizontal overflow.
- Exercise the real signed-in organisation → fleet quote → pending dashboard flow and inspect the stored owner/status.
- Verify unauthorised users cannot manage roles, organisations, quotes, or other users’ trips.
