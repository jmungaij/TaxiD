REVOKE ALL ON FUNCTION public._sales_lead_reply_raises_followup() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._sales_lead_reply_raises_followup() TO service_role;