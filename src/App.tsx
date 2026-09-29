import { Suspense, lazy } from "react";
import { lazyWithRetry } from "@/lib/lazyWithRetry";
import { LEGACY_PRICING_ROUTES } from "@/lib/pricing360/legacyRoutes";
import { StabilizationBanner } from "@/components/payments/StabilizationBanner";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import Layout from "./components/layout/Layout";




import { RequireTier } from "./components/auth/RequireTier";

import { Step3Verification, Step4Documents, Step5Review } from "./pages/corporate/register/RegisterSteps";
import { RequireCorporate } from "./components/auth/RequireCorporate";
import { DashboardLayout } from "./components/dashboard/DashboardLayout";

import { NavigationTracker } from "./components/nav/NavigationTracker";
import { RequireRole } from "./components/auth/RequireRole";
import { CommandPalette } from "./components/nav/CommandPalette";
import RequireStaffPortal from "@/components/staff/StaffAccessProvider";
import { StaffErrorBoundary } from "@/components/staff/StaffErrorBoundary";


/* Route-level code splitting — keeps the initial marketing bundle small. */
const Home = lazyWithRetry(() => import("./pages/marketing/Home"));
const About = lazyWithRetry(() => import("./pages/marketing/About"));
const Riders = lazyWithRetry(() => import("./pages/marketing/Riders"));
const Drivers = lazyWithRetry(() => import("./pages/marketing/Drivers"));
const Corporates = lazyWithRetry(() => import("./pages/marketing/Corporates"));
const BusinessPortal = lazyWithRetry(() => import("./pages/business/BusinessPortal"));
const CorporateProfile = lazyWithRetry(() => import("./pages/marketing/CorporateProfile"));
const EnterpriseDemo = lazyWithRetry(() => import("./pages/marketing/EnterpriseDemo"));
const EmployeeMobility = lazyWithRetry(() => import("./pages/marketing/EmployeeMobility"));
const CorporateTravelManagement = lazyWithRetry(() => import("./pages/marketing/CorporateTravelManagement"));
const Delivery = lazyWithRetry(() => import("./pages/marketing/Delivery"));
const PackageDelivery = lazyWithRetry(() => import("./pages/delivery/PackageDelivery"));
const Courier = lazyWithRetry(() => import("./pages/delivery/Courier"));
const FleetManagement = lazyWithRetry(() => import("./pages/delivery/FleetManagement"));
const Logistics = lazyWithRetry(() => import("./pages/delivery/Logistics"));
const BookParcel = lazyWithRetry(() => import("./pages/delivery/BookParcel"));
const TrackParcel = lazyWithRetry(() => import("./pages/delivery/TrackParcel"));
const FreightEnquiry = lazyWithRetry(() => import("./pages/delivery/FreightEnquiry"));

const OpsHub = lazyWithRetry(() => import("./pages/delivery/ops/OpsHub"));
const PartnerPortal = lazyWithRetry(() => import("./pages/delivery/PartnerPortal"));
const LogisticsOnboarding = lazyWithRetry(() => import("./pages/dashboard/admin/LogisticsOnboarding"));
const LogisticsCapabilities = lazyWithRetry(() => import("./pages/dashboard/admin/LogisticsCapabilities"));
const OpsPackages = lazyWithRetry(() => import("./pages/delivery/ops/Packages"));
const OpsPackageDetail = lazyWithRetry(() => import("./pages/delivery/ops/PackageDetail"));
const OpsPodPicker = lazyWithRetry(() => import("./pages/delivery/ops/PodPicker"));
const OpsPodCapture = lazyWithRetry(() => import("./pages/delivery/ops/PodCapture"));
const OpsDispatch = lazyWithRetry(() => import("./pages/delivery/ops/Dispatch"));
const OpsRoutes = lazyWithRetry(() => import("./pages/delivery/ops/Routes"));
const Rentals = lazyWithRetry(() => import("./pages/marketing/Rentals"));
const RentalsSelfDrive = lazyWithRetry(() => import("./pages/marketing/RentalsSelfDrive"));
const RentalsChauffeur = lazyWithRetry(() => import("./pages/marketing/RentalsChauffeur"));
const LogisticsSolutions = lazyWithRetry(() => import("./pages/marketing/LogisticsSolutions"));
const LogisticsBusinessQuote = lazyWithRetry(() => import("./pages/marketing/LogisticsBusinessQuote"));
const RentalQuoteView = lazyWithRetry(() => import("./pages/marketing/RentalQuoteView"));
const RentalFleet = lazyWithRetry(() => import("./pages/dashboard/admin/RentalFleet"));
const RentalOperations = lazyWithRetry(() => import("./pages/dashboard/admin/RentalOperations"));
const CharterHub = lazyWithRetry(() => import("./pages/marketing/CharterHub"));
const CharterCategoryPage = lazyWithRetry(() => import("./pages/marketing/CharterCategory"));
const CharterBooking = lazyWithRetry(() => import("./pages/marketing/CharterBooking"));
const CharterBookingRedirect = lazyWithRetry(() => import("./pages/marketing/CharterBookingRedirect"));
const CharterBookingStatus = lazyWithRetry(() => import("./pages/marketing/CharterBookingStatus"));
const ReceiptVerify = lazyWithRetry(() => import("./pages/marketing/ReceiptVerify"));
const DocumentVerify = lazyWithRetry(() => import("./pages/marketing/DocumentVerify"));
const LetterVerify = lazyWithRetry(() => import("./pages/recruitment/LetterVerify"));
const ForensicDocumentVerify = lazyWithRetry(() => import("./pages/marketing/ForensicDocumentVerify"));
const DocumentSecurityCentre = lazyWithRetry(() => import("./pages/staff/documents/DocumentSecurityCentre"));
const StaffCompanyCollateral = lazyWithRetry(() => import("./pages/staff/documents/CompanyCollateral"));
const InterviewRespond = lazyWithRetry(() => import("./pages/recruitment/InterviewRespond"));
const DocumentAcknowledge = lazyWithRetry(() => import("./pages/recruitment/DocumentAcknowledge"));
const ProfessionAssessmentSitting = lazyWithRetry(() => import("./pages/recruitment/ProfessionAssessment"));

const TicketInspector = lazyWithRetry(() => import("./pages/marketing/TicketInspector"));
const HealthCheck = lazyWithRetry(() => import("./pages/marketing/HealthCheck"));
const DeploySmoke = lazyWithRetry(() => import("./pages/marketing/DeploySmoke"));
const CharterSearchPage = lazyWithRetry(() => import("./pages/marketing/CharterSearch"));
const MarketplacePage = lazyWithRetry(() => import("./pages/marketing/Marketplace"));
const SmartFarePage = lazyWithRetry(() => import("./pages/marketing/SmartFare"));
const AviationCenter = lazyWithRetry(() => import("./pages/dashboard/admin/AviationCenter"));
const CharterBookingAudit = lazyWithRetry(() => import("./pages/dashboard/admin/CharterBookingAudit"));
const CharterPricingAlerts = lazyWithRetry(() => import("./pages/dashboard/admin/CharterPricingAlerts"));
const SmartFareSettings = lazyWithRetry(() => import("./pages/dashboard/admin/SmartFareSettings"));
const Pricing360 = lazyWithRetry(() => import("./pages/dashboard/admin/Pricing360"));
const SocialDistribution = lazyWithRetry(() => import("./pages/dashboard/admin/SocialDistribution"));
const RoleGrantGovernance = lazyWithRetry(() => import("./pages/dashboard/admin/RoleGrantGovernance"));
const NavigationGovernance = lazyWithRetry(() => import("./pages/dashboard/admin/NavigationGovernance"));
const PricingAuditLog = lazyWithRetry(() => import("./pages/dashboard/admin/PricingAuditLog"));
const CommunicationPreferences = lazyWithRetry(() => import("./pages/account/CommunicationPreferences"));
const SecurityCentre = lazyWithRetry(() => import("./pages/account/SecurityCentre"));
const IdentityTrust = lazyWithRetry(() => import("./pages/dashboard/admin/IdentityTrust"));
const EmailDelivery = lazyWithRetry(() => import("./pages/dashboard/admin/EmailDelivery"));
const PricingLegacyRedirect = lazyWithRetry(() => import("./components/pricing360/PricingLegacyRedirect"));
const SmartFareVersions = lazyWithRetry(() => import("./pages/dashboard/admin/SmartFareVersions"));
const SmartFareWhatIf = lazyWithRetry(() => import("./pages/dashboard/admin/SmartFareWhatIf"));
const SecurityFindings = lazyWithRetry(() => import("./pages/dashboard/admin/SecurityFindings"));
const AlertNotificationPrefs = lazyWithRetry(() => import("./pages/dashboard/admin/AlertNotificationPrefs"));
const CharterRetryTimeline = lazyWithRetry(() => import("./pages/dashboard/admin/CharterRetryTimeline"));
const RoadApprovalQueue = lazyWithRetry(() => import("./pages/dashboard/admin/RoadApprovalQueue"));
const CorporateWalletFinance = lazyWithRetry(() => import("./pages/dashboard/admin/CorporateWalletFinance"));
const ScheduledJobHealth = lazyWithRetry(() => import("./pages/dashboard/admin/ScheduledJobHealth"));
const FlightHub = lazyWithRetry(() => import("./pages/dashboard/admin/flighthub/FlightHub"));
const FlightsConsole = lazyWithRetry(() => import("./pages/dashboard/admin/flighthub/FlightsConsole"));
const PartnerOnboarding = lazyWithRetry(() => import("./pages/dashboard/admin/flighthub/PartnerOnboarding"));
const FlightLifecycle = lazyWithRetry(() => import("./pages/dashboard/admin/flighthub/Lifecycle"));
const FlightPayments = lazyWithRetry(() => import("./pages/dashboard/admin/flighthub/Payments"));
const FlightPricingControl = lazyWithRetry(() => import("./pages/dashboard/admin/flighthub/PricingControl"));
const FlightCompliance = lazyWithRetry(() => import("./pages/dashboard/admin/flighthub/Compliance"));
const CustomerRelations = lazyWithRetry(() => import("./pages/dashboard/admin/flighthub/CustomerRelations"));
const SupportDesk = lazyWithRetry(() => import("./pages/dashboard/admin/flighthub/SupportDesk"));
const FlightOperationsCenter = lazyWithRetry(() => import("./pages/dashboard/admin/flighthub/OperationsCenter"));
const Pricing = lazyWithRetry(() => import("./pages/marketing/Pricing"));
const FAQ = lazyWithRetry(() => import("./pages/marketing/FAQ"));
const News = lazyWithRetry(() => import("./pages/marketing/News"));
const Careers = lazyWithRetry(() => import("./pages/marketing/Careers"));
const CareerVacancy = lazyWithRetry(() => import("./pages/marketing/CareerVacancy"));
const CareerApply = lazyWithRetry(() => import("./pages/marketing/CareerApply"));
const CareerContinue = lazyWithRetry(() => import("./pages/marketing/CareerContinue"));
const Contact = lazyWithRetry(() => import("./pages/marketing/Contact"));
const MyClientPortal = lazyWithRetry(() => import("./pages/marketing/MyClientPortal"));
const BookAMeeting = lazyWithRetry(() => import("./pages/marketing/BookAMeeting"));
const ManageMeeting = lazyWithRetry(() => import("./pages/marketing/ManageMeeting"));
const MeetingsHub = lazyWithRetry(() => import("./pages/staff/MeetingsHub"));
const SalesAccessDashboard = lazyWithRetry(() => import("./pages/staff/SalesAccessDashboard"));
const StubPage = lazyWithRetry(() => import("./pages/marketing/StubPage"));
const Reliability = lazyWithRetry(() => import("./pages/marketing/company/Reliability"));
const Transparency = lazyWithRetry(() => import("./pages/marketing/company/Transparency"));
const Innovation = lazyWithRetry(() => import("./pages/marketing/company/Innovation"));
const CompliancePage = lazyWithRetry(() => import("./pages/marketing/company/Compliance"));
const Privacy = lazyWithRetry(() => import("./pages/marketing/company/Privacy"));
const Leadership = lazyWithRetry(() => import("./pages/marketing/company/Leadership"));
const Governance = lazyWithRetry(() => import("./pages/marketing/company/Governance"));
const Sustainability = lazyWithRetry(() => import("./pages/marketing/company/Sustainability"));
const DriverApply = lazyWithRetry(() => import("./pages/driver/Apply"));
const DriverPortal = lazyWithRetry(() => import("./pages/driver/Portal"));

const DriverOnboarding = lazyWithRetry(() => import("./pages/driver/Onboarding"));
const DriverStart = lazyWithRetry(() => import("./pages/driver/Start"));
const DriverEarnings = lazyWithRetry(() => import("./pages/driver/Earnings"));
const DriverWealth = lazyWithRetry(() => import("./pages/driver/Wealth"));
const DriverBenefits = lazyWithRetry(() => import("./pages/driver/Benefits"));
const DriverAcademy = lazyWithRetry(() => import("./pages/driver/Academy"));
const AcademyCourse = lazyWithRetry(() => import("./pages/driver/AcademyCourse"));
const DriverSafety = lazyWithRetry(() => import("./pages/driver/Safety"));
const DriverSupport = lazyWithRetry(() => import("./pages/driver/Support"));
const Dashboard = lazyWithRetry(() => import("./pages/Dashboard"));
const RidersPage = lazyWithRetry(() => import("./pages/RidersPage"));
const DriversPage = lazyWithRetry(() => import("./pages/DriversPage"));
const TripsPage = lazyWithRetry(() => import("./pages/TripsPage"));
const MapView = lazyWithRetry(() => import("./pages/MapView"));
const NotFound = lazyWithRetry(() => import("./pages/NotFound"));
const Unauthorized = lazyWithRetry(() => import("./pages/Unauthorized"));
const CorporateAccessRequired = lazyWithRetry(() => import("./pages/corporate/CorporateAccessRequired"));
const AuthPage = lazyWithRetry(() => import("./pages/Auth"));
const OAuthConsent = lazyWithRetry(() => import("./pages/OAuthConsent"));
const CorporateLogin = lazyWithRetry(() => import("./pages/CorporateLogin"));
const CharterLogin = lazyWithRetry(() => import("./pages/CharterLogin"));
const ClientLogin = lazyWithRetry(() => import("./pages/ClientLogin"));
const OperatorPayouts = lazyWithRetry(() => import("./pages/dashboard/charter/OperatorPayouts"));
const OperatorPortal = lazyWithRetry(() => import("./pages/dashboard/charter/OperatorPortal"));
const CharterAnalytics = lazyWithRetry(() => import("./pages/dashboard/charter/CharterAnalytics"));
const CharterBusinessPortal = lazyWithRetry(() => import("./pages/dashboard/charter/CharterBusinessPortal"));
const CorporateCharterWorkspace = lazyWithRetry(() => import("./pages/dashboard/ccb/CorporateCharterWorkspace"));
const CorporateCharterOperations = lazyWithRetry(() => import("./pages/dashboard/admin/CorporateCharterOperations"));
const ElitePremiumHome = lazyWithRetry(() => import("./pages/dashboard/premium/ElitePremiumHome"));
const PremiumUpgrade = lazyWithRetry(() => import("./pages/dashboard/premium/PremiumUpgrade"));
const RegisterWizardLayout = lazyWithRetry(() => import("./pages/corporate/register/RegisterWizardLayout"));
const Step1Personal = lazyWithRetry(() => import("./pages/corporate/register/Step1Personal"));
const Step2Business = lazyWithRetry(() => import("./pages/corporate/register/Step2Business"));
const ApplicantStatus = lazyWithRetry(() => import("./pages/corporate/register/ApplicantStatus"));
const ResetPassword = lazyWithRetry(() => import("./pages/ResetPassword"));
const Unsubscribe = lazyWithRetry(() => import("./pages/Unsubscribe"));
const LeadContactReply = lazyWithRetry(() => import("./pages/lead/ContactReply"));
const StatusTokens = lazyWithRetry(() => import("./pages/design/StatusTokens"));
const RiderDashboard = lazyWithRetry(() => import("./pages/dashboard/RiderDashboard"));
const DriverDashboard = lazyWithRetry(() => import("./pages/dashboard/DriverDashboard"));
const CorporateDashboard = lazyWithRetry(() => import("./pages/dashboard/CorporateDashboard"));
const AdminDashboard = lazyWithRetry(() => import("./pages/dashboard/AdminDashboard"));
const UsersDirectory = lazyWithRetry(() => import("./pages/dashboard/admin/UsersDirectory"));
const AdminPayments = lazyWithRetry(() => import("./pages/dashboard/admin/Payments"));
const MpesaDiagnostics = lazyWithRetry(() => import("./pages/dashboard/admin/MpesaDiagnostics"));
const PaymentJourney = lazyWithRetry(() => import("./pages/dashboard/admin/PaymentJourney"));
const PaymentCertification = lazyWithRetry(() => import("./pages/dashboard/admin/PaymentCertification"));
const PaymentOperationsCenter = lazyWithRetry(() => import("./pages/dashboard/admin/PaymentOperationsCenter"));
const OperationsCenter = lazyWithRetry(() => import("./pages/dashboard/admin/OperationsCenter"));
const FosOperations = lazyWithRetry(() => import("./pages/dashboard/admin/FosOperations"));
const AnalyticsExport = lazyWithRetry(() => import("./pages/dashboard/admin/AnalyticsExport"));
const AdminTax = lazyWithRetry(() => import("./pages/dashboard/admin/Tax"));
const DriverTax = lazyWithRetry(() => import("./pages/dashboard/driver/Tax"));
const DriverProfilePage = lazyWithRetry(() => import("./pages/dashboard/driver/Profile"));
const DriverWalletPage = lazyWithRetry(() => import("./pages/dashboard/driver/Wallet"));
const DriverDocumentsPage = lazyWithRetry(() => import("./pages/dashboard/driver/Documents"));
const DriverPayoutsPage = lazyWithRetry(() => import("./pages/dashboard/driver/Payouts"));
const NavigationHealth = lazyWithRetry(() => import("./pages/dashboard/admin/NavigationHealth"));
const KycTypes = lazyWithRetry(() => import("./pages/dashboard/admin/KycTypes"));
const Compliance = lazyWithRetry(() => import("./pages/dashboard/admin/Compliance"));
const ComplianceAlerts = lazyWithRetry(() => import("./pages/dashboard/admin/ComplianceAlerts"));
const DigitalTwin = lazyWithRetry(() => import("./pages/dashboard/admin/DigitalTwin"));
const DriverLifecycle = lazyWithRetry(() => import("./pages/dashboard/admin/DriverLifecycle"));
const DriverDashboardReal = lazyWithRetry(() => import("./pages/driver/Dashboard"));
const AdminAcademy = lazyWithRetry(() => import("./pages/dashboard/admin/Academy"));
const DeliveryFraud = lazyWithRetry(() => import("./pages/dashboard/admin/DeliveryFraud"));
const OutboxMonitor = lazyWithRetry(() => import("./pages/dashboard/admin/OutboxMonitor"));
const DispatchOps = lazyWithRetry(() => import("./pages/dashboard/admin/DispatchOps"));
const DispatchSim = lazyWithRetry(() => import("./pages/dashboard/admin/DispatchSim"));
const FraudCenter = lazyWithRetry(() => import("./pages/dashboard/admin/FraudCenter"));
const IdentityAssurance = lazyWithRetry(() => import("./pages/dashboard/admin/IdentityAssurance"));
const NocConsole = lazyWithRetry(() => import("./pages/dashboard/admin/NocConsole"));
const GovernanceConsole = lazyWithRetry(() => import("./pages/dashboard/admin/GovernanceConsole"));
const SecurityCenter = lazyWithRetry(() => import("./pages/marketing/SecurityCenter"));
const TrustCenter = lazyWithRetry(() => import("./pages/dashboard/admin/TrustCenter"));
const Enterprise = lazyWithRetry(() => import("./pages/marketing/Enterprise"));
const Support = lazyWithRetry(() => import("./pages/marketing/Support"));
const Developers = lazyWithRetry(() => import("./pages/marketing/Developers"));
const ConnectAiAssistants = lazyWithRetry(() => import("./pages/marketing/ConnectAiAssistants"));
const ApiDocs = lazyWithRetry(() => import("./pages/marketing/ApiDocs"));
const SafetyCentre = lazyWithRetry(() => import("./pages/marketing/SafetyCentre"));
const LegalDocument = lazyWithRetry(() => import("./pages/marketing/LegalDocument"));
const LegalLibrary = lazyWithRetry(() => import("./pages/marketing/LegalLibrary"));
const ContactSubmissions = lazyWithRetry(() => import("./pages/dashboard/admin/ContactSubmissions"));
const SalesLeads = lazyWithRetry(() => import("./pages/dashboard/admin/SalesLeads"));
const PlatformSettings = lazyWithRetry(() => import("./pages/dashboard/admin/PlatformSettings"));
const SecurityAudit = lazyWithRetry(() => import("./pages/dashboard/admin/SecurityAudit"));
const AdminTripDetail = lazy(() => import("./pages/dashboard/admin/TripDetail"));
const TripShareAdmin = lazyWithRetry(() => import("./pages/dashboard/admin/TripShareAdmin"));
const AssuranceDashboard = lazyWithRetry(() => import("./pages/dashboard/admin/AssuranceDashboard"));
const PolicyAssurance = lazyWithRetry(() => import("./pages/dashboard/admin/PolicyAssurance"));
const SecurityScanCenter = lazyWithRetry(() => import("./pages/dashboard/admin/SecurityScanCenter"));
const PolicyExceptions = lazyWithRetry(() => import("./pages/dashboard/admin/PolicyExceptions"));
const PolicyAlertSettings = lazyWithRetry(() => import("./pages/dashboard/admin/PolicyAlertSettings"));
const CorporateTravelGuide = lazyWithRetry(() => import("./pages/marketing/CorporateTravelGuide"));
const RiderBook = lazyWithRetry(() => import("./pages/rider/Book"));
const RiderTrips = lazyWithRetry(() => import("./pages/rider/Trips"));
const RiderTripDetail = lazyWithRetry(() => import("./pages/rider/TripDetail"));
const RiderTripShare = lazyWithRetry(() => import("./pages/rider/TripShare"));
const RiderWallet = lazyWithRetry(() => import("./pages/rider/Wallet"));
const RiderSupport = lazyWithRetry(() => import("./pages/rider/Support"));
const RiderInbox = lazyWithRetry(() => import("./pages/rider/Inbox"));
const AgentLogin = lazyWithRetry(() => import("./pages/agent/AgentLogin"));
const AgentPortal = lazyWithRetry(() => import("./pages/agent/AgentPortal"));
const RiderSafety = lazyWithRetry(() => import("./pages/rider/Safety"));
const RiderSchedule = lazyWithRetry(() => import("./pages/rider/Schedule"));
const RiderAirport = lazyWithRetry(() => import("./pages/rider/Airport"));
const RiderFavorites = lazyWithRetry(() => import("./pages/rider/Favorites"));
const RiderRentals = lazyWithRetry(() => import("./pages/rider/Rentals"));
const RiderRewards = lazyWithRetry(() => import("./pages/rider/Rewards"));
const AdminCommandCenter = lazyWithRetry(() => import("./pages/dashboard/admin/AdminCommandCenter"));
const IntegrityReport = lazyWithRetry(() => import("./pages/dashboard/admin/IntegrityReport"));
const IntegrityGates = lazyWithRetry(() => import("./pages/dashboard/admin/IntegrityGates"));
const ProductionReadiness = lazyWithRetry(() => import("./pages/dashboard/admin/ProductionReadiness"));
const CtaAnalytics = lazyWithRetry(() => import("./pages/dashboard/admin/CtaAnalytics"));
const IntegrityThresholdAudit = lazyWithRetry(() => import("./pages/dashboard/admin/IntegrityThresholdAudit"));
const DriverAdministration = lazyWithRetry(() => import("./pages/dashboard/admin/DriverAdministration"));
const Driver360 = lazyWithRetry(() => import("./pages/dashboard/admin/Driver360"));
const Rider360 = lazyWithRetry(() => import("./pages/dashboard/admin/Rider360"));
const RiderDirectory = lazyWithRetry(() => import("./pages/dashboard/admin/RiderDirectory"));
const RiderManagement = lazyWithRetry(() => import("./pages/dashboard/admin/RiderManagement"));
const Corporate360 = lazyWithRetry(() => import("./pages/dashboard/admin/Corporate360"));
const CorporateControlTower = lazyWithRetry(() => import("./pages/dashboard/admin/CorporateControlTower"));
const CorporateApprovalsInbox = lazyWithRetry(() => import("./pages/dashboard/admin/CorporateApprovalsInbox"));
const CorporateAssistedBooking = lazyWithRetry(() => import("./pages/dashboard/admin/CorporateAssistedBooking"));
const CorporateBookingOps = lazyWithRetry(() => import("./pages/dashboard/admin/CorporateBookingOps"));
const CorporateAdminAuditLog = lazyWithRetry(() => import("./pages/dashboard/admin/CorporateAdminAuditLog"));
const CorporateMobilityAnalytics = lazyWithRetry(() => import("./pages/dashboard/admin/CorporateMobilityAnalytics"));
const CorporateOperatingSystem = lazyWithRetry(() => import("./pages/dashboard/admin/CorporateOperatingSystem"));
const CorporateSupportDesk = lazyWithRetry(() => import("./pages/dashboard/admin/CorporateSupportDesk"));
const CorporateOpsAlerts = lazyWithRetry(() => import("./pages/dashboard/admin/CorporateOpsAlerts"));
const CorporateAdminPermissions = lazyWithRetry(() => import("./pages/dashboard/admin/CorporateAdminPermissions"));
const Fleet360 = lazyWithRetry(() => import("./pages/dashboard/admin/Fleet360"));
const FleetDirectory = lazyWithRetry(() => import("./pages/dashboard/admin/FleetDirectory"));
const StaffManagement = lazyWithRetry(() => import("./pages/dashboard/admin/StaffManagement"));
const DocumentReviewQueue = lazyWithRetry(() => import("./pages/dashboard/admin/DocumentReviewQueue"));
const AccessDebug = lazyWithRetry(() => import("./pages/dashboard/admin/AccessDebug"));
const ExecutiveCommandCenter = lazyWithRetry(() => import("./pages/dashboard/admin/ExecutiveCommandCenter"));
const ExecutiveCommandCentre = lazyWithRetry(() => import("./pages/dashboard/admin/ExecutiveCommandCentre"));
const ReportExportSchedules = lazyWithRetry(() => import("./pages/dashboard/admin/ReportExportSchedules"));
const ConciergeApprovalAudit = lazyWithRetry(() => import("./pages/dashboard/admin/ConciergeApprovalAudit"));
const IncidentDetail = lazyWithRetry(() => import("./pages/dashboard/admin/IncidentDetail"));
const GovernanceAccessMatrix = lazyWithRetry(() => import("./pages/dashboard/admin/GovernanceAccessMatrix"));
const ExportJobHistory = lazyWithRetry(() => import("./pages/dashboard/admin/ExportJobHistory"));
const MyAlertPreferences = lazyWithRetry(() => import("./pages/dashboard/admin/MyAlertPreferences"));
const CorporateAccountCommandCentre = lazyWithRetry(() => import("./pages/dashboard/admin/CorporateAccountCommandCentre"));
const ExecutiveIntelligence = lazyWithRetry(() => import("./pages/dashboard/admin/ExecutiveIntelligence"));
const CenterHub = lazyWithRetry(() => import("./pages/dashboard/admin/CenterHub"));
const FinanceCenter = lazyWithRetry(() => import("./pages/dashboard/admin/FinanceCenter"));
const RefundsCenter = lazyWithRetry(() => import("./pages/dashboard/admin/RefundsCenter"));
const CustomerOperationsCenter = lazyWithRetry(() => import("./pages/dashboard/admin/CustomerOperationsCenter"));
const PlatformCenter = lazyWithRetry(() => import("./pages/dashboard/admin/PlatformCenter"));
const BackendOperations = lazyWithRetry(() => import("./pages/dashboard/admin/BackendOperations"));
const BusinessOperations = lazyWithRetry(() => import("./pages/dashboard/admin/BusinessOperations"));
const TrustSafetyCenter = lazyWithRetry(() => import("./pages/dashboard/admin/TrustSafetyCenter"));
const PeoplePartnersCenter = lazyWithRetry(() => import("./pages/dashboard/admin/PeoplePartnersCenter"));
const MarketplaceCenter = lazyWithRetry(() => import("./pages/dashboard/admin/MarketplaceCenter"));
const DeliveryOperationsControlTower = lazyWithRetry(() => import("./pages/dashboard/admin/DeliveryOperationsControlTower"));
const LogisticsServiceActivation = lazyWithRetry(() => import("./pages/dashboard/admin/LogisticsServiceActivation"));
const LogisticsOrdersConsole = lazyWithRetry(() => import("./pages/dashboard/admin/LogisticsOrdersConsole"));
const LogisticsExceptions = lazyWithRetry(() => import("./pages/dashboard/admin/LogisticsExceptions"));
const LogisticsManifests = lazyWithRetry(() => import("./pages/dashboard/admin/LogisticsManifests"));
const LogisticsHubs = lazyWithRetry(() => import("./pages/dashboard/admin/LogisticsHubs"));
const LogisticsRoutes = lazyWithRetry(() => import("./pages/dashboard/admin/LogisticsRoutes"));
const LogisticsDelivery = lazyWithRetry(() => import("./pages/dashboard/admin/LogisticsDelivery"));
const LogisticsIntegrations = lazyWithRetry(() => import("./pages/dashboard/admin/LogisticsIntegrations"));
const LogisticsWarehouse = lazyWithRetry(() => import("./pages/dashboard/admin/LogisticsWarehouse"));
const OfflineSyncConsole = lazyWithRetry(() => import("./pages/dashboard/admin/OfflineSyncConsole"));
const LogisticsControlTower = lazyWithRetry(() => import("./pages/dashboard/admin/LogisticsControlTower"));
const AiControlTower = lazyWithRetry(() => import("./pages/dashboard/admin/AiControlTower"));
const InfrastructureDi00 = lazyWithRetry(() => import("./pages/dashboard/admin/InfrastructureDi00"));
const FreightProcurement = lazyWithRetry(() => import("./pages/dashboard/admin/FreightProcurement"));
const FreightAudit = lazyWithRetry(() => import("./pages/dashboard/admin/FreightAudit"));
const CarrierFreightWorkspace = lazyWithRetry(() => import("./pages/partners/CarrierFreightWorkspace"));
const LogisticsCenter = lazyWithRetry(() => import("./pages/dashboard/admin/LogisticsCenter"));
const Df10ValidationDashboard = lazyWithRetry(() => import("./pages/dashboard/admin/Df10ValidationDashboard"));
const FleetOwnerCompliance = lazyWithRetry(() => import("./pages/dashboard/admin/FleetOwnerCompliance"));
const DriverApplicationsAdmin = lazyWithRetry(() => import("./pages/dashboard/admin/DriverApplications"));
const PayoutConsole = lazyWithRetry(() => import("./pages/dashboard/admin/PayoutConsole"));

const FleetOwnerOnboarding = lazyWithRetry(() => import("./pages/partner/FleetOwnerOnboarding"));
const FleetOwnerApply = lazyWithRetry(() => import("./pages/partner/FleetOwnerApply"));
const CarrierApplications = lazyWithRetry(() => import("./pages/dashboard/admin/CarrierApplications"));
const FleetOwnerDeliveryEvidence = lazyWithRetry(() => import("./pages/partner/FleetOwnerDeliveryEvidence"));
const FleetOwnerPortal = lazyWithRetry(() => import("./pages/partner/FleetOwnerPortal"));
const ServiceProviderClaimsPage = lazyWithRetry(() => import("./pages/dashboard/admin/ServiceProviderClaims"));

const FleetOwnerDocumentReview = lazyWithRetry(() => import("./pages/dashboard/admin/FleetOwnerDocumentReview"));
const CarrierPodReview = lazyWithRetry(() => import("./pages/dashboard/admin/CarrierPodReview"));
const ProductionCommandCenter = lazyWithRetry(() => import("./pages/dashboard/admin/ProductionCommandCenter"));
const LegalControlCentre = lazyWithRetry(() => import("./pages/dashboard/admin/LegalControlCentre"));
const RuntimeDiagnostics = lazyWithRetry(() => import("./pages/dashboard/admin/RuntimeDiagnostics"));
const PeopleConsole = lazyWithRetry(() => import("./pages/dashboard/admin/PeopleConsole"));
const PartnerInvite = lazyWithRetry(() => import("./pages/dashboard/admin/PartnerInvite"));
const AdminAuditLog = lazyWithRetry(() => import("./pages/dashboard/admin/AdminAuditLog"));
const AccessDenials = lazyWithRetry(() => import("./pages/dashboard/admin/AccessDenials"));
const AlertRules = lazyWithRetry(() => import("./pages/dashboard/admin/AlertRules"));
const AdminAlerts = lazyWithRetry(() => import("./pages/dashboard/admin/AdminAlerts"));
const AuditSchedules = lazyWithRetry(() => import("./pages/dashboard/admin/AuditSchedules"));
const DocumentSlaSettings = lazyWithRetry(() => import("./pages/dashboard/admin/DocumentSlaSettings"));
const MLPlatform = lazyWithRetry(() => import("./pages/dashboard/admin/MLPlatform"));
const GovernanceCenter = lazyWithRetry(() => import("./pages/dashboard/admin/GovernanceCenter"));
const AdminPaybillProofs = lazyWithRetry(() => import("./pages/dashboard/admin/PaybillProofs"));
const NocIncidents = lazyWithRetry(() => import("./pages/dashboard/admin/NocIncidents"));
const AdminReconciliation = lazyWithRetry(() => import("./pages/dashboard/admin/Reconciliation"));
const ReconciliationCase = lazyWithRetry(() => import("./pages/dashboard/admin/ReconciliationCase"));
const Observability = lazyWithRetry(() => import("./pages/dashboard/admin/Observability"));
const EventOutbox = lazyWithRetry(() => import("./pages/dashboard/admin/Outbox"));
const PaymentDLQ = lazyWithRetry(() => import("./pages/dashboard/admin/PaymentDLQ"));
const OutboxDlq = lazyWithRetry(() => import("./pages/dashboard/admin/OutboxDlq"));
const CorporateKyb = lazyWithRetry(() => import("./pages/dashboard/admin/CorporateKyb"));
const BankGuarantees = lazyWithRetry(() => import("./pages/dashboard/admin/BankGuarantees"));
const MpesaPayments = lazyWithRetry(() => import("./pages/dashboard/admin/MpesaPayments"));
const CorporateAdminPortal = lazyWithRetry(() => import("./pages/dashboard/admin/CorporateAdminPortal"));
const CorporateKybAuditLog = lazyWithRetry(() => import("./pages/dashboard/admin/CorporateKybAuditLog"));
const ExportAuditTrail = lazyWithRetry(() => import("./pages/dashboard/admin/ExportAuditTrail"));
const FraudCases = lazyWithRetry(() => import("./pages/dashboard/admin/FraudCases"));
const ReconciliationMismatches = lazyWithRetry(() => import("./pages/dashboard/admin/ReconciliationMismatches"));
const RenameBackfillMonitor = lazyWithRetry(() => import("./pages/dashboard/admin/RenameBackfillMonitor"));
const PrivilegedUpdatesAudit = lazyWithRetry(() => import("./pages/dashboard/admin/PrivilegedUpdatesAudit"));
const PrivilegedMetricsDashboard = lazyWithRetry(() => import("./pages/dashboard/admin/PrivilegedMetricsDashboard"));
const BrandGovernance = lazyWithRetry(() => import("./pages/dashboard/admin/BrandGovernance"));

/* Staff 360 — TaxiD staff portal */
const StaffPortalLanding = lazyWithRetry(() => import("./pages/staff/StaffPortalLanding"));
const StaffAccessGateway = lazyWithRetry(() => import("./pages/staff/StaffAccessGateway"));
const StaffSecurityAudit = lazyWithRetry(() => import("./pages/staff/StaffSecurityAudit"));
const StaffSearch = lazyWithRetry(() => import("./pages/staff/StaffSearch"));
const StaffWorkflows = lazyWithRetry(() => import("./pages/staff/StaffWorkflows"));
const StaffOperations = lazyWithRetry(() => import("./pages/staff/StaffOperations"));
const StaffAgentic = lazyWithRetry(() => import("./pages/staff/StaffAgentic"));
const StaffAdaptive = lazyWithRetry(() => import("./pages/staff/StaffAdaptive"));
const StaffValue = lazyWithRetry(() => import("./pages/staff/StaffValue"));
const StaffForensics = lazyWithRetry(() => import("./pages/staff/StaffForensics"));
const StaffControlTower = lazyWithRetry(() => import("./pages/staff/StaffControlTower"));
const StaffAskYalla = lazyWithRetry(() => import("./pages/staff/StaffAskYalla"));
const StaffProviderSupply = lazyWithRetry(() => import("./pages/staff/StaffProviderSupply"));
const StaffCommerceOS = lazyWithRetry(() => import("./pages/staff/StaffCommerceOS"));
const StaffFinancialCapture = lazyWithRetry(() => import("./pages/staff/StaffFinancialCapture"));
const StaffClosure = lazyWithRetry(() => import("./pages/staff/StaffClosure"));
const StaffExpansion = lazyWithRetry(() => import("./pages/staff/StaffExpansion"));
const StaffOrchestration = lazyWithRetry(() => import("./pages/staff/StaffOrchestration"));
const StaffAdaptiveMarketplace = lazyWithRetry(() => import("./pages/staff/StaffAdaptiveMarketplace"));
const OrgManagement = lazyWithRetry(() => import("./pages/staff/org/OrgManagement"));
const RoleBlueprints = lazyWithRetry(() => import("./pages/staff/workforce/RoleBlueprints"));
const SalesPortal = lazyWithRetry(() => import("./pages/staff/sales/SalesPortal"));
const LeadPipeline = lazyWithRetry(() => import("./pages/staff/sales/LeadPipeline"));
const CustomerRequests = lazyWithRetry(() => import("./pages/dashboard/CustomerRequests"));
const CustomerAccount = lazyWithRetry(() => import("./pages/dashboard/CustomerAccount"));
const WorkforceLaunchpad = lazyWithRetry(() => import("./pages/staff/workforce/Launchpad"));
const InternsDashboard = lazyWithRetry(() => import("./pages/staff/interns/InternsDashboard"));
const InternCohorts = lazyWithRetry(() => import("./pages/staff/interns/Cohorts"));
const InternRegister = lazyWithRetry(() => import("./pages/staff/interns/InternRegister"));
const InternTalentDiscovery = lazyWithRetry(() => import("./pages/staff/interns/TalentDiscovery"));
const InternGovernance = lazyWithRetry(() => import("./pages/staff/interns/InternGovernance"));
const Intern360 = lazyWithRetry(() => import("./pages/staff/interns/Intern360"));
const InternSupplyCommand = lazyWithRetry(() => import("./pages/staff/interns/SupplyCommand"));
const YallaPartners = lazyWithRetry(() => import("./pages/marketing/YallaPartners"));
const PartnerApply = lazyWithRetry(() => import("./pages/marketing/PartnerApply"));
const PartnerSegment = lazyWithRetry(() => import("./pages/marketing/PartnerSegment"));
const ApiPartners = lazyWithRetry(() => import("./pages/marketing/ApiPartners"));
const WhiteLabelPartners = lazyWithRetry(() => import("./pages/marketing/WhiteLabelPartners"));
const DeveloperConsole = lazyWithRetry(() => import("./pages/partners/DeveloperConsole"));
const PartnerWorkspace = lazyWithRetry(() => import("./pages/partners/PartnerWorkspace"));
const OperatorWorkPortal = lazyWithRetry(() => import("./pages/operator/Portal"));
const ProviderCapacityPortal = lazyWithRetry(() => import("./pages/provider/Capacity"));
const WhiteLabelWorkspace = lazyWithRetry(() => import("./pages/partners/WhiteLabelWorkspace"));
const StaffWhiteLabelOps = lazyWithRetry(() => import("./pages/staff/partners/WhiteLabelOpsConsole"));
const StaffPartnersCommand = lazyWithRetry(() => import("./pages/staff/partners/PartnersCommand"));
const StaffPartner360 = lazyWithRetry(() => import("./pages/staff/partners/Partner360"));
const StaffPartnerWorkQueues = lazyWithRetry(() => import("./pages/staff/partners/PartnerWorkQueues"));
const StaffPartnerSupply = lazyWithRetry(() => import("./pages/staff/partners/SupplyControlTower"));
const StaffPartnerMatching = lazyWithRetry(() => import("./pages/staff/partners/MatchingConsole"));
const StaffPartnerRisk = lazyWithRetry(() => import("./pages/staff/partners/PartnerRiskCentre"));
const StaffPartnerFunnel = lazyWithRetry(() => import("./pages/staff/partners/FunnelDashboard"));
const StaffPartnerTaskQueue = lazyWithRetry(() => import("./pages/staff/partners/LifecycleTaskQueue"));
const StaffPartnerJourney = lazyWithRetry(() => import("./pages/staff/partners/PartnerJourneyDetail"));
const StaffFleetOwnerConversion = lazyWithRetry(() => import("./pages/staff/partners/FleetOwnerConversion"));
const StaffFleetOwnerQueue = lazyWithRetry(() => import("./pages/staff/partners/FleetOwnerQueue"));
const InternRecruitmentPipeline = lazyWithRetry(() => import("./pages/staff/interns/RecruitmentPipeline"));
const InternshipProgrammeBuilder = lazyWithRetry(() => import("./pages/staff/interns/InternshipProgrammeBuilder"));
const PeopleManagement = lazyWithRetry(() => import("./pages/staff/org/PeopleManagement"));
const MyTeam = lazyWithRetry(() => import("./pages/staff/org/MyTeam"));
const StaffOnboarding = lazyWithRetry(() => import("./pages/staff/org/StaffOnboarding"));
const StaffRoleDashboard = lazyWithRetry(() => import("./pages/staff/RoleDashboard"));
const StaffCommunications = lazyWithRetry(() => import("./pages/staff/Communications"));
const StaffCalendar = lazyWithRetry(() => import("./pages/staff/Calendar"));
const StaffAdminPortal = lazyWithRetry(() => import("./pages/staff/org/AdminPortal"));
const StaffLinkBackfill = lazyWithRetry(() => import("./pages/staff/org/StaffLinkBackfill"));
const StaffProfile = lazyWithRetry(() => import("./pages/staff/org/StaffProfile"));
const ObjectivesManagement = lazyWithRetry(() => import("./pages/staff/org/ObjectivesManagement"));
const WorkQueue = lazyWithRetry(() => import("./pages/staff/org/WorkQueue"));
const StaffAuditTrail = lazyWithRetry(() => import("./pages/staff/org/AuditTrail"));
const SalesBaseline = lazyWithRetry(() => import("./pages/staff/org/SalesBaseline"));
const PerformanceScorecard = lazyWithRetry(() => import("./pages/staff/org/PerformanceScorecard"));
const MyWorkspace = lazyWithRetry(() => import("./pages/staff/ops/MyWorkspace"));
const WorkspaceCommercialLenses = lazyWithRetry(() => import("./pages/staff/workspace/CommercialLenses"));
const WorkspaceActivationPlan = lazyWithRetry(() => import("./pages/staff/workspace/ActivationPlan"));
const SalesManagerDesk = lazyWithRetry(() => import("./pages/staff/sales/SalesManagerDesk"));
const WorkspaceWorkQueue = lazyWithRetry(() => import("./pages/staff/workspace/WorkQueue"));
const WorkspaceExceptions = lazyWithRetry(() => import("./pages/staff/workspace/ExceptionCentre"));
const WorkspaceMeetings = lazyWithRetry(() => import("./pages/staff/workspace/MeetingIntelligence"));
const WorkspaceInboxPage = lazyWithRetry(() => import("./pages/staff/workspace/WorkspaceInbox"));
const WorkspaceAccount360 = lazyWithRetry(() => import("./pages/staff/workspace/Account360"));
const WorkspacePipelineInspection = lazyWithRetry(() => import("./pages/staff/workspace/PipelineInspection"));
const WorkspaceFieldMode = lazyWithRetry(() => import("./pages/staff/workspace/FieldMode"));
const WorkspaceCommercialBook = lazyWithRetry(() => import("./pages/staff/workspace/CommercialBook"));
const WorkspaceApprovals = lazyWithRetry(() => import("./pages/staff/workspace/Approvals"));
const OpsCommandBoard = lazyWithRetry(() => import("./pages/staff/ops/OpsCommandBoard"));
const OrchestrationStream = lazyWithRetry(() => import("./pages/staff/ops/OrchestrationStream"));


const StaffShell = lazyWithRetry(() => import("@/components/staff/StaffShell"));
const staffPages = () => import("./pages/staff/Staff360Pages");
const Staff360Home = lazyWithRetry(() => staffPages().then((m) => ({ default: m.Staff360Home })));
const StaffOrganisation = lazyWithRetry(() => staffPages().then((m) => ({ default: m.StaffOrganisation })));
const StaffDepartments = lazyWithRetry(() => staffPages().then((m) => ({ default: m.StaffDepartments })));
const StaffDepartmentDetail = lazyWithRetry(() => staffPages().then((m) => ({ default: m.StaffDepartmentDetail })));
const StaffRevenue = lazyWithRetry(() => staffPages().then((m) => ({ default: m.StaffRevenue })));
const StaffMarketplace = lazyWithRetry(() => staffPages().then((m) => ({ default: m.StaffMarketplace })));
const CrmAccounts = lazyWithRetry(() => import("@/pages/staff/crm/Accounts"));
const CrmDocuments = lazyWithRetry(() => import("@/pages/staff/crm/Documents"));
const CorporateCharterCommercial = lazyWithRetry(() => import("@/pages/staff/commercial/CorporateCharter"));
const CommercialDocuments = lazyWithRetry(() => import("@/pages/staff/commercial/Documents"));
const CommercialDocumentTemplates = lazyWithRetry(() => import("@/pages/staff/commercial/DocumentTemplates"));
const ProformaInvoices = lazy(() => import("./pages/staff/commercial/Proforma"));
const TaxInvoices = lazy(() => import("./pages/staff/commercial/Invoices"));
const PaymentCollections = lazy(() => import("./pages/staff/commercial/Collections"));
const AmendmentBilling = lazy(() => import("./pages/staff/commercial/AmendmentBilling"));
const ContractPortal = lazyWithRetry(() => import("./pages/portal/ContractPortal"));
const CustomerPortal = lazyWithRetry(() => import("./pages/portal/CustomerPortal"));
const PartnerLinkPortal = lazyWithRetry(() => import("./pages/portal/PartnerPortal"));
const RateCardPortal = lazy(() => import("./pages/staff/commercial/RateCards"));
const StaffSocialPublishing = lazyWithRetry(() => import("@/pages/staff/marketing/SocialPublishing"));

const RecruitmentDashboard = lazyWithRetry(() => import("@/pages/staff/recruitment/RecruitmentDashboard"));
const RecruitmentVacancies = lazyWithRetry(() => import("@/pages/staff/recruitment/Vacancies"));
const RecruitmentPipeline = lazyWithRetry(() => import("@/pages/staff/recruitment/Pipeline"));
const RecruitmentVacancy360 = lazyWithRetry(() => import("@/pages/staff/recruitment/Vacancy360"));
const RecruitmentCandidates = lazyWithRetry(() => import("@/pages/staff/recruitment/Candidates"));
const RecruitmentInterviews = lazyWithRetry(() => import("@/pages/staff/recruitment/Interviews"));
const RecruitmentOffers = lazyWithRetry(() => import("@/pages/staff/recruitment/Offers"));
const RecruitmentOnboarding = lazyWithRetry(() => import("@/pages/staff/recruitment/Onboarding"));
const RecruitmentScreening = lazyWithRetry(() => import("@/pages/staff/recruitment/Screening"));
const RecruitmentShortlist = lazyWithRetry(() => import("@/pages/staff/recruitment/Shortlist"));
const RecruitmentEvaluations = lazyWithRetry(() => import("@/pages/staff/recruitment/Evaluations"));
const RecruitmentAssessment = lazyWithRetry(() => import("@/pages/staff/recruitment/AssessmentWorkspace"));
const RecruitmentRoleSuitability = lazyWithRetry(() => import("@/pages/staff/recruitment/RoleSuitability"));
const RecruitmentPartnerLeads = lazyWithRetry(() => import("@/pages/staff/recruitment/PartnerLeads"));
const RecruitmentRoleApplications = lazyWithRetry(() => import("@/pages/staff/recruitment/RoleApplications"));
const RecruitmentComparison = lazyWithRetry(() => import("@/pages/staff/recruitment/Comparison"));
const RecruitmentQuestionGovernance = lazyWithRetry(() => import("@/pages/staff/recruitment/QuestionGovernance"));
const RecruitmentAssessmentBlueprints = lazyWithRetry(() => import("@/pages/staff/recruitment/AssessmentBlueprints"));
const RecruitmentApplicationReview = lazyWithRetry(() => import("@/pages/staff/recruitment/ApplicationReview"));
const RecruitmentTalentPool = lazyWithRetry(() => import("@/pages/staff/recruitment/TalentPool"));
const RecruitmentCommunications = lazyWithRetry(() => import("@/pages/staff/recruitment/Communications"));
const RecruitmentLetterCentre = lazyWithRetry(() => import("@/pages/staff/recruitment/LetterCentre"));
const RecruitmentTemplates = lazyWithRetry(() => import("@/pages/staff/recruitment/Templates"));
const RecruitmentSettings = lazyWithRetry(() => import("@/pages/staff/recruitment/Settings"));
const RecruitmentRequirementHistory = lazyWithRetry(() => import("@/pages/staff/recruitment/RequirementHistory"));
const RecruitmentAnalytics = lazyWithRetry(() => import("@/pages/staff/recruitment/Analytics"));
const RecruitmentPublicationHealth = lazyWithRetry(() => import("@/pages/staff/recruitment/PublicationHealth"));
const RecruitmentImportCentre = lazyWithRetry(() => import("@/pages/staff/recruitment/ImportCentre"));
const RecruitmentImportWizard = lazyWithRetry(() => import("@/pages/staff/recruitment/ImportWizard"));
const RecruitmentImportBatchConsole = lazyWithRetry(() => import("@/pages/staff/recruitment/ImportBatchConsole"));
const RecruitmentImportWorkerMonitor = lazyWithRetry(() => import("@/pages/staff/recruitment/ImportWorkerMonitor"));
const RecruitmentImportReconciliation = lazyWithRetry(() => import("@/pages/staff/recruitment/ImportReconciliation"));
const RecruitmentConflictResolution = lazyWithRetry(() => import("@/pages/staff/recruitment/ConflictResolution"));

const StaffCustomers = lazyWithRetry(() => staffPages().then((m) => ({ default: m.StaffCustomers })));
const StaffPeople = lazyWithRetry(() => staffPages().then((m) => ({ default: m.StaffPeople })));
const StaffKnowledge = lazyWithRetry(() => staffPages().then((m) => ({ default: m.StaffKnowledge })));
const StaffInnovation = lazyWithRetry(() => staffPages().then((m) => ({ default: m.StaffInnovation })));
const StaffIntelligence = lazyWithRetry(() => staffPages().then((m) => ({ default: m.StaffIntelligence })));
const StaffGovernance = lazyWithRetry(() => staffPages().then((m) => ({ default: m.StaffGovernance })));







const DELIVERY_OPERATOR_ROLES = [
  "driver",
  "admin",
  "super_admin",
  "operations_admin",
  "fleet_owner",
];

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <StabilizationBanner />
        <NavigationTracker />
        <CommandPalette />
        <Suspense fallback={<div className="min-h-dvh bg-background" aria-busy="true" />}>
        <Routes>
          {/* Marketing site */}
          <Route path="/" element={<Home />} />
          <Route path="/.lovable/oauth/consent" element={<OAuthConsent />} />
          <Route path="/about" element={<About />} />
          <Route path="/riders" element={<Riders />} />
          <Route path="/drivers" element={<Drivers />} />
          <Route path="/corporates" element={<Corporates />} />
          <Route path="/business/portal" element={<BusinessPortal />} />
          <Route path="/partners" element={<YallaPartners />} />
          <Route path="/partners/apply" element={<PartnerApply />} />
          <Route path="/partners/api" element={<ApiPartners />} />
          <Route path="/partners/api/console" element={<DeveloperConsole />} />
          <Route path="/partners/white-label" element={<WhiteLabelPartners />} />
          <Route path="/partners/white-label/workspace" element={<WhiteLabelWorkspace />} />
          <Route path="/partners/:segment" element={<PartnerSegment />} />
          <Route path="/partner/workspace" element={<PartnerWorkspace />} />
          <Route path="/provider/capacity" element={<ProviderCapacityPortal />} />
          <Route path="/operator" element={<OperatorWorkPortal />} />
          <Route path="/partner/freight" element={<CarrierFreightWorkspace />} />
          <Route path="/partner/fleet-owner/apply" element={<FleetOwnerApply />} />
          <Route path="/partner/fleet-owner" element={<FleetOwnerPortal />} />
          <Route path="/partner/fleet-owner/onboarding" element={<FleetOwnerOnboarding />} />
          <Route path="/partner/fleet-owner/delivery-evidence" element={<FleetOwnerDeliveryEvidence />} />
          <Route path="/corporate/login" element={<CorporateLogin />} />
          <Route path="/corporate/register" element={<RegisterWizardLayout />}>
            <Route index element={<Step1Personal />} />
            <Route path="personal" element={<Step1Personal />} />
            <Route path="business" element={<Step2Business />} />
            <Route path="verification" element={<Step3Verification />} />
            <Route path="documents" element={<Step4Documents />} />
            <Route path="review" element={<Step5Review />} />
          </Route>
          <Route path="/corporate/register/status" element={<ApplicantStatus />} />
          <Route path="/delivery" element={<Delivery />} />
          {/* Public marketing pages for delivery verticals — role-gate removed
              so anonymous prospects can read the offering from the site nav. */}
          <Route path="/delivery/package" element={<PackageDelivery />} />
          <Route path="/delivery/courier" element={<Courier />} />
          <Route path="/delivery/fleet" element={<FleetManagement />} />
          <Route path="/delivery/logistics" element={<Logistics />} />
          {/* Live parcel/courier booking and public tracking. */}
          <Route path="/delivery/book" element={<BookParcel />} />
          {/* Freight, truck, warehousing and fulfilment: specialist-quoted enquiry desk. */}
          <Route path="/delivery/enquiry" element={<FreightEnquiry />} />
          <Route path="/delivery/track" element={<Navigate to="/track" replace />} />
          <Route path="/track" element={<TrackParcel />} />


          <Route path="/delivery/portal" element={<PartnerPortal />} />
          <Route
            path="/delivery/ops"
            element={<RequireRole roles={DELIVERY_OPERATOR_ROLES}><OpsHub /></RequireRole>}
          />
          <Route
            path="/delivery/ops/packages"
            element={<RequireRole roles={DELIVERY_OPERATOR_ROLES}><OpsPackages /></RequireRole>}
          />
          <Route
            path="/delivery/ops/packages/:id"
            element={<RequireRole roles={DELIVERY_OPERATOR_ROLES}><OpsPackageDetail /></RequireRole>}
          />
          <Route
            path="/delivery/ops/pod"
            element={<RequireRole roles={DELIVERY_OPERATOR_ROLES}><OpsPodPicker /></RequireRole>}
          />
          <Route
            path="/delivery/ops/pod/:packageId"
            element={<RequireRole roles={DELIVERY_OPERATOR_ROLES}><OpsPodCapture /></RequireRole>}
          />
          <Route
            path="/delivery/ops/dispatch"
            element={<RequireRole roles={DELIVERY_OPERATOR_ROLES}><OpsDispatch /></RequireRole>}
          />
          <Route
            path="/delivery/ops/routes"
            element={<RequireRole roles={DELIVERY_OPERATOR_ROLES}><OpsRoutes /></RequireRole>}
          />
          <Route path="/rentals" element={<Rentals />} />
          <Route path="/charter" element={<CharterHub />} />
          <Route path="/charter/login" element={<CharterLogin />} />
          <Route path="/charter/booking-status" element={<CharterBookingStatus />} />
          <Route path="/charter/search" element={<CharterSearchPage />} />
          <Route path="/marketplace" element={<MarketplacePage />} />
          <Route path="/charter/smartfare" element={<SmartFarePage />} />
          <Route path="/charter/:slug" element={<CharterCategoryPage />} />
          {/* Booking moved to the authenticated charter business portal. */}
          <Route path="/charter/:slug/book" element={<CharterBookingRedirect />} />
          <Route path="/verify" element={<ReceiptVerify />} />
          <Route path="/verify-document" element={<DocumentVerify />} />
          <Route path="/verify/letter" element={<LetterVerify />} />
          <Route path="/verify/document" element={<ForensicDocumentVerify />} />
          <Route path="/recruitment/respond" element={<InterviewRespond />} />
          <Route path="/recruitment/acknowledge" element={<DocumentAcknowledge />} />
          <Route path="/recruitment/assessment" element={<ProfessionAssessmentSitting />} />


          <Route path="/inspect" element={<TicketInspector />} />
          <Route path="/health" element={<HealthCheck />} />
          <Route path="/deploy-smoke" element={<DeploySmoke />} />


          {/* Riders split */}
          <Route path="/riders/individual" element={<Navigate to="/riders" replace />} />
          <Route path="/riders/corporate" element={<EmployeeMobility />} />
          <Route path="/corporate-travel-management" element={<CorporateTravelManagement />} />

          {/* Logistics & Delivery (new IA) */}
          <Route path="/logistics" element={<Navigate to="/logistics/solutions" replace />} />
          <Route path="/logistics/package" element={<Navigate to="/delivery/package" replace />} />
          <Route path="/logistics/courier" element={<Navigate to="/delivery/courier" replace />} />
          {/* Canonicalisation: declared redirect aliases (routeClassification.ts) */}
          <Route path="/corporate" element={<CorporateProfile />} />
          <Route path="/charter/bus" element={<Navigate to="/charter/bus-charter" replace />} />
          <Route path="/staff/interns/programmes/new" element={<Navigate to="/staff/recruitment/internships/new" replace />} />
          {/* Short public address carriers are given in outreach; the canonical
              intake page (and its saved application) is the fleet owner form. */}
          <Route path="/carrier-applications" element={<Navigate to="/partner/fleet-owner/apply" replace />} />
          <Route path="/logistics/solutions" element={<LogisticsSolutions />} />
          <Route path="/logistics/quote" element={<LogisticsBusinessQuote />} />

          {/* Car Rentals children */}
          <Route path="/rentals/self-drive" element={<RentalsSelfDrive />} />
          <Route path="/rentals/chauffeur" element={<RentalsChauffeur />} />
          <Route path="/rentals/quote/:token" element={<RentalQuoteView />} />
          <Route path="/rentals/bus-coach" element={<StubPage />} />
          <Route path="/rentals/corporate-leasing" element={<StubPage />} />
          <Route path="/rentals/marketplace" element={<Navigate to="/marketplace" replace />} />

          {/* Enterprise / Developers / Support */}
          <Route path="/enterprise" element={<Enterprise />} />
          <Route path="/enterprise/demo" element={<EnterpriseDemo />} />
          <Route path="/support" element={<Support />} />

          <Route path="/pricing" element={<Pricing />} />
          <Route path="/faq" element={<FAQ />} />
          <Route path="/news" element={<News />} />
          <Route path="/careers" element={<Careers />} />
          <Route path="/careers/continue" element={<CareerContinue />} />
          <Route path="/careers/:slug" element={<CareerVacancy />} />
          <Route path="/careers/:slug/apply" element={<CareerApply />} />
          <Route path="/contact" element={<Contact />} />
          <Route path="/book-a-meeting" element={<BookAMeeting />} />
          <Route path="/book-a-meeting/manage/:token" element={<ManageMeeting />} />
          <Route path="/blog/corporate-travel-management-guide" element={<CorporateTravelGuide />} />

          {/* Value detail pages */}
          <Route path="/safety" element={<SafetyCentre />} />
          <Route path="/reliability" element={<Reliability />} />
          <Route path="/transparency" element={<Transparency />} />
          <Route path="/innovation" element={<Innovation />} />
          <Route path="/compliance" element={<CompliancePage />} />

          {/* Trust */}
          <Route path="/security" element={<SecurityCenter />} />
          <Route path="/security-center" element={<SecurityCenter />} />
          <Route path="/privacy" element={<Privacy />} />
          <Route path="/compliance-center" element={<Navigate to="/compliance" replace />} />

          {/* Company */}
          <Route path="/leadership" element={<Leadership />} />
          <Route path="/governance" element={<Governance />} />
          <Route path="/investors" element={<StubPage />} />
          <Route path="/sustainability" element={<Sustainability />} />

          {/* Enterprise / Developer */}
          <Route path="/developers" element={<Developers />} />
          <Route path="/developers/ai-assistants" element={<ConnectAiAssistants />} />
          <Route path="/api-docs" element={<ApiDocs />} />

          {/* Legal — one canonical document surface, content registry in src/lib/legal */}
          <Route path="/legal" element={<LegalLibrary />} />
          <Route path="/legal/:slug" element={<LegalDocument />} />

          {/* Driver platform */}
          <Route path="/driver" element={<Navigate to="/drivers" replace />} />
          <Route path="/driver/apply" element={<DriverApply />} />
          <Route path="/driver/onboarding" element={<DriverOnboarding />} />
          <Route path="/driver/start" element={<DriverStart />} />
          <Route path="/driver/earnings" element={<DriverEarnings />} />
          <Route path="/driver/benefits" element={<DriverBenefits />} />
          <Route path="/driver/training" element={<DriverAcademy />} />
          <Route path="/driver/academy/:slug" element={<AcademyCourse />} />
          <Route path="/driver/safety" element={<DriverSafety />} />
          <Route path="/driver/support" element={<DriverSupport />} />
          <Route path="/driver/dashboard" element={<DriverDashboardReal />} />
          <Route path="/driver/portal" element={<DriverPortal />} />


          {/* Auth */}
          <Route path="/auth" element={<AuthPage />} />
          <Route path="/agent/login" element={<AgentLogin />} />
          <Route path="/agent" element={<AgentPortal />} />
          <Route path="/clients/login" element={<ClientLogin />} />
          <Route path="/reset-password" element={<ResetPassword />} />
          <Route path="/unsubscribe" element={<Unsubscribe />} />
          <Route path="/lead/reply" element={<LeadContactReply />} />


          {/* Rider app */}
          <Route path="/rider" element={<RiderBook />} />
          <Route path="/rider/trips" element={<RiderTrips />} />
          <Route path="/rider/trips/:id" element={<RiderTripDetail />} />
          <Route path="/rider/schedule" element={<RiderSchedule />} />
          <Route path="/rider/airport" element={<RiderAirport />} />
          <Route path="/rider/wallet" element={<RiderWallet />} />
          <Route path="/rider/support" element={<RiderSupport />} />
          <Route path="/rider/inbox" element={<RiderInbox />} />
          <Route path="/rider/rentals" element={<RiderRentals />} />
          <Route path="/rider/favorites" element={<RiderFavorites />} />
          <Route path="/rider/safety" element={<RiderSafety />} />
          <Route path="/rider/rewards" element={<RiderRewards />} />
          <Route path="/t/:token" element={<RiderTripShare />} />

          {/* Role-based dashboards */}
          <Route element={<DashboardLayout />}>
            <Route path="/dashboard" element={<RiderDashboard />} />
            <Route path="/dashboard/rider" element={<RiderDashboard />} />
            <Route path="/dashboard/rider/wallet" element={<Navigate to="/rider/wallet" replace />} />
            <Route path="/dashboard/rider/trips" element={<Navigate to="/rider/trips" replace />} />
            <Route path="/dashboard/rider/support" element={<Navigate to="/rider/support" replace />} />
            <Route path="/dashboard/driver" element={<DriverDashboard />} />
            <Route path="/dashboard/driver/profile" element={<DriverProfilePage />} />
            <Route path="/dashboard/driver/wallet" element={<DriverWalletPage />} />
            <Route path="/dashboard/driver/documents" element={<DriverDocumentsPage />} />
            <Route path="/dashboard/driver/payouts" element={<DriverPayoutsPage />} />
            <Route path="/dashboard/driver/trips" element={<DriverDashboard />} />
            <Route path="/dashboard/driver/tax" element={<DriverTax />} />
            <Route path="/dashboard/driver/support" element={<DriverDashboard />} />
            <Route path="/dashboard/service-requests" element={<CustomerRequests />} />
            <Route path="/dashboard/my-account" element={<CustomerAccount />} />
            <Route path="/dashboard/corporate" element={<RequireCorporate><CorporateDashboard /></RequireCorporate>} />
            <Route path="/dashboard/corporate/pre-billing" element={<RequireCorporate><CorporateDashboard /></RequireCorporate>} />
            <Route path="/dashboard/corporate/cash-ledger" element={<RequireCorporate><CorporateDashboard /></RequireCorporate>} />
            <Route path="/dashboard/corporate/paybill-proofs" element={<RequireCorporate><CorporateDashboard /></RequireCorporate>} />
            <Route path="/dashboard/corporate/audit-log" element={<RequireCorporate><CorporateDashboard /></RequireCorporate>} />
            <Route path="/dashboard/corporate/wallet" element={<RequireCorporate><CorporateDashboard /></RequireCorporate>} />
            <Route path="/dashboard/corporate/employees" element={<RequireCorporate><CorporateDashboard /></RequireCorporate>} />
            <Route path="/dashboard/corporate/departments" element={<RequireCorporate><CorporateDashboard /></RequireCorporate>} />
            <Route path="/dashboard/corporate/policies" element={<RequireCorporate><CorporateDashboard /></RequireCorporate>} />
            <Route path="/dashboard/corporate/expense-codes" element={<RequireCorporate><CorporateDashboard /></RequireCorporate>} />
            <Route path="/dashboard/corporate/approvals" element={<RequireCorporate><CorporateDashboard /></RequireCorporate>} />
            <Route path="/dashboard/corporate/violations" element={<RequireCorporate><CorporateDashboard /></RequireCorporate>} />
            <Route path="/dashboard/corporate/spend" element={<RequireCorporate><CorporateDashboard /></RequireCorporate>} />
            <Route path="/dashboard/corporate/designations" element={<RequireCorporate><CorporateDashboard /></RequireCorporate>} />
            <Route path="/dashboard/corporate/approval-setup" element={<RequireCorporate><CorporateDashboard /></RequireCorporate>} />
            <Route path="/dashboard/corporate/manual-dispatch" element={<RequireCorporate><CorporateDashboard /></RequireCorporate>} />
            <Route path="/dashboard/corporate/completed-rides" element={<RequireCorporate><CorporateDashboard /></RequireCorporate>} />
            <Route path="/dashboard/corporate/invoicing" element={<RequireCorporate><CorporateDashboard /></RequireCorporate>} />
            <Route path="/dashboard/corporate/trips/request" element={<RequireCorporate><CorporateDashboard /></RequireCorporate>} />
            <Route path="/dashboard/corporate/*" element={<RequireCorporate><CorporateDashboard /></RequireCorporate>} />
            <Route path="/dashboard/admin/paybill-proofs" element={<AdminPaybillProofs />} />
            <Route path="/dashboard/admin/reconciliation" element={<RequireRole roles={["admin","super_admin","finance_admin"]}><AdminReconciliation /></RequireRole>} />
            <Route path="/dashboard/admin/reconciliation/:id" element={<RequireRole roles={["admin","super_admin","finance_admin"]}><ReconciliationCase /></RequireRole>} />
            <Route path="/dashboard/admin/observability" element={<RequireRole roles={["admin","super_admin","finance_admin"]}><Observability /></RequireRole>} />
            <Route path="/dashboard/admin/event-outbox" element={<RequireRole roles={["admin","super_admin","finance_admin"]}><EventOutbox /></RequireRole>} />
            <Route path="/dashboard/admin/outbox-dlq" element={<RequireRole roles={["admin","super_admin"]}><OutboxDlq /></RequireRole>} />
            <Route path="/dashboard/admin/corporate-kyb" element={<RequireRole roles={["admin","super_admin","compliance_admin"]}><CorporateKyb /></RequireRole>} />
            <Route path="/dashboard/admin/corporate-kyb/audit" element={<RequireRole roles={["admin","super_admin","compliance_admin"]}><CorporateKybAuditLog /></RequireRole>} />
            <Route path="/dashboard/admin/corporate-portal" element={<RequireRole roles={["admin","super_admin","compliance_admin"]}><CorporateAdminPortal /></RequireRole>} />
            <Route path="/dashboard/admin/bank-guarantees" element={<RequireRole roles={["admin","super_admin","finance_admin"]}><BankGuarantees /></RequireRole>} />
            <Route path="/dashboard/admin/mpesa-payments" element={<RequireRole roles={["admin","super_admin","finance_admin"]}><MpesaPayments /></RequireRole>} />
            <Route path="/dashboard/admin/export-audit-trail" element={<RequireRole roles={["admin","super_admin","compliance_admin"]}><ExportAuditTrail /></RequireRole>} />
            <Route path="/dashboard/admin/privileged-updates" element={<RequireRole roles={["admin","super_admin","finance_admin"]}><PrivilegedUpdatesAudit /></RequireRole>} />
            <Route path="/dashboard/admin/privileged-metrics" element={<RequireRole roles={["admin","super_admin","finance_admin"]}><PrivilegedMetricsDashboard /></RequireRole>} />
            <Route path="/dashboard/admin/security-audit" element={<RequireRole roles={["admin","super_admin"]}><SecurityAudit /></RequireRole>} />
            <Route path="/dashboard/admin/trips/:tripId" element={<RequireRole roles={["admin","super_admin"]}><AdminTripDetail /></RequireRole>} />
            <Route path="/dashboard/admin/trip-share/:tripId" element={<RequireRole roles={["admin","super_admin"]}><TripShareAdmin /></RequireRole>} />
            <Route path="/dashboard/admin/brand-governance" element={<RequireRole roles={["admin","super_admin"]}><BrandGovernance /></RequireRole>} />
            <Route path="/dashboard/admin/assurance" element={<RequireRole roles={["admin","super_admin"]}><AssuranceDashboard /></RequireRole>} />
            <Route path="/dashboard/admin/security-scans" element={<RequireRole roles={["admin","super_admin"]}><SecurityScanCenter /></RequireRole>} />
            <Route path="/dashboard/admin/policy-assurance" element={<RequireRole roles={["admin","super_admin"]}><PolicyAssurance /></RequireRole>} />
            <Route path="/dashboard/admin/policy-exceptions" element={<RequireRole roles={["admin","super_admin"]}><PolicyExceptions /></RequireRole>} />
            <Route path="/dashboard/admin/policy-alerts" element={<RequireRole roles={["admin","super_admin"]}><PolicyAlertSettings /></RequireRole>} />

            <Route path="/dashboard/admin/access-debug" element={<RequireRole roles={["admin","super_admin"]}><AccessDebug /></RequireRole>} />
            <Route path="/dashboard/admin/payment-dlq" element={<RequireRole roles={["admin","super_admin","finance_admin"]}><PaymentDLQ /></RequireRole>} />
            <Route path="/dashboard/admin/fraud-cases" element={<RequireRole roles={["admin","super_admin","finance_admin"]}><FraudCases /></RequireRole>} />
            <Route path="/dashboard/admin/reconciliation-mismatches" element={<RequireRole roles={["admin","super_admin","finance_admin"]}><ReconciliationMismatches /></RequireRole>} />

            <Route path="/dashboard/corporate/reconciliation" element={<RequireCorporate><CorporateDashboard /></RequireCorporate>} />
            <Route path="/dashboard/admin" element={<RequireRole roles={["admin","super_admin","finance_admin","compliance_admin","operations_admin"]}><AdminDashboard /></RequireRole>} />
            <Route path="/dashboard/admin/users" element={<RequireRole roles={["admin","super_admin","compliance_admin"]}><UsersDirectory /></RequireRole>} />
            <Route path="/dashboard/admin/roles" element={<Navigate to="/dashboard/admin/staff" replace />} />
            <Route path="/dashboard/admin/mpesa" element={<RequireRole roles={["admin","super_admin","finance_admin"]}><MpesaDiagnostics /></RequireRole>} />
            <Route path="/dashboard/admin/payment-journey" element={<RequireRole roles={["admin","super_admin","finance_admin"]}><PaymentJourney /></RequireRole>} />
            <Route path="/dashboard/admin/payment-certification" element={<RequireRole roles={["admin","super_admin","finance_admin"]}><PaymentCertification /></RequireRole>} />
            <Route path="/dashboard/admin/payment-ops" element={<RequireRole roles={["admin","super_admin","finance_admin"]}><PaymentOperationsCenter /></RequireRole>} />
            <Route path="/dashboard/admin/ops-center" element={<RequireRole roles={["admin","super_admin","finance_admin"]}><OperationsCenter /></RequireRole>} />

            <Route path="/dashboard/admin/wallets" element={<AdminDashboard />} />
            <Route path="/dashboard/admin/payments" element={<AdminPayments />} />
            <Route path="/dashboard/admin/fos" element={<FosOperations />} />
            <Route path="/dashboard/admin/mobility-analytics" element={<RequireRole roles={["admin","super_admin","finance_admin"]}><CorporateMobilityAnalytics /></RequireRole>} />
            <Route path="/dashboard/admin/corporate-os" element={<RequireRole roles={["admin","super_admin","finance_admin"]}><CorporateOperatingSystem /></RequireRole>} />
            <Route path="/dashboard/admin/analytics-export" element={<AnalyticsExport />} />
            <Route path="/dashboard/admin/tax" element={<AdminTax />} />
            <Route path="/dashboard/admin/tax/:tab" element={<AdminTax />} />
            <Route path="/dashboard/admin/navigation-health" element={<NavigationHealth />} />
            <Route path="/dashboard/admin/navigation-governance" element={<RequireRole roles={["admin","super_admin"]}><NavigationGovernance /></RequireRole>} />
            <Route path="/dashboard/admin/aviation-center" element={<RequireRole roles={["admin","super_admin"]}><AviationCenter /></RequireRole>} />
            <Route path="/dashboard/admin/charter-booking-audit" element={<RequireRole roles={["admin","super_admin","compliance_admin"]}><CharterBookingAudit /></RequireRole>} />
            <Route path="/dashboard/admin/smartfare-versions" element={<RequireRole roles={["admin","super_admin","finance_admin"]}><SmartFareVersions /></RequireRole>} />
            <Route path="/dashboard/admin/smartfare-what-if" element={<RequireRole roles={["admin","super_admin","finance_admin"]}><SmartFareWhatIf /></RequireRole>} />
            <Route path="/dashboard/admin/rental-fleet" element={<RequireRole roles={["admin","super_admin","finance_admin","pricing_manager"]}><RentalFleet /></RequireRole>} />
            <Route path="/dashboard/admin/rental-operations" element={<RequireRole roles={["admin","super_admin","finance_admin","pricing_manager"]}><RentalOperations /></RequireRole>} />
            <Route path="/dashboard/admin/pricing-360" element={<RequireRole roles={["admin","super_admin","finance_admin","pricing_manager"]}><Pricing360 /></RequireRole>} />
            <Route path="/dashboard/admin/role-grant-governance" element={<RequireRole roles={["admin","super_admin"]}><RoleGrantGovernance /></RequireRole>} />
            <Route path="/dashboard/admin/social-distribution" element={<RequireRole roles={["admin","super_admin"]}><SocialDistribution /></RequireRole>} />
            <Route path="/account/communication-preferences" element={<CommunicationPreferences />} />
            <Route path="/account/security" element={<RequireRole><SecurityCentre /></RequireRole>} />
            <Route path="/dashboard/admin/identity-trust" element={<RequireRole roles={["admin","super_admin","compliance_admin"]}><IdentityTrust /></RequireRole>} />
            <Route path="/dashboard/admin/email-delivery" element={<RequireRole roles={["admin","super_admin","operations_admin","compliance_admin"]}><EmailDelivery /></RequireRole>} />
            <Route path="/dashboard/admin/pricing-audit-log" element={<RequireRole roles={["admin","super_admin","finance_admin","compliance_admin"]}><PricingAuditLog /></RequireRole>} />
            {/* Legacy pricing destinations → canonical Pricing 360 tabs (deep links preserved). */}
            {Object.keys(LEGACY_PRICING_ROUTES).map((path) => (
              <Route
                key={path}
                path={path}
                element={<RequireRole roles={["admin","super_admin","finance_admin","pricing_manager"]}><PricingLegacyRedirect /></RequireRole>}
              />
            ))}
            <Route path="/dashboard/admin/smartfare-pricing" element={<RequireRole roles={["admin","super_admin","finance_admin"]}><SmartFareSettings /></RequireRole>} />
            <Route path="/dashboard/admin/charter-pricing-alerts" element={<RequireRole roles={["admin","super_admin","finance_admin"]}><CharterPricingAlerts /></RequireRole>} />
            <Route path="/dashboard/admin/security-findings" element={<RequireRole roles={["admin","super_admin"]}><SecurityFindings /></RequireRole>} />
            <Route path="/dashboard/admin/alert-preferences" element={<RequireRole roles={["admin","super_admin"]}><AlertNotificationPrefs /></RequireRole>} />
            <Route path="/dashboard/admin/charter-retry-timeline" element={<RequireRole roles={["admin","super_admin","finance_admin"]}><CharterRetryTimeline /></RequireRole>} />
            <Route path="/dashboard/admin/road-approval-queue" element={<RequireRole roles={["admin","super_admin","finance_admin","operations_admin"]}><RoadApprovalQueue /></RequireRole>} />
            <Route path="/dashboard/admin/scheduled-job-health" element={<RequireRole roles={["admin","super_admin","finance_admin","operations_admin"]}><ScheduledJobHealth /></RequireRole>} />
            <Route path="/dashboard/admin/corporate-wallet-finance" element={<RequireRole roles={["admin","super_admin","finance_admin"]}><CorporateWalletFinance /></RequireRole>} />


            <Route path="/dashboard/admin/flight-hub" element={<RequireRole roles={["admin","super_admin"]}><FlightHub /></RequireRole>} />
            <Route path="/dashboard/admin/flight-hub/console" element={<RequireRole roles={["admin","super_admin"]}><FlightsConsole /></RequireRole>} />
            <Route path="/dashboard/admin/flight-hub/partners" element={<RequireRole roles={["admin","super_admin"]}><PartnerOnboarding /></RequireRole>} />
            <Route path="/dashboard/admin/flight-hub/lifecycle" element={<RequireRole roles={["admin","super_admin"]}><FlightLifecycle /></RequireRole>} />
            <Route path="/dashboard/admin/flight-hub/payments" element={<RequireRole roles={["admin","super_admin","finance_admin"]}><FlightPayments /></RequireRole>} />
            <Route path="/dashboard/admin/flight-hub/payouts" element={<RequireRole roles={["admin","super_admin","finance_admin"]}><OperatorPayouts /></RequireRole>} />
            <Route path="/dashboard/admin/fleet-owner-claims" element={<RequireRole roles={["admin","super_admin","finance_admin"]}><ServiceProviderClaimsPage /></RequireRole>} />

            <Route path="/dashboard/charter/analytics" element={<RequireRole roles={["admin","super_admin","operations_admin","operations_manager","charter_operator","fleet_manager"]}><CharterAnalytics /></RequireRole>} />
            {/* Corporate Charter Business — merged flagship hub + operations centre. */}
            <Route path="/dashboard/corporate-charter" element={<RequireTier><CorporateCharterWorkspace /></RequireTier>} />
            <Route path="/dashboard/admin/ccb-operations" element={<RequireTier><CorporateCharterOperations /></RequireTier>} />
            <Route path="/dashboard/premium" element={<RequireTier><ElitePremiumHome /></RequireTier>} />
            <Route path="/dashboard/premium/upgrade" element={<PremiumUpgrade />} />
            {/* Legacy charter portal preserved, and merged aliases redirect into the hub. */}
            <Route path="/dashboard/charter/portal" element={<RequireCorporate anyAuthenticated><CharterBusinessPortal /></RequireCorporate>} />
            <Route path="/dashboard/corporate-charter/booking" element={<Navigate to="/dashboard/corporate-charter?tab=booking" replace />} />
            <Route path="/dashboard/corporate-charter/wallets" element={<Navigate to="/dashboard/corporate-charter?tab=wallets" replace />} />
            <Route path="/dashboard/charter/business" element={<Navigate to="/dashboard/corporate-charter" replace />} />

            <Route path="/dashboard/charter/book/:slug" element={<RequireCorporate anyAuthenticated><CharterBooking /></RequireCorporate>} />
            <Route path="/dashboard/charter/operator-portal" element={<RequireRole roles={["admin","super_admin","operations_admin","driver","operator"]}><OperatorPortal /></RequireRole>} />
            <Route path="/dashboard/admin/flight-hub/pricing" element={<RequireRole roles={["admin","super_admin","finance_admin"]}><FlightPricingControl /></RequireRole>} />
            <Route path="/dashboard/admin/flight-hub/compliance" element={<RequireRole roles={["admin","super_admin","compliance_admin"]}><FlightCompliance /></RequireRole>} />
            <Route path="/dashboard/admin/flight-hub/relations" element={<RequireRole roles={["admin","super_admin"]}><CustomerRelations /></RequireRole>} />
            <Route path="/dashboard/admin/flight-hub/operations" element={<RequireRole roles={["admin","super_admin"]}><FlightOperationsCenter /></RequireRole>} />
            <Route path="/dashboard/admin/flight-hub/support" element={<RequireRole roles={["admin","super_admin"]}><SupportDesk /></RequireRole>} />


            <Route path="/dashboard/admin/kyc-types" element={<KycTypes />} />
            <Route path="/dashboard/admin/compliance" element={<RequireRole roles={["admin","super_admin","compliance_admin"]}><Compliance /></RequireRole>} />
            <Route path="/dashboard/admin/compliance-alerts" element={<RequireRole roles={["admin","super_admin","compliance_admin"]}><ComplianceAlerts /></RequireRole>} />
            <Route path="/dashboard/admin/digital-twin" element={<DigitalTwin />} />
            <Route path="/dashboard/admin/lifecycle" element={<DriverLifecycle />} />
            <Route path="/dashboard/admin/academy" element={<AdminAcademy />} />
            <Route path="/dashboard/admin/delivery-fraud" element={<RequireRole roles={["admin","super_admin","compliance_admin","finance_admin"]}><DeliveryFraud /></RequireRole>} />
            <Route path="/dashboard/admin/outbox" element={<OutboxMonitor />} />
            <Route path="/dashboard/admin/dispatch" element={<RequireRole roles={["admin","super_admin","operations_admin"]}><DispatchOps /></RequireRole>} />
            <Route path="/dashboard/admin/dispatch/sim" element={<RequireRole roles={["admin","super_admin","operations_admin"]}><DispatchSim /></RequireRole>} />
            <Route path="/dashboard/admin/trust-center" element={<RequireRole roles={["admin","super_admin","compliance_admin"]}><TrustSafetyCenter /></RequireRole>} />
            <Route path="/dashboard/admin/trust-console" element={<RequireRole roles={["admin","super_admin","compliance_admin"]}><TrustCenter /></RequireRole>} />
            <Route path="/dashboard/admin/fraud-center" element={<RequireRole roles={["admin","super_admin","finance_admin","compliance_admin"]}><FraudCenter /></RequireRole>} />
            <Route path="/dashboard/admin/identity-assurance" element={<IdentityAssurance />} />
            <Route path="/dashboard/admin/noc" element={<NocConsole />} />
            <Route path="/dashboard/admin/governance" element={<GovernanceCenter />} />
            <Route path="/dashboard/admin/governance-legacy" element={<GovernanceConsole />} />
            <Route path="/dashboard/admin/ml-platform" element={<RequireRole roles={["admin","super_admin"]}><MLPlatform /></RequireRole>} />
            <Route path="/dashboard/admin/noc-incidents" element={<RequireRole roles={["admin","super_admin"]}><NocIncidents /></RequireRole>} />
            <Route path="/dashboard/admin/contact-submissions" element={<ContactSubmissions />} />
            <Route path="/dashboard/admin/sales-leads" element={<RequireRole roles={["admin","super_admin"]}><SalesLeads /></RequireRole>} />
            <Route path="/dashboard/admin/customer-operations" element={<RequireRole roles={["admin","super_admin","compliance_admin"]}><CustomerOperationsCenter /></RequireRole>} />
            <Route path="/dashboard/admin/settings" element={<PlatformSettings />} />
            <Route path="/dashboard/admin/command-center" element={<RequireRole roles={["admin","super_admin"]}><AdminCommandCenter /></RequireRole>} />
            <Route path="/dashboard/admin/integrity-report" element={<IntegrityReport />} />
            <Route path="/dashboard/admin/rename-backfill-monitor" element={<RequireRole roles={["admin","super_admin"]}><RenameBackfillMonitor /></RequireRole>} />
            <Route path="/dashboard/admin/integrity-gates" element={<IntegrityGates />} />
            <Route path="/dashboard/admin/production-readiness" element={<RequireRole roles={["admin","super_admin"]}><ProductionReadiness /></RequireRole>} />

            <Route path="/dashboard/admin/cta-analytics" element={<CtaAnalytics />} />
            <Route path="/dashboard/admin/integrity-audit" element={<IntegrityThresholdAudit />} />
            <Route path="/dashboard/admin/drivers" element={<RequireRole roles={["admin","super_admin","compliance_admin"]}><DriverAdministration /></RequireRole>} />
            <Route path="/dashboard/admin/drivers/:driverId" element={<RequireRole roles={["admin","super_admin","compliance_admin"]}><Driver360 /></RequireRole>} />
            <Route path="/dashboard/admin/rider-management" element={<RequireRole roles={["admin","super_admin","compliance_admin"]}><RiderManagement /></RequireRole>} />
            <Route path="/dashboard/admin/riders" element={<RequireRole roles={["admin","super_admin","compliance_admin"]}><RiderDirectory /></RequireRole>} />
            <Route path="/dashboard/admin/riders/:riderId" element={<RequireRole roles={["admin","super_admin","compliance_admin"]}><Rider360 /></RequireRole>} />
            <Route path="/dashboard/admin/people-partners" element={<RequireRole roles={["admin","super_admin","compliance_admin"]}><PeoplePartnersCenter /></RequireRole>} />
            <Route path="/dashboard/admin/people-console" element={<RequireRole roles={["admin","super_admin","compliance_admin"]}><PeopleConsole /></RequireRole>} />
            <Route path="/dashboard/admin/partner-invite" element={<RequireRole roles={["admin","super_admin"]}><PartnerInvite /></RequireRole>} />
            <Route path="/dashboard/admin/corporates" element={<RequireRole roles={["admin","super_admin","compliance_admin"]}><CorporateControlTower /></RequireRole>} />
            <Route path="/dashboard/admin/corporates/approvals" element={<RequireRole roles={["admin","super_admin","finance_admin"]}><CorporateApprovalsInbox /></RequireRole>} />
            <Route path="/dashboard/admin/corporates/assisted-booking" element={<RequireRole roles={["admin","super_admin"]}><CorporateAssistedBooking /></RequireRole>} />
            <Route path="/dashboard/admin/corporates/booking-ops" element={<RequireRole roles={["admin","super_admin","operations_admin"]}><CorporateBookingOps /></RequireRole>} />
            <Route path="/dashboard/admin/corporates/support" element={<RequireRole roles={["admin","super_admin","operations_admin"]}><CorporateSupportDesk /></RequireRole>} />
            <Route path="/dashboard/admin/corporates/alerts" element={<RequireRole roles={["admin","super_admin","operations_admin"]}><CorporateOpsAlerts /></RequireRole>} />
            <Route path="/dashboard/admin/corporates/audit" element={<RequireRole roles={["admin","super_admin","compliance_admin","finance_admin"]}><CorporateAdminAuditLog /></RequireRole>} />
            <Route path="/dashboard/admin/corporates/permissions" element={<RequireRole roles={["admin","super_admin"]}><CorporateAdminPermissions /></RequireRole>} />

            <Route path="/dashboard/admin/corporates/:corporateId/command-centre" element={<RequireRole roles={["admin","super_admin","compliance_admin","finance_admin"]}><CorporateAccountCommandCentre /></RequireRole>} />
            <Route path="/dashboard/admin/corporates/:corporateId" element={<RequireRole roles={["admin","super_admin","compliance_admin"]}><Corporate360 /></RequireRole>} />
            <Route path="/dashboard/admin/document-queue" element={<RequireRole roles={["admin","super_admin","compliance_admin"]}><DocumentReviewQueue /></RequireRole>} />
            <Route path="/dashboard/admin/staff" element={<RequireRole roles={["super_admin"]}><StaffManagement /></RequireRole>} />

            {/* Phase 2 — Executive Command Center IA */}
            <Route path="/dashboard/admin/executive" element={<RequireRole roles={["admin","super_admin"]}><ExecutiveCommandCenter /></RequireRole>} />
            <Route path="/dashboard/admin/executive-command-centre" element={<RequireRole roles={["admin","super_admin","finance_admin"]}><ExecutiveCommandCentre /></RequireRole>} />
            <Route path="/dashboard/admin/report-schedules" element={<RequireRole roles={["admin","super_admin"]}><ReportExportSchedules /></RequireRole>} />
            <Route path="/dashboard/admin/concierge-approval-audit" element={<RequireRole roles={["admin","super_admin","compliance_admin"]}><ConciergeApprovalAudit /></RequireRole>} />
            <Route path="/dashboard/admin/incidents/:alertId" element={<RequireRole roles={["admin","super_admin","finance_admin","compliance_admin","operations_admin"]}><IncidentDetail /></RequireRole>} />
            <Route path="/dashboard/admin/governance-access" element={<RequireRole roles={["admin","super_admin"]}><GovernanceAccessMatrix /></RequireRole>} />
            <Route path="/dashboard/admin/export-jobs" element={<RequireRole roles={["admin","super_admin","finance_admin"]}><ExportJobHistory /></RequireRole>} />
            <Route path="/dashboard/admin/my-alert-preferences" element={<RequireRole roles={["admin","super_admin","finance_admin","compliance_admin","operations_admin"]}><MyAlertPreferences /></RequireRole>} />
            <Route path="/dashboard/admin/executive-intelligence" element={<RequireRole roles={["admin","super_admin"]}><ExecutiveIntelligence /></RequireRole>} />
            <Route path="/dashboard/admin/operations" element={<RequireRole roles={["admin","super_admin"]}><CenterHub center="operations" description="National mission control — dispatch, NOC, outbox, simulation." /></RequireRole>} />
            <Route path="/dashboard/admin/riders-center" element={<RequireRole roles={["admin","super_admin"]}><CenterHub center="riders" description="Individual, corporate, VIP and bus rider management." /></RequireRole>} />
            <Route path="/dashboard/admin/corporate-center" element={<RequireRole roles={["admin","super_admin"]}><CenterHub center="corporate" description="Enterprise mobility governance, contracts and spend." /></RequireRole>} />
            <Route path="/dashboard/admin/delivery-operations" element={<RequireRole roles={["admin","super_admin","operations_admin"]}><DeliveryOperationsControlTower /></RequireRole>} />
            <Route path="/dashboard/admin/logistics-orders" element={<RequireRole roles={["admin","super_admin","operations_admin"]}><LogisticsOrdersConsole /></RequireRole>} />
            <Route path="/dashboard/admin/logistics-exceptions" element={<RequireRole roles={["admin","super_admin","operations_admin"]}><LogisticsExceptions /></RequireRole>} />
            <Route path="/dashboard/admin/logistics-manifests" element={<RequireRole roles={["admin","super_admin","operations_admin"]}><LogisticsManifests /></RequireRole>} />
            <Route path="/dashboard/admin/logistics-hubs" element={<RequireRole roles={["admin","super_admin","operations_admin"]}><LogisticsHubs /></RequireRole>} />
            <Route path="/dashboard/admin/logistics-routes" element={<RequireRole roles={["admin","super_admin","operations_admin"]}><LogisticsRoutes /></RequireRole>} />
            <Route path="/dashboard/admin/logistics-delivery" element={<RequireRole roles={["admin","super_admin","operations_admin"]}><LogisticsDelivery /></RequireRole>} />
            <Route path="/dashboard/admin/carrier-pod-review" element={<RequireRole roles={["admin","super_admin","operations_admin"]}><CarrierPodReview /></RequireRole>} />
            <Route path="/dashboard/admin/logistics-integrations" element={<RequireRole roles={["admin","super_admin","operations_admin"]}><LogisticsIntegrations /></RequireRole>} />
            <Route path="/dashboard/admin/logistics-warehouse" element={<RequireRole roles={["admin","super_admin","operations_admin"]}><LogisticsWarehouse /></RequireRole>} />
            <Route path="/dashboard/admin/logistics-sync" element={<RequireRole roles={["admin","super_admin","operations_admin"]}><OfflineSyncConsole /></RequireRole>} />
            <Route path="/dashboard/admin/logistics-control-tower" element={<RequireRole roles={["admin","super_admin","operations_admin"]}><LogisticsControlTower /></RequireRole>} />
            <Route path="/dashboard/admin/ai-control-tower" element={<RequireRole roles={["admin","super_admin","operations_admin"]}><AiControlTower /></RequireRole>} />
            <Route path="/dashboard/admin/freight-procurement" element={<RequireRole roles={["admin","super_admin","operations_admin"]}><FreightProcurement /></RequireRole>} />
            <Route path="/dashboard/admin/freight-audit" element={<RequireRole roles={["admin","super_admin","finance_admin"]}><FreightAudit /></RequireRole>} />
            <Route path="/dashboard/admin/logistics-service-activation" element={<RequireRole roles={["admin","super_admin","operations_admin"]}><LogisticsServiceActivation /></RequireRole>} />

            <Route path="/dashboard/admin/logistics-center" element={<RequireRole roles={["admin","super_admin"]}><LogisticsCenter /></RequireRole>} />
            <Route path="/dashboard/admin/logistics-df10" element={<RequireRole roles={["admin","super_admin"]}><Df10ValidationDashboard /></RequireRole>} />
            <Route path="/dashboard/admin/carrier-applications" element={<RequireRole roles={["admin","super_admin","operations_admin"]}><CarrierApplications /></RequireRole>} />
            <Route path="/dashboard/admin/driver-applications" element={<RequireRole roles={["admin","super_admin","operations_admin"]}><DriverApplicationsAdmin /></RequireRole>} />
            <Route path="/dashboard/admin/payout-console" element={<RequireRole roles={["admin","super_admin","finance_admin","operations_admin"]}><PayoutConsole /></RequireRole>} />

            <Route path="/dashboard/admin/fleet-owner-documents" element={<RequireRole roles={["admin","super_admin","operations_admin"]}><FleetOwnerDocumentReview /></RequireRole>} />
            <Route path="/dashboard/admin/fleet-owner-compliance" element={<RequireRole roles={["admin","super_admin","operations_admin"]}><FleetOwnerCompliance /></RequireRole>} />
            <Route path="/dashboard/admin/production-command-center" element={<RequireRole roles={["admin","super_admin"]}><ProductionCommandCenter /></RequireRole>} />
            <Route path="/dashboard/admin/infrastructure-di00" element={<RequireRole roles={["admin","super_admin"]}><InfrastructureDi00 /></RequireRole>} />

            <Route path="/dashboard/admin/legal" element={<RequireRole roles={["admin","super_admin","compliance_admin"]}><LegalControlCentre /></RequireRole>} />
            <Route path="/dashboard/admin/runtime-diagnostics" element={<RequireRole roles={["admin","super_admin","operations_admin"]}><RuntimeDiagnostics /></RequireRole>} />
            <Route path="/dashboard/admin/logistics-onboarding" element={<RequireRole roles={["admin","super_admin"]}><LogisticsOnboarding /></RequireRole>} />
            <Route path="/dashboard/admin/logistics-capabilities" element={<RequireRole roles={["admin","super_admin"]}><LogisticsCapabilities /></RequireRole>} />
            <Route path="/dashboard/admin/fleet-center" element={<RequireRole roles={["admin","super_admin"]}><CenterHub center="fleet" description="Fleet companies, vehicles, maintenance and telematics." /></RequireRole>} />
            <Route path="/dashboard/admin/fleet" element={<RequireRole roles={["admin","super_admin","compliance_admin"]}><FleetDirectory /></RequireRole>} />
            <Route path="/dashboard/admin/fleet/:fleetId" element={<RequireRole roles={["admin","super_admin","compliance_admin"]}><Fleet360 /></RequireRole>} />
            {/* Phase B1.1 — Workspace360 adoption for Courier / Package / Logistics.
                Reuses the existing marketing pages under admin routes so the
                schema contract validator (/dashboard/admin/<slug>) is satisfied
                without creating new dashboards or components. */}
            <Route path="/dashboard/admin/couriers" element={<RequireRole roles={["admin","super_admin","compliance_admin"]}><Courier /></RequireRole>} />
            <Route path="/dashboard/admin/couriers/:courierId" element={<RequireRole roles={["admin","super_admin","compliance_admin"]}><Courier /></RequireRole>} />
            <Route path="/dashboard/admin/packages" element={<RequireRole roles={["admin","super_admin","compliance_admin"]}><PackageDelivery /></RequireRole>} />
            <Route path="/dashboard/admin/packages/:packageId" element={<RequireRole roles={["admin","super_admin","compliance_admin"]}><PackageDelivery /></RequireRole>} />
            <Route path="/dashboard/admin/logistics" element={<RequireRole roles={["admin","super_admin","compliance_admin"]}><Logistics /></RequireRole>} />
            <Route path="/dashboard/admin/logistics/:jobId" element={<RequireRole roles={["admin","super_admin","compliance_admin"]}><Logistics /></RequireRole>} />
            <Route path="/dashboard/admin/finance-center" element={<RequireRole roles={["admin","super_admin","finance_admin"]}><FinanceCenter /></RequireRole>} />
            <Route path="/dashboard/admin/refunds" element={<RequireRole roles={["admin","super_admin","finance_admin"]}><RefundsCenter /></RequireRole>} />

            <Route path="/dashboard/admin/intelligence" element={<RequireRole roles={["admin","super_admin"]}><CenterHub center="intelligence" description="Demand forecasting, pricing intelligence, CTA analytics." /></RequireRole>} />
            <Route path="/dashboard/admin/system" element={<RequireRole roles={["admin","super_admin"]}><PlatformCenter /></RequireRole>} />
            <Route path="/dashboard/admin/home" element={<RequireRole roles={["admin","super_admin","finance_admin","compliance_admin"]}><CenterHub center="home" title="Home" description="Your personalized landing page across every dashboard you can access." /></RequireRole>} />
            <Route path="/dashboard/admin/marketplace" element={<RequireRole roles={["admin","super_admin"]}><MarketplaceCenter /></RequireRole>} />
            <Route path="/dashboard/admin/super" element={<RequireRole roles={["super_admin"]}><BackendOperations /></RequireRole>} />
            <Route path="/dashboard/admin/backend" element={<RequireRole roles={["super_admin"]}><BackendOperations /></RequireRole>} />
            <Route path="/dashboard/admin/business-operations" element={<RequireRole roles={["admin","super_admin"]}><BusinessOperations /></RequireRole>} />
            <Route path="/dashboard/admin/audit-log" element={<RequireRole roles={["admin","super_admin"]}><AdminAuditLog /></RequireRole>} />
            <Route path="/dashboard/admin/access-denials" element={<RequireRole roles={["admin","super_admin"]}><AccessDenials /></RequireRole>} />
            <Route path="/dashboard/admin/alert-rules" element={<RequireRole roles={["admin","super_admin"]}><AlertRules /></RequireRole>} />
            <Route path="/dashboard/admin/alerts" element={<RequireRole roles={["admin","super_admin"]}><AdminAlerts /></RequireRole>} />
            <Route path="/dashboard/admin/audit-schedules" element={<RequireRole roles={["admin","super_admin"]}><AuditSchedules /></RequireRole>} />
            <Route path="/dashboard/admin/sla-grace" element={<RequireRole roles={["admin","super_admin"]}><DocumentSlaSettings /></RequireRole>} />





          </Route>


          {/* Legacy admin dashboard */}
          <Route path="/app" element={<Layout><Dashboard /></Layout>} />
          <Route path="/app/riders" element={<Layout><RidersPage /></Layout>} />
          <Route path="/app/drivers" element={<Layout><DriversPage /></Layout>} />
          <Route path="/app/trips" element={<Layout><TripsPage /></Layout>} />
          <Route path="/app/schedule" element={<Layout><MapView /></Layout>} />
          <Route path="/app/driver/wealth" element={<DriverWealth />} />
          <Route path="/driver/wealth" element={<DriverWealth />} />

          {/* Client contract signing portal — the link token is the credential.
              The token-less entry renders the invalid-link state, never content. */}
          <Route path="/contract-portal" element={<ContractPortal />} />
          <Route path="/contract-portal/:token" element={<ContractPortal />} />
          <Route path="/my/account" element={<MyClientPortal />} />
          <Route path="/my/yalla/:token" element={<CustomerPortal />} />
          <Route path="/my/partner/:token" element={<PartnerLinkPortal />} />

          {/* TaxiD Staff Portal — Staff 360 */}
          <Route path="/staff" element={<StaffPortalLanding />} />
          {/* Authoritative staff authentication gateway (public, noindex). */}
          <Route path="/staff/access" element={<StaffAccessGateway />} />
          <Route path="/staff/*" element={<RequireStaffPortal><StaffErrorBoundary area="Staff 360"><StaffShell /></StaffErrorBoundary></RequireStaffPortal>}>
            <Route index element={<Navigate to="/staff/workspace" replace />} />
            <Route path="workspace" element={<MyWorkspace />} />
            <Route path="workspace/work-queue" element={<WorkspaceWorkQueue />} />
            <Route path="workspace/exceptions" element={<WorkspaceExceptions />} />
            <Route path="workspace/meetings" element={<WorkspaceMeetings />} />
            <Route path="workspace/inbox" element={<WorkspaceInboxPage />} />
            <Route path="workspace/book" element={<WorkspaceCommercialBook />} />
            <Route path="workspace/approvals" element={<WorkspaceApprovals />} />
            <Route path="workspace/accounts" element={<WorkspaceCommercialLenses />} />
            <Route path="workspace/accounts/:accountId" element={<WorkspaceAccount360 />} />
            <Route path="workspace/opportunities" element={<WorkspaceCommercialLenses />} />
            <Route path="workspace/pipeline" element={<WorkspacePipelineInspection />} />
            <Route path="workspace/field" element={<WorkspaceFieldMode />} />
            <Route path="workspace/quotes" element={<WorkspaceCommercialLenses />} />
            <Route path="workspace/contracts" element={<WorkspaceCommercialLenses />} />
            <Route path="workspace/activation" element={<WorkspaceActivationPlan />} />
            <Route path="board" element={<OpsCommandBoard />} />
            <Route path="stream" element={<OrchestrationStream />} />
            <Route path="360" element={<Staff360Home />} />
            <Route path="search" element={<StaffSearch />} />

            <Route path="workflow" element={<StaffWorkflows />} />
            <Route path="operations" element={<StaffOperations />} />
            <Route path="agentic" element={<StaffAgentic />} />
            <Route path="adaptive" element={<StaffAdaptive />} />
            <Route path="value" element={<StaffValue />} />
            <Route path="forensics" element={<StaffForensics />} />
            <Route path="audit" element={<StaffSecurityAudit />} />
            <Route path="control-tower" element={<StaffControlTower />} />
            <Route path="ask-yalla" element={<StaffAskYalla />} />
            <Route path="providers" element={<StaffProviderSupply />} />
            <Route path="commerce-os" element={<StaffCommerceOS />} />
            <Route path="commerce-os/review" element={<StaffFinancialCapture />} />
            <Route path="closure" element={<StaffClosure />} />
            <Route path="expansion" element={<StaffExpansion />} />
            <Route path="orchestration" element={<StaffOrchestration />} />
            <Route path="adaptive-marketplace" element={<StaffAdaptiveMarketplace />} />


            <Route path="readiness" element={<Navigate to="/staff/operations" replace />} />
            <Route path="organisation" element={<StaffOrganisation />} />
            <Route path="org" element={<OrgManagement />} />
            <Route path="team" element={<MyTeam />} />
            <Route path="dashboard" element={<StaffRoleDashboard />} />
            <Route path="communications" element={<StaffCommunications />} />
            <Route path="calendar" element={<StaffCalendar />} />
            <Route path="meetings" element={<MeetingsHub />} />
            <Route path="sales/access" element={<SalesAccessDashboard />} />
            <Route path="admin" element={<StaffAdminPortal />} />
            <Route path="onboarding" element={<StaffOnboarding />} />
            <Route path="sales" element={<SalesPortal />} />
            <Route path="sales/pipeline" element={<LeadPipeline />} />
            <Route path="sales/manager-desk" element={<SalesManagerDesk />} />
            <Route path="workforce/blueprints" element={<RoleBlueprints />} />
            <Route path="workforce/launchpad" element={<WorkforceLaunchpad />} />
            <Route path="interns" element={<InternsDashboard />} />
            <Route path="interns/cohorts" element={<InternCohorts />} />
            <Route path="interns/register" element={<InternRegister />} />
            <Route path="interns/talent" element={<InternTalentDiscovery />} />
            <Route path="interns/recruitment" element={<InternRecruitmentPipeline />} />
            <Route path="interns/governance" element={<InternGovernance />} />
            <Route path="interns/supply" element={<InternSupplyCommand />} />
            <Route path="partners" element={<StaffPartnersCommand />} />
            <Route path="partners/work" element={<StaffPartnerWorkQueues />} />
            <Route path="partners/fleet-owner-conversion" element={<StaffFleetOwnerConversion />} />
            <Route path="partners/fleet-owner-queue" element={<StaffFleetOwnerQueue />} />
            <Route path="partners/supply" element={<StaffPartnerSupply />} />
            <Route path="partners/matching" element={<StaffPartnerMatching />} />
            <Route path="partners/risk" element={<StaffPartnerRisk />} />
            <Route path="partners/funnel" element={<StaffPartnerFunnel />} />
            <Route path="partners/tasks" element={<StaffPartnerTaskQueue />} />
            <Route path="partners/white-label" element={<StaffWhiteLabelOps />} />
            <Route path="partners/funnel/:sessionId" element={<StaffPartnerJourney />} />
            <Route path="partners/:partnerId" element={<StaffPartner360 />} />

            <Route path="interns/:internId" element={<Intern360 />} />
            <Route path="org/links" element={<StaffLinkBackfill />} />
            <Route path="org/people" element={<PeopleManagement />} />
            <Route path="org/people/:staffId" element={<StaffProfile />} />
            <Route path="org/objectives" element={<ObjectivesManagement />} />
            <Route path="org/work" element={<WorkQueue />} />
            <Route path="org/baseline" element={<SalesBaseline />} />
            <Route path="org/performance" element={<PerformanceScorecard />} />
            <Route path="org/audit" element={<StaffAuditTrail />} />
            <Route path="departments" element={<StaffDepartments />} />
            <Route path="departments/:slug" element={<StaffDepartmentDetail />} />
            <Route path="revenue" element={<StaffRevenue />} />
            <Route path="marketplace" element={<StaffMarketplace />} />
            <Route path="customers" element={<StaffCustomers />} />
            <Route path="customers/accounts" element={<CrmAccounts />} />
<Route path="customers/documents" element={<CrmDocuments />} />
            <Route path="commercial/charter" element={<CorporateCharterCommercial />} />
            <Route path="commercial/documents" element={<CommercialDocuments />} />
            <Route path="commercial/templates" element={<CommercialDocumentTemplates />} />
            <Route path="commercial/proforma" element={<ProformaInvoices />} />
            <Route path="commercial/invoices" element={<TaxInvoices />} />
            <Route path="commercial/collections" element={<PaymentCollections />} />
            <Route path="commercial/amendment-billing" element={<AmendmentBilling />} />
            <Route path="commercial/rate-cards" element={<RateCardPortal />} />
            <Route path="marketing/social" element={<StaffSocialPublishing />} />

            <Route path="recruitment" element={<RecruitmentDashboard />} />
            <Route path="recruitment/vacancies" element={<RecruitmentVacancies />} />
            <Route path="recruitment/internships/new" element={<InternshipProgrammeBuilder />} />
            <Route path="recruitment/pipeline" element={<RecruitmentPipeline />} />
            <Route path="recruitment/selection" element={<RecruitmentVacancy360 />} />
            <Route path="recruitment/candidates" element={<RecruitmentCandidates />} />
            <Route path="recruitment/interviews" element={<RecruitmentInterviews />} />
            <Route path="recruitment/offers" element={<RecruitmentOffers />} />
            <Route path="recruitment/onboarding" element={<RecruitmentOnboarding />} />
            <Route path="recruitment/screening" element={<RecruitmentScreening />} />
            <Route path="recruitment/shortlist" element={<RecruitmentShortlist />} />
            <Route path="recruitment/evaluations" element={<RecruitmentEvaluations />} />
            <Route path="recruitment/assessment/:interviewId" element={<RecruitmentAssessment />} />
            <Route path="recruitment/suitability" element={<RecruitmentRoleSuitability />} />
            <Route path="recruitment/partner-leads" element={<RecruitmentPartnerLeads />} />
            <Route path="recruitment/role-applications" element={<RecruitmentRoleApplications />} />
            <Route path="recruitment/questions" element={<RecruitmentQuestionGovernance />} />
            <Route path="recruitment/assessments" element={<RecruitmentAssessmentBlueprints />} />
            <Route path="recruitment/applications/:applicationId" element={<RecruitmentApplicationReview />} />
            <Route path="recruitment/comparison" element={<RecruitmentComparison />} />
            <Route path="recruitment/talent-pool" element={<RecruitmentTalentPool />} />
            <Route path="recruitment/communications" element={<RecruitmentCommunications />} />
            <Route path="recruitment/letters" element={<RecruitmentLetterCentre />} />
            <Route path="documents/security" element={<DocumentSecurityCentre />} />
            <Route path="documents/collateral" element={<StaffCompanyCollateral />} />
            <Route path="recruitment/templates" element={<RecruitmentTemplates />} />
            <Route path="recruitment/settings" element={<RecruitmentSettings />} />
            <Route path="recruitment/requirements" element={<RecruitmentRequirementHistory />} />
            <Route path="recruitment/analytics" element={<RecruitmentAnalytics />} />
            <Route path="recruitment/publication-health" element={<RecruitmentPublicationHealth />} />
            <Route path="recruitment/import" element={<RecruitmentImportCentre />} />
            <Route path="recruitment/import/new" element={<RecruitmentImportWizard />} />
            <Route path="recruitment/import/worker" element={<RecruitmentImportWorkerMonitor />} />

            <Route path="recruitment/import/reconciliation" element={<RecruitmentImportReconciliation />} />
            <Route path="recruitment/conflicts/:id" element={<RecruitmentConflictResolution />} />
            <Route path="recruitment/import/:batchId" element={<RecruitmentImportBatchConsole />} />
            <Route path="people" element={<StaffPeople />} />
            <Route path="knowledge" element={<StaffKnowledge />} />
            <Route path="innovation" element={<StaffInnovation />} />
            <Route path="intelligence" element={<StaffIntelligence />} />
            <Route path="governance" element={<StaffGovernance />} />
          </Route>

          <Route path="/design/status-tokens" element={<StatusTokens />} />

          <Route path="/unauthorized" element={<Unauthorized />} />
          <Route path="/corporate/access-required" element={<CorporateAccessRequired />} />
          <Route path="*" element={<NotFound />} />
        </Routes>
        </Suspense>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;

