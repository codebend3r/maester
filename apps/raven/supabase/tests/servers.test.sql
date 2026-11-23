begin;
create extension if not exists pgtap with schema extensions;
select plan(32);

insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data) values
  ('20000000-0000-4000-8000-000000000001', 'test-servers-a@maester.test', now(), '{}'),
  ('20000000-0000-4000-8000-000000000002', 'test-servers-b@maester.test', now(), '{}');

select ok(not has_table_privilege('anon', 'public.account_servers', 'SELECT'), 'Anonymous cannot read servers');
select ok(not has_table_privilege('anon', 'public.library_pins', 'SELECT'), 'Anonymous cannot read pins');
select ok(not has_table_privilege('anon', 'public.account_servers', 'INSERT'), 'Anonymous cannot add servers');
select ok(not has_table_privilege('anon', 'public.library_pins', 'INSERT'), 'Anonymous cannot pin');
select ok(not has_column_privilege('authenticated', 'public.account_servers', 'user_id', 'INSERT'), 'Clients cannot name a server row owner');
select ok(not has_column_privilege('authenticated', 'public.account_servers', 'user_id', 'UPDATE'), 'Clients cannot move a server row');
select ok(not has_column_privilege('authenticated', 'public.account_servers', 'server_id', 'UPDATE'), 'A server row keeps its server');
select ok(not has_column_privilege('authenticated', 'public.library_pins', 'user_id', 'INSERT'), 'Clients cannot name a pin owner');
select ok(not has_table_privilege('authenticated', 'public.library_pins', 'UPDATE'), 'Pins are never updated');
select ok(not has_function_privilege('authenticated', 'private.cap_account_servers()', 'EXECUTE'), 'Clients cannot run the server cap');
select ok(not has_function_privilege('authenticated', 'private.cap_library_pins()', 'EXECUTE'), 'Clients cannot run the pin cap');
select ok(not has_function_privilege('authenticated', 'private.unpin_removed_server()', 'EXECUTE'), 'Clients cannot run the unpin trigger');

set local role authenticated;
select set_config('request.jwt.claim.sub', '20000000-0000-4000-8000-000000000001', true);

insert into public.account_servers (server_id, name, origin) values
  ('30000000-0000-4000-8000-000000000001', 'Meleys', 'https://meleys.example:8443');
select is(
  (select user_id from public.account_servers where server_id = '30000000-0000-4000-8000-000000000001'),
  '20000000-0000-4000-8000-000000000001'::uuid,
  'A new server belongs to the caller'
);
select throws_ok(
  $$insert into public.account_servers (server_id, name, origin) values ('30000000-0000-4000-8000-000000000001', 'Again', 'https://again.example')$$,
  '23505', null, 'A server is on an account once'
);
select throws_ok(
  $$insert into public.account_servers (server_id, name, origin) values ('30000000-0000-4000-8000-000000000009', '', 'https://blank.example')$$,
  '23514', null, 'A blank name is refused'
);
select throws_ok(
  $$insert into public.account_servers (server_id, name, origin) values ('30000000-0000-4000-8000-000000000009', repeat('n', 81), 'https://long.example')$$,
  '23514', null, 'A name past 80 characters is refused'
);
select throws_ok(
  $$insert into public.account_servers (server_id, name, origin) values ('30000000-0000-4000-8000-000000000009', 'Path', 'https://path.example/api')$$,
  '23514', null, 'An origin with a path is refused'
);
select throws_ok(
  $$insert into public.account_servers (server_id, name, origin) values ('30000000-0000-4000-8000-000000000009', 'Other', 'ftp://other.example')$$,
  '23514', null, 'An origin that is not http or https is refused'
);

update public.account_servers set name = 'Meleys at home' where server_id = '30000000-0000-4000-8000-000000000001';
select is(
  (select name from public.account_servers where server_id = '30000000-0000-4000-8000-000000000001'),
  'Meleys at home',
  'The caller renames their server'
);

insert into public.library_pins (server_id, library_id) values
  ('30000000-0000-4000-8000-000000000001', 2),
  ('30000000-0000-4000-8000-000000000002', 2);
select is((select count(*)::integer from public.library_pins), 2, 'The caller pins libraries on any server');
insert into public.library_pins (server_id, library_id) values ('30000000-0000-4000-8000-000000000001', 2)
on conflict do nothing;
select is((select count(*)::integer from public.library_pins), 2, 'Pinning twice keeps one pin');
select throws_ok(
  $$insert into public.library_pins (server_id, library_id) values ('30000000-0000-4000-8000-000000000001', 0)$$,
  '23514', null, 'A library id is a whole number from 1'
);

select set_config('request.jwt.claim.sub', '20000000-0000-4000-8000-000000000002', true);
select is((select count(*)::integer from public.account_servers), 0, 'RLS hides another account''s servers');
select is((select count(*)::integer from public.library_pins), 0, 'RLS hides another account''s pins');
update public.account_servers set name = 'Taken' where server_id = '30000000-0000-4000-8000-000000000001';
delete from public.library_pins;
select set_config('request.jwt.claim.sub', '20000000-0000-4000-8000-000000000001', true);
select is(
  (select name from public.account_servers where server_id = '30000000-0000-4000-8000-000000000001'),
  'Meleys at home',
  'Another account cannot rename a server'
);
select is((select count(*)::integer from public.library_pins), 2, 'Another account cannot unpin');

delete from public.account_servers where server_id = '30000000-0000-4000-8000-000000000001';
select is(
  (select count(*)::integer from public.library_pins where server_id = '30000000-0000-4000-8000-000000000001'),
  0,
  'Removing a server takes its pins'
);
select is((select count(*)::integer from public.library_pins), 1, 'Other servers keep their pins');

select set_config('request.jwt.claim.sub', '20000000-0000-4000-8000-000000000002', true);
insert into public.account_servers (server_id, name, origin)
select gen_random_uuid(), 'Server ' || n, 'https://server' || n || '.example' from generate_series(1, 20) n;
select is((select count(*)::integer from public.account_servers), 20, 'An account holds 20 servers');
select throws_ok(
  $$insert into public.account_servers (server_id, name, origin) values (gen_random_uuid(), 'One more', 'https://more.example')$$,
  '23514', 'At most 20 servers per account', 'The 21st server is refused'
);
insert into public.library_pins (server_id, library_id)
select '30000000-0000-4000-8000-000000000003', n from generate_series(1, 100) n;
select throws_ok(
  $$insert into public.library_pins (server_id, library_id) values ('30000000-0000-4000-8000-000000000003', 101)$$,
  '23514', 'At most 100 pinned libraries per account', 'The 101st pin is refused'
);

reset role;
delete from auth.users where id = '20000000-0000-4000-8000-000000000002';
select is(
  (select count(*)::integer from public.account_servers where user_id = '20000000-0000-4000-8000-000000000002'),
  0,
  'A deleted account takes its servers and pins'
);

select * from finish();
rollback;
