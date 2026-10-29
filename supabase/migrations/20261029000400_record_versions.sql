begin;

create table public.record_versions (
  version_id uuid primary key default gen_random_uuid(),

  record_id varchar(50) not null,
  version_number integer not null,
  revision_counter integer not null default 1,

  state varchar(12) not null default 'Draft',

  previous_version_id uuid,
  change_summary text not null,
  correction_classification varchar(30),

  storage_key text,
  original_filename varchar(255),
  mime_type varchar(100),
  file_size_bytes bigint,
  sha256 varchar(64),

  approved_at timestamptz,
  approval_basis text,
  approval_evidence_reference text,
  approval_not_required_reason text,
  approval_recorded_by uuid,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint record_versions_record_fk
    foreign key (record_id)
    references public.master_records (record_id)
    on delete restrict,

  constraint record_versions_approval_recorder_fk
    foreign key (approval_recorded_by)
    references public.app_users (user_id)
    on delete restrict,

  constraint record_versions_record_number_unique
    unique (record_id, version_number),

  constraint record_versions_record_version_unique
    unique (record_id, version_id),

  constraint record_versions_storage_key_unique
    unique (storage_key),

  constraint record_versions_previous_same_record_fk
    foreign key (record_id, previous_version_id)
    references public.record_versions (record_id, version_id)
    on delete restrict,

  constraint record_versions_number_positive
    check (version_number >= 1),

  constraint record_versions_revision_positive
    check (revision_counter >= 1),

  constraint record_versions_state_allowed
    check (
      state in (
        'Draft',
        'For Review',
        'Approved',
        'Superseded'
      )
    ),

  constraint record_versions_change_summary_not_blank
    check (char_length(btrim(change_summary)) > 0),

  constraint record_versions_previous_not_self
    check (
      previous_version_id is null
      or previous_version_id <> version_id
    ),

  constraint record_versions_correction_allowed
    check (
      correction_classification is null
      or correction_classification in (
        'initial_capture',
        'preventable_correction',
        'legitimate_change'
      )
    ),

  constraint record_versions_file_metadata_complete
    check (
      (
        storage_key is null
        and original_filename is null
        and mime_type is null
        and file_size_bytes is null
        and sha256 is null
      )
      or (
        storage_key is not null
        and original_filename is not null
        and mime_type is not null
        and file_size_bytes is not null
        and sha256 is not null
      )
    ),

  constraint record_versions_file_metadata_valid
    check (
      storage_key is null
      or (
        char_length(btrim(storage_key)) > 0
        and char_length(btrim(original_filename)) > 0
        and mime_type in (
          'application/pdf',
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          'image/jpeg',
          'image/png'
        )
        and file_size_bytes between 1 and 10000000
        and sha256 ~ '^[0-9a-fA-F]{64}$'
      )
    ),

  constraint record_versions_file_required_for_review
    check (
      state = 'Draft'
      or storage_key is not null
    ),

  constraint record_versions_approval_text_not_blank
    check (
      (
        approval_basis is null
        or char_length(btrim(approval_basis)) > 0
      )
      and (
        approval_evidence_reference is null
        or char_length(btrim(approval_evidence_reference)) > 0
      )
      and (
        approval_not_required_reason is null
        or char_length(
          btrim(approval_not_required_reason)
        ) > 0
      )
    ),

  constraint record_versions_approval_metadata_consistent
    check (
      (
        state in ('Draft', 'For Review')
        and approved_at is null
      )
      or (
        state in ('Approved', 'Superseded')
        and approval_basis is not null
        and approval_evidence_reference is not null
        and approval_recorded_by is not null
        and (
          (
            approved_at is not null
            and approval_not_required_reason is null
          )
          or (
            approved_at is null
            and approval_not_required_reason is not null
          )
        )
      )
    ),

  constraint record_versions_timestamp_order
    check (updated_at >= created_at)
);

create index record_versions_previous_version_index
  on public.record_versions (
    record_id,
    previous_version_id
  );

create index record_versions_approval_recorder_index
  on public.record_versions (approval_recorded_by);

alter table public.record_versions
  enable row level security;

revoke all privileges on table public.record_versions
  from public, anon, authenticated;

comment on table public.record_versions
is 'Individual document versions with file identity, lifecycle state, and approval references. Approval does not itself publish a version.';

comment on column public.record_versions.version_number
is 'Document version number within a master record. Allocated by a controlled backend command.';

comment on column public.record_versions.revision_counter
is 'Technical edit revision. Future controlled updates must compare the expected revision and increment it atomically.';

comment on column public.record_versions.previous_version_id
is 'Optional predecessor from the same master record. Controlled version-creation commands must also validate predecessor ordering.';

comment on column public.record_versions.correction_classification
is 'Selected by an authorized operator. NULL means not yet classified; the system must not infer whether a change was a preventable error.';

comment on column public.record_versions.storage_key
is 'Private storage object key, not a public or signed download URL. Each populated key belongs to one version.';

comment on column public.record_versions.sha256
is 'Expected file integrity hash. Format validation does not verify the actual stored bytes.';

comment on column public.record_versions.approval_basis
is 'Applicable approving authority and official basis, including originating external approval when relevant. For an approval exception, record the applicable verification basis.';

comment on column public.record_versions.approval_evidence_reference
is 'Internal reference to approval evidence or, when approval is not applicable, supporting capture-verification evidence.';

comment on column public.record_versions.approval_not_required_reason
is 'Documented reason substantive approval is not applicable. It must not be used to bypass an approval that is required.';

comment on column public.record_versions.approval_recorded_by
is 'Named officer who recorded the evidence or exception. This does not identify that officer as the substantive approving authority.';

comment on column public.record_versions.updated_at
is 'Initially set at creation. Future controlled update commands must maintain this timestamp.';

notify pgrst, 'reload schema';

commit;
