import { useAuth } from "@/hooks/useAuth";
import { Wallet, ArrowUpRight, Clock, ShieldCheck } from "lucide-react";
import { TopUpDialog } from "@/components/dashboard/TopUpDialog";
import { TransactionsList } from "@/components/dashboard/TransactionsList";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export default function RiderDashboard() {
  const { user } = useAuth();
  const [balance, setBalance] = useState<number>(0);
  const [walletId, setWalletId] = useState<string>("");

  useEffect(() => {
    if (!user) return;
    supabase
      .from("wallets")
      .select("id,balance_cents")
      .eq("user_id", user.id)
      .eq("wallet_type", "personal")
      .single()
      .then(({ data }) => {
        if (data) {
          setBalance(data.balance_cents);
          setWalletId(data.id);
        }
      });
  }, [user]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Rider Dashboard</h1>
        <TopUpDialog walletType="personal" walletId={walletId} onSuccess={(b) => setBalance(b)} />
      </div>

      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="rounded-xl border bg-card p-5 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-sm text-muted-foreground">Wallet Balance</span>
            <Wallet className="h-5 w-5 text-primary" />
          </div>
          <p className="text-2xl font-bold mt-2">KES {(balance / 100).toFixed(2)}</p>
        </div>
        <div className="rounded-xl border bg-card p-5 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-sm text-muted-foreground">Trips Today</span>
            <ArrowUpRight className="h-5 w-5 text-primary" />
          </div>
          <p className="text-2xl font-bold mt-2">3</p>
        </div>
        <div className="rounded-xl border bg-card p-5 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-sm text-muted-foreground">Pending</span>
            <Clock className="h-5 w-5 text-muted-foreground" />
          </div>
          <p className="text-2xl font-bold mt-2">1</p>
        </div>
        <div className="rounded-xl border bg-card p-5 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-sm text-muted-foreground">Rating</span>
            <ShieldCheck className="h-5 w-5 text-status-success" />
          </div>
          <p className="text-2xl font-bold mt-2">4.8</p>
        </div>
      </div>

      <div className="grid lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 rounded-xl border bg-card p-6 shadow-sm">
          <h2 className="font-semibold mb-4">Recent Trips</h2>
          <p className="text-sm text-muted-foreground">Trip history will appear here once trips are booked.</p>
        </div>
        <div className="rounded-xl border bg-card p-6 shadow-sm">
          <h2 className="font-semibold mb-4">Wallet Transactions</h2>
          <TransactionsList walletId={walletId} />
        </div>
      </div>
    </div>
  );
}
