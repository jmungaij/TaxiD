import { defineTool, ToolError } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { supabaseForUser } from "../supabase";

export default defineTool({
  name: "reply_to_case",
  title: "Reply to case",
  description: "Send a staff reply to the rider on an open support case assigned to you. The rider sees it in their SAFARID inbox.",
  inputSchema: {
    case_id: z.string().uuid().describe("The case ID."),
    message: z.string().trim().min(1).max(4000).describe("The reply the rider will read."),
  },
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  handler: async ({ case_id, message }, ctx) => {
    if (!ctx.isAuthenticated()) return { content: [{ type: "text", text: "Not authenticated" }], isError: true };
    const uid = ctx.getUserId() ?? "";
    const db = supabaseForUser(ctx);
    const { data: t, error } = await db.from("support_threads")
      .select("id, status, assigned_agent_id").eq("id", case_id).maybeSingle();
    if (error) throw new ToolError(error.message);
    const row = t as { id: string; status: string; assigned_agent_id: string | null } | null;
    if (!row) throw new ToolError("Case not found or you don't have access to it.");
    if (row.assigned_agent_id !== uid) throw new ToolError("This case is not assigned to you.");
    if (row.status !== "open") throw new ToolError("This case is not open.");
    const { error: iErr } = await db.from("support_messages")
      .insert({ thread_id: case_id, sender_id: uid, sender_role: "staff", body: message });
    if (iErr) throw new ToolError(iErr.message);
    await db.from("support_assignment_events").insert({
      thread_id: case_id, event_type: "agent_reply", actor_id: uid, source: "mcp", note: message.slice(0, 200),
    });
    return { content: [{ type: "text", text: "Reply sent to the rider." }], structuredContent: { sent: true } };
  },
});
