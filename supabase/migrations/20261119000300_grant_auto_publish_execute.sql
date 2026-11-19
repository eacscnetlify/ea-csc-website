-- Allow security-invoker eacsc_approve_version to call eacsc_private.auto_publish_internal_release
begin;
grant execute on function eacsc_private.auto_publish_internal_release(uuid, uuid) to authenticated;
commit;
