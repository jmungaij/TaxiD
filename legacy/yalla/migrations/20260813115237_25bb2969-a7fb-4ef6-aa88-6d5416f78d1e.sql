ALTER TABLE public.notification_settings
  ADD COLUMN IF NOT EXISTS sales_inbox text,
  ADD COLUMN IF NOT EXISTS hr_inbox text;

UPDATE public.notification_settings
SET contact_inbox = 'support@yalla.africa',
    support_inbox = 'support@yalla.africa',
    demo_inbox    = 'sales@yalla.africa',
    sales_inbox   = 'sales@yalla.africa',
    hr_inbox      = 'hr@yalla.africa',
    updated_at    = now();

INSERT INTO public.notification_settings (contact_inbox, support_inbox, demo_inbox, sales_inbox, hr_inbox)
SELECT 'support@yalla.africa', 'support@yalla.africa', 'sales@yalla.africa', 'sales@yalla.africa', 'hr@yalla.africa'
WHERE NOT EXISTS (SELECT 1 FROM public.notification_settings);

ALTER TABLE public.contact_submissions
  ADD COLUMN IF NOT EXISTS category text,
  ADD COLUMN IF NOT EXISTS routed_inbox text;

CREATE OR REPLACE FUNCTION public.audit_notification_settings_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.contact_inbox IS DISTINCT FROM OLD.contact_inbox
     OR NEW.support_inbox IS DISTINCT FROM OLD.support_inbox
     OR NEW.demo_inbox IS DISTINCT FROM OLD.demo_inbox
     OR NEW.sales_inbox IS DISTINCT FROM OLD.sales_inbox
     OR NEW.hr_inbox IS DISTINCT FROM OLD.hr_inbox THEN
    INSERT INTO public.admin_audit_log (actor_id, action, resource_type, resource_id, old_value, new_value)
    VALUES (
      auth.uid(),
      'contact_config_updated',
      'notification_settings',
      NEW.id::text,
      jsonb_build_object('contact_inbox', OLD.contact_inbox, 'support_inbox', OLD.support_inbox, 'demo_inbox', OLD.demo_inbox, 'sales_inbox', OLD.sales_inbox, 'hr_inbox', OLD.hr_inbox),
      jsonb_build_object('contact_inbox', NEW.contact_inbox, 'support_inbox', NEW.support_inbox, 'demo_inbox', NEW.demo_inbox, 'sales_inbox', NEW.sales_inbox, 'hr_inbox', NEW.hr_inbox)
    );
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_audit_notification_settings ON public.notification_settings;
CREATE TRIGGER trg_audit_notification_settings
AFTER UPDATE ON public.notification_settings
FOR EACH ROW EXECUTE FUNCTION public.audit_notification_settings_change();