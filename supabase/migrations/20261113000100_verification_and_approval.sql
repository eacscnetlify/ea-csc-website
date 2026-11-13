-- Batch 6, part 2: six-point verification checklist and approval / custodian acceptance.
-- Apply once as postgres in ea-csc-website-dev.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

do $$
begin
  if current_user <> 'postgres' then
    raise exception 'Run as postgres.';
  end if;

  if to_regprocedure('public.eacsc_submit_version_for_review(uuid,integer,uuid)') is null then
    raise exception 'Apply 20261101000100_review_transitions.sql first.';
  end if;
end;
$$;

create table public.version_verifications (
  verification_id uuid primary key,
  record_id varchar(50) not null,
  version_id uuid not null,
  actor_user_id uuid not null references public.app_users(user_id),
  request_id uuid not null,
  verified_revision integer not null check (verified_revision > 0),
  approved_revision integer not null,
  checklist jsonb not null,
  is_provisional boolean not null default false,
  provisional_uncertainty text,
  provisional_update_owner text,
  approval_kind text not null check (
    approval_kind in ('substantive_approval', 'custodian_acceptance')
  ),
  approving_position text not null check (
    char_length(btrim(approving_position)) > 0
    and char_length(approving_position) <= 160
  ),
  approval_date date,
  approval_basis text not null check (
    char_length(btrim(approval_basis)) > 0
    and char_length(approval_basis) <= 1000
  ),
  approval_evidence_reference text not null check (
    char_length(btrim(approval_evidence_reference)) > 0
    and char_length(approval_evidence_reference) <= 500
  ),
  approval_not_required_reason text,
  audit_event_uuid uuid not null unique
    references public.audit_events(event_uuid),
  created_at timestamptz not null default clock_timestamp(),
  foreign key (record_id, version_id)
    references public.record_versions(record_id, version_id),
  unique (actor_user_id, request_id),
  check (approved_revision::bigint = verified_revision::bigint + 1),
  check (jsonb_typeof(checklist) = 'object'),
  check (
    (
      is_provisional = false
      and provisional_uncertainty is null
      and provisional_update_owner is null
    )
    or (
      is_provisional = true
      and provisional_uncertainty is not null
      and char_length(btrim(provisional_uncertainty)) > 0
      and char_length(provisional_uncertainty) <= 1000
      and provisional_update_owner is not null
      and char_length(btrim(provisional_update_owner)) > 0
      and char_length(provisional_update_owner) <= 160
    )
  ),
  check (
    (
      approval_kind = 'substantive_approval'
      and approval_date is not null
      and approval_not_required_reason is null
    )
    or (
      approval_kind = 'custodian_acceptance'
      and approval_not_required_reason is not null
      and char_length(btrim(approval_not_required_reason)) > 0
      and char_length(approval_not_required_reason) <= 1000
    )
  )
);

create index version_verifications_version_index
  on public.version_verifications(version_id, approved_revision);

alter table public.version_verifications enable row level security;

revoke all on public.version_verifications
  from public, anon, authenticated, service_role;
grant select on public.version_verifications to authenticated;

create policy version_verifications_select_assigned
on public.version_verifications for select to authenticated
using (
  exists (
    select 1 from public.record_versions v
    where v.version_id = version_verifications.version_id
      and v.record_id = version_verifications.record_id
      and eacsc_private.can_read_record(v.record_id, v.state)
  )
);

create function eacsc_private.block_verification_changes()
returns trigger language plpgsql set search_path = '' as $$
begin
  raise exception using
    errcode = '55000',
    message = 'Version verification records are immutable.';
end;
$$;

revoke all on function eacsc_private.block_verification_changes()
  from public, anon, authenticated, service_role;

create trigger version_verifications_block_changes
before update or delete or truncate on public.version_verifications
for each statement
execute function eacsc_private.block_verification_changes();

create function eacsc_private.approve_version(
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
language plpgsql security definer set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  roles text[];
  parent_id text;
  master_row public.master_records%rowtype;
  version_row public.record_versions%rowtype;
  receipt eacsc_private.mutation_receipts%rowtype;
  matched_function text;

  check_keys text[] := array[
    'identity_version',
    'dates_deadlines',
    'location_link',
    'audience_requirements',
    'authority_disclosure',
    'contact_reference'
  ];
  k text;
  item jsonb;
  item_status text;
  item_reason text;
  normalized_checklist jsonb := '{}'::jsonb;

  pos_val text := nullif(btrim(p_approving_position), '');
  basis_val text := nullif(btrim(p_approval_basis), '');
  evidence_val text := nullif(btrim(p_approval_evidence_reference), '');
  not_req_val text := nullif(btrim(p_approval_not_required_reason), '');
  prov_flag boolean := coalesce(p_is_provisional, false);
  prov_uncert text := case when prov_flag then nullif(btrim(p_provisional_uncertainty), '') else null end;
  prov_owner text := case when prov_flag then nullif(btrim(p_provisional_update_owner), '') else null end;

  verification_id uuid := gen_random_uuid();
  event_id uuid := gen_random_uuid();
  payload jsonb;
  response jsonb;
  saved_at timestamptz;
begin
  if actor_id is null
    or (auth.jwt()->>'is_anonymous') is distinct from 'false' then
    raise exception using
      errcode = '42501',
      message = 'Approval is not permitted.';
  end if;

  if p_version_id is null
    or p_request_id is null
    or p_expected_revision is null
    or p_expected_revision not between 1 and 2147483646
    or p_checklist is null
    or jsonb_typeof(p_checklist) <> 'object'
    or p_approval_kind is null
    or p_approval_kind not in ('substantive_approval', 'custodian_acceptance')
    or pos_val is null or char_length(pos_val) > 160
    or basis_val is null or char_length(basis_val) > 1000
    or evidence_val is null or char_length(evidence_val) > 500
    or (p_approval_kind = 'substantive_approval' and (p_approval_date is null or not_req_val is not null))
    or (p_approval_kind = 'custodian_acceptance' and (not_req_val is null or char_length(not_req_val) > 1000))
    or (prov_flag and (
      prov_uncert is null or char_length(prov_uncert) > 1000
      or prov_owner is null or char_length(prov_owner) > 160
    )) then
    raise exception using
      errcode = '22023',
      message = 'Provide complete approval evidence, valid checklist results, and provisional details when applicable.';
  end if;

  if (select count(*) from jsonb_object_keys(p_checklist)) <> 6 then
    raise exception using
      errcode = '22023',
      message = 'All six Appendix B verification items are required.';
  end if;

  foreach k in array check_keys loop
    item := p_checklist -> k;
    if item is null or jsonb_typeof(item) <> 'object' then
      raise exception using
        errcode = '22023',
        message = 'Missing checklist item: ' || k;
    end if;

    item_status := item ->> 'status';
    item_reason := nullif(btrim(item ->> 'reason'), '');

    if item_status is null or item_status not in ('Confirmed', 'Correction Required', 'Not Applicable') then
      raise exception using
        errcode = '22023',
        message = 'Invalid checklist status for ' || k;
    end if;

    if item_status = 'Correction Required' then
      raise exception using
        errcode = '22023',
        message = 'Checklist has Correction Required items. Return to Draft for correction instead of approving.';
    end if;

    if item_status = 'Not Applicable' and (item_reason is null or char_length(item_reason) > 500) then
      raise exception using
        errcode = '22023',
        message = 'Not Applicable items require a reason of at most 500 characters.';
    end if;

    if item_reason is not null and char_length(item_reason) > 500 then
      raise exception using
        errcode = '22023',
        message = 'Checklist reason must be at most 500 characters.';
    end if;

    normalized_checklist := normalized_checklist || jsonb_build_object(
      k,
      jsonb_build_object(
        'status', item_status,
        'reason', item_reason
      )
    );
  end loop;

  payload := jsonb_build_object(
    'version_id', p_version_id,
    'expected_revision', p_expected_revision,
    'checklist', normalized_checklist,
    'approval_kind', p_approval_kind,
    'approving_position', pos_val,
    'approval_date', p_approval_date,
    'approval_basis', basis_val,
    'approval_evidence_reference', evidence_val,
    'approval_not_required_reason', not_req_val,
    'is_provisional', prov_flag,
    'provisional_uncertainty', prov_uncert,
    'provisional_update_owner', prov_owner
  );

  perform pg_advisory_xact_lock(hashtextextended(
    'eacsc-mutation:' || actor_id::text || ':' || p_request_id::text,
    0
  ));

  -- Lock order: profile -> master -> assignment -> version.
  select functional_roles into roles
  from public.app_users
  where user_id = actor_id and is_active
  for share;

  if not found or not exists (
    select 1 from auth.users
    where id = actor_id
      and is_anonymous is false
      and deleted_at is null
      and (banned_until is null or banned_until <= clock_timestamp())
  ) then
    raise exception using
      errcode = '42501',
      message = 'Approval is not permitted.';
  end if;

  select record_id into parent_id
  from public.record_versions
  where version_id = p_version_id;

  if not found then
    raise exception using
      errcode = '42501',
      message = 'Approval is not permitted.';
  end if;

  select * into master_row
  from public.master_records
  where record_id = parent_id
  for update;

  select assignment_function into matched_function
  from public.record_assignments
  where record_id = parent_id
    and user_id = actor_id
    and is_active
    and (
      (p_approval_kind = 'substantive_approval' and assignment_function = 'approver')
      or (p_approval_kind = 'custodian_acceptance' and assignment_function in ('custodian', 'approver'))
    )
    and assignment_function = any(roles)
    and (master_row.access_class <> 'restricted' or allow_restricted)
  order by assignment_function
  limit 1
  for share;

  if not found then
    raise exception using
      errcode = '42501',
      message = 'Approval is not permitted.';
  end if;

  select * into version_row
  from public.record_versions
  where version_id = p_version_id and record_id = parent_id
  for update;

  select * into receipt
  from eacsc_private.mutation_receipts r
  where r.actor_user_id = actor_id
    and r.request_id = p_request_id;

  if found then
    if receipt.command_name <> 'approve_version'
      or receipt.request_payload is distinct from payload then
      raise exception using
        errcode = '22023',
        message = 'Request ID was used for a different operation.';
    end if;
    return receipt.response_payload;
  end if;

  if version_row.revision_counter <> p_expected_revision
    or version_row.state <> 'For Review' then
    raise exception using
      errcode = 'PT409',
      message = 'Version changed. Reload before approving.';
  end if;

  if master_row.revision_counter >= 2147483647 then
    raise exception using
      errcode = '55000',
      message = 'Record revision limit reached.';
  end if;

  if not exists (
    select 1
    from eacsc_private.upload_requests u
    join eacsc_private.upload_dispositions d
      on d.upload_id = u.upload_id
    join eacsc_private.mutation_receipts r
      on r.actor_user_id = u.actor_user_id
      and r.request_id = d.acceptance_request_id
      and r.command_name = 'accept_version_upload'
    join storage.objects o
      on o.bucket_id = u.bucket_id
      and o.name = u.destination_key
      and o.id::text = r.request_payload->>'storage_object_id'
    where d.disposition = 'accepted'
      and d.accepted_version_id = p_version_id
      and u.proposed_version_id = p_version_id
      and u.record_id = parent_id
      and u.proposed_version_number = version_row.version_number
      and u.destination_key = version_row.storage_key
      and u.original_filename = version_row.original_filename
      and u.mime_type = version_row.mime_type
      and u.file_size_bytes = version_row.file_size_bytes
      and u.sha256 = version_row.sha256
  ) then
    raise exception using
      errcode = '55000',
      message = 'An accepted attachment must remain available before approval.';
  end if;

  saved_at := greatest(
    clock_timestamp(),
    version_row.updated_at,
    master_row.updated_at
  );

  update public.record_versions
  set state = 'Approved',
    revision_counter = p_expected_revision + 1,
    approved_at = case
      when p_approval_kind = 'substantive_approval' then saved_at
      else null
    end,
    approval_basis = basis_val,
    approval_evidence_reference = evidence_val,
    approval_not_required_reason = not_req_val,
    approval_recorded_by = actor_id,
    updated_at = saved_at
  where version_id = p_version_id;

  update public.master_records
  set revision_counter = master_row.revision_counter + 1,
    updated_at = saved_at
  where record_id = parent_id;

  insert into public.audit_events (
    event_uuid, record_id, version_id, actor_user_id,
    action_type, action_summary, previous_revision, new_revision,
    previous_state, new_state, request_id
  )
  values (
    event_id,
    parent_id,
    p_version_id,
    actor_id,
    case p_approval_kind
      when 'substantive_approval' then 'version.approved'
      else 'version.custodian_accepted'
    end,
    case p_approval_kind
      when 'substantive_approval' then 'Recorded substantive approval with six-point verification.'
      else 'Recorded custodian acceptance and source evidence with six-point verification.'
    end,
    p_expected_revision,
    p_expected_revision + 1,
    jsonb_build_object(
      'state', 'For Review',
      'record_revision', master_row.revision_counter
    ),
    jsonb_build_object(
      'state', 'Approved',
      'record_revision', master_row.revision_counter + 1,
      'approval_kind', p_approval_kind,
      'approving_position', pos_val,
      'approval_date', p_approval_date,
      'is_provisional', prov_flag,
      'verification_id', verification_id
    ),
    p_request_id
  );

  insert into public.version_verifications (
    verification_id, record_id, version_id, actor_user_id, request_id,
    verified_revision, approved_revision, checklist,
    is_provisional, provisional_uncertainty, provisional_update_owner,
    approval_kind, approving_position, approval_date,
    approval_basis, approval_evidence_reference, approval_not_required_reason,
    audit_event_uuid, created_at
  )
  values (
    verification_id, parent_id, p_version_id, actor_id, p_request_id,
    p_expected_revision, p_expected_revision + 1, normalized_checklist,
    prov_flag, prov_uncert, prov_owner,
    p_approval_kind, pos_val, p_approval_date,
    basis_val, evidence_val, not_req_val,
    event_id, saved_at
  );

  response := jsonb_build_object(
    'request_id', p_request_id,
    'record_id', parent_id,
    'version_id', p_version_id,
    'state', 'Approved',
    'revision_counter', p_expected_revision + 1,
    'record_revision', master_row.revision_counter + 1,
    'verification_id', verification_id,
    'audit_event_uuid', event_id,
    'updated_at', saved_at
  );

  insert into eacsc_private.mutation_receipts (
    actor_user_id, request_id, command_name,
    request_payload, response_payload, audit_event_uuid
  )
  values (
    actor_id, p_request_id, 'approve_version',
    payload, response, event_id
  );

  return response;
end;
$$;

revoke all on function
  eacsc_private.approve_version(
    uuid, integer, jsonb, text, text, date, text, text, text, boolean, text, text, uuid
  )
  from public, anon, authenticated, service_role;

grant execute on function
  eacsc_private.approve_version(
    uuid, integer, jsonb, text, text, date, text, text, text, boolean, text, text, uuid
  )
  to authenticated;

create function public.eacsc_approve_version(
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
returns jsonb language sql security invoker set search_path = ''
as $$
  select eacsc_private.approve_version(
    p_version_id, p_expected_revision, p_checklist, p_approval_kind,
    p_approving_position, p_approval_date, p_approval_basis,
    p_approval_evidence_reference, p_approval_not_required_reason,
    p_is_provisional, p_provisional_uncertainty, p_provisional_update_owner,
    p_request_id
  );
$$;

revoke all on function
  public.eacsc_approve_version(
    uuid, integer, jsonb, text, text, date, text, text, text, boolean, text, text, uuid
  )
  from public, anon, authenticated, service_role;

grant execute on function
  public.eacsc_approve_version(
    uuid, integer, jsonb, text, text, date, text, text, text, boolean, text, text, uuid
  )
  to authenticated;

notify pgrst, 'reload schema';
commit;
