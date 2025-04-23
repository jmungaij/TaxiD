
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { ArrowDownIcon, ArrowUpIcon } from "lucide-react";
import { HTMLAttributes } from "react";

interface StatsCardProps extends HTMLAttributes<HTMLDivElement> {
  title: string;
  value: string | number;
  description?: string;
  icon?: React.ReactNode;
  trend?: number;
  trendLabel?: string;
}

export default function StatsCard({
  title,
  value,
  description,
  icon,
  trend,
  trendLabel,
  className,
  ...props
}: StatsCardProps) {
  return (
    <Card className={cn("overflow-hidden", className)} {...props}>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium">{title}</CardTitle>
        {icon && <div className="h-4 w-4 text-muted-foreground">{icon}</div>}
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-bold">{value}</div>
        {(description || trend !== undefined) && (
          <div className="flex items-center text-xs text-muted-foreground mt-1">
            {trend !== undefined && (
              <span 
                className={cn(
                  "mr-2 flex items-center font-medium",
                  trend > 0 ? "text-emerald-500" : trend < 0 ? "text-red-500" : "text-muted-foreground"
                )}
              >
                {trend > 0 ? (
                  <ArrowUpIcon className="mr-1 h-3 w-3" />
                ) : trend < 0 ? (
                  <ArrowDownIcon className="mr-1 h-3 w-3" />
                ) : null}
                {Math.abs(trend)}%
              </span>
            )}
            {description || trendLabel}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
