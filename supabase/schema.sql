create table if not exists public.interslation_user_progress (
  user_id uuid primary key references auth.users (id) on delete cascade,
  payload jsonb not null default '{"version":1,"progress":{"history":[],"materials":[],"topics":[],"drafts":{},"historyTombstones":[]},"media":[]}'::jsonb,
  updated_at timestamptz not null default now()
);

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
