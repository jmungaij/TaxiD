import { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Table, TableHeader, TableRow, TableHead, TableBody, TableCell } from "@/components/ui/table";
import { toast } from "sonner";
import { AdminOnly } from "@/components/auth/AdminOnly";

type Token = { id: string; trip_booking_id: string; owner_id: string; token_hash: string; pin_hash: string | null; max_uses: number; used_count: number; expires_at: string; revoked_at: string | null; created_at: string };
type Access = { id: string; token_hash: string; ip: string | null; user_agent: string | null; outcome: string; accessed_at: string };

function randomToken(len = 32) {
  const bytes = new Uint8Array(len);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "").slice(0, len);
}
async function sha256Hex(s: string) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export default function TripShareAdmin() {
  const { tripId } = useParams<{ tripId: string }>();
  const [tokens, setTokens] = useState<Token[]>([]);
  const [access, setAccess] = useState<Access[]>([]);
  const [pin, setPin] = useState("");
  const [ttl, setTtl] = useState(60);
  const [maxUses, setMaxUses] = useState(1);
  const [newUrl, setNewUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function load() {
    if (!tripId) return;
    const [{ data: t }, { data: a }] = await Promise.all([
      supabase.from("trip_share_tokens").select("*").eq("trip_booking_id", tripId).order("created_at", { ascending: false }),
      supabase.from("trip_share_access_log").select("*").eq("trip_booking_id", tripId).order("accessed_at", { ascending: false }).limit(200),
    ]);
    setTokens((t ?? []) as Token[]);
    setAccess((a ?? []) as Access[]);
  }
  useEffect(() => { load();   }, [tripId]);

  async function revoke(id: string) {
    const { error } = await supabase.rpc("revoke_trip_share_token", { _token_id: id });
    if (error) return toast.error(error.message);
    toast.success("Token revoked. History preserved.");
    load();
  }

  async function regenerate() {
    if (!tripId) return;
    setLoading(true);
    try {
      const raw = randomToken(32);
      const tokenHash = await sha256Hex(raw);
      const pinHash = pin ? await sha256Hex(`${tripId}:${pin}`) : null;
      const { error } = await supabase.rpc("regenerate_trip_share_token", {
        _trip_booking_id: tripId, _token_hash: tokenHash, _pin_hash: pinHash,
        _ttl_minutes: ttl, _max_uses: maxUses,
      });
      if (error) throw error;
      const url = `${window.location.origin}/t/${raw}${pin ? `?pin=${encodeURIComponent(pin)}` : ""}`;
      setNewUrl(url);
      toast.success("New signed link issued. Prior tokens revoked.");
      load();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <AdminOnly>
    <div className="p-6 space-y-6">
      <div>
        <Link to="/dashboard/admin/security-audit" className="text-sm text-muted-foreground underline">← Back to security audit</Link>
        <h1 className="text-2xl font-semibold mt-2">Trip share tokens</h1>
        <p className="text-sm text-muted-foreground">Trip <span className="font-mono">{tripId}</span></p>
      </div>

      <Card>
        <CardHeader><CardTitle>Regenerate signed link</CardTitle></CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-4">
          <div>
            <label className="text-xs text-muted-foreground">PIN (optional)</label>
            <Input value={pin} onChange={(e) => setPin(e.target.value)} placeholder="4–8 digits" />
          </div>
          <div>
            <label className="text-xs text-muted-foreground">TTL (minutes)</label>
            <Input type="number" min={5} max={1440} value={ttl} onChange={(e) => setTtl(Number(e.target.value))} />
          </div>
          <div>
            <label className="text-xs text-muted-foreground">Max uses</label>
            <Input type="number" min={1} max={20} value={maxUses} onChange={(e) => setMaxUses(Number(e.target.value))} />
          </div>
          <div className="flex items-end">
            <Button onClick={regenerate} disabled={loading || !tripId}>{loading ? "Issuing…" : "Regenerate link"}</Button>
          </div>
          {newUrl && (
            <div className="md:col-span-4 rounded-md border p-3 bg-muted/50">
              <div className="text-xs text-muted-foreground mb-1">Share this link once — the raw token is not stored:</div>
              <div className="font-mono text-xs break-all">{newUrl}</div>
              <Button size="sm" variant="outline" className="mt-2" onClick={() => { navigator.clipboard.writeText(newUrl); toast.success("Copied"); }}>Copy</Button>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Tokens ({tokens.length})</CardTitle></CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Created</TableHead>
                <TableHead>Expires</TableHead>
                <TableHead>Uses</TableHead>
                <TableHead>PIN</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Token hash</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {tokens.map((t) => {
                const active = !t.revoked_at && new Date(t.expires_at) > new Date() && t.used_count < t.max_uses;
                return (
                  <TableRow key={t.id}>
                    <TableCell className="text-xs">{new Date(t.created_at).toLocaleString()}</TableCell>
                    <TableCell className="text-xs">{new Date(t.expires_at).toLocaleString()}</TableCell>
                    <TableCell className="text-xs">{t.used_count}/{t.max_uses}</TableCell>
                    <TableCell>{t.pin_hash ? <Badge>set</Badge> : <Badge variant="outline">none</Badge>}</TableCell>
                    <TableCell>
                      {t.revoked_at ? <Badge variant="destructive">revoked</Badge> :
                       active ? <Badge>active</Badge> : <Badge variant="secondary">expired</Badge>}
                    </TableCell>
                    <TableCell className="font-mono text-xs">{t.token_hash.slice(0, 14)}…</TableCell>
                    <TableCell className="text-right">
                      <Button size="sm" variant="outline" disabled={!!t.revoked_at} onClick={() => revoke(t.id)}>Revoke</Button>
                    </TableCell>
                  </TableRow>
                );
              })}
              {!tokens.length && <TableRow><TableCell colSpan={7} className="text-center py-6 text-sm text-muted-foreground">No tokens for this trip.</TableCell></TableRow>}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Access history ({access.length})</CardTitle></CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>When</TableHead>
                <TableHead>Outcome</TableHead>
                <TableHead>IP</TableHead>
                <TableHead>Token hash</TableHead>
                <TableHead>UA</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {access.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="text-xs">{new Date(r.accessed_at).toLocaleString()}</TableCell>
                  <TableCell><Badge variant={r.outcome === "ok" ? "default" : r.outcome === "locked" ? "destructive" : "secondary"}>{r.outcome}</Badge></TableCell>
                  <TableCell className="font-mono text-xs">{r.ip ?? "—"}</TableCell>
                  <TableCell className="font-mono text-xs">{r.token_hash.slice(0, 14)}…</TableCell>
                  <TableCell className="text-xs max-w-[280px] truncate">{r.user_agent ?? "—"}</TableCell>
                </TableRow>
              ))}
              {!access.length && <TableRow><TableCell colSpan={5} className="text-center py-6 text-sm text-muted-foreground">No access attempts recorded.</TableCell></TableRow>}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
    </AdminOnly>
  );
}
