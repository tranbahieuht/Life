import { createRequire } from 'node:module';

// Load Next's environment rules without logging file contents or credentials.
const require = createRequire(import.meta.url);
const { loadEnvConfig } = require('@next/env');
loadEnvConfig(process.cwd(), true, { info() {}, error() {} });

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const report = {
  configured: Boolean(url && key),
  missingEnvironmentVariables: [
    ...(!url ? ['NEXT_PUBLIC_SUPABASE_URL'] : []),
    ...(!key ? ['NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY'] : []),
  ],
  auth: null,
  databaseApi: null,
};

async function probe(path, summarize) {
  try {
    const response = await fetch(new URL(path, url), {
      headers: { apikey: key },
      signal: AbortSignal.timeout(15000),
      redirect: 'error',
    });
    // Never log response bodies, URLs, headers, tokens or raw exceptions.
    const result = { ok: response.ok, status: response.status };
    const body = await response.json();
    if (response.ok) Object.assign(result, summarize(body));
    else if (/^PGRST\d{3}$/.test(body.code || '')) result.code = body.code;
    return result;
  } catch {
    return { ok: false, reason: 'Network, timeout, URL or response error' };
  }
}

if (report.configured) {
  report.auth = await probe('/auth/v1/settings', body => ({
    emailEnabled: body.external?.email === true,
    signupEnabled: body.disable_signup === false,
  }));
  // The OpenAPI root may require an admin key. Probe an existing app table
  // instead, returning zero records. A missing table is expected before schema
  // deployment and proves PostgREST handled the database schema request.
  report.databaseApi = await probe('/rest/v1/events?select=id&limit=0', () => ({}));
  report.databaseApi.reachable = report.databaseApi.ok || report.databaseApi.code === 'PGRST205';
  report.databaseApi.eventsTableAvailable = report.databaseApi.ok;
  if (report.databaseApi.code === 'PGRST205') {
    report.databaseApi.reason = 'Events table is absent from the exposed schema cache; no schema was created';
  }
}

console.log(JSON.stringify(report, null, 2));
if (!report.auth?.ok || !report.databaseApi?.reachable) process.exitCode = 1;
