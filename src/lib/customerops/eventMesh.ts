/**
 * Enterprise Event Mesh — resilient real-time synchronisation fabric.
 *
 * Replaces polling across the Customer Operations / Mission Control surfaces.
 * The mesh is transport-agnostic: production passes a Supabase Realtime
 * transport, tests pass an in-memory one. It provides:
 *  - multi-topic fan-out with a single connection lifecycle
 *  - optimistic local mutations with confirm / rollback
 *  - exponential-backoff reconnection with deterministic schedule
 *  - offline outbox that drains on reconnect (no lost operator action)
 *  - sequence-based event replay so a reconnecting client catches up
 */

export type MeshStatus = "idle" | "connecting" | "live" | "degraded" | "replaying" | "offline";

export interface MeshEvent<T = unknown> {
  /** Monotonic sequence assigned by the publisher/server. */
  seq: number;
  topic: string;
  type: string;
  at: string;
  correlationId?: string;
  payload: T;
}

export interface MeshTransport {
  /** Opens the connection. Resolves once subscribed, rejects on failure. */
  connect(topics: string[], onEvent: (e: MeshEvent) => void, onDrop: (reason: string) => void): Promise<void>;
  /** Sends an event upstream. Rejects when offline. */
  send(event: MeshEvent): Promise<void>;
  /** Returns events with seq > afterSeq for replay. */
  replay(topics: string[], afterSeq: number): Promise<MeshEvent[]>;
  close(): void;
}

export interface MeshOptions {
  transport: MeshTransport;
  /** Base reconnect delay in ms (doubles per attempt, capped). */
  baseBackoffMs?: number;
  maxBackoffMs?: number;
  maxReconnectAttempts?: number;
  /** Retained events used for local replay / audit. */
  bufferSize?: number;
  now?: () => number;
}

export interface OptimisticMutation<T = unknown> {
  id: string;
  topic: string;
  type: string;
  payload: T;
  /** Value replaced locally, restored on rollback. */
  previous?: T;
  state: "pending" | "confirmed" | "rolled_back";
}

export interface MeshStats {
  status: MeshStatus;
  received: number;
  published: number;
  replayed: number;
  reconnectAttempts: number;
  queued: number;
  pendingOptimistic: number;
  lastSeq: number;
  lastError: string | null;
  lastEventAt: string | null;
}

/** Deterministic backoff schedule — no jitter so it is assertable in tests. */
export function backoffFor(attempt: number, base = 500, max = 30_000): number {
  return Math.min(max, base * 2 ** Math.max(0, attempt - 1));
}

export class EnterpriseEventMesh {
  private readonly opts: Required<Omit<MeshOptions, "transport" | "now">> & { transport: MeshTransport; now: () => number };
  private handlers = new Map<string, Set<(e: MeshEvent) => void>>();
  private buffer: MeshEvent[] = [];
  private outbox: MeshEvent[] = [];
  private optimistic = new Map<string, OptimisticMutation>();
  private statusValue: MeshStatus = "idle";
  private stats: MeshStats = {
    status: "idle", received: 0, published: 0, replayed: 0, reconnectAttempts: 0,
    queued: 0, pendingOptimistic: 0, lastSeq: 0, lastError: null, lastEventAt: null,
  };
  private statusListeners = new Set<(s: MeshStatus, stats: MeshStats) => void>();

  constructor(options: MeshOptions) {
    this.opts = {
      transport: options.transport,
      baseBackoffMs: options.baseBackoffMs ?? 500,
      maxBackoffMs: options.maxBackoffMs ?? 30_000,
      maxReconnectAttempts: options.maxReconnectAttempts ?? 8,
      bufferSize: options.bufferSize ?? 500,
      now: options.now ?? (() => Date.now()),
    };
  }

  get status(): MeshStatus { return this.statusValue; }

  snapshot(): MeshStats {
    return { ...this.stats, status: this.statusValue, queued: this.outbox.length, pendingOptimistic: this.pendingCount() };
  }

  onStatus(listener: (s: MeshStatus, stats: MeshStats) => void): () => void {
    this.statusListeners.add(listener);
    return () => this.statusListeners.delete(listener);
  }

  subscribe(topic: string, handler: (e: MeshEvent) => void): () => void {
    const set = this.handlers.get(topic) ?? new Set();
    set.add(handler);
    this.handlers.set(topic, set);
    return () => { set.delete(handler); };
  }

  topics(): string[] { return Array.from(this.handlers.keys()); }

  async connect(): Promise<MeshStatus> {
    this.setStatus("connecting");
    try {
      await this.opts.transport.connect(this.topics(), (e) => this.ingest(e), (reason) => void this.handleDrop(reason));
      this.setStatus("live");
      this.stats.lastError = null;
      await this.drainOutbox();
      return this.statusValue;
    } catch (error) {
      this.stats.lastError = error instanceof Error ? error.message : String(error);
      this.setStatus("offline");
      return this.statusValue;
    }
  }

  /** Handles an upstream drop: degrade, reconnect with backoff, then replay. */
  async handleDrop(reason: string): Promise<MeshStatus> {
    this.stats.lastError = reason;
    this.setStatus("degraded");
    for (let attempt = 1; attempt <= this.opts.maxReconnectAttempts; attempt++) {
      this.stats.reconnectAttempts = attempt;
      this.nextRetryMs = backoffFor(attempt, this.opts.baseBackoffMs, this.opts.maxBackoffMs);
      try {
        await this.opts.transport.connect(this.topics(), (e) => this.ingest(e), (r) => void this.handleDrop(r));
        await this.replay();
        this.setStatus("live");
        await this.drainOutbox();
        return this.statusValue;
      } catch (error) {
        this.stats.lastError = error instanceof Error ? error.message : String(error);
      }
    }
    this.setStatus("offline");
    return this.statusValue;
  }

  /** Milliseconds the mesh would wait before the next reconnect attempt. */
  nextRetryMs = 0;

  /** Catches the client up on everything missed while disconnected. */
  async replay(): Promise<number> {
    this.setStatus("replaying");
    const missed = await this.opts.transport.replay(this.topics(), this.stats.lastSeq);
    for (const e of missed) this.ingest(e, true);
    this.stats.replayed += missed.length;
    return missed.length;
  }

  /** Publishes an event; queues it in the offline outbox when unavailable. */
  async publish(event: Omit<MeshEvent, "seq" | "at"> & { seq?: number; at?: string }): Promise<{ delivered: boolean; queued: boolean }> {
    const full: MeshEvent = {
      seq: event.seq ?? this.stats.lastSeq + 1,
      at: event.at ?? new Date(this.opts.now()).toISOString(),
      topic: event.topic, type: event.type, correlationId: event.correlationId, payload: event.payload,
    };
    if (this.statusValue !== "live") {
      this.outbox.push(full);
      this.stats.queued = this.outbox.length;
      this.emitStatus();
      return { delivered: false, queued: true };
    }
    try {
      await this.opts.transport.send(full);
      this.stats.published += 1;
      return { delivered: true, queued: false };
    } catch (error) {
      this.stats.lastError = error instanceof Error ? error.message : String(error);
      this.outbox.push(full);
      this.setStatus("degraded");
      return { delivered: false, queued: true };
    }
  }

  async drainOutbox(): Promise<number> {
    if (this.statusValue !== "live") return 0;
    let sent = 0;
    while (this.outbox.length) {
      const next = this.outbox[0];
      try {
        await this.opts.transport.send(next);
        this.outbox.shift();
        this.stats.published += 1;
        sent += 1;
      } catch (error) {
        this.stats.lastError = error instanceof Error ? error.message : String(error);
        this.setStatus("degraded");
        break;
      }
    }
    this.stats.queued = this.outbox.length;
    this.emitStatus();
    return sent;
  }

  /* --------------------------- optimistic updates -------------------------- */

  applyOptimistic<T>(m: Omit<OptimisticMutation<T>, "state">): OptimisticMutation<T> {
    const entry: OptimisticMutation<T> = { ...m, state: "pending" };
    this.optimistic.set(m.id, entry as OptimisticMutation);
    this.emitStatus();
    return entry;
  }

  confirmOptimistic(id: string): boolean {
    const m = this.optimistic.get(id);
    if (!m || m.state !== "pending") return false;
    m.state = "confirmed";
    this.emitStatus();
    return true;
  }

  /** Rolls a pending mutation back and returns the value to restore. */
  rollbackOptimistic(id: string): unknown | undefined {
    const m = this.optimistic.get(id);
    if (!m || m.state !== "pending") return undefined;
    m.state = "rolled_back";
    this.emitStatus();
    return m.previous;
  }

  pendingCount(): number {
    return Array.from(this.optimistic.values()).filter((m) => m.state === "pending").length;
  }

  recent(topic?: string, limit = 50): MeshEvent[] {
    const list = topic ? this.buffer.filter((e) => e.topic === topic) : this.buffer;
    return list.slice(-limit).reverse();
  }

  close(): void {
    this.opts.transport.close();
    this.setStatus("offline");
  }

  /* -------------------------------- internals ------------------------------ */

  private ingest(e: MeshEvent, isReplay = false): void {
    if (e.seq <= this.stats.lastSeq && !isReplay) return; // duplicate delivery
    this.stats.lastSeq = Math.max(this.stats.lastSeq, e.seq);
    this.stats.received += 1;
    this.stats.lastEventAt = e.at;
    this.buffer.push(e);
    if (this.buffer.length > this.opts.bufferSize) this.buffer.splice(0, this.buffer.length - this.opts.bufferSize);
    for (const h of this.handlers.get(e.topic) ?? []) h(e);
  }

  private setStatus(s: MeshStatus): void {
    this.statusValue = s;
    this.stats.status = s;
    this.emitStatus();
  }

  private emitStatus(): void {
    const snap = this.snapshot();
    for (const l of this.statusListeners) l(this.statusValue, snap);
  }
}

/** In-memory transport used by tests, previews and offline demos. */
export function createMemoryTransport(seed: MeshEvent[] = []) {
  let log = [...seed];
  let online = true;
  let sink: ((e: MeshEvent) => void) | null = null;
  let drop: ((reason: string) => void) | null = null;

  return {
    transport: {
      async connect(_topics: string[], onEvent: (e: MeshEvent) => void, onDrop: (reason: string) => void) {
        if (!online) throw new Error("transport offline");
        sink = onEvent; drop = onDrop;
      },
      async send(event: MeshEvent) {
        if (!online) throw new Error("transport offline");
        log.push(event);
        sink?.(event);
      },
      async replay(topics: string[], afterSeq: number) {
        return log.filter((e) => e.seq > afterSeq && (topics.length === 0 || topics.includes(e.topic)));
      },
      close() { sink = null; drop = null; },
    } satisfies MeshTransport,
    /** Simulates an upstream event arriving; only delivered while online. */
    emit(event: MeshEvent) { log.push(event); if (online) sink?.(event); },
    /**
     * Simulates loss of connectivity. Pass `notify` to also fire the transport
     * drop callback (which triggers the mesh reconnect loop).
     */
    goOffline(reason = "connection lost", notify = false) { online = false; if (notify) drop?.(reason); },
    goOnline() { online = true; },
    log: () => log,
    reset() { log = [...seed]; online = true; },
  };
}
