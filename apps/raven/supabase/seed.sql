-- Local reset only. Never pass --include-seed to a production db push.
insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, recovery_token, email_change_token_new, email_change
)
select
  '00000000-0000-0000-0000-000000000000'::uuid, id, 'authenticated', 'authenticated',
  email, extensions.crypt('RavenLocal123!', extensions.gen_salt('bf')), now(),
  '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now(), '', '', '', ''
from (values
  ('00000000-0000-4000-8000-000000000001'::uuid, 'owner@maester.test'),
  ('00000000-0000-4000-8000-000000000002'::uuid, 'friend@maester.test'),
  ('00000000-0000-4000-8000-000000000003'::uuid, 'waiting@maester.test'),
  ('00000000-0000-4000-8000-000000000004'::uuid, 'removed@maester.test')
) as accounts(id, email);

insert into auth.identities (id, user_id, provider_id, identity_data, provider, created_at, updated_at)
select gen_random_uuid(), id, id::text,
  jsonb_build_object('sub', id::text, 'email', email, 'email_verified', true), 'email', now(), now()
from auth.users where email like '%@maester.test';

update public.members set status = 'approved'
where id in ('00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000002');
update public.members set status = 'pending' where id = '00000000-0000-4000-8000-000000000003';
update public.members set status = 'revoked' where id = '00000000-0000-4000-8000-000000000004';
insert into private.owner (account_id) values ('00000000-0000-4000-8000-000000000001');
