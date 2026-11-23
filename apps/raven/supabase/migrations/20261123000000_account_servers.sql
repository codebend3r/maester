-- Each account's raven servers and library pins, so a server added or a library pinned on one
-- app shows on every app. The server an app was built for or served from needs no row; rows
-- are the extra servers. Both tables key on the server's own id (`serverId` on its
-- `/api/health`), since one server answers at several origins.
create table public.account_servers (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  server_id uuid not null,
  name text not null check (char_length(name) between 1 and 80 and name = btrim(name)),
  origin text not null check (char_length(origin) <= 2048 and origin ~ '^https?://[^/?#@\s\\]+$'),
  added_at timestamptz not null default now(),
  unique (user_id, server_id)
);

create table public.library_pins (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  server_id uuid not null,
  library_id integer not null check (library_id > 0),
  pinned_at timestamptz not null default now(),
  primary key (user_id, server_id, library_id)
);

-- A client writes only what it chooses: the owner, the row id and the times are the database's.
revoke all on public.account_servers from public, anon, authenticated;
revoke all on public.library_pins from public, anon, authenticated;
grant select, delete on public.account_servers to authenticated;
grant insert (server_id, name, origin) on public.account_servers to authenticated;
grant update (name, origin) on public.account_servers to authenticated;
grant select, delete on public.library_pins to authenticated;
grant insert (server_id, library_id) on public.library_pins to authenticated;
alter table public.account_servers enable row level security;
alter table public.library_pins enable row level security;

create policy read_own_servers on public.account_servers for select to authenticated
using (user_id = (select auth.uid()));
create policy add_own_servers on public.account_servers for insert to authenticated
with check (user_id = (select auth.uid()));
create policy change_own_servers on public.account_servers for update to authenticated
using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy remove_own_servers on public.account_servers for delete to authenticated
using (user_id = (select auth.uid()));

create policy read_own_pins on public.library_pins for select to authenticated
using (user_id = (select auth.uid()));
create policy add_own_pins on public.library_pins for insert to authenticated
with check (user_id = (select auth.uid()));
create policy remove_own_pins on public.library_pins for delete to authenticated
using (user_id = (select auth.uid()));

-- The caps match the clients' (`SERVERS_CAP` and `PINS_CAP` in `@raven/core`). The lock holds a
-- second insert for the same account until the first commits, so two at once cannot pass 20.
create function private.cap_account_servers()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  perform pg_advisory_xact_lock(hashtextextended('account_servers:' || new.user_id::text, 0));
  if (select count(*) from public.account_servers s where s.user_id = new.user_id) >= 20 then
    raise exception 'At most 20 servers per account' using errcode = '23514';
  end if;
  return new;
end;
$$;
revoke all on function private.cap_account_servers() from public, anon, authenticated;

create trigger cap_account_servers
  before insert on public.account_servers
  for each row execute function private.cap_account_servers();

create function private.cap_library_pins()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  perform pg_advisory_xact_lock(hashtextextended('library_pins:' || new.user_id::text, 0));
  if (select count(*) from public.library_pins p where p.user_id = new.user_id) >= 100 then
    raise exception 'At most 100 pinned libraries per account' using errcode = '23514';
  end if;
  return new;
end;
$$;
revoke all on function private.cap_library_pins() from public, anon, authenticated;

create trigger cap_library_pins
  before insert on public.library_pins
  for each row execute function private.cap_library_pins();

-- A removed server takes its pins with it, so none is left counting against the cap unseen.
create function private.unpin_removed_server()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  delete from public.library_pins p where p.user_id = old.user_id and p.server_id = old.server_id;
  return old;
end;
$$;
revoke all on function private.unpin_removed_server() from public, anon, authenticated;

create trigger unpin_removed_server
  after delete on public.account_servers
  for each row execute function private.unpin_removed_server();
