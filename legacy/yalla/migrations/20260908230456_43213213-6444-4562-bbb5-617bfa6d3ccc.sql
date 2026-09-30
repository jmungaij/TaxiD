ALTER TABLE public.provider_capacity
  ADD COLUMN IF NOT EXISTS photo_paths text[] NOT NULL DEFAULT '{}'::text[];

CREATE OR REPLACE FUNCTION public.provider_capacity_photos_set(_capacity_id uuid, _paths text[])
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_row public.provider_capacity;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'AUTHENTICATION_REQUIRED'; END IF;
  SELECT * INTO v_row FROM public.provider_capacity WHERE id = _capacity_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'CAPACITY_NOT_FOUND'; END IF;
  IF v_row.provider_user_id <> v_uid THEN RAISE EXCEPTION 'NOT_YOUR_CAPACITY'; END IF;
  IF v_row.status NOT IN ('DRAFT','SENT_BACK','PUBLISHED') THEN
    RAISE EXCEPTION 'CAPACITY_LOCKED_FOR_EDITING';
  END IF;
  IF coalesce(array_length(_paths,1),0) > 8 THEN RAISE EXCEPTION 'TOO_MANY_PHOTOS'; END IF;

  UPDATE public.provider_capacity
     SET photo_paths = coalesce(_paths, '{}'::text[])
   WHERE id = _capacity_id
  RETURNING * INTO v_row;

  INSERT INTO public.provider_capacity_events (capacity_id, action, status_to, reason, actor_id)
  VALUES (_capacity_id, 'PHOTOS_UPDATED', v_row.status,
          coalesce(array_length(v_row.photo_paths,1),0)::text || ' photo(s) on record', v_uid);

  RETURN jsonb_build_object('ok', true, 'photo_paths', to_jsonb(v_row.photo_paths));
END;
$function$;

REVOKE ALL ON FUNCTION public.provider_capacity_photos_set(uuid, text[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.provider_capacity_photos_set(uuid, text[]) TO authenticated;

CREATE OR REPLACE FUNCTION public.marketplace_capacity_search(p jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'id', c.id,
           'family', c.family,
           'title', c.title,
           'provider_name', c.provider_name,
           'provider_kind', c.provider_kind,
           'vehicle_type', c.vehicle_type,
           'spec', c.spec,
           'seats', c.seats,
           'units', c.units,
           'base_city', c.base_city,
           'coverage_area', c.coverage_area,
           'rate_amount', c.rate_amount,
           'rate_basis', c.rate_basis,
           'currency', c.currency,
           'available_from', c.available_from,
           'available_to', c.available_to,
           'registration_ref', c.registration_ref,
           'notes', c.notes,
           'photo_paths', to_jsonb(c.photo_paths),
           'published_at', c.published_at
         ) ORDER BY c.rate_amount NULLS LAST, c.title), '[]'::jsonb)
  FROM public.provider_capacity c
  WHERE c.status = 'PUBLISHED'
    AND c.is_test = false
    AND (coalesce(p->>'family','') = '' OR c.family = p->>'family')
    AND (coalesce(p->>'city','')   = '' OR c.base_city ILIKE '%' || (p->>'city') || '%'
                                        OR coalesce(c.coverage_area,'') ILIKE '%' || (p->>'city') || '%')
    AND (coalesce(p->>'vehicle_type','') = '' OR c.vehicle_type ILIKE '%' || (p->>'vehicle_type') || '%')
    AND (coalesce(p->>'seats','') = '' OR coalesce(c.seats, 0) >= (p->>'seats')::int)
    AND (coalesce(p->>'date','') = '' OR (
          (c.available_from IS NULL OR (p->>'date')::date >= c.available_from) AND
          (c.available_to   IS NULL OR (p->>'date')::date <= c.available_to)));
$function$;
