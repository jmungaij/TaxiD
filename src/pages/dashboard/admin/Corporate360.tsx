import type { LooseRow } from "@/lib/types/loose";
import { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Wallet as WalletIcon, FileText, Users, Phone, MessageSquare } from "lucide-react";
import {
  Workspace360Shell,
  Workspace360EmptyPanel,
  type Workspace360TabConfig,
} from "@/components/workspace360/Workspace360Shell";

/**
 * Corporate 360 — Phase D7.5 lean adoption of Workspace360Shell.
 * Mounts the canonical tab surface for the corporate domain, reusing
 * existing corporate tables only. No new services introduced.
 */
const kes = (c: number | null | undefined) =>
  `KES ${Math.abs((c ?? 0) / 100).toLocaleString("en-KE", { maximumFractionDigits: 0 })}`;

export default function Corporate360() {
  const { corporateId = "" } = useParams();
  const [account, setAccount] = useState<LooseRow | null>(null);
  const [ledger, setLedger] = useState<LooseRow[]>([]);
  const [ledgerBalance, setLedgerBalance] = useState<number>(0);
  const [invoices, setInvoices] = useState<LooseRow[]>([]);
  const [approvals, setApprovals] = useState<LooseRow[]>([]);
  const [documents, setDocuments] = useState<LooseRow[]>([]);
  const [violations, setViolations] = useState<LooseRow[]>([]);
  const [employees, setEmployees] = useState<LooseRow[]>([]);
  const [audit, setAudit] = useState<LooseRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!corporateId) return;
    void (async () => {
      setLoading(true);
      const c: LooseRow = supabase;
      const { data: a } = await c
        .from("corporate_accounts")
        .select("*")
        .eq("id", corporateId)
        .maybeSingle();
      setAccount(a);
      const list = (table: string, sel: string, order = "created_at") =>
        c.from(table).select(sel).eq("corporate_id", corporateId).order(order, { ascending: false }).limit(50);
      const [led, inv, apr, doc, vio, emp] = await Promise.all([
        list("corporate_cash_ledger", "id,entry_type,amount_cents,balance_after_cents,reference,description,occurred_at,created_at", "occurred_at"),
        list("corporate_invoices", "id,invoice_number,status,total_cents,paid_cents,balance_cents,issued_at,due_at,created_at"),
        list("corporate_ride_approvals", "id,status,created_at"),
        list("corporate_documents", "id,doc_type,status,expiry_date,uploaded_at,created_at"),
        list("corporate_policy_violations", "id,decision,reason,fare_cents,created_at"),
        list("corporate_employees", "id,full_name,email,role,status,created_at"),
      ]);
      const ledgerRows = ((led as LooseRow)?.data as LooseRow[]) ?? [];
      setLedger(ledgerRows);
      setLedgerBalance(ledgerRows[0]?.balance_after_cents ?? 0);
      setInvoices(((inv as LooseRow)?.data as LooseRow[]) ?? []);
      setApprovals(((apr as LooseRow)?.data as LooseRow[]) ?? []);
      setDocuments(((doc as LooseRow)?.data as LooseRow[]) ?? []);
      setViolations(((vio as LooseRow)?.data as LooseRow[]) ?? []);
      setEmployees(((emp as LooseRow)?.data as LooseRow[]) ?? []);
      const events: LooseRow[] = [];
      ledgerRows.forEach((x) =>
        events.push({ ts: x.occurred_at ?? x.created_at, kind: "ledger", label: `${x.entry_type} ${kes(x.amount_cents)}` }));
      (((inv as LooseRow)?.data as LooseRow[]) ?? []).forEach((x) =>
        events.push({ ts: x.created_at, kind: "invoice", label: `${x.invoice_number ?? "invoice"} · ${x.status}` }));
      (((apr as LooseRow)?.data as LooseRow[]) ?? []).forEach((x) =>
        events.push({ ts: x.created_at, kind: "approval", label: `approval ${x.status}` }));
      (((doc as LooseRow)?.data as LooseRow[]) ?? []).forEach((x) =>
        events.push({ ts: x.created_at, kind: "kyb", label: `${x.doc_type} ${x.status}` }));
      (((vio as LooseRow)?.data as LooseRow[]) ?? []).forEach((x) =>
        events.push({ ts: x.created_at, kind: "policy", label: `${x.decision} · ${x.reason ?? ""}` }));
      events.sort((a, b) => (a.ts < b.ts ? 1 : -1));
      setAudit(events.slice(0, 100));
      setLoading(false);
    })();
  }, [corporateId]);

  if (loading) return <div className="p-8 text-muted-foreground">Loading corporate…</div>;
  if (!account)
    return (
      <div className="p-8">
        Corporate account not found.{" "}
        <Link className="underline" to="/dashboard/admin/corporates">Back</Link>
      </div>
    );

  const displayName = account.trading_name || account.legal_name || "Corporate";
  const initials = displayName.slice(0, 2).toUpperCase();
  const openInvoices = invoices.filter((i) => (i.balance_cents ?? 0) > 0).length;
  const pendingApprovals = approvals.filter((a) => a.status === "pending").length;
  const activeEmployees = employees.filter((e) => e.status === "active").length;

  const tabs: Workspace360TabConfig[] = [
    {
      tab: "overview",
      render: () => (
        <div className="grid md:grid-cols-4 gap-3">
          <Card><CardContent className="pt-4 text-sm">
            <div className="text-muted-foreground text-xs mb-1">Active employees</div>
            <div className="text-xl font-semibold">{activeEmployees}</div>
          </CardContent></Card>
          <Card><CardContent className="pt-4 text-sm">
            <div className="text-muted-foreground text-xs mb-1">Open invoices</div>
            <div className="text-xl font-semibold">{openInvoices}</div>
          </CardContent></Card>
          <Card><CardContent className="pt-4 text-sm">
            <div className="text-muted-foreground text-xs mb-1">Pending approvals</div>
            <div className="text-xl font-semibold">{pendingApprovals}</div>
          </CardContent></Card>
          <Card><CardContent className="pt-4 text-sm">
            <div className="text-muted-foreground text-xs mb-1">Credit limit</div>
            <div className="text-xl font-semibold">{kes(account.credit_limit_cents)}</div>
          </CardContent></Card>
        </div>
      ),
    },
    {
      tab: "financial",
      render: () => (
        <Card><CardContent className="pt-4">
          <Table>
            <TableHeader><TableRow>
              <TableHead>When</TableHead><TableHead>Entry</TableHead>
              <TableHead>Amount</TableHead><TableHead>Balance</TableHead>
              <TableHead>Reference</TableHead>
            </TableRow></TableHeader>
            <TableBody>
              {ledger.map((t) => (
                <TableRow key={t.id}>
                  <TableCell className="text-xs">{new Date(t.occurred_at ?? t.created_at).toLocaleString()}</TableCell>
                  <TableCell><Badge variant="outline">{t.entry_type}</Badge></TableCell>
                  <TableCell>{kes(t.amount_cents)}</TableCell>
                  <TableCell>{kes(t.balance_after_cents)}</TableCell>
                  <TableCell className="font-mono text-xs">{t.reference ?? "—"}</TableCell>
                </TableRow>
              ))}
              {ledger.length === 0 && (
                <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground py-6">No ledger entries.</TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent></Card>
      ),
    },
    {
      tab: "timeline",
      render: () => (
        <Card><CardContent className="pt-4">
          <Table>
            <TableHeader><TableRow>
              <TableHead>When</TableHead><TableHead>Source</TableHead><TableHead>Event</TableHead>
            </TableRow></TableHeader>
            <TableBody>
              {audit.map((e, i) => (
                <TableRow key={`${e.kind}-${i}`}>
                  <TableCell className="text-xs">{new Date(e.ts).toLocaleString()}</TableCell>
                  <TableCell><Badge variant="outline">{e.kind}</Badge></TableCell>
                  <TableCell className="text-xs">{e.label}</TableCell>
                </TableRow>
              ))}
              {audit.length === 0 && (
                <TableRow><TableCell colSpan={3} className="text-center text-muted-foreground py-6">No timeline events.</TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent></Card>
      ),
    },
    {
      tab: "documents",
      render: () => (
        <Card><CardContent className="pt-4">
          <Table>
            <TableHeader><TableRow>
              <TableHead>Type</TableHead><TableHead>Status</TableHead>
              <TableHead>Expiry</TableHead><TableHead>Uploaded</TableHead>
            </TableRow></TableHeader>
            <TableBody>
              {documents.map((d) => (
                <TableRow key={d.id}>
                  <TableCell className="text-xs">{d.doc_type}</TableCell>
                  <TableCell><Badge variant="outline">{d.status}</Badge></TableCell>
                  <TableCell className="text-xs">{d.expiry_date ?? "—"}</TableCell>
                  <TableCell className="text-xs">{new Date(d.uploaded_at ?? d.created_at).toLocaleDateString()}</TableCell>
                </TableRow>
              ))}
              {documents.length === 0 && (
                <TableRow><TableCell colSpan={4} className="text-center text-muted-foreground py-6">No KYB documents.</TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent></Card>
      ),
    },
    {
      tab: "compliance",
      render: () => (
        <Card><CardContent className="pt-4">
          <div className="text-xs text-muted-foreground mb-2">Policy violations</div>
          {violations.length === 0 ? (
            <div className="text-sm text-muted-foreground">No policy violations.</div>
          ) : (
            <Table>
              <TableHeader><TableRow>
                <TableHead>When</TableHead><TableHead>Decision</TableHead>
                <TableHead>Reason</TableHead><TableHead>Fare</TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {violations.map((v) => (
                  <TableRow key={v.id}>
                    <TableCell className="text-xs">{new Date(v.created_at).toLocaleString()}</TableCell>
                    <TableCell><Badge variant="outline">{v.decision}</Badge></TableCell>
                    <TableCell className="text-xs">{v.reason ?? "—"}</TableCell>
                    <TableCell>{kes(v.fare_cents)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent></Card>
      ),
    },
    {
      tab: "performance",
      render: () => (
        <div className="grid md:grid-cols-3 gap-3">
          <Card><CardContent className="pt-4 text-sm">
            <div className="text-muted-foreground text-xs mb-1">Invoices billed</div>
            <div className="text-xl font-semibold">{invoices.length}</div>
          </CardContent></Card>
          <Card><CardContent className="pt-4 text-sm">
            <div className="text-muted-foreground text-xs mb-1">Outstanding balance</div>
            <div className="text-xl font-semibold">
              {kes(invoices.reduce((a, i) => a + (i.balance_cents ?? 0), 0))}
            </div>
          </CardContent></Card>
          <Card><CardContent className="pt-4 text-sm">
            <div className="text-muted-foreground text-xs mb-1">Payment terms</div>
            <div className="text-xl font-semibold">{account.payment_terms_days ?? 0} days</div>
          </CardContent></Card>
        </div>
      ),
    },
    {
      tab: "support",
      render: () => (
        <Card><CardContent className="pt-4">
          <div className="text-xs text-muted-foreground mb-2">Employees ({employees.length})</div>
          <Table>
            <TableHeader><TableRow>
              <TableHead>Name</TableHead><TableHead>Email</TableHead>
              <TableHead>Role</TableHead><TableHead>Status</TableHead>
            </TableRow></TableHeader>
            <TableBody>
              {employees.map((e) => (
                <TableRow key={e.id}>
                  <TableCell className="text-xs">{e.full_name ?? "—"}</TableCell>
                  <TableCell className="text-xs">{e.email ?? "—"}</TableCell>
                  <TableCell className="text-xs">{e.role ?? "—"}</TableCell>
                  <TableCell><Badge variant="outline">{e.status ?? "—"}</Badge></TableCell>
                </TableRow>
              ))}
              {employees.length === 0 && (
                <TableRow><TableCell colSpan={4} className="text-center text-muted-foreground py-6">No employees.</TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent></Card>
      ),
    },
    {
      tab: "analytics",
      render: () => (
        <Workspace360EmptyPanel
          title="Analytics"
          description="Corporate spend analytics will surface here in a future phase."
        />
      ),
    },
    {
      tab: "twin",
      render: () => (
        <Workspace360EmptyPanel
          title="Digital Twin"
          description="Corporate Digital Twin scenarios will surface here."
        />
      ),
    },
    {
      tab: "audit",
      render: () => (
        <Card><CardContent className="pt-4">
          <Table>
            <TableHeader><TableRow>
              <TableHead>When</TableHead><TableHead>Invoice</TableHead>
              <TableHead>Status</TableHead><TableHead>Total</TableHead>
              <TableHead>Balance</TableHead>
            </TableRow></TableHeader>
            <TableBody>
              {invoices.map((i) => (
                <TableRow key={i.id}>
                  <TableCell className="text-xs">{new Date(i.issued_at ?? i.created_at).toLocaleDateString()}</TableCell>
                  <TableCell className="font-mono text-xs">{i.invoice_number ?? "—"}</TableCell>
                  <TableCell><Badge variant="outline">{i.status}</Badge></TableCell>
                  <TableCell>{kes(i.total_cents)}</TableCell>
                  <TableCell>{kes(i.balance_cents)}</TableCell>
                </TableRow>
              ))}
              {invoices.length === 0 && (
                <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground py-6">No invoices.</TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent></Card>
      ),
    },
    {
      tab: "settings",
      render: () => (
        <Workspace360EmptyPanel
          title="Settings"
          description="Corporate preferences and account controls will surface here."
        />
      ),
    },
  ];

  return (
    <Workspace360Shell
      domain="corporate"
      entityId={corporateId}
      title={displayName}
      subtitle={`${account.billing_email ?? "—"} · KRA ${account.kra_pin ?? "—"}`}
      initials={initials}
      statusBadges={[
        { label: account.status ?? "unknown" },
        ...(account.currency ? [{ label: String(account.currency) }] : []),
      ]}
      kpis={[
        { icon: WalletIcon, label: "Ledger balance", value: kes(ledgerBalance) },
        { icon: FileText, label: "Open invoices", value: String(openInvoices) },
        { icon: Users, label: "Employees", value: String(activeEmployees) },
      ]}
      actions={
        <>
          <Button size="sm" variant="outline" disabled title="Contact channels ship with the Communications module (D12.x)"><Phone className="h-4 w-4" /></Button>
          <Button size="sm" variant="outline" disabled title="Contact channels ship with the Communications module (D12.x)"><MessageSquare className="h-4 w-4" /></Button>
        </>
      }
      tabs={tabs}
      directoryLabel="Corporates"
    />
  );
}
