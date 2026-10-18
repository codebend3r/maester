create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create table public.members (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null,
  status text not null default 'pending' check (status in ('pending', 'approved', 'revoked')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table private.owner (
  singleton boolean primary key default true check (singleton),
  account_id uuid not null unique references public.members (id) on delete restrict
);

revoke all on public.members from public, anon, authenticated;
revoke all on private.owner from public, anon, authenticated;
grant select on public.members to authenticated;
alter table public.members enable row level security;
alter table private.owner enable row level security;

create policy read_own_membership on public.members for select to authenticated
using (id = (select auth.uid()));

create function private.enrol_confirmed_user()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if new.email_confirmed_at is not null and new.email is not null then
    insert into public.members (id, email)
    values (new.id, new.email)
    on conflict (id) do update set email = excluded.email, updated_at = now();
  end if;
  return new;
end;
$$;
revoke all on function private.enrol_confirmed_user() from public, anon, authenticated;

create trigger enrol_confirmed_user
  after insert or update of email_confirmed_at, email on auth.users
  for each row execute function private.enrol_confirmed_user();

-- A privileged migration may run after Auth has already accepted signups.
insert into public.members (id, email)
select id, email from auth.users where email_confirmed_at is not null and email is not null
on conflict (id) do nothing;

create function private.is_owner()
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from private.owner o
    join public.members m on m.id = o.account_id
    where o.account_id = (select auth.uid()) and m.status = 'approved'
  );
$$;
revoke all on function private.is_owner() from public, anon, authenticated;

-- The server uses the caller's JWT, not a service-role key or cached role claim.
create function public.current_membership()
returns table (id uuid, email text, status text, is_owner boolean)
language sql stable security definer set search_path = ''
as $$
  select m.id, m.email, m.status, private.is_owner()
  from public.members m where m.id = (select auth.uid());
$$;
revoke all on function public.current_membership() from public, anon, authenticated;
grant execute on function public.current_membership() to authenticated;

create function public.list_members(page_size integer default 100, page_offset integer default 0)
returns table (id uuid, email text, status text, is_owner boolean)
language plpgsql stable security definer set search_path = ''
as $$
begin
  if not private.is_owner() then
    raise exception 'Only the owner can list members' using errcode = '42501';
  end if;
  if page_size is null or page_size < 1 or page_size > 100 or page_offset is null or page_offset < 0 then
    raise exception 'Invalid pagination' using errcode = '22023';
  end if;
  return query
    select m.id, m.email, m.status, exists (select 1 from private.owner o where o.account_id = m.id)
    from public.members m order by m.created_at, m.id limit page_size offset page_offset;
end;
$$;
revoke all on function public.list_members(integer, integer) from public, anon, authenticated;
grant execute on function public.list_members(integer, integer) to authenticated;

create function public.set_member_status(member_id uuid, member_status text)
returns table (id uuid, email text, status text, is_owner boolean)
language plpgsql security definer set search_path = ''
as $$
begin
  if not private.is_owner() then
    raise exception 'Only the owner can change access' using errcode = '42501';
  end if;
  if member_status is null or member_status not in ('approved', 'revoked') then
    raise exception 'Expected approved or revoked' using errcode = '22023';
  end if;
  if exists (select 1 from private.owner o where o.account_id = member_id) then
    raise exception 'The owner cannot be changed here' using errcode = '42501';
  end if;
  return query
    update public.members m set status = member_status, updated_at = now()
    where m.id = member_id returning m.id, m.email, m.status, false;
  if not found then
    raise exception 'Verified member not found' using errcode = 'P0002';
  end if;
end;
$$;
revoke all on function public.set_member_status(uuid, text) from public, anon, authenticated;
grant execute on function public.set_member_status(uuid, text) to authenticated;
