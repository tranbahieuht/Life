import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

function runProbe(status: number, code?: string) {
  const source = `
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://probe.example';
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = 'test-public-key-sentinel';
    globalThis.fetch = async (url) => {
      const auth = url.pathname === '/auth/v1/settings';
      if (!auth && url.searchParams.get('limit') !== '0') throw new Error('Unexpected row access');
      return new Response(JSON.stringify(auth
        ? { external: { email: true }, disable_signup: false }
        : { code: ${JSON.stringify(code)}, message: 'test-private-message-sentinel' }),
        { status: auth ? 200 : ${status} });
    };
    await import('./scripts/check-supabase.mjs');
  `;
  let output: string;
  try {
    output = execFileSync(process.execPath, ['--input-type=module', '-e', source], { encoding: 'utf8' });
  } catch (error) {
    output = String((error as { stdout: string }).stdout);
  }
  expect(output).not.toContain('test-public-key-sentinel');
  expect(output).not.toContain('test-private-message-sentinel');
  expect(output).not.toContain('probe.example');
  return JSON.parse(output);
}

describe('read-only Supabase connection probe', () => {
  it('distinguishes a missing schema from a failed connection', () => {
    expect(runProbe(404, 'PGRST205').databaseApi).toMatchObject({ reachable: true, eventsTableAvailable: false });
  });
  it('does not report rejected credentials as a successful connection', () => {
    expect(runProbe(401, 'PGRST301').databaseApi.reachable).toBe(false);
  });
  it('recognizes an accessible table without fetching rows', () => {
    expect(runProbe(200).databaseApi).toMatchObject({ reachable: true, eventsTableAvailable: true });
  });
});
