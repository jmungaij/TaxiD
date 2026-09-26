/**
 * Central analytics event registry.
 *
 * Every <AppButton analytics="..."> value SHOULD live here so that:
 *  • events are discoverable
 *  • naming stays consistent (domain.action[_qualifier])
 *  • the button-audit CI gate can cross-check coverage
 *
 * Convention: `<domain>.<surface>.<action>` lowercase snake_case.
 * Existing legacy names kept verbatim for back-compat.
 */
export const AnalyticsEvents = {
  // ----- Marketing -----
  HERO_BOOK_RIDE: "hero_book_ride",
  HERO_BECOME_DRIVER: "hero_become_driver",
  HERO_CORPORATE_DEMO: "hero_corporate_demo",
  MARKETING_GET_STARTED: "marketing.get_started",
  MARKETING_TALK_TO_SALES: "marketing.talk_to_sales",
  MARKETING_PARTNER_WITH_US: "marketing.partner_with_us",
  MARKETING_EXPLORE_ENTERPRISE: "marketing.explore_enterprise",
  MARKETING_CONTACT_SALES: "marketing.contact_sales",

  // ----- Driver funnel -----
  DRIVER_HERO_APPLY: "driver_hero_apply",
  DRIVER_HERO_EARNINGS: "driver_hero_earnings",
  DRIVER_HERO_ECOSYSTEM: "driver_hero_ecosystem",
  DRIVER_START_DRIVING: "driver.start_driving",
  DRIVER_BENEFITS_JOIN: "driver.benefits.join",
  DRIVER_BENEFITS_APPLY: "driver.benefits.apply",
  DRIVER_EARNINGS_START: "driver.earnings.start_driving",
  DRIVER_ACADEMY_START_LEARNING: "driver.academy.start_learning",
  DRIVER_ACADEMY_CONTINUE: "driver.academy.continue",
  DRIVER_ACADEMY_BECOME_CERTIFIED: "driver.academy.become_certified",

  // ----- Rider funnel -----
  RIDER_APP_INSTALL_IOS: "rider_app_install_ios",
  RIDER_APP_INSTALL_ANDROID: "rider_app_install_android",
  RIDER_BOOK_RIDE: "rider.book_ride",
  RIDER_NOTIFICATIONS_OPEN: "rider.notifications.open",
  RIDER_SIGN_OUT: "rider.sign_out",

  // ----- Corporate -----
  CORPORATE_BOOK_DEMO: "corporate_book_demo",
  CORPORATE_CONTACT_SALES: "enterprise.contact_sales",

  // ----- Charter portal access -----
  CHARTER_PORTAL_LOGIN_REDIRECT: "charter.portal.login_redirect",
  CHARTER_PORTAL_LOGIN_REQUESTED_DESTINATION: "charter.portal.login_requested_destination",
  CHARTER_PORTAL_PERMISSION_BLOCKED: "charter.portal.permission_blocked",


  // ----- Employee Mobility funnel -----
  EM_HERO_BOOK: "employee_mobility.hero.book",
  EM_HERO_OPEN_ACCOUNT: "employee_mobility.hero.open_account",
  EM_HERO_TALK_TO_CONSULTANT: "employee_mobility.hero.talk_to_consultant",
  EM_WIDGET_GET_QUOTE: "employee_mobility.widget.get_quote",
  EM_STICKY_CTA_BOOK: "employee_mobility.sticky_cta.book",
  EM_CLOSING_BOOK_NOW: "employee_mobility.closing.book_now",
  EM_CONSULTANT_SUBMITTED: "employee_mobility.consultant.submitted",

  // ----- Rentals & Leasing -----
  RENTALS_TAB_CLICK: "rentals.tab.click",
  RENTALS_CATEGORY_SELECT: "rentals.category.select",
  RENTALS_QUOTE_REQUESTED: "rentals.quote.requested",
  RENTALS_ENQUIRY_STARTED: "rentals.enquiry.started",
  RENTALS_ENQUIRY_COMPLETED: "rentals.enquiry.completed",
  RENTALS_CTA_IMPRESSION: "rentals.cta.impression",
  RENTALS_TAB_VISIBLE: "rentals.tab.visible",

  // ----- Careers -----
  CAREERS_APPLY: "careers.apply",

  // ----- Admin / Ops -----
  ADMIN_EXPORT_DOWNLOAD: "admin.export.download",
  ADMIN_HEADER_NOTIFICATIONS: "admin.header.notifications",
  ADMIN_HEADER_TOGGLE_SIDEBAR: "admin.header.toggle_sidebar",
  ADMIN_SIGN_OUT: "admin.sign_out",
  ADMIN_DRIVERS_ADD: "admin.drivers.add",
  ADMIN_RIDERS_ADD: "admin.riders.add",
  ADMIN_TRIPS_SCHEDULE: "admin.trips.schedule",
  ADMIN_MAP_FILTER: "admin.map.filter",
  ADMIN_MAP_FULLSCREEN: "admin.map.fullscreen",
  ADMIN_MAP_SHOW_DRIVERS: "admin.map.show_drivers",
  ADMIN_MAP_SHOW_TRIPS: "admin.map.show_trips",
  DISPATCH_FILTERS_APPLY: "dispatch.filters.apply",

  // ----- Governance / Audit -----
  AUDIT_CSV_EXPORTED: "audit.csv.exported",
  UNAUTHORIZED_ACCESS_ATTEMPT: "auth.unauthorized_access_attempt",
  RECONCILIATION_CASE_OPENED: "reconciliation.case.opened",
  RECONCILIATION_RESOLVED: "reconciliation.resolved",
} as const;

export type AnalyticsEventName =
  (typeof AnalyticsEvents)[keyof typeof AnalyticsEvents];
