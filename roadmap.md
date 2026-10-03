# Roadmap

- [x] Vehicle catalogue + official pricing and charter rate card
- [x] Phase 2a: funding authorisation (hold company wallet/credit at confirm, capture/release on completion)
- [x] Phase 2b: immutable trip ledger + idempotency
- [x] Phase 2c: department/cost-centre budgets
- [x] Charter quotes priced from taxid_rate_card
- [ ] Apply dynamic multipliers (pricing_modifiers) inside the fare calculation
- [x] Airport distance pricing with zone floor + Quote & Book screen
- [x] Funding portal (M-Pesa top-up, super-admin credit approval, payment history)
- [x] Charter day-rate booking flow (wallet debit; M-Pesa payment_initiate still pending)
- [ ] Approve real drivers so trips dispatch (needs real driver sign-ups)
- [x] Charter M-Pesa booking payment (payment_initiate) + webhook events on booking/flight changes
- [ ] payment.confirmed webhook from M-Pesa callback
- [ ] Yalla Beena KYB end-to-end (needs the real 3 documents uploaded by the user)
- [ ] 84 missing backend services still called by older screens (top: contact-submission, alert-dispatch, send-transactional-email, report-export-dispatcher, logistics-quote, document-signing, refund-execute, invoice-send)
