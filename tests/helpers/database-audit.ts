import { readFileSync } from 'node:fs';
import { emptyData, type AppData } from '../../src/lib/types';

export const tables=['profiles','user_preferences','user_sync_state','events','tasks','subjects','class_schedules','meals','meal_templates','meal_logs','workout_plans','workout_sessions','exercises','exercise_logs','ai_plan_proposals','notifications','event_recurrences','event_exceptions'];
export const migrations=['202610260001_life_os.sql','202610270001_schema_hardening.sql','202610270002_final_audit.sql'];
export const sql=(name:string)=>readFileSync(`supabase/migrations/${name}`,'utf8');
export const A='10000000-0000-4000-8000-000000000001';
export const B='20000000-0000-4000-8000-000000000002';
export const E='30000000-0000-4000-8000-000000000003';
export const S='40000000-0000-4000-8000-000000000004';
// Test harness ONLY. Never run this against Supabase; Auth is managed there.
export const bootstrap=`
  create role anon nologin nobypassrls;
  create role authenticated nologin nobypassrls;
  create schema auth; create table auth.users(id uuid primary key);
  create function auth.uid() returns uuid language sql stable as
    $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
  grant usage on schema auth to anon,authenticated;
  grant execute on function auth.uid() to anon,authenticated;
  alter default privileges in schema public grant all on tables to anon,authenticated;
  alter default privileges in schema public grant all on functions to anon,authenticated;
  insert into auth.users values ('${A}'),('${B}');
`;
export function snapshot(title='Hoạt động'):AppData {
  const data=emptyData();
  data.events=[{id:E,title,description:'',date:'2026-10-27',startTime:'09:00',endTime:'10:00',endDate:'2026-10-27',category:'study',status:'planned',fixed:false,location:'',notes:'',details:{}}];
  return data;
}
