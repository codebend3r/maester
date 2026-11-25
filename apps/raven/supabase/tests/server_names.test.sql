begin;
create extension if not exists pgtap with schema extensions;
select plan(17);

insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data) values
  ('20000000-0000-4000-8000-000000000011', 'test-names-a@maester.test', now(), '{}'),
  ('20000000-0000-4000-8000-000000000012', 'test-names-b@maester.test', now(), '{}');

select ok(not has_table_privilege('anon', 'public.server_names', 'SELECT'), 'Anonymous cannot read server names');
select ok(not has_table_privilege('anon', 'public.account_preferences', 'SELECT'), 'Anonymous cannot read preferences');
select ok(not has_column_privilege('authenticated', 'public.server_names', 'user_id', 'INSERT'), 'Clients cannot name a server name owner');
select ok(not has_column_privilege('authenticated', 'public.account_preferences', 'user_id', 'INSERT'), 'Clients cannot name a preferences owner');
select ok(not has_table_privilege('authenticated', 'public.account_preferences', 'DELETE'), 'Preferences are never removed');
select ok(not has_function_privilege('authenticated', 'private.cap_server_names()', 'EXECUTE'), 'Clients cannot run the server name cap');

set local role authenticated;
select set_config('request.jwt.claim.sub', '20000000-0000-4000-8000-000000000011', true);

insert into public.server_names (server_id, name) values ('30000000-0000-4000-8000-000000000001', 'Vhagar');
select is(
  (select user_id from public.server_names where server_id = '30000000-0000-4000-8000-000000000001'),
  '20000000-0000-4000-8000-000000000011'::uuid,
  'A server name belongs to the caller'
);
insert into public.server_names (server_id, name) values ('30000000-0000-4000-8000-000000000001', 'Vhagar at home')
on conflict (user_id, server_id) do update set name = excluded.name;
select is(
  (select name from public.server_names where server_id = '30000000-0000-4000-8000-000000000001'),
  'Vhagar at home',
  'Naming a server again renames it'
);
select throws_ok(
  $$insert into public.server_names (server_id, name) values ('30000000-0000-4000-8000-000000000009', ' Padded ')$$,
  '23514', null, 'A name with spaces around it is refused'
);

insert into public.account_preferences (show_pin_servers) values (false);
select is((select show_pin_servers from public.account_preferences), false, 'The caller keeps their preferences');
insert into public.account_preferences (show_pin_servers) values (true)
on conflict (user_id) do update set show_pin_servers = excluded.show_pin_servers;
select is((select show_pin_servers from public.account_preferences), true, 'Writing preferences again changes them');

select set_config('request.jwt.claim.sub', '20000000-0000-4000-8000-000000000012', true);
select is((select count(*)::integer from public.server_names), 0, 'RLS hides another account''s server names');
select is((select count(*)::integer from public.account_preferences), 0, 'RLS hides another account''s preferences');
insert into public.server_names (server_id, name)
select gen_random_uuid(), 'Server ' || n from generate_series(1, 20) n;
select throws_ok(
  $$insert into public.server_names (server_id, name) values (gen_random_uuid(), 'One more')$$,
  '23514', 'At most 20 server names per account', 'The 21st server name is refused'
);
insert into public.server_names (server_id, name)
select server_id, 'Renamed' from public.server_names limit 1
on conflict (user_id, server_id) do update set name = excluded.name;
select is((select count(*)::integer from public.server_names where name = 'Renamed'), 1, 'A full account still renames a server it named');

reset role;
delete from auth.users where id = '20000000-0000-4000-8000-000000000011';
select is(
  (select count(*)::integer from public.server_names where user_id = '20000000-0000-4000-8000-000000000011'),
  0,
  'A deleted account takes its server names'
);
select is(
  (select count(*)::integer from public.account_preferences where user_id = '20000000-0000-4000-8000-000000000011'),
  0,
  'A deleted account takes its preferences'
);

select * from finish();
rollback;
