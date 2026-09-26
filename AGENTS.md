# Project rules

- Brand identity comes from `src/config/brand.ts` (SAFARID); contact channels from `src/config/contact.ts` — one place to change names/emails.
- Legal entity text "Yalla Beena Limited" is kept on purpose (legal documents); only customer-facing brand text says SAFARID.
- Code identifiers, database names, env vars, API headers (e.g. `X-Yalla-Tenant`, `YALLA_*` secrets) keep their legacy names — renaming would break integrations.
- Files headed "reconstructed after source recovery" are stand-ins for type-only/barrel modules missing from the uploaded bundle; replace them with real originals when available.
