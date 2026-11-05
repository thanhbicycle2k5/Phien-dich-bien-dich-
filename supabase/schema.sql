create table if not exists public.interslation_user_progress (
  user_id uuid primary key references auth.users (id) on delete cascade,
  payload jsonb not null default '{"version":1,"progress":{"history":[],"materials":[],"topics":[],"drafts":{},"historyTombstones":[]},"media":[]}'::jsonb,
  updated_at timestamptz not null default now()
);

do $$
declare
  primary_key_name text;
  primary_key_columns text[];
begin
  select constraint_info.conname, array_agg(attribute_info.attname::text order by key_column.ordinality)
  into primary_key_name, primary_key_columns
  from pg_constraint as constraint_info
  cross join lateral unnest(constraint_info.conkey) with ordinality as key_column(attnum, ordinality)
  join pg_attribute as attribute_info
    on attribute_info.attrelid = constraint_info.conrelid
    and attribute_info.attnum = key_column.attnum
  where constraint_info.conrelid = 'public.interslation_user_progress'::regclass
    and constraint_info.contype = 'p'
  group by constraint_info.conname;

  if primary_key_name is not null
    and primary_key_columns is distinct from array['user_id']::text[] then
    execute format(
      'alter table public.interslation_user_progress drop constraint %I',
      primary_key_name
    );
    primary_key_name := null;
  end if;

  if primary_key_name is null then
    alter table public.interslation_user_progress
      add constraint interslation_user_progress_pkey primary key (user_id);
  end if;
end
$$;

alter table public.interslation_user_progress enable row level security;

drop policy if exists "Users can manage their own Interslation progress"
  on public.interslation_user_progress;
create policy "Users can manage their own Interslation progress"
  on public.interslation_user_progress
  for all
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

grant select, insert, update on public.interslation_user_progress to authenticated;

insert into storage.buckets (id, name, public, file_size_limit)
values ('interslation-user-progress', 'interslation-user-progress', false, 52428800)
on conflict (id) do update
set public = false,
    file_size_limit = 52428800;

drop policy if exists "Users can access their own Interslation recordings" on storage.objects;
create policy "Users can access their own Interslation recordings"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'interslation-user-progress'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

drop policy if exists "Users can insert their own Interslation recordings" on storage.objects;
create policy "Users can insert their own Interslation recordings"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'interslation-user-progress'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

drop policy if exists "Users can update their own Interslation recordings" on storage.objects;
create policy "Users can update their own Interslation recordings"
  on storage.objects for update to authenticated
  using (
    bucket_id = 'interslation-user-progress'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  )
  with check (
    bucket_id = 'interslation-user-progress'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

drop policy if exists "Users can delete their own Interslation recordings" on storage.objects;
create policy "Users can delete their own Interslation recordings"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'interslation-user-progress'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );
