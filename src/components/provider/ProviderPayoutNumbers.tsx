/**
 * OPERATOR M-PESA PAYOUT NUMBERS.
 * Save several numbers, name each one, pick the default destination. Our team
 * verifies a number before any money can be sent to it — that check lives in
 * the database, not here.
 */
import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "@/hooks/use-toast";
import {
  loadMyPayoutNumbers,
  savePayoutNumber,
  setDefaultPayoutNumber,
} from "@/lib/provider/invoices";

const STATE_LABEL: Record<string, string> = {
  IN_REVIEW: "Being verified by our team",
  VERIFIED: "Verified — can receive money",
  REJECTED: "Rejected",
};

export default function ProviderPayoutNumbers() {
  const qc = useQueryClient();
  const [msisdn, setMsisdn] = React.useState("");
  const [name, setName] = React.useState("");

  const { data, isLoading, error } = useQuery({
    queryKey: ["provider-payout-numbers"],
    queryFn: loadMyPayoutNumbers,
  });

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["provider-payout-numbers"] });
    qc.invalidateQueries({ queryKey: ["provider-settlement-self"] });
  };

  const save = useMutation({
    mutationFn: () => savePayoutNumber(msisdn, name, (data ?? []).length === 0),
    onSuccess: () => {
      toast({ title: "Number saved", description: "Our team verifies it before any money is sent." });
      setMsisdn("");
      setName("");
      refresh();
    },
    onError: (e: Error) => toast({ title: "Not saved", description: e.message, variant: "destructive" }),
  });

  const makeDefault = useMutation({
    mutationFn: (id: string) => setDefaultPayoutNumber(id),
    onSuccess: () => {
      toast({ title: "Default destination updated" });
      refresh();
    },
    onError: (e: Error) => toast({ title: "Not updated", description: e.message, variant: "destructive" }),
  });

  if (isLoading) return <Skeleton className="h-56 w-full" />;
  if (error) return <p className="text-sm text-destructive">{(error as Error).message}</p>;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Your M-Pesa payout numbers</CardTitle>
        <CardDescription>
          Withdrawals go to the default number. You can keep more than one, but only a verified number can
          receive money.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {(data ?? []).length === 0 ? (
          <p className="text-sm text-muted-foreground">
            You have not saved a payout number yet. Add one below.
          </p>
        ) : (
          <ul className="space-y-2">
            {(data ?? []).map((a) => (
              <li key={a.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-3">
                <div>
                  <p className="text-sm font-medium">
                    {a.msisdn} · {a.account_name}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {STATE_LABEL[a.verification_state] ?? a.verification_state}
                    {a.verification_note ? ` — ${a.verification_note}` : ""}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  {a.is_default ? (
                    <Badge>Default</Badge>
                  ) : (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={makeDefault.isPending}
                      onClick={() => makeDefault.mutate(a.id)}
                    >
                      Make default
                    </Button>
                  )}
                  <Badge variant={a.verification_state === "VERIFIED" ? "default" : "outline"}>
                    {a.verification_state === "VERIFIED" ? "Verified" : "Not verified"}
                  </Badge>
                </div>
              </li>
            ))}
          </ul>
        )}

        <div className="grid gap-3 sm:grid-cols-3">
          <div className="space-y-1">
            <Label htmlFor="pn-msisdn">M-Pesa number</Label>
            <Input
              id="pn-msisdn"
              placeholder="07xx xxx xxx"
              value={msisdn}
              onChange={(e) => setMsisdn(e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="pn-name">Name registered on it</Label>
            <Input id="pn-name" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="flex items-end">
            <Button
              className="w-full"
              disabled={save.isPending || !msisdn.trim() || !name.trim()}
              onClick={() => save.mutate()}
            >
              {save.isPending ? "Saving…" : "Save number"}
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
