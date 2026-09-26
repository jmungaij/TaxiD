/**
 * MARKETING ENTRANCE to the social publishing control plane.
 *
 * Renders the same console the Super Admin surface renders. Marketing staff get
 * the operational entrance; authority is decided server-side by RLS and the
 * governed routines, not by which page was opened.
 */
import { Helmet } from "react-helmet-async";
import PublishingConsole from "@/components/social/PublishingConsole";

export default function SocialPublishing() {
  return (
    <div className="space-y-6">
      <Helmet>
        <title>Social Publishing | SAFARID Staff</title>
        <meta
          name="description"
          content="Manage SAFARID social connections, content approval, scheduling and publication health from one governed control plane."
        />
        <meta name="robots" content="noindex,nofollow" />
      </Helmet>

      <header className="space-y-1">
        <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
          Marketing · Distribution
        </p>
        <h1 className="text-2xl font-semibold tracking-tight">Social Publishing</h1>
        <p className="max-w-3xl text-sm text-muted-foreground">
          Author once, publish per platform. Content requires a second approver, provider credentials must be present
          before a job is attempted, and every publication, retry and callback is recorded in an append-only audit trail.
        </p>
      </header>

      <PublishingConsole scope="MARKETING" />
    </div>
  );
}
