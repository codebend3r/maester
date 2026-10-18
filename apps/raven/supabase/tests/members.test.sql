begin;
create extension if not exists pgtap with schema extensions;
select plan(36);

insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data) values
  ('10000000-0000-4000-8000-000000000001', 'test-owner@maester.test', now(), '{}'),
  ('10000000-0000-4000-8000-000000000002', 'test-member@maester.test', now(), '{"is_owner":true,"role":"admin"}'),
  ('10000000-0000-4000-8000-000000000003', 'test-unverified@maester.test', null, '{}');

select is((select status from public.members where id = '10000000-0000-4000-8000-000000000001'), 'pending', 'Confirmed users start pending');
select is((select count(*)::integer from public.members where id = '10000000-0000-4000-8000-000000000003'), 0, 'Unverified users have no membership');
update auth.users set email_confirmed_at = now() where id = '10000000-0000-4000-8000-000000000003';
select is((select status from public.members where id = '10000000-0000-4000-8000-000000000003'), 'pending', 'Confirmation update enrols a user');
update public.members set status = 'revoked' where id = '10000000-0000-4000-8000-000000000003';
update auth.users set email = 'changed@maester.test' where id = '10000000-0000-4000-8000-000000000003';
select is((select email from public.members where id = '10000000-0000-4000-8000-000000000003'), 'changed@maester.test', 'Email changes synchronize');
select is((select status from public.members where id = '10000000-0000-4000-8000-000000000003'), 'revoked', 'Email change never restores access');

select ok(not has_table_privilege('anon', 'public.members', 'SELECT'), 'Anonymous cannot read members');
select ok(not has_table_privilege('authenticated', 'public.members', 'INSERT'), 'Clients cannot insert members');
select ok(not has_table_privilege('authenticated', 'public.members', 'UPDATE'), 'Clients cannot update members');
select ok(not has_table_privilege('authenticated', 'public.members', 'DELETE'), 'Clients cannot delete members');
select ok(not has_schema_privilege('authenticated', 'private', 'USAGE'), 'Clients cannot access the owner schema');
select ok(not has_function_privilege('anon', 'public.current_membership()', 'EXECUTE'), 'Anonymous cannot call account lookup');
select ok(not has_function_privilege('anon', 'public.list_members(integer,integer)', 'EXECUTE'), 'Anonymous cannot list members');
select ok(not has_function_privilege('anon', 'public.set_member_status(uuid,text)', 'EXECUTE'), 'Anonymous cannot approve');
select ok(not has_function_privilege('authenticated', 'private.enrol_confirmed_user()', 'EXECUTE'), 'Clients cannot run enrolment');

-- Bootstrap uses database-operator privileges, never a public first-signup rule.
delete from private.owner;
insert into private.owner (account_id) values ('10000000-0000-4000-8000-000000000001');
update public.members set status = 'approved' where id = '10000000-0000-4000-8000-000000000001';

set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000002', true);
select is((select count(*)::integer from public.members), 1, 'RLS exposes only the caller membership');
select is((select status from public.current_membership()), 'pending', 'Pending account can check its state');
select is((select is_owner from public.current_membership()), false, 'User metadata cannot grant ownership');
select throws_ok($$select * from public.list_members()$$, '42501', 'Only the owner can list members', 'Pending cannot list members');
select throws_ok($$select * from public.set_member_status('10000000-0000-4000-8000-000000000002', 'approved')$$, '42501', 'Only the owner can change access', 'Self approval is refused');
select throws_ok($$update public.members set status = 'approved'$$, '42501', 'permission denied for table members', 'Direct updates are refused');
select throws_ok($$select * from private.owner$$, '42501', 'permission denied for schema private', 'Owner configuration is private');

select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000001', true);
select is((select is_owner from public.current_membership()), true, 'Bootstrapped approved owner is recognized');
select ok((select count(*) > 1 from public.list_members()), 'Owner can list members');
select is((select count(*)::integer from public.list_members(1, 0)), 1, 'Member listing is paginated');
select throws_ok($$select * from public.list_members(101, 0)$$, '22023', 'Invalid pagination', 'Page size is bounded');
select is((select status from public.set_member_status('10000000-0000-4000-8000-000000000002', 'approved')), 'approved', 'Owner can approve');
select throws_ok($$select * from public.set_member_status('10000000-0000-4000-8000-000000000001', 'revoked')$$, '42501', 'The owner cannot be changed here', 'Owner cannot revoke themselves');
select throws_ok($$select * from public.set_member_status('10000000-0000-4000-8000-000000000002', 'pending')$$, '22023', 'Expected approved or revoked', 'No unsupported status transition');
select throws_ok($$select * from public.set_member_status('90000000-0000-4000-8000-000000000001', 'approved')$$, 'P0002', 'Verified member not found', 'Nonexistent or unverified account cannot be approved');

select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000002', true);
select is((select status from public.current_membership()), 'approved', 'Approval visible without a new JWT');
select throws_ok($$select * from public.list_members()$$, '42501', 'Only the owner can list members', 'Approved member cannot list members');
select throws_ok($$select * from public.set_member_status('10000000-0000-4000-8000-000000000003', 'approved')$$, '42501', 'Only the owner can change access', 'Approved member cannot approve others');

select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000001', true);
select is((select status from public.set_member_status('10000000-0000-4000-8000-000000000002', 'revoked')), 'revoked', 'Owner can remove access');
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000002', true);
select is((select status from public.current_membership()), 'revoked', 'Revocation visible with the same identity');
select throws_ok($$select * from public.list_members()$$, '42501', 'Only the owner can list members', 'Revoked member cannot list members');
select set_config('request.jwt.claim.sub', '90000000-0000-4000-8000-000000000001', true);
select is((select count(*)::integer from public.current_membership()), 0, 'Missing membership grants no access');

select * from finish();
rollback;
