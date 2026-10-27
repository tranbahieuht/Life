/**
 * Live Supabase isolation / transaction checks. Use TWO DISPOSABLE accounts.
 * No administrator credential is used. Secrets are read only from environment.
 * Run: node --env-file=.env.local supabase/tests/rls.mjs
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

const required = ["LIFE_OS_TEST_EMAIL_A", "LIFE_OS_TEST_PASSWORD_A", "LIFE_OS_TEST_EMAIL_B", "LIFE_OS_TEST_PASSWORD_B"];
const base = process.env.NEXT_PUBLIC_SUPABASE_URL?.replace(/\/$/, "");
const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
if (process.env.LIFE_OS_RUN_LIVE_TESTS !== "1" || !base || !key || required.some(name => !process.env[name])) {
  console.log("SKIPPED: set LIFE_OS_RUN_LIVE_TESTS=1, Supabase public configuration and both disposable test-account credentials. No live checks were run.");
  process.exit(0);
}

const accounts = [];
const created = [];
async function call(account, path, { method = "GET", body } = {}) {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: { apikey: key, ...(account ? { Authorization: `Bearer ${account.token}` } : {}), "Content-Type": "application/json", Prefer: "return=representation" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(20_000),
  });
  const text = await response.text();
  let data;
  try { data = text ? JSON.parse(text) : null; } catch { data = null; }
  return { ok: response.ok, status: response.status, data };
}
async function login(label) {
  const result = await call(null, "/auth/v1/token?grant_type=password", { method: "POST", body: { email: process.env[`LIFE_OS_TEST_EMAIL_${label}`], password: process.env[`LIFE_OS_TEST_PASSWORD_${label}`] } });
  assert.ok(result.ok && result.data?.access_token && result.data?.user?.id, `Test account ${label} could not sign in (HTTP ${result.status}).`);
  const account = { token: result.data.access_token, id: result.data.user.id };
  accounts.push(account);
  return account;
}
function record(id, title) {
  return { id, title, description: "Live isolation verification", category: "personal", date: "2030-01-07", startTime: "10:00", endTime: "11:00", status: "planned", fixed: false, location: "", notes: "" };
}
function blank() {
  return { events: [], tasks: [], mealTemplates: [], workoutPlans: [], exerciseLogs: [], preferences: {
    displayName: "Disposable test", timezone: "Asia/Ho_Chi_Minh", language: "en", theme: "light", timeFormat: "24", wakeTime: "06:30", bedTime: "23:00", mealTimes: "12:00, 18:30", focusHours: "09:00-11:00", breakMinutes: 15, workoutDays: [1,3,5], workoutDuration: 60, fitnessGoal: "Routine", experience: "Beginner", dietaryPreferences: "", allergies: "", budget: "", personalGoal: "Routine",
  } };
}

try {
  const a = await login("A");
  const b = await login("B");
  assert.notEqual(a.id, b.id, "Two different disposable accounts are required.");
  const marker = randomUUID();
  const insert = await call(a, "/rest/v1/events", { method: "POST", body: { user_id: a.id, id: marker, payload: record(marker, "RLS test marker") } });
  assert.ok(insert.ok, `Could not create isolated test event (HTTP ${insert.status}). Apply the migration first.`);
  created.push({ account: a, id: marker });
  const own = await call(a, `/rest/v1/events?user_id=eq.${a.id}&id=eq.${marker}`);
  assert.ok(own.ok && own.data.length === 1, "Account A could not read its own event.");
  const cross = await call(b, `/rest/v1/events?user_id=eq.${a.id}&id=eq.${marker}`);
  assert.ok(cross.ok && cross.data.length === 0, "RLS failure: B could read A's event.");
  const deniedId = randomUUID();
  const write = await call(b, "/rest/v1/events", { method: "POST", body: { user_id: a.id, id: deniedId, payload: record(deniedId, "Must be rejected") } });
  assert.equal(write.status, 403, "RLS failure: B could insert an event for A.");
  const update = await call(b, `/rest/v1/events?user_id=eq.${a.id}&id=eq.${marker}`, { method: "PATCH", body: { payload: record(marker, "Must not change") } });
  assert.ok(!update.ok || update.data.length === 0, "RLS failure: B could update A's event.");
  const unchanged = await call(a, `/rest/v1/events?user_id=eq.${a.id}&id=eq.${marker}`);
  assert.equal(unchanged.data[0].payload.title, "RLS test marker", "A's event changed during B's denied update.");
  const foreign = await call(b, "/rest/v1/class_schedules", { method: "POST", body: { user_id: b.id, event_id: marker, room: "Test" } });
  assert.equal(foreign.status, 409, "Tenant foreign key failed to reject B's reference to A's event.");

  const tables = ["user_preferences", "user_sync_state", "events", "event_recurrences", "event_exceptions", "tasks", "subjects", "class_schedules", "meals", "meal_templates", "meal_logs", "workout_plans", "workout_sessions", "exercises", "exercise_logs", "ai_plan_proposals", "notifications"];
  for (const table of tables) {
    const read = await call(b, `/rest/v1/${table}?user_id=eq.${a.id}&limit=1`);
    assert.ok(read.ok && Array.isArray(read.data) && read.data.length === 0, `Cross-account read failed for ${table}.`);
  }
  const profile = await call(b, `/rest/v1/profiles?id=eq.${a.id}`);
  assert.ok(profile.ok && profile.data.length === 0, "B could read A's profile.");
  console.log("PASS: own event access, cross-account SELECT/INSERT/UPDATE, tenant foreign key and all-table read isolation.");

  const loaded = await call(a, "/rest/v1/rpc/load_life_os", { method: "POST", body: {} });
  assert.ok(loaded.ok, "Could not load A's cloud snapshot.");
  const before = loaded.data.data ?? blank();
  // The directly inserted marker is already in an existing snapshot. New accounts
  // have no preferences yet, so include it explicitly when starting from blank.
  if (!before.events.some(event => event.id === marker)) before.events.push(record(marker, "RLS test marker"));
  const nextId = randomUUID();
  const changed = structuredClone(before);
  changed.events.push(record(nextId, "Transactional test marker"));
  const revision = loaded.data.revision;
  const saved = await call(a, "/rest/v1/rpc/save_life_os", { method: "POST", body: { p_data: changed, p_expected_revision: revision } });
  assert.ok(saved.ok && Number.isSafeInteger(saved.data) && saved.data > revision, "Transactional snapshot save failed.");
  created.push({ account: a, id: nextId });
  const stale = await call(a, "/rest/v1/rpc/save_life_os", { method: "POST", body: { p_data: before, p_expected_revision: revision } });
  assert.equal(stale.data?.code, "40001", "A stale revision was not rejected.");
  const after = await call(a, "/rest/v1/rpc/load_life_os", { method: "POST", body: {} });
  assert.ok(after.ok && after.data.revision === saved.data && after.data.data.events.some(event => event.id === nextId), "A rejected stale write changed data.");

  const invalid = structuredClone(changed);
  invalid.tasks.push({ id: "not-a-uuid", title: "Deliberately invalid" });
  const rollback = await call(a, "/rest/v1/rpc/save_life_os", { method: "POST", body: { p_data: invalid, p_expected_revision: saved.data } });
  assert.ok(!rollback.ok, "Invalid snapshot was accepted.");
  const afterRollback = await call(a, "/rest/v1/rpc/load_life_os", { method: "POST", body: {} });
  assert.ok(afterRollback.ok && afterRollback.data.revision === saved.data && afterRollback.data.data.events.some(event => event.id === nextId), "Failed write did not roll back atomically.");
  const restored = await call(a, "/rest/v1/rpc/save_life_os", { method: "POST", body: { p_data: before, p_expected_revision: saved.data } });
  assert.ok(restored.ok, "Could not restore the test snapshot; do not use active accounts for this check.");
  console.log("PASS: transactional load/save, stale revision protection and failed-write rollback. Snapshot restored.");
} catch (error) {
  console.error(`FAIL: ${error instanceof Error ? error.message : "Live verification failed."}`);
  process.exitCode = 1;
} finally {
  for (const row of created) {
    try { await call(row.account, `/rest/v1/events?user_id=eq.${row.account.id}&id=eq.${row.id}`, { method: "DELETE" }); } catch { console.error("Cleanup could not reach Supabase; remove live test marker events from the disposable account."); }
  }
  for (const account of accounts) {
    try { await call(account, "/auth/v1/logout", { method: "POST" }); } catch { /* Test session expires normally. */ }
  }
}
