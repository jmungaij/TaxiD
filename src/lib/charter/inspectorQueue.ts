/**
 * Offline-first inspection queue.
 *
 * Inspectors work in tunnels, on rural highways and inside terminals with no
 * signal. Every scan verdict is recorded locally first, then flushed to the
 * public `ticket-verify` endpoint the moment connectivity returns.
 */
import { supabase } from "@/integrations/supabase/client";

const KEY = "yalla.inspector.queue.v1";

export interface InspectionRecord {
  id: string;
  serial: string | null;
  reference: string | null;
  control: string | null;
  verdict: "VALID" | "EXPIRED" | "TAMPERED" | "UNREADABLE";
  scannedAt: string;
  inspector: string;
  deviceOnline: boolean;
  synced?: boolean;
}

function read(): InspectionRecord[] {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as InspectionRecord[]) : [];
  } catch {
    return [];
  }
}

function write(rows: InspectionRecord[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(rows.slice(-500)));
  } catch {
    /* storage full — the newest scans still live in memory for this session */
  }
}

export function listInspections(): InspectionRecord[] {
  return read().slice().reverse();
}

export function recordInspection(rec: Omit<InspectionRecord, "id" | "synced">): InspectionRecord {
  const row: InspectionRecord = {
    ...rec,
    id:
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `ins_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    synced: false,
  };
  write([...read(), row]);
  return row;
}

export function pendingCount(): number {
  return read().filter((r) => !r.synced).length;
}

/** Flush every unsynced verdict. Safe to call repeatedly. */
export async function syncInspections(): Promise<{ synced: number; error?: string }> {
  const rows = read();
  const pending = rows.filter((r) => !r.synced);
  if (pending.length === 0) return { synced: 0 };
  try {
    const { data, error } = await supabase.functions.invoke("ticket-verify", {
      body: { audits: pending },
    });
    if (error) return { synced: 0, error: error.message };
    const ids = new Set(pending.map((p) => p.id));
    write(rows.map((r) => (ids.has(r.id) ? { ...r, synced: true } : r)));
    return { synced: Number(data?.synced ?? pending.length) };
  } catch (e) {
    return { synced: 0, error: e instanceof Error ? e.message : String(e) };
  }
}

export function clearSynced() {
  write(read().filter((r) => !r.synced));
}
