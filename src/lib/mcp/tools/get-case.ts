import { defineTool, ToolError } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { supabaseForUser } from "../supabase";

interface MessageRow { id: string; sender_role: string; body: string; created_at: string }

export default defineTool({
  name: "get_case",
  title: "Get case",
  description: "Read one rider support case, including its full message history (the AI-drafted resolution and rider replies).",
  inputSchema: { case_id: z.string().uuid().describe("The case ID from my_assigned_cases.") },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ case_id }, ctx) => {
    if (!ctx.isAuthenticated()) return { content: [{ type: "text", text: "Not authenticated" }], isError: true };
    const db = supabaseForUser(ctx);
    const { data: t, error } = await db.from("support_threads")
      .select("id, subject, category, status, rider_email, assigned_agent_id")
      .eq("id", case_id).maybeSingle();
    if (error) throw new ToolError(error.message);
    if (!t) throw new ToolError("Case not found or you don't have access to it.");
    const { data: msgs, error: mErr } = await db.from("support_messages")
      .select("id, sender_role, body, created_at").eq("thread_id", case_id).order("created_at", { ascending: true });
    if (mErr) throw new ToolError(mErr.message);
    const row = t as { id: string; subject: string; category: string; status: string; rider_email: string; assigned_agent_id: string | null };
    const result = {
      id: row.id, subject: row.subject, category: row.category, status: row.status, rider_email: row.rider_email,
      assigned_to_me: row.assigned_agent_id === ctx.getUserId(),
      messages: ((msgs ?? []) as MessageRow[]).map((m) => ({ id: m.id, from: m.sender_role, body: m.body, sent_at: m.created_at })),
    };
    return { content: [{ type: "text", text: JSON.stringify(result) }], structuredContent: { case: result } };
  },
});
