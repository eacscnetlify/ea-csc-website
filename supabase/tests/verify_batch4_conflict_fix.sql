-- Read-only contract checks. Run after the forward migration and updated 005.
with implementation as (
  select p.prosrc,p.prosecdef,p.proconfig
  from pg_catalog.pg_proc p
  where p.oid='eacsc_private.update_draft_notes(uuid,integer,text,uuid)'::regprocedure
), checks(check_name,passed) as (values
  ('Both application conflict branches use PT409', (
    select (length(prosrc)-length(replace(prosrc,'PT409','')))/5=2 from implementation)),
  ('Implementation no longer raises serialization failure 40001', (
    select position('40001' in prosrc)=0 from implementation)),
  ('Private implementation retains definer privileges and empty search path', (
    select prosecdef and proconfig @> array['search_path=""'] from implementation)),
  ('Public RPC retains caller privileges', (
    select not p.prosecdef from pg_catalog.pg_proc p
    where p.oid='public.eacsc_update_draft_notes(uuid,integer,text,uuid)'::regprocedure)),
  ('Only authenticated application role may call the public RPC', (
    has_function_privilege('authenticated','public.eacsc_update_draft_notes(uuid,integer,text,uuid)','EXECUTE')
    and not has_function_privilege('anon','public.eacsc_update_draft_notes(uuid,integer,text,uuid)','EXECUTE')
    and not has_function_privilege('service_role','public.eacsc_update_draft_notes(uuid,integer,text,uuid)','EXECUTE'))),
  ('Fictional Author remains active', exists(select 1 from public.app_users
    where email='batch4-author@example.invalid' and is_active
      and functional_roles=array['author']::text[]))
)
select check_name,case when passed is true then 'PASS' else 'FAIL' end as result
from checks order by check_name;
