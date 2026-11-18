-- Batch 19: Auto-publish internal/restricted on approval, fix internal bulletins RPC,
-- filter internal bulletin candidates strictly to access_class='internal', and add bulletin withdrawal.
begin;
set local lock_timeout = '10s';
set local statement_timeout = '30s';

-- 1. Helper: auto-publish Approved internal/restricted versions to record_releases (audience = 'internal')
create or replace function eacsc_private.auto_publish_internal_release(
  p_version_id uuid,
  p_actor_user_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ver public.record_versions%rowtype;
  v_master public.master_records%rowtype;
  v_now timestamptz;
begin
  select * into v_ver from public.record_versions where version_id = p_version_id;
  if not found or v_ver.state <> 'Approved' then
    return;
  end if;

  select * into v_master from public.master_records where record_id = v_ver.record_id;
  if not found or v_master.access_class not in ('internal', 'restricted') then
    return;
  end if;

  if exists (
    select 1 from public.record_releases r
    where r.record_id = v_ver.record_id
      and r.version_id = v_ver.version_id
      and r.withdrawn_at is null
  ) then
    return;
  end if;

  v_now := greatest(clock_timestamp(), v_ver.updated_at, v_master.updated_at);

  insert into public.record_releases (
    release_id,
    record_id,
    version_id,
    audience,
    public_title,
    public_category,
    authorization_basis,
    authorization_reference,
    released_by,
    released_at,
    effective_from,
    release_original_filename,
    release_mime_type,
    release_file_size_bytes,
    release_sha256
  ) values (
    gen_random_uuid(),
    v_master.record_id,
    v_ver.version_id,
    'internal',
    v_master.title,
    v_master.category,
    coalesce(nullif(btrim(v_ver.approval_basis), ''), 'Presidential Approval — Auto-published to Internal Library'),
    coalesce(nullif(btrim(v_ver.approval_evidence_reference), ''), 'AUTO-INTERNAL-' || v_master.record_id),
    coalesce(p_actor_user_id, v_ver.approval_recorded_by, (select user_id from public.app_users where is_active = true limit 1)),
    v_now,
    v_now,
    v_ver.original_filename,
    v_ver.mime_type,
    v_ver.file_size_bytes,
    v_ver.sha256
  );
end;
$$;

revoke all on function eacsc_private.auto_publish_internal_release(uuid, uuid) from public, anon, authenticated, service_role;

-- 2. Update eacsc_approve_version & eacsc_executive_self_approve to auto-publish internal/restricted
create or replace function public.eacsc_approve_version(
  p_version_id uuid,
  p_expected_revision integer,
  p_checklist jsonb,
  p_approval_kind text,
  p_approving_position text,
  p_approval_date date,
  p_approval_basis text,
  p_approval_evidence_reference text,
  p_approval_not_required_reason text,
  p_is_provisional boolean,
  p_provisional_uncertainty text,
  p_provisional_update_owner text,
  p_request_id uuid
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_state text;
  v_passed timestamptz;
  v_res jsonb;
begin
  if p_approval_kind = 'substantive_approval' then
    select state, reviewer_passed_at into v_state, v_passed
    from public.record_versions where version_id = p_version_id;
    if found and v_state = 'For Review' and v_passed is null then
      raise exception 'A Reviewer must pass this draft before the President can grant Substantive Approval.' using errcode = '42501';
    end if;
  end if;

  v_res := eacsc_private.approve_version(
    p_version_id, p_expected_revision, p_checklist, p_approval_kind,
    p_approving_position, p_approval_date, p_approval_basis,
    p_approval_evidence_reference, p_approval_not_required_reason,
    p_is_provisional, p_provisional_uncertainty,
    p_provisional_update_owner, p_request_id
  );

  perform eacsc_private.auto_publish_internal_release(p_version_id, auth.uid());

  return v_res;
end;
$$;

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

  perform eacsc_private.auto_publish_internal_release(p_version_id, v_uid);

  return jsonb_build_object(
    'version_id', p_version_id,
    'state', 'Approved',
    'revision', v_new_rev
  );
end;
$$;

-- Backfill already-approved internal/restricted versions that don't yet have an active release
do $$
declare
  v_rec record;
begin
  for v_rec in
    select v.version_id, v.approval_recorded_by as actor_id
    from public.record_versions v
    join public.master_records m on m.record_id = v.record_id
    where v.state = 'Approved'
      and m.access_class in ('internal', 'restricted')
      and m.document_type <> 'Update bulletin'
      and not exists (
        select 1 from public.record_releases r
        where r.record_id = v.record_id
          and r.version_id = v.version_id
          and r.withdrawn_at is null
      )
  loop
    perform eacsc_private.auto_publish_internal_release(v_rec.version_id, v_rec.actor_id);
  end loop;
end;
$$;

-- 3. Fix eacsc_list_internal_bulletins (use issue_status = 'Issued' and withdrawn_at is null)
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
    b.audience::varchar(20),
    jsonb_array_length(b.source_snapshot)::integer as sources_count,
    b.issued_at
  from public.update_bulletins b
  where b.audience = 'internal'
    and b.issue_status = 'Issued'
    and b.withdrawn_at is null
  order by b.issued_at desc, b.bulletin_id asc;
end;
$$;

revoke all on function public.eacsc_list_internal_bulletins() from public, anon;
grant execute on function public.eacsc_list_internal_bulletins() to authenticated;

-- 4. Filter eacsc_private.list_bulletin_candidates strictly by audience:
--    'public' -> access_class = 'public' only
--    'internal' -> access_class = 'internal' only (never public, never restricted, never bulletin archives)
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
      and (r.released_at at time zone 'Asia/Manila')::date >= p_coverage_start
      and (r.effective_until is null or r.effective_until > p_cutoff_at)
    order by r.released_at desc, m.record_id asc;
  end if;
end;
$$;

-- 5. Custodian Bulletin Management: list issued bulletins & withdraw/remove a posted bulletin
create or replace function public.eacsc_list_issued_bulletins()
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
  v_roles text[];
begin
  select functional_roles into v_roles
  from public.app_users
  where user_id = v_uid and is_active = true;

  if not found or not (v_roles && array['custodian', 'publisher']::text[]) then
    raise exception 'Custodian or Publisher role required.' using errcode = '42501';
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
    b.audience::varchar(20),
    jsonb_array_length(b.source_snapshot)::integer as sources_count,
    b.issued_at
  from public.update_bulletins b
  where b.issue_status = 'Issued'
    and b.withdrawn_at is null
  order by b.issued_at desc, b.bulletin_id asc;
end;
$$;

revoke all on function public.eacsc_list_issued_bulletins() from public, anon;
grant execute on function public.eacsc_list_issued_bulletins() to authenticated;

create or replace function public.eacsc_withdraw_bulletin(
  p_bulletin_id text,
  p_issue_version integer,
  p_reason text default 'Withdrawn by Custodian'
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_roles text[];
  v_bul public.update_bulletins%rowtype;
  v_reason text := coalesce(nullif(btrim(p_reason), ''), 'Withdrawn by Custodian');
  v_now timestamptz;
begin
  select functional_roles into v_roles
  from public.app_users
  where user_id = v_uid and is_active = true;

  if not found or not ('custodian' = any(v_roles)) then
    raise exception 'Only an active Custodian (Treasurer / Secretary) can withdraw an issued bulletin.' using errcode = '42501';
  end if;

  select * into v_bul
  from public.update_bulletins
  where bulletin_id = p_bulletin_id
    and issue_version = p_issue_version
  for update;

  if not found then
    raise exception 'Bulletin issue not found.' using errcode = 'P0002';
  end if;

  if v_bul.issue_status = 'Withdrawn' or v_bul.withdrawn_at is not null then
    raise exception 'This bulletin has already been withdrawn.' using errcode = '22023';
  end if;

  v_now := greatest(clock_timestamp(), v_bul.issued_at, v_bul.updated_at);

  update public.update_bulletins
  set issue_status = 'Withdrawn',
      withdrawn_by = v_uid,
      withdrawn_at = v_now,
      withdrawal_reason = v_reason,
      revision_counter = revision_counter + 1,
      updated_at = v_now
  where bulletin_id = p_bulletin_id
    and issue_version = p_issue_version;

  -- Also withdraw any archive release pointer if present
  if v_bul.archive_record_id is not null then
    update public.record_releases
    set withdrawn_at = greatest(v_now, released_at),
        withdrawn_by = v_uid,
        withdrawal_reason = v_reason
    where record_id = v_bul.archive_record_id
      and version_id = v_bul.archive_version_id
      and withdrawn_at is null;

    update public.master_records
    set current_public_release_id = null,
        updated_at = greatest(v_now, updated_at)
    where record_id = v_bul.archive_record_id
      and current_public_release_id is not null;
  end if;

  return jsonb_build_object(
    'bulletin_id', p_bulletin_id,
    'issue_version', p_issue_version,
    'issue_status', 'Withdrawn',
    'withdrawn_at', v_now
  );
end;
$$;

revoke all on function public.eacsc_withdraw_bulletin(text, integer, text) from public, anon;
grant execute on function public.eacsc_withdraw_bulletin(text, integer, text) to authenticated;

commit;
