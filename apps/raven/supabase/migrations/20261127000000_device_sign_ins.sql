-- Signing in on a TV by scanning a code. The TV starts a sign-in and shows its user code, as text
-- and inside a QR code; a phone that is already signed in approves that code; the TV, which has
-- been asking with its device code all the while, is then handed a session of the approver's by
-- the `device-sign-in` Edge Function. A row lives ten minutes and is spent by the first claim.
create table private.device_sign_ins (
  -- The TV's secret, kept only as its SHA-256: a read of this table hands out no sign-in.
  device_code_hash bytea primary key,
  -- What the TV shows: eight consonants, so no code spells a word and none needs a shift key.
  user_code text not null unique check (user_code ~ '^[BCDFGHJKLMNPQRSTVWXZ]{8}$'),
  -- What the approver is shown, so they know which screen they are letting in.
  device_name text not null check (char_length(device_name) between 1 and 80),
  status text not null default 'pending' check (status in ('pending', 'approved')),
  user_id uuid references auth.users (id) on delete cascade,
  expires_at timestamptz not null,
  check ((status = 'approved') = (user_id is not null))
);
revoke all on private.device_sign_ins from public, anon, authenticated;
alter table private.device_sign_ins enable row level security;

-- A code as it is stored, from one typed or scanned: letters only, upper case, so `bcdf-ghjk`,
-- `BCDF GHJK` and `BCDFGHJK` are the same code.
create function private.device_user_code(code text)
returns text
language sql immutable set search_path = ''
as $$
  select regexp_replace(upper(coalesce(code, '')), '[^A-Z]', '', 'g');
$$;
revoke all on function private.device_user_code(text) from public, anon, authenticated;

-- The TV's first call, made signed out. It answers the secret the TV keeps, the code it shows,
-- how long both last and how often to ask. Rows past their time go as each new one arrives, and
-- the table is capped, so a flood of starts cannot grow it or use up the codes.
create function public.start_device_sign_in(device_name text)
returns table (device_code text, user_code text, expires_in integer, poll_interval integer)
language plpgsql volatile security definer set search_path = ''
as $$
declare
  alphabet constant text := 'BCDFGHJKLMNPQRSTVWXZ';
  label constant text := left(btrim(coalesce(start_device_sign_in.device_name, '')), 80);
  secret constant text := encode(extensions.gen_random_bytes(32), 'hex');
  shown text;
begin
  if label = '' then
    raise exception 'A device needs a name' using errcode = '22023';
  end if;
  delete from private.device_sign_ins d where d.expires_at < now();
  if (select count(*) from private.device_sign_ins) >= 500 then
    raise exception 'Too many devices are signing in. Try again in a few minutes.' using errcode = '53400';
  end if;
  select string_agg(substr(alphabet, 1 + get_byte(r.bytes, i.at) % 20, 1), '' order by i.at)
    into shown
    from (select extensions.gen_random_bytes(8) as bytes) r, generate_series(0, 7) as i (at);
  insert into private.device_sign_ins as d (device_code_hash, user_code, device_name, expires_at)
  values (sha256(convert_to(secret, 'UTF8')), shown, label, now() + interval '10 minutes');
  return query select secret, shown, 600, 5;
end;
$$;
revoke all on function public.start_device_sign_in(text) from public, anon, authenticated;
grant execute on function public.start_device_sign_in(text) to anon, authenticated;

-- What the approve page shows before the button: the name of the device a code belongs to, or
-- null for a code that is unknown, spent or past its time.
create function public.device_sign_in_request(code text)
returns text
language sql stable security definer set search_path = ''
as $$
  select d.device_name from private.device_sign_ins d
  where d.user_code = private.device_user_code(code)
    and d.status = 'pending' and d.expires_at > now();
$$;
revoke all on function public.device_sign_in_request(text) from public, anon, authenticated;
grant execute on function public.device_sign_in_request(text) to authenticated;

-- The signed-in account lets the device showing `code` in as itself. False for a code that is
-- unknown, already approved or past its time.
create function public.approve_device_sign_in(code text)
returns boolean
language plpgsql volatile security definer set search_path = ''
as $$
declare
  caller constant uuid := (select auth.uid());
begin
  if caller is null then
    raise exception 'Sign in to approve a device' using errcode = '42501';
  end if;
  update private.device_sign_ins d set status = 'approved', user_id = caller
  where d.user_code = private.device_user_code(code)
    and d.status = 'pending' and d.expires_at > now();
  return found;
end;
$$;
revoke all on function public.approve_device_sign_in(text) from public, anon, authenticated;
grant execute on function public.approve_device_sign_in(text) to authenticated;

-- The Edge Function's call, with the service role and the TV's secret: `pending` while nobody
-- has approved, `gone` for a secret that is unknown or past its time, and once approved the
-- approver's address, with the row spent in the same statement so a secret signs in one device.
create function public.claim_device_sign_in(device_code text)
returns table (status text, email text)
language plpgsql volatile security definer set search_path = ''
as $$
declare
  hashed constant bytea := sha256(convert_to(coalesce(claim_device_sign_in.device_code, ''), 'UTF8'));
  held text;
  approver uuid;
begin
  select d.status, d.user_id into held, approver from private.device_sign_ins d
  where d.device_code_hash = hashed and d.expires_at > now()
  for update;
  if held is null then
    return query select 'gone'::text, null::text;
    return;
  end if;
  if held = 'pending' then
    return query select 'pending'::text, null::text;
    return;
  end if;
  delete from private.device_sign_ins d where d.device_code_hash = hashed;
  return query select 'approved'::text, u.email::text from auth.users u where u.id = approver;
end;
$$;
revoke all on function public.claim_device_sign_in(text) from public, anon, authenticated;
grant execute on function public.claim_device_sign_in(text) to service_role;
