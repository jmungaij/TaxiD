# TaxiD Backend Operations Centre

## Goal
Expose the real backend capabilities inside TaxiD’s super-admin area without exposing credentials or unsafe direct database controls. Add live operational analytics for the deployed backend functions.

## What will be built
- Replace the minimal Super Admin page with a complete Backend Operations Centre.
- Add sections for Overview, Database, Users, Storage, Emails, Jobs, Edge Functions, Logs, and Usage.
- Surface the existing pages for user management, email delivery, scheduled jobs, observability, audit logs, and platform settings from one place.
- Show verified live counts for tables, protected tables, users, roles, storage, and function activity rather than invented figures.
- Add a secured edge-function analytics endpoint that aggregates operational totals and recent business activity for super admins.
- Add Edge Functions cards documenting and linking the existing rider support AI, authentication email, and MCP agent capabilities.

## Security boundaries
- Secrets will show configuration status and names only; secret values will never be returned to the browser.
- SQL Editor will be represented as a restricted database diagnostics area, not an arbitrary SQL execution box.
- Every new analytics endpoint will validate the signed-in user and require the `super_admin` role server-side.
- Database and authentication remain protected by the existing row-level policies.

## Technical details
- Create a `backend-operations` edge function with CORS, request validation, JWT validation, server-side role authorization, safe aggregate queries, and structured error responses.
- Add a focused super-admin page and route-backed navigation entries using the existing design system and role gates.
- Reuse existing operational pages instead of duplicating email, job, user, and observability interfaces.
- Validate the function deployment, application tests, live page rendering, and desktop/mobile layout.
