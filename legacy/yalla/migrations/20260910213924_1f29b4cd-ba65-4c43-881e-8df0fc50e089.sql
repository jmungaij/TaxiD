CREATE OR REPLACE FUNCTION public._sales_lead_messages_append_only()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN RAISE EXCEPTION 'sales_lead_messages is append-only'; END $$;