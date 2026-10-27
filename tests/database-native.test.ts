import EmbeddedPostgres from 'embedded-postgres';
import type { Client } from 'pg';
import { mkdtemp,rm,mkdir } from 'node:fs/promises';
import { resolve,sep } from 'node:path';
import { createServer } from 'node:net';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { beforeAll,afterAll,it,expect,describe } from 'vitest';
import { A,B,E,bootstrap,migrations,sql,snapshot } from './helpers/database-audit';

// Opt-in native cluster, loopback only. No Supabase URL, env files or user data.
describe.skipIf(process.env.LIFE_OS_NATIVE_PG!=='1')('native PostgreSQL overlapping-session audit',()=>{
  let engine:EmbeddedPostgres;
  let folder:string;
  const root=resolve('.db-tests');
  const clients:Client[]=[];
  async function connect(){const c=engine.getPgClient('postgres','127.0.0.1');await c.connect();clients.push(c);return c;}
  async function user(c:Client,id=A){await c.query('set role authenticated');await c.query("select set_config('request.jwt.claim.sub',$1,false)",[id]);}
  async function load(c:Client){return(await c.query('select public.load_life_os() as s')).rows[0].s;}
  async function save(c:Client,title:string,revision:number){return(await c.query('select public.save_life_os($1::jsonb,$2)::integer as r',[JSON.stringify(snapshot(title)),revision])).rows[0].r;}
  async function waitForLock(observer:Client,pid:number){
    const deadline=Date.now()+8000;
    while(Date.now()<deadline){
      const r=await observer.query("select wait_event_type from pg_stat_activity where pid=$1",[pid]);
      if(r.rows[0]?.wait_event_type==='Lock')return;
      await new Promise(r=>setTimeout(r,25));
    }
    throw new Error('Second connection did not reach the expected database lock');
  }
  beforeAll(async()=>{
    await mkdir(root,{recursive:true});folder=await mkdtemp(resolve(root,'native-'));
    const port=await new Promise<number>((accept,reject)=>{const s=createServer();s.on('error',reject);s.listen(0,'127.0.0.1',()=>{const a=s.address();const port=typeof a==='object'&&a?a.port:0;s.close(()=>accept(port));});});
    engine=new EmbeddedPostgres({databaseDir:folder,port,user:'postgres',password:randomUUID(),persistent:true,
      createPostgresUser:false,initdbFlags:['--encoding=UTF8','--locale=C'],
      postgresFlags:['-c','listen_addresses=127.0.0.1','-c','max_connections=12'],onLog(){},onError(){}});
    await engine.initialise();await engine.start();
    const admin=await connect();await admin.query(bootstrap);
    await admin.query(readFileSync('supabase/preflight.sql','utf8'));
    for(const file of migrations){await admin.query(sql(file));await admin.query(readFileSync('supabase/preflight.sql','utf8'));}
  },60000);
  afterAll(async()=>{
    await Promise.allSettled(clients.map(c=>c.end()));
    if(engine)await engine.stop();
    // Delete only the unique test directory created above, inside the test root.
    if(folder&&resolve(folder).startsWith(root+sep))await rm(folder,{recursive:true,force:true});
  },30000);

  it('applies all migrations on a clean native PostgreSQL database',async()=>{
    const c=await connect();await user(c);
    const revision=await save(c,'Initial',0);expect(revision).toBeGreaterThan(0);
    expect((await load(c)).data.events).toHaveLength(1);
    await c.query('reset role');await c.query(readFileSync('supabase/verify_schema.sql','utf8'));
  });

  it('blocks a second snapshot until commit and then rejects its stale revision',async()=>{
    const one=await connect(),two=await connect(),observer=await connect();await user(one);await user(two);
    const initial=await load(one);
    const pid=(await two.query('select pg_backend_pid() as pid')).rows[0].pid;
    await one.query('begin');const revision=await save(one,'Committed first',initial.revision);
    const pending=save(two,'Must not overwrite',initial.revision).then(value=>({value,error:null}),error=>({value:null,error}));
    try{await waitForLock(observer,pid);}finally{await one.query('commit');}
    const result=await pending;expect(result.error).toMatchObject({code:'40001'});
    const after=await load(two);expect(after.revision).toBe(revision);expect(after.data.events[0].title).toBe('Committed first');
  },20000);

  it('releases locks on rollback so a waiting device can save safely',async()=>{
    const one=await connect(),two=await connect(),observer=await connect();await user(one);await user(two);
    const initial=await load(one);const pid=(await two.query('select pg_backend_pid() as pid')).rows[0].pid;
    await one.query('begin');await save(one,'Will roll back',initial.revision);
    const pending=save(two,'Waiting device succeeds',initial.revision);
    try{await waitForLock(observer,pid);}finally{await one.query('rollback');}
    const revision=await pending;expect(revision).toBeGreaterThan(initial.revision);
    expect((await load(two)).data.events[0].title).toBe('Waiting device succeeds');
  },20000);

  it('orders a direct write and snapshot behind the same lock without lost updates',async()=>{
    // Release earlier test clients so max_connections stays bounded.
    await Promise.all(clients.splice(0).map(c=>c.end()));
    const one=await connect(),two=await connect(),observer=await connect();await user(one);await user(two);
    const initial=await load(one);const pid=(await two.query('select pg_backend_pid() as pid')).rows[0].pid;
    await one.query('begin');
    await one.query("update public.events set payload=jsonb_set(payload,'{title}','\"Direct writer\"') where id=$1",[E]);
    const pending=save(two,'Stale snapshot',initial.revision).then(value=>({value,error:null}),error=>({value:null,error}));
    try{await waitForLock(observer,pid);}finally{await one.query('commit');}
    expect((await pending).error).toMatchObject({code:'40001'});
    expect((await load(two)).data.events[0].title).toBe('Direct writer');
  },20000);

  it('does not block another user behind the first user revision lock',async()=>{
    const one=await connect(),two=await connect();await user(one);await user(two,B);
    await one.query('begin');await one.query('select * from public.user_sync_state where user_id=$1 for update',[A]);
    try{await two.query("set statement_timeout='2s'");expect(await save(two,'Other user',0)).toBeGreaterThan(0);}finally{await one.query('rollback');}
  },10000);

  it('handles two first-ever saves racing to initialize the same revision row',async()=>{
    const one=await connect(),two=await connect(),observer=await connect();
    const owner=randomUUID();await observer.query('insert into auth.users(id) values($1)',[owner]);
    await user(one,owner);await user(two,owner);
    const pid=(await two.query('select pg_backend_pid() as pid')).rows[0].pid;
    await one.query('begin');const revision=await save(one,'First initialization',0);
    const pending=save(two,'Racing initialization',0).then(value=>({value,error:null}),error=>({value:null,error}));
    try{await waitForLock(observer,pid);}finally{await one.query('commit');}
    expect((await pending).error).toMatchObject({code:'40001'});
    expect((await load(two)).revision).toBe(revision);
    expect((await load(two)).data.events[0].title).toBe('First initialization');
  },20000);

  it('rolls back a snapshot whose deferred foreign key fails at transaction commit',async()=>{
    // Earlier clients are no longer in use.
    await Promise.all(clients.splice(0).map(c=>c.end()));
    const c=await connect();await user(c);
    const before=await load(c),invalid=structuredClone(before.data);
    invalid.events[0].title='Must roll back';invalid.events[0].details={taskId:randomUUID()};
    await expect(c.query('select public.save_life_os($1::jsonb,$2)',[JSON.stringify(invalid),before.revision])).rejects.toMatchObject({code:'23503'});
    expect(await load(c)).toEqual(before);
  });
});
