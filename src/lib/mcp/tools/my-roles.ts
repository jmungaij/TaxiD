import { defineTool } from "@lovable.dev/mcp-js";
import { supabaseForUser } from "../supabase";

export default defineTool({
  name: "my_roles",
  title: "My roles",
  description: "List the SAFARID roles (admin, support, rider) assigned to the signed-in account.",
  inputSchema: {},
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async (_args, ctx) => {
    if (!ctx.isAuthenticated()) {
      return { content: [{ type: "text", text: "Not authenticated" }], isError: true };
    }
    const { data, error } = await supabaseForUser(ctx)
      .from("user_roles")
      .select("role")
      .eq("user_id", ctx.getUserId() ?? "");
    if (error) return { content: [{ type: "text", text: error.message }], isError: true };
    const roles = (data ?? []).map((r: { role: string }) => String(r.role));
    return { content: [{ type: "text", text: JSON.stringify(roles) }], structuredContent: { roles } };
  },
});
