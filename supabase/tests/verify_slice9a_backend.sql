-- Read-only installation inspection. Run as postgres AFTER the corrective migration.
-- Does not create users, change records, or exercise mutating RPCs.
with required_api(signature) as (
  values
    ('public.eacsc_list_turnover_packages()'),
    ('public.eacsc_get_turnover_package(uuid)'),
    ('public.eacsc_turnover_directory()'),
    ('public.eacsc_save_turnover_package_v2(uuid,integer,text,text,uuid,text,text,text,text,text,uuid)'),
    ('public.eacsc_confirm_turnover_outgoing(uuid,integer,uuid)'),
    ('public.eacsc_transfer_position_role_v2(uuid,integer,integer,integer,uuid)'),
    ('public.eacsc_sign_turnover_acknowledgment_v2(uuid,integer,text,uuid)')
), legacy_api(signature) as (
  values
    ('public.eacsc_save_turnover_package(uuid,text,text,uuid,text,text,text,text,text,uuid)'),
    ('eacsc_private.save_turnover_package(uuid,text,text,uuid,text,text,text,text,text,uuid)'),
    ('public.eacsc_sign_turnover_acknowledgment(uuid,text,uuid)'),
    ('eacsc_private.sign_turnover_acknowledgment(uuid,text,uuid)'),
    ('public.eacsc_transfer_position_role(text,uuid,uuid,text[],uuid)'),
    ('eacsc_private.transfer_position_role(text,uuid,uuid,text[],uuid)')
), checks(check_name,passed) as (
  select '01 New package controls present', count(*)=3
    from information_schema.columns where table_schema='public' and table_name='turnover_packages'
      and column_name in ('outgoing_confirmed_at','access_transferred_at','inventory_snapshot')
  union all
  select '02 Seven new public APIs exist', bool_and(to_regprocedure(signature) is not null) from required_api
  union all
  select '03 Active application role may call new APIs',
    bool_and(coalesce(has_function_privilege('authenticated',to_regprocedure(signature),'EXECUTE'),false)) from required_api
  union all
  select '04 Anonymous callers cannot call new APIs',
    bool_and(not coalesce(has_function_privilege('anon',to_regprocedure(signature),'EXECUTE'),true)) from required_api
  union all
  select '05 Legacy write APIs blocked',
    bool_and(not coalesce(has_function_privilege('authenticated',to_regprocedure(signature),'EXECUTE'),true)) from legacy_api
  union all
  select '06 Direct package and acknowledgment reads blocked',
    not has_table_privilege('authenticated','public.turnover_packages','SELECT')
    and not has_table_privilege('authenticated','public.turnover_acknowledgments','SELECT')
  union all
  select '07 Internal mutation helpers blocked',
    not coalesce(has_function_privilege('authenticated',to_regprocedure('eacsc_private.turnover_retry(uuid,text,jsonb)'),'EXECUTE'),true)
    and not coalesce(has_function_privilege('authenticated',to_regprocedure('eacsc_private.turnover_event(uuid,text,jsonb,jsonb,jsonb,jsonb,integer,integer)'),'EXECUTE'),true)
    and not coalesce(has_function_privilege('authenticated',to_regprocedure('eacsc_private.turnover_actor()'),'EXECUTE'),true)
  union all
  select '08 Existing record read policy helper retained',
    to_regprocedure('eacsc_private.can_read_record(text,text,text)') is not null
  union all
  select '09 Both records buckets remain private', count(*)=2 and bool_and(public is false)
    from storage.buckets where id in ('internal-council-records','verified-council-releases')
  union all
  select '10 Package tables retain row level security', count(*)=2 and bool_and(relrowsecurity)
    from pg_class where oid in ('public.turnover_packages'::regclass,'public.turnover_acknowledgments'::regclass)
)
select check_name,case when passed then 'PASS' else 'FAIL' end as result
from checks order by check_name;
