import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { emptyData, type AppData } from '../src/lib/types';
import { appDataSchema } from '../src/lib/validation';

// In-memory PostgreSQL. No env files, network, Supabase project or real accounts.
const db = new PGlite({ extensions: { pgcrypto } });
const baseline = readFileSync('supabase/migrations/202610260001_life_os.sql', 'utf8');
const upgrade = readFileSync('supabase/migrations/202610270001_schema_hardening.sql', 'utf8');
const A = '10000000-0000-4000-8000-000000000001';
const B = '20000000-0000-4000-8000-000000000002';
const C = '30000000-0000-4000-8000-000000000003';
const sentinel = '40000000-0000-4000-8000-000000000004';
const ids = Object.fromEntries(['task','event','mealEvent','workoutEvent','subject','template','plan','exercise','exerciseLog','mealLog','proposal','notice'].map(k => [k, randomUUID()]));
const tables = ['profiles','user_preferences','user_sync_state','tasks','meal_templates','workout_plans',
  'exercises','events','subjects','class_schedules','meals','meal_logs','workout_sessions',
  'exercise_logs','ai_plan_proposals','notifications','event_recurrences','event_exceptions'];
const event = (id: string, category = 'personal', details = {}) => ({ id, title: 'Hoạt động', description: '',
  category, date: '2026-10-27', startTime: '09:00', endTime: '10:00', endDate: '2026-10-27',
  status: 'planned', fixed: false, location: '', notes: '', details });
const task = (id: string) => ({ id, title: 'Công việc', description: '', priority: 'high', deadline: '2026-10-30', estimatedMinutes: 60, category: 'work', completed: false });
const exercise = { id: ids.exercise, name: 'Squat', sets: 3, reps: 10, weight: 40, restSeconds: 60 };

async function user(id: string | null, role = 'authenticated') {
  await db.exec(`set local role ${role}`);
  await db.query("select set_config('request.jwt.claim.sub',$1,true)", [id || '']);
}
async function admin() { await db.exec('reset role'); }
async function insert(table: string, row: Record<string, unknown>, ignore = false) {
  const keys = Object.keys(row);
  return db.query(`insert into public.${table} (${keys.join(',')}) values (${keys.map((_, i) => '$' + (i+1)).join(',')}) ${ignore ? 'on conflict do nothing' : ''} returning *`, Object.values(row).map(v => typeof v === 'object' ? JSON.stringify(v) : v));
}
function rowsFor(owner: string): Record<string, Record<string, unknown>> {
  const base = { user_id: owner };
  return {
    profiles: { id: owner, display_name: 'Bạn' },
    user_preferences: { ...base, payload: emptyData().preferences },
    user_sync_state: { ...base, revision: 0 },
    tasks: { ...base, id: ids.task, payload: task(ids.task) },
    meal_templates: { ...base, id: ids.template, payload: { id: ids.template, name: 'Phở', description: '', calories: 500 } },
    workout_plans: { ...base, id: ids.plan, payload: { id: ids.plan, name: 'Chân', type: 'strength', description: '' } },
    exercises: { ...base, plan_id: ids.plan, id: ids.exercise, payload: exercise },
    events: { ...base, id: ids.event, payload: event(ids.event, 'study') },
    subjects: { ...base, id: ids.subject, name: 'Toán' },
    class_schedules: { ...base, event_id: ids.event, room: '' },
    meals: { ...base, event_id: ids.mealEvent },
    meal_logs: { ...base, id: ids.mealLog, event_id: ids.mealEvent, payload: { id: ids.mealLog, calories: 500 } },
    workout_sessions: { ...base, event_id: ids.workoutEvent },
    exercise_logs: { ...base, id: ids.exerciseLog, payload: { id: ids.exerciseLog, eventId: ids.workoutEvent, exerciseId: ids.exercise, date: '2026-10-27', sets: 3, reps: 10, weight: 40, notes: '' } },
    ai_plan_proposals: { ...base, id: ids.proposal, payload: { id: ids.proposal, summary: 'Đề xuất', events: [] } },
    notifications: { ...base, id: ids.notice, event_id: ids.event, remind_at: '2026-10-27T02:00:00Z' },
    event_recurrences: { ...base, event_id: ids.event, frequency: 'weekly', days_of_week: '{2,4}', until_date: '2026-12-31' },
    event_exceptions: { ...base, event_id: ids.event, occurrence_date: '2026-11-03' },
  };
}
async function seed(owner: string) {
  const fixture = rowsFor(owner);
  for (const table of tables) {
    await insert(table, fixture[table], true);
    if (table === 'events') {
      await insert('events', { user_id: owner, id: ids.mealEvent, payload: event(ids.mealEvent, 'nutrition') });
      await insert('events', { user_id: owner, id: ids.workoutEvent, payload: event(ids.workoutEvent, 'workout') });
    }
  }
}
async function rejected(action: () => Promise<unknown>, code: string) {
  await db.exec('savepoint denial');
  try { await expect(action()).rejects.toMatchObject({ code }); }
  finally { await db.exec('rollback to savepoint denial; release savepoint denial'); }
}
async function save(data: AppData | unknown, revision: number | null = 0) {
  return db.query<{ revision: number }>('select public.save_life_os($1::jsonb,$2::bigint)::integer as revision', [JSON.stringify(data),revision]);
}
async function load() {
  return (await db.query<{ snapshot: { data: AppData; revision: number } }>('select public.load_life_os() as snapshot')).rows[0].snapshot;
}
function snapshot(): AppData {
  const data = emptyData();
  data.tasks = [task(ids.task) as AppData['tasks'][number]];
  data.mealTemplates = [{ id: ids.template, name: 'Phở', description: '', calories: 500 }];
  data.workoutPlans = [{ id: ids.plan, name: 'Chân', type: 'strength', description: '', exercises: [exercise] }];
  data.events = [
    { ...event(ids.event, 'study', { taskId: ids.task }), recurrence: { frequency: 'weekly', daysOfWeek: [2,4], until: '2026-12-31' }, excludedDates: ['2026-11-03'] },
    event(ids.mealEvent, 'nutrition', { templateId: ids.template }),
    event(ids.workoutEvent, 'workout', { planId: ids.plan }),
  ] as AppData['events'];
  return data;
}

beforeAll(async () => {
  await db.exec(`
    create role anon nologin nobypassrls;
    create role authenticated nologin nobypassrls;
    create schema auth;
    create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable as
      $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    grant usage on schema auth to anon,authenticated;
    grant execute on function auth.uid() to anon,authenticated;
    insert into auth.users values ('${A}'),('${B}'),('${C}');
  `);
  await db.exec(baseline);
  await insert('events', { user_id: C, id: sentinel, payload: event(sentinel) });
  await seed(C);
  const before = new Map<string, Record<string,unknown>[]>();
  for (const table of tables) before.set(table,(await db.query<Record<string,unknown>>(`select * from public.${table} t order by to_jsonb(t)->>'id',to_jsonb(t)->>'event_id'`)).rows);
  await db.exec(upgrade);
  for (const table of tables) {
    const after=(await db.query<Record<string,unknown>>(`select * from public.${table} t order by to_jsonb(t)->>'id',to_jsonb(t)->>'event_id'`)).rows;
    expect(after,table).toHaveLength(before.get(table)!.length);
    after.forEach((row,i)=>expect(row,table).toMatchObject(before.get(table)![i]));
  }
}, 60000);
beforeEach(async () => { await db.exec('begin'); });
afterEach(async () => { await db.exec('rollback'); });
afterAll(async () => { await db.close(); });

describe('PostgreSQL schema and tenant ownership', () => {
  it('rolls back the whole upgrade on incompatible legacy rows without rewriting them',async()=>{
    const legacy=new PGlite({extensions:{pgcrypto}});
    try {
      await legacy.exec(`
        create role anon nologin nobypassrls; create role authenticated nologin nobypassrls;
        create schema auth; create table auth.users(id uuid primary key);
        create function auth.uid() returns uuid language sql stable as $$select null::uuid$$;
        insert into auth.users values ('${A}');
      `);
      await legacy.exec(baseline);
      const payload=event(ids.event,'work',{taskId:ids.task});
      await legacy.query('insert into public.events(user_id,id,payload) values ($1,$2,$3::jsonb)',[A,ids.event,JSON.stringify(payload)]);
      await expect(legacy.exec(upgrade)).rejects.toMatchObject({code:'23503'});
      await legacy.exec('rollback');
      expect((await legacy.query<{payload:unknown}>('select payload from public.events')).rows[0].payload).toEqual(payload);
      expect((await legacy.query("select 1 from information_schema.columns where table_schema='public' and table_name='events' and column_name='task_id'")).rows).toEqual([]);
      expect((await legacy.query("select 1 from pg_policies where schemaname='public' and tablename='events' and policyname='own_rows'")).rows).toHaveLength(1);
    } finally {await legacy.close();}
  },30000);

  it('installs PKs, timestamps, four RLS policies and no anonymous access on every table', async () => {
    for (const table of tables) {
      const catalog = (await db.query<{ relrowsecurity: boolean }>(`select relrowsecurity from pg_class where oid=$1::regclass`, ['public.'+table])).rows[0];
      expect(catalog.relrowsecurity, table).toBe(true);
      expect((await db.query('select 1 from pg_constraint where conrelid=$1::regclass and contype=$2', ['public.'+table,'p'])).rows).toHaveLength(1);
      expect((await db.query('select 1 from pg_policies where schemaname=$1 and tablename=$2', ['public',table])).rows).toHaveLength(4);
      expect((await db.query(`select column_name from information_schema.columns where table_schema='public' and table_name=$1 and column_name in ('created_at','updated_at')`, [table])).rows).toHaveLength(2);
      const privileges = await db.query<{ allowed: boolean }>("select has_table_privilege('anon',$1,'SELECT,INSERT,UPDATE,DELETE') as allowed", ['public.'+table]);
      expect(privileges.rows[0].allowed, table).toBe(false);
    }
    expect((await db.query("select conname from pg_constraint where connamespace='public'::regnamespace and not convalidated")).rows).toEqual([]);
    const rpcs=await db.query<{prosecdef:boolean;provolatile:string}>("select prosecdef,provolatile from pg_proc where oid='public.load_life_os()'::regprocedure");
    expect(rpcs.rows[0]).toEqual({prosecdef:false,provolatile:'s'});
  });

  it('keeps the historical v2 RPCs as SECURITY INVOKER',async()=>{
    expect((await db.query("select 1 from pg_proc where oid in ('public.load_life_os()'::regprocedure,'public.save_life_os(jsonb,bigint)'::regprocedure) and prosecdef")).rows).toEqual([]);
  });

  for (const table of tables) it(`${table}: own CRUD allowed, cross-account CRUD and ownership transfer denied`, async () => {
    await seed(A);
    await seed(B);
    const ownerKey = table === 'profiles' ? 'id' : 'user_id';
    await user(B);
    expect((await db.query(`select * from public.${table} where ${ownerKey}=$1`, [A])).rows).toHaveLength(0);
    expect((await db.query(`update public.${table} set updated_at=updated_at where ${ownerKey}=$1 returning *`, [A])).rows).toHaveLength(0);
    expect((await db.query(`delete from public.${table} where ${ownerKey}=$1 returning *`, [A])).rows).toHaveLength(0);
    await rejected(() => insert(table, rowsFor(A)[table]), '42501');
    await user(A);
    expect((await db.query(`select * from public.${table} where ${ownerKey}=$1`, [A])).rows.length).toBeGreaterThan(0);
    expect((await db.query(`update public.${table} set updated_at=updated_at where ${ownerKey}=$1 returning *`, [A])).rows.length).toBeGreaterThan(0);
    await rejected(() => db.query(`update public.${table} set ${ownerKey}=$1 where ${ownerKey}=$2`, [C,A]), '42501');
    expect((await db.query(`delete from public.${table} where ${ownerKey}=$1 returning *`, [A])).rows.length).toBeGreaterThan(0);
    expect((await insert(table,rowsFor(A)[table])).rows).toHaveLength(1);
  });

  it('denies anonymous data and RPC access, including an untrusted sub claim', async () => {
    await seed(A);
    await user(A, 'anon');
    for (const table of tables) {
      await rejected(() => db.query(`select * from public.${table}`), '42501');
      await rejected(() => insert(table,rowsFor(A)[table]), '42501');
      await rejected(() => db.query(`update public.${table} set updated_at=updated_at`), '42501');
      await rejected(() => db.query(`delete from public.${table}`), '42501');
    }
    await rejected(() => load(), '42501');
    await rejected(() => save(emptyData()), '42501');
    await user(null);
    await rejected(() => load(), '28000');
    await rejected(() => save(emptyData()), '28000');
  });

  it('enforces same-owner foreign keys, even when a foreign UUID is known', async () => {
    await seed(A);
    await user(B);
    await rejected(() => insert('class_schedules', { user_id: B, event_id: ids.event }), '23503');
    await rejected(() => insert('exercises', { user_id: B, plan_id: ids.plan, id: ids.exercise, payload: exercise }), '23503');
    await insert('events', { user_id: B, id: ids.event, payload: event(ids.event,'study') });
    await rejected(() => db.query('update public.class_schedules set subject_id=$1 where user_id=$2', [ids.subject,B]), '23503');
    await insert('events', { user_id:B,id:ids.mealEvent,payload:event(ids.mealEvent,'nutrition') });
    await insert('events', { user_id:B,id:ids.workoutEvent,payload:event(ids.workoutEvent,'workout') });
    await rejected(() => db.query('update public.meals set template_id=$1 where user_id=$2',[ids.template,B]), '23503');
    await rejected(() => db.query('update public.workout_sessions set plan_id=$1 where user_id=$2',[ids.plan,B]), '23503');
    await rejected(() => insert('event_recurrences',{user_id:B,event_id:sentinel,frequency:'weekly',days_of_week:'{2}',until_date:'2026-12-31'}), '23503');
    await rejected(() => insert('event_exceptions',{user_id:B,event_id:sentinel,occurrence_date:'2026-11-03'}), '23503');
    await rejected(() => insert('meal_logs',{user_id:B,id:ids.mealLog,event_id:sentinel,payload:{id:ids.mealLog}}), '23503');
    await rejected(() => insert('notifications',{user_id:B,id:ids.notice,event_id:sentinel,remind_at:'2026-10-27T02:00:00Z'}), '23503');
    await rejected(async () => {
      const id=randomUUID();
      await insert('events',{ user_id:B,id,payload:event(id,'work',{taskId:ids.task}) });
      await db.exec('set constraints events_task_owner_fk immediate');
    }, '23503');
  });

  it('rejects invalid JSON fields, mismatched IDs and invalid calendar dates', async () => {
    await user(A);
    for (const payload of [
      { ...event(ids.event), id: randomUUID() },
      { ...event(ids.event), title: null },
      { ...event(ids.event), date: '2026-02-30' },
      { ...event(ids.event), startTime: '25:00' },
      { ...event(ids.event), endTime: '08:00' },
      { ...event(ids.event), status: 'in_progress' },
      { ...event(ids.event), details: { taskId: 'not-a-uuid' } },
    ]) await rejected(() => insert('events', { user_id: A, id: ids.event, payload }), '23514');
    await rejected(() => insert('user_preferences', { user_id:A, payload: { ...emptyData().preferences, timezone:'Not/A_Zone' } }), '23514');
    await rejected(() => insert('tasks', { user_id:A,id:ids.task,payload: { ...task(ids.task), estimatedMinutes:-1 } }), '23514');
  });

  it('prevents changing an event ID without its payload ID', async () => {
    await seed(A);
    await user(A);
    await rejected(()=>db.query('update public.events set id=$1 where id=$2',[randomUUID(),ids.event]),'23514');
  });

  it('validates recurrence bounds and accepts overnight local-clock activities', async () => {
    await user(A);
    await insert('events',{user_id:A,id:ids.event,payload:{...event(ids.event),startTime:'23:00',endTime:'01:00',endDate:'2026-10-28'}});
    await rejected(()=>insert('event_recurrences',{user_id:A,event_id:ids.event,frequency:'weekly',days_of_week:'{2,2}',until_date:'2026-12-31'}),'23514');
    await rejected(()=>insert('event_recurrences',{user_id:A,event_id:ids.event,frequency:'weekly',days_of_week:'{2}',until_date:'2026-10-26'}),'23514');
    expect((await db.query<{start_time:string;end_time:string;end_date:string}>('select start_time,end_time,end_date from public.events')).rows[0]).toEqual({start_time:'23:00',end_time:'01:00',end_date:'2026-10-28'});
  });
});

describe('transactional canonical Timeline sync', () => {
  it('round-trips the frontend contract and materializes exactly one metadata row per event', async () => {
    await user(A);
    const data = snapshot();
    expect((await save(data)).rows[0].revision).toBe(1);
    const loaded = await load();
    expect(appDataSchema.safeParse(loaded.data).success).toBe(true);
    expect(loaded.data.events).toHaveLength(3);
    expect(loaded.data.events.find(e => e.id===ids.event)).toMatchObject(data.events[0]);
    expect(loaded.data.workoutPlans).toEqual(data.workoutPlans);
    expect(loaded.data.tasks).toEqual(data.tasks);
    expect(loaded.data.mealTemplates).toEqual(data.mealTemplates);
    await save(loaded.data,1);
    for (const table of ['class_schedules','meals','workout_sessions']) {
      expect((await db.query(`select * from public.${table}`)).rows).toHaveLength(1);
    }
    expect((await db.query<{template_id:string}>('select template_id from public.meals')).rows[0].template_id).toBe(ids.template);
    expect((await db.query<{plan_id:string}>('select plan_id from public.workout_sessions')).rows[0].plan_id).toBe(ids.plan);
    expect((await db.query<{task_id:string}>('select task_id from public.events where id=$1',[ids.event])).rows[0].task_id).toBe(ids.task);
    await user(B);
    expect((await load()).data).toBeNull();
    await save(emptyData());
    await user(A);
    expect((await load()).revision).toBe(2);
    expect((await load()).data.events).toHaveLength(3);
  });

  it('rejects stale revisions, partial snapshots and invalid writes without losing records', async () => {
    await user(A);
    const data = snapshot();
    await save(data);
    await rejected(() => save(emptyData(),0), '40001');
    await rejected(() => save({ preferences:data.preferences },1), '22023');
    await rejected(() => save(null,1), '22023');
    await rejected(() => save(data,null), '22023');
    const invalid = structuredClone(data);
    invalid.events[0].title='Changed before failure';
    invalid.exerciseLogs=[{ id:randomUUID(),eventId:ids.event,exerciseId:ids.exercise,date:'2026-02-30',sets:3,reps:10,weight:40,notes:'' }];
    await rejected(() => save(invalid,1), '23514');
    const after = await load();
    expect(after.revision).toBe(1);
    expect(after.data.events.find(e=>e.id===ids.event)?.title).toBe('Hoạt động');
    expect(after.data.exerciseLogs).toEqual([]);
  });

  it('keeps creation timestamps on repeated saves and updates modification timestamps', async () => {
    await user(A);
    const data=snapshot();
    await save(data);
    const before=(await db.query('select created_at from public.exercises')).rows;
    await save(data,1);
    expect((await db.query('select created_at from public.exercises')).rows).toEqual(before);
    await db.query("update public.events set updated_at='2000-01-01' where user_id=$1",[A]);
    expect((await db.query<{ fresh: boolean }>("select bool_and(updated_at > '2020-01-01') as fresh from public.events")).rows[0].fresh).toBe(true);
  });

  it('rejects duplicate IDs atomically and removes task links without deleting scheduled sessions', async () => {
    await user(A);
    const data=snapshot();
    await save(data);
    const duplicate=structuredClone(data);
    duplicate.events.push(duplicate.events[0]);
    await rejected(()=>save(duplicate,1),'21000');
    expect((await load()).revision).toBe(1);
    data.tasks=[];
    delete data.events[0].details!.taskId;
    await save(data,1);
    expect((await load()).data.events).toHaveLength(3);
    expect((await load()).data.tasks).toHaveLength(0);
    expect((await db.query<{task_id:string|null}>('select task_id from public.events where id=$1',[ids.event])).rows[0].task_id).toBeNull();
  });

  it('unlinks removed templates/plans, retains timeline and actual meal/exercise history', async () => {
    await user(A);
    const data=snapshot();
    data.exerciseLogs=[{ id:ids.exerciseLog,eventId:ids.workoutEvent,exerciseId:ids.exercise,date:'2026-10-27',sets:3,reps:10,weight:40,notes:'' }];
    await save(data);
    await insert('meal_logs',{ user_id:A,id:ids.mealLog,event_id:ids.mealEvent,payload:{ id:ids.mealLog,calories:500 } });
    data.mealTemplates=[];
    data.workoutPlans=[];
    await save(data,1);
    expect((await db.query<{template_id:string|null}>('select template_id from public.meals')).rows[0].template_id).toBeNull();
    expect((await db.query<{plan_id:string|null}>('select plan_id from public.workout_sessions')).rows[0].plan_id).toBeNull();
    expect((await load()).data.events).toHaveLength(3);
    data.events=[];
    await save(data,2);
    expect((await db.query<{event_id:string|null}>('select event_id from public.meal_logs')).rows[0].event_id).toBeNull();
    expect((await load()).data.exerciseLogs).toHaveLength(1);
  });

  it('keeps scheduled activities when reusable definitions are deleted directly',async()=>{
    await user(A);
    await save(snapshot());
    await db.query('delete from public.meal_templates where id=$1',[ids.template]);
    await db.query('delete from public.workout_plans where id=$1',[ids.plan]);
    expect((await db.query('select * from public.events')).rows).toHaveLength(3);
    expect((await db.query<{template_id:string|null}>('select template_id from public.meals')).rows[0].template_id).toBeNull();
    expect((await db.query<{plan_id:string|null}>('select plan_id from public.workout_sessions')).rows[0].plan_id).toBeNull();
  });
});
