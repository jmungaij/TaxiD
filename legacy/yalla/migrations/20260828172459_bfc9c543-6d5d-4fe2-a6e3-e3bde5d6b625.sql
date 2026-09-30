-- =============================================================================
-- PHASE 8 — OFFLINE DRIVER EXECUTION + MOBILE SYNCHRONISATION
-- Extends the existing logistics spine. No new event bus, no new domain model:
-- every accepted command is applied through the EXISTING authoritative RPCs,
-- which already emit canonical events via logistics_event_emit.
-- =============================================================================

-- ------------------------------------------------------------------ enums
DO $$ BEGIN
  CREATE TYPE public.offline_command_state AS ENUM (
    'QUEUED','SYNCING','ACCEPTED','REJECTED','CONFLICT',
    'RETRYABLE_FAILURE','PERMANENT_FAILURE','REPLAYED','ACKNOWLEDGED'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.offline_device_state AS ENUM ('ACTIVE','STALE','SUSPENDED','RETIRED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.sync_session_state AS ENUM ('OPEN','COMPLETED','ABANDONED','FAILED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ------------------------------------------------------------------ devices
CREATE TABLE IF NOT EXISTS public.logistics_devices (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  device_id       text NOT NULL,
  tenant_id       uuid,
  owner_user_id   uuid NOT NULL,
  platform        text NOT NULL DEFAULT 'unknown',
  app_version     text NOT NULL DEFAULT 'unknown',
  os_version      text,
  model           text,
  push_token      text,
  state           public.offline_device_state NOT NULL DEFAULT 'ACTIVE',
  state_reason    text,
  sync_cursor     bigint NOT NULL DEFAULT 0,
  last_seen_at    timestamptz,
  last_sync_at    timestamptz,
  last_clock_skew_ms integer,
  queued_count    integer NOT NULL DEFAULT 0,
  failed_count    integer NOT NULL DEFAULT 0,
  conflict_count  integer NOT NULL DEFAULT 0,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT logistics_devices_unique UNIQUE (device_id, owner_user_id)
);
CREATE INDEX IF NOT EXISTS logistics_devices_owner_idx ON public.logistics_devices(owner_user_id);
CREATE INDEX IF NOT EXISTS logistics_devices_state_idx ON public.logistics_devices(state, last_seen_at DESC);

GRANT SELECT, INSERT, UPDATE ON public.logistics_devices TO authenticated;
GRANT ALL ON public.logistics_devices TO service_role;
ALTER TABLE public.logistics_devices ENABLE ROW LEVEL SECURITY;

-- ------------------------------------------------- offline command journal
CREATE TABLE IF NOT EXISTS public.logistics_offline_commands (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  command_id        text NOT NULL,             -- client-generated stable id
  idempotency_key   text NOT NULL,             -- client-generated idempotency key
  device_row_id     uuid NOT NULL REFERENCES public.logistics_devices(id) ON DELETE CASCADE,
  device_id         text NOT NULL,
  tenant_id         uuid,
  actor_id          uuid NOT NULL,
  app_version       text NOT NULL DEFAULT 'unknown',
  operation         text NOT NULL,             -- e.g. delivery.attempt
  entity_type       text NOT NULL,
  entity_id         uuid,
  entity_version    integer,
  sequence_number   bigint NOT NULL,
  payload           jsonb NOT NULL DEFAULT '{}'::jsonb,
  payload_hash      text NOT NULL,
  gps_lat           numeric,
  gps_lng           numeric,
  gps_accuracy_m    numeric,
  client_captured_at timestamptz NOT NULL,
  client_clock_skew_ms integer,
  server_received_at timestamptz,
  server_applied_at  timestamptz,
  state             public.offline_command_state NOT NULL DEFAULT 'QUEUED',
  attempts          integer NOT NULL DEFAULT 0,
  next_attempt_at   timestamptz,
  transaction_id    uuid,                      -- server-issued transaction identity
  server_result     jsonb,
  error_code        text,
  error_category    text,
  error_message     text,
  retryable         boolean,
  conflict_reason   text,
  conflict_detail   jsonb,
  resolution        text,
  resolved_by       uuid,
  resolved_at       timestamptz,
  resolution_notes  text,
  acknowledged_at   timestamptz,
  correlation_id    text NOT NULL,
  causation_id      text,
  request_id        text,
  sync_session_id   uuid,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT offline_commands_command_unique UNIQUE (device_id, command_id),
  CONSTRAINT offline_commands_idem_unique UNIQUE (actor_id, idempotency_key),
  CONSTRAINT offline_commands_seq_unique UNIQUE (device_row_id, sequence_number)
);
CREATE INDEX IF NOT EXISTS offline_commands_state_idx ON public.logistics_offline_commands(state, created_at);
CREATE INDEX IF NOT EXISTS offline_commands_actor_idx ON public.logistics_offline_commands(actor_id, created_at DESC);
CREATE INDEX IF NOT EXISTS offline_commands_device_idx ON public.logistics_offline_commands(device_row_id, sequence_number);
CREATE INDEX IF NOT EXISTS offline_commands_entity_idx ON public.logistics_offline_commands(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS offline_commands_due_idx
  ON public.logistics_offline_commands(next_attempt_at)
  WHERE state IN ('QUEUED','RETRYABLE_FAILURE');

GRANT SELECT, INSERT ON public.logistics_offline_commands TO authenticated;
GRANT ALL ON public.logistics_offline_commands TO service_role;
ALTER TABLE public.logistics_offline_commands ENABLE ROW LEVEL SECURITY;

-- --------------------------------------------- append-only command history
CREATE TABLE IF NOT EXISTS public.logistics_offline_command_events (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  command_row_id uuid NOT NULL REFERENCES public.logistics_offline_commands(id) ON DELETE CASCADE,
  from_state   public.offline_command_state,
  to_state     public.offline_command_state NOT NULL,
  reason       text,
  detail       jsonb NOT NULL DEFAULT '{}'::jsonb,
  actor_id     uuid,
  actor_type   text NOT NULL DEFAULT 'system',
  correlation_id text,
  occurred_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS offline_command_events_cmd_idx
  ON public.logistics_offline_command_events(command_row_id, occurred_at);

GRANT SELECT ON public.logistics_offline_command_events TO authenticated;
GRANT ALL ON public.logistics_offline_command_events TO service_role;
ALTER TABLE public.logistics_offline_command_events ENABLE ROW LEVEL SECURITY;

-- ------------------------------------------------------- sync sessions
CREATE TABLE IF NOT EXISTS public.logistics_sync_sessions (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  device_row_id     uuid NOT NULL REFERENCES public.logistics_devices(id) ON DELETE CASCADE,
  actor_id          uuid NOT NULL,
  direction         text NOT NULL DEFAULT 'push',
  state             public.sync_session_state NOT NULL DEFAULT 'OPEN',
  cursor_before     bigint NOT NULL DEFAULT 0,
  cursor_after      bigint,
  commands_submitted integer NOT NULL DEFAULT 0,
  commands_accepted  integer NOT NULL DEFAULT 0,
  commands_rejected  integer NOT NULL DEFAULT 0,
  commands_conflict  integer NOT NULL DEFAULT 0,
  commands_deferred  integer NOT NULL DEFAULT 0,
  duplicates_suppressed integer NOT NULL DEFAULT 0,
  clock_skew_ms     integer,
  connectivity      text,
  app_version       text,
  correlation_id    text NOT NULL,
  request_id        text,
  error_code        text,
  started_at        timestamptz NOT NULL DEFAULT now(),
  finished_at       timestamptz
);
CREATE INDEX IF NOT EXISTS sync_sessions_device_idx ON public.logistics_sync_sessions(device_row_id, started_at DESC);

GRANT SELECT ON public.logistics_sync_sessions TO authenticated;
GRANT ALL ON public.logistics_sync_sessions TO service_role;
ALTER TABLE public.logistics_sync_sessions ENABLE ROW LEVEL SECURITY;

-- ------------------------------------------------------- evidence queue
CREATE TABLE IF NOT EXISTS public.logistics_offline_attachments (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  command_row_id uuid REFERENCES public.logistics_offline_commands(id) ON DELETE CASCADE,
  device_id      text NOT NULL,
  actor_id       uuid NOT NULL,
  attachment_key text NOT NULL,
  kind           text NOT NULL,               -- photo | signature | audio | document
  content_type   text,
  byte_size      integer,
  sha256         text,
  storage_path   text,
  state          text NOT NULL DEFAULT 'QUEUED',  -- QUEUED|UPLOADED|FAILED|ORPHANED
  attempts       integer NOT NULL DEFAULT 0,
  error_code     text,
  captured_at    timestamptz NOT NULL,
  uploaded_at    timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT offline_attachments_key_unique UNIQUE (device_id, attachment_key)
);
CREATE INDEX IF NOT EXISTS offline_attachments_state_idx ON public.logistics_offline_attachments(state, created_at);

GRANT SELECT, INSERT ON public.logistics_offline_attachments TO authenticated;
GRANT ALL ON public.logistics_offline_attachments TO service_role;
ALTER TABLE public.logistics_offline_attachments ENABLE ROW LEVEL SECURITY;

-- ------------------------------------------------------------------ guards
CREATE OR REPLACE FUNCTION public._offline_touch()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at := now(); RETURN NEW; END $$;

DROP TRIGGER IF EXISTS trg_offline_devices_touch ON public.logistics_devices;
CREATE TRIGGER trg_offline_devices_touch BEFORE UPDATE ON public.logistics_devices
FOR EACH ROW EXECUTE FUNCTION public._offline_touch();

DROP TRIGGER IF EXISTS trg_offline_commands_touch ON public.logistics_offline_commands;
CREATE TRIGGER trg_offline_commands_touch BEFORE UPDATE ON public.logistics_offline_commands
FOR EACH ROW EXECUTE FUNCTION public._offline_touch();

-- history is append-only
CREATE OR REPLACE FUNCTION public._offline_events_append_only()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  RAISE EXCEPTION 'logistics_offline_command_events is append-only';
END $$;

DROP TRIGGER IF EXISTS trg_offline_events_append_only ON public.logistics_offline_command_events;
CREATE TRIGGER trg_offline_events_append_only
BEFORE UPDATE OR DELETE ON public.logistics_offline_command_events
FOR EACH ROW EXECUTE FUNCTION public._offline_events_append_only();

-- the client may only ever insert a QUEUED command, and only for itself;
-- server-authoritative columns are stripped on insert.
CREATE OR REPLACE FUNCTION public._offline_command_insert_guard()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NOT NULL AND NEW.actor_id <> auth.uid() THEN
    RAISE EXCEPTION 'offline command actor must be the signed-in user';
  END IF;
  NEW.state             := 'QUEUED';
  NEW.attempts          := 0;
  NEW.transaction_id    := NULL;
  NEW.server_result     := NULL;
  NEW.server_applied_at := NULL;
  NEW.acknowledged_at   := NULL;
  NEW.resolution        := NULL;
  NEW.resolved_by       := NULL;
  NEW.resolved_at       := NULL;
  NEW.server_received_at := now();          -- server timestamp authority
  NEW.correlation_id    := COALESCE(NULLIF(NEW.correlation_id,''), gen_random_uuid()::text);
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_offline_command_insert_guard ON public.logistics_offline_commands;
CREATE TRIGGER trg_offline_command_insert_guard
BEFORE INSERT ON public.logistics_offline_commands
FOR EACH ROW EXECUTE FUNCTION public._offline_command_insert_guard();

-- every state change is journalled
CREATE OR REPLACE FUNCTION public._offline_command_state_history()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF TG_OP = 'INSERT' OR NEW.state IS DISTINCT FROM OLD.state THEN
    INSERT INTO public.logistics_offline_command_events(
      command_row_id, from_state, to_state, reason, detail, actor_id, actor_type, correlation_id)
    VALUES (
      NEW.id,
      CASE WHEN TG_OP='INSERT' THEN NULL ELSE OLD.state END,
      NEW.state,
      COALESCE(NEW.error_code, NEW.conflict_reason, NEW.resolution),
      jsonb_strip_nulls(jsonb_build_object(
        'operation', NEW.operation,
        'attempts', NEW.attempts,
        'error_category', NEW.error_category,
        'retryable', NEW.retryable,
        'transaction_id', NEW.transaction_id)),
      COALESCE(NEW.resolved_by, NEW.actor_id),
      CASE WHEN NEW.resolved_by IS NOT NULL THEN 'operator' ELSE 'device' END,
      NEW.correlation_id);
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_offline_command_history ON public.logistics_offline_commands;
CREATE TRIGGER trg_offline_command_history
AFTER INSERT OR UPDATE ON public.logistics_offline_commands
FOR EACH ROW EXECUTE FUNCTION public._offline_command_state_history();

-- device counters stay in step with the journal
CREATE OR REPLACE FUNCTION public._offline_device_counters()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  UPDATE public.logistics_devices d SET
    queued_count = (SELECT count(*) FROM public.logistics_offline_commands c
                    WHERE c.device_row_id = d.id AND c.state IN ('QUEUED','SYNCING','RETRYABLE_FAILURE')),
    failed_count = (SELECT count(*) FROM public.logistics_offline_commands c
                    WHERE c.device_row_id = d.id AND c.state IN ('PERMANENT_FAILURE','REJECTED')),
    conflict_count = (SELECT count(*) FROM public.logistics_offline_commands c
                    WHERE c.device_row_id = d.id AND c.state = 'CONFLICT'),
    last_seen_at = GREATEST(COALESCE(d.last_seen_at, to_timestamp(0)), now())
  WHERE d.id = COALESCE(NEW.device_row_id, OLD.device_row_id);
  RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS trg_offline_device_counters ON public.logistics_offline_commands;
CREATE TRIGGER trg_offline_device_counters
AFTER INSERT OR UPDATE OF state ON public.logistics_offline_commands
FOR EACH ROW EXECUTE FUNCTION public._offline_device_counters();

-- ------------------------------------------------------------------ RLS
-- Drivers see only their own devices; delivery operations staff see all.
DROP POLICY IF EXISTS logistics_devices_self_read ON public.logistics_devices;
CREATE POLICY logistics_devices_self_read ON public.logistics_devices
FOR SELECT TO authenticated
USING (owner_user_id = auth.uid() OR public.has_staff_permission('staff.delivery.read'));

DROP POLICY IF EXISTS logistics_devices_self_register ON public.logistics_devices;
CREATE POLICY logistics_devices_self_register ON public.logistics_devices
FOR INSERT TO authenticated
WITH CHECK (owner_user_id = auth.uid());

DROP POLICY IF EXISTS logistics_devices_self_update ON public.logistics_devices;
CREATE POLICY logistics_devices_self_update ON public.logistics_devices
FOR UPDATE TO authenticated
USING (owner_user_id = auth.uid())
WITH CHECK (owner_user_id = auth.uid());

DROP POLICY IF EXISTS offline_commands_self_read ON public.logistics_offline_commands;
CREATE POLICY offline_commands_self_read ON public.logistics_offline_commands
FOR SELECT TO authenticated
USING (actor_id = auth.uid() OR public.has_staff_permission('staff.delivery.read'));

DROP POLICY IF EXISTS offline_commands_self_enqueue ON public.logistics_offline_commands;
CREATE POLICY offline_commands_self_enqueue ON public.logistics_offline_commands
FOR INSERT TO authenticated
WITH CHECK (
  actor_id = auth.uid()
  AND EXISTS (SELECT 1 FROM public.logistics_devices d
              WHERE d.id = device_row_id AND d.owner_user_id = auth.uid()
                AND d.state = 'ACTIVE')
);

DROP POLICY IF EXISTS offline_command_events_read ON public.logistics_offline_command_events;
CREATE POLICY offline_command_events_read ON public.logistics_offline_command_events
FOR SELECT TO authenticated
USING (
  EXISTS (SELECT 1 FROM public.logistics_offline_commands c
          WHERE c.id = command_row_id
            AND (c.actor_id = auth.uid() OR public.has_staff_permission('staff.delivery.read')))
);

DROP POLICY IF EXISTS sync_sessions_read ON public.logistics_sync_sessions;
CREATE POLICY sync_sessions_read ON public.logistics_sync_sessions
FOR SELECT TO authenticated
USING (actor_id = auth.uid() OR public.has_staff_permission('staff.delivery.read'));

DROP POLICY IF EXISTS offline_attachments_self ON public.logistics_offline_attachments;
CREATE POLICY offline_attachments_self ON public.logistics_offline_attachments
FOR SELECT TO authenticated
USING (actor_id = auth.uid() OR public.has_staff_permission('staff.delivery.read'));

DROP POLICY IF EXISTS offline_attachments_self_insert ON public.logistics_offline_attachments;
CREATE POLICY offline_attachments_self_insert ON public.logistics_offline_attachments
FOR INSERT TO authenticated
WITH CHECK (actor_id = auth.uid());
