CREATE OR REPLACE FUNCTION public.provider_capacity_portal()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_out jsonb;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'AUTHENTICATION_REQUIRED'; END IF;

  SELECT jsonb_build_object(
    'accredited', public.provider_is_accredited(v_uid),
    'can_approve', public.capacity_can_approve(v_uid),
    'summary', (
      SELECT jsonb_build_object(
        'total',      count(*),
        'published',  count(*) FILTER (WHERE status = 'PUBLISHED'),
        'awaiting',   count(*) FILTER (WHERE status = 'PENDING_APPROVAL'),
        'drafts',     count(*) FILTER (WHERE status IN ('DRAFT','SENT_BACK')),
        'retired',    count(*) FILTER (WHERE status = 'RETIRED'),
        'units_live', coalesce(sum(units) FILTER (WHERE status = 'PUBLISHED'), 0)
      ) FROM public.provider_capacity WHERE provider_user_id = v_uid
    ),
    'capacity', (
      SELECT coalesce(jsonb_agg(jsonb_build_object(
        'id', c.id, 'family', c.family, 'title', c.title, 'provider_name', c.provider_name,
        'provider_kind', c.provider_kind, 'vehicle_type', c.vehicle_type, 'spec', c.spec,
        'seats', c.seats, 'units', c.units, 'base_city', c.base_city, 'coverage_area', c.coverage_area,
        'rate_amount', c.rate_amount, 'rate_basis', c.rate_basis, 'currency', c.currency,
        'available_from', c.available_from, 'available_to', c.available_to,
        'registration_ref', c.registration_ref, 'notes', c.notes, 'status', c.status,
        'photo_paths', to_jsonb(c.photo_paths),
        'decision_reason', c.decision_reason, 'submitted_at', c.submitted_at,
        'published_at', c.published_at, 'created_at', c.created_at,
        'enquiry_count', (SELECT count(*) FROM public.capacity_enquiries e WHERE e.capacity_id = c.id),
        'open_enquiries', (SELECT count(*) FROM public.capacity_enquiries e WHERE e.capacity_id = c.id AND e.status <> 'CLOSED'),
        'history', (
          SELECT coalesce(jsonb_agg(jsonb_build_object(
            'action', ev.action, 'status_to', ev.status_to, 'reason', ev.reason, 'created_at', ev.created_at
          ) ORDER BY ev.created_at DESC), '[]'::jsonb)
          FROM public.provider_capacity_events ev WHERE ev.capacity_id = c.id
        )
      ) ORDER BY c.created_at DESC), '[]'::jsonb)
      FROM public.provider_capacity c WHERE c.provider_user_id = v_uid
    ),
    'enquiries', (
      SELECT coalesce(jsonb_agg(jsonb_build_object(
        'id', e.id, 'capacity_id', e.capacity_id, 'capacity_title', c.title,
        'lead_ref', e.lead_ref, 'organisation_name', e.organisation_name,
        'contact_name', e.contact_name, 'service_date', e.service_date,
        'passengers', e.passengers, 'requirement', e.requirement,
        'status', e.status, 'provider_note', e.provider_note, 'created_at', e.created_at
      ) ORDER BY e.created_at DESC), '[]'::jsonb)
      FROM public.capacity_enquiries e
      JOIN public.provider_capacity c ON c.id = e.capacity_id
      WHERE c.provider_user_id = v_uid
    ),
    'awaiting_review', (
      SELECT CASE WHEN public.capacity_can_approve(v_uid) THEN coalesce(jsonb_agg(jsonb_build_object(
        'id', c.id, 'family', c.family, 'title', c.title, 'provider_name', c.provider_name,
        'vehicle_type', c.vehicle_type, 'seats', c.seats, 'units', c.units,
        'base_city', c.base_city, 'rate_amount', c.rate_amount, 'rate_basis', c.rate_basis,
        'currency', c.currency, 'submitted_at', c.submitted_at, 'is_own', c.provider_user_id = v_uid
      ) ORDER BY c.submitted_at), '[]'::jsonb) ELSE '[]'::jsonb END
      FROM public.provider_capacity c WHERE c.status = 'PENDING_APPROVAL'
    )
  ) INTO v_out;

  RETURN v_out;
END;
$function$;
