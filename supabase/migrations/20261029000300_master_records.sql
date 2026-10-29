begin;

create table public.master_records (
  record_id varchar(50) primary key,

  title varchar(240) not null,
  summary text not null default '',
  category varchar(80) not null,
  document_type varchar(80) not null,

  originating_office varchar(160) not null,
  custodian_position varchar(160) not null,

  access_class varchar(10) not null default 'internal',
  public_contact varchar(320),

  record_date date,

  retention_category varchar(120) not null
    default 'Pending classification',
  retention_review_on date,
  retention_rule text,

  revision_counter integer not null default 1,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint master_records_id_format
    check (
      record_id ~ '^EACSC-[1-9][0-9]{3}-[A-Z]{2,10}-[0-9]{4}$'
      and right(record_id, 4) <> '0000'
    ),

  constraint master_records_category_allowed
    check (
      category in (
        'Governance and legislation',
        'Secretariat and proceedings',
        'Activities and CBO records',
        'Financial archives',
        'Forms and official information',
        'Turnover and continuity'
      )
    ),

  constraint master_records_access_class_allowed
    check (
      access_class in (
        'public',
        'internal',
        'restricted'
      )
    ),

  constraint master_records_required_metadata_not_blank
    check (
      char_length(btrim(title)) > 0
      and char_length(btrim(document_type)) > 0
      and char_length(btrim(originating_office)) > 0
      and char_length(btrim(custodian_position)) > 0
      and char_length(btrim(retention_category)) > 0
    ),

  constraint master_records_optional_metadata_not_blank
    check (
      (
        public_contact is null
        or char_length(btrim(public_contact)) > 0
      )
      and (
        retention_rule is null
        or char_length(btrim(retention_rule)) > 0
      )
    ),

  constraint master_records_revision_positive
    check (revision_counter >= 1),

  constraint master_records_timestamp_order
    check (updated_at >= created_at)
);

create index master_records_title_search_index
  on public.master_records
  using gin (
    to_tsvector('simple'::regconfig, title)
  );

create index master_records_id_search_index
  on public.master_records
  using gin (
    to_tsvector('simple'::regconfig, record_id)
  );

alter table public.master_records
  enable row level security;

revoke all privileges on table public.master_records
  from public, anon, authenticated;

comment on table public.master_records
is 'Permanent document identities and record-level metadata. Client access remains denied until controlled policies and commands are implemented.';

comment on column public.master_records.record_id
is 'Persistent identifier shared by all versions of a document. Operational identifiers must be allocated by the backend.';

comment on column public.master_records.access_class
is 'Record classification only. Public classification does not itself authorize publication or public access.';

comment on column public.master_records.record_date
is 'Creation or receipt date of the underlying document, when known. Separate from database row creation time.';

comment on column public.master_records.retention_category
is 'Pending classification is a placeholder until an applicable retention category is assigned. It does not authorize disposal.';

comment on column public.master_records.retention_rule
is 'Applicable retention authority or rule, when assigned. Disposal requires an authorized review.';

comment on column public.master_records.revision_counter
is 'Starts at one. Future controlled updates must compare the expected revision and increment it atomically.';

comment on column public.master_records.updated_at
is 'Initially set at creation. Future controlled update commands must maintain this timestamp.';

notify pgrst, 'reload schema';

commit;
