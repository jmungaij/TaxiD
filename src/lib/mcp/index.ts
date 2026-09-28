import { auth, defineMcp } from "@lovable.dev/mcp-js";
import whoamiTool from "./tools/whoami";
import myRolesTool from "./tools/my-roles";
import myAssignedCasesTool from "./tools/my-assigned-cases";
import getCaseTool from "./tools/get-case";
import replyToCaseTool from "./tools/reply-to-case";
import updateCaseStatusTool from "./tools/update-case-status";

const projectRef = import.meta.env.VITE_SUPABASE_PROJECT_ID ?? "project-ref-unset";

export default defineMcp({
  name: "safarid",
  title: "safarid",
  version: "0.2.0",
  instructions:
    "Tools for the TaxiD mobility platform, acting as the signed-in user. Use `whoami` and `my_roles` to confirm the account. Support agents use `my_assigned_cases` to see rider cases assigned to them, `get_case` to read the AI-drafted resolution and rider replies, `reply_to_case` to answer the rider, and `update_case_status` to resolve or close a case. Every action is tracked in the app.",
  auth: auth.oauth.issuer({
    issuer: `https://${projectRef}.supabase.co/auth/v1`,
    acceptedAudiences: "authenticated",
  }),
  tools: [whoamiTool, myRolesTool, myAssignedCasesTool, getCaseTool, replyToCaseTool, updateCaseStatusTool],
});
