# Project rules

- Brand identity comes from `src/config/brand.ts` (TaxiD, "Move Smarter. Go Further."); contact channels from `src/config/contact.ts` — one place to change names/emails.
- Legal entity text "Yalla Beena Limited" is kept on purpose (legal documents); only customer-facing brand text says TaxiD.
- TaxiD artwork is served from `public/taxid-*.png`; CDN pointers failed in preview.
- `ensure_rider_account` grants verified ustaxid@gmail.com super admin; Amie and Naima use distinct confirmed support accounts, never shared passwords.
- Code identifiers, database names, env vars, API headers (e.g. `X-Yalla-Tenant`, `YALLA_*` secrets) keep their legacy names — renaming would break integrations.
- Recover against live TaxiD schema, not compiled Yalla pages. Finance/charter transactions stay enquiries until required tables/RPCs exist. Public navigation lives in `primaryNav.ts` with service-specific discovery links rather than a Marketplace tab.
- The self-service business portal owns `business_organisations` and `business_requests` records; owner-scoped access is enforced by RLS, while finance totals must not be inferred from enquiry values.
- Rider Management tables live in `src/components/riders/RiderTables.tsx` with Vitest regression tests (`bun run test`) — catches JSX breakage before publishing.
- AI rider-support drafts run in the `rider-support-draft` backend function (Lovable AI, admin-only via `has_role`) — keeps the AI key server-side.

- The Supabase client is typed with `LooseDatabase` (`src/integrations/supabase/loose-types.ts`), not the generated `types.ts`: the Cloud backend only has Cloud-created tables while the app queries a much larger schema. Switch back to generated types once the full schema is recreated. `types.ts` is platform-locked (write tool rejects edits).
- MCP server lives in `src/lib/mcp/` (OAuth via the Cloud auth server; tools run as the signed-in user under RLS) — `supabase/functions/mcp` is generated, never hand-edit.
