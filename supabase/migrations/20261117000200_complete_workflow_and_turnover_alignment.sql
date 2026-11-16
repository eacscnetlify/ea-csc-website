-- Batch 14 & 15 Complete Workflow, Two-Stage Review, Bulletin Exclusion & Turnover Alignment
begin;
set local lock_timeout = '10s';
set local statement_timeout = '30s';

-- 1. Grant column-level SELECT on the new two-stage review columns on record_versions
grant select (reviewer_passed_at, reviewer_passed_by, reviewer_feedback)
  on public.record_versions to authenticated;

-- 2. Auto-assign President/Approvers + Reviewers/Publishers on document creation
--    so workflow queues work without manual DB assignment seeding.
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

  -- Creator gets author (and custodian if held) with allow_restricted = true
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

  -- President / Approvers always get approver visibility (including restricted)
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

  -- For Public/Internal docs, auto-route reviewer & publisher assignments
  if p_access_class in ('public', 'internal') then
    for v_other in
      select user_id from public.app_users
      where is_active = true and 'reviewer' = any(functional_roles) and user_id <> v_uid
    loop
      insert into public.record_assignments (
        record_id, user_id, assignment_function, assigned_by, is_active, allow_restricted
      ) values (
        v_record_id, v_other.user_id, 'reviewer', v_uid, true, false
      )
      on conflict (record_id, user_id, assignment_function) do update
        set is_active = true;
    end loop;

    for v_other in
      select user_id from public.app_users
      where is_active = true and 'publisher' = any(functional_roles)
    loop
      insert into public.record_assignments (
        record_id, user_id, assignment_function, assigned_by, is_active, allow_restricted
      ) values (
        v_record_id, v_other.user_id, 'publisher', v_uid, true, false
      )
      on conflict (record_id, user_id, assignment_function) do update
        set is_active = true;
    end loop;
  end if;

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

-- 3. Manage Restricted Access RPC (creator, custodian, or President can add/remove officers)
create or replace function public.eacsc_set_restricted_access(
  p_record_id text,
  p_user_ids uuid[]
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_user public.app_users%rowtype;
  v_master public.master_records%rowtype;
  v_target_uid uuid;
begin
  select * into v_user from public.app_users where user_id = v_uid and is_active = true;
  if not found or cardinality(v_user.functional_roles) = 0 then
    raise exception 'Active officer role required.' using errcode = '42501';
  end if;

  select * into v_master from public.master_records where record_id = p_record_id;
  if not found then
    raise exception 'Document not found.' using errcode = 'P0002';
  end if;

  if not (
    'approver' = any(v_user.functional_roles)
    or 'technical_admin' = any(v_user.functional_roles)
    or exists (
      select 1 from public.record_assignments a
      where a.record_id = p_record_id and a.user_id = v_uid and a.is_active and a.allow_restricted
    )
  ) then
    raise exception 'Only the document owner or Council President can manage restricted access.' using errcode = '42501';
  end if;

  -- Revoke allow_restricted for non-approvers not in the new list (keep creator/approvers)
  update public.record_assignments a
  set allow_restricted = false
  from public.app_users u
  where a.record_id = p_record_id
    and u.user_id = a.user_id
    and not ('approver' = any(u.functional_roles))
    and a.user_id <> v_uid
    and not (a.user_id = any(coalesce(p_user_ids, '{}'::uuid[])));

  -- Grant allow_restricted + matching functional assignments for chosen officers
  foreach v_target_uid in array coalesce(p_user_ids, '{}'::uuid[])
  loop
    insert into public.record_assignments (
      record_id, user_id, assignment_function, assigned_by, is_active, allow_restricted
    )
    select p_record_id, u.user_id, fn, v_uid, true, true
    from public.app_users u,
         unnest(u.functional_roles) as fn
    where u.user_id = v_target_uid
      and u.is_active = true
      and fn in ('author', 'custodian', 'reviewer', 'approver', 'publisher')
    on conflict (record_id, user_id, assignment_function) do update
      set is_active = true, allow_restricted = true, assigned_by = v_uid;
  end loop;

  insert into public.audit_events (
    record_id, actor_user_id, action_type, action_summary, new_state
  ) values (
    p_record_id, v_uid, 'document.restricted_access_updated',
    format('Updated restricted access list for %s.', p_record_id),
    jsonb_build_object('allowed_user_ids', coalesce(p_user_ids, '{}'::uuid[]))
  );

  return jsonb_build_object('record_id', p_record_id, 'allowed_user_ids', coalesce(p_user_ids, '{}'::uuid[]));
end;
$$;

revoke all on function public.eacsc_set_restricted_access(text, uuid[]) from public, anon;
grant execute on function public.eacsc_set_restricted_access(text, uuid[]) to authenticated;

-- 4. Update submit & return transitions:
--    * Submitting clears reviewer_passed_at/by/feedback and routes reviewers/approvers/publishers.
--    * Returning allows either reviewer OR approver (President) and clears reviewer_passed_at/by/feedback.
create or replace function public.eacsc_submit_version_for_review(
  p_version_id uuid,
  p_expected_revision integer,
  p_request_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_ver public.record_versions%rowtype;
  v_master public.master_records%rowtype;
  v_res jsonb;
  v_other record;
begin
  select * into v_ver from public.record_versions where version_id = p_version_id;
  if found then
    select * into v_master from public.master_records where record_id = v_ver.record_id;
    -- Ensure submitter has author assignment if they hold author/custodian on public/internal
    if v_master.access_class in ('public', 'internal') and exists (
      select 1 from public.app_users u
      where u.user_id = v_uid and u.is_active and (u.functional_roles && array['author', 'custodian']::text[])
    ) then
      insert into public.record_assignments (
        record_id, user_id, assignment_function, assigned_by, is_active, allow_restricted
      ) values (
        v_master.record_id, v_uid, 'author', v_uid, true, false
      )
      on conflict (record_id, user_id, assignment_function) do update set is_active = true;
    end if;

    -- Auto-route reviewers (excluding submitter) and approvers
    for v_other in
      select user_id from public.app_users
      where is_active = true and 'approver' = any(functional_roles) and user_id <> v_uid
    loop
      insert into public.record_assignments (
        record_id, user_id, assignment_function, assigned_by, is_active, allow_restricted
      ) values (
        v_master.record_id, v_other.user_id, 'approver', v_uid, true, true
      )
      on conflict (record_id, user_id, assignment_function) do update
        set is_active = true, allow_restricted = true;
    end loop;

    if v_master.access_class in ('public', 'internal') then
      for v_other in
        select user_id from public.app_users
        where is_active = true and 'reviewer' = any(functional_roles) and user_id <> v_uid
      loop
        insert into public.record_assignments (
          record_id, user_id, assignment_function, assigned_by, is_active, allow_restricted
        ) values (
          v_master.record_id, v_other.user_id, 'reviewer', v_uid, true, false
        )
        on conflict (record_id, user_id, assignment_function) do update set is_active = true;
      end loop;

      for v_other in
        select user_id from public.app_users
        where is_active = true and 'publisher' = any(functional_roles)
      loop
        insert into public.record_assignments (
          record_id, user_id, assignment_function, assigned_by, is_active, allow_restricted
        ) values (
          v_master.record_id, v_other.user_id, 'publisher', v_uid, true, false
        )
        on conflict (record_id, user_id, assignment_function) do update set is_active = true;
      end loop;
    end if;
  end if;

  v_res := eacsc_private.transition_review(
    p_version_id, p_expected_revision, p_request_id, 'submit', null
  );

  -- Reset two-stage review endorsement on fresh submission
  update public.record_versions
  set reviewer_passed_at = null,
      reviewer_passed_by = null,
      reviewer_feedback = null
  where version_id = p_version_id;

  return v_res;
end;
$$;

create or replace function public.eacsc_return_version_for_correction(
  p_version_id uuid,
  p_expected_revision integer,
  p_comment text,
  p_request_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_ver public.record_versions%rowtype;
  v_res jsonb;
begin
  select * into v_ver from public.record_versions where version_id = p_version_id;
  -- Allow President/Approver who returned an endorsed draft to use the return transition
  -- (temporarily ensure reviewer assignment if they hold approver role and are not the author)
  if found and exists (
    select 1 from public.app_users u
    where u.user_id = v_uid and u.is_active and 'approver' = any(u.functional_roles)
  ) and not exists (
    select 1 from public.record_assignments a
    where a.record_id = v_ver.record_id and a.user_id = v_uid and a.assignment_function = 'author' and a.is_active
  ) then
    if exists (
      select 1 from public.app_users u where u.user_id = v_uid and 'reviewer' = any(u.functional_roles)
    ) then
      insert into public.record_assignments (
        record_id, user_id, assignment_function, assigned_by, is_active, allow_restricted
      ) values (
        v_ver.record_id, v_uid, 'reviewer', v_uid, true, true
      )
      on conflict (record_id, user_id, assignment_function) do update
        set is_active = true, allow_restricted = true;
    end if;
  end if;

  v_res := eacsc_private.transition_review(
    p_version_id, p_expected_revision, p_request_id, 'return', p_comment
  );

  -- Returning to Draft always clears prior reviewer endorsement so it must re-pass Reviewer
  update public.record_versions
  set reviewer_passed_at = null,
      reviewer_passed_by = null,
      reviewer_feedback = null
  where version_id = p_version_id;

  return v_res;
end;
$$;

-- 5. Tighten eacsc_reviewer_pass_version with segregation of duties
create or replace function public.eacsc_reviewer_pass_version(
  p_version_id uuid,
  p_expected_revision integer,
  p_feedback text default ''
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
  v_parent_id text;
begin
  select * into v_user from public.app_users where user_id = v_uid and is_active = true;
  if not found or not ('reviewer' = any(v_user.functional_roles)) then
    raise exception 'Only an active Reviewer can pass a draft to the President.' using errcode = '42501';
  end if;

  select * into v_ver from public.record_versions where version_id = p_version_id for update;
  if not found then
    raise exception 'Document version not found.' using errcode = 'P0002';
  end if;

  if v_ver.revision_counter <> p_expected_revision or v_ver.state <> 'For Review' then
    raise exception 'Version changed. Reload and try again.' using errcode = 'PT409';
  end if;

  if v_ver.reviewer_passed_at is not null then
    raise exception 'This draft has already been endorsed by a Reviewer.' using errcode = 'PT409';
  end if;

  v_parent_id := v_ver.record_id;

  -- Segregation of duties: author of this record cannot self-pass as Reviewer
  if exists (
    select 1 from public.record_assignments a
    where a.record_id = v_parent_id and a.user_id = v_uid and a.assignment_function = 'author' and a.is_active
  ) then
    raise exception 'Authors cannot endorse their own document. Another Reviewer must review it first.' using errcode = '42501';
  end if;

  update public.record_versions
  set reviewer_passed_at = now(),
      reviewer_passed_by = v_uid,
      reviewer_feedback = nullif(btrim(coalesce(p_feedback, '')), ''),
      revision_counter = revision_counter + 1,
      updated_at = now()
  where version_id = p_version_id;

  insert into public.audit_events (
    record_id, version_id, actor_user_id, action_type, action_summary, new_state
  ) values (
    v_parent_id, p_version_id, v_uid, 'version.reviewer_passed',
    format('Reviewer %s endorsed draft version %s and passed it to the President.', v_user.full_name, v_ver.version_number),
    jsonb_build_object(
      'version_id', p_version_id,
      'reviewer_passed_by', v_uid,
      'feedback', btrim(coalesce(p_feedback, ''))
    )
  );

  return jsonb_build_object(
    'version_id', p_version_id,
    'state', 'For Review',
    'reviewer_passed', true
  );
end;
$$;

-- 6. Enforce two-stage gate on eacsc_approve_version (Substantive Approval requires Reviewer Pass)
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
begin
  if p_approval_kind = 'substantive_approval' then
    select state, reviewer_passed_at into v_state, v_passed
    from public.record_versions where version_id = p_version_id;
    if found and v_state = 'For Review' and v_passed is null then
      raise exception 'A Reviewer must pass this draft before the President can grant Substantive Approval.' using errcode = '42501';
    end if;
  end if;

  return eacsc_private.approve_version(
    p_version_id, p_expected_revision, p_checklist, p_approval_kind,
    p_approving_position, p_approval_date, p_approval_basis,
    p_approval_evidence_reference, p_approval_not_required_reason,
    p_is_provisional, p_provisional_uncertainty,
    p_provisional_update_owner, p_request_id
  );
end;
$$;

-- 7. Tighten Executive Fast-Track Self-Approval to President & Secretary positions only
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
    v_ver.revision_counter, v_new_rev, v_ver.state, 'Approved',
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

-- 8. Tighten Role Requests: prevent duplicate pending requests & restrict approval to President/Admin
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

  if exists (
    select 1 from public.role_requests
    where applicant_user_id = v_uid and status = 'pending'
  ) then
    raise exception 'You already have a pending role application awaiting President review.' using errcode = 'PT409';
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
    where u.user_id = v_uid and u.is_active = true
      and ('approver' = any(u.functional_roles) or 'technical_admin' = any(u.functional_roles))
  ) then
    raise exception 'Only the Council President or Technical Administrator can approve or decline role requests.' using errcode = '42501';
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

-- 9. Exclude Restricted documents from Bulletin Compiler candidates
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

  if not found or not (roles && array['custodian', 'publisher', 'approver']::text[]) then
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

-- 10. Simplified One-Click "Accept & Acknowledge Package" for Incoming Officers
create or replace function public.eacsc_complete_turnover_acknowledgment(
  p_package_id uuid,
  p_notes text default ''
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_pkg public.turnover_packages%rowtype;
  v_ack public.turnover_acknowledgments%rowtype;
begin
  if v_uid is null then
    raise exception 'Authentication required.' using errcode = '42501';
  end if;

  select * into v_pkg from public.turnover_packages where package_id = p_package_id for update;
  if not found then
    raise exception 'Turnover package not found.' using errcode = 'P0002';
  end if;

  if v_pkg.incoming_officer_id <> v_uid then
    raise exception 'Only the designated incoming officer can accept and acknowledge this package.' using errcode = '42501';
  end if;

  if v_pkg.access_transferred_at is null then
    raise exception 'Administrative access transfer must be executed before acknowledgment.' using errcode = '55000';
  end if;

  select * into v_ack from public.turnover_acknowledgments where package_id = p_package_id and incoming_officer_id = v_uid;
  if not found then
    insert into public.turnover_acknowledgments (
      package_id, incoming_officer_id, confirmation_notes, acknowledged_at
    ) values (
      p_package_id, v_uid, nullif(btrim(coalesce(p_notes, '')), ''), now()
    )
    returning * into v_ack;
  end if;

  -- Ensure incoming officer is active and outgoing officer is retired/inactive
  update public.app_users
  set is_active = true, updated_at = now()
  where user_id = v_uid;

  if v_pkg.outgoing_officer_id is not null and v_pkg.outgoing_officer_id <> v_uid then
    update public.app_users
    set is_active = false, updated_at = now()
    where user_id = v_pkg.outgoing_officer_id;
  end if;

  insert into public.audit_events (
    actor_user_id, action_type, action_summary, new_state
  ) values (
    v_uid, 'turnover.completed',
    format('Incoming officer accepted and acknowledged turnover package %s (%s). Handover marked Done.', p_package_id, v_pkg.position_title),
    jsonb_build_object('package_id', p_package_id, 'incoming_officer_id', v_uid, 'outgoing_officer_id', v_pkg.outgoing_officer_id)
  );

  return jsonb_build_object(
    'package_id', p_package_id,
    'acknowledged_at', v_ack.acknowledged_at,
    'completed', true
  );
end;
$$;

revoke all on function public.eacsc_complete_turnover_acknowledgment(uuid, text) from public, anon;
grant execute on function public.eacsc_complete_turnover_acknowledgment(uuid, text) to authenticated;

notify pgrst, 'reload schema';
commit;
