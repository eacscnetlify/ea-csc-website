begin;

-- Grant authenticated users read access to folder_id on master_records
-- so Document Workspace and Release Panel queries including folder_id succeed.
grant select (
  folder_id
)
on table public.master_records
to authenticated;

notify pgrst, 'reload schema';

commit;
