-- LIFE OS final audit fixes. Apply AFTER baseline and schema_hardening.
-- Additive definitions/permissions only: no business-row DML is executed here.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';
do $$
declare t text; p record; expected text; command text;
begin
  if exists(select 1 from pg_roles where rolname in ('anon','authenticated') and (rolsuper or rolbypassrls)) then
    raise exception 'Application roles must not be superuser or BYPASSRLS';
  end if;
  if to_regprocedure('public.validate_life_os_payload()') is null then
    raise exception 'Apply schema_hardening before final_audit';
  end if;
  if to_regprocedure('public.life_os_guard_revision()') is not null then
    raise exception 'final_audit is already installed. Do not replay migrations.';
  end if;
  foreach t in array array['profiles','user_preferences','user_sync_state','events','tasks',
    'subjects','class_schedules','meals','meal_templates','meal_logs','workout_plans',
    'workout_sessions','exercises','exercise_logs','ai_plan_proposals','notifications',
    'event_recurrences','event_exceptions'] loop
    if to_regclass('public.'||t) is null or
      not exists(select 1 from pg_class where oid=to_regclass('public.'||t) and relrowsecurity) or
      (select count(*) from pg_policies where schemaname='public' and tablename=t)<>4 or
      exists(select 1 from pg_policies where schemaname='public' and tablename=t
        and policyname not in ('owner_select','owner_insert','owner_update','owner_delete')) then
      raise exception 'Unexpected table/policy state: %',t;
    end if;
    expected:='SELECTauth.uidASuid='||(case when t='profiles' then 'id' else 'user_id' end);
    for p in select * from pg_policies where schemaname='public' and tablename=t loop
      command:=case p.policyname when 'owner_select' then 'SELECT' when 'owner_insert' then 'INSERT' when 'owner_update' then 'UPDATE' when 'owner_delete' then 'DELETE' end;
      if command is null or p.cmd<>command or p.roles<>array['authenticated']::name[] or p.permissive<>'PERMISSIVE'
        or regexp_replace(coalesce(p.qual,''),'[[:space:]()]','','g')<>(case when command='INSERT' then '' else expected end)
        or regexp_replace(coalesce(p.with_check,''),'[[:space:]()]','','g')<>(case when command in ('INSERT','UPDATE') then expected else '' end) then
        raise exception 'Unexpected ownership policy: %.%',t,p.policyname;
      end if;
    end loop;
  end loop;
  if (select count(*) from pg_constraint k join pg_class c on c.oid=k.conrelid
    where c.relnamespace='public'::regnamespace and c.relname in
    ('profiles','user_preferences','user_sync_state','events','tasks','subjects','class_schedules',
     'meals','meal_templates','meal_logs','workout_plans','workout_sessions','exercises',
     'exercise_logs','ai_plan_proposals','notifications','event_recurrences','event_exceptions')
    and k.contype='f')<>24 then
    raise exception 'Unexpected baseline foreign key count';
  end if;
end $$;

-- GRANT CRUD does not remove default ALL privileges. TRUNCATE bypasses RLS.
-- Revoke table AND column ACLs first, then grant the exact required operations.
do $$
declare t text; col text;
begin
  foreach t in array array['profiles','user_preferences','user_sync_state','events','tasks',
    'subjects','class_schedules','meals','meal_templates','meal_logs','workout_plans',
    'workout_sessions','exercises','exercise_logs','ai_plan_proposals','notifications',
    'event_recurrences','event_exceptions'] loop
    execute format('revoke all on public.%I from public,anon,authenticated',t);
    for col in select column_name from information_schema.columns where table_schema='public' and table_name=t loop
      execute format('revoke select(%I),insert(%I),update(%I),references(%I) on public.%I from public,anon,authenticated',col,col,col,col,t);
    end loop;
    execute format('grant select,insert,update,delete on public.%I to authenticated',t);
  end loop;
end $$;
-- Internal counter must not be deleted/reset by an API client.
revoke delete on public.user_sync_state from authenticated;

create function public.life_os_guard_revision() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
  if tg_op='INSERT' then
    if new.revision<>0 then raise exception 'Initial revision must be zero' using errcode='23514'; end if;
  elsif new.user_id<>old.user_id or new.revision<>old.revision+1 then
    raise exception 'Revision must advance monotonically by one' using errcode='23514';
  end if;
  return new;
end $$;
create trigger guard_revision before insert or update on public.user_sync_state
  for each row execute function public.life_os_guard_revision();

-- All authenticated writers acquire the per-user counter lock BEFORE row locks.
-- This closes the direct-DML vs snapshot lost-update gap without a client-
-- forgeable suppression flag. Different users lock different rows.
create function public.life_os_lock_writer() returns trigger
language plpgsql security invoker set search_path='' as $$
declare owner_id uuid:=auth.uid();
begin
  if owner_id is not null then
    insert into public.user_sync_state(user_id) values(owner_id) on conflict do nothing;
    perform 1 from public.user_sync_state where user_id=owner_id for update;
  end if;
  return null;
end $$;
create function public.life_os_advance_revision() returns trigger
language plpgsql security invoker set search_path='' as $$
declare changed boolean; owner_id uuid:=auth.uid();
begin
  if owner_id is null then return null; end if;
  if tg_op='DELETE' then select exists(select 1 from old_rows) into changed;
  else select exists(select 1 from new_rows) into changed;
  end if;
  if changed then update public.user_sync_state set revision=revision+1 where user_id=owner_id; end if;
  return null;
end $$;
do $$
declare t text;
begin
  foreach t in array array['profiles','user_preferences','events','tasks','subjects',
    'class_schedules','meals','meal_templates','meal_logs','workout_plans','workout_sessions',
    'exercises','exercise_logs','ai_plan_proposals','notifications','event_recurrences','event_exceptions'] loop
    execute format('create trigger lock_writer before insert or update or delete on public.%I for each statement execute function public.life_os_lock_writer()',t);
    execute format('create trigger advance_revision_insert after insert on public.%I referencing new table as new_rows for each statement execute function public.life_os_advance_revision()',t);
    execute format('create trigger advance_revision_update after update on public.%I referencing new table as new_rows for each statement execute function public.life_os_advance_revision()',t);
    execute format('create trigger advance_revision_delete after delete on public.%I referencing old table as old_rows for each statement execute function public.life_os_advance_revision()',t);
  end loop;
end $$;

-- Clearing a subject is an explicit unlink. COALESCE previously restored it.
create or replace function public.sync_life_os_event_metadata() returns trigger
language plpgsql security invoker set search_path='' as $$
declare reference_id uuid;
begin
  if new.category='study' then
    select id into reference_id from public.subjects
      where user_id=new.user_id and id=public.life_os_uuid(new.payload#>>'{details,subjectId}');
    insert into public.class_schedules(user_id,event_id,subject_id,room)
      values(new.user_id,new.id,reference_id,coalesce(new.payload->>'location',''))
      on conflict(user_id,event_id) do update set subject_id=excluded.subject_id,room=excluded.room;
  end if;
  if new.category='nutrition' then
    select id into reference_id from public.meal_templates
      where user_id=new.user_id and id=public.life_os_uuid(new.payload#>>'{details,templateId}');
    insert into public.meals(user_id,event_id,template_id) values(new.user_id,new.id,reference_id)
      on conflict(user_id,event_id) do update set template_id=excluded.template_id;
  end if;
  if new.category='workout' then
    select id into reference_id from public.workout_plans
      where user_id=new.user_id and id=public.life_os_uuid(new.payload#>>'{details,planId}');
    insert into public.workout_sessions(user_id,event_id,plan_id,started_at,completed_at)
      values(new.user_id,new.id,reference_id,
        (new.payload#>>'{details,startedAt}')::timestamptz,(new.payload#>>'{details,completedAt}')::timestamptz)
      on conflict(user_id,event_id) do update set plan_id=excluded.plan_id,
        started_at=excluded.started_at,completed_at=excluded.completed_at;
  end if;
  return new;
end $$;

-- Complete required frontend field types so a direct RPC cannot save a shape
-- that load_life_os / Zod cannot reopen. Existing payloads are not rewritten.
create function public.life_os_validate_contract() returns trigger
language plpgsql security invoker set search_path='' as $$
declare p jsonb:=new.payload; spec jsonb; k text; expected text; n numeric; item jsonb;
begin
  spec:=case tg_table_name
    when 'events' then '{"id":"string","title":"string","description":"string","category":"string","date":"string","startTime":"string","endTime":"string","status":"string","fixed":"boolean","location":"string","notes":"string"}'::jsonb
    when 'tasks' then '{"id":"string","title":"string","description":"string","priority":"string","deadline":"string","estimatedMinutes":"number","category":"string","completed":"boolean"}'::jsonb
    when 'user_preferences' then '{"displayName":"string","timezone":"string","language":"string","theme":"string","timeFormat":"string","wakeTime":"string","bedTime":"string","mealTimes":"string","focusHours":"string","breakMinutes":"number","workoutDays":"array","workoutDuration":"number","fitnessGoal":"string","experience":"string","dietaryPreferences":"string","allergies":"string","budget":"string","personalGoal":"string"}'::jsonb
    when 'meal_templates' then '{"id":"string","name":"string","description":"string"}'::jsonb
    when 'workout_plans' then '{"id":"string","name":"string","type":"string","description":"string"}'::jsonb
    when 'exercises' then '{"id":"string","name":"string","sets":"number","reps":"number","weight":"number","restSeconds":"number"}'::jsonb
    when 'exercise_logs' then '{"id":"string","eventId":"string","exerciseId":"string","date":"string","sets":"number","reps":"number","weight":"number","notes":"string"}'::jsonb end;
  for k,expected in select * from jsonb_each_text(spec) loop
    if jsonb_typeof(p->k) is distinct from expected then
      raise exception 'Missing or invalid required field: %',k using errcode='23514';
    end if;
  end loop;
  for k,item in select * from jsonb_each(p) loop
    if jsonb_typeof(item)='string' and length(p->>k) > (case k
      when 'title' then 200 when 'name' then 200 when 'displayName' then 80
      when 'location' then 500 when 'notes' then case when tg_table_name='events' then 10000 else 4000 end
      when 'timezone' then 100 when 'type' then 100 when 'deadline' then 64
      when 'mealTimes' then 500 when 'focusHours' then 500 when 'fitnessGoal' then 1000
      when 'experience' then 100 when 'dietaryPreferences' then 1000 when 'allergies' then 1000
      when 'budget' then 200 when 'personalGoal' then 2000 else 4000 end) then
      raise exception 'Text field too long: %',k using errcode='23514';
    end if;
  end loop;
  if tg_table_name='user_preferences' then
    if (p->>'theme' in ('light','dark','system')) is not true or (p->>'timeFormat' in ('12','24')) is not true
      or (p->>'language' in ('vi','en')) is not true
      or (p->>'wakeTime' ~ '^([01]\d|2[0-3]):[0-5]\d$') is not true
      or (p->>'bedTime' ~ '^([01]\d|2[0-3]):[0-5]\d$') is not true
      or jsonb_array_length(p->'workoutDays')>7 then
      raise exception 'Invalid routine preferences' using errcode='23514';
    end if;
    foreach k in array array['breakMinutes','workoutDuration'] loop
      n:=(p->>k)::numeric;
      if n<>trunc(n) or (k='breakMinutes' and n not between 0 and 120)
        or (k='workoutDuration' and n not between 5 and 480) then
        raise exception 'Invalid routine duration' using errcode='23514';
      end if;
    end loop;
    for item in select * from jsonb_array_elements(p->'workoutDays') loop
      if jsonb_typeof(item)<>'number' then raise exception 'Invalid weekday' using errcode='23514'; end if;
      n:=item::text::numeric;
      if n<>trunc(n) or n not between 0 and 6 then raise exception 'Invalid weekday' using errcode='23514'; end if;
    end loop;
  end if;
  if tg_table_name='events' and p ? 'checklist' then
    if jsonb_typeof(p->'checklist') is distinct from 'array' then
      raise exception 'Invalid checklist' using errcode='23514';
    end if;
    if jsonb_array_length(p->'checklist')>100 then raise exception 'Checklist too large' using errcode='23514'; end if;
    for item in select * from jsonb_array_elements(p->'checklist') loop
      if jsonb_typeof(item->'id') is distinct from 'string' or length(item->>'id') not between 1 and 160
        or jsonb_typeof(item->'text') is distinct from 'string' or length(item->>'text')>500
        or jsonb_typeof(item->'done') is distinct from 'boolean' then
        raise exception 'Invalid checklist item' using errcode='23514';
      end if;
    end loop;
  end if;
  if tg_table_name='events' and p ? 'parentId' and
    (jsonb_typeof(p->'parentId') is distinct from 'string' or length(p->>'parentId') not between 1 and 160) then
    raise exception 'Invalid historical parent reference' using errcode='23514';
  end if;
  if tg_table_name='meal_templates' then
    foreach k in array array['calories','protein','carbs','fat'] loop
      if p ? k and (p->>k)::numeric > (case k when 'calories' then 20000 when 'carbs' then 5000 else 2000 end) then
        raise exception 'Nutrition estimate out of range' using errcode='23514';
      end if;
    end loop;
  end if;
  return new;
end $$;

-- Parent date changes and recurrence edits may occur in different statements
-- of the same snapshot. Validate their FINAL state at commit, not mid-save.
create function public.life_os_check_recurrence_boundary() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
  if exists(select 1 from public.events e join public.event_recurrences r
    on r.user_id=e.user_id and r.event_id=e.id
    where e.user_id=new.user_id and e.id=new.id and r.until_date<e.event_date::date) then
    raise exception 'Recurrence cannot end before the event starts' using errcode='23514';
  end if;
  return null;
end $$;
create constraint trigger check_recurrence_boundary after insert or update on public.events
  deferrable initially deferred for each row execute function public.life_os_check_recurrence_boundary();
do $$
declare t text;
begin
  foreach t in array array['events','tasks','user_preferences','meal_templates','workout_plans','exercises','exercise_logs'] loop
    execute format('create trigger validate_contract before insert or update on public.%I for each row execute function public.life_os_validate_contract()',t);
  end loop;
end $$;

-- Preserve direct records when preferences have not been initialized yet.
create or replace function public.load_life_os() returns jsonb language plpgsql stable security invoker
set search_path = '' as $$
declare owner_id uuid := auth.uid(); preferences jsonb; revision bigint;
begin
  if owner_id is null then raise exception 'Sign in required' using errcode='28000'; end if;
  select p.payload into preferences from public.user_preferences p where p.user_id=owner_id;
  select s.revision into revision from public.user_sync_state s where s.user_id=owner_id;
  if preferences is null then
    if not exists(select 1 from public.profiles where id=owner_id)
      and not exists(select 1 from public.events where user_id=owner_id)
      and not exists(select 1 from public.tasks where user_id=owner_id)
      and not exists(select 1 from public.meal_templates where user_id=owner_id)
      and not exists(select 1 from public.workout_plans where user_id=owner_id)
      and not exists(select 1 from public.exercise_logs where user_id=owner_id) then
      return jsonb_build_object('data',null,'revision',coalesce(revision,0));
    end if;
    preferences := '{"displayName":"Bạn","timezone":"Asia/Ho_Chi_Minh","language":"vi","theme":"light","timeFormat":"24","wakeTime":"06:30","bedTime":"23:00","mealTimes":"07:00, 12:00, 18:30","focusHours":"09:00–11:30, 14:00–16:00","breakMinutes":15,"workoutDays":[1,3,5],"workoutDuration":75,"fitnessGoal":"","experience":"Beginner","dietaryPreferences":"","allergies":"","budget":"","personalGoal":""}'::jsonb ||
      jsonb_build_object('displayName',coalesce((select display_name from public.profiles where id=owner_id),'Bạn'));
  end if;
  return jsonb_build_object('revision',coalesce(revision,0),'data',jsonb_build_object(
    'preferences',preferences,
    'events',coalesce((select jsonb_agg(e.payload || jsonb_strip_nulls(jsonb_build_object(
      'recurrence',(select jsonb_build_object('frequency',r.frequency,'daysOfWeek',r.days_of_week,'until',r.until_date::text) from public.event_recurrences r where r.user_id=e.user_id and r.event_id=e.id),
      'excludedDates',coalesce((select jsonb_agg(x.occurrence_date::text order by x.occurrence_date) from public.event_exceptions x where x.user_id=e.user_id and x.event_id=e.id),'[]'::jsonb)
    )) order by e.event_date,e.id) from public.events e where e.user_id=owner_id),'[]'::jsonb),
    'tasks',coalesce((select jsonb_agg(t.payload order by t.created_at,t.id) from public.tasks t where t.user_id=owner_id),'[]'::jsonb),
    'mealTemplates',coalesce((select jsonb_agg(t.payload order by t.created_at,t.id) from public.meal_templates t where t.user_id=owner_id),'[]'::jsonb),
    'workoutPlans',coalesce((select jsonb_agg(p.payload || jsonb_build_object('exercises',coalesce((select jsonb_agg(x.payload order by x.position,x.id) from public.exercises x where x.user_id=p.user_id and x.plan_id=p.id),'[]'::jsonb)) order by p.created_at,p.id) from public.workout_plans p where p.user_id=owner_id),'[]'::jsonb),
    'exerciseLogs',coalesce((select jsonb_agg(l.payload order by l.log_date,l.id) from public.exercise_logs l where l.user_id=owner_id),'[]'::jsonb)
  ));
end $$;

-- Snapshot RPC definition follows; its revision is the committed counter, not
-- the previously assumed N+1, because direct DML and metadata writes advance it.

create or replace function public.save_life_os(p_data jsonb,p_expected_revision bigint)
returns bigint language plpgsql security invoker set search_path='' as $$
declare owner_id uuid := auth.uid(); current_revision bigint; collection text;
begin
  if owner_id is null then raise exception 'Sign in required' using errcode='28000'; end if;
  if p_expected_revision is null or p_expected_revision<0 or p_expected_revision>9007199254740991 then
    raise exception 'Expected revision is required' using errcode='22023';
  end if;
  if jsonb_typeof(p_data) is distinct from 'object'
    or jsonb_typeof(p_data->'preferences') is distinct from 'object' then
    raise exception 'Invalid data shape' using errcode='22023';
  end if;
  foreach collection in array array['events','tasks','mealTemplates','workoutPlans','exerciseLogs'] loop
    if jsonb_typeof(p_data->collection) is distinct from 'array' then
      raise exception 'Missing or invalid snapshot collection' using errcode='22023';
    end if;
    if jsonb_array_length(p_data->collection)>(case collection when 'mealTemplates' then 1000 when 'workoutPlans' then 1000 when 'exerciseLogs' then 50000 else 10000 end) then
      raise exception 'Snapshot collection too large' using errcode='22023';
    end if;
  end loop;
  if exists(select 1 from jsonb_array_elements(p_data->'workoutPlans') p
    where jsonb_typeof(p->'exercises') is distinct from 'array') then
    raise exception 'Missing plan exercises' using errcode='22023';
  end if;
  if pg_column_size(p_data)>4000000 then
    raise exception 'Snapshot too large' using errcode='22023';
  end if;

  insert into public.user_sync_state(user_id) values(owner_id) on conflict do nothing;
  select s.revision into current_revision from public.user_sync_state s where s.user_id=owner_id for update;
  if current_revision<>p_expected_revision then
    raise exception 'Cloud revision changed' using errcode='40001';
  end if;
  insert into public.profiles(id,display_name) values(owner_id,p_data->'preferences'->>'displayName')
    on conflict(id) do update set display_name=excluded.display_name;
  insert into public.user_preferences(user_id,payload) values(owner_id,p_data->'preferences')
    on conflict(user_id) do update set payload=excluded.payload;

  -- Parents first: new events may link to tasks/templates/plans in this snapshot.
  insert into public.tasks(user_id,id,payload)
    select owner_id,(e->>'id')::uuid,e from jsonb_array_elements(p_data->'tasks') e
    on conflict(user_id,id) do update set payload=excluded.payload;
  insert into public.meal_templates(user_id,id,payload)
    select owner_id,(e->>'id')::uuid,e from jsonb_array_elements(p_data->'mealTemplates') e
    on conflict(user_id,id) do update set payload=excluded.payload;
  insert into public.workout_plans(user_id,id,payload)
    select owner_id,(p->>'id')::uuid,p-'exercises' from jsonb_array_elements(p_data->'workoutPlans') p
    on conflict(user_id,id) do update set payload=excluded.payload;
  insert into public.exercises(user_id,plan_id,id,position,payload)
    select owner_id,(p->>'id')::uuid,(x.value->>'id')::uuid,x.ordinality::integer,x.value
    from jsonb_array_elements(p_data->'workoutPlans') p
    cross join lateral jsonb_array_elements(p->'exercises') with ordinality x(value,ordinality)
    on conflict(user_id,plan_id,id) do update set position=excluded.position,payload=excluded.payload;

  insert into public.events(user_id,id,payload)
    select owner_id,(e->>'id')::uuid,e-'recurrence'-'excludedDates' from jsonb_array_elements(p_data->'events') e
    on conflict(user_id,id) do update set payload=excluded.payload;
  delete from public.events where user_id=owner_id
    and id not in(select (e->>'id')::uuid from jsonb_array_elements(p_data->'events') e);

  insert into public.event_recurrences(user_id,event_id,frequency,days_of_week,until_date)
    select owner_id,(e->>'id')::uuid,e->'recurrence'->>'frequency',
      array(select jsonb_array_elements_text(e->'recurrence'->'daysOfWeek')::integer),
      (e->'recurrence'->>'until')::date
    from jsonb_array_elements(p_data->'events') e where e ? 'recurrence'
    on conflict(user_id,event_id) do update set frequency=excluded.frequency,
      days_of_week=excluded.days_of_week,until_date=excluded.until_date;
  delete from public.event_recurrences where user_id=owner_id and event_id not in
    (select (e->>'id')::uuid from jsonb_array_elements(p_data->'events') e where e ? 'recurrence');
  insert into public.event_exceptions(user_id,event_id,occurrence_date)
    select distinct owner_id,(e->>'id')::uuid,x::date
    from jsonb_array_elements(p_data->'events') e
    cross join lateral jsonb_array_elements_text(coalesce(e->'excludedDates','[]'::jsonb)) x
    on conflict(user_id,event_id,occurrence_date) do nothing;
  delete from public.event_exceptions where user_id=owner_id and (event_id,occurrence_date) not in
    (select (e->>'id')::uuid,x::date from jsonb_array_elements(p_data->'events') e
      cross join lateral jsonb_array_elements_text(coalesce(e->'excludedDates','[]'::jsonb)) x);

  -- Removing a reusable definition must not delete a scheduled activity or log.
  update public.meals set template_id=null where user_id=owner_id and template_id not in
    (select (e->>'id')::uuid from jsonb_array_elements(p_data->'mealTemplates') e);
  update public.workout_sessions set plan_id=null where user_id=owner_id and plan_id not in
    (select (e->>'id')::uuid from jsonb_array_elements(p_data->'workoutPlans') e);
  delete from public.tasks where user_id=owner_id and id not in
    (select (e->>'id')::uuid from jsonb_array_elements(p_data->'tasks') e);
  delete from public.meal_templates where user_id=owner_id and id not in
    (select (e->>'id')::uuid from jsonb_array_elements(p_data->'mealTemplates') e);
  delete from public.exercises where user_id=owner_id and (plan_id,id) not in
    (select (p->>'id')::uuid,(x->>'id')::uuid from jsonb_array_elements(p_data->'workoutPlans') p
      cross join lateral jsonb_array_elements(p->'exercises') x);
  delete from public.workout_plans where user_id=owner_id and id not in
    (select (e->>'id')::uuid from jsonb_array_elements(p_data->'workoutPlans') e);
  insert into public.exercise_logs(user_id,id,payload)
    select owner_id,(e->>'id')::uuid,e from jsonb_array_elements(p_data->'exerciseLogs') e
    on conflict(user_id,id) do update set payload=excluded.payload;
  delete from public.exercise_logs where user_id=owner_id and id not in
    (select (e->>'id')::uuid from jsonb_array_elements(p_data->'exerciseLogs') e);

  update public.user_sync_state set revision=revision+1 where user_id=owner_id returning revision into current_revision;
  return current_revision;
end $$;

revoke all on function public.load_life_os(),public.save_life_os(jsonb,bigint) from public,anon;
grant execute on function public.load_life_os(),public.save_life_os(jsonb,bigint) to authenticated;
revoke all on function public.life_os_guard_revision(),public.life_os_lock_writer(),public.life_os_advance_revision(),public.life_os_validate_contract(),public.life_os_check_recurrence_boundary() from public,anon,authenticated;
alter table public.user_sync_state add constraint revision_js_safe check(revision<=9007199254740991) not valid;
alter table public.user_sync_state validate constraint revision_js_safe;
notify pgrst, 'reload schema';
commit;
