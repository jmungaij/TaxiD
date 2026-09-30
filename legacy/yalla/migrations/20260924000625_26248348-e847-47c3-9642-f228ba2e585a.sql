CREATE OR REPLACE FUNCTION public.outbound_quota_consume(p_user uuid, p_channel text, p_units int, p_recipients text[], p_subject text, p_detail jsonb)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE used int; day_start timestamptz; cap int := 1000;
BEGIN
  day_start := (date_trunc('day', now() AT TIME ZONE 'Africa/Nairobi')) AT TIME ZONE 'Africa/Nairobi';
  PERFORM pg_advisory_xact_lock(hashtext(p_user::text || p_channel));
  SELECT CASE WHEN p_channel = 'invoice_note' THEN count(*) ELSE COALESCE(sum(cardinality(recipients)),0) END
    INTO used FROM outbound_external_sends
   WHERE user_id = p_user AND channel = p_channel AND created_at >= day_start;
  IF used + p_units > cap THEN RETURN false; END IF;
  INSERT INTO outbound_external_sends(user_id, channel, recipients, subject, detail)
  VALUES (p_user, p_channel, COALESCE(p_recipients,'{}'), p_subject, COALESCE(p_detail,'{}'::jsonb));
  RETURN true;
END $$;
REVOKE ALL ON FUNCTION public.outbound_quota_consume(uuid,text,int,text[],text,jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.outbound_quota_consume(uuid,text,int,text[],text,jsonb) TO service_role;