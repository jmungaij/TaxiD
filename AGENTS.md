# Project rules

- Brand identity comes from `src/config/brand.ts` (SAFARID); contact channels from `src/config/contact.ts` — one place to change names/emails.
- Legal entity text "Yalla Beena Limited" is kept on purpose (legal documents); only customer-facing brand text says SAFARID.
- Code identifiers, database names, env vars, API headers (e.g. `X-Yalla-Tenant`, `YALLA_*` secrets) keep their legacy names — renaming would break integrations.
- Files headed "reconstructed after source recovery" are stand-ins for type-only/barrel modules missing from the uploaded bundle; replace them with real originals when available.
- Rider Management tables live in `src/components/riders/RiderTables.tsx` with Vitest regression tests (`bun run test`) — catches JSX breakage before publishing.
- AI rider-support drafts run in the `rider-support-draft` backend function (Lovable AI, admin-only via `has_role`) — keeps the AI key server-side.
