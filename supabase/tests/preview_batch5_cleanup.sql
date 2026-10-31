-- Preview only: p_claim is explicitly false for every request.
with target_ids(request_id, label) as (
  values
    (
      '96cc9940-c91b-4ea2-a51a-a0d8c5c0eed1'::uuid,
      'Earlier staging-only test'
    ),
    (
      '4f678b00-8ffa-4afc-9aeb-6a6ddc1ee60c'::uuid,
      'Rejected plain-text PDF test'
    ),
    (
      '50ef7a84-1e71-4f97-8483-0725b39b0800'::uuid,
      'Accepted PDF staging copy'
    )
), plans as materialized (
  select
    t.label,
    public.eacsc_plan_upload_cleanup(u.upload_id, false) as plan
  from target_ids t
  join eacsc_private.upload_requests u on u.request_id = t.request_id
  join public.app_users a on a.user_id = u.actor_user_id
  where a.email = 'batch4-author@example.invalid'
    and u.record_id = 'EACSC-2099-HTTP-9601'
)
select
  label,
  plan->>'upload_id' as upload_id,
  plan->>'terminal_decision' as terminal_decision,
  (plan->>'eligible')::boolean as eligible,
  (plan->>'deletion_authorized')::boolean as deletion_authorized,
  plan->>'expires_at' as expires_at,
  plan->'existing_candidates' as existing_candidates,
  plan->>'preserved_final_key' as preserved_final_key
from plans
order by label;
