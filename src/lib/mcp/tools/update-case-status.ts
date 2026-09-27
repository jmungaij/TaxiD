import { defineTool, ToolError } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { supabaseForUser } from "../supabase";

export default defineTool({
  name: "update_case_status",
  title: "Update case status",
  description: "Mark a support case assigned to you as open, resolved or closed. The change is tracked in the app's case history.",
  inputSchema: {
    case_id: z.string().uuid().describe("The case ID."),
    status: z.enum(["open", "resolved", "closed"]).describe("New status."),
  },
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  handler: async ({ case_id, status }, ctx) => {
    if (!ctx.isAuthenticated()) return { content: [{ type: "text", text: "Not authenticated" }], isError: true };
    const uid = ctx.getUserId() ?? "";
    const { data, error } = await supabaseForUser(ctx).from("support_threads")
      .update({ status }).eq("id", case_id).eq("assigned_agent_id", uid).select("id, status");
    if (error) throw new ToolError(error.message);
    if (!data || data.length === 0) throw new ToolError("Case not found or not assigned to you.");
    return { content: [{ type: "text", text: `Case marked ${status}.` }], structuredContent: { id: case_id, status } };
  },
});
