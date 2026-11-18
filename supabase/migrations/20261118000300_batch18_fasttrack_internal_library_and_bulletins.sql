-- Batch 18: Fix Fast-Track audit_events jsonb object constraint, add Internal Library & Internal Bulletins RPCs
begin;
set local lock_timeout = '10s';
set local statement_timeout = '30s';

-- 1. Fix Fast-Track Self-Approval audit_events_snapshots_are_objects (must be jsonb objects)
create or replace function public.eacsc_executive_self_approve(
  p_version_id uuid,
  p_expected_revision integer,
  p_rationale text,
  p_request_id uuid default gen_random_uuid()
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_user public.app_users%rowtype;
  v_ver public.record_versions%rowtype;
  v_audit_uuid uuid := gen_random_uuid();
  v_new_rev integer;
begin
  select * into v_user from public.app_users where user_id = v_uid and is_active = true;
  if not found
    or not (v_user.functional_roles && array['approver', 'custodian']::text[])
    or coalesce(v_user.council_position, '') not in ('President', 'Secretary', 'Executive Secretary')
  then
    raise exception 'Executive Fast-Track Self-Approval is restricted to the Council President and Secretary.' using errcode = '42501';
  end if;

  select * into v_ver from public.record_versions where version_id = p_version_id for update;
  if not found then
    raise exception 'Document version not found.' using errcode = 'P0002';
  end if;

  if v_ver.revision_counter <> p_expected_revision then
    raise exception 'This document version was modified elsewhere. Refresh and try again.' using errcode = 'PT409';
  end if;

  if v_ver.state not in ('Draft', 'For Review') then
    raise exception 'Only Draft or For Review versions can be executive-approved.' using errcode = '22023';
  end if;

  v_new_rev := v_ver.revision_counter + 1;

  insert into public.audit_events (
    event_uuid, record_id, version_id, actor_user_id,
    action_type, action_summary,
    previous_revision, new_revision, previous_state, new_state,
    request_id
  ) values (
    v_audit_uuid, v_ver.record_id, v_ver.version_id, v_uid,
    'version.executive_approved',
    format('Executive fast-track approval by %s: %s', coalesce(v_user.council_position, 'Officer'), btrim(p_rationale)),
    v_ver.revision_counter, v_new_rev,
    jsonb_build_object('state', v_ver.state),
    jsonb_build_object('state', 'Approved'),
    p_request_id
  );

  update public.record_versions
  set state = 'Approved',
      revision_counter = v_new_rev,
      approved_at = now(),
      approval_recorded_by = v_uid,
      approval_basis = format('Executive Fast-Track (%s): %s', coalesce(v_user.council_position, 'Officer'), btrim(p_rationale)),
      approval_evidence_reference = 'Executive Fast-Track Self-Approval',
      updated_at = now()
  where version_id = p_version_id;

  return jsonb_build_object(
    'version_id', p_version_id,
    'state', 'Approved',
    'revision', v_new_rev
  );
end;
$$;

-- 2. Internal Library RPC (Internal releases + Restricted section for authorized/exempted officers)
create or replace function public.eacsc_list_internal_library()
returns table (
  release_id uuid,
  record_id varchar(50),
  version_id uuid,
  version_number integer,
  public_title varchar(240),
  public_category varchar(80),
  access_class varchar(20),
  released_at timestamptz,
  approved_at timestamptz,
  external_url text,
  originating_office varchar(160),
  custodian_position varchar(160)
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_user public.app_users%rowtype;
  v_is_exempt boolean;
begin
  select * into v_user from public.app_users where user_id = v_uid and is_active = true;
  if not found or cardinality(v_user.functional_roles) = 0 then
    raise exception 'Active officer role required.' using errcode = '42501';
  end if;

  v_is_exempt := (
    v_user.functional_roles && array['approver', 'reviewer', 'publisher', 'technical_admin']::text[]
    or coalesce(v_user.council_position, '') in ('President', 'Secretary', 'Treasurer', 'Auditor', 'Public Information Officer')
  );

  return query
  select
    r.release_id,
    m.record_id,
    v.version_id,
    v.version_number,
    r.public_title,
    r.public_category,
    m.access_class,
    r.released_at,
    v.approved_at,
    v.external_url,
    m.originating_office,
    m.custodian_position
  from public.record_releases r
  join public.master_records m on m.record_id = r.record_id
  join public.record_versions v on v.version_id = r.version_id
  where r.withdrawn_at is null
    and v.state = 'Approved'
    and (r.audience = 'internal' or m.access_class in ('internal', 'restricted'))
    and (
      m.access_class <> 'restricted'
      or v_is_exempt
      or exists (
        select 1 from public.record_assignments a
        where a.record_id = m.record_id
          and a.user_id = v_uid
          and a.is_active = true
          and a.allow_restricted = true
      )
    )
  order by r.released_at desc, m.record_id asc;
end;
$$;

revoke all on function public.eacsc_list_internal_library() from public, anon;
grant execute on function public.eacsc_list_internal_library() to authenticated;

-- 3. Internal Update Bulletins RPC (for signed-in officers)
create or replace function public.eacsc_list_internal_bulletins()
returns table (
  issue_uuid uuid,
  bulletin_id varchar(50),
  issue_version integer,
  title varchar(240),
  coverage_start date,
  coverage_end date,
  cutoff_at timestamptz,
  audience varchar(20),
  sources_count integer,
  issued_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
begin
  if not exists (
    select 1 from public.app_users u
    where u.user_id = v_uid and u.is_active = true and cardinality(u.functional_roles) > 0
  ) then
    raise exception 'Active officer role required.' using errcode = '42501';
  end if;

  return query
  select
    b.issue_uuid,
    b.bulletin_id,
    b.issue_version,
    b.title,
    b.coverage_start,
    b.coverage_end,
    b.cutoff_at,
    b.audience,
    jsonb_array_length(b.source_snapshot)::integer as sources_count,
    b.issued_at
  from public.update_bulletins b
  where b.audience = 'internal'
    and b.superseded_by_issue_uuid is null
  order by b.issued_at desc, b.bulletin_id asc;
end;
$$;

revoke all on function public.eacsc_list_internal_bulletins() from public, anon;
grant execute on function public.eacsc_list_internal_bulletins() to authenticated;

notify pgrst, 'reload schema';
commit;
