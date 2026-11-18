-- Batch 17: Fast-Track jsonb fix, Restricted Exemptions (Auditor/PRO/Treasurer),
-- Custodian-only Bulletin Compiler, and Google Drive external_url attachment support.
begin;
set local lock_timeout = '10s';
set local statement_timeout = '30s';

-- 1. Fix Fast-Track Self-Approval jsonb column types (previous_state / new_state)
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
    v_ver.revision_counter, v_new_rev, to_jsonb(v_ver.state::text), to_jsonb('Approved'::text),
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

-- 2. Exempt Auditor (reviewer), PRO (publisher), President (approver), Secretary, and Treasurer
--    from Restricted document lockout so governance workflow is never blocked.
create or replace function eacsc_private.can_read_record(
  requested_record_id text,
  requested_version_state text default null,
  requested_function text default null
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select
    (select auth.uid()) is not null
    and (select auth.jwt() ->> 'is_anonymous') = 'false'
    and exists (
      select 1
      from public.app_users as officer
      join public.master_records as master
        on master.record_id = requested_record_id
      where officer.user_id = (select auth.uid())
        and officer.is_active
        and cardinality(officer.functional_roles) > 0
        and (
          -- President (approver), Auditor/Reviewer (reviewer), PRO/Publisher (publisher),
          -- Technical Admin, Secretary, and Treasurer can read Restricted documents
          officer.functional_roles && array['approver', 'reviewer', 'publisher', 'technical_admin']::text[]
          or coalesce(officer.council_position, '') in ('President', 'Secretary', 'Treasurer', 'Auditor', 'Public Information Officer')
          -- Public or Internal documents are visible to all active council officers
          or master.access_class in ('public', 'internal')
          -- Other officers can view Restricted documents only if explicitly assigned
          or exists (
            select 1 from public.record_assignments a
            where a.record_id = requested_record_id
              and a.user_id = officer.user_id
              and a.is_active
              and a.allow_restricted
          )
        )
        and (
          requested_function is null
          or requested_function = any(officer.functional_roles)
        )
        and (
          requested_version_state is null
          or not (officer.functional_roles = array['author']::text[])
          or requested_version_state = 'Draft'
        )
    );
$function$;

-- Also ensure create_document & submit_version_for_review grant allow_restricted = true
-- to Reviewer/Approver/Publisher/Treasurer on Restricted records so RPCs pass seamlessly.
create or replace function public.eacsc_create_document(
  p_title text,
  p_category text,
  p_document_type text default 'Resolution',
  p_access_class text default 'public',
  p_summary text default '',
  p_folder_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_user public.app_users%rowtype;
  v_cat_code text;
  v_year text := to_char(now() at time zone 'Asia/Manila', 'YYYY');
  v_next_seq integer;
  v_record_id text;
  v_other record;
begin
  select * into v_user from public.app_users where user_id = v_uid and is_active = true;
  if not found or not (v_user.functional_roles && array['author', 'custodian', 'approver', 'technical_admin']::text[]) then
    raise exception 'You must hold Author, Custodian, Approver, or Admin role to create documents.' using errcode = '42501';
  end if;

  v_cat_code := case p_category
    when 'Governance and legislation' then 'GOV'
    when 'Secretariat and proceedings' then 'SEC'
    when 'Activities and CBO records' then 'ACT'
    when 'Financial archives' then 'FIN'
    when 'Forms and official information' then 'FRM'
    when 'Turnover and continuity' then 'TRN'
    else null
  end;

  if v_cat_code is null then
    raise exception 'Invalid document category.' using errcode = '22023';
  end if;

  if p_access_class not in ('public', 'internal', 'restricted') then
    raise exception 'Invalid access classification.' using errcode = '22023';
  end if;

  select coalesce(max(substring(record_id from '[0-9]{4}$')::integer), 0) + 1
  into v_next_seq
  from public.master_records
  where record_id like format('EACSC-%s-%s-%%', v_year, v_cat_code);

  v_record_id := format('EACSC-%s-%s-%s', v_year, v_cat_code, lpad(v_next_seq::text, 4, '0'));

  insert into public.master_records (
    record_id, title, summary, category, document_type,
    originating_office, custodian_position, access_class,
    record_date, folder_id
  ) values (
    v_record_id,
    btrim(p_title),
    btrim(coalesce(p_summary, '')),
    p_category,
    coalesce(nullif(btrim(p_document_type), ''), 'Official Document'),
    coalesce(v_user.council_position, 'EA-CSC Officer'),
    coalesce(v_user.council_position, 'EA-CSC Custodian'),
    p_access_class,
    (now() at time zone 'Asia/Manila')::date,
    p_folder_id
  );

  insert into public.record_assignments (
    record_id, user_id, assignment_function, assigned_by, is_active, allow_restricted
  ) values (
    v_record_id, v_uid, 'author', v_uid, true, true
  )
  on conflict (record_id, user_id, assignment_function) do update
    set is_active = true, allow_restricted = true, assigned_by = v_uid;

  if 'custodian' = any(v_user.functional_roles) then
    insert into public.record_assignments (
      record_id, user_id, assignment_function, assigned_by, is_active, allow_restricted
    ) values (
      v_record_id, v_uid, 'custodian', v_uid, true, true
    )
    on conflict (record_id, user_id, assignment_function) do update
      set is_active = true, allow_restricted = true, assigned_by = v_uid;
  end if;

  -- Exempted oversight roles always get access (including restricted)
  for v_other in
    select user_id from public.app_users
    where is_active = true and 'approver' = any(functional_roles) and user_id <> v_uid
  loop
    insert into public.record_assignments (
      record_id, user_id, assignment_function, assigned_by, is_active, allow_restricted
    ) values (
      v_record_id, v_other.user_id, 'approver', v_uid, true, true
    )
    on conflict (record_id, user_id, assignment_function) do update
      set is_active = true, allow_restricted = true;
  end loop;

  for v_other in
    select user_id from public.app_users
    where is_active = true and 'reviewer' = any(functional_roles) and user_id <> v_uid
  loop
    insert into public.record_assignments (
      record_id, user_id, assignment_function, assigned_by, is_active, allow_restricted
    ) values (
      v_record_id, v_other.user_id, 'reviewer', v_uid, true, true
    )
    on conflict (record_id, user_id, assignment_function) do update
      set is_active = true, allow_restricted = true;
  end loop;

  for v_other in
    select user_id from public.app_users
    where is_active = true and 'publisher' = any(functional_roles)
  loop
    insert into public.record_assignments (
      record_id, user_id, assignment_function, assigned_by, is_active, allow_restricted
    ) values (
      v_record_id, v_other.user_id, 'publisher', v_uid, true, true
    )
    on conflict (record_id, user_id, assignment_function) do update
      set is_active = true, allow_restricted = true;
  end loop;

  insert into public.audit_events (
    record_id, actor_user_id, action_type, action_summary, new_state
  ) values (
    v_record_id, v_uid, 'document.created',
    format('Created document "%s" (%s).', btrim(p_title), v_record_id),
    jsonb_build_object(
      'record_id', v_record_id,
      'title', btrim(p_title),
      'category', p_category,
      'access_class', p_access_class,
      'folder_id', p_folder_id
    )
  );

  return jsonb_build_object(
    'record_id', v_record_id,
    'title', btrim(p_title),
    'category', p_category,
    'access_class', p_access_class,
    'folder_id', p_folder_id
  );
end;
$$;

-- 3. Restrict Bulletin Compiler (list_bulletin_candidates & issue_bulletin) to Custodian role ONLY
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

  select u.functional_roles into roles
  from public.app_users u
  where u.user_id = actor_id and u.is_active;

  if not found or not ('custodian' = any(roles)) then
    raise exception using errcode = '42501', message = 'Only officers holding the Custodian role can access the Bulletin Compiler.';
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
      v.change_summary::text as summary_note
    from public.record_releases r
    join public.master_records m on m.record_id = r.record_id
    join public.record_versions v on v.record_id = r.record_id and v.version_id = r.version_id
    where m.access_class <> 'restricted'
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

create or replace function public.eacsc_issue_bulletin(
  p_bulletin_id text,
  p_issue_version integer,
  p_title text,
  p_coverage_start date,
  p_coverage_end date,
  p_cutoff_at timestamptz,
  p_audience text,
  p_source_snapshot jsonb,
  p_pdf_storage_key text,
  p_pdf_size_bytes bigint,
  p_pdf_sha256 text,
  p_publication_reference text,
  p_issuance_request_id uuid,
  p_corrects_issue_uuid uuid default null,
  p_correction_reason text default null
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.app_users u
    where u.user_id = auth.uid() and u.is_active and 'custodian' = any(u.functional_roles)
  ) then
    raise exception 'Only officers holding the Custodian role can issue Update Bulletins.' using errcode = '42501';
  end if;

  return eacsc_private.issue_bulletin(
    p_bulletin_id, p_issue_version, p_title, p_coverage_start,
    p_coverage_end, p_cutoff_at, p_audience, p_source_snapshot,
    p_pdf_storage_key, p_pdf_size_bytes, p_pdf_sha256,
    p_publication_reference, p_issuance_request_id,
    p_corrects_issue_uuid, p_correction_reason
  );
end;
$$;

-- 4. Google Drive external_url support on record_versions + public reader helper
alter table public.record_versions
  add column if not exists external_url text;

grant select (external_url) on public.record_versions to authenticated;

create or replace function public.eacsc_set_version_external_url(
  p_version_id uuid,
  p_external_url text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_clean text := btrim(coalesce(p_external_url, ''));
  v_ver public.record_versions%rowtype;
begin
  if v_uid is null then
    raise exception 'Authentication required.' using errcode = '42501';
  end if;

  if v_clean !~ '^https://(drive\.google\.com|docs\.google\.com)/' then
    raise exception 'Please provide a valid Google Drive or Google Docs HTTPS link.' using errcode = '22023';
  end if;

  select * into v_ver from public.record_versions where version_id = p_version_id for update;
  if not found then
    raise exception 'Version not found.' using errcode = 'P0002';
  end if;

  if v_ver.state <> 'Draft' then
    raise exception 'External links can only be attached while the version is in Draft.' using errcode = '42501';
  end if;

  update public.record_versions
  set external_url = v_clean,
      updated_at = now()
  where version_id = p_version_id;

  return jsonb_build_object('version_id', p_version_id, 'external_url', v_clean);
end;
$$;

revoke all on function public.eacsc_set_version_external_url(uuid, text) from public, anon;
grant execute on function public.eacsc_set_version_external_url(uuid, text) to authenticated;

create or replace function public.eacsc_get_public_external_links()
returns table (
  version_id uuid,
  external_url text
)
language sql
stable
security definer
set search_path = ''
as $$
  select r.version_id, v.external_url
  from public.record_releases r
  join public.record_versions v on v.version_id = r.version_id
  join public.master_records m on m.record_id = r.record_id
  where m.access_class = 'public'
    and r.audience = 'public'
    and r.withdrawn_at is null
    and v.state = 'Approved'
    and v.external_url is not null;
$$;

revoke all on function public.eacsc_get_public_external_links() from public;
grant execute on function public.eacsc_get_public_external_links() to anon, authenticated;

notify pgrst, 'reload schema';
commit;
