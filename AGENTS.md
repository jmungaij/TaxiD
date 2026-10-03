# Project rules

- Brand identity comes from `src/config/brand.ts` (TaxiD, "Move Smarter. Go Further."); contact channels from `src/config/contact.ts` — one place to change names/emails.
- Legal entity text "Yalla Beena Limited" is kept on purpose (legal documents); only customer-facing brand text says TaxiD.
- TaxiD artwork is served from `public/taxid-*.png`; CDN pointers failed in preview.
- Verified ustaxid@gmail.com receives super admin; Amie and Naima use distinct confirmed support accounts, never shared passwords.
- Code identifiers, database names, env vars, API headers (e.g. `X-Yalla-Tenant`, `YALLA_*` secrets) keep their legacy names — renaming would break integrations.
- Use live schema, not compiled pages. Finance/charter stay enquiries until backend contracts exist. Public navigation uses service links, not a Marketplace tab.
- Business requests stay owner-scoped; staff review uses guarded routines, and enquiry values never count as revenue.
- Rider tables (`src/components/riders/RiderTables.tsx`) have Vitest tests (`bun run test`) to catch JSX breakage.
- AI drafts and backend analytics run in role-checked functions; never expose secrets or arbitrary SQL in the browser.

- The Supabase client is typed with `LooseDatabase` (`src/integrations/supabase/loose-types.ts`), not the generated `types.ts`: the Cloud backend only has Cloud-created tables while the app queries a much larger schema. Switch back to generated types once the full schema is recreated. `types.ts` is platform-locked (write tool rejects edits).
- MCP server lives in `src/lib/mcp/` (OAuth via the Cloud auth server; tools run as the signed-in user under RLS) — `supabase/functions/mcp` is generated, never hand-edit.
- `src/index.css` is precompiled; import `src/tw-utilities.css` after it.
- Staff Access uses one public gateway; below 1600px categories use the existing drawer. Staff 360 scopes govern visibility; backend authorization remains authoritative.

- Legacy DB restores replay scripts kept in `legacy/restore/phaseN.sql`, applied area-by-area in dependency order with admin-only RLS until original helper functions return — avoids partial, unsafe domains.
- Privileged (SECURITY DEFINER) routines live in the `private` schema; `public` keeps same-named SECURITY INVOKER wrappers — keeps the Data API free of elevated functions while RPC names stay stable.
- Tips flow through the existing driver wallet, journals and driver payout engine (`private.trip_tip_driver`); 'Paid out' is derived by `trip_tip_status` from successful payouts — never a separate tip wallet or payout path.
- Rider bookings go through `trip_confirm_booking_ctx` (personal or business context on one identity); fares stay in `trip_confirm_booking`, company limits/approvals are enforced server-side — never a second rider account or pricing path.
- Business trips settle in the database on completion (`private.corporate_trip_settle`, trigger on `trip_bookings`): per-company arrangement chooses wallet debit, credit accrual onto a 1–3 day cycle invoice, or hybrid; failures become settlement exceptions, never rider charges — one settlement path, idempotent per booking.
- Company travel policies have one engine: `private.corporate_policy_evaluate` (inside `trip_confirm_booking_ctx`, rider pre-check, TravelDesk and simulator via `private.corporate_evaluate_full`); groups (`group_id`), location rules (`private.corporate_location_evaluate`) and programs (`taxid.program_id` setting) are filters merged into it — never a second rule engine.
- Guest/client/hotel/airport bookings go through `private.corporate_guest_book` (server-computed fare, same policy evaluator, company capacity check) — booking codes and approvals enforced server-side, never in the browser.
- Multi-step approvals live in `corporate_approval_steps` (chains → steps with deadline + stand-in); `private.corporate_approval_step_decide` enforces maker-checker and distinct approvers; once a chain governs a trip the single-step `corporate_trip_decide` refuses it.
- TravelDesk bookings become real trips via `private.corporate_guest_dispatch` (trigger on confirmation) — one trip/dispatch/driver/settlement path, never a parallel booking system.
- Company work-account sign-in links a confirmed work-domain email (`corporate_work_domains`) to its staff record via `corporate_claim_work_account` after sign-in; protected directors (`metadata.protected_director`) change only through `corporate_director_handover`.
- Vehicle catalogue (Service → Service Class → Vehicle Class) lives in `mobility_services`/`mobility_vehicle_classes`; a class is bookable only when linked to a priced `ride_types` row, and policies store ride-type codes — pricing and the policy engine stay single-sourced.

- Company funds: holds (`corporate_fund_holds`) sync by trigger on `trip_bookings` and capture on settlement; `trip_financial_ledger` is append-only, one idempotency key per booking event; `corporate_budgets` checked in `trip_confirm_booking_ctx`.
- Prices come only from `private.taxid_quote` (airports: distance + pickup premium, zone floor); `corporate_estimate_fare` delegates. Credit only via super-admin `corporate_credit_decide`.
