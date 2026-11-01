-- Read-only installation checks.
select
  check_name,
  case when passed is true then 'PASS' else 'FAIL' end as result
from (
  values
  (
    'Both review RPCs are installed for authenticated callers',
    has_function_privilege(
      'authenticated',
      'public.eacsc_submit_version_for_review(uuid,integer,uuid)',
      'EXECUTE'
    )
    and has_function_privilege(
      'authenticated',
      'public.eacsc_return_version_for_correction(uuid,integer,text,uuid)',
      'EXECUTE'
    )
  ),
  (
    'Anonymous and service roles cannot invoke review commands',
    not exists (
      select 1 from pg_proc p
      where p.oid in (
        'public.eacsc_submit_version_for_review(uuid,integer,uuid)'::regprocedure,
        'public.eacsc_return_version_for_correction(uuid,integer,text,uuid)'::regprocedure,
        'eacsc_private.transition_review(uuid,integer,uuid,text,text)'::regprocedure
      )
      and (
        has_function_privilege('anon', p.oid, 'EXECUTE')
        or has_function_privilege('service_role', p.oid, 'EXECUTE')
      )
    )
  ),
  (
    'Review comments have RLS and assigned-read policy',
    (
      select relrowsecurity from pg_class
      where oid = 'public.review_comments'::regclass
    )
    and exists (
      select 1 from pg_policy
      where polrelid = 'public.review_comments'::regclass
        and polname = 'review_comments_select_assigned'
        and polcmd = 'r'
    )
  ),
  (
    'Application roles cannot write review comments directly',
    not exists (
      select 1
      from unnest(array['anon', 'authenticated', 'service_role']) role_name
      where has_table_privilege(
        role_name,
        'public.review_comments',
        'INSERT,UPDATE,DELETE,TRUNCATE'
      )
    )
  ),
  (
    'Review comments have an enabled immutability guard',
    exists (
      select 1 from pg_trigger
      where tgrelid = 'public.review_comments'::regclass
        and tgname = 'review_comments_block_changes'
        and tgenabled = 'O'
        and not tgisinternal
    )
  )
) checks(check_name, passed)
order by check_name;
