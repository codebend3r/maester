-- Member emails: the owner hears of every sign-up, and a member hears when they are approved,
-- by the owner or by the approval window. Every email goes through the signup-alert Edge
-- Function, each payload naming its event, so one address and one secret serve both.
create function private.post_member_mail(payload jsonb)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  alert_url text := (select decrypted_secret from vault.decrypted_secrets where name = 'signup_alert_url');
  alert_secret text := (select decrypted_secret from vault.decrypted_secrets where name = 'signup_alert_secret');
begin
  if alert_url is null or alert_secret is null then
    raise warning 'Member emails are not configured';
    return;
  end if;
  perform net.http_post(
    url := alert_url,
    body := payload,
    headers := jsonb_build_object('content-type', 'application/json', 'x-signup-alert-secret', alert_secret)
  );
end;
$$;
revoke all on function private.post_member_mail(jsonb) from public, anon, authenticated;

create or replace function private.alert_signup()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  perform private.post_member_mail(
    jsonb_build_object('event', 'signedUp', 'email', new.email, 'status', new.status)
  );
  return new;
end;
$$;

create function private.mail_approval()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  perform private.post_member_mail(jsonb_build_object('event', 'approved', 'email', new.email));
  return new;
end;
$$;
revoke all on function private.mail_approval() from public, anon, authenticated;

-- A sign-up the window approves is welcomed at once; any other is welcomed when it turns approved.
create trigger mail_approval_on_insert
  after insert on public.members
  for each row when (new.status = 'approved')
  execute function private.mail_approval();

create trigger mail_approval_on_update
  after update of status on public.members
  for each row when (new.status = 'approved' and old.status is distinct from 'approved')
  execute function private.mail_approval();
