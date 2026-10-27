-- READ ONLY: paste into SQL Editor after all THREE migrations.
-- Reports schema metadata only; does not query business rows or use API keys.
do $$
declare t text; p record; expected text; command text; routine regprocedure;
begin
  if exists(select 1 from pg_roles where rolname in ('anon','authenticated') and (rolsuper or rolbypassrls)) then
    raise exception 'App roles must not be superuser or BYPASSRLS';
  end if;
  foreach t in array array['profiles','user_preferences','user_sync_state','events','tasks',
    'subjects','class_schedules','meals','meal_templates','meal_logs','workout_plans',
    'workout_sessions','exercises','exercise_logs','ai_plan_proposals','notifications',
    'event_recurrences','event_exceptions'] loop
    if to_regclass('public.'||t) is null then raise exception 'Missing table: %',t; end if;
    if not exists(select 1 from pg_class where oid=to_regclass('public.'||t) and relrowsecurity) then
      raise exception 'RLS is disabled: %',t;
    end if;
    if exists(select 1 from pg_class where oid=to_regclass('public.'||t) and
      (pg_has_role('authenticated',relowner,'USAGE') or pg_has_role('anon',relowner,'USAGE'))) then
      raise exception 'An app role owns or inherits the owner of table %',t;
    end if;
    if (select count(*) from pg_policies where schemaname='public' and tablename=t)<>4 then
      raise exception 'Expected four owner CRUD policies: %',t;
    end if;
    expected:='SELECTauth.uidASuid='||(case when t='profiles' then 'id' else 'user_id' end);
    for p in select * from pg_policies where schemaname='public' and tablename=t loop
      command:=case p.policyname when 'owner_select' then 'SELECT' when 'owner_insert' then 'INSERT' when 'owner_update' then 'UPDATE' when 'owner_delete' then 'DELETE' end;
      if command is null or p.cmd<>command or p.roles<>array['authenticated']::name[] or p.permissive<>'PERMISSIVE'
        or regexp_replace(coalesce(p.qual,''),'[[:space:]()]','','g')<>(case when command='INSERT' then '' else expected end)
        or regexp_replace(coalesce(p.with_check,''),'[[:space:]()]','','g')<>(case when command in ('INSERT','UPDATE') then expected else '' end) then
        raise exception 'Incorrect ownership policy: %.%',t,p.policyname;
      end if;
    end loop;
    if has_table_privilege('authenticated','public.'||t,'TRUNCATE,TRIGGER,REFERENCES') then
      raise exception 'Unexpected elevated table grant: %',t;
    end if;
    if current_setting('server_version_num')::integer>=170000 then
      if has_table_privilege('authenticated','public.'||t,'MAINTAIN') or has_table_privilege('anon','public.'||t,'MAINTAIN') then
        raise exception 'Unexpected MAINTAIN grant: %',t;
      end if;
    end if;
    if exists(select 1 from pg_class c cross join lateral aclexplode(c.relacl) a where c.oid=to_regclass('public.'||t) and a.grantee=0) then
      raise exception 'Unexpected PUBLIC table grant: %',t;
    end if;
    if (select count(*) from pg_constraint where conrelid=to_regclass('public.'||t) and contype='p')<>1
      or exists(select 1 from pg_constraint where conrelid=to_regclass('public.'||t) and not convalidated) then
      raise exception 'Missing PK or unvalidated constraint: %',t;
    end if;
    if (select count(*) from information_schema.columns where table_schema='public' and table_name=t
      and column_name in ('created_at','updated_at') and data_type='timestamp with time zone' and is_nullable='NO')<>2 then
      raise exception 'Missing timestamps: %',t;
    end if;
    if has_table_privilege('anon','public.'||t,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,TRIGGER,REFERENCES')
      or has_any_column_privilege('anon','public.'||t,'SELECT,INSERT,UPDATE,REFERENCES') then
      raise exception 'Unexpected anonymous grant: %',t;
    end if;
  end loop;
  if to_regprocedure('public.life_os_guard_revision()') is null then
    raise exception 'Final audit migration is missing';
  end if;
  if to_regprocedure('public.load_life_os()') is null or to_regprocedure('public.save_life_os(jsonb,bigint)') is null then
    raise exception 'Snapshot RPC is missing';
  end if;
  if has_function_privilege('anon','public.load_life_os()','EXECUTE') or
    has_function_privilege('anon','public.save_life_os(jsonb,bigint)','EXECUTE') then
    raise exception 'Unexpected anonymous RPC access';
  end if;
  if exists(select 1 from pg_proc where oid in
    (to_regprocedure('public.load_life_os()'),to_regprocedure('public.save_life_os(jsonb,bigint)')) and prosecdef) then
    raise exception 'Snapshot RPC must use SECURITY INVOKER';
  end if;
  if has_table_privilege('authenticated','public.user_sync_state','DELETE') then raise exception 'Revision reset allowed'; end if;
  foreach routine in array array[to_regprocedure('public.load_life_os()'),to_regprocedure('public.save_life_os(jsonb,bigint)')] loop
    if not has_function_privilege('authenticated',routine,'EXECUTE') then raise exception 'Authenticated RPC execute missing'; end if;
    if exists(select 1 from pg_proc where oid=routine and not coalesce('search_path=""'=any(proconfig),false)) then
      raise exception 'Unsafe RPC search_path: %',routine;
    end if;
  end loop;
end $$;

select c.relname as table_name,c.relrowsecurity as rls_enabled,
  (select count(*) from pg_policies p where p.schemaname='public' and p.tablename=c.relname) as policies,
  (select count(*) from pg_constraint k where k.conrelid=c.oid and k.contype='f') as foreign_keys,
  (select count(*) from pg_index i where i.indrelid=c.oid) as indexes
from pg_class c join pg_namespace n on n.oid=c.relnamespace
where n.nspname='public' and c.relkind='r' and c.relname in
  ('profiles','user_preferences','user_sync_state','events','tasks','subjects','class_schedules',
   'meals','meal_templates','meal_logs','workout_plans','workout_sessions','exercises',
   'exercise_logs','ai_plan_proposals','notifications','event_recurrences','event_exceptions')
order by c.relname;

-- Must return zero rows after a successful hardening migration.
select conrelid::regclass as table_name,conname as unvalidated_constraint
from pg_constraint where connamespace='public'::regnamespace and not convalidated
  and conrelid in (select c.oid from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public' and c.relname in
    ('profiles','user_preferences','user_sync_state','events','tasks','subjects','class_schedules',
     'meals','meal_templates','meal_logs','workout_plans','workout_sessions','exercises',
     'exercise_logs','ai_plan_proposals','notifications','event_recurrences','event_exceptions'));
