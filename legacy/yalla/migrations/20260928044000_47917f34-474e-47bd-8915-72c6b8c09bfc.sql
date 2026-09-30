CREATE OR REPLACE FUNCTION public._email_log_to_notify()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $f$
DECLARE v_subject text;
BEGIN
  IF NEW.status = 'sent' AND NEW.recipient_email IS NOT NULL THEN
    v_subject := coalesce(NEW.subject, (SELECT l.subject FROM public.email_send_log l
      WHERE l.message_id = NEW.message_id AND l.subject IS NOT NULL ORDER BY l.created_at DESC LIMIT 1));
    BEGIN
      PERFORM public.comms_message_ingest(
        coalesce(nullif(NEW.route,''), 'notify@yalla.africa'), 'outbound', NEW.created_at,
        coalesce(nullif(NEW.route,''), 'notify@yalla.africa'), 'Yalla Mobility',
        ARRAY[NEW.recipient_email], '{}',
        coalesce(v_subject, NEW.template_name, 'Platform notification'),
        coalesce(v_subject, NEW.event_key, NEW.template_name), NULL,
        NEW.provider_message_id, NULL, 'email_send_log', coalesce(NEW.message_id, NEW.id::text),
        'notification', NEW.status, jsonb_build_object('template', NEW.template_name, 'category', NEW.category));
    EXCEPTION WHEN others THEN
      RAISE WARNING 'notify ingest skipped: %', SQLERRM;
    END;
  END IF;
  RETURN NEW;
END $f$;
UPDATE public.comms_messages m SET subject = l.subject, body_preview = l.subject
FROM public.email_send_log l
WHERE m.subject = 'payment-confirmation' AND l.message_id = '4cdf8646-51e5-4b23-9b8a-f5bd5ef43d64'
  AND l.subject IS NOT NULL AND m.account_id = '4195422f-9e2a-4cfc-9bbd-3c79e9d48f1c';