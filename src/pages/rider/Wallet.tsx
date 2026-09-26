import { useCallback, useEffect, useState } from "react";
import { RiderShell } from "@/components/rider/RiderShell";
import { ErrorState } from "@/components/rider/ErrorState";
import { TopUpDialog } from "@/components/dashboard/TopUpDialog";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Card } from "@/components/ui/card";
import { Wallet as WalletIcon, ArrowDownLeft, ArrowUpRight } from "lucide-react";
import { formatDistanceToNow } from "date-fns";

interface PersonalWallet {
  id: string;
  balance_cents: number;
  currency: string;
  lifecycle_status: string;
}

interface Txn {
  id: string;
  kind: string;
  direction: string;
  amount_cents: number;
  status: string;
  reference: string | null;
  mpesa_receipt: string | null;
  created_at: string;
}

export default function RiderWalletPage() {
  const { user } = useAuth();
  const [wallet, setWallet] = useState<PersonalWallet | null>(null);
  const [txns, setTxns] = useState<Txn[]>([]);
  const [loadError, setLoadError] = useState(false);

  const refresh = useCallback(async () => {
    if (!user) return;
    setLoadError(false);
    const walletRes = await supabase
      .from("wallets")
      .select("id,balance_cents,currency,lifecycle_status")
      .eq("user_id", user.id)
      .eq("wallet_type", "personal")
      .maybeSingle();
    if (walletRes.error) {
      setLoadError(true);
      return;
    }
    setWallet((walletRes.data as PersonalWallet) ?? null);

    const txnRes = await supabase
      .from("wallet_transactions")
      .select("id,kind,direction,amount_cents,status,reference,mpesa_receipt,created_at")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(20);
    if (txnRes.error) {
      setLoadError(true);
      return;
    }
    setTxns((txnRes.data as Txn[]) ?? []);
  }, [user]);

  useEffect(() => {
    if (!user) return;
    void refresh();
  }, [user, refresh]);

  const currency = wallet?.currency ?? "KES";

  return (
    <RiderShell>
      <h1 className="text-2xl font-bold mb-4">Wallet</h1>
      {loadError ? (
        <ErrorState
          message="We couldn't load your wallet right now. Please try again."
          onRetry={refresh}
          testId="rider-wallet-error"
        />
      ) : (
        <>
          <Card className="p-6 mb-4 bg-gradient-to-br from-primary to-primary/70 text-primary-foreground">
            <div className="flex items-center gap-2 text-sm opacity-90 mb-2">
              <WalletIcon className="h-4 w-4" /> Available balance
            </div>
            <div className="text-4xl font-bold" data-testid="rider-wallet-balance">
              {currency} {((wallet?.balance_cents ?? 0) / 100).toLocaleString()}
            </div>
            <div className="mt-4">
              <TopUpDialog
                walletType="personal"
                walletId={wallet?.id ?? ""}
                triggerLabel="Top up via M-Pesa"
                triggerVariant="secondary"
                triggerSize="sm"
                onSuccess={(balanceCents) => {
                  setWallet((w) => (w ? { ...w, balance_cents: balanceCents } : w));
                  void refresh();
                }}
              />
            </div>
            {!wallet && (
              <p className="mt-2 text-xs opacity-80">
                Your personal wallet is created with your first top-up.
              </p>
            )}
          </Card>

          <h2 className="text-sm font-semibold mb-2 text-muted-foreground">Recent transactions</h2>
          <div className="space-y-1">
            {txns.length === 0 && <p className="text-sm text-muted-foreground">No transactions yet.</p>}
            {txns.map((t) => {
              const isCredit = t.direction === "credit" || t.direction === "CREDIT";
              return (
                <Card key={t.id} className="p-3 flex items-center gap-3">
                  {isCredit ? (
                    <ArrowDownLeft className="h-4 w-4 text-status-success" />
                  ) : (
                    <ArrowUpRight className="h-4 w-4 text-muted-foreground" />
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium capitalize">{String(t.kind).replace(/_/g, " ")}</div>
                    <div className="text-xs text-muted-foreground truncate">
                      {t.mpesa_receipt ?? t.reference}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className={`font-semibold text-sm ${isCredit ? "text-status-success" : ""}`}>
                      {isCredit ? "+" : "-"}
                      {currency} {(Number(t.amount_cents) / 100).toLocaleString()}
                    </div>
                    <div className="text-[10px] text-muted-foreground">
                      {t.status} · {formatDistanceToNow(new Date(t.created_at), { addSuffix: true })}
                    </div>
                  </div>
                </Card>
              );
            })}
          </div>
        </>
      )}
    </RiderShell>
  );
}
