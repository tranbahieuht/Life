import { describe, expect, it } from "vitest";
import { applyEventOverlay, dateKey, eventDurationMinutes, eventInstants, eventsForDate, findConflicts, shiftDate, statusForEvent, validateEventTimezone, validatePlan, zonedDateTime } from "../src/lib/schedule";
import { emptyData, defaultPreferences, type LifeEvent, type Task } from "../src/lib/types";
import { appDataSchema, lifeEventSchema, planProposalSchema } from "../src/lib/validation";

const event = (changes: Partial<LifeEvent> = {}): LifeEvent => ({
  id: "event-a", title: "Java class", description: "", category: "study", date: "2026-10-26",
  startTime: "07:00", endTime: "09:30", status: "planned", fixed: false, location: "", notes: "", ...changes,
});

describe("timezone-safe calendar", () => {
  it("uses the user's day instead of the machine timezone", () => {
    expect(dateKey(new Date("2026-10-25T18:00:00Z"), "Asia/Ho_Chi_Minh")).toBe("2026-10-26");
    expect(zonedDateTime("2026-10-26", "07:00").toISOString()).toBe("2026-10-26T00:00:00.000Z");
    expect(shiftDate("2026-12-31", 1)).toBe("2027-01-01");
  });
  it("rejects nonexistent DST times rather than silently moving the event", () => {
    expect(() => zonedDateTime("2026-03-08", "02:30", "America/New_York")).toThrow("does not exist");
  });
  it("keeps overnight activities on both days and calculates their real duration", () => {
    const overnight = event({ startTime: "23:30", endTime: "01:00" });
    expect(eventDurationMinutes(overnight)).toBe(90);
    expect(eventsForDate([overnight], "2026-10-26")).toHaveLength(1);
    expect(eventsForDate([overnight], "2026-10-27")).toHaveLength(1);
    expect(eventsForDate([overnight], "2026-10-28")).toHaveLength(0);
  });
  it("respects explicit multiday end dates", () => {
    const trip = event({ startTime: "22:00", endTime: "10:00", endDate: "2026-10-28" });
    expect(eventDurationMinutes(trip)).toBe(2160);
    expect(eventsForDate([trip], "2026-10-27")).toHaveLength(1);
    expect(+eventInstants(trip).end).toBe(+new Date("2026-10-28T03:00:00Z"));
  });
});

describe("weekly class expansion", () => {
  const series = event({ recurrence: { frequency: "weekly", daysOfWeek: [1, 3], until: "2026-11-09" } });
  it("creates stable occurrence identities and respects weekday, range and exceptions", () => {
    const [monday] = eventsForDate([series], "2026-11-02");
    expect(monday.id).toBe("event-a::2026-11-02");
    expect(monday.parentId).toBe("event-a");
    expect(monday.date).toBe("2026-11-02");
    expect(eventsForDate([series], "2026-10-27")).toHaveLength(0);
    expect(eventsForDate([series], "2026-11-11")).toHaveLength(0);
    expect(eventsForDate([{ ...series, excludedDates: ["2026-11-02"] }], "2026-11-02")).toHaveLength(0);
  });
  it("allows a changed single occurrence without duplicating its series instance", () => {
    const master = { ...series, excludedDates: ["2026-11-02"] };
    const changed = event({ id: "changed-occurrence", parentId: series.id, date: "2026-11-02", startTime: "10:00", endTime: "11:00", location: "B202" });
    const instances = eventsForDate([master, changed], "2026-11-02");
    expect(instances).toHaveLength(1);
    expect(instances[0].location).toBe("B202");
    expect(eventsForDate([master, changed], "2026-11-04")[0].startTime).toBe("07:00");
  });
  it("keeps recurring local class times through a DST change", () => {
    const dstSeries = event({ date: "2026-03-02", recurrence: { frequency: "weekly", daysOfWeek: [1], until: "2026-03-16" } });
    const [before] = eventsForDate([dstSeries], "2026-03-02", "America/New_York");
    const [after] = eventsForDate([dstSeries], "2026-03-09", "America/New_York");
    expect(eventInstants(before, "America/New_York").start.getUTCHours()).toBe(12);
    expect(eventInstants(after, "America/New_York").start.getUTCHours()).toBe(11);
  });
});

describe("timeline states and conflicts", () => {
  it("updates exactly at start/end and never equates elapsed with completed", () => {
    expect(statusForEvent(event(), new Date("2026-10-25T23:59:59Z"))).toBe("upcoming");
    expect(statusForEvent(event(), new Date("2026-10-26T00:00:00Z"))).toBe("active");
    expect(statusForEvent(event(), new Date("2026-10-26T02:30:00Z"))).toBe("unconfirmed");
    expect(statusForEvent(event({ status: "completed" }))).toBe("completed");
    expect(statusForEvent(event({ status: "skipped" }))).toBe("skipped");
  });
  it("detects overnight and nested conflicts, with touching boundaries allowed", () => {
    const blocks = [event(), event({ id: "b", startTime: "08:00", endTime: "08:30" }), event({ id: "c", startTime: "09:30", endTime: "10:00" })];
    expect(findConflicts(blocks).map(({ first, second }) => [first.id, second.id])).toEqual([["event-a", "b"]]);
    expect(findConflicts([event({ startTime: "23:00", endTime: "01:00" }), event({ id: "b", date: "2026-10-27", startTime: "00:30", endTime: "02:00" })])).toHaveLength(1);
    expect(findConflicts([blocks[0], { ...blocks[1], status: "skipped" }])).toHaveLength(0);
  });
});

describe("proposal safety", () => {
  it("preserves existing activities and rejects conflicts instead of deleting them", () => {
    const result = validatePlan([event({ id: "new", startTime: "08:30", endTime: "10:00" })], [event({ fixed: true })], defaultPreferences);
    expect(result.valid).toBe(false);
    expect(result.errors.join(" ")).toContain("overlaps");
  });
  it("does not move fixed blocks, exceed waking hours or schedule past task deadlines", () => {
    const task: Task = { id: "task", title: "Assignment", description: "", deadline: "2026-10-26T08:00", estimatedMinutes: 60, category: "study", completed: false, priority: "high" };
    const moved = event({ startTime: "05:00", endTime: "09:00", details: { taskId: "task" } });
    const result = validatePlan([moved], [event({ fixed: true })], defaultPreferences, [task]);
    expect(result.valid).toBe(false);
    expect(result.errors.join(" ")).toContain("fixed");
    expect(result.errors.join(" ")).toContain("waking hours");
    expect(result.errors.join(" ")).toContain("deadline");
  });
  it("accepts a feasible plan without altering the input", () => {
    const existing = [event({ fixed: true })];
    const proposed = [event({ id: "new", startTime: "10:00", endTime: "11:00" })];
    expect(validatePlan(proposed, existing, defaultPreferences)).toEqual({ valid: true, errors: [] });
    expect(existing).toHaveLength(1);
    expect(existing[0].startTime).toBe("07:00");
  });
  it("replaces a dated recurrence occurrence while preserving future classes", () => {
    const series = event({ recurrence: { frequency: "weekly", daysOfWeek: [1], until: "2026-11-30" } });
    const replacement = { ...eventsForDate([series], "2026-11-02")[0], startTime: "10:00", endTime: "11:30" };
    const result = validatePlan([replacement], [series], defaultPreferences);
    expect(result).toEqual({ valid: true, errors: [] });
    const applied = applyEventOverlay([series], [replacement]);
    expect(eventsForDate(applied, "2026-11-02")).toHaveLength(1);
    expect(eventsForDate(applied, "2026-11-02")[0].startTime).toBe("10:00");
    expect(eventsForDate(applied, "2026-11-09")[0].startTime).toBe("07:00");
    expect(series.excludedDates).toBeUndefined();
  });
  it("rejects unlocking a fixed block or replacing an entire series", () => {
    expect(validatePlan([event({ fixed: false })], [event({ fixed: true })], defaultPreferences).valid).toBe(false);
    const series = event({ recurrence: { frequency: "weekly", daysOfWeek: [1], until: "2026-11-30" } });
    expect(validatePlan([event()], [series], defaultPreferences).errors.join(" ")).toContain("recurring series");
  });
  it("materializes accepted recurrence replacements with UUIDs without losing exceptions", () => {
    const series = event({ id: crypto.randomUUID(), recurrence: { frequency: "weekly", daysOfWeek: [1], until: "2026-11-30" } });
    const replacement = { ...eventsForDate([series], "2026-11-02")[0], startTime: "10:00", endTime: "11:30" };
    const accepted = applyEventOverlay([series], [replacement], { materializeOccurrences: true });
    expect(accepted.every(e => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(e.id))).toBe(true);
    expect(accepted[0].excludedDates).toContain("2026-11-02");
    const [instance] = eventsForDate(accepted, "2026-11-02");
    expect(instance.id).not.toBe(replacement.id);
    expect(instance.parentId).toBe(series.id);
    expect(instance.startTime).toBe("10:00");
    const workspace = emptyData(); workspace.events = accepted;
    expect(appDataSchema.safeParse(workspace).success).toBe(true);
  });
  it("checks recurrence replacements for conflicts and protects fixed occurrences", () => {
    const series = event({ recurrence: { frequency: "weekly", daysOfWeek: [1], until: "2026-11-30" } });
    const replacement = { ...eventsForDate([series], "2026-11-02")[0], startTime: "10:00", endTime: "11:30" };
    const commitment = event({ id: "other", date: "2026-11-02", startTime: "11:00", endTime: "12:00", fixed: true });
    expect(validatePlan([replacement], [series, commitment], defaultPreferences).errors.join(" ")).toContain("overlaps");
    expect(validatePlan([{ ...replacement, fixed: true }], [{ ...series, fixed: true }], defaultPreferences).errors.join(" ")).toContain("fixed");
  });
});

describe("server-side validation", () => {
  it("accepts empty real workspaces and rejects malformed date, enum and proposal output", () => {
    expect(appDataSchema.safeParse(emptyData()).success).toBe(true);
    expect(lifeEventSchema.safeParse(event({ date: "2026-02-30" })).success).toBe(false);
    expect(lifeEventSchema.safeParse(event({ endDate: "2026-10-25" })).success).toBe(false);
    expect(planProposalSchema.safeParse({ summary: "Done", events: [{ title: "Only text" }] }).success).toBe(false);
    expect(planProposalSchema.safeParse({ summary: "Done", events: [event()] }).success).toBe(true);
  });
  it("rejects timezone changes or imported schedules with nonexistent future class times", () => {
    const weekly = event({ date: "2026-03-01", startTime: "02:30", endTime: "03:30", recurrence: { frequency: "weekly", daysOfWeek: [0], until: "2026-03-15" } });
    expect(validateEventTimezone([weekly], "Asia/Ho_Chi_Minh").valid).toBe(true);
    const invalid = validateEventTimezone([weekly], "America/New_York");
    expect(invalid.valid).toBe(false);
    expect(invalid.errors.join(" ")).toContain("2026-03-08");
    const workspace = emptyData(); workspace.events = [weekly]; workspace.preferences.timezone = "America/New_York";
    expect(appDataSchema.safeParse(workspace).success).toBe(false);
  });
});
