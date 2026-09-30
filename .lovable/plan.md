# TaxiD: bring back existing features, then add the missing driver and quote flows

## 1. Scan what already exists (nothing gets rebuilt)
- Check every page, route and backend table against the Yalla Mobility / SafariRide screens that are already in this project.
- Many parts are already here: trips, quotes, bookings, wallets, M-Pesa, rider profiles, KYC, rewards, notifications, safety alerts, support cases, business requests.
- Screens that are built but hidden or not linked go back into the menus. The result is one checklist sorted into three groups: working, hidden (now shown), and missing (needs backend).
- Driver and vehicle records have no tables. Trips already have spaces for a driver and a vehicle, but nothing fills them. The original definitions were not in the uploaded files. Only this part gets new backend work.

## 2. Your account (ustaxid@gmail.com)
- The account does not exist yet. That is why sign-in failed.
- A one-time secure step creates it, already confirmed, with the password **Mungai@Taxid**. The account then gets super admin and admin roles through the existing rules. The one-time step is deleted afterwards, and the password is never saved in the app.
- Check by signing in for real at /auth, /staff/access and the corporate sign-in. Then open the Rider, Driver, Power Business, Staff 360 and Backend Operations screens.
- Recommendation: change the password after your first sign-in, because it has been shared in this chat.

## 3. Rider portal (linked to the homepage booking tabs)
- The Rides and Airport tabs send you to booking with the details filled in. Booking uses the existing quote and confirm steps.
- Trip history lists your bookings and their status. After booking, you see an on-screen confirmation and it also appears in your notifications.

## 4. Driver portal (linked to Power Business)
- New driver records: driver profile, vehicle with status (available / offline / on trip / maintenance) and an earnings record.
- Drivers see open trips and fleet quotes, accept them, move trips through arrived → started → completed, and see earnings for today, this week and all time.
- All steps use checked backend routines, so a driver can only change their own trips.

## 5. Fleet quote → booked trip
- An admin can assign an approved business fleet request to a driver or vehicle. This creates a real booked trip linked to the request.
- The Power Business dashboard then shows it moving from pending to booked to completed. It counts as revenue only once completed.

## 6. Google Play click details
- Each click records the device type, operating system, browser and exact time. It stores no personal identifiers.
- Backend Operations shows totals for Rider and Driver, plus a recent-clicks table with device and time.

## Technical section
- Migration: `drivers`, `vehicles`, `driver_earnings`, and a new `trip_bookings.business_request_id`. Adds routines `driver_accept_trip`, `driver_update_trip_status`, `driver_set_vehicle_status` and `admin_assign_business_request`. Adds `device_type`, `os`, `browser` and `user_agent` columns to `app_download_clicks`, plus staff read access. Adds the `driver` role to `ensure_rider_account` for opt-in driver signup. Every table gets GRANTs and RLS.
- A temporary edge function creates the confirmed user with the admin API. It is deployed, called once and then deleted.
- Scan method: route list in `routes.ts`/`App.tsx` compared with page files and live schema. Output goes in `roadmap.md`.
- Tests: extend Vitest. Verify with Playwright, signed in as the real account.
