import { auth, defineMcp } from "@lovable.dev/mcp-js";
import whoamiTool from "./tools/whoami";
import myRolesTool from "./tools/my-roles";

const projectRef = import.meta.env.VITE_SUPABASE_PROJECT_ID ?? "project-ref-unset";

export default defineMcp({
  name: "safarid",
  title: "safarid",
  version: "0.1.0",
  instructions:
    "Tools for the SAFARID mobility platform, acting as the signed-in user. Use `whoami` to confirm the account and `my_roles` to see its permissions.",
  auth: auth.oauth.issuer({
    issuer: `https://${projectRef}.supabase.co/auth/v1`,
    acceptedAudiences: "authenticated",
  }),
  tools: [whoamiTool, myRolesTool],
});
