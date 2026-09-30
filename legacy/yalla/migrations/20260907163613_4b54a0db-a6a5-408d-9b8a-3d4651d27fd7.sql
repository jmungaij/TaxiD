CREATE OR REPLACE FUNCTION public.audit_orchestrator_flag_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  INSERT INTO public.admin_audit_log(actor_id, action, resource_type, resource_id, old_value, new_value)
  VALUES (
    coalesce(NEW.updated_by, auth.uid()),
    'payment_orchestrator_flag_change',
    'payment_orchestrator_flag',
    'singleton',
    to_jsonb(OLD),
    to_jsonb(NEW)
  );
  RETURN NEW;
END $function$;