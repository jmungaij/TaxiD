# Project rules

- Brand identity comes from `src/config/brand.ts` (TaxiD, "Move Smarter. Go Further."); contact channels from `src/config/contact.ts` — one place to change names/emails.
- Legal entity text "Yalla Beena Limited" is kept on purpose (legal documents); only customer-facing brand text says TaxiD.
- The supplied TaxiD artwork is served locally from `public/taxid-*.png` through `BrandLogo` because CDN asset pointers did not render in the Vite preview; favicons and social preview are derived from the same upload.
- Verified-email bootstrap in `ensure_rider_account` grants `ustaxid@gmail.com` super admin; Amie (`admin@taxid.us`) and Naima (`naima@taxid.us`) have separate support identities alongside designated staff mailboxes — individual case histories require distinct confirmed accounts, never shared passwords.
- Code identifiers, database names, env vars, API headers (e.g. `X-Yalla-Tenant`, `YALLA_*` secrets) keep their legacy names — renaming would break integrations.
- Files headed "reconstructed after source recovery" are stand-ins for type-only/barrel modules missing from the uploaded bundle; replace them with real originals when available.
- Rider Management tables live in `src/components/riders/RiderTables.tsx` with Vitest regression tests (`bun run test`) — catches JSX breakage before publishing.
- AI rider-support drafts run in the `rider-support-draft` backend function (Lovable AI, admin-only via `has_role`) — keeps the AI key server-side.

- The Supabase client is typed with `LooseDatabase` (`src/integrations/supabase/loose-types.ts`), not the generated `types.ts`: the Cloud backend only has Cloud-created tables while the app queries a much larger schema. Switch back to generated types once the full schema is recreated. `types.ts` is platform-locked (write tool rejects edits).
- MCP server lives in `src/lib/mcp/` (OAuth via the Cloud auth server; tools run as the signed-in user under RLS) — `supabase/functions/mcp` is generated, never hand-edit.
