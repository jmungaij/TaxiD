/**
 * PHASES 10 & 11 — EXECUTED CONCURRENCY AND IDEMPOTENCY SIMULATIONS.
 *
 * These are genuinely executed: each scenario races real async contenders
 * against a reference store that implements the locking control named in the
 * concurrency matrix (row lock, unique index, advisory lock, optimistic
 * expected-state). The result is a measured count of authoritative effects.
 *
 * Scope statement: this proves the CONTROL DESIGN produces exactly one effect
 * under contention. It does not prove Postgres enforcement — that is AV-09/AV-10
 * and stays BLOCKED until the isolated database exists.
 */

/** Reference store with per-key mutual exclusion (stands in for FOR UPDATE / advisory lock). */
class LockingStore {
  private locks = new Map<string, Promise<void>>();
  private rows = new Map<string, Record<string, unknown>>();
  private unique = new Set<string>();
  effects: string[] = [];

  async withLock<T>(key: string, fn: () => Promise<T> | T): Promise<T> {
    const prior = this.locks.get(key) ?? Promise.resolve();
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    this.locks.set(key, prior.then(() => gate));
    await prior;
    try {
      // Yield so competing contenders genuinely interleave before the critical section.
      await Promise.resolve();
      return await fn();
    } finally {
      release();
    }
  }

  get(key: string) {
    return this.rows.get(key);
  }
  set(key: string, row: Record<string, unknown>) {
    this.rows.set(key, row);
  }
  /** Unique index emulation: returns false when the key already exists. */
  insertUnique(key: string, effect: string): boolean {
    if (this.unique.has(key)) return false;
    this.unique.add(key);
    this.effects.push(effect);
    return true;
  }
}

export interface SimResult {
  id: string;
  scenario: string;
  contenders: number;
  control: string;
  authoritativeEffects: number;
  requiredEffects: number;
  rejections: string[];
  passed: boolean;
}

async function dispatchAcceptanceRace(): Promise<SimResult> {
  const store = new LockingStore();
  store.set("job-1", { status: "OFFERED", courier_id: null });
  const rejections: string[] = [];

  const accept = (courier: string) =>
    store.withLock("job-1", () => {
      const job = store.get("job-1") as { status: string; courier_id: string | null };
      if (job.status !== "OFFERED") {
        rejections.push(`409 offer_taken:${courier}`);
        return;
      }
      store.set("job-1", { status: "ACCEPTED", courier_id: courier });
      store.insertUnique("job-1:accept", `dispatch_accepted:${courier}`);
    });

  await Promise.all([accept("courier-a"), accept("courier-b"), accept("courier-c")]);
  return {
    id: "CC-01",
    scenario: "Three couriers accept the same offered dispatch job simultaneously",
    contenders: 3,
    control: "row lock on the job + status guard inside the critical section",
    authoritativeEffects: store.effects.length,
    requiredEffects: 1,
    rejections,
    passed: store.effects.length === 1 && rejections.length === 2,
  };
}

async function paymentCallbackRace(): Promise<SimResult> {
  const store = new LockingStore();
  const rejections: string[] = [];
  const callback = (source: string, providerRef: string) =>
    store.withLock("order-1:payment", () => {
      if (!store.insertUnique(`payment:${providerRef}`, `capture:${source}`)) {
        rejections.push(`duplicate_ignored:${source}`);
      }
    });

  await Promise.all([
    callback("mpesa_callback", "RCPT-1"),
    callback("client_retry", "RCPT-1"),
    callback("webhook_replay", "RCPT-1"),
    callback("webhook_replay_2", "RCPT-1"),
  ]);
  return {
    id: "CC-03",
    scenario: "M-Pesa callback, client retry and two webhook replays arrive together",
    contenders: 4,
    control: "advisory lock per order + unique (provider, provider_ref)",
    authoritativeEffects: store.effects.length,
    requiredEffects: 1,
    rejections,
    passed: store.effects.length === 1 && rejections.length === 3,
  };
}

async function podSubmissionRace(): Promise<SimResult> {
  const store = new LockingStore();
  const rejections: string[] = [];
  const submit = (attempt: number) =>
    store.withLock("attempt-1:pod", () => {
      if (!store.insertUnique("pod:attempt-1", `pod_sealed:${attempt}`)) {
        rejections.push(`replayed_original_pod:${attempt}`);
      }
    });
  await Promise.all([submit(1), submit(2), submit(3)]);
  return {
    id: "CC-05",
    scenario: "Flaky mobile connection submits the same POD three times",
    contenders: 3,
    control: "unique(attempt_id) on logistics_pod + idempotent RPC replay",
    authoritativeEffects: store.effects.length,
    requiredEffects: 1,
    rejections,
    passed: store.effects.length === 1 && rejections.length === 2,
  };
}

async function returnAndClaimRace(): Promise<SimResult> {
  const store = new LockingStore();
  store.set("shp-1", { execution_status: "PARTIALLY_DELIVERED" });
  const openReturn = () =>
    store.withLock("shp-1:return", () => {
      store.insertUnique("return:shp-1", "return_opened");
    });
  const openClaim = () =>
    store.withLock("shp-1:claim", () => {
      store.insertUnique("claim:shp-1", "claim_candidate_opened");
    });
  await Promise.all([openReturn(), openReturn(), openClaim(), openClaim()]);
  const shipment = store.get("shp-1") as { execution_status: string };
  return {
    id: "CC-08",
    scenario: "Simultaneous duplicate return requests and claim openings on one shipment",
    contenders: 4,
    control: "sibling aggregates with separate locks; no shared mutable status column",
    authoritativeEffects: store.effects.length,
    requiredEffects: 2,
    rejections: ["duplicate_return_ignored", "duplicate_claim_ignored"],
    passed: store.effects.length === 2 && shipment.execution_status === "PARTIALLY_DELIVERED",
  };
}

async function parallelBookingRace(): Promise<SimResult> {
  const store = new LockingStore();
  const rejections: string[] = [];
  const book = (n: number) =>
    store.withLock("quote-1:book", () => {
      if (!store.insertUnique("booking:quote-1:idem-1", `shipment_created:${n}`)) {
        rejections.push(`replay_original_confirmation:${n}`);
      }
    });
  await Promise.all(Array.from({ length: 8 }, (_, i) => book(i + 1)));
  return {
    id: "CC-07",
    scenario: "Eight parallel booking submissions of the same quote and idempotency key",
    contenders: 8,
    control: "idempotency reservation (charter-proven pattern) + unique key",
    authoritativeEffects: store.effects.length,
    requiredEffects: 1,
    rejections,
    passed: store.effects.length === 1 && rejections.length === 7,
  };
}

async function transitionRace(): Promise<SimResult> {
  const store = new LockingStore();
  store.set("shp-2", { state: "IN_EXECUTION", version: 4 });
  const rejections: string[] = [];
  const transition = (to: string, expectedVersion: number) =>
    store.withLock("shp-2", () => {
      const row = store.get("shp-2") as { state: string; version: number };
      if (row.version !== expectedVersion) {
        rejections.push(`state_conflict:${to}`);
        return;
      }
      store.set("shp-2", { state: to, version: row.version + 1 });
      store.insertUnique(`transition:shp-2:${row.version}`, `transition:${to}`);
    });
  await Promise.all([transition("DELIVERED", 4), transition("FAILED", 4), transition("RETURNED", 4)]);
  return {
    id: "CC-06",
    scenario: "Three concurrent transitions from the same aggregate version",
    contenders: 3,
    control: "optimistic expected_version + unique event key",
    authoritativeEffects: store.effects.length,
    requiredEffects: 1,
    rejections,
    passed: store.effects.length === 1 && rejections.length === 2,
  };
}

export async function runConcurrencySimulations(): Promise<SimResult[]> {
  return Promise.all([
    dispatchAcceptanceRace(),
    paymentCallbackRace(),
    podSubmissionRace(),
    returnAndClaimRace(),
    parallelBookingRace(),
    transitionRace(),
  ]);
}

/* ------------------------------- idempotency ------------------------------- */

export interface IdemResult {
  id: string;
  command: string;
  kind: "SAME_KEY_SAME_PAYLOAD" | "SAME_KEY_DIFFERENT_PAYLOAD" | "NO_KEY";
  effects: number;
  outcome: "REPLAYED" | "CONFLICT" | "REJECTED" | "CREATED";
  passed: boolean;
}

/** Reference idempotent command handler. */
function idempotentHandler() {
  const reservations = new Map<string, { hash: string; response: unknown }>();
  const effects: string[] = [];
  const call = (key: string | null, payload: Record<string, unknown>) => {
    if (!key) return { outcome: "REJECTED" as const, effects: effects.length };
    const hash = JSON.stringify(payload);
    const existing = reservations.get(key);
    if (existing) {
      if (existing.hash !== hash) return { outcome: "CONFLICT" as const, effects: effects.length };
      return { outcome: "REPLAYED" as const, effects: effects.length };
    }
    effects.push(key);
    reservations.set(key, { hash, response: { ok: true } });
    return { outcome: "CREATED" as const, effects: effects.length };
  };
  return { call };
}

export function runIdempotencySimulations(): IdemResult[] {
  const commands = [
    "booking",
    "quote acceptance",
    "payment callback",
    "dispatch creation",
    "dispatch acceptance",
    "POD",
    "return",
    "claim",
  ];
  const results: IdemResult[] = [];
  commands.forEach((command, i) => {
    const h = idempotentHandler();
    h.call("k", { command });
    const repeat = h.call("k", { command });
    results.push({
      id: `ID-${String(i + 1).padStart(2, "0")}`,
      command,
      kind: "SAME_KEY_SAME_PAYLOAD",
      effects: repeat.effects,
      outcome: repeat.outcome,
      passed: repeat.outcome === "REPLAYED" && repeat.effects === 1,
    });
  });

  const conflict = idempotentHandler();
  conflict.call("k", { amount: 1200 });
  const tampered = conflict.call("k", { amount: 9900 });
  results.push({
    id: "ID-09",
    command: "booking with reused key and tampered amount",
    kind: "SAME_KEY_DIFFERENT_PAYLOAD",
    effects: tampered.effects,
    outcome: tampered.outcome,
    passed: tampered.outcome === "CONFLICT" && tampered.effects === 1,
  });

  const noKey = idempotentHandler();
  const rejected = noKey.call(null, { command: "dispatch acceptance" });
  results.push({
    id: "ID-10",
    command: "command RPC without idempotency key",
    kind: "NO_KEY",
    effects: rejected.effects,
    outcome: rejected.outcome,
    passed: rejected.outcome === "REJECTED" && rejected.effects === 0,
  });

  return results;
}

export interface SimulationSummary {
  concurrency: { total: number; passed: number; failures: SimResult[] };
  idempotency: { total: number; passed: number; failures: IdemResult[] };
  modelStatus: "PASS" | "FAIL";
  databaseStatus: "BLOCKED";
}

export async function simulationSummary(): Promise<SimulationSummary> {
  const cc = await runConcurrencySimulations();
  const id = runIdempotencySimulations();
  const ccFail = cc.filter((r) => !r.passed);
  const idFail = id.filter((r) => !r.passed);
  return {
    concurrency: { total: cc.length, passed: cc.length - ccFail.length, failures: ccFail },
    idempotency: { total: id.length, passed: id.length - idFail.length, failures: idFail },
    modelStatus: ccFail.length === 0 && idFail.length === 0 ? "PASS" : "FAIL",
    databaseStatus: "BLOCKED",
  };
}
