begin;

create table public.update_bulletins (
  bulletin_id varchar(50) not null,
  issue_version integer not null default 1,
  issue_uuid uuid not null default gen_random_uuid(),
  revision_counter integer not null default 1,

  title varchar(240) not null,

  coverage_start date not null,
  coverage_end date not null,
  cutoff_at timestamptz not null,

  audience varchar(10) not null default 'internal',
  issue_status varchar(12) not null default 'Draft',

  source_snapshot jsonb not null default '[]'::jsonb,

  archive_record_id varchar(50),
  archive_version_id uuid,

  pdf_storage_key text,
  pdf_size_bytes bigint,
  pdf_sha256 varchar(64),

  prepared_by uuid not null,
  issued_by uuid,
  issued_at timestamptz,
  publication_reference text,

  issuance_request_id uuid,

  corrects_issue_uuid uuid,
  correction_reason text,

  withdrawn_by uuid,
  withdrawn_at timestamptz,
  withdrawal_reason text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint update_bulletins_pkey
    primary key (bulletin_id, issue_version),

  constraint update_bulletins_issue_uuid_unique
    unique (issue_uuid),

  constraint update_bulletins_request_unique
    unique (issuance_request_id),

  constraint update_bulletins_pdf_key_unique
    unique (pdf_storage_key),

  constraint update_bulletins_preparer_fk
    foreign key (prepared_by)
    references public.app_users (user_id)
    on delete restrict,

  constraint update_bulletins_issuer_fk
    foreign key (issued_by)
    references public.app_users (user_id)
    on delete restrict,

  constraint update_bulletins_withdrawer_fk
    foreign key (withdrawn_by)
    references public.app_users (user_id)
    on delete restrict,

  constraint update_bulletins_corrected_issue_fk
    foreign key (corrects_issue_uuid)
    references public.update_bulletins (issue_uuid)
    on delete restrict,

  constraint update_bulletins_archive_record_fk
    foreign key (archive_record_id)
    references public.master_records (record_id)
    on delete restrict,

  constraint update_bulletins_archive_version_fk
    foreign key (archive_record_id, archive_version_id)
    references public.record_versions (record_id, version_id)
    on delete restrict,

  constraint update_bulletins_id_format
    check (
      bulletin_id ~ '^EACSC-[1-9][0-9]{3}-BUL-[0-9]{4}$'
      and right(bulletin_id, 4) <> '0000'
    ),

  constraint update_bulletins_issue_version_positive
    check (issue_version >= 1),

  constraint update_bulletins_revision_positive
    check (revision_counter >= 1),

  constraint update_bulletins_title_not_blank
    check (char_length(btrim(title)) > 0),

  constraint update_bulletins_coverage_order
    check (coverage_end >= coverage_start),

  constraint update_bulletins_cutoff_covers_period
    check (
      (cutoff_at at time zone 'Asia/Manila')::date
      >= coverage_end
    ),

  constraint update_bulletins_audience_allowed
    check (
      audience in ('public', 'internal')
    ),

  constraint update_bulletins_status_allowed
    check (
      issue_status in (
        'Draft',
        'Preparing',
        'Issued',
        'Withdrawn',
        'Failed'
      )
    ),

  constraint update_bulletins_sources_are_array
    check (
      jsonb_typeof(source_snapshot) = 'array'
    ),

  constraint update_bulletins_archive_reference_complete
    check (
      (
        archive_record_id is null
        and archive_version_id is null
      )
      or (
        archive_record_id is not null
        and archive_version_id is not null
      )
    ),

  constraint update_bulletins_pdf_metadata_complete
    check (
      (
        pdf_storage_key is null
        and pdf_size_bytes is null
        and pdf_sha256 is null
      )
      or (
        pdf_storage_key is not null
        and pdf_size_bytes is not null
        and pdf_sha256 is not null
      )
    ),

  constraint update_bulletins_pdf_metadata_valid
    check (
      pdf_storage_key is null
      or (
        char_length(btrim(pdf_storage_key)) > 0
        and pdf_size_bytes between 1 and 10000000
        and pdf_sha256 ~ '^[0-9a-fA-F]{64}$'
      )
    ),

  constraint update_bulletins_publication_reference_not_blank
    check (
      publication_reference is null
      or char_length(btrim(publication_reference)) > 0
    ),

  constraint update_bulletins_issuance_metadata_complete
    check (
      (
        issue_status in ('Draft', 'Preparing', 'Failed')
        and issued_by is null
        and issued_at is null
        and publication_reference is null
        and pdf_storage_key is null
        and archive_record_id is null
        and archive_version_id is null
      )
      or (
        issue_status in ('Issued', 'Withdrawn')
        and issued_by is not null
        and issued_at is not null
        and issued_at >= cutoff_at
        and publication_reference is not null
        and issuance_request_id is not null
        and pdf_storage_key is not null
        and archive_record_id is not null
        and archive_version_id is not null
        and case
          when jsonb_typeof(source_snapshot) = 'array'
            then jsonb_array_length(source_snapshot) > 0
          else false
        end
      )
    ),

  constraint update_bulletins_withdrawal_metadata_complete
    check (
      (
        issue_status = 'Withdrawn'
        and withdrawn_by is not null
        and withdrawn_at is not null
        and withdrawn_at >= issued_at
        and withdrawal_reason is not null
        and char_length(btrim(withdrawal_reason)) > 0
      )
      or (
        issue_status <> 'Withdrawn'
        and withdrawn_by is null
        and withdrawn_at is null
        and withdrawal_reason is null
      )
    ),

  constraint update_bulletins_correction_reference_complete
    check (
      (
        corrects_issue_uuid is null
        and correction_reason is null
      )
      or (
        corrects_issue_uuid is not null
        and corrects_issue_uuid <> issue_uuid
        and correction_reason is not null
        and char_length(btrim(correction_reason)) > 0
      )
    ),

  constraint update_bulletins_timestamp_order
    check (updated_at >= created_at)
);

create index update_bulletins_audience_issue_time_index
  on public.update_bulletins (
    audience,
    issue_status,
    issued_at desc
  );

create index update_bulletins_preparer_index
  on public.update_bulletins (prepared_by);

create index update_bulletins_corrected_issue_index
  on public.update_bulletins (corrects_issue_uuid);

alter table public.update_bulletins
  enable row level security;

revoke all privileges on table public.update_bulletins
  from public, anon, authenticated, service_role;

comment on table public.update_bulletins
is 'Bulletin issue metadata and preserved artifact references. Direct application access is denied. Protected issuance and issued-content immutability must be implemented before operational use.';

comment on column public.update_bulletins.bulletin_id
is 'Persistent bulletin identifier. Issue versions distinguish successive issues or corrections within the same bulletin identity.';

comment on column public.update_bulletins.coverage_start
is 'First reporting date, interpreted using the Asia/Manila reporting convention.';

comment on column public.update_bulletins.coverage_end
is 'Last reporting date. The exact inclusion boundary is also limited by the disclosed cutoff timestamp.';

comment on column public.update_bulletins.source_snapshot
is 'Source selection snapshot. Protected issuance must validate each record, version, release, audience, and disclosure status, then freeze the issued selection. An array shape check does not validate its references.';

comment on column public.update_bulletins.archive_version_id
is 'Version containing the preserved bulletin PDF in the shared records archive. Protected issuance must verify matching file identity and applicable verification evidence.';

comment on column public.update_bulletins.pdf_storage_key
is 'Preserved private PDF object key. Preview and staged upload objects are managed separately until successful issuance.';

comment on column public.update_bulletins.issuance_request_id
is 'Unique issuance request identifier. Retried requests must reuse it; protected commands must return the confirmed existing result.';

comment on column public.update_bulletins.corrects_issue_uuid
is 'Earlier issue being corrected. Protected issuance must verify that it is an eligible earlier issued bulletin.';

comment on column public.update_bulletins.issue_status
is 'Bulletin preparation and issuance status. These values are separate from document-version lifecycle states.';

comment on column public.update_bulletins.updated_at
is 'Initially set at creation. Future controlled update commands must maintain this timestamp and the revision counter.';

notify pgrst, 'reload schema';

commit;
