import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { createClient } from "npm:@supabase/supabase-js@2";
import { z } from "npm:zod@3.23.8";

const RequestSchema = z.object({ windowHours: z.number().int().min(1).max(168).default(24) });

const headers = { ...corsHeaders, "Content-Type": "application/json" };
const response = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers });

const deployedFunctions = [
  { name: "backend-operations", purpose: "Super-admin backend inventory and operational analytics", access: "Super admin" },
  { name: "rider-support-draft", purpose: "AI-assisted rider case resolution drafts", access: "Admin" },
  { name: "auth-email-hook", purpose: "Authentication and account email delivery", access: "Signed webhook" },
  { name: "mcp", purpose: "Assigned support case tools for connected agents", access: "Authenticated agent" },
];

const secretNames = [
  "LOVABLE_API_KEY",
  "SUPABASE_URL",
  "SUPABASE_ANON_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
];

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return response({ error: "Method not allowed" }, 405);

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return response({ error: "Authentication required" }, 401);

  const url = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !anonKey || !serviceKey) return response({ error: "Backend configuration is incomplete" }, 500);

  const userClient = createClient(url, anonKey, { global: { headers: { Authorization: authHeader } } });
  const { data: authData, error: authError } = await userClient.auth.getUser();
  if (authError || !authData.user) return response({ error: "Invalid session" }, 401);

  const service = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: isSuperAdmin, error: roleError } = await service.rpc("has_role", {
    _user_id: authData.user.id,
    _role: "super_admin",
  });
  if (roleError || !isSuperAdmin) return response({ error: "Super admin access required" }, 403);

  let rawBody: unknown = {};
  try { rawBody = await req.json(); } catch { rawBody = {}; }
  const parsed = RequestSchema.safeParse(rawBody);
  if (!parsed.success) return response({ error: parsed.error.flatten().fieldErrors }, 400);

  const since = new Date(Date.now() - parsed.data.windowHours * 60 * 60 * 1000).toISOString();
  const count = async (table: string, apply?: (query: any) => any) => {
    let query = service.from(table).select("*", { count: "exact", head: true });
    if (apply) query = apply(query);
    const result = await query;
    return { value: result.count ?? null, available: !result.error };
  };

  const [
    usersResult,
    roleAssignments,
    riderProfiles,
    trips,
    openCases,
    recentCases,
    recentMessages,
    walletTransactions,
    businessRequests,
    bucketsResult,
  ] = await Promise.all([
    service.auth.admin.listUsers({ page: 1, perPage: 1 }),
    count("user_roles"),
    count("rider_profiles"),
    count("trip_bookings"),
    count("support_threads", (query) => query.eq("status", "open")),
    count("support_threads", (query) => query.gte("created_at", since)),
    count("support_messages", (query) => query.gte("created_at", since)),
    count("wallet_transactions", (query) => query.gte("created_at", since)),
    count("business_requests", (query) => query.gte("created_at", since)),
    service.storage.listBuckets(),
  ]);

  const tableNames = [
    "airport_bookings", "business_organisations", "business_requests", "emergency_contacts",
    "family_accounts", "family_members", "favorite_locations", "mpesa_transactions", "profiles",
    "ride_types", "rider_devices", "rider_kyc", "rider_notifications", "rider_payment_methods",
    "rider_profiles", "rider_promotions", "rider_reward_events", "rider_rewards",
    "rider_wallet_transactions", "rider_wallets", "safety_alerts", "scheduled_trips",
    "support_assignment_events", "support_messages", "support_threads", "trip_bookings",
    "trip_incidents", "trip_quotes", "trip_ratings", "trip_requests", "trip_share_links",
    "trip_status_history", "trip_tracking", "trip_waypoints", "user_roles", "wallet_transactions", "wallets",
  ];

  return response({
    generatedAt: new Date().toISOString(),
    windowHours: parsed.data.windowHours,
    overview: {
      databaseTables: tableNames.length,
      protectedTables: tableNames.length,
      users: usersResult.error ? null : usersResult.data.total,
      roleAssignments: roleAssignments.value,
      storageBuckets: bucketsResult.error ? null : bucketsResult.data.length,
      deployedFunctions: deployedFunctions.length,
    },
    database: { tables: tableNames, rlsEnabled: true },
    activity: {
      riders: riderProfiles.value,
      trips: trips.value,
      openCases: openCases.value,
      casesCreated: recentCases.value,
      supportMessages: recentMessages.value,
      walletTransactions: walletTransactions.value,
      businessRequests: businessRequests.value,
    },
    storage: { buckets: bucketsResult.error ? [] : bucketsResult.data.map((bucket) => bucket.name) },
    functions: deployedFunctions,
    secrets: secretNames.map((name) => ({ name, configured: Boolean(Deno.env.get(name)) })),
  });
});