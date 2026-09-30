-- Trigger-only functions must never be callable directly from the API.
REVOKE ALL ON FUNCTION public._commercial_opportunity_change_log() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._commercial_opportunity_changes_append_only() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._commercial_signals_touch() FROM PUBLIC, anon, authenticated;