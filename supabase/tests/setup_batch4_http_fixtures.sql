-- Development only: persistent fictional fixtures for real HTTP tests.
-- Apply ONCE after migration 20261030000400. These are not rollback fixtures.
-- Retain them and their audit history after successful HTTP mutations.
do $setup_http$
declare
  author_id uuid; custodian_id uuid; inactive_id uuid; no_profile_id uuid;
  fixture_no integer;
begin
  if current_user <> 'postgres' then raise exception 'Run as postgres in the development project.'; end if;
  select id into strict author_id from auth.users where lower(email)='batch4-author@example.invalid' and email_confirmed_at is not null;
  select id into strict custodian_id from auth.users where lower(email)='batch4-custodian@example.invalid' and email_confirmed_at is not null;
  select id into strict inactive_id from auth.users where lower(email)='batch4-inactive@example.invalid' and email_confirmed_at is not null;
  select id into strict no_profile_id from auth.users where lower(email)='batch4-no-profile@example.invalid' and email_confirmed_at is not null;
  if not exists(select 1 from public.app_users where user_id=author_id and is_active and functional_roles=array['author']::text[])
    or not exists(select 1 from public.app_users where user_id=custodian_id and is_active and functional_roles=array['custodian']::text[])
    or not exists(select 1 from public.app_users where user_id=inactive_id and not is_active and functional_roles=array['author']::text[])
    or exists(select 1 from public.app_users where user_id=no_profile_id) then
    raise exception 'Expected the original four Batch 4 identities and three fixture profiles. Stop and inspect.';
  end if;
  if exists(select 1 from public.master_records where record_id like 'EACSC-2099-HTTP-%')
    or exists(select 1 from public.record_versions where version_id in (
      'b4000000-0000-4000-8000-000000009601','b4000000-0000-4000-8000-000000009602',
      'b4000000-0000-4000-8000-000000009603','b4000000-0000-4000-8000-000000009604',
      'b4000000-0000-4000-8000-000000009605')) then
    raise exception 'HTTP fixture IDs already exist. Do not rerun setup or delete their history. The runner can reuse them.';
  end if;
  for fixture_no in 9601..9605 loop
    insert into public.master_records(record_id,title,summary,category,document_type,originating_office,custodian_position,access_class)
    values('EACSC-2099-HTTP-'||fixture_no,'FICTIONAL HTTP TEST '||fixture_no,
      'Development fixture; no actual council record or publication.',
      'Forms and official information','Fictional test form','Fictional test office','Fictional custodian',
      case when fixture_no in (9602,9605) then 'restricted' else 'internal' end);
    insert into public.record_versions(version_id,record_id,version_number,state,change_summary,
      storage_key,original_filename,mime_type,file_size_bytes,sha256)
    values(('b4000000-0000-4000-8000-00000000'||fixture_no)::uuid,'EACSC-2099-HTTP-'||fixture_no,1,
      case when fixture_no=9604 then 'For Review' else 'Draft' end,'Original fictional HTTP notes.',
      case when fixture_no=9604 then 'batch4-http-fixtures/no-object-review.pdf' end,
      case when fixture_no=9604 then 'fictional-no-object.pdf' end,
      case when fixture_no=9604 then 'application/pdf' end,
      case when fixture_no=9604 then 128 end,
      case when fixture_no=9604 then repeat('a',64) end);
  end loop;
  -- No actual file is uploaded; the For Review row only models schema metadata.
  insert into public.record_assignments(record_id,user_id,assignment_function,is_active,allow_restricted,assigned_by)
  values
    ('EACSC-2099-HTTP-9601',author_id,'author',true,false,custodian_id),
    ('EACSC-2099-HTTP-9601',custodian_id,'custodian',true,false,custodian_id),
    ('EACSC-2099-HTTP-9601',inactive_id,'author',true,false,custodian_id),
    ('EACSC-2099-HTTP-9602',author_id,'author',true,false,custodian_id),
    ('EACSC-2099-HTTP-9602',custodian_id,'custodian',true,false,custodian_id),
    ('EACSC-2099-HTTP-9604',author_id,'author',true,false,custodian_id),
    ('EACSC-2099-HTTP-9604',custodian_id,'custodian',true,false,custodian_id),
    ('EACSC-2099-HTTP-9605',author_id,'author',true,false,custodian_id),
    ('EACSC-2099-HTTP-9605',custodian_id,'custodian',true,true,custodian_id);
  raise notice 'READY: five persistent fictional HTTP records and nine assignments. Retain their audit history.';
end;
$setup_http$;

select record_id, state, revision_counter from public.record_versions
where record_id like 'EACSC-2099-HTTP-%' order by record_id;
