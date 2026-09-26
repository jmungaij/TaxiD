import { defineTool } from "@lovable.dev/mcp-js";

export default defineTool({
  name: "whoami",
  title: "Who am I",
  description: "Return the signed-in SAFARID account's user ID and email.",
  inputSchema: {},
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: (_args, ctx) => {
    if (!ctx.isAuthenticated()) {
      return { content: [{ type: "text", text: "Not authenticated" }], isError: true };
    }
    const user = { id: ctx.getUserId() ?? null, email: ctx.getUserEmail() ?? null };
    return { content: [{ type: "text", text: JSON.stringify(user) }], structuredContent: { user } };
  },
});
