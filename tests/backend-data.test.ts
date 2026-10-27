import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { emptyData } from "../src/lib/types";

const mocks = vi.hoisted(() => ({ configured: vi.fn(() => true), getUser: vi.fn(), rpc: vi.fn() }));
vi.mock("@/lib/supabase/config", () => ({ isSupabaseConfigured: mocks.configured }));
vi.mock("@/lib/supabase/server", () => ({ createServerSupabase: async () => ({ auth: { getUser: mocks.getUser }, rpc: mocks.rpc }) }));
const userId = "31532dd5-4617-43bf-ab79-b7a874f98dd9";
const request = (data: unknown) => new NextRequest("http://127.0.0.1:3000/api/data", { method: "PUT", headers: { "Content-Type": "application/json", Origin: "http://127.0.0.1:3000" }, body: JSON.stringify(data) });

beforeEach(() => {
  vi.resetModules(); vi.clearAllMocks();
  mocks.configured.mockReturnValue(true);
  mocks.getUser.mockResolvedValue({ data: { user: { id: userId } }, error: null });
});
afterEach(() => vi.unstubAllEnvs());

describe("cloud sync route identity and revision protection", () => {
  it.each([null, {}, {data:null}, {data:null,revision:-1}, {data:null,revision:Number.MAX_SAFE_INTEGER+1}])("rejects malformed load envelopes instead of opening an empty workspace: %j", async value => {
    mocks.rpc.mockResolvedValue({data:value,error:null});
    expect((await(await import('../src/app/api/data/route')).GET(new NextRequest('http://localhost/api/data'))).status).toBe(422);
  });
  it.each([null,0,1,"2",Number.MAX_SAFE_INTEGER+1])("rejects invalid save acknowledgements without declaring data synced: %j",async value=>{
    mocks.rpc.mockResolvedValue({data:value,error:null});
    expect((await(await import('../src/app/api/data/route')).PUT(request({data:emptyData(),revision:1,userId}))).status).toBe(503);
  });
  it("returns setup status when Supabase is absent", async () => {
    mocks.configured.mockReturnValue(false);
    expect((await (await import("../src/app/api/data/route")).GET(new NextRequest('http://localhost/api/data'))).status).toBe(503);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("returns the authenticated identity with an empty new account", async () => {
    mocks.rpc.mockResolvedValue({ data: { data: null, revision: 0 }, error: null });
    const response = await (await import("../src/app/api/data/route")).GET(new NextRequest('http://localhost/api/data'));
    expect(await response.json()).toEqual({ data: emptyData(), revision: 0, userId });
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
  });
  it("refuses a stale account's pending save after cookies switch to another account", async () => {
    const response = await (await import("../src/app/api/data/route")).PUT(request({ data: emptyData(), revision: 0, userId: "33df80e8-c835-4c87-90a2-c401c2898fb3" }));
    expect(response.status).toBe(409);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("uses one transactional RPC with the captured revision", async () => {
    mocks.rpc.mockResolvedValue({ data: 2, error: null });
    const data = emptyData();
    const response = await (await import("../src/app/api/data/route")).PUT(request({ data, revision: 1, userId }));
    expect(response.status).toBe(200);
    expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith("save_life_os", { p_data: data, p_expected_revision: 1 });
    expect(await response.json()).toEqual({ revision: 2, userId });
  });
  it("reports a concurrent revision rather than retrying an overwrite", async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code: "40001" } });
    const response = await (await import("../src/app/api/data/route")).PUT(request({ data: emptyData(), revision: 0, userId }));
    expect(response.status).toBe(409);
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
  });
  it("rejects incomplete or unvalidated client data before writing", async () => {
    const response = await (await import("../src/app/api/data/route")).PUT(request({ data: { events: [] }, revision: 0, userId }));
    expect(response.status).toBe(422);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it('persists language preferences using the existing authenticated snapshot without translating enums',async()=>{
    mocks.rpc.mockResolvedValue({data:3,error:null});const data=emptyData();data.preferences.language='en';const before=structuredClone(data);const response=await(await import('../src/app/api/data/route')).PUT(request({data,revision:2,userId}));expect(response.status).toBe(200);expect(mocks.rpc).toHaveBeenCalledWith('save_life_os',{p_data:before,p_expected_revision:2});
  });
  it('retains a returning account language rather than replacing it with the Vietnamese default',async()=>{
    const data=emptyData();data.preferences.language='en';mocks.rpc.mockResolvedValue({data:{data,revision:3},error:null});const response=await(await import('../src/app/api/data/route')).GET(new NextRequest('http://localhost/api/data'));expect((await response.json()).data.preferences.language).toBe('en');
  });
  it('keeps the selected browser language on the first sign-in to an empty cloud workspace',async()=>{
    mocks.rpc.mockResolvedValue({data:{data:null,revision:0},error:null});const response=await(await import('../src/app/api/data/route')).GET(new NextRequest('http://localhost/api/data',{headers:{cookie:'life-os-language=en'}}));expect((await response.json()).data.preferences.language).toBe('en');
  });
  it('returns a localized error together with a stable resource key',async()=>{
    mocks.configured.mockReturnValue(false);const route=await import('../src/app/api/data/route');const viResponse=await route.GET(new NextRequest('http://localhost/api/data',{headers:{'Accept-Language':'vi'}}));const enResponse=await route.GET(new NextRequest('http://localhost/api/data',{headers:{'Accept-Language':'en'}}));expect((await viResponse.json()).error).toContain('Dữ liệu trên thiết bị');expect((await enResponse.json()).error).toContain('Add Supabase');
  });
});
