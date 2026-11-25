-- The name an account gives a server that has no row of its own in `account_servers`: the home
-- server an app was built for or served from. Keyed on the server's own id, like the pins.
create table public.server_names (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  server_id uuid not null,
  name text not null check (char_length(name) between 1 and 80 and name = btrim(name)),
  named_at timestamptz not null default now(),
  primary key (user_id, server_id)
);

-- The account's own choices that follow it to every app. One row per account, written on first
-- change; an account without one reads the defaults.
create table public.account_preferences (
  user_id uuid primary key default auth.uid() references auth.users (id) on delete cascade,
  show_pin_servers boolean not null default true
);

-- A client writes only what it chooses: the owner and the time are the database's.
revoke all on public.server_names from public, anon, authenticated;
revoke all on public.account_preferences from public, anon, authenticated;
grant select, delete on public.server_names to authenticated;
grant insert (server_id, name) on public.server_names to authenticated;
-- PostgREST's upsert sets every column it was sent, the key's included, so both are granted.
grant update (server_id, name) on public.server_names to authenticated;
grant select on public.account_preferences to authenticated;
grant insert (show_pin_servers) on public.account_preferences to authenticated;
grant update (show_pin_servers) on public.account_preferences to authenticated;
alter table public.server_names enable row level security;
alter table public.account_preferences enable row level security;

create policy read_own_server_names on public.server_names for select to authenticated
using (user_id = (select auth.uid()));
create policy add_own_server_names on public.server_names for insert to authenticated
with check (user_id = (select auth.uid()));
create policy change_own_server_names on public.server_names for update to authenticated
using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy remove_own_server_names on public.server_names for delete to authenticated
using (user_id = (select auth.uid()));

create policy read_own_preferences on public.account_preferences for select to authenticated
using (user_id = (select auth.uid()));
create policy add_own_preferences on public.account_preferences for insert to authenticated
with check (user_id = (select auth.uid()));
create policy change_own_preferences on public.account_preferences for update to authenticated
using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-- The same cap as the server list (`SERVERS_CAP` in `@raven/core`), held the same way. An upsert
-- that renames a server already named passes through this trigger too, so it is let by.
create function private.cap_server_names()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  perform pg_advisory_xact_lock(hashtextextended('server_names:' || new.user_id::text, 0));
  if (select count(*) from public.server_names s where s.user_id = new.user_id) >= 20
    and not exists (
      select 1 from public.server_names s where s.user_id = new.user_id and s.server_id = new.server_id
    ) then
    raise exception 'At most 20 server names per account' using errcode = '23514';
  end if;
  return new;
end;
$$;
revoke all on function private.cap_server_names() from public, anon, authenticated;

create trigger cap_server_names
  before insert on public.server_names
  for each row execute function private.cap_server_names();
