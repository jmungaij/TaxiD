CREATE OR REPLACE FUNCTION public._email_log_to_notify()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $f$
BEGIN
  IF NEW.status = 'sent' AND NEW.recipient_email IS NOT NULL THEN
    BEGIN
      PERFORM public.comms_message_ingest(
        coalesce(nullif(NEW.route,''), 'notify@yalla.africa'), 'outbound', NEW.created_at,
        coalesce(nullif(NEW.route,''), 'notify@yalla.africa'), 'Yalla Mobility',
        ARRAY[NEW.recipient_email], '{}',
        coalesce(NEW.subject, NEW.template_name, 'Platform notification'),
        coalesce(NEW.subject, NEW.event_key, NEW.template_name), NULL,
        NEW.provider_message_id, NULL, 'email_send_log', coalesce(NEW.message_id, NEW.id::text),
        'notification', NEW.status, jsonb_build_object('template', NEW.template_name, 'category', NEW.category));
    EXCEPTION WHEN others THEN
      RAISE WARNING 'notify ingest skipped: %', SQLERRM;
    END;
  END IF;
  RETURN NEW;
END $f$;
REVOKE ALL ON FUNCTION public._email_log_to_notify() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_email_log_to_notify ON public.email_send_log;
CREATE TRIGGER trg_email_log_to_notify AFTER INSERT ON public.email_send_log
FOR EACH ROW EXECUTE FUNCTION public._email_log_to_notify();