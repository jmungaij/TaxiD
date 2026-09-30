
CREATE TABLE public.commercial_rate_card_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rate_card_id uuid NOT NULL REFERENCES public.commercial_rate_cards(id) ON DELETE CASCADE,
  event text NOT NULL,
  status_before text,
  status_after text,
  note text,
  sole_approver boolean NOT NULL DEFAULT false,
  actor_user_id uuid,
  actor_staff_id uuid REFERENCES public.staff_members(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_crce_card ON public.commercial_rate_card_events(rate_card_id, created_at DESC);

GRANT SELECT ON public.commercial_rate_card_events TO authenticated;
GRANT ALL ON public.commercial_rate_card_events TO service_role;
ALTER TABLE public.commercial_rate_card_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "rate card history readable by commercial staff" ON public.commercial_rate_card_events
FOR SELECT TO authenticated
USING (public.is_platform_admin() OR public.has_staff_permission('staff.commercial.read'));

CREATE OR REPLACE FUNCTION public._rate_card_events_append_only()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path TO 'public' AS $$
BEGIN RAISE EXCEPTION 'RATE_CARD_HISTORY_IS_PERMANENT'; END $$;
REVOKE ALL ON FUNCTION public._rate_card_events_append_only() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER trg_crce_append_only BEFORE UPDATE OR DELETE ON public.commercial_rate_card_events
FOR EACH ROW EXECUTE FUNCTION public._rate_card_events_append_only();

-- ---------- helpers ----------
CREATE OR REPLACE FUNCTION public._rate_card_can_read()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT public.is_platform_admin() OR public.has_staff_permission('staff.commercial.read');
$$;
CREATE OR REPLACE FUNCTION public._rate_card_can_write()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT public.is_platform_admin() OR public.has_staff_permission('staff.commercial.write');
$$;
CREATE OR REPLACE FUNCTION public._rate_card_can_approve()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT public.is_platform_admin() OR public.has_staff_permission('staff.commercial.approve');
$$;
REVOKE ALL ON FUNCTION public._rate_card_can_read() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public._rate_card_can_write() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public._rate_card_can_approve() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public._rate_card_can_read() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public._rate_card_can_write() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public._rate_card_can_approve() TO authenticated, service_role;

-- ---------- portal ----------
CREATE OR REPLACE FUNCTION public.rate_card_portal()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v jsonb;
BEGIN
  IF NOT public._rate_card_can_read() THEN RAISE EXCEPTION 'NOT_AUTHORISED'; END IF;

  SELECT jsonb_build_object(
    'generated_at', now(),
    'can_write', public._rate_card_can_write(),
    'can_approve', public._rate_card_can_approve(),
    'kpi', jsonb_build_object(
      'approved_rate_count', (SELECT count(*) FROM public.commercial_rate_lines l
                               JOIN public.commercial_rate_cards c ON c.id = l.rate_card_id
                              WHERE c.status = 'approved'),
      'live_card_count', (SELECT count(*) FROM public.commercial_rate_cards WHERE status = 'approved'),
      'awaiting_approval', (SELECT count(*) FROM public.commercial_rate_cards WHERE status = 'pending_approval'),
      'draft_count', (SELECT count(*) FROM public.commercial_rate_cards WHERE status = 'source'),
      'next_review_at', (SELECT min(review_at) FROM public.commercial_rate_cards WHERE status = 'approved'),
      'review_overdue', (SELECT count(*) FROM public.commercial_rate_cards
                          WHERE status = 'approved' AND review_at IS NOT NULL AND review_at < current_date)
    ),
    'cards', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', c.id, 'code', c.code, 'name', c.name, 'product_domain', c.product_domain,
        'version', c.version, 'status', c.status, 'currency', c.currency,
        'effective_from', c.effective_from, 'review_at', c.review_at,
        'source_note', c.source_note, 'source_reference', c.source_reference,
        'provenance', c.provenance, 'change_reason', c.change_reason,
        'approved_at', c.approved_at, 'retired_at', c.retired_at,
        'owner_name', sm.full_name,
        'created_by', c.created_by,
        'line_count', (SELECT count(*) FROM public.commercial_rate_lines l WHERE l.rate_card_id = c.id),
        'lines', COALESCE((SELECT jsonb_agg(to_jsonb(l) ORDER BY l.category_code, l.service_code)
                             FROM public.commercial_rate_lines l WHERE l.rate_card_id = c.id), '[]'::jsonb),
        'events', COALESCE((SELECT jsonb_agg(jsonb_build_object(
                                'event', e.event, 'status_before', e.status_before, 'status_after', e.status_after,
                                'note', e.note, 'sole_approver', e.sole_approver, 'created_at', e.created_at,
                                'actor_name', am.full_name) ORDER BY e.created_at DESC)
                             FROM public.commercial_rate_card_events e
                             LEFT JOIN public.staff_members am ON am.id = e.actor_staff_id
                            WHERE e.rate_card_id = c.id), '[]'::jsonb)
      ) ORDER BY c.code, c.created_at DESC)
      FROM public.commercial_rate_cards c
      LEFT JOIN public.staff_members sm ON sm.id = c.owner_staff_id
    ), '[]'::jsonb)
  ) INTO v;
  RETURN v;
END $$;
REVOKE ALL ON FUNCTION public.rate_card_portal() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rate_card_portal() TO authenticated, service_role;

-- ---------- new version ----------
CREATE OR REPLACE FUNCTION public.rate_card_version_create(_card_id uuid, _version text, _effective_from date DEFAULT NULL, _reason text DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_src public.commercial_rate_cards; v_new uuid; v_staff uuid := public._my_staff_member_id();
BEGIN
  IF NOT public._rate_card_can_write() THEN RAISE EXCEPTION 'NOT_AUTHORISED'; END IF;
  IF COALESCE(btrim(_version),'') = '' THEN RAISE EXCEPTION 'VERSION_REQUIRED'; END IF;
  SELECT * INTO v_src FROM public.commercial_rate_cards WHERE id = _card_id;
  IF v_src.id IS NULL THEN RAISE EXCEPTION 'RATE_CARD_NOT_FOUND'; END IF;
  IF EXISTS (SELECT 1 FROM public.commercial_rate_cards WHERE code = v_src.code AND version = btrim(_version)) THEN
    RAISE EXCEPTION 'VERSION_ALREADY_EXISTS';
  END IF;

  INSERT INTO public.commercial_rate_cards(
    code, name, product_domain, version, status, currency, effective_from, review_at,
    source_note, source_reference, owner_staff_id, created_by, change_reason, provenance)
  VALUES (v_src.code, v_src.name, v_src.product_domain, btrim(_version), 'source', v_src.currency,
          COALESCE(_effective_from, current_date), v_src.review_at,
          v_src.source_note, v_src.source_reference, COALESCE(v_staff, v_src.owner_staff_id), auth.uid(),
          NULLIF(btrim(COALESCE(_reason,'')),''), v_src.provenance)
  RETURNING id INTO v_new;

  INSERT INTO public.commercial_rate_lines(
    rate_card_id, service_code, scope_label, category_code, pricing_basis, amount, currency,
    included_distance_km, included_distance_period, drive_mode, min_days, inclusion_note, conditions)
  SELECT v_new, service_code, scope_label, category_code, pricing_basis, amount, currency,
         included_distance_km, included_distance_period, drive_mode, min_days, inclusion_note, conditions
  FROM public.commercial_rate_lines WHERE rate_card_id = v_src.id;

  INSERT INTO public.commercial_rate_card_events(rate_card_id, event, status_after, note, actor_user_id, actor_staff_id)
  VALUES (v_new, 'version_created', 'source',
          'Copied from ' || v_src.version || COALESCE(' — ' || NULLIF(btrim(COALESCE(_reason,'')),''), ''),
          auth.uid(), v_staff);
  RETURN v_new;
END $$;
REVOKE ALL ON FUNCTION public.rate_card_version_create(uuid, text, date, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rate_card_version_create(uuid, text, date, text) TO authenticated, service_role;

-- ---------- edit a draft line ----------
CREATE OR REPLACE FUNCTION public.rate_card_line_save(p jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_card public.commercial_rate_cards; v_id uuid := NULLIF(p->>'id','')::uuid;
BEGIN
  IF NOT public._rate_card_can_write() THEN RAISE EXCEPTION 'NOT_AUTHORISED'; END IF;
  SELECT * INTO v_card FROM public.commercial_rate_cards WHERE id = (p->>'rate_card_id')::uuid;
  IF v_card.id IS NULL THEN RAISE EXCEPTION 'RATE_CARD_NOT_FOUND'; END IF;
  IF v_card.status <> 'source' THEN RAISE EXCEPTION 'ONLY_A_DRAFT_VERSION_CAN_BE_EDITED'; END IF;

  IF v_id IS NULL THEN
    INSERT INTO public.commercial_rate_lines(
      rate_card_id, service_code, scope_label, category_code, pricing_basis, amount, currency,
      included_distance_km, included_distance_period, drive_mode, min_days, inclusion_note, conditions)
    VALUES (v_card.id, p->>'service_code', p->>'scope_label', p->>'category_code',
            COALESCE(p->>'pricing_basis','fixed'), (p->>'amount')::numeric, COALESCE(p->>'currency', v_card.currency),
            NULLIF(p->>'included_distance_km','')::int, NULLIF(p->>'included_distance_period',''),
            NULLIF(p->>'drive_mode',''), NULLIF(p->>'min_days','')::int,
            NULLIF(p->>'inclusion_note',''), NULLIF(p->>'conditions',''))
    RETURNING id INTO v_id;
  ELSE
    UPDATE public.commercial_rate_lines SET
      service_code = COALESCE(p->>'service_code', service_code),
      scope_label = COALESCE(p->>'scope_label', scope_label),
      category_code = COALESCE(p->>'category_code', category_code),
      pricing_basis = COALESCE(p->>'pricing_basis', pricing_basis),
      amount = COALESCE((p->>'amount')::numeric, amount),
      inclusion_note = COALESCE(p->>'inclusion_note', inclusion_note),
      conditions = COALESCE(p->>'conditions', conditions)
    WHERE id = v_id AND rate_card_id = v_card.id;
    IF NOT FOUND THEN RAISE EXCEPTION 'RATE_LINE_NOT_FOUND'; END IF;
  END IF;

  INSERT INTO public.commercial_rate_card_events(rate_card_id, event, note, actor_user_id, actor_staff_id)
  VALUES (v_card.id, 'rate_edited',
          COALESCE(p->>'service_code','rate') || ' set to ' || COALESCE(p->>'amount','—'),
          auth.uid(), public._my_staff_member_id());
  RETURN v_id;
END $$;
REVOKE ALL ON FUNCTION public.rate_card_line_save(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rate_card_line_save(jsonb) TO authenticated, service_role;

-- ---------- lifecycle ----------
CREATE OR REPLACE FUNCTION public.rate_card_action(_card_id uuid, _action text, _note text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v public.commercial_rate_cards; v_staff uuid := public._my_staff_member_id();
        v_sole boolean := false; v_next text; v_admin boolean := public.is_platform_admin();
BEGIN
  SELECT * INTO v FROM public.commercial_rate_cards WHERE id = _card_id FOR UPDATE;
  IF v.id IS NULL THEN RAISE EXCEPTION 'RATE_CARD_NOT_FOUND'; END IF;

  IF _action = 'SUBMIT' THEN
    IF NOT public._rate_card_can_write() THEN RAISE EXCEPTION 'NOT_AUTHORISED'; END IF;
    IF v.status <> 'source' THEN RAISE EXCEPTION 'ONLY_A_DRAFT_VERSION_CAN_BE_SUBMITTED'; END IF;
    IF NOT EXISTS (SELECT 1 FROM public.commercial_rate_lines WHERE rate_card_id = v.id) THEN
      RAISE EXCEPTION 'RATES_REQUIRED';
    END IF;
    v_next := 'pending_approval';
    UPDATE public.commercial_rate_cards SET status = v_next, updated_at = now() WHERE id = v.id;

  ELSIF _action IN ('APPROVE','REJECT') THEN
    IF NOT public._rate_card_can_approve() THEN RAISE EXCEPTION 'NOT_AUTHORISED'; END IF;
    IF v.status <> 'pending_approval' THEN RAISE EXCEPTION 'ONLY_A_SUBMITTED_VERSION_CAN_BE_DECIDED'; END IF;
    IF _action = 'REJECT' AND COALESCE(btrim(_note),'') = '' THEN RAISE EXCEPTION 'REASON_REQUIRED'; END IF;
    IF v.created_by IS NOT NULL AND v.created_by = auth.uid() THEN
      IF NOT v_admin THEN RAISE EXCEPTION 'FOUR_EYES_REQUIRED'; END IF;
      v_sole := true;
    END IF;

    IF _action = 'REJECT' THEN
      v_next := 'source';
      UPDATE public.commercial_rate_cards SET status = v_next, updated_at = now() WHERE id = v.id;
    ELSE
      v_next := 'approved';
      UPDATE public.commercial_rate_cards
         SET status = 'retired', retired_at = now(), updated_at = now()
       WHERE code = v.code AND status = 'approved' AND id <> v.id;
      UPDATE public.commercial_rate_cards
         SET status = v_next, approved_by = auth.uid(), approved_at = now(),
             review_at = COALESCE(review_at, current_date + 180), updated_at = now()
       WHERE id = v.id;
    END IF;

  ELSIF _action = 'RETIRE' THEN
    IF NOT public._rate_card_can_approve() THEN RAISE EXCEPTION 'NOT_AUTHORISED'; END IF;
    IF v.status <> 'approved' THEN RAISE EXCEPTION 'ONLY_THE_LIVE_VERSION_CAN_BE_RETIRED'; END IF;
    IF COALESCE(btrim(_note),'') = '' THEN RAISE EXCEPTION 'REASON_REQUIRED'; END IF;
    v_next := 'retired';
    UPDATE public.commercial_rate_cards SET status = v_next, retired_at = now(), updated_at = now() WHERE id = v.id;
  ELSE
    RAISE EXCEPTION 'UNKNOWN_ACTION';
  END IF;

  INSERT INTO public.commercial_rate_card_events(
    rate_card_id, event, status_before, status_after, note, sole_approver, actor_user_id, actor_staff_id)
  VALUES (v.id, lower(_action), v.status, v_next, NULLIF(btrim(COALESCE(_note,'')),''), v_sole, auth.uid(), v_staff);

  RETURN jsonb_build_object('id', v.id, 'status', v_next, 'sole_approver', v_sole);
END $$;
REVOKE ALL ON FUNCTION public.rate_card_action(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rate_card_action(uuid, text, text) TO authenticated, service_role;
