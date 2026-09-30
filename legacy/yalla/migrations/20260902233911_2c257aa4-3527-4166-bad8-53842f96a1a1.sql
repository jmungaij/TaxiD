CREATE OR REPLACE FUNCTION public._logistics_hub_project_active()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  NEW.active := (upper(NEW.status) = 'ACTIVE');
  RETURN NEW;
END $$;

UPDATE public.logistics_hubs SET active = (upper(status) = 'ACTIVE');