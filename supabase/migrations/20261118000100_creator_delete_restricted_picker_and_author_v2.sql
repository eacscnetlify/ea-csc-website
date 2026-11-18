-- Batch 16: Creator-only Delete Document, Restricted Officer Picker RPCs, and Author v2+ Access
begin;
set local lock_timeout = '10s';
set local statement_timeout = '30s';

-- 1. List active officers for Restricted Access Picker
create or replace function public.eacsc_list_active_officers()
returns table (
  user_id uuid,
  full_name varchar(160),
  email varchar(320),
  council_position varchar(160),
  functional_roles text[]
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.app_users u
    where u.user_id = auth.uid() and u.is_active = true and cardinality(u.functional_roles) > 0
  ) then
    raise exception 'Active officer role required.' using errcode = '42501';
  end if;

  return query
  select u.user_id, u.full_name, u.email, u.council_position, u.functional_roles
  from public.app_users u
  where u.is_active = true
    and cardinality(u.functional_roles) > 0
  order by u.council_position asc, u.full_name asc;
end;
$$;

revoke all on function public.eacsc_list_active_officers() from public, anon;
grant execute on function public.eacsc_list_active_officers() to authenticated;

-- 2. List user_ids with restricted access on a specific document
create or replace function public.eacsc_list_restricted_access(p_record_id text)
returns uuid[]
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_ids uuid[];
begin
  if not exists (
    select 1 from public.app_users u
    where u.user_id = v_uid and u.is_active = true and cardinality(u.functional_roles) > 0
  ) then
    raise exception 'Active officer role required.' using errcode = '42501';
  end if;

  if not eacsc_private.can_read_record(p_record_id, null, null) then
    raise exception 'You do not have access to view this document.' using errcode = '42501';
  end if;

  select coalesce(array_agg(distinct a.user_id), '{}'::uuid[])
  into v_ids
  from public.record_assignments a
  where a.record_id = p_record_id
    and a.is_active = true
    and a.allow_restricted = true;

  return v_ids;
end;
$$;

revoke all on function public.eacsc_list_restricted_access(text) from public, anon;
grant execute on function public.eacsc_list_restricted_access(text) to authenticated;

-- 3. Creator-first upload rule:
--    * For v1 (0 existing versions): only the creator / assigned author or custodian may upload.
--    * Once v1 exists (version_count >= 1): any active Author/Custodian may upload v2+ drafts
--      (on public/internal docs, or on restricted docs if they hold allow_restricted / approver).
create or replace function public.eacsc_prepare_version_upload(
  p_record_id text,
  p_expected_record_revision integer,
  p_original_filename text,
  p_mime_type text,
  p_file_size_bytes bigint,
  p_sha256 text,
  p_change_summary text,
  p_correction_classification text,
  p_request_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $entry$
declare
  v_uid uuid := auth.uid();
  v_user public.app_users%rowtype;
  v_master public.master_records%rowtype;
  v_ver_count integer;
  v_has_restricted boolean;
begin
  select * into v_user from public.app_users where user_id = v_uid and is_active = true;
  if found and (v_user.functional_roles && array['author', 'custodian']::text[]) then
    select * into v_master from public.master_records where record_id = p_record_id;
    if found then
      select count(*)::integer into v_ver_count from public.record_versions where record_id = p_record_id;
      if v_ver_count >= 1 then
        v_has_restricted := (
          v_master.access_class <> 'restricted'
          or 'approver' = any(v_user.functional_roles)
          or exists (
            select 1 from public.record_assignments a
            where a.record_id = p_record_id and a.user_id = v_uid and a.is_active and a.allow_restricted
          )
        );
        if v_has_restricted then
          insert into public.record_assignments (
            record_id, user_id, assignment_function, assigned_by, is_active, allow_restricted
          ) values (
            p_record_id,
            v_uid,
            case when 'author' = any(v_user.functional_roles) then 'author' else 'custodian' end,
            v_uid,
            true,
            (v_master.access_class = 'restricted')
          )
          on conflict (record_id, user_id, assignment_function) do update
            set is_active = true;
        end if;
      end if;
    end if;
  end if;

  return eacsc_private.prepare_version_upload(
    p_record_id,
    p_expected_record_revision,
    p_original_filename,
    p_mime_type,
    p_file_size_bytes,
    p_sha256,
    p_change_summary,
    p_correction_classification,
    p_request_id
  );
end;
$entry$;

-- 4. Creator-Only Delete Document RPC (Draft / empty documents only)
create or replace function public.eacsc_delete_document(p_record_id text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_master public.master_records%rowtype;
  v_is_creator boolean := false;
begin
  if v_uid is null then
    raise exception 'Authentication required.' using errcode = '42501';
  end if;

  select * into v_master from public.master_records where record_id = p_record_id for update;
  if not found then
    raise exception 'Document not found.' using errcode = 'P0002';
  end if;

  -- Verify caller is the creator of the document
  select exists (
    select 1 from public.audit_events e
    where e.record_id = p_record_id and e.action_type = 'document.created' and e.actor_user_id = v_uid
  ) or exists (
    select 1 from public.record_assignments a
    where a.record_id = p_record_id and a.user_id = v_uid and a.assigned_by = v_uid and a.assignment_function = 'author' and a.is_active
  ) into v_is_creator;

  if not v_is_creator then
    raise exception 'Only the creator of this document can delete it.' using errcode = '42501';
  end if;

  if exists (
    select 1 from public.record_versions v
    where v.record_id = p_record_id and v.state in ('Approved', 'Superseded')
  ) or exists (
    select 1 from public.record_releases r
    where r.record_id = p_record_id
  ) then
    raise exception 'Documents with Approved or Published versions cannot be deleted.' using errcode = '42501';
  end if;

  -- Temporarily bypass immutability triggers inside this creator-only delete transaction
  set local session_replication_role = 'replica';

  delete from public.review_comments where record_id = p_record_id;
  delete from eacsc_private.upload_dispositions where upload_id in (
    select upload_id from eacsc_private.upload_requests where record_id = p_record_id
  );
  delete from eacsc_private.upload_requests where record_id = p_record_id;
  delete from public.audit_events where record_id = p_record_id;
  delete from public.record_assignments where record_id = p_record_id;
  delete from public.record_versions where record_id = p_record_id;
  delete from public.master_records where record_id = p_record_id;

  return jsonb_build_object('deleted', true, 'record_id', p_record_id);
end;
$$;

revoke all on function public.eacsc_delete_document(text) from public, anon;
grant execute on function public.eacsc_delete_document(text) to authenticated;

notify pgrst, 'reload schema';
commit;
