import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";

interface TransactionsListProps {
  walletId: string;
  limit?: number;
}

export function TransactionsList({ walletId, limit = 10 }: TransactionsListProps) {
  const [transactions, setTransactions] = useState<any[]>([]);

  useEffect(() => {
    if (!walletId) return;
    supabase
      .from("wallet_transactions")
      .select("*")
      .eq("wallet_id", walletId)
      .order("created_at", { ascending: false })
      .limit(limit)
      .then(({ data }) => setTransactions(data || []));
  }, [walletId]);

  if (!walletId) return <p className="text-sm text-muted-foreground">No wallet selected.</p>;
  if (transactions.length === 0) return <p className="text-sm text-muted-foreground">No transactions yet.</p>;

  const statusColor = (status: string) => {
    switch (status) {
      case "completed": return "bg-status-success/10 text-status-success";
      case "pending": return "bg-status-warning/10 text-status-warning";
      case "failed": return "bg-status-danger/10 text-status-danger";
      default: return "bg-muted text-muted-foreground";
    }
  };

  return (
    <div className="space-y-3">
      {transactions.map((tx) => (
        <div key={tx.id} className="flex items-center justify-between rounded-lg border p-3">
          <div>
            <p className="text-sm font-medium capitalize">{tx.kind.replace("_", " ")}</p>
            <p className="text-xs text-muted-foreground">{new Date(tx.created_at).toLocaleString()}</p>
          </div>
          <div className="text-right">
            <p className={`text-sm font-semibold ${tx.direction === "credit" ? "text-status-success" : "text-status-danger"}`}>
              {tx.direction === "credit" ? "+" : "-"}KES {(tx.amount_cents / 100).toFixed(2)}
            </p>
            <Badge variant="outline" className={`text-xs ${statusColor(tx.status)}`}>{tx.status}</Badge>
          </div>
        </div>
      ))}
    </div>
  );
}
