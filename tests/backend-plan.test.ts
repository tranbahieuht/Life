import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { defaultPreferences, type LifeEvent } from "../src/lib/types";

const mocks = vi.hoisted(() => ({ configured: vi.fn(() => false), getUser: vi.fn(), rpc: vi.fn() }));
vi.mock("@/lib/supabase/config", () => ({ isSupabaseConfigured: mocks.configured }));
vi.mock("@/lib/supabase/server", () => ({ createServerSupabase: async () => ({ auth: { getUser: mocks.getUser }, rpc: mocks.rpc }) }));

const event: LifeEvent = { id: "cb295617-69ce-48bd-afca-3d1b7093594c", title: "Class", description: "", category: "study", date: "2026-10-26", startTime: "07:00", endTime: "09:00", status: "planned", fixed: true, location: "", notes: "private journal" };
const outputEvent = { id: "", title: "Focus", description: "Build the project", category: "work", date: "2026-10-26", startTime: "10:00", endTime: "11:00", endDate: "2026-10-26", taskId: "" };
const input = () => ({ prompt: "Please schedule one hour of project work", date: "2026-10-26", mode: "balanced", events: [event], tasks: [], preferences: defaultPreferences });
const request = (data: unknown, origin = "http://127.0.0.1:3000") => new NextRequest("http://127.0.0.1:3000/api/plan", { method: "POST", headers: { "Content-Type": "application/json", Origin: origin }, body: JSON.stringify(data) });
const provider = (proposal: unknown) => Response.json({ candidates: [{ finishReason: "STOP", content: { parts: [{ text: typeof proposal === "string" ? proposal : JSON.stringify(proposal) }] } }] });
const route = async () => (await import("../src/app/api/plan/route")).POST;

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  mocks.configured.mockReturnValue(false);
  vi.stubEnv("NODE_ENV", "development");
  vi.stubEnv("GEMINI_API_KEY", "unit-test-key");
  vi.stubGlobal("fetch", vi.fn());
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe("AI proposal route safeguards", () => {
  it("reports missing Gemini configuration without pretending to generate", async () => {
    vi.stubEnv("GEMINI_API_KEY", "");
    expect((await (await route())(request(input()))).status).toBe(503);
    expect(fetch).not.toHaveBeenCalled();
  });
  it("rejects cross-origin requests", async () => {
    expect((await (await route())(request(input(), "https://unrelated.example"))).status).toBe(403);
    expect(fetch).not.toHaveBeenCalled();
  });
  it("requires sign-in for production even if the Host looks like localhost", async () => {
    vi.stubEnv("NODE_ENV", "production");
    expect((await (await route())(request(input()))).status).toBe(401);
    expect(fetch).not.toHaveBeenCalled();
  });
  it("requires a verified authenticated cloud user", async () => {
    mocks.configured.mockReturnValue(true);
    mocks.getUser.mockResolvedValue({ data: { user: null }, error: null });
    expect((await (await route())(request(input()))).status).toBe(401);
    expect(fetch).not.toHaveBeenCalled();
  });
  it("rejects malformed provider JSON and makes no database writes", async () => {
    vi.mocked(fetch).mockResolvedValue(provider("incomplete {"));
    expect((await (await route())(request(input()))).status).toBe(502);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("rejects a schema-invalid provider event", async () => {
    vi.mocked(fetch).mockResolvedValue(provider({ summary: "Plan", warnings: [], events: [{ ...outputEvent, startTime: "25:00" }] }));
    expect((await (await route())(request(input()))).status).toBe(422);
  });
  it("rejects changes to a fixed commitment", async () => {
    vi.mocked(fetch).mockResolvedValue(provider({ summary: "Plan", warnings: [], events: [{ ...outputEvent, id: event.id }] }));
    expect((await (await route())(request(input()))).status).toBe(422);
  });
  it("rejects overlapping new activities", async () => {
    vi.mocked(fetch).mockResolvedValue(provider({ summary: "Plan", warnings: [], events: [{ ...outputEvent, startTime: "08:00", endTime: "09:00" }] }));
    expect((await (await route())(request(input()))).status).toBe(422);
  });
  it("returns a checked preview with a new UUID and excludes private notes from context", async () => {
    vi.mocked(fetch).mockResolvedValue(provider({ summary: "One clear focus block", warnings: [], events: [outputEvent] }));
    const before = JSON.stringify(input());
    const response = await (await route())(request(input()));
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.proposal.events[0].id).toMatch(/^[0-9a-f-]{36}$/);
    expect(body.proposal.events[0].fixed).toBe(false);
    expect(JSON.stringify(input())).toBe(before);
    expect(String(vi.mocked(fetch).mock.calls[0][1]?.body)).not.toContain("private journal");
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("returns provider quota errors without mutating the schedule", async () => {
    vi.mocked(fetch).mockResolvedValue(new Response("", { status: 429 }));
    expect((await (await route())(request(input()))).status).toBe(429);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("supports a seven-day proposal and includes each day's fixed commitments", async () => {
    const later={...event,id:"c5a34310-3a3d-4db0-96b4-33d0524c8a33",title:"Friday lab",date:"2026-10-30"};
    const friday={...outputEvent,date:"2026-10-30",endDate:"2026-10-30"};
    vi.mocked(fetch).mockResolvedValue(provider({summary:"A balanced week",warnings:[],events:[outputEvent,friday]}));
    const response=await (await route())(request({...input(),scope:"week",events:[event,later]}));
    expect(response.status).toBe(200);
    expect((await response.json()).proposal.events).toHaveLength(2);
    expect(String(vi.mocked(fetch).mock.calls[0][1]?.body)).toContain("Friday lab");
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("rejects weekly proposals outside the reviewed seven-day range", async () => {
    vi.mocked(fetch).mockResolvedValue(provider({summary:"Too far",warnings:[],events:[{...outputEvent,date:"2026-11-02",endDate:"2026-11-02"}]}));
    expect((await (await route())(request({...input(),scope:"week"}))).status).toBe(422);
  });
  it("checks an overnight proposal against the following day's actual events", async () => {
    const midnight={...event,id:"c5a34310-3a3d-4db0-96b4-33d0524c8a33",date:"2026-10-27",startTime:"00:00",endTime:"01:00"};
    vi.mocked(fetch).mockResolvedValue(provider({summary:"Night reading",warnings:[],events:[{...outputEvent,category:"rest",startTime:"23:00",endTime:"00:30",endDate:"2026-10-27"}]}));
    expect((await (await route())(request({...input(),events:[midnight]}))).status).toBe(422);
  });
  it('asks in Vietnamese about ambiguous spoken hours before invoking the provider',async()=>{
    const response=await(await route())(request({...input(),prompt:'Mai 4 giờ tập gym',preferences:{...defaultPreferences,language:'vi'}}));
    expect(response.status).toBe(200);expect((await response.json()).clarification).toBe('Bạn muốn 4 giờ sáng hay 16 giờ chiều/tối?');expect(fetch).not.toHaveBeenCalled();expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it('passes Vietnamese communication instructions and resolves tomorrow using the user timezone',async()=>{
    vi.useFakeTimers();vi.setSystemTime(new Date('2026-10-26T08:00:00+07:00'));
    try{vi.mocked(fetch).mockResolvedValue(provider({summary:'Lịch gợi ý cho ngày mai',warnings:[],events:[{...outputEvent,date:'2026-10-27',endDate:'2026-10-27',title:'Tập trung làm dự án'}]}));
      const response=await(await route())(request({...input(),prompt:'Sắp xếp lịch ngày mai cho mình',preferences:{...defaultPreferences,language:'vi'}}));expect(response.status).toBe(200);expect((await response.json()).date).toBe('2026-10-27');const sent=JSON.parse(String(vi.mocked(fetch).mock.calls[0][1]?.body));expect(sent.systemInstruction.parts[0].text).toContain('mốt');const context=JSON.parse(sent.contents[0].parts[0].text).schedulingContext;expect(context.language).toBe('vi');expect(context.timezone).toBe('Asia/Ho_Chi_Minh');
    }finally{vi.useRealTimers();}
  });
  it('returns provider clarification as a question with no proposed writes',async()=>{
    vi.mocked(fetch).mockResolvedValue(provider({summary:'Cần làm rõ',events:[],warnings:[],clarification:'Bạn muốn tập vào thứ Sáu tuần này hay tuần sau?'}));const response=await(await route())(request(input()));expect(response.status).toBe(200);const body=await response.json();expect(body.clarification).toContain('thứ Sáu');expect(body.proposal).toBeUndefined();expect(mocks.rpc).not.toHaveBeenCalled();
  });
});
