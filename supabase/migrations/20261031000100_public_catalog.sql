-- Batch 4 public metadata boundary. Publication commands follow in Batch 6.
begin;

set local lock_timeout = '5s';
set local statement_timeout = '30s';

do $owner$
begin
  if current_user <> 'postgres' then
    raise exception 'Run this migration as postgres.';
  end if;
end;
$owner$;

create table public.record_releases (
  release_id uuid primary key default gen_random_uuid(),
  record_id varchar(50) not null,
  version_id uuid not null,

  audience varchar(10) not null default 'internal'
    check (audience in ('public', 'internal')),

  public_title varchar(240) not null
    check (length(btrim(public_title)) > 0),

  public_category varchar(80) not null
    check (
      public_category in (
        'Governance and legislation',
        'Secretariat and proceedings',
        'Activities and CBO records',
        'Financial archives',
        'Forms and official information',
        'Turnover and continuity'
      )
    ),

  authorization_basis text not null
    check (length(btrim(authorization_basis)) > 0),

  authorization_reference text not null
    check (length(btrim(authorization_reference)) > 0),

  released_by uuid not null
    references public.app_users(user_id) on delete restrict,

  released_at timestamptz not null default now(),
  effective_from timestamptz not null default now(),
  effective_until timestamptz,

  withdrawn_at timestamptz,

  withdrawn_by uuid
    references public.app_users(user_id) on delete restrict,

  withdrawal_reason text,

  unique (record_id, release_id),

  foreign key (record_id, version_id)
    references public.record_versions(record_id, version_id)
    on delete restrict,

  check (
    effective_until is null
    or effective_until > effective_from
  ),

  check (
    (
      withdrawn_at is null
      and withdrawn_by is null
      and withdrawal_reason is null
    )
    or (
      withdrawn_at is not null
      and withdrawn_by is not null
      and withdrawal_reason is not null
      and length(btrim(withdrawal_reason)) > 0
      and withdrawn_at >= released_at
    )
  )
);

alter table public.record_releases enable row level security;

revoke all on public.record_releases
  from public, anon, authenticated, service_role;

create index record_releases_version_index
  on public.record_releases(version_id);

create index record_releases_issuer_index
  on public.record_releases(released_by);

create index record_releases_withdrawer_index
  on public.record_releases(withdrawn_by);

alter table public.master_records
  add column current_public_release_id uuid;

alter table public.master_records
  add constraint master_records_public_release_same_record
  foreign key (record_id, current_public_release_id)
  references public.record_releases(record_id, release_id)
  on delete restrict;

create function eacsc_private.protect_record_release()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $protect$
begin
  if tg_op <> 'UPDATE' then
    raise exception using
      errcode = '55000',
      message = 'Release history cannot be deleted or truncated.';
  end if;

  if (
    to_jsonb(new)
      - 'withdrawn_at'
      - 'withdrawn_by'
      - 'withdrawal_reason'
  ) is distinct from (
    to_jsonb(old)
      - 'withdrawn_at'
      - 'withdrawn_by'
      - 'withdrawal_reason'
  ) then
    raise exception using
      errcode = '55000',
      message = 'Issued release facts are immutable. Record a new release.';
  end if;

  if old.withdrawn_at is not null
    and to_jsonb(new) is distinct from to_jsonb(old) then
    raise exception using
      errcode = '55000',
      message = 'A withdrawn release cannot be changed or reinstated.';
  end if;

  return new;
end;
$protect$;

revoke all on function eacsc_private.protect_record_release()
  from public, anon, authenticated, service_role;

create trigger record_releases_protect_updates
before update on public.record_releases
for each row
execute function eacsc_private.protect_record_release();

create trigger record_releases_protect_removal
before delete or truncate on public.record_releases
for each statement
execute function eacsc_private.protect_record_release();

create function eacsc_private.public_catalog(
  p_limit integer,
  p_offset integer
)
returns table (
  record_id text,
  title text,
  category text,
  version_id uuid,
  version_number integer,
  approved_at timestamptz,
  released_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $catalog$
begin
  if p_limit is null or p_limit < 1 or p_limit > 100
    or p_offset is null or p_offset < 0 or p_offset > 100000 then
    raise exception using
      errcode = '22023',
      message = 'Use a limit of 1 to 100 and an offset of 0 to 100000.';
  end if;

  return query
  select
    m.record_id::text,
    r.public_title::text,
    r.public_category::text,
    v.version_id,
    v.version_number,
    v.approved_at,
    r.released_at
  from public.master_records m
  join public.record_releases r
    on r.record_id = m.record_id
    and r.release_id = m.current_public_release_id
  join public.record_versions v
    on v.record_id = r.record_id
    and v.version_id = r.version_id
  where m.access_class = 'public'
    and r.audience = 'public'
    and v.state in ('Approved', 'Superseded')
    and r.withdrawn_at is null
    and r.released_at <= now()
    and r.effective_from <= now()
    and (
      r.effective_until is null
      or now() < r.effective_until
    )
  order by m.record_id
  limit p_limit
  offset p_offset;
end;
$catalog$;

revoke all on function eacsc_private.public_catalog(integer, integer)
  from public, anon, authenticated, service_role;

grant usage on schema eacsc_private to anon;

grant execute on function eacsc_private.public_catalog(integer, integer)
  to anon, authenticated;

create function public.eacsc_public_catalog(
  p_limit integer default 20,
  p_offset integer default 0
)
returns table (
  record_id text,
  title text,
  category text,
  version_id uuid,
  version_number integer,
  approved_at timestamptz,
  released_at timestamptz
)
language sql
stable
security invoker
set search_path = ''
as $entry$
  select
    c.record_id,
    c.title,
    c.category,
    c.version_id,
    c.version_number,
    c.approved_at,
    c.released_at
  from eacsc_private.public_catalog(p_limit, p_offset) c;
$entry$;

revoke all on function public.eacsc_public_catalog(integer, integer)
  from public, anon, authenticated, service_role;

grant execute on function public.eacsc_public_catalog(integer, integer)
  to anon, authenticated;

comment on table public.record_releases is
'Issued release facts and frozen public labels. No application writes. Future publication commands must verify capture, approval, disclosure authority and assignment, and audit issuance, activation and withdrawal atomically.';

comment on column public.master_records.current_public_release_id is
'Only this explicitly selected release may be returned publicly. No fallback to an older release when the selected release is ineligible or withdrawn.';

comment on function public.eacsc_public_catalog(integer, integer) is
'Safe public metadata only. Requires an explicitly selected, applicable, non-withdrawn public release of an Approved or Superseded version under a currently public parent. Returns no internal notes, evidence or file identities.';

notify pgrst, 'reload schema';

commit;
