# Project rules

- Brand identity comes from `src/config/brand.ts` (TaxiD, "Move Smarter. Go Further."); contact channels from `src/config/contact.ts` — one place to change names/emails.
- Legal entity text "Yalla Beena Limited" is kept on purpose (legal documents); only customer-facing brand text says TaxiD.
- TaxiD artwork is served from `public/taxid-*.png`; CDN pointers failed in preview.
- Verified ustaxid@gmail.com receives super admin; Amie and Naima use distinct confirmed support accounts, never shared passwords.
- Code identifiers, database names, env vars, API headers (e.g. `X-Yalla-Tenant`, `YALLA_*` secrets) keep their legacy names — renaming would break integrations.
- Use live schema, not compiled pages. Finance/charter stay enquiries until backend contracts exist. Public navigation uses service links, not a Marketplace tab.
- Business requests stay owner-scoped; staff review uses guarded routines, and enquiry values never count as revenue.
- Rider Management tables live in `src/components/riders/RiderTables.tsx` with Vitest regression tests (`bun run test`) — catches JSX breakage before publishing.
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
