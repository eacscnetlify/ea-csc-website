-- Batch 6, part 1. Apply once as postgres in ea-csc-website-dev.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

do $$
begin
  if current_user <> 'postgres' then
    raise exception 'Run as postgres.';
  end if;

  if to_regprocedure('public.eacsc_get_version_file(uuid)') is null
    or to_regprocedure('public.eacsc_plan_upload_cleanup(uuid,boolean)') is null then
    raise exception 'Complete the Batch 5 migrations first.';
  end if;
end;
$$;

create table public.review_comments (
  comment_id uuid primary key,
  record_id varchar(50) not null,
  version_id uuid not null,
  actor_user_id uuid not null references public.app_users(user_id),
  request_id uuid not null,
  reviewed_revision integer not null check (reviewed_revision > 0),
  returned_revision integer not null,
  comment_text text not null check (
    char_length(comment_text) between 1 and 2000
    and comment_text ~ '[^[:space:]]'
  ),
  audit_event_uuid uuid not null unique
    references public.audit_events(event_uuid),
  created_at timestamptz not null default clock_timestamp(),
  foreign key (record_id, version_id)
    references public.record_versions(record_id, version_id),
  unique (actor_user_id, request_id),
  check (returned_revision::bigint = reviewed_revision::bigint + 1)
);

create index review_comments_version_index
  on public.review_comments(version_id, returned_revision);

alter table public.review_comments enable row level security;

revoke all on public.review_comments
  from public, anon, authenticated, service_role;
grant select on public.review_comments to authenticated;

create policy review_comments_select_assigned
on public.review_comments for select to authenticated
using (
  exists (
    select 1 from public.record_versions v
    where v.version_id = review_comments.version_id
      and v.record_id = review_comments.record_id
      and eacsc_private.can_read_record(v.record_id, v.state)
  )
);

create function eacsc_private.block_review_comment_changes()
returns trigger language plpgsql set search_path = '' as $$
begin
  raise exception using
    errcode = '55000',
    message = 'Review comments are immutable.';
end;
$$;

revoke all on function eacsc_private.block_review_comment_changes()
  from public, anon, authenticated, service_role;

create trigger review_comments_block_changes
before update or delete or truncate on public.review_comments
for each statement
execute function eacsc_private.block_review_comment_changes();

-- Only these two fixed operations are accepted.
create function eacsc_private.transition_review(
  p_version_id uuid,
  p_expected_revision integer,
  p_request_id uuid,
  p_operation text,
  p_comment text
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
  required_role text;
  source_state text;
  target_state text;
  command_name text;
  comment_value text := btrim(p_comment);
  comment_id uuid;
  event_id uuid := gen_random_uuid();
  payload jsonb;
  response jsonb;
  saved_at timestamptz;
begin
  if actor_id is null
    or (auth.jwt()->>'is_anonymous') is distinct from 'false' then
    raise exception using
      errcode = '42501',
      message = 'Review transition is not permitted.';
  end if;

  if p_version_id is null
    or p_request_id is null
    or p_expected_revision is null
    or p_expected_revision not between 1 and 2147483646
    or p_operation is null
    or p_operation not in ('submit', 'return')
    or (p_operation = 'submit' and p_comment is not null)
    or (
      p_operation = 'return'
      and (
        p_comment is null
        or char_length(p_comment) > 2000
        or p_comment !~ '[^[:space:]]'
      )
    ) then
    raise exception using
      errcode = '22023',
      message = 'Invalid review request or return comments.';
  end if;

  required_role := case p_operation
    when 'submit' then 'author' else 'reviewer' end;
  source_state := case p_operation
    when 'submit' then 'Draft' else 'For Review' end;
  target_state := case p_operation
    when 'submit' then 'For Review' else 'Draft' end;
  command_name := case p_operation
    when 'submit' then 'submit_version_for_review'
    else 'return_version_for_correction' end;

  payload := jsonb_build_object(
    'version_id', p_version_id,
    'expected_revision', p_expected_revision,
    'comment', comment_value
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
      message = 'Review transition is not permitted.';
  end if;

  select record_id into parent_id
  from public.record_versions
  where version_id = p_version_id;

  if not found then
    raise exception using
      errcode = '42501',
      message = 'Review transition is not permitted.';
  end if;

  select * into master_row
  from public.master_records
  where record_id = parent_id
  for update;

  perform 1
  from public.record_assignments
  where record_id = parent_id
    and user_id = actor_id
    and is_active
    and assignment_function = required_role
    and required_role = any(roles)
    and (master_row.access_class <> 'restricted' or allow_restricted)
  for share;

  if not found then
    raise exception using
      errcode = '42501',
      message = 'Review transition is not permitted.';
  end if;

  select * into version_row
  from public.record_versions
  where version_id = p_version_id and record_id = parent_id
  for update;

  -- Recheck authority before acknowledging an earlier successful request.
  -- A receipt does not grant access to the current version or attachment.
  select * into receipt
  from eacsc_private.mutation_receipts r
  where r.actor_user_id = actor_id
    and r.request_id = p_request_id;

  if found then
    if receipt.command_name <> command_name
      or receipt.request_payload is distinct from payload then
      raise exception using
        errcode = '22023',
        message = 'Request ID was used for a different operation.';
    end if;
    return receipt.response_payload;
  end if;

  if version_row.revision_counter <> p_expected_revision
    or version_row.state <> source_state then
    raise exception using
      errcode = 'PT409',
      message = 'Version changed. Reload before continuing.';
  end if;

  if master_row.revision_counter >= 2147483647 then
    raise exception using
      errcode = '55000',
      message = 'Record revision limit reached.';
  end if;

  if version_row.approved_at is not null
    or version_row.approval_recorded_by is not null
    or version_row.approval_basis is not null
    or version_row.approval_evidence_reference is not null
    or version_row.approval_not_required_reason is not null then
    raise exception using
      errcode = '55000',
      message = 'Unexpected approval information. Stop and inspect.';
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
      message = 'An accepted attachment must remain available.';
  end if;

  saved_at := greatest(
    clock_timestamp(),
    version_row.updated_at,
    master_row.updated_at
  );

  update public.record_versions
  set state = target_state,
    revision_counter = p_expected_revision + 1,
    updated_at = saved_at
  where version_id = p_version_id;

  update public.master_records
  set revision_counter = master_row.revision_counter + 1,
    updated_at = saved_at
  where record_id = parent_id;

  if p_operation = 'return' then
    comment_id := gen_random_uuid();
  end if;

  insert into public.audit_events (
    event_uuid, record_id, version_id, actor_user_id,
    action_type, action_summary, previous_revision, new_revision,
    previous_state, new_state, request_id
  )
  values (
    event_id, parent_id, p_version_id, actor_id,
    case p_operation
      when 'submit' then 'version.submitted_for_review'
      else 'version.returned_for_correction' end,
    case p_operation
      when 'submit' then 'Submitted Draft for review.'
      else 'Returned version to Draft with review comments.' end,
    p_expected_revision,
    p_expected_revision + 1,
    jsonb_build_object(
      'state', source_state,
      'record_revision', master_row.revision_counter
    ),
    jsonb_build_object(
      'state', target_state,
      'record_revision', master_row.revision_counter + 1,
      'comment_id', comment_id
    ),
    p_request_id
  );

  if p_operation = 'return' then
    insert into public.review_comments (
      comment_id, record_id, version_id, actor_user_id,
      request_id, reviewed_revision, returned_revision,
      comment_text, audit_event_uuid, created_at
    )
    values (
      comment_id, parent_id, p_version_id, actor_id,
      p_request_id, p_expected_revision, p_expected_revision + 1,
      comment_value, event_id, saved_at
    );
  end if;

  response := jsonb_build_object(
    'request_id', p_request_id,
    'record_id', parent_id,
    'version_id', p_version_id,
    'state', target_state,
    'revision_counter', p_expected_revision + 1,
    'record_revision', master_row.revision_counter + 1,
    'updated_at', saved_at,
    'audit_event_uuid', event_id,
    'comment_id', comment_id
  );

  insert into eacsc_private.mutation_receipts (
    actor_user_id, request_id, command_name,
    request_payload, response_payload, audit_event_uuid
  )
  values (
    actor_id, p_request_id, command_name,
    payload, response, event_id
  );

  return response;
end;
$$;

revoke all on function
  eacsc_private.transition_review(uuid, integer, uuid, text, text)
  from public, anon, authenticated, service_role;

grant execute on function
  eacsc_private.transition_review(uuid, integer, uuid, text, text)
  to authenticated;

create function public.eacsc_submit_version_for_review(
  p_version_id uuid,
  p_expected_revision integer,
  p_request_id uuid
)
returns jsonb language sql security invoker set search_path = ''
as $$
  select eacsc_private.transition_review(
    p_version_id, p_expected_revision, p_request_id, 'submit', null
  );
$$;

create function public.eacsc_return_version_for_correction(
  p_version_id uuid,
  p_expected_revision integer,
  p_comment text,
  p_request_id uuid
)
returns jsonb language sql security invoker set search_path = ''
as $$
  select eacsc_private.transition_review(
    p_version_id, p_expected_revision, p_request_id, 'return', p_comment
  );
$$;

revoke all on function
  public.eacsc_submit_version_for_review(uuid, integer, uuid),
  public.eacsc_return_version_for_correction(uuid, integer, text, uuid)
  from public, anon, authenticated, service_role;

grant execute on function
  public.eacsc_submit_version_for_review(uuid, integer, uuid),
  public.eacsc_return_version_for_correction(uuid, integer, text, uuid)
  to authenticated;

comment on table public.review_comments is
'Immutable return comments, bound to the reviewed version revision and audit. Reads follow current version scope.';

notify pgrst, 'reload schema';
commit;
