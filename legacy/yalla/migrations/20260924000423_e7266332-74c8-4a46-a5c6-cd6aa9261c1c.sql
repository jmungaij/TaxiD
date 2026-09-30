CREATE TABLE public.outbound_external_sends (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  channel text NOT NULL CHECK (channel IN ('email','invoice_note','invite')),
  recipients text[] NOT NULL DEFAULT '{}',
  subject text,
  detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.outbound_external_sends TO authenticated;
GRANT ALL ON public.outbound_external_sends TO service_role;
ALTER TABLE public.outbound_external_sends ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins read outside sends" ON public.outbound_external_sends FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'super_admin'));
CREATE INDEX outbound_external_sends_user_day ON public.outbound_external_sends (user_id, channel, created_at);
CREATE TRIGGER outbound_external_sends_append_only BEFORE UPDATE OR DELETE ON public.outbound_external_sends
  FOR EACH ROW EXECUTE FUNCTION public._academy_events_append_only();

CREATE OR REPLACE FUNCTION public.outbound_quota_consume(p_user uuid, p_channel text, p_units int, p_recipients text[], p_subject text, p_detail jsonb)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE used int; day_start timestamptz;
BEGIN
  day_start := (date_trunc('day', now() AT TIME ZONE 'Africa/Nairobi')) AT TIME ZONE 'Africa/Nairobi';
  PERFORM pg_advisory_xact_lock(hashtext(p_user::text || p_channel));
  SELECT COALESCE(sum(cardinality(recipients)) FILTER (WHERE p_channel <> 'invoice_note'), 0)
       + COALESCE(count(*) FILTER (WHERE p_channel = 'invoice_note'), 0)
    INTO used FROM outbound_external_sends
   WHERE user_id = p_user AND channel = p_channel AND created_at >= day_start;
  IF used + p_units > 100 THEN RETURN false; END IF;
  INSERT INTO outbound_external_sends(user_id, channel, recipients, subject, detail)
  VALUES (p_user, p_channel, COALESCE(p_recipients,'{}'), p_subject, COALESCE(p_detail,'{}'::jsonb));
  RETURN true;
END $$;
REVOKE ALL ON FUNCTION public.outbound_quota_consume(uuid,text,int,text[],text,jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.outbound_quota_consume(uuid,text,int,text[],text,jsonb) TO service_role;