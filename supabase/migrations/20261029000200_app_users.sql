begin;

create table public.app_users (
  user_id uuid primary key
    references auth.users(id)
    on delete restrict,

  email varchar(320) not null,

  full_name varchar(160) not null,

  council_position varchar(160),

  functional_roles text[] not null default '{}'::text[],

  is_active boolean not null default false,

  revision_counter integer not null default 1,

  created_at timestamptz not null default now(),

  updated_at timestamptz not null default now(),

  constraint app_users_email_format
    check (
      email ~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$'
    ),

  constraint app_users_full_name_not_blank
    check (
      char_length(btrim(full_name)) > 0
    ),

  constraint app_users_position_not_blank
    check (
      council_position is null
      or char_length(btrim(council_position)) > 0
    ),

  constraint app_users_roles_allowed
    check (
      functional_roles <@ array[
        'author',
        'custodian',
        'reviewer',
        'approver',
        'publisher',
        'technical_admin'
      ]::text[]
      and array_position(functional_roles, null) is null
    ),

  constraint app_users_revision_positive
    check (
      revision_counter >= 1
    ),

  constraint app_users_timestamp_order
    check (
      updated_at >= created_at
    )
);

create unique index app_users_email_lower_unique
  on public.app_users (lower(email));

create index app_users_is_active_index
  on public.app_users (is_active);

alter table public.app_users
  enable row level security;

revoke all privileges on table public.app_users
  from public, anon, authenticated;

comment on table public.app_users
is 'Named officer profiles linked to Supabase Auth identities. Client access is denied until controlled policies and commands are implemented.';

comment on column public.app_users.functional_roles
is 'Assigned functional categories. Technical administration does not imply substantive approval authority.';

comment on column public.app_users.is_active
is 'Profiles start inactive. Protected operations must check active status when authorization is implemented.';

comment on column public.app_users.updated_at
is 'Initially set at creation. Future controlled update commands must maintain this timestamp.';

notify pgrst, 'reload schema';

commit;
