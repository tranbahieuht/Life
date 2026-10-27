import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { beforeAll,beforeEach,afterEach,afterAll,describe,it,expect } from 'vitest';
import { readFileSync,writeFileSync } from 'node:fs';
import { A,B,E,S,bootstrap,migrations,sql,snapshot,tables } from './helpers/database-audit';
import type { AppData } from '../src/lib/types';
import { appDataSchema } from '../src/lib/validation';

const db=new PGlite({extensions:{pgcrypto}});
async function user(id:string,role='authenticated'){
  await db.exec(`set local role ${role}`);
  await db.query("select set_config('request.jwt.claim.sub',$1,true)",[id]);
}
async function load(){return(await db.query<{s:{data:AppData;revision:number}}>('select public.load_life_os() as s')).rows[0].s;}
async function save(data:unknown,revision:number){return(await db.query<{r:number}>('select public.save_life_os($1::jsonb,$2)::integer as r',[JSON.stringify(data),revision])).rows[0].r;}
async function denied(action:()=>Promise<unknown>,code='42501'){
  await db.exec('savepoint rejected');
  try{await expect(action()).rejects.toMatchObject({code});}finally{await db.exec('rollback to savepoint rejected;release savepoint rejected');}
}
beforeAll(async()=>{
  await db.exec(bootstrap);
  await db.exec(sql(migrations[0])); await db.exec(sql(migrations[1]));
  // Reproduce grants that plain RLS tests used to miss.
  expect((await db.query<{allowed:boolean}>("select has_table_privilege('authenticated','public.events','TRUNCATE') as allowed")).rows[0].allowed).toBe(true);
  await db.exec('grant select(id) on public.events to anon');
  await db.exec('begin'); await user(A); await save(snapshot(),0);
  const before=await load(); await db.exec('commit');
  await db.exec(sql(migrations[2]));
  await db.exec('begin'); await user(A); expect(await load()).toEqual(before); await db.exec('rollback');
},60000);
beforeEach(async()=>{await db.exec('begin');await user(A);});
afterEach(async()=>{await db.exec('rollback');});
afterAll(async()=>{await db.close();});

describe('final database audit regression tests',()=>{
  for(const table of tables)it(`${table}: least-privilege grants including column ACLs and TRUNCATE`,async()=>{
    for(const privilege of ['TRUNCATE','TRIGGER','REFERENCES']){
      expect((await db.query<{p:boolean}>('select has_table_privilege($1,$2,$3) as p',['authenticated','public.'+table,privilege])).rows[0].p).toBe(false);
    }
    await denied(()=>db.exec(`truncate public.${table} cascade`));
    await user(A,'anon');
    await denied(()=>db.query(`select * from public.${table}`));
    await denied(()=>db.exec(`truncate public.${table} cascade`));
    await db.exec('reset role');
    const privileges=await db.query<{grantee:number}>(`select x.grantee from pg_class c cross join lateral aclexplode(c.relacl) x where c.oid=$1::regclass and x.grantee=0`,['public.'+table]);
    expect(privileges.rows).toHaveLength(0);
    const acl=await db.query<{attacl:unknown}>('select attacl from pg_attribute where attrelid=$1::regclass and attnum>0 and not attisdropped and attacl is not null',['public.'+table]);
    expect(acl.rows).toEqual([]);
  });

  it('keeps the internal revision counter monotonic and non-deletable',async()=>{
    const before=await load();
    await denied(()=>db.query('delete from public.user_sync_state where user_id=$1',[A]));
    await denied(()=>db.query('update public.user_sync_state set revision=0 where user_id=$1',[A]),'23514');
    await user(B);
    await denied(()=>db.query('insert into public.user_sync_state(user_id,revision) values($1,100)',[B]),'23514');
    await user(A); expect((await load()).revision).toBe(before.revision);
  });

  it('invalidates an old snapshot after direct DML and after an uncertain retry',async()=>{
    const original=await load();
    await db.query("update public.events set payload=jsonb_set(payload,'{title}','\"Direct edit\"') where id=$1",[E]);
    const changed=await load();
    expect(changed.revision).toBeGreaterThan(original.revision);
    await denied(()=>save(original.data,original.revision),'40001');
    const revision=await save(changed.data,changed.revision);
    expect(revision).toBeGreaterThan(changed.revision);
    await denied(()=>save(changed.data,changed.revision),'40001');
    expect((await load()).data.events[0].title).toBe('Direct edit');
    expect((await load()).revision).toBe(revision);
  });

  it('unlinks subjects and preserves history across category changes without duplicate events',async()=>{
    await db.query('insert into public.subjects(user_id,id,name) values($1,$2,$3)',[A,S,'Toán']);
    let state=await load(); state.data.events[0].details={subjectId:S}; await save(state.data,state.revision);
    expect((await db.query<{subject_id:string}>('select subject_id from public.class_schedules')).rows[0].subject_id).toBe(S);
    state=await load(); state.data.events[0].details={}; await save(state.data,state.revision);
    expect((await db.query<{subject_id:string|null}>('select subject_id from public.class_schedules')).rows[0].subject_id).toBeNull();
    for(const category of ['nutrition','workout','personal','study'] as const){
      state=await load();state.data.events[0].category=category;await save(state.data,state.revision);
    }
    state=await load();await save(state.data,state.revision);
    expect((await load()).data.events).toHaveLength(1);
    for(const table of ['class_schedules','meals','workout_sessions'])expect((await db.query(`select * from public.${table}`)).rows).toHaveLength(1);
  });

  it('rejects incomplete preferences/checklists that previously saved an unreadable workspace',async()=>{
    const before=await load();
    const incomplete=structuredClone(before.data) as unknown as Record<string,unknown>;
    incomplete.preferences={displayName:'Bạn',language:'vi',timezone:'Asia/Ho_Chi_Minh'};
    await denied(()=>save(incomplete,before.revision),'23514');
    const invalid=structuredClone(before.data); invalid.events[0].checklist=[{id:'one',text:'Task',done:'yes' as unknown as boolean}];
    await denied(()=>save(invalid,before.revision),'23514');
    expect(await load()).toEqual(before);
    expect(appDataSchema.safeParse((await load()).data).success).toBe(true);
  });

  it('loads directly created events/profile without preferences instead of hiding them',async()=>{
    await user(B);
    await db.query('insert into public.profiles(id,display_name) values($1,$2)',[B,'Hiếu']);
    await db.query('insert into public.events(user_id,id,payload) values($1,$2,$3::jsonb)',[B,E,JSON.stringify(snapshot('Direct record').events[0])]);
    const state=await load();
    expect(state.data.preferences.displayName).toBe('Hiếu');
    expect(state.data.preferences.focusHours).toBe(snapshot().preferences.focusHours);
    expect(appDataSchema.safeParse(state.data).success).toBe(true);
    expect(state.data.events[0].title).toBe('Direct record');
    await save(state.data,state.revision);
    expect((await load()).data.events).toHaveLength(1);
  });

  it('rejects inconsistent parent/recurrence dates at commit while permitting atomic reschedules',async()=>{
    await db.query("insert into public.event_recurrences(user_id,event_id,frequency,days_of_week,until_date) values($1,$2,'weekly',array[2],'2026-12-31')",[A,E]);
    await denied(async()=>{
      await db.query("update public.events set payload=jsonb_set(jsonb_set(payload,'{date}','\"2027-01-01\"'),'{endDate}','\"2027-01-01\"') where id=$1",[E]);
      await db.exec('set constraints check_recurrence_boundary immediate');
    },'23514');
    const state=await load();
    state.data.events[0].date='2027-01-01';state.data.events[0].endDate='2027-01-01';state.data.events[0].recurrence!.until='2027-02-01';
    await save(state.data,state.revision);await db.exec('set constraints check_recurrence_boundary immediate');
    expect(appDataSchema.safeParse((await load()).data).success).toBe(true);
  });

  it('serializes submitted same-revision snapshots: one success, one conflict',async()=>{
    const before=await load();
    const results=await Promise.allSettled([save(snapshot('First'),before.revision),save(snapshot('Second'),before.revision)]);
    expect(results.filter(r=>r.status==='fulfilled')).toHaveLength(1);
    expect(results.filter(r=>r.status==='rejected')).toHaveLength(1);
    // PGlite queues one connection. Real overlapping sessions are tested by test:db:native.
  });

  it('verifies the deployment SQL and emits reproducible catalog counts',async()=>{
    await db.exec('reset role');
    await db.exec(readFileSync('supabase/verify_schema.sql','utf8'));
    const catalog=await db.query<{kind:string;count:number}>(`
      select 'tables' as kind,count(*)::int as count from pg_class where relnamespace='public'::regnamespace and relkind='r'
      union all select 'policies',count(*)::int from pg_policy where polrelid in(select oid from pg_class where relnamespace='public'::regnamespace)
      union all select 'constraints',count(*)::int from pg_constraint where connamespace='public'::regnamespace
      union all select 'indexes',count(*)::int from pg_indexes where schemaname='public'
      union all select 'foreign_keys',count(*)::int from pg_constraint where connamespace='public'::regnamespace and contype='f'
      union all select 'checks',count(*)::int from pg_constraint where connamespace='public'::regnamespace and contype='c'
      union all select 'not_null_constraints',count(*)::int from pg_constraint where connamespace='public'::regnamespace and contype='n'
      union all select 'constraint_triggers',count(*)::int from pg_constraint where connamespace='public'::regnamespace and contype='t'
      union all select 'standalone_unique_constraints',count(*)::int from pg_constraint where connamespace='public'::regnamespace and contype='u'
      union all select 'primary_keys',count(*)::int from pg_constraint where connamespace='public'::regnamespace and contype='p';
    `);
    const counts=Object.fromEntries(catalog.rows.map(r=>[r.kind,r.count]));
    expect(counts.tables).toBe(18);expect(counts.policies).toBe(72);
    if(process.env.LIFE_OS_WRITE_AUDIT==='1')writeFileSync('docs/DATABASE_AUDIT_COUNTS.json',JSON.stringify({...counts,domain_rpcs:2},null,2)+'\n');
  });

  it.each([
    "alter policy owner_update on public.events using(true) with check(true)",
    "grant truncate on public.events to authenticated",
    "grant select(id) on public.events to anon",
    "grant execute on function public.save_life_os(jsonb,bigint) to public",
    "alter function public.load_life_os() set search_path=public",
  ])('verification rejects policy/ACL/RPC drift: %s',async statement=>{
    await db.exec('reset role');
    await denied(async()=>{await db.exec(statement);await db.exec(readFileSync('supabase/verify_schema.sql','utf8'));},'P0001');
  });

  it('treats SQL-looking user content as data and preserves the schema',async()=>{
    const state=await load();
    const title="'); drop table public.events cascade; --";
    state.data.events[0].title=title;await save(state.data,state.revision);
    expect((await load()).data.events[0].title).toBe(title);
    expect((await db.query('select * from public.events')).rows).toHaveLength(1);
  });
});
