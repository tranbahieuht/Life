import { afterEach, describe, expect, it, vi } from "vitest";
import { isSupabaseConfigured, supabaseConfig } from "../src/lib/supabase/config";

afterEach(() => vi.unstubAllEnvs());

describe("Supabase public configuration", () => {
  function configure(publishable = "", legacy = "") {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", publishable);
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", legacy);
  }

  it("uses the publishable key when both supported variables exist", () => {
    configure("test-publishable", "test-legacy");
    expect(isSupabaseConfigured()).toBe(true);
    expect(supabaseConfig().key).toBe("test-publishable");
  });

  it("keeps legacy projects compatible", () => {
    configure("", "test-legacy");
    expect(isSupabaseConfigured()).toBe(true);
    expect(supabaseConfig().key).toBe("test-legacy");
  });

  it("does not advertise authentication without a public key", () => {
    configure();
    expect(isSupabaseConfigured()).toBe(false);
    expect(() => supabaseConfig()).toThrow("Cloud sync is not configured yet.");
  });

  it("requires the project URL", () => {
    configure("test-publishable");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
    expect(isSupabaseConfigured()).toBe(false);
    expect(() => supabaseConfig()).toThrow();
  });
});
