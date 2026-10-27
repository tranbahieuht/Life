import { describe, expect, it } from "vitest";
import { needsWorkspaceRecovery, parseWorkspaceCache, type WorkspaceCache } from "../src/hooks/use-life-data";
import { emptyData } from "../src/lib/types";

describe("workspace persistence and recovery", () => {
  it("opens legacy local data while protecting potentially unsynced legacy cloud data", () => {
    const raw = JSON.stringify(emptyData());
    expect(parseWorkspaceCache(raw)?.dirty).toBe(false);
    expect(parseWorkspaceCache(raw, true)?.dirty).toBe(true);
    expect(parseWorkspaceCache(null)).toBeNull();
  });
  it("retains the revision and dirty flag across reloads", () => {
    const cache: WorkspaceCache = { version: 2, data: emptyData(), revision: 9, dirty: true };
    expect(parseWorkspaceCache(JSON.stringify(cache), true)).toEqual(cache);
  });
  it("requires explicit recovery when a successful cloud reload would erase unsynced edits", () => {
    const cloud = emptyData();
    const local = emptyData();
    local.preferences.displayName = "Unsynced name";
    const cache: WorkspaceCache = { version: 2, data: local, revision: 3, dirty: true };
    expect(needsWorkspaceRecovery(cache, cloud)).toBe(true);
    expect(cache.data.preferences.displayName).toBe("Unsynced name");
    expect(needsWorkspaceRecovery({ ...cache, dirty: false }, cloud)).toBe(false);
  });
  it("recognizes an acknowledged save even if its HTTP response was lost", () => {
    const value = emptyData();
    const cache: WorkspaceCache = { version: 2, data: value, revision: 2, dirty: true };
    expect(needsWorkspaceRecovery(cache, structuredClone(value))).toBe(false);
  });
  it("rejects malformed data and invalid revisions rather than silently resetting them", () => {
    expect(() => parseWorkspaceCache("{broken-json")).toThrow();
    expect(() => parseWorkspaceCache(JSON.stringify({ version: 2, data: emptyData(), dirty: false, revision: -1 }))).toThrow();
    expect(() => parseWorkspaceCache(JSON.stringify({ version: 2, data: { events: [] }, dirty: true, revision: 1 }))).toThrow();
  });
});
