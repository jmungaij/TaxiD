-- Trigger functions must not be callable from the API surface.
REVOKE ALL ON FUNCTION public._rental_enforce_transition() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._rental_enforce_transition() TO service_role;

REVOKE ALL ON FUNCTION public._rental_domain_events_append_only() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._rental_domain_events_append_only() TO service_role;

REVOKE ALL ON FUNCTION public._rental_quote_events_append_only() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._rental_quote_events_append_only() TO service_role;

REVOKE ALL ON FUNCTION public._rental_quote_touch() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._rental_quote_touch() TO service_role;