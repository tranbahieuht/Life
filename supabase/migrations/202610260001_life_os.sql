-- LIFE OS: tenant-isolated canonical records and transactional snapshot sync.
-- Run with the Supabase SQL editor or `supabase db push` against a new project.
begin;
create extension if not exists pgcrypto;

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null default 'Friend' check (length(display_name) between 1 and 80),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table public.user_preferences (
  user_id uuid primary key references auth.users(id) on delete cascade,
  payload jsonb not null check (jsonb_typeof(payload) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table public.user_sync_state (
  user_id uuid primary key references auth.users(id) on delete cascade,
  revision bigint not null default 0 check (revision >= 0),
  updated_at timestamptz not null default now()
);

-- The typed app schema validates payloads on the server. Indexed columns are
-- generated from the canonical JSON rather than independently maintained copies.
create table public.events (
  user_id uuid not null references auth.users(id) on delete cascade,
  id uuid not null default gen_random_uuid(),
  payload jsonb not null check (jsonb_typeof(payload) = 'object'),
  title text generated always as (payload->>'title') stored,
  event_date text generated always as (payload->>'date') stored,
  category text generated always as (payload->>'category') stored,
  status text generated always as (payload->>'status') stored,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, id),
  check (length(title) between 1 and 200),
  check (event_date ~ '^\d{4}-\d{2}-\d{2}$'),
  check (category in ('study','work','nutrition','workout','personal','rest')),
  check (status in ('planned','completed','skipped'))
);
create index events_user_date on public.events(user_id, event_date);
create index events_user_category on public.events(user_id, category);
create table public.event_recurrences (
  user_id uuid not null,
  event_id uuid not null,
  frequency text not null check (frequency = 'weekly'),
  days_of_week integer[] not null check (cardinality(days_of_week) between 1 and 7 and days_of_week <@ array[0,1,2,3,4,5,6]),
  until_date date not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, event_id),
  foreign key (user_id, event_id) references public.events(user_id, id) on delete cascade
);
create table public.event_exceptions (
  user_id uuid not null,
  event_id uuid not null,
  occurrence_date date not null,
  action text not null default 'exclude' check (action = 'exclude'),
  created_at timestamptz not null default now(),
  primary key (user_id, event_id, occurrence_date),
  foreign key (user_id, event_id) references public.events(user_id, id) on delete cascade
);
create table public.tasks (
  user_id uuid not null references auth.users(id) on delete cascade,
  id uuid not null default gen_random_uuid(),
  payload jsonb not null check (jsonb_typeof(payload) = 'object'),
  title text generated always as (payload->>'title') stored,
  deadline text generated always as (payload->>'deadline') stored,
  priority text generated always as (payload->>'priority') stored,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  primary key (user_id,id),
  check (length(title) between 1 and 200),
  check (priority in ('low','medium','high'))
);
create index tasks_user_deadline on public.tasks(user_id, deadline);
create table public.meal_templates (
  user_id uuid not null references auth.users(id) on delete cascade,
  id uuid not null default gen_random_uuid(),
  payload jsonb not null check (jsonb_typeof(payload) = 'object'),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  primary key (user_id,id)
);
create table public.workout_plans (
  user_id uuid not null references auth.users(id) on delete cascade,
  id uuid not null default gen_random_uuid(),
  payload jsonb not null check (jsonb_typeof(payload) = 'object'),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  primary key (user_id,id)
);
create table public.exercises (
  user_id uuid not null,
  plan_id uuid not null,
  id uuid not null default gen_random_uuid(),
  position integer not null default 0,
  payload jsonb not null check (jsonb_typeof(payload) = 'object'),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  primary key (user_id,plan_id,id),
  foreign key (user_id,plan_id) references public.workout_plans(user_id,id) on delete cascade
);
create table public.exercise_logs (
  user_id uuid not null references auth.users(id) on delete cascade,
  id uuid not null default gen_random_uuid(),
  payload jsonb not null check (jsonb_typeof(payload) = 'object'),
  log_date text generated always as (payload->>'date') stored,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  primary key (user_id,id)
);
create index exercise_logs_user_date on public.exercise_logs(user_id,log_date);

-- Optional metadata records reference canonical timeline events. There is no
-- second meal/class/workout time source for the timeline to drift out of sync.
create table public.subjects (
  user_id uuid not null references auth.users(id) on delete cascade,
  id uuid not null default gen_random_uuid(), name text not null, instructor text not null default '',
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  primary key (user_id,id)
);
create table public.class_schedules (
  user_id uuid not null, event_id uuid not null, subject_id uuid,
  room text not null default '',
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  primary key (user_id,event_id),
  foreign key (user_id,event_id) references public.events(user_id,id) on delete cascade,
  foreign key (user_id,subject_id) references public.subjects(user_id,id)
);
create table public.meals (
  user_id uuid not null, event_id uuid not null, template_id uuid,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  primary key (user_id,event_id),
  foreign key (user_id,event_id) references public.events(user_id,id) on delete cascade,
  foreign key (user_id,template_id) references public.meal_templates(user_id,id)
);
create table public.meal_logs (
  user_id uuid not null references auth.users(id) on delete cascade,
  id uuid not null default gen_random_uuid(), event_id uuid,
  payload jsonb not null check (jsonb_typeof(payload) = 'object'),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  primary key (user_id,id),
  foreign key (user_id,event_id) references public.events(user_id,id) on delete cascade
);
create table public.workout_sessions (
  user_id uuid not null, event_id uuid not null, plan_id uuid,
  started_at timestamptz, completed_at timestamptz,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  primary key (user_id,event_id),
  foreign key (user_id,event_id) references public.events(user_id,id) on delete cascade,
  foreign key (user_id,plan_id) references public.workout_plans(user_id,id)
);
create table public.ai_plan_proposals (
  user_id uuid not null references auth.users(id) on delete cascade,
  id uuid not null default gen_random_uuid(),
  payload jsonb not null check (jsonb_typeof(payload) = 'object'),
  status text not null default 'proposed' check (status in ('proposed','accepted','rejected')),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  primary key (user_id,id)
);
create table public.notifications (
  user_id uuid not null references auth.users(id) on delete cascade,
  id uuid not null default gen_random_uuid(), event_id uuid,
  remind_at timestamptz not null, read_at timestamptz,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  primary key (user_id,id),
  foreign key (user_id,event_id) references public.events(user_id,id) on delete cascade
);
create index notifications_user_due on public.notifications(user_id,remind_at) where read_at is null;

-- SECURITY INVOKER and explicit schema/search path prevent privilege escalation.
create function public.touch_updated_at() returns trigger language plpgsql
set search_path = '' as $$ begin new.updated_at = now(); return new; end $$;
do $$
declare relation text;
begin
  foreach relation in array array['profiles','user_preferences','user_sync_state','events','event_recurrences','tasks','subjects','class_schedules','meals','meal_templates','meal_logs','workout_plans','workout_sessions','exercises','exercise_logs','ai_plan_proposals','notifications'] loop
    execute format('create trigger touch_updated_at before update on public.%I for each row execute function public.touch_updated_at()', relation);
  end loop;
  foreach relation in array array['user_preferences','user_sync_state','events','event_recurrences','event_exceptions','tasks','subjects','class_schedules','meals','meal_templates','meal_logs','workout_plans','workout_sessions','exercises','exercise_logs','ai_plan_proposals','notifications'] loop
    execute format('alter table public.%I enable row level security', relation);
    execute format('create policy own_rows on public.%I for all to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id)', relation);
    execute format('grant select,insert,update,delete on public.%I to authenticated', relation);
    execute format('revoke all on public.%I from anon', relation);
  end loop;
end $$;
alter table public.profiles enable row level security;
create policy own_profile on public.profiles for all to authenticated using ((select auth.uid()) = id) with check ((select auth.uid()) = id);
grant select,insert,update,delete on public.profiles to authenticated;
revoke all on public.profiles from anon;

create function public.load_life_os() returns jsonb language plpgsql security invoker
set search_path = '' as $$
declare owner_id uuid := auth.uid(); preferences jsonb; revision bigint;
begin
  if owner_id is null then raise exception 'Sign in required' using errcode='28000'; end if;
  select p.payload into preferences from public.user_preferences p where p.user_id=owner_id;
  select s.revision into revision from public.user_sync_state s where s.user_id=owner_id;
  if preferences is null then return jsonb_build_object('data',null,'revision',coalesce(revision,0)); end if;
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

create function public.save_life_os(p_data jsonb,p_expected_revision bigint) returns bigint language plpgsql security invoker
set search_path = '' as $$
declare owner_id uuid := auth.uid(); current_revision bigint;
begin
  if owner_id is null then raise exception 'Sign in required' using errcode='28000'; end if;
  if jsonb_typeof(p_data) <> 'object' or jsonb_typeof(p_data->'preferences') <> 'object'
    or jsonb_typeof(p_data->'events') <> 'array' or jsonb_typeof(p_data->'tasks') <> 'array'
    or jsonb_typeof(p_data->'mealTemplates') <> 'array' or jsonb_typeof(p_data->'workoutPlans') <> 'array'
    or jsonb_typeof(p_data->'exerciseLogs') <> 'array' then
    raise exception 'Invalid data shape' using errcode='22023';
  end if;
  if pg_column_size(p_data) > 4000000 then raise exception 'Snapshot too large' using errcode='22023'; end if;
  insert into public.user_sync_state(user_id) values(owner_id) on conflict do nothing;
  select s.revision into current_revision from public.user_sync_state s where s.user_id=owner_id for update;
  if current_revision <> p_expected_revision then raise exception 'Cloud revision changed' using errcode='40001'; end if;
  insert into public.profiles(id,display_name) values(owner_id,p_data->'preferences'->>'displayName')
    on conflict(id) do update set display_name=excluded.display_name;
  insert into public.user_preferences(user_id,payload) values(owner_id,p_data->'preferences')
    on conflict(user_id) do update set payload=excluded.payload;

  insert into public.events(user_id,id,payload)
    select owner_id,(e->>'id')::uuid,e-'recurrence'-'excludedDates' from jsonb_array_elements(p_data->'events') e
    on conflict(user_id,id) do update set payload=excluded.payload;
  delete from public.events where user_id=owner_id and id not in (select (e->>'id')::uuid from jsonb_array_elements(p_data->'events') e);
  delete from public.event_recurrences where user_id=owner_id;
  insert into public.event_recurrences(user_id,event_id,frequency,days_of_week,until_date)
    select owner_id,(e->>'id')::uuid,e->'recurrence'->>'frequency',array(select jsonb_array_elements_text(e->'recurrence'->'daysOfWeek')::integer),(e->'recurrence'->>'until')::date
    from jsonb_array_elements(p_data->'events') e where e ? 'recurrence';
  delete from public.event_exceptions where user_id=owner_id;
  insert into public.event_exceptions(user_id,event_id,occurrence_date)
    select distinct owner_id,(e->>'id')::uuid,x::date from jsonb_array_elements(p_data->'events') e cross join lateral jsonb_array_elements_text(coalesce(e->'excludedDates','[]'::jsonb)) x;

  insert into public.tasks(user_id,id,payload) select owner_id,(e->>'id')::uuid,e from jsonb_array_elements(p_data->'tasks') e
    on conflict(user_id,id) do update set payload=excluded.payload;
  delete from public.tasks where user_id=owner_id and id not in (select (e->>'id')::uuid from jsonb_array_elements(p_data->'tasks') e);
  insert into public.meal_templates(user_id,id,payload) select owner_id,(e->>'id')::uuid,e from jsonb_array_elements(p_data->'mealTemplates') e
    on conflict(user_id,id) do update set payload=excluded.payload;
  -- Unlink optional metadata rather than losing its canonical event on template removal.
  update public.meals set template_id=null where user_id=owner_id and template_id not in (select (e->>'id')::uuid from jsonb_array_elements(p_data->'mealTemplates') e);
  delete from public.meal_templates where user_id=owner_id and id not in (select (e->>'id')::uuid from jsonb_array_elements(p_data->'mealTemplates') e);
  insert into public.workout_plans(user_id,id,payload) select owner_id,(e->>'id')::uuid,e-'exercises' from jsonb_array_elements(p_data->'workoutPlans') e
    on conflict(user_id,id) do update set payload=excluded.payload;
  update public.workout_sessions set plan_id=null where user_id=owner_id and plan_id not in (select (e->>'id')::uuid from jsonb_array_elements(p_data->'workoutPlans') e);
  delete from public.workout_plans where user_id=owner_id and id not in (select (e->>'id')::uuid from jsonb_array_elements(p_data->'workoutPlans') e);
  delete from public.exercises where user_id=owner_id;
  insert into public.exercises(user_id,plan_id,id,position,payload)
    select owner_id,(p->>'id')::uuid,(x.value->>'id')::uuid,x.ordinality::integer,x.value
    from jsonb_array_elements(p_data->'workoutPlans') p cross join lateral jsonb_array_elements(p->'exercises') with ordinality x(value,ordinality);
  insert into public.exercise_logs(user_id,id,payload) select owner_id,(e->>'id')::uuid,e from jsonb_array_elements(p_data->'exerciseLogs') e
    on conflict(user_id,id) do update set payload=excluded.payload;
  delete from public.exercise_logs where user_id=owner_id and id not in (select (e->>'id')::uuid from jsonb_array_elements(p_data->'exerciseLogs') e);

  update public.user_sync_state set revision=current_revision+1 where user_id=owner_id;
  return current_revision+1;
end $$;
revoke all on function public.load_life_os() from public,anon;
revoke all on function public.save_life_os(jsonb,bigint) from public,anon;
grant execute on function public.load_life_os() to authenticated;
grant execute on function public.save_life_os(jsonb,bigint) to authenticated;
commit;
