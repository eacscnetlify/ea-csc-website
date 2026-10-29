begin;

create or replace function public.eacsc_connection_check()
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select pg_catalog.jsonb_build_object(
    'status', 'ok',
    'service', 'ea-csc-records',
    'server_time', pg_catalog.now()
  );
$$;

revoke all on function public.eacsc_connection_check()
from public, anon, authenticated;

grant usage on schema public to anon, authenticated;

grant execute on function public.eacsc_connection_check()
to anon, authenticated;

comment on function public.eacsc_connection_check()
is 'Connection check returning status and server time without reading application records.';

notify pgrst, 'reload schema';

commit;
