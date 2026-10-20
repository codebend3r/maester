create extension if not exists pg_net with schema extensions;

-- Sign-ups confirmed before approve_until start approved; later ones wait for the owner.
create table private.enrolment (
  singleton boolean primary key default true check (singleton),
  approve_until timestamptz not null
);
revoke all on private.enrolment from public, anon, authenticated;
alter table private.enrolment enable row level security;
insert into private.enrolment (approve_until) values ('2026-12-01 00:00 America/New_York');

create or replace function private.enrol_confirmed_user()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if new.email_confirmed_at is not null and new.email is not null then
    insert into public.members (id, email, status)
    values (
      new.id,
      new.email,
      case when exists (select 1 from private.enrolment where now() < approve_until)
        then 'approved' else 'pending' end
    )
    on conflict (id) do update set email = excluded.email, updated_at = now();
  end if;
  return new;
end;
$$;

-- The signup-alert Edge Function's address and shared secret live in Vault, set by the
-- operator. Without them (a local stack, a fresh project) sign-ups still enrol, unannounced.
create function private.alert_signup()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  alert_url text := (select decrypted_secret from vault.decrypted_secrets where name = 'signup_alert_url');
  alert_secret text := (select decrypted_secret from vault.decrypted_secrets where name = 'signup_alert_secret');
begin
  if alert_url is null or alert_secret is null then
    raise warning 'Sign-up alerts are not configured';
    return new;
  end if;
  perform net.http_post(
    url := alert_url,
    body := jsonb_build_object('email', new.email, 'status', new.status),
    headers := jsonb_build_object('content-type', 'application/json', 'x-signup-alert-secret', alert_secret)
  );
  return new;
end;
$$;
revoke all on function private.alert_signup() from public, anon, authenticated;

create trigger alert_signup
  after insert on public.members
  for each row execute function private.alert_signup();
