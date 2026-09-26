import { AlertTriangle, ArrowRight, Info } from "lucide-react";
import { Link } from "react-router-dom";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useAuth } from "@/hooks/useAuth";
import type { MappedLogisticsError } from "@/lib/logistics/errorContract";

const STAFF_ROLES = ["admin", "super_admin", "operations_admin", "staff", "logistics_admin"];

interface Props {
  mapped: MappedLogisticsError;
  /** Optional retry handler; only rendered when the refusal is retryable. */
  onRetry?: () => void;
  className?: string;
}

/**
 * The single rendering of a logistics refusal.
 *
 * Customers see what happened, why, whether they can retry and what to do next.
 * Staff additionally see the operator facts (code, state, required transition,
 * correlation id). No SQL, stack, secret or infrastructure detail is ever shown.
 */
export function LogisticsErrorNotice({ mapped, onRetry, className }: Props) {
  const { roles } = useAuth();
  const isStaff = (roles ?? []).some((r) => STAFF_ROLES.includes(r));
  const { customer, operator, fallbackRoute, isBusinessRefusal } = mapped;

  return (
    <Card
      role="alert"
      data-testid="logistics-error-notice"
      data-error-code={operator.code}
      className={`border-destructive/30 bg-destructive/5 ${className ?? ""}`}
    >
      <CardContent className="p-4 space-y-3">
        <div className="flex items-start gap-3">
          {isBusinessRefusal ? (
            <Info className="h-5 w-5 text-destructive mt-0.5 shrink-0" aria-hidden="true" />
          ) : (
            <AlertTriangle className="h-5 w-5 text-destructive mt-0.5 shrink-0" aria-hidden="true" />
          )}
          <div className="min-w-0 space-y-1">
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="font-semibold text-sm">{customer.title}</h3>
              <Badge variant="outline" className="text-[10px]">{operator.code}</Badge>
            </div>
            <p className="text-sm text-muted-foreground">{customer.detail}</p>
            {customer.action && (
              <p className="text-sm">
                <span className="font-medium">What you can do: </span>
                {customer.action}
              </p>
            )}
            {customer.activationCondition && (
              <p className="text-xs text-muted-foreground">
                <span className="font-medium">Activation condition: </span>
                {customer.activationCondition}
              </p>
            )}
            {mapped.legalBlocking.length > 0 && (
              <div className="pt-1" data-testid="logistics-error-legal-blocking">
                <p className="text-xs font-medium">Authorisations still outstanding</p>
                <ul className="mt-1 space-y-1">
                  {mapped.legalBlocking.map((l) => (
                    <li key={l.control_id} className="text-xs text-muted-foreground">
                      <Badge variant="outline" className="mr-1.5 text-[10px]">{l.control_id}</Badge>
                      {l.title} — awaiting {l.required_approval.toLowerCase()}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </div>


        <div className="flex flex-wrap gap-2">
          {customer.retryable && onRetry && (
            <Button size="sm" variant="outline" onClick={onRetry}>
              Try again
            </Button>
          )}
          {fallbackRoute && (
            <Button size="sm" variant="secondary" asChild className="gap-1.5">
              <Link to={fallbackRoute}>
                Send an enquiry <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
              </Link>
            </Button>
          )}
        </div>

        {isStaff && (
          <details className="rounded-md border bg-muted/40 p-3 text-xs" data-testid="logistics-error-operator">
            <summary className="cursor-pointer font-medium">Operator detail</summary>
            <dl className="mt-2 grid grid-cols-[9rem,1fr] gap-x-3 gap-y-1 font-mono">
              {operator.facts.map((f) => (
                <div key={f.label} className="contents">
                  <dt className="text-muted-foreground">{f.label}</dt>
                  <dd className="break-words">{f.value}</dd>
                </div>
              ))}
              <dt className="text-muted-foreground">Category</dt>
              <dd>{operator.category}</dd>
              <dt className="text-muted-foreground">HTTP</dt>
              <dd>{operator.httpStatus}</dd>
              <dt className="text-muted-foreground">Reason</dt>
              <dd>{operator.reason}</dd>
            </dl>
          </details>
        )}
      </CardContent>
    </Card>
  );
}

export default LogisticsErrorNotice;
