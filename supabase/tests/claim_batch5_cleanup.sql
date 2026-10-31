-- Claim only the three reviewed fictional uploads. This deletes no files.
do $claim$
declare
  item record;
  plan jsonb;
  matched integer := 0;
begin
  if current_user <> 'postgres' then raise exception 'Run as postgres.'; end if;

  for item in
    select u.*, t.accepted_file
    from (values
      (
        '96cc9940-c91b-4ea2-a51a-a0d8c5c0eed1'::uuid,
        'bafc80fc-9bd0-4ebc-88ad-419f9dbb3d07'::uuid,
        false
      ),
      (
        '4f678b00-8ffa-4afc-9aeb-6a6ddc1ee60c'::uuid,
        '7ac31833-d6dc-44b9-a982-10410f2e82e0'::uuid,
        false
      ),
      (
        '50ef7a84-1e71-4f97-8483-0725b39b0800'::uuid,
        'b18b9b90-cd2f-4362-9303-0cdfc47bb594'::uuid,
        true
      )
    ) t(request_id, upload_id, accepted_file)
    join eacsc_private.upload_requests u
      on u.request_id = t.request_id and u.upload_id = t.upload_id
    join public.app_users a on a.user_id = u.actor_user_id
    where a.email = 'batch4-author@example.invalid'
      and u.record_id = 'EACSC-2099-HTTP-9601'
    order by u.upload_id
  loop
    plan := public.eacsc_plan_upload_cleanup(item.upload_id, false);

    if (plan->>'eligible')::boolean is distinct from true then
      raise exception 'Preparation has not expired: %', item.upload_id;
    end if;

    if item.accepted_file then
      if plan->>'terminal_decision' is distinct from 'accepted'
        or plan->>'preserved_final_key' is distinct from item.destination_key then
        raise exception 'Accepted-file preservation check failed.';
      end if;
    elsif plan->>'terminal_decision' not in ('none', 'cleanup_authorized') then
      raise exception 'An unexpected accepted upload was found.';
    end if;

    if plan->'existing_candidates' is distinct from '[]'::jsonb
      and plan->'existing_candidates'
        is distinct from jsonb_build_array(item.staging_key) then
      raise exception
        'Existing objects differ from the reviewed staging-only preview: %',
        item.upload_id;
    end if;

    plan := public.eacsc_plan_upload_cleanup(item.upload_id, true);

    if (plan->>'deletion_authorized')::boolean is distinct from true
      or plan->>'terminal_decision' is distinct from
        (case when item.accepted_file
          then 'accepted' else 'cleanup_authorized' end) then
      raise exception 'Cleanup decision changed; stop and inspect.';
    end if;

    matched := matched + 1;
  end loop;

  if matched <> 3 then
    raise exception 'Expected exactly three reviewed uploads; found %.', matched;
  end if;
end;
$claim$;

select
  u.upload_id,
  d.disposition as terminal_decision,
  u.bucket_id,
  u.staging_key as remove_this_staging_object,
  case when d.disposition = 'accepted'
    then u.destination_key end as keep_this_final_object
from eacsc_private.upload_requests u
join public.app_users a on a.user_id = u.actor_user_id
join eacsc_private.upload_dispositions d on d.upload_id = u.upload_id
where a.email = 'batch4-author@example.invalid'
  and u.record_id = 'EACSC-2099-HTTP-9601'
  and u.upload_id in (
    'bafc80fc-9bd0-4ebc-88ad-419f9dbb3d07'::uuid,
    '7ac31833-d6dc-44b9-a982-10410f2e82e0'::uuid,
    'b18b9b90-cd2f-4362-9303-0cdfc47bb594'::uuid
  )
order by u.upload_id;
