-- Batch 14 & 15: Unified Officer Operations & Phased Turnover Handover
begin;
set local lock_timeout = '10s';
set local statement_timeout = '30s';

-- 1. Document Visibility & Segregation of Duties
-- Public and Internal documents are readable by any active officer.
-- Restricted documents are readable by creator, explicit assignees, and ALWAYS the President/Approver.
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
          -- President / Approvers can read ALL records including Restricted
          'approver' = any(officer.functional_roles)
          -- Public or Internal documents are visible to all active council officers
          or master.access_class in ('public', 'internal')
          -- Restricted documents are visible if explicitly assigned with allow_restricted = true
          or exists (
            select 1 from public.record_assignments a
            where a.record_id = requested_record_id
              and a.user_id = officer.user_id
              and a.is_active
              and a.allow_restricted
          )
        )
        and (
          -- If a specific function is requested, ensure officer has it
          requested_function is null
          or requested_function = any(officer.functional_roles)
        )
        and (
          -- Version state scoping: Author-only officers without other roles only see Drafts
          requested_version_state is null
          or not (officer.functional_roles = array['author']::text[])
          or requested_version_state = 'Draft'
        )
    );
$function$;

-- 2. Document Creation Fix:
-- Creator is assigned author and custodian (if they hold custodian) with allow_restricted = true
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

  -- Assign creator as author with allow_restricted = true
  insert into public.record_assignments (
    record_id, user_id, assignment_function, assigned_by, is_active, allow_restricted
  ) values (
    v_record_id, v_uid, 'author', v_uid, true, true
  )
  on conflict (record_id, user_id, assignment_function) do update
    set is_active = true, allow_restricted = true, assigned_by = v_uid;

  -- If creator also has custodian role, assign custodian
  if 'custodian' = any(v_user.functional_roles) then
    insert into public.record_assignments (
      record_id, user_id, assignment_function, assigned_by, is_active, allow_restricted
    ) values (
      v_record_id, v_uid, 'custodian', v_uid, true, true
    )
    on conflict (record_id, user_id, assignment_function) do update
      set is_active = true, allow_restricted = true, assigned_by = v_uid;
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

-- 3. Two-Stage Review: Reviewer Pass/Endorsement
-- Add columns to record_versions to track reviewer pass and notes
alter table public.record_versions
  add column if not exists reviewer_passed_at timestamptz,
  add column if not exists reviewer_passed_by uuid references public.app_users(user_id),
  add column if not exists reviewer_feedback text;

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

  v_parent_id := v_ver.record_id;

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

revoke all on function public.eacsc_reviewer_pass_version(uuid, integer, text) from public, anon;
grant execute on function public.eacsc_reviewer_pass_version(uuid, integer, text) to authenticated;

-- 4. Enable Supabase Realtime for instant multi-device syncing
do $$
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;
  alter publication supabase_realtime add table public.master_records;
  alter publication supabase_realtime add table public.record_versions;
  alter publication supabase_realtime add table public.role_requests;
  alter publication supabase_realtime add table public.turnover_packages;
exception when others then
  null; -- skip if already added
end;
$$;

commit;
