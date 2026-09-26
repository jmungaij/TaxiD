import { useEffect, useMemo, useState } from "react";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { TopUpDialog } from "@/components/dashboard/TopUpDialog";
import { WithdrawDialog } from "@/components/driver/WithdrawDialog";
import {
  Wallet as WalletIcon, ArrowDownLeft, ArrowUpRight, TrendingUp,
  Gift, Receipt, HandCoins, PiggyBank,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";

type Filter = "today" | "week" | "month" | "all";

interface Txn {
  id: string;
  direction: "credit" | "debit";
  amount_cents: number;
  kind: string;
  status: string;
  reference: string | null;
  created_at: string;
  metadata: any;
}

const KIND_LABEL: Record<string, string> = {
  ride_earning: "Ride earning",
  bonus: "Bonus",
  tip: "Tip",
  incentive: "Incentive",
  adjustment: "Adjustment",
  refund: "Refund",
  topup: "Top-up",
  withdrawal: "Withdrawal",
  commission: "Commission",
  payout: "Payout",
};

const CREDIT_KINDS = new Set(["ride_earning", "bonus", "tip", "incentive", "refund", "topup", "adjustment"]);

function startOf(period: Filter): number {
  const now = new Date();
  if (period === "today") { now.setHours(0, 0, 0, 0); return now.getTime(); }
  if (period === "week") { const d = new Date(); d.setDate(d.getDate() - 7); return d.getTime(); }
  if (period === "month") { const d = new Date(); d.setMonth(d.getMonth() - 1); return d.getTime(); }
  return 0;
}

export default function DriverWalletPage() {
  const { user } = useAuth();
  const [wallet, setWallet] = useState<{ id: string; balance_cents: number } | null>(null);
  const [driverId, setDriverId] = useState<string>("");
  const [txns, setTxns] = useState<Txn[]>([]);
  const [filter, setFilter] = useState<Filter>("month");
  const [loadError, setLoadError] = useState<string | null>(null);

  async function refresh() {
    if (!user) return;
    const c: any = supabase;
    const { data: w, error: wErr } = await supabase.from("wallets")
      .select("id,balance_cents").eq("user_id", user.id).eq("wallet_type", "driver").maybeSingle();
    if (w) setWallet(w as any);
    const { data: t, error: tErr } = await c.from("wallet_transactions")
      .select("id,direction,amount_cents,kind,status,reference,created_at,metadata")
      .eq("user_id", user.id).order("created_at", { ascending: false }).limit(100);
    if (!tErr) setTxns((t as Txn[]) ?? []);
    const { data: d } = await c.from("drivers").select("id").eq("user_id", user.id).maybeSingle();
    if (d?.id) setDriverId(d.id);
    // Surface read failures rather than showing a stale/zero balance as truth.
    setLoadError(wErr?.message ?? tErr?.message ?? null);
  }


  useEffect(() => { refresh(); }, [user]);

  const stats = useMemo(() => {
    const cutoff = startOf(filter);
    const scoped = txns.filter((t) => new Date(t.created_at).getTime() >= cutoff);
    let gross = 0, commission = 0, tips = 0, bonuses = 0, withdrawn = 0;
    for (const t of scoped) {
      if (t.kind === "ride_earning") gross += t.amount_cents;
      else if (t.kind === "commission") commission += t.amount_cents;
      else if (t.kind === "tip") tips += t.amount_cents;
      else if (t.kind === "bonus" || t.kind === "incentive") bonuses += t.amount_cents;
      else if (t.kind === "withdrawal" || t.kind === "payout") withdrawn += t.amount_cents;
    }
    const net = gross - commission + tips + bonuses;
    return { gross, commission, tips, bonuses, withdrawn, net, count: scoped.length };
  }, [txns, filter]);

  const kes = (cents: number) => `KES ${Math.abs(cents / 100).toLocaleString("en-KE", { maximumFractionDigits: 0 })}`;

  return (
    <div className="space-y-6">
      {loadError && (
        <div role="alert" className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-xs text-destructive">
          Wallet data could not be refreshed — the figures below may be out of date. {loadError}
        </div>
      )}
      {/* Balance hero */}

      <Card className="overflow-hidden">
        <div className="bg-gradient-to-br from-primary to-primary/70 text-primary-foreground p-6">
          <div className="flex items-start justify-between flex-wrap gap-4">
            <div>
              <div className="flex items-center gap-2 text-sm opacity-90">
                <WalletIcon className="h-4 w-4" /> Available balance
              </div>
              <div className="text-4xl font-bold mt-1">{kes(wallet?.balance_cents ?? 0)}</div>
              <div className="text-xs opacity-80 mt-1">Ledger-backed · Reconciled hourly</div>
            </div>
            <div className="flex gap-2 flex-wrap">
              <WithdrawDialog driverId={driverId} availableCents={wallet?.balance_cents ?? 0} onRequested={refresh} />
              <TopUpDialog walletType="driver" walletId={wallet?.id ?? ""} onSuccess={(b) => setWallet((w) => (w ? { ...w, balance_cents: b } : w))} />
            </div>
          </div>
        </div>
      </Card>

      {/* Filter */}
      <div className="flex items-center gap-2">
        {(["today", "week", "month", "all"] as Filter[]).map((f) => (
          <Button
            key={f}
            size="sm"
            variant={filter === f ? "default" : "outline"}
            onClick={() => setFilter(f)}
            className="capitalize"
          >
            {f === "all" ? "Lifetime" : f}
          </Button>
        ))}
      </div>

      {/* Earnings breakdown */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        <StatTile icon={TrendingUp} label="Gross" value={kes(stats.gross)} />
        <StatTile icon={Receipt} label="Commission" value={`-${kes(stats.commission)}`} />
        <StatTile icon={Gift} label="Tips" value={kes(stats.tips)} />
        <StatTile icon={HandCoins} label="Bonuses" value={kes(stats.bonuses)} />
        <StatTile icon={ArrowUpRight} label="Withdrawn" value={kes(stats.withdrawn)} />
        <StatTile icon={PiggyBank} label="Net earnings" value={kes(stats.net)} highlight />
      </div>

      {/* Transactions */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-base">Recent transactions</CardTitle>
          <Badge variant="secondary">{stats.count} in period</Badge>
        </CardHeader>
        <CardContent className="space-y-1">
          {txns.length === 0 && (
            <p className="text-sm text-muted-foreground py-6 text-center">
              No wallet activity yet. Earnings from completed trips will appear here automatically.
            </p>
          )}
          {txns.map((t) => {
            const isCredit = t.direction === "credit" || CREDIT_KINDS.has(t.kind);
            return (
              <div key={t.id} className="flex items-center gap-3 py-2 border-b last:border-0">
                {isCredit ? (
                  <ArrowDownLeft className="h-4 w-4 text-status-success" />
                ) : (
                  <ArrowUpRight className="h-4 w-4 text-muted-foreground" />
                )}
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium">{KIND_LABEL[t.kind] ?? t.kind}</div>
                  <div className="text-xs text-muted-foreground truncate">{t.reference ?? "—"}</div>
                </div>
                <div className="text-right">
                  <div className={`text-sm font-semibold ${isCredit ? "text-status-success" : ""}`}>
                    {isCredit ? "+" : "-"}{kes(t.amount_cents)}
                  </div>
                  <div className="text-[10px] text-muted-foreground">
                    {formatDistanceToNow(new Date(t.created_at), { addSuffix: true })}
                  </div>
                </div>
              </div>
            );
          })}
        </CardContent>
      </Card>
    </div>
  );
}

function StatTile({ icon: Icon, label, value, highlight }: { icon: typeof WalletIcon; label: string; value: string; highlight?: boolean }) {
  return (
    <div className={`rounded-lg border p-3 ${highlight ? "bg-primary/5 border-primary/30" : ""}`}>
      <div className="flex items-center justify-between mb-1">
        <span className="text-xs text-muted-foreground">{label}</span>
        <Icon className="h-4 w-4 text-muted-foreground" />
      </div>
      <div className={`text-lg font-semibold ${highlight ? "text-primary" : ""}`}>{value}</div>
    </div>
  );
}
