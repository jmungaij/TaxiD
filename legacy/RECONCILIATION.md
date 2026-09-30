# TaxiD vs original Yalla database — reconciliation matrix

Read-only comparison. No database changes made.

| Object | Original | In TaxiD | Present in both | Missing from TaxiD | TaxiD-only |
|---|---|---|---|---|---|
| Tables | 1439 | 43 | 35 | 1404 | 8 |
| Functions | 2027 | 31 | 14 | 2013 | 17 |
| Views | 78 | 0 | 0 | 78 | 0 |
| Enum types | 191 | 6 | 6 | 185 | 0 |

## Missing tables by area (restore order = top to bottom)

| Area | Missing tables | Examples |
|---|---|---|
| Core identity/roles | 50 | authentication_events, authorization_decisions, org_audit_log, org_competencies, org_entities, org_meetings |
| Finance/ledger/wallet | 201 | ai_answer_ledger, ai_security_ledger, ap360_tax_rules, approval_payment_links, carrier_capacity_ledger, carrier_settlement_destinations |
| Drivers/vehicles/fleet | 96 | air_fleet, commercial_vehicle_categories, delivery_driver_candidates, delivery_driver_scores, driver_achievement_progress, driver_achievement_tiers |
| Dispatch/trips/pricing | 96 | air_pricing_settings, air_quote_requests, alert_dispatch_dlq, ap360_overrides, ap360_quote_snapshots, asset_pricing_bands |
| Corporate/commercial | 94 | carrier_contracts, charter_document_registry, charter_idempotency_keys, charter_inventory, charter_notification_prefs, charter_partner_application_events |
| Delivery/logistics | 98 | delivery_assignment_queue, delivery_document_events, delivery_eta_predictions, delivery_fraud_signals, delivery_interventions, delivery_onboarding |
| Support/safety | 22 | fraud_cases, incident_nocs, incident_postmortems, incident_runbooks, legal_incidents, moc_incident_events |
| Academy/HR | 54 | academy_courses, academy_enrollments, academy_events, academy_feedback, academy_lesson_progress, academy_lessons |
| Other / platform | 693 | access_denials, account_takeover_alerts, admin_backup_codes, admin_device_registry, admin_email_test_runs, admin_login_attempts |

## TaxiD-only objects to preserve (newer work, never overwrite)

app_download_clicks, business_organisation_members, business_organisations, business_requests, driver_earnings, support_assignment_events, support_messages, support_threads