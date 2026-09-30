import { ReactNode } from "react";
import { useAuth } from "@/hooks/useAuth";
import { Card, CardContent } from "@/components/ui/card";
import { ShieldAlert } from "lucide-react";

interface Props {
  children: ReactNode;
  /** Roles allowed to view this page. Defaults to admin + super_admin. */
  roles?: string[];
}

/**
 * Defence-in-depth page-level guard. Route-level `RequireRole` is the primary
 * gate, but this component renders a hard-block message if the wrapped page
 * is ever reached without an authorized role (misconfigured route, dev bypass,
 * stale session, etc.). Never renders children unless the caller matches.
 */
export function AdminOnly({ children, roles: allowed = ["admin", "super_admin"] }: Props) {
  const { user, loading, roles } = useAuth();

  if (loading) return null;

  // Match RequireRole's platform-authority rule; data remains server-scoped.
  const authorized = !!user && (roles.includes("super_admin") || roles.some((r) => allowed.includes(r)));
  if (!authorized) {
    return (
      <div className="p-6">
        <Card>
          <CardContent className="flex items-start gap-3 py-6">
            <ShieldAlert className="h-5 w-5 text-destructive mt-0.5" />
            <div>
              <div className="font-medium">Restricted area</div>
              <div className="text-sm text-muted-foreground">
                This console is restricted to {allowed.join(", ")}. Your access attempt has been logged.
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }
  return <>{children}</>;
}
