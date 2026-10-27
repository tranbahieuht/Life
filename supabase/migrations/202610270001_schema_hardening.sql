-- LIFE OS v2: additive hardening of 202610260001_life_os.sql.
-- Run once, AFTER the baseline. Never execute automatically at app startup.
-- No business rows are inserted/updated/deleted by this migration.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

-- Fail closed on an unexpected schema instead of silently adopting it.
do $$
declare t text;
begin
  foreach t in array array['profiles','user_preferences','user_sync_state','events','tasks',
    'subjects','class_schedules','meals','meal_templates','meal_logs','workout_plans',
    'workout_sessions','exercises','exercise_logs','ai_plan_proposals','notifications',
    'event_recurrences','event_exceptions'] loop
    if to_regclass('public.' || t) is null then
      raise exception 'Missing baseline table: %. Apply the baseline migration first.', t;
    end if;
    if exists (select 1 from pg_policies where schemaname='public' and tablename=t
      and policyname not in ('own_rows','own_profile')) then
      raise exception 'Unexpected RLS policy on %. Review existing policies before upgrading.', t;
    end if;
  end loop;
end $$;

-- Safe conversion for legacy JSON references. New writes are validated below.
create function public.life_os_uuid(value text) returns uuid
language sql immutable strict set search_path='' as $$
  select case when value ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    then value::uuid else null end
$$;
create function public.life_os_valid_date(value text) returns boolean
language plpgsql immutable strict set search_path='' as $$
begin
  if value !~ '^\d{4}-\d{2}-\d{2}$' then return false; end if;
  return to_char(value::date,'YYYY-MM-DD')=value;
exception when others then return false;
end $$;

alter table public.user_preferences
  add column language text generated always as (coalesce(payload->>'language','vi')) stored,
  add column timezone text generated always as (coalesce(payload->>'timezone','Asia/Ho_Chi_Minh')) stored,
  add constraint preferences_language check (language in ('vi','en')) not valid;
alter table public.events
  add column start_time text generated always as (payload->>'startTime') stored,
  add column end_time text generated always as (payload->>'endTime') stored,
  add column end_date text generated always as (payload->>'endDate') stored,
  add column task_id uuid generated always as (public.life_os_uuid(payload#>>'{details,taskId}')) stored,
  add constraint events_task_owner_fk foreign key(user_id,task_id)
    references public.tasks(user_id,id) deferrable initially deferred not valid;
create index events_user_task on public.events(user_id,task_id) where task_id is not null;
create index events_user_status_date on public.events(user_id,status,event_date);
create index tasks_user_priority on public.tasks(user_id,priority,deadline);
create index classes_user_subject on public.class_schedules(user_id,subject_id) where subject_id is not null;
create index meals_user_template on public.meals(user_id,template_id) where template_id is not null;
create index sessions_user_plan on public.workout_sessions(user_id,plan_id) where plan_id is not null;
create index meal_logs_user_event on public.meal_logs(user_id,event_id) where event_id is not null;
create index notifications_user_event on public.notifications(user_id,event_id) where event_id is not null;
create index exercise_logs_user_event_reference on public.exercise_logs(user_id,(payload->>'eventId'));
create index proposals_user_status_created on public.ai_plan_proposals(user_id,status,created_at desc);

alter table public.workout_plans add column name text generated always as (payload->>'name') stored;
alter table public.exercises add column name text generated always as (payload->>'name') stored;
alter table public.meal_templates add column name text generated always as (payload->>'name') stored;
alter table public.ai_plan_proposals
  add column summary text generated always as (payload->>'summary') stored,
  add column prompt text not null default '',
  add column base_revision bigint not null default 0 check(base_revision>=0),
  add column accepted_at timestamptz;
alter table public.meal_logs
  add column consumed_at timestamptz,
  add column meal_name text not null default '',
  add column servings numeric check(servings>0);
-- Do not invent consumption times or serving counts for legacy logs.
alter table public.meal_logs alter column consumed_at set default now();
alter table public.meal_logs alter column servings set default 1;
create index meal_logs_user_consumed on public.meal_logs(user_id,consumed_at desc);

alter table public.user_sync_state add column created_at timestamptz not null default now();
alter table public.event_exceptions add column updated_at timestamptz not null default now();
create trigger touch_updated_at before update on public.event_exceptions
  for each row execute function public.touch_updated_at();

-- Keep actual intake history if its planned event is later removed.
alter table public.meal_logs drop constraint meal_logs_user_id_event_id_fkey;
alter table public.meal_logs add constraint meal_logs_event_owner_fk
  foreign key(user_id,event_id) references public.events(user_id,id)
  on delete set null (event_id) not valid;
alter table public.class_schedules drop constraint class_schedules_user_id_subject_id_fkey;
alter table public.class_schedules add constraint class_subject_owner_fk
  foreign key(user_id,subject_id) references public.subjects(user_id,id)
  on delete set null (subject_id) not valid;
alter table public.meals drop constraint meals_user_id_template_id_fkey;
alter table public.meals add constraint meals_template_owner_fk
  foreign key(user_id,template_id) references public.meal_templates(user_id,id)
  on delete set null (template_id) not valid;
alter table public.workout_sessions drop constraint workout_sessions_user_id_plan_id_fkey;
alter table public.workout_sessions add constraint sessions_plan_owner_fk
  foreign key(user_id,plan_id) references public.workout_plans(user_id,id)
  on delete set null (plan_id) not valid;
alter table public.subjects add constraint subjects_name_length
  check (length(btrim(name)) between 1 and 200) not valid;
alter table public.exercises add constraint exercises_position_nonnegative check(position>=0) not valid;
alter table public.workout_sessions add constraint sessions_time_order
  check(completed_at is null or started_at is null or completed_at>=started_at) not valid;

-- Validate the JSON contract in PostgreSQL as well as at the Next.js boundary.
-- This also applies to direct authenticated PostgREST writes, which bypass Zod.
-- Triggers validate future writes only: pre-existing records are never rewritten.
create function public.validate_life_os_payload() returns trigger
language plpgsql security invoker set search_path='' as $$
declare p jsonb := new.payload; k text; n numeric; d date; ending date;
begin
  if jsonb_typeof(p) is distinct from 'object' then
    raise exception 'Payload must be an object' using errcode='23514';
  end if;
  if tg_table_name <> 'user_preferences' then
    if public.life_os_uuid(p->>'id') is distinct from new.id then
      raise exception 'Payload ID must equal row ID' using errcode='23514';
    end if;
  end if;
  if tg_table_name in ('events','tasks') then
    if jsonb_typeof(p->'title') is distinct from 'string' or length(btrim(p->>'title')) not between 1 and 200
      or (p->>'category' in ('study','work','nutrition','workout','personal','rest')) is not true then
      raise exception 'Invalid title or category' using errcode='23514';
    end if;
  end if;
  if tg_table_name='events' then
    if public.life_os_valid_date(p->>'date') is not true
      or (p->>'startTime' ~ '^([01]\d|2[0-3]):[0-5]\d$') is not true
      or (p->>'endTime' ~ '^([01]\d|2[0-3]):[0-5]\d$') is not true
      or (p->>'status' in ('planned','completed','skipped')) is not true
      or jsonb_typeof(p->'fixed') is distinct from 'boolean'
      or (p ? 'details' and jsonb_typeof(p->'details') <> 'object')
      or p ? 'recurrence' or p ? 'excludedDates' then
      raise exception 'Invalid event date, time, status or details' using errcode='23514';
    end if;
    d := (p->>'date')::date;
    if p ? 'endDate' then
      if public.life_os_valid_date(p->>'endDate') is not true then
        raise exception 'Invalid end date' using errcode='23514';
      end if;
      ending := (p->>'endDate')::date;
      if ending<d or (ending=d and (p->>'endTime') <= (p->>'startTime')) then
        raise exception 'Event end must follow start' using errcode='23514';
      end if;
    end if;
    foreach k in array array['taskId','subjectId','templateId','planId'] loop
      if p->'details' ? k and public.life_os_uuid(p#>>array['details',k]) is null then
        raise exception 'Invalid event reference' using errcode='23514';
      end if;
    end loop;
  elsif tg_table_name='tasks' then
    if (p->>'priority' in ('low','medium','high')) is not true
      or jsonb_typeof(p->'completed') is distinct from 'boolean'
      or jsonb_typeof(p->'estimatedMinutes') is distinct from 'number'
      or jsonb_typeof(p->'deadline') is distinct from 'string' then
      raise exception 'Invalid task fields' using errcode='23514';
    end if;
    n := (p->>'estimatedMinutes')::numeric;
    if n<>trunc(n) or n not between 5 and 100000 then
      raise exception 'Invalid task duration' using errcode='23514';
    end if;
    if p->>'deadline'<>'' then
      if public.life_os_valid_date(left(p->>'deadline',10)) is not true then
        raise exception 'Invalid task deadline' using errcode='23514';
      end if;
      if length(p->>'deadline')<>10 then
        if (p->>'deadline' ~ '^\d{4}-\d{2}-\d{2}T([01]\d|2[0-3]):[0-5]\d(:[0-5]\d(\.\d+)?)?(Z|[+-]\d{2}:\d{2})?$') is not true then
          raise exception 'Invalid task deadline' using errcode='23514';
        end if;
        perform (p->>'deadline')::timestamptz;
      end if;
    end if;
  elsif tg_table_name='user_preferences' then
    if jsonb_typeof(p->'displayName') is distinct from 'string'
      or length(btrim(p->>'displayName')) not between 1 and 80
      or (coalesce(p->>'language','vi') in ('vi','en')) is not true
      or not exists(select 1 from pg_catalog.pg_timezone_names where name=p->>'timezone') then
      raise exception 'Invalid display name, language or timezone' using errcode='23514';
    end if;
  elsif tg_table_name in ('meal_templates','workout_plans','exercises') then
    if jsonb_typeof(p->'name') is distinct from 'string' or length(btrim(p->>'name')) not between 1 and 200 then
      raise exception 'Invalid record name' using errcode='23514';
    end if;
  elsif tg_table_name='ai_plan_proposals' then
    if jsonb_typeof(p->'summary') is distinct from 'string' or length(btrim(p->>'summary')) not between 1 and 5000
      or jsonb_typeof(p->'events') is distinct from 'array' then
      raise exception 'Invalid AI proposal' using errcode='23514';
    end if;
  end if;
  if tg_table_name in ('meal_templates','meal_logs') then
    foreach k in array array['calories','protein','carbs','fat'] loop
      if p ? k then
        if jsonb_typeof(p->k) is distinct from 'number' or (p->>k)::numeric<0 then
          raise exception 'Invalid nutrition value' using errcode='23514';
        end if;
      end if;
    end loop;
  end if;
  if tg_table_name in ('exercises','exercise_logs') then
    foreach k in array array['sets','reps','weight'] loop
      if jsonb_typeof(p->k) is distinct from 'number' then
        raise exception 'Invalid exercise measurement' using errcode='23514';
      end if;
      n := (p->>k)::numeric;
      if (k='sets' and (n<>trunc(n) or n not between 1 and 100))
        or (k='reps' and (n<>trunc(n) or n not between 1 and 10000))
        or (k='weight' and n not between 0 and 2000) then
        raise exception 'Invalid exercise measurement' using errcode='23514';
      end if;
    end loop;
    if tg_table_name='exercises' and (jsonb_typeof(p->'restSeconds') is distinct from 'number'
      or (p->>'restSeconds')::numeric not between 0 and 3600
      or (p->>'restSeconds')::numeric<>trunc((p->>'restSeconds')::numeric)) then
      raise exception 'Invalid rest duration' using errcode='23514';
    end if;
    if tg_table_name='exercise_logs' and public.life_os_valid_date(p->>'date') is not true then
      raise exception 'Invalid exercise log date' using errcode='23514';
    end if;
    if tg_table_name='exercise_logs' and
      (jsonb_typeof(p->'eventId') is distinct from 'string' or length(p->>'eventId') not between 1 and 160
       or jsonb_typeof(p->'exerciseId') is distinct from 'string' or length(p->>'exerciseId') not between 1 and 160) then
      raise exception 'Invalid historical exercise reference' using errcode='23514';
    end if;
  end if;
  return new;
end $$;

do $$
declare t text;
begin
  foreach t in array array['user_preferences','events','tasks','meal_templates','workout_plans',
    'exercises','exercise_logs','meal_logs','ai_plan_proposals'] loop
    execute format('create trigger validate_payload before insert or update on public.%I
      for each row execute function public.validate_life_os_payload()',t);
  end loop;
end $$;

create function public.validate_life_os_recurrence() returns trigger
language plpgsql security invoker set search_path='' as $$
declare first_date text;
begin
  select event_date into first_date from public.events where user_id=new.user_id and id=new.event_id;
  if new.until_date < first_date::date or cardinality(new.days_of_week) <>
    (select count(distinct day) from unnest(new.days_of_week) day) then
    raise exception 'Invalid recurrence range or duplicate weekdays' using errcode='23514';
  end if;
  return new;
end $$;
create trigger validate_recurrence before insert or update on public.event_recurrences
  for each row execute function public.validate_life_os_recurrence();

-- Metadata has exactly one row per canonical event, never its own schedule.
-- SECURITY INVOKER: these writes must pass the caller's RLS and tenant FKs.
create function public.sync_life_os_event_metadata() returns trigger
language plpgsql security invoker set search_path='' as $$
declare reference_id uuid;
begin
  if new.category='study' then
    select id into reference_id from public.subjects
      where user_id=new.user_id and id=public.life_os_uuid(new.payload#>>'{details,subjectId}');
    insert into public.class_schedules(user_id,event_id,subject_id,room)
      values(new.user_id,new.id,reference_id,coalesce(new.payload->>'location',''))
      on conflict(user_id,event_id) do update set
        subject_id=coalesce(excluded.subject_id,class_schedules.subject_id),room=excluded.room;
  end if;
  if new.category='nutrition' then
    -- Deleting a template keeps the historical event payload, but unlinks its FK.
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
  -- Keep metadata history on category changes; timeline still reads only events.
  return new;
end $$;
create trigger sync_event_metadata after insert or update of payload on public.events
  for each row execute function public.sync_life_os_event_metadata();

-- RLS uses explicit CRUD policies. FOR UPDATE includes WITH CHECK to prevent
-- transferring a record to another account. No PUBLIC/anon access is granted.
do $$
declare t text; owner_column text;
begin
  foreach t in array array['profiles','user_preferences','user_sync_state','events','tasks',
    'subjects','class_schedules','meals','meal_templates','meal_logs','workout_plans',
    'workout_sessions','exercises','exercise_logs','ai_plan_proposals','notifications',
    'event_recurrences','event_exceptions'] loop
    owner_column := case when t='profiles' then 'id' else 'user_id' end;
    execute format('drop policy if exists own_rows on public.%I',t);
    execute format('drop policy if exists own_profile on public.%I',t);
    execute format('alter table public.%I enable row level security',t);
    execute format('revoke all on public.%I from public, anon',t);
    execute format('grant select,insert,update,delete on public.%I to authenticated',t);
    execute format('create policy owner_select on public.%I for select to authenticated using ((select auth.uid())=%I)',t,owner_column);
    execute format('create policy owner_insert on public.%I for insert to authenticated with check ((select auth.uid())=%I)',t,owner_column);
    execute format('create policy owner_update on public.%I for update to authenticated using ((select auth.uid())=%I) with check ((select auth.uid())=%I)',t,owner_column,owner_column);
    execute format('create policy owner_delete on public.%I for delete to authenticated using ((select auth.uid())=%I)',t,owner_column);
  end loop;
end $$;
grant usage on schema public to authenticated;
revoke all on function public.validate_life_os_payload() from public,anon,authenticated;
revoke all on function public.validate_life_os_recurrence() from public,anon,authenticated;
revoke all on function public.sync_life_os_event_metadata() from public,anon,authenticated;
revoke all on function public.touch_updated_at() from public,anon,authenticated;
revoke all on function public.life_os_uuid(text) from public,anon;
revoke all on function public.life_os_valid_date(text) from public,anon;
grant execute on function public.life_os_uuid(text),public.life_os_valid_date(text) to authenticated;

-- STABLE gives all reads within the load RPC one consistent MVCC snapshot.
alter function public.load_life_os() stable;

-- Replacement RPC follows below. Transactional snapshot semantics stay intact.
create or replace function public.save_life_os(p_data jsonb,p_expected_revision bigint)
returns bigint language plpgsql security invoker set search_path='' as $$
declare owner_id uuid := auth.uid(); current_revision bigint; collection text;
begin
  if owner_id is null then raise exception 'Sign in required' using errcode='28000'; end if;
  if p_expected_revision is null or p_expected_revision<0 then
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

  update public.user_sync_state set revision=current_revision+1 where user_id=owner_id;
  return current_revision+1;
end $$;
revoke all on function public.load_life_os(),public.save_life_os(jsonb,bigint) from public,anon;
grant execute on function public.load_life_os(),public.save_life_os(jsonb,bigint) to authenticated;

comment on table public.events is 'Canonical scheduled activities for Timeline and Calendar; local wall-clock times interpreted in user timezone.';
comment on table public.class_schedules is 'Study metadata only; timing belongs to the referenced canonical event.';
comment on table public.meals is 'Scheduled meal metadata only; timing/status belong to events. Actual intake belongs to meal_logs.';
comment on table public.workout_sessions is 'Session metadata only; scheduled timing/status belong to events.';
comment on table public.exercise_logs is 'Historical measurements; payload references survive deletion of a plan or event.';
comment on table public.ai_plan_proposals is 'Private AI proposal history. A proposal never changes events without explicit acceptance by the user.';

-- Validate added constraints without fixing/deleting incompatible legacy data.
-- An incompatibility aborts the entire migration, leaving the old schema intact.
alter table public.user_preferences validate constraint preferences_language;
alter table public.events validate constraint events_task_owner_fk;
alter table public.meal_logs validate constraint meal_logs_event_owner_fk;
alter table public.class_schedules validate constraint class_subject_owner_fk;
alter table public.meals validate constraint meals_template_owner_fk;
alter table public.workout_sessions validate constraint sessions_plan_owner_fk;
alter table public.subjects validate constraint subjects_name_length;
alter table public.exercises validate constraint exercises_position_nonnegative;
alter table public.workout_sessions validate constraint sessions_time_order;
notify pgrst, 'reload schema';
commit;
