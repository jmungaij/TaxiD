# Phase 9, security tightening, staff register and working finance/dispatch actions

This covers a lot of work, so it's split into steps with a check after each one. Each step reuses the original Yalla definitions wherever they exist, and nothing gets rebuilt from guesses.

## Step 1: Add John Mungai to the staff register
- Add a staff register entry for John Mungai (Director, active) with work email ustaxid@gmail.com, then link it to the confirmed sign-in using the existing secure self-link step (`staff_claim_self`).
- Check: sign in as ustaxid@gmail.com, open Staff 360 and confirm the workspace opens.

## Step 2: Phase 9, the remaining platform tables
- Restore the rest of the admin, monitoring and platform tables (about 690) in dependency order from the original setup files, with admin-only access, just like phases 1 to 8.
- Keep the 8 TaxiD-only tables untouched, and confirm existing records are unchanged.

## Step 3: Restore original backend actions and company-level access
- Replay the original helper actions that the original access rules depend on, such as company membership checks and finance and fleet role checks.
- Swap the temporary admin-only rules for the original company-scoped ones, so a company admin sees only their own company's records.
- Check: test as a company user of company A and confirm company B's records stay invisible.

## Step 4: Finance, fleet and dispatch actions that save data
- Wallet top-up, M-Pesa payment records, driver payouts and KRA eTIMS invoice records: restore the original actions, or wire the screens to them, so staff forms really save.
- Note: live M-Pesa and live KRA eTIMS submission need your credentials (Daraja keys, eTIMS device details). Without them, records save as pending or drafts and nothing is marked as paid or filed.
- Dispatch: when a rider books, the trip is saved, a queue entry and trip events are written, and a driver is assigned through the existing auto-dispatch.
- Check: run one full booking with a test verified driver and vehicle, and confirm the booking, queue, events, assignment and earnings on completion.

## Step 5: Security review of actions any signed-in person can use
- Go through every action any signed-in person can use (currently 30 warnings). For each one: close it if the browser never calls it; require the right role (admin, super_admin or finance_admin) for staff, payment and trip edits; limit rider and driver actions to their own records; check inputs.
- Report which warnings remain and why each is still needed.

## Step 6: Forensic verification report
- Sign in as ustaxid@gmail.com and open Staff 360 (profiles, documents, qualifications, training, reviews, calendars), finance, fleet, dispatch and the corporate screens. Capture errors and fix them.
- Report per screen: works, empty but ready, or blocked, with the reason for each.

## Technical notes
- Source: `legacy/yalla/migrations`, with scripts saved to `legacy/restore/phase9*.sql` and later files.
- Company scoping uses the original helpers on the corporate membership tables, and `has_any_role` keeps its self-check.
- Nothing publishes unless you ask.
