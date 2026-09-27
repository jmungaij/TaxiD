import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { supabaseForUser } from "../supabase";

interface ThreadRow {
  id: string; subject: string; category: string; status: string; rider_email: string;
  assigned_at: string | null; last_message_at: string | null;
}
const toCase = (t: ThreadRow) => ({
  id: t.id, subject: t.subject, category: t.category, status: t.status, rider_email: t.rider_email,
  assigned_at: t.assigned_at, last_message_at: t.last_message_at,
});

export default defineTool({
  name: "my_assigned_cases",
  title: "My assigned cases",
  description: "List rider support cases assigned to the signed-in support agent.",
  inputSchema: {
    status: z.enum(["open", "resolved", "closed", "any"]).default("open").describe("Filter by case status."),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ status }, ctx) => {
    if (!ctx.isAuthenticated()) return { content: [{ type: "text", text: "Not authenticated" }], isError: true };
    let q = supabaseForUser(ctx).from("support_threads")
      .select("id, subject, category, status, rider_email, assigned_at, last_message_at")
      .eq("assigned_agent_id", ctx.getUserId() ?? "")
      .order("last_message_at", { ascending: false, nullsFirst: false }).limit(50);
    if (status !== "any") q = q.eq("status", status);
    const { data, error } = await q;
    if (error) return { content: [{ type: "text", text: error.message }], isError: true };
    const cases = ((data ?? []) as ThreadRow[]).map(toCase);
    return { content: [{ type: "text", text: JSON.stringify(cases) }], structuredContent: { cases } };
  },
});
