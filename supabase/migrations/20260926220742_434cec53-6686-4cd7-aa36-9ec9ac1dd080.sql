CREATE TABLE public.support_threads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rider_email text NOT NULL,
  subject text NOT NULL,
  category text NOT NULL DEFAULT 'general',
  status text NOT NULL DEFAULT 'open',
  created_by uuid NOT NULL DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.support_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  thread_id uuid NOT NULL REFERENCES public.support_threads(id) ON DELETE CASCADE,
  sender_id uuid NOT NULL DEFAULT auth.uid(),
  sender_role text NOT NULL CHECK (sender_role IN ('staff','rider')),
  body text NOT NULL CHECK (length(body) BETWEEN 1 AND 8000),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON public.support_messages(thread_id, created_at);
CREATE INDEX ON public.support_threads(lower(rider_email));
GRANT SELECT, INSERT, UPDATE, DELETE ON public.support_threads TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.support_messages TO authenticated;
GRANT ALL ON public.support_threads TO service_role;
GRANT ALL ON public.support_messages TO service_role;
ALTER TABLE public.support_threads ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.support_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Staff manage threads" ON public.support_threads FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'support'))
  WITH CHECK (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'support'));
CREATE POLICY "Riders view own threads" ON public.support_threads FOR SELECT TO authenticated
  USING (lower(rider_email) = lower(auth.jwt()->>'email'));

CREATE POLICY "Staff manage messages" ON public.support_messages FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'support'))
  WITH CHECK ((public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'support')) AND sender_id = auth.uid());
CREATE POLICY "Riders view own messages" ON public.support_messages FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.support_threads t WHERE t.id = thread_id AND lower(t.rider_email) = lower(auth.jwt()->>'email')));
CREATE POLICY "Riders reply on own open threads" ON public.support_messages FOR INSERT TO authenticated
  WITH CHECK (sender_role = 'rider' AND sender_id = auth.uid() AND EXISTS (
    SELECT 1 FROM public.support_threads t WHERE t.id = thread_id AND t.status = 'open'
      AND lower(t.rider_email) = lower(auth.jwt()->>'email')));

CREATE OR REPLACE FUNCTION public.touch_support_thread() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN UPDATE public.support_threads SET updated_at = now() WHERE id = NEW.thread_id; RETURN NEW; END; $$;
REVOKE EXECUTE ON FUNCTION public.touch_support_thread() FROM anon, authenticated, public;
CREATE TRIGGER support_messages_touch AFTER INSERT ON public.support_messages
  FOR EACH ROW EXECUTE FUNCTION public.touch_support_thread();