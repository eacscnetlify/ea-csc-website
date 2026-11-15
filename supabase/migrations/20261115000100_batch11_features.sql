-- Batch 11: Document folders, document creation with creator auto-assignment,
-- student observer onboarding, role requests & president approval,
-- executive fast-track self-approval, and global council audit history.
begin;
set local lock_timeout = '10s';
set local statement_timeout = '30s';

-- 1. Extend app_users with optional student metadata
alter table public.app_users
  add column if not exists student_id varchar(40),
  add column if not exists degree_program varchar(160);

-- 2. Document Folders
create table if not exists public.document_folders (
  folder_id uuid primary key default gen_random_uuid(),
  name varchar(120) not null,
  description text not null default '',
  created_by uuid not null references public.app_users(user_id),
  created_at timestamptz not null default now(),
  constraint document_folders_name_not_blank check (char_length(btrim(name)) > 0)
);

create unique index if not exists document_folders_name_lower_unique
  on public.document_folders (lower(btrim(name)));

alter table public.document_folders enable row level security;

revoke all privileges on table public.document_folders
  from public, anon, authenticated;
grant select on public.document_folders to authenticated;

drop policy if exists document_folders_select_officers on public.document_folders;
create policy document_folders_select_officers
  on public.document_folders for select to authenticated
  using (
    exists (
      select 1 from public.app_users u
      where u.user_id = auth.uid()
        and u.is_active = true
        and cardinality(u.functional_roles) > 0
    )
  );

alter table public.master_records
  add column if not exists folder_id uuid references public.document_folders(folder_id) on delete set null;

create index if not exists master_records_folder_index
  on public.master_records(folder_id);

-- 3. Role Requests
create table if not exists public.role_requests (
  request_id uuid primary key default gen_random_uuid(),
  applicant_user_id uuid not null references public.app_users(user_id),
  requested_roles text[] not null,
  desired_position varchar(160) not null,
  student_id varchar(40) not null default '',
  degree_program varchar(160) not null default '',
  justification text not null default '',
  status varchar(20) not null default 'pending'
    check (status in ('pending', 'approved', 'declined')),
  reviewed_by uuid references public.app_users(user_id),
  review_note text,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  constraint role_requests_roles_allowed check (
    cardinality(requested_roles) > 0
    and requested_roles <@ array[
      'author',
      'custodian',
      'reviewer',
      'approver',
      'publisher',
      'technical_admin'
    ]::text[]
  ),
  constraint role_requests_position_not_blank check (char_length(btrim(desired_position)) > 0)
);

create index if not exists role_requests_status_idx
  on public.role_requests(status, created_at desc);

alter table public.role_requests enable row level security;

revoke all privileges on table public.role_requests
  from public, anon, authenticated;
grant select on public.role_requests to authenticated;

drop policy if exists role_requests_select_own_or_approver on public.role_requests;
create policy role_requests_select_own_or_approver
  on public.role_requests for select to authenticated
  using (
    applicant_user_id = auth.uid()
    or exists (
      select 1 from public.app_users u
      where u.user_id = auth.uid()
        and u.is_active = true
        and ('approver' = any(u.functional_roles) or 'technical_admin' = any(u.functional_roles))
    )
  );

-- 4. Ensure Observer Profile on Sign-Up / First Sign-In
create or replace function public.eacsc_ensure_observer_profile(
  p_full_name text default null,
  p_student_id text default null,
  p_degree_program text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_email text;
  v_name text;
  v_row public.app_users%rowtype;
begin
  if v_uid is null then
    raise exception 'Authentication required.' using errcode = '42501';
  end if;

  select email into v_email from auth.users where id = v_uid;
  if v_email is null then
    raise exception 'Authenticated user email unavailable.' using errcode = '42501';
  end if;

  select * into v_row from public.app_users where user_id = v_uid;

  if not found then
    v_name := coalesce(nullif(btrim(p_full_name), ''), split_part(v_email, '@', 1));
    insert into public.app_users (
      user_id, email, full_name, council_position, functional_roles,
      is_active, student_id, degree_program
    ) values (
      v_uid, v_email, v_name, 'Student Observer', '{}'::text[],
      true, nullif(btrim(p_student_id), ''), nullif(btrim(p_degree_program), '')
    )
    returning * into v_row;
  else
    if p_student_id is not null or p_degree_program is not null then
      update public.app_users
      set
        student_id = coalesce(nullif(btrim(p_student_id), ''), student_id),
        degree_program = coalesce(nullif(btrim(p_degree_program), ''), degree_program),
        updated_at = now()
      where user_id = v_uid
      returning * into v_row;
    end if;
  end if;

  return jsonb_build_object(
    'user_id', v_row.user_id,
    'email', v_row.email,
    'full_name', v_row.full_name,
    'council_position', v_row.council_position,
    'functional_roles', v_row.functional_roles,
    'is_active', v_row.is_active,
    'student_id', v_row.student_id,
    'degree_program', v_row.degree_program
  );
end;
$$;

revoke all on function public.eacsc_ensure_observer_profile(text, text, text) from public, anon;
grant execute on function public.eacsc_ensure_observer_profile(text, text, text) to authenticated;

-- 5. Folder Management RPCs
create or replace function public.eacsc_list_folders()
returns table (
  folder_id uuid,
  name varchar(120),
  description text,
  created_at timestamptz,
  document_count bigint
)
language plpgsql
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
    f.folder_id,
    f.name,
    f.description,
    f.created_at,
    count(r.record_id)::bigint as document_count
  from public.document_folders f
  left join public.master_records r on r.folder_id = f.folder_id
  group by f.folder_id, f.name, f.description, f.created_at
  order by f.name asc;
end;
$$;

revoke all on function public.eacsc_list_folders() from public, anon;
grant execute on function public.eacsc_list_folders() to authenticated;

create or replace function public.eacsc_create_folder(
  p_name text,
  p_description text default ''
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_clean_name text := btrim(coalesce(p_name, ''));
  v_folder_id uuid;
begin
  if not exists (
    select 1 from public.app_users u
    where u.user_id = v_uid and u.is_active = true and cardinality(u.functional_roles) > 0
  ) then
    raise exception 'Active officer role required.' using errcode = '42501';
  end if;

  if char_length(v_clean_name) = 0 or char_length(v_clean_name) > 120 then
    raise exception 'Folder name must be between 1 and 120 characters.' using errcode = '22023';
  end if;

  insert into public.document_folders (name, description, created_by)
  values (v_clean_name, btrim(coalesce(p_description, '')), v_uid)
  returning folder_id into v_folder_id;

  insert into public.audit_events (
    actor_user_id, action_type, action_summary, new_state
  ) values (
    v_uid, 'folder.created', format('Created document folder "%s".', v_clean_name),
    jsonb_build_object('folder_id', v_folder_id, 'name', v_clean_name)
  );

  return jsonb_build_object('folder_id', v_folder_id, 'name', v_clean_name);
end;
$$;

revoke all on function public.eacsc_create_folder(text, text) from public, anon;
grant execute on function public.eacsc_create_folder(text, text) to authenticated;

create or replace function public.eacsc_assign_document_folder(
  p_record_id text,
  p_folder_id uuid default null
)
returns jsonb
language plpgsql
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

  update public.master_records
  set folder_id = p_folder_id,
      updated_at = now()
  where record_id = p_record_id;

  if not found then
    raise exception 'Document not found.' using errcode = 'P0002';
  end if;

  insert into public.audit_events (
    record_id, actor_user_id, action_type, action_summary, new_state
  ) values (
    p_record_id, v_uid, 'document.folder_updated',
    case when p_folder_id is null then 'Removed document from folder.' else 'Moved document to folder.' end,
    jsonb_build_object('folder_id', p_folder_id)
  );

  return jsonb_build_object('record_id', p_record_id, 'folder_id', p_folder_id);
end;
$$;

revoke all on function public.eacsc_assign_document_folder(text, uuid) from public, anon;
grant execute on function public.eacsc_assign_document_folder(text, uuid) to authenticated;

-- 6. Create Document RPC (auto-assigns creator as both author & custodian)
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

  -- Auto-assign creator as both author & custodian so they can upload and submit immediately
  insert into public.record_assignments (
    record_id, user_id, assignment_function, assigned_by, is_active
  ) values
    (v_record_id, v_uid, 'author', v_uid, true),
    (v_record_id, v_uid, 'custodian', v_uid, true)
  on conflict (record_id, user_id, assignment_function) do update
    set is_active = true, assigned_by = v_uid;

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

revoke all on function public.eacsc_create_document(text, text, text, text, text, uuid) from public, anon;
grant execute on function public.eacsc_create_document(text, text, text, text, text, uuid) to authenticated;

-- 7. Role Request & President Approval RPCs
create or replace function public.eacsc_submit_role_request(
  p_desired_position text,
  p_requested_roles text[],
  p_student_id text default '',
  p_degree_program text default '',
  p_justification text default ''
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_req_id uuid;
begin
  if v_uid is null then
    raise exception 'Authentication required.' using errcode = '42501';
  end if;

  perform public.eacsc_ensure_observer_profile(null, p_student_id, p_degree_program);

  insert into public.role_requests (
    applicant_user_id, requested_roles, desired_position,
    student_id, degree_program, justification
  ) values (
    v_uid, p_requested_roles, btrim(p_desired_position),
    btrim(coalesce(p_student_id, '')),
    btrim(coalesce(p_degree_program, '')),
    btrim(coalesce(p_justification, ''))
  )
  returning request_id into v_req_id;

  insert into public.audit_events (
    actor_user_id, action_type, action_summary, new_state
  ) values (
    v_uid, 'role_request.submitted',
    format('Submitted officer role request for %s.', btrim(p_desired_position)),
    jsonb_build_object('request_id', v_req_id, 'requested_roles', p_requested_roles, 'desired_position', btrim(p_desired_position))
  );

  return jsonb_build_object('request_id', v_req_id, 'status', 'pending');
end;
$$;

revoke all on function public.eacsc_submit_role_request(text, text[], text, text, text) from public, anon;
grant execute on function public.eacsc_submit_role_request(text, text[], text, text, text) to authenticated;

create or replace function public.eacsc_list_role_requests()
returns table (
  request_id uuid,
  applicant_user_id uuid,
  applicant_name varchar(160),
  applicant_email varchar(320),
  desired_position varchar(160),
  requested_roles text[],
  student_id varchar(40),
  degree_program varchar(160),
  justification text,
  status varchar(20),
  review_note text,
  reviewed_at timestamptz,
  created_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_is_approver boolean;
begin
  if v_uid is null then
    raise exception 'Authentication required.' using errcode = '42501';
  end if;

  select exists (
    select 1 from public.app_users u
    where u.user_id = v_uid and u.is_active = true
      and ('approver' = any(u.functional_roles) or 'technical_admin' = any(u.functional_roles))
  ) into v_is_approver;

  return query
  select
    r.request_id,
    r.applicant_user_id,
    u.full_name as applicant_name,
    u.email as applicant_email,
    r.desired_position,
    r.requested_roles,
    r.student_id,
    r.degree_program,
    r.justification,
    r.status,
    r.review_note,
    r.reviewed_at,
    r.created_at
  from public.role_requests r
  join public.app_users u on u.user_id = r.applicant_user_id
  where v_is_approver or r.applicant_user_id = v_uid
  order by
    case when r.status = 'pending' then 0 else 1 end,
    r.created_at desc;
end;
$$;

revoke all on function public.eacsc_list_role_requests() from public, anon;
grant execute on function public.eacsc_list_role_requests() to authenticated;

create or replace function public.eacsc_decide_role_request(
  p_request_id uuid,
  p_decision text,
  p_review_note text default ''
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_req public.role_requests%rowtype;
  v_merged_roles text[];
begin
  if not exists (
    select 1 from public.app_users u
    where u.user_id = v_uid and u.is_active = true and 'approver' = any(u.functional_roles)
  ) then
    raise exception 'Only the Council President (Approver) can approve or decline role requests.' using errcode = '42501';
  end if;

  if p_decision not in ('approved', 'declined') then
    raise exception 'Decision must be approved or declined.' using errcode = '22023';
  end if;

  select * into v_req from public.role_requests where request_id = p_request_id for update;
  if not found then
    raise exception 'Role request not found.' using errcode = 'P0002';
  end if;

  if v_req.status <> 'pending' then
    raise exception 'This role request has already been decided.' using errcode = 'P0001';
  end if;

  update public.role_requests
  set status = p_decision,
      reviewed_by = v_uid,
      review_note = nullif(btrim(coalesce(p_review_note, '')), ''),
      reviewed_at = now()
  where request_id = p_request_id;

  if p_decision = 'approved' then
    select array(
      select distinct elem
      from unnest(coalesce(u.functional_roles, '{}'::text[]) || v_req.requested_roles) as elem
    ) into v_merged_roles
    from public.app_users u
    where u.user_id = v_req.applicant_user_id;

    update public.app_users
    set functional_roles = v_merged_roles,
        council_position = v_req.desired_position,
        is_active = true,
        revision_counter = revision_counter + 1,
        updated_at = now()
    where user_id = v_req.applicant_user_id;
  end if;

  insert into public.audit_events (
    actor_user_id, action_type, action_summary, new_state
  ) values (
    v_uid,
    format('role_request.%s', p_decision),
    format('%s role application for %s.', initcap(p_decision), v_req.desired_position),
    jsonb_build_object(
      'request_id', p_request_id,
      'applicant_user_id', v_req.applicant_user_id,
      'requested_roles', v_req.requested_roles,
      'decision', p_decision
    )
  );

  return jsonb_build_object('request_id', p_request_id, 'status', p_decision);
end;
$$;

revoke all on function public.eacsc_decide_role_request(uuid, text, text) from public, anon;
grant execute on function public.eacsc_decide_role_request(uuid, text, text) to authenticated;

-- 8. Executive Fast-Track Self-Approval for President / Executive Secretary
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
  if not found or not (v_user.functional_roles && array['approver', 'custodian']::text[]) then
    raise exception 'Executive Fast-Track Self-Approval is restricted to the Council President and Executive Secretary.' using errcode = '42501';
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

  update public.record_versions
  set state = 'Approved',
      approval_recorded_by = v_uid,
      approved_at = now(),
      approval_basis = btrim(p_rationale),
      approval_evidence_reference = format('Executive Fast-Track Self-Approval (%s)', v_user.full_name),
      revision_counter = v_new_rev,
      updated_at = now()
  where version_id = p_version_id;

  insert into public.audit_events (
    event_uuid, record_id, version_id, actor_user_id, action_type, action_summary,
    previous_revision, new_revision, previous_state, new_state, request_id
  ) values (
    v_audit_uuid, v_ver.record_id, v_ver.version_id, v_uid,
    'version.executive_self_approved',
    format('Executive fast-track approval by %s: %s', v_user.full_name, btrim(p_rationale)),
    v_ver.revision_counter, v_new_rev,
    jsonb_build_object('state', v_ver.state),
    jsonb_build_object('state', 'Approved', 'executive_fast_track', true),
    p_request_id
  );

  insert into public.version_verifications (
    verification_id, record_id, version_id, actor_user_id, request_id,
    verified_revision, approved_revision, checklist, is_provisional,
    approval_kind, approving_position, approval_date, approval_basis,
    approval_evidence_reference, audit_event_uuid
  ) values (
    gen_random_uuid(), v_ver.record_id, v_ver.version_id, v_uid, p_request_id,
    v_ver.revision_counter, v_new_rev,
    jsonb_build_object(
      'originating_office_authority', true,
      'classification_verified', true,
      'predecessor_continuity', true,
      'attachment_integrity', true,
      'change_rationale', true,
      'conflict_of_interest_clear', true,
      'executive_fast_track', true
    ),
    false,
    'substantive_approval',
    coalesce(v_user.council_position, 'Executive Officer'),
    (now() at time zone 'Asia/Manila')::date,
    btrim(p_rationale),
    format('Executive Fast-Track Self-Approval (%s)', v_user.full_name),
    v_audit_uuid
  );

  return jsonb_build_object(
    'version_id', p_version_id,
    'record_id', v_ver.record_id,
    'state', 'Approved',
    'revision_counter', v_new_rev
  );
end;
$$;

revoke all on function public.eacsc_executive_self_approve(uuid, integer, text, uuid) from public, anon;
grant execute on function public.eacsc_executive_self_approve(uuid, integer, text, uuid) to authenticated;

-- 9. Global Council Activity & Audit History
create or replace function public.eacsc_list_global_audit_history(p_limit integer default 100)
returns table (
  event_id bigint,
  record_id varchar(50),
  record_title varchar(240),
  version_id uuid,
  actor_user_id uuid,
  actor_name varchar(160),
  actor_position varchar(160),
  action_type varchar(80),
  action_summary text,
  server_occurred_at timestamptz
)
language plpgsql
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
    e.event_id,
    e.record_id,
    r.title as record_title,
    e.version_id,
    e.actor_user_id,
    u.full_name as actor_name,
    u.council_position as actor_position,
    e.action_type,
    e.action_summary,
    e.server_occurred_at
  from public.audit_events e
  join public.app_users u on u.user_id = e.actor_user_id
  left join public.master_records r on r.record_id = e.record_id
  order by e.server_occurred_at desc, e.event_id desc
  limit least(greatest(coalesce(p_limit, 100), 1), 300);
end;
$$;

revoke all on function public.eacsc_list_global_audit_history(integer) from public, anon;
grant execute on function public.eacsc_list_global_audit_history(integer) to authenticated;

notify pgrst, 'reload schema';
commit;
