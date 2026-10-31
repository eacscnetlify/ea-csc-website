-- Batch 5: authorize preparation of a new attachment version.
-- Does not upload files or create an accepted record version.

begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

do $prerequisites$
begin
  if current_user <> 'postgres' then
    raise exception 'Run this migration as postgres.';
  end if;

  if (
    select count(*)
    from storage.buckets
    where id in (
      'internal-council-records',
      'verified-council-releases'
    )
      and public is false
      and file_size_limit = 10000000
  ) <> 2 then
    raise exception
      'Apply and verify the private bucket migration first.';
  end if;
end;
$prerequisites$;

create table eacsc_private.upload_requests (
  upload_id uuid primary key,

  actor_user_id uuid not null
    references public.app_users(user_id) on delete restrict,

  request_id uuid not null,

  record_id varchar(50) not null
    references public.master_records(record_id) on delete restrict,

  expected_record_revision integer not null
    check (
      expected_record_revision between 1 and 2147483646
    ),

  proposed_version_id uuid not null unique,

  proposed_version_number integer not null
    check (proposed_version_number >= 1),

  bucket_id text not null
    check (bucket_id = 'internal-council-records'),

  staging_key text not null unique,
  destination_key text not null unique,

  original_filename varchar(255) not null
    check (length(btrim(original_filename)) > 0),

  mime_type text not null
    check (
      mime_type in (
        'application/pdf',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'image/jpeg',
        'image/png'
      )
    ),

  file_size_bytes bigint not null
    check (file_size_bytes between 1 and 10000000),

  sha256 text not null
    check (sha256 ~ '^[0-9a-f]{64}$'),

  change_summary text not null
    check (
      char_length(change_summary) <= 2000
      and change_summary ~ '[^[:space:]]'
    ),

  correction_classification text not null
    check (
      correction_classification in (
        'initial_capture',
        'preventable_correction',
        'legitimate_change'
      )
    ),

  authorized_function text not null
    check (
      authorized_function in ('author','custodian')
    ),

  preparation_event_uuid uuid not null unique
    references public.audit_events(event_uuid) on delete restrict,

  created_at timestamptz not null default now(),
  expires_at timestamptz not null,

  unique (actor_user_id,request_id),
  check (expires_at > created_at)
);

create index upload_requests_record_index
  on eacsc_private.upload_requests(record_id);

alter table eacsc_private.upload_requests
  enable row level security;

revoke all on eacsc_private.upload_requests
  from public,anon,authenticated,service_role;

create function eacsc_private.protect_upload_request()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $protect$
begin
  raise exception using
    errcode = '55000',
    message = 'Upload request facts are immutable.';
end;
$protect$;

revoke all on function eacsc_private.protect_upload_request()
  from public,anon,authenticated,service_role;

create trigger upload_requests_protect_changes
before update or delete or truncate
on eacsc_private.upload_requests
for each statement
execute function eacsc_private.protect_upload_request();

create function eacsc_private.prepare_version_upload(
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
as $prepare$
declare
  actor_id uuid := auth.uid();
  actor_roles text[];
  master_row public.master_records%rowtype;
  matched_function text;

  filename text := btrim(p_original_filename);
  notes text := btrim(p_change_summary);
  extension text;
  category_slug text;
  proposed_number bigint;

  new_upload_id uuid := gen_random_uuid();
  new_version_id uuid := gen_random_uuid();
  event_id uuid := gen_random_uuid();
  expires timestamptz := now() + interval '30 minutes';

  stage_path text;
  final_path text;
  payload jsonb;
  response jsonb;
  prior eacsc_private.mutation_receipts%rowtype;
begin
  if actor_id is null
    or (auth.jwt()->>'is_anonymous') is distinct from 'false' then
    raise exception using
      errcode = '42501',
      message = 'Upload preparation is not permitted.';
  end if;

  if p_record_id is null
    or p_request_id is null
    or p_expected_record_revision is null
    or p_expected_record_revision < 1
    or p_expected_record_revision >= 2147483647
    or filename is null
    or char_length(filename) not between 1 and 255
    or filename ~ '[[:cntrl:]/]'
    or position(chr(92) in filename) > 0
    or p_file_size_bytes is null
    or p_file_size_bytes not between 1 and 10000000
    or p_sha256 is null
    or p_sha256 !~ '^[0-9a-fA-F]{64}$'
    or notes is null
    or notes !~ '[^[:space:]]'
    or char_length(p_change_summary) > 2000
    or p_correction_classification is null
    or p_correction_classification not in (
      'initial_capture',
      'preventable_correction',
      'legitimate_change'
    ) then
    raise exception using
      errcode = '22023',
      message = 'Provide valid record, revision, file metadata, checksum, notes, classification and request ID.';
  end if;

  extension := lower(
    substring(filename from '\.([^.]+)$')
  );

  if extension is null
    or p_mime_type is null
    or not (
      (
        extension = 'pdf'
        and p_mime_type = 'application/pdf'
      )
      or (
        extension = 'docx'
        and p_mime_type =
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
      )
      or (
        extension in ('jpg','jpeg')
        and p_mime_type = 'image/jpeg'
      )
      or (
        extension = 'png'
        and p_mime_type = 'image/png'
      )
    ) then
    raise exception using
      errcode = '22023',
      message = 'Use matching PDF, DOCX, JPEG or PNG file metadata.';
  end if;

  payload := jsonb_build_object(
    'record_id',p_record_id,
    'expected_record_revision',p_expected_record_revision,
    'original_filename',filename,
    'mime_type',p_mime_type,
    'file_size_bytes',p_file_size_bytes,
    'sha256',lower(p_sha256),
    'change_summary',notes,
    'correction_classification',p_correction_classification
  );

  perform pg_advisory_xact_lock(
    hashtextextended(
      'eacsc-mutation:'
        || actor_id::text
        || ':'
        || p_request_id::text,
      0
    )
  );

  -- Existing lock order: profile, master, assignment.
  select functional_roles
  into actor_roles
  from public.app_users
  where user_id = actor_id
    and is_active
  for share;

  if not found then
    raise exception using
      errcode = '42501',
      message = 'Upload preparation is not permitted.';
  end if;

  select *
  into master_row
  from public.master_records
  where record_id = p_record_id
  for share;

  if not found then
    raise exception using
      errcode = '42501',
      message = 'Upload preparation is not permitted.';
  end if;

  select assignment_function
  into matched_function
  from public.record_assignments
  where record_id = p_record_id
    and user_id = actor_id
    and is_active
    and assignment_function in ('author','custodian')
    and assignment_function = any(actor_roles)
    and (
      master_row.access_class <> 'restricted'
      or allow_restricted
    )
  order by assignment_function
  limit 1
  for share;

  if not found then
    raise exception using
      errcode = '42501',
      message = 'Upload preparation is not permitted.';
  end if;

  select *
  into prior
  from eacsc_private.mutation_receipts
  where actor_user_id = actor_id
    and request_id = p_request_id;

  if found then
    if prior.command_name <> 'prepare_version_upload'
      or prior.request_payload is distinct from payload then
      raise exception using
        errcode = '22023',
        message = 'This request ID has already been used for a different operation.';
    end if;

    return prior.response_payload;
  end if;

  if master_row.revision_counter <> p_expected_record_revision then
    raise exception using
      errcode = 'PT409',
      message = 'Record changed. Reload its metadata before preparing an upload.';
  end if;

  select coalesce(max(version_number)::bigint,0) + 1
  into proposed_number
  from public.record_versions
  where record_id = p_record_id;

  if proposed_number > 2147483647 then
    raise exception using
      errcode = '22023',
      message = 'Version number limit reached.';
  end if;

  if (
      proposed_number = 1
      and p_correction_classification <> 'initial_capture'
    )
    or (
      proposed_number > 1
      and p_correction_classification = 'initial_capture'
    ) then
    raise exception using
      errcode = '22023',
      message = 'Use initial_capture only for the first version; otherwise provide a correction classification.';
  end if;

  category_slug := case master_row.category
    when 'Governance and legislation' then 'governance'
    when 'Secretariat and proceedings' then 'secretariat'
    when 'Activities and CBO records' then 'activities'
    when 'Financial archives' then 'financial'
    when 'Forms and official information' then 'forms'
    when 'Turnover and continuity' then 'turnover'
  end;

  if category_slug is null then
    raise exception using
      errcode = '22023',
      message = 'Unsupported record category.';
  end if;

  stage_path :=
    'quarantine/'
    || actor_id::text
    || '/'
    || new_upload_id::text
    || '.'
    || extension;

  final_path :=
    category_slug
    || '/'
    || p_record_id
    || '/'
    || proposed_number::text
    || '_'
    || new_upload_id::text
    || '.'
    || extension;

  response := jsonb_build_object(
    'upload_id',new_upload_id,
    'request_id',p_request_id,
    'record_id',p_record_id,
    'expected_record_revision',p_expected_record_revision,
    'proposed_version_id',new_version_id,
    'proposed_version_number',proposed_number,
    'bucket_id','internal-council-records',
    'staging_key',stage_path,
    'destination_key',final_path,
    'original_filename',filename,
    'mime_type',p_mime_type,
    'file_size_bytes',p_file_size_bytes,
    'sha256',lower(p_sha256),
    'expires_at',expires,
    'preparation_event_uuid',event_id
  );

  insert into public.audit_events (
    event_uuid,
    record_id,
    actor_user_id,
    action_type,
    action_summary,
    new_state,
    request_id
  ) values (
    event_id,
    p_record_id,
    actor_id,
    'version.upload_prepared',
    'Prepared a private staged upload request.',
    jsonb_build_object(
      'upload_id',new_upload_id,
      'expected_record_revision',p_expected_record_revision,
      'proposed_version_number',proposed_number,
      'authorized_function',matched_function,
      'expires_at',expires
    ),
    p_request_id
  );

  insert into eacsc_private.upload_requests (
    upload_id,
    actor_user_id,
    request_id,
    record_id,
    expected_record_revision,
    proposed_version_id,
    proposed_version_number,
    bucket_id,
    staging_key,
    destination_key,
    original_filename,
    mime_type,
    file_size_bytes,
    sha256,
    change_summary,
    correction_classification,
    authorized_function,
    preparation_event_uuid,
    expires_at
  ) values (
    new_upload_id,
    actor_id,
    p_request_id,
    p_record_id,
    p_expected_record_revision,
    new_version_id,
    proposed_number::integer,
    'internal-council-records',
    stage_path,
    final_path,
    filename,
    p_mime_type,
    p_file_size_bytes,
    lower(p_sha256),
    notes,
    p_correction_classification,
    matched_function,
    event_id,
    expires
  );

  insert into eacsc_private.mutation_receipts (
    actor_user_id,
    request_id,
    command_name,
    request_payload,
    response_payload,
    audit_event_uuid
  ) values (
    actor_id,
    p_request_id,
    'prepare_version_upload',
    payload,
    response,
    event_id
  );

  return response;
end;
$prepare$;

revoke all on function eacsc_private.prepare_version_upload(
  text,integer,text,text,bigint,text,text,text,uuid
) from public,anon,authenticated,service_role;

grant execute on function eacsc_private.prepare_version_upload(
  text,integer,text,text,bigint,text,text,text,uuid
) to authenticated;

create function public.eacsc_prepare_version_upload(
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
language sql
security invoker
set search_path = ''
as $entry$
  select eacsc_private.prepare_version_upload(
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
$entry$;

revoke all on function public.eacsc_prepare_version_upload(
  text,integer,text,text,bigint,text,text,text,uuid
) from public,anon,authenticated,service_role;

grant execute on function public.eacsc_prepare_version_upload(
  text,integer,text,text,bigint,text,text,text,uuid
) to authenticated;

comment on table eacsc_private.upload_requests is
'Immutable upload preparation facts. Preparation does not upload or verify bytes, create an accepted version, approve content or release it. Future trusted handlers must recheck current authority and expiry, verify bytes, and coordinate finalization or cleanup.';

comment on function public.eacsc_prepare_version_upload(
  text,integer,text,text,bigint,text,text,text,uuid
) is
'Prepare a new attachment version on an existing assigned record. Requires current active author/custodian scope. Atomically saves preparation facts, audit and retry receipt. Returns no upload capability. Planned version number is rechecked during future finalization. Expired acknowledgments do not renew permission.';

notify pgrst,'reload schema';
commit;
