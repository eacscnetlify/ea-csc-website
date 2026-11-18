-- Ensure list_bulletin_candidates excludes future-effective releases (r.effective_from <= p_cutoff_at)
-- so every candidate returned by Query Eligible Releases passes issue_bulletin validation.
begin;
set local lock_timeout = '10s';
set local statement_timeout = '30s';

create or replace function eacsc_private.list_bulletin_candidates(
  p_audience text,
  p_coverage_start date,
  p_cutoff_at timestamptz
)
returns table (
  release_id uuid,
  record_id text,
  version_id uuid,
  version_number integer,
  public_title text,
  public_category text,
  audience text,
  released_at timestamptz,
  effective_from timestamptz,
  approved_at timestamptz,
  summary_note text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  roles text[];
begin
  if actor_id is null
    or (auth.jwt()->>'is_anonymous') is distinct from 'false' then
    raise exception using errcode = '42501', message = 'Bulletin preparation is not permitted.';
  end if;

  if p_audience not in ('public', 'internal')
    or p_coverage_start is null
    or p_cutoff_at is null then
    raise exception using errcode = '22023', message = 'Provide valid audience, coverage start date, and cutoff timestamp.';
  end if;

  select functional_roles into roles
  from public.app_users
  where user_id = actor_id and is_active;

  if not found or not (roles && array['publisher', 'custodian']::text[]) or not exists (
    select 1 from auth.users
    where id = actor_id
      and is_anonymous is false
      and deleted_at is null
      and (banned_until is null or banned_until <= clock_timestamp())
  ) then
    raise exception using errcode = '42501', message = 'Bulletin preparation is not permitted.';
  end if;

  if p_audience = 'public' then
    return query
    select
      r.release_id,
      m.record_id::text,
      v.version_id,
      v.version_number,
      r.public_title::text,
      r.public_category::text,
      r.audience::text,
      r.released_at,
      r.effective_from,
      v.approved_at,
      'Authorized public release'::text as summary_note
    from public.record_releases r
    join public.master_records m on m.record_id = r.record_id
    join public.record_versions v on v.record_id = r.record_id and v.version_id = r.version_id
    where m.access_class = 'public'
      and m.document_type <> 'Update bulletin'
      and r.audience = 'public'
      and v.state in ('Approved', 'Superseded')
      and r.withdrawn_at is null
      and r.released_at <= p_cutoff_at
      and r.effective_from <= p_cutoff_at
      and (r.released_at at time zone 'Asia/Manila')::date >= p_coverage_start
      and (r.effective_until is null or r.effective_until > p_cutoff_at)
    order by r.released_at desc, m.record_id asc;
  else
    return query
    select
      r.release_id,
      m.record_id::text,
      v.version_id,
      v.version_number,
      r.public_title::text,
      r.public_category::text,
      r.audience::text,
      r.released_at,
      r.effective_from,
      v.approved_at,
      coalesce(v.change_summary, 'Authorized internal release')::text as summary_note
    from public.record_releases r
    join public.master_records m on m.record_id = r.record_id
    join public.record_versions v on v.record_id = r.record_id and v.version_id = r.version_id
    where m.access_class = 'internal'
      and m.document_type <> 'Update bulletin'
      and r.audience = 'internal'
      and v.state in ('Approved', 'Superseded')
      and r.withdrawn_at is null
      and r.released_at <= p_cutoff_at
      and r.effective_from <= p_cutoff_at
      and (r.released_at at time zone 'Asia/Manila')::date >= p_coverage_start
      and (r.effective_until is null or r.effective_until > p_cutoff_at)
    order by r.released_at desc, m.record_id asc;
  end if;
end;
$$;

commit;
