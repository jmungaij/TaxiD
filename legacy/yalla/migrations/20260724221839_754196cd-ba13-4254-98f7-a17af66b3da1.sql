UPDATE public.platform_settings
SET feature_flags = feature_flags || jsonb_build_object('stabilization_mode', false)
WHERE (feature_flags->>'stabilization_mode') IS DISTINCT FROM 'false';