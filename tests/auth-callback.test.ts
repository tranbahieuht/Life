import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({ configured: vi.fn(), exchange: vi.fn() }));
vi.mock("@/lib/supabase/config", () => ({ isSupabaseConfigured: mocks.configured }));
vi.mock("@/lib/supabase/server", () => ({ createServerSupabase: async () => ({ auth: { exchangeCodeForSession: mocks.exchange } }) }));
import { GET } from "../src/app/auth/callback/route";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.configured.mockReturnValue(true);
  mocks.exchange.mockResolvedValue({ error: null });
});

describe("Supabase PKCE callback", () => {
  it("exchanges the code and returns to the same-origin workspace", async () => {
    const response = await GET(new NextRequest("https://life.example/auth/callback?code=test-code&next=https://other.example"));
    expect(mocks.exchange).toHaveBeenCalledExactlyOnceWith("test-code");
    expect(response.headers.get("location")).toBe("https://life.example/");
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });

  it("opens password recovery only after a successful exchange", async () => {
    const response = await GET(new NextRequest("https://life.example/auth/callback?code=test-code&next=reset"));
    expect(new URL(response.headers.get("location")!).searchParams.get("reset_password")).toBe("1");
  });

  it("does not call Supabase when the code is missing", async () => {
    const response = await GET(new NextRequest("https://life.example/auth/callback"));
    expect(mocks.exchange).not.toHaveBeenCalled();
    expect(new URL(response.headers.get("location")!).searchParams.has("auth_error")).toBe(true);
  });

  it("does not expose provider errors or open recovery after a rejected code", async () => {
    mocks.exchange.mockResolvedValue({ error: { message: "private-provider-details" } });
    const response = await GET(new NextRequest("https://life.example/auth/callback?code=test-code&next=reset"));
    const location = response.headers.get("location")!;
    expect(location).not.toContain("private-provider-details");
    expect(new URL(location).searchParams.has("reset_password")).toBe(false);
    expect(new URL(location).searchParams.has("auth_error")).toBe(true);
  });

  it("returns a recoverable message when Auth is unavailable", async () => {
    mocks.exchange.mockRejectedValue(new Error("private-provider-details"));
    const response = await GET(new NextRequest("https://life.example/auth/callback?code=test-code"));
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).not.toContain("private-provider-details");
  });
});
