create or replace function public.rec_import_step_touch()
returns trigger language plpgsql
set search_path = public
as $$
begin
  NEW.updated_at := now();
  return NEW;
end $$;

revoke execute on function public.rec_enrichment_audit_trg() from anon, public, authenticated;
revoke execute on function public.rec_import_step_touch() from anon, public, authenticated;