-- READ ONLY. Inspect the target project before running any migration.
do $$
declare present integer;
begin
  if current_setting('server_version_num')::integer<150000 then
    raise exception 'LIFE OS requires PostgreSQL 15 or newer';
  end if;
  select count(*) into present from pg_class c where c.relnamespace='public'::regnamespace
    and c.relkind='r' and c.relname in
    ('profiles','user_preferences','user_sync_state','events','tasks','subjects','class_schedules',
     'meals','meal_templates','meal_logs','workout_plans','workout_sessions','exercises',
     'exercise_logs','ai_plan_proposals','notifications','event_recurrences','event_exceptions');
  if present not in (0,18) then raise exception 'Partial LIFE OS schema (% of 18 tables). Review before deployment.',present; end if;
  if present=18 and (to_regprocedure('public.load_life_os()') is null or to_regprocedure('public.save_life_os(jsonb,bigint)') is null) then
    raise exception 'Tables exist without the expected RPCs. Do not recreate them.';
  end if;
  if present=0 and (to_regprocedure('public.load_life_os()') is not null or to_regprocedure('public.save_life_os(jsonb,bigint)') is not null) then
    raise exception 'Unexpected leftover RPCs. Review before deploying.';
  end if;
end $$;

select current_setting('server_version') as postgres_version,
  to_regclass('public.events') as events_table,
  to_regprocedure('public.load_life_os()') as load_rpc,
  to_regprocedure('public.save_life_os(jsonb,bigint)') as save_rpc,
  to_regprocedure('public.validate_life_os_payload()') as hardening_marker,
  to_regprocedure('public.life_os_guard_revision()') as final_audit_marker;
