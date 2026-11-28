begin;
create extension if not exists pgtap with schema extensions;
select plan(28);

insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data) values
  ('40000000-0000-4000-8000-000000000001', 'test-device-a@maester.test', now(), '{}'),
  ('40000000-0000-4000-8000-000000000002', 'test-device-b@maester.test', now(), '{}');

select ok(not has_table_privilege('anon', 'private.device_sign_ins', 'SELECT'), 'Anonymous cannot read sign-ins');
select ok(not has_table_privilege('authenticated', 'private.device_sign_ins', 'SELECT'), 'Clients cannot read sign-ins');
select ok(not has_table_privilege('authenticated', 'private.device_sign_ins', 'UPDATE'), 'Clients cannot approve by writing the table');
select ok(has_function_privilege('anon', 'public.start_device_sign_in(text)', 'EXECUTE'), 'A signed-out TV can start');
select ok(not has_function_privilege('anon', 'public.device_sign_in_request(text)', 'EXECUTE'), 'Anonymous cannot look a code up');
select ok(not has_function_privilege('anon', 'public.approve_device_sign_in(text)', 'EXECUTE'), 'Anonymous cannot approve');
select ok(not has_function_privilege('anon', 'public.claim_device_sign_in(text)', 'EXECUTE'), 'Anonymous cannot claim');
select ok(not has_function_privilege('authenticated', 'public.claim_device_sign_in(text)', 'EXECUTE'), 'Clients cannot claim');
select ok(has_function_privilege('service_role', 'public.claim_device_sign_in(text)', 'EXECUTE'), 'The Edge Function can claim');
select ok(not has_function_privilege('authenticated', 'private.device_user_code(text)', 'EXECUTE'), 'Clients cannot run the code helper');

set local role anon;
select throws_ok($$select * from public.start_device_sign_in('  ')$$, '22023', 'A device needs a name', 'A nameless device is refused');
select lives_ok($$select * from public.start_device_sign_in('Signed-out TV')$$, 'A signed-out TV starts a sign-in');
reset role;
delete from private.device_sign_ins;

-- Kept by the test's own role, so every role below can read what the TV was handed.
create temporary table started on commit drop as
  select * from public.start_device_sign_in('  Raven on Apple TV  ');
grant select on started to anon, authenticated, service_role;
select ok((select user_code ~ '^[BCDFGHJKLMNPQRSTVWXZ]{8}$' from started), 'The code is eight consonants');
select is((select char_length(device_code) from started), 64, 'The secret is 32 random bytes');
select is((select expires_in from started), 600, 'A sign-in lasts ten minutes');
select is((select poll_interval from started), 5, 'The TV asks every five seconds');

select is((select device_name from private.device_sign_ins), 'Raven on Apple TV', 'The name is kept trimmed');
select ok(
  (select device_code_hash = sha256(convert_to((select device_code from started), 'UTF8')) from private.device_sign_ins),
  'Only the hash of the secret is kept'
);

set local role service_role;
select is(
  (select status from public.claim_device_sign_in((select device_code from started))),
  'pending', 'An unapproved sign-in is pending'
);
select is((select status from public.claim_device_sign_in('not-a-secret')), 'gone', 'An unknown secret is gone');
reset role;

set local role authenticated;
select set_config('request.jwt.claim.sub', '40000000-0000-4000-8000-000000000001', true);
select is(
  (select public.device_sign_in_request(lower(substr((select user_code from started), 1, 4)) || '-' || substr((select user_code from started), 5))),
  'Raven on Apple TV', 'A code is found as it is typed, in any case and with its dash'
);
select is((select public.approve_device_sign_in('ZZZZZZZZ')), false, 'An unknown code approves nothing');
select is((select public.approve_device_sign_in((select user_code from started))), true, 'The account approves the code');
select set_config('request.jwt.claim.sub', '40000000-0000-4000-8000-000000000002', true);
select is((select public.approve_device_sign_in((select user_code from started))), false, 'An approved code cannot be taken by another account');
select is((select public.device_sign_in_request((select user_code from started))), null, 'An approved code is no longer offered');
reset role;

set local role service_role;
select is(
  (select email from public.claim_device_sign_in((select device_code from started))),
  'test-device-a@maester.test', 'The claim names the approver'
);
select is(
  (select status from public.claim_device_sign_in((select device_code from started))),
  'gone', 'A secret signs in one device, once'
);
reset role;

insert into private.device_sign_ins (device_code_hash, user_code, device_name, expires_at)
values (sha256('old'::bytea), 'BBBBBBBB', 'Old TV', now() - interval '1 minute');
set local role anon;
select device_code from public.start_device_sign_in('Wren on Android TV');
reset role;
select is(
  (select count(*)::integer from private.device_sign_ins where user_code = 'BBBBBBBB'),
  0, 'A start clears the sign-ins past their time'
);

select * from finish();
rollback;
