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
           'is_test', c.is_test,
           'published_at', c.published_at
         ) ORDER BY c.is_test, c.rate_amount NULLS LAST, c.title), '[]'::jsonb)
  FROM public.provider_capacity c
  WHERE c.status = 'PUBLISHED'
    AND (coalesce(p->>'family','') = '' OR c.family = p->>'family')
    AND (coalesce(p->>'city','')   = '' OR c.base_city ILIKE '%' || (p->>'city') || '%'
                                        OR coalesce(c.coverage_area,'') ILIKE '%' || (p->>'city') || '%')
    AND (coalesce(p->>'vehicle_type','') = '' OR c.vehicle_type ILIKE '%' || (p->>'vehicle_type') || '%')
    AND (coalesce(p->>'seats','') = '' OR coalesce(c.seats, 0) >= (p->>'seats')::int)
    AND (coalesce(p->>'date','') = '' OR (
          (c.available_from IS NULL OR (p->>'date')::date >= c.available_from) AND
          (c.available_to   IS NULL OR (p->>'date')::date <= c.available_to)));
$function$;