import type { NextRequest } from "next/server";

/** Next.js normalizes loopback URLs to localhost, including 127.0.0.1 URLs. */
export function sameRequestOrigin(request: NextRequest) {
  const origin = request.headers.get("origin");
  if (!origin) return true;
  try {
    const parsed = new URL(origin);
    const normalize = (hostname: string) => ["127.0.0.1", "[::1]", "localhost"].includes(hostname) ? "localhost" : hostname;
    return parsed.protocol === request.nextUrl.protocol && parsed.port === request.nextUrl.port && normalize(parsed.hostname) === normalize(request.nextUrl.hostname);
  } catch { return false; }
}
