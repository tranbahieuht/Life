"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { User } from "@supabase/supabase-js";
import type { AppData } from "@/lib/types";
import { emptyData } from "@/lib/types";
import { appDataSchema } from "@/lib/validation";
import { createBrowserSupabase } from "@/lib/supabase/client";

export interface WorkspaceCache {
  version: 2;
  data: AppData;
  revision: number | null;
  dirty: boolean;
}

export interface WorkspaceRecovery {
  local: AppData;
  cloud: AppData;
  cloudRevision: number;
}

/** Legacy cloud caches may contain unacknowledged edits, so treat them as dirty. */
export function parseWorkspaceCache(raw: string | null, cloud = false): WorkspaceCache | null {
  if (!raw) return null;
  const decoded: unknown = JSON.parse(raw);
  if (typeof decoded === "object" && decoded !== null && "version" in decoded && decoded.version === 2) {
    const value = decoded as Record<string, unknown>;
    if (typeof value.dirty !== "boolean" || (value.revision !== null && (typeof value.revision !== "number" || !Number.isSafeInteger(value.revision) || value.revision < 0))) {
      throw new Error("Saved workspace metadata is invalid.");
    }
    return { version: 2, data: appDataSchema.parse(value.data), revision: value.revision as number | null, dirty: value.dirty };
  }
  return { version: 2, data: appDataSchema.parse(decoded), revision: null, dirty: cloud };
}

/** A successful GET must never silently overwrite a device's unsynced work. */
export function needsWorkspaceRecovery(cache: WorkspaceCache | null, cloud: AppData): boolean {
  return !!cache?.dirty && JSON.stringify(cache.data) !== JSON.stringify(cloud);
}

export function useLifeData() {
  const [data, update] = useState<AppData>(emptyData);
  const [ready, setReady] = useState(false);
  const [demo, setDemo] = useState(false);
  const [user, setUser] = useState<User | null>(null);
  const [config, setConfig] = useState({ supabaseConfigured: false, aiConfigured: false });
  const [sync, setSync] = useState("Loading your workspace…");
  const [error, setError] = useState("");
  const [recovery, setRecovery] = useState<WorkspaceRecovery | null>(null);
  const key = useRef("life-os:local:v1");
  const storageTarget = useRef(key.current);
  const revision = useRef<number | null>(null);
  const dirty = useRef(false);
  const latest = useRef(data);
  const lastSent = useRef("");
  const cloudReady = useRef(false);
  const currentUser = useRef<string | null>(null);
  const generation = useRef(0);
  const alive = useRef(false);
  const activeSave = useRef<{ token: symbol; controller: AbortController } | null>(null);
  const activeLoad = useRef<AbortController | null>(null);
  const pendingRecovery = useRef<WorkspaceRecovery | null>(null);
  const loadCloudRef = useRef<(() => Promise<void>) | null>(null);

  const persist = useCallback((value: AppData, changed = dirty.current) => {
    const cache: WorkspaceCache = { version: 2, data: value, revision: revision.current, dirty: changed };
    try {
      localStorage.setItem(storageTarget.current, JSON.stringify(cache));
      return true;
    } catch {
      setError("This browser could not save your changes. Export a backup before closing.");
      return false;
    }
  }, []);

  const read = useCallback((storageKey: string, cloud = false): WorkspaceCache => {
    storageTarget.current = storageKey;
    try {
      return parseWorkspaceCache(localStorage.getItem(storageKey), cloud) || { version: 2, data: emptyData(), revision: null, dirty: false };
    } catch {
      // Keep malformed or incompatible JSON intact. New work uses a separate recovery key.
      storageTarget.current = `${storageKey}:recovery`;
      setError("Saved data could not be opened. The original is still in this browser; new changes use a separate recovery copy. Export a backup before clearing browser storage.");
      try {
        return parseWorkspaceCache(localStorage.getItem(storageTarget.current), cloud) || { version: 2, data: emptyData(), revision: null, dirty: false };
      } catch {
        return { version: 2, data: emptyData(), revision: null, dirty: false };
      }
    }
  }, []);

  const pump = useCallback(async () => {
    if (activeSave.current || !cloudReady.current || !currentUser.current || pendingRecovery.current) return;
    const run = generation.current;
    const userId = currentUser.current;
    const token = Symbol("cloud-save");
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort("timeout"), 20_000);
    activeSave.current = { token, controller };
    try {
      while (alive.current && run === generation.current && cloudReady.current && !pendingRecovery.current) {
        const value = latest.current;
        const snapshot = JSON.stringify(value);
        if (snapshot === lastSent.current) {
          dirty.current = false;
          persist(value, false);
          break;
        }
        setSync("Saving to cloud…");
        const response = await fetch("/api/data", {
          method: "PUT", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ data: value, revision: revision.current, userId }), signal: controller.signal,
        });
        const result = await response.json();
        if (!alive.current || run !== generation.current || currentUser.current !== userId) return;
        if (!response.ok) {
          if (response.status === 409 || response.status === 401) cloudReady.current = false;
          throw new Error(result.errorKey || result.error || "Cloud save unavailable. Changes remain saved on this device.");
        }
        if (result.userId !== userId || !Number.isSafeInteger(result.revision) || result.revision < 0) {
          cloudReady.current = false;
          throw new Error("Your account changed while syncing. Retry to open the correct workspace; your device copy is safe.");
        }
        revision.current = result.revision;
        lastSent.current = snapshot;
        dirty.current = JSON.stringify(latest.current) !== snapshot;
        setError("");
        persist(latest.current, dirty.current);
      }
      if (alive.current && run === generation.current) setSync("All changes saved");
    } catch (reason) {
      if (alive.current && run === generation.current && (!controller.signal.aborted || controller.signal.reason === "timeout")) {
        dirty.current = true;
        persist(latest.current, true);
        setError(controller.signal.reason === "timeout" ? "Cloud sync timed out. Your changes are kept on this device; retry when your connection is ready." : reason instanceof Error ? reason.message : "Cloud save unavailable. Your device copy is safe.");
        setSync("Saved on this device · sync needs attention");
      }
    } finally {
      clearTimeout(timeout);
      // An old account's request must not release a new account's active save lock.
      if (activeSave.current?.token === token) activeSave.current = null;
    }
  }, [persist]);

  useEffect(() => {
    alive.current = true;
    let disposed = false;
    let unsubscribe: (() => void) | undefined;
    const setWorkspace = (value: AppData) => { latest.current = value; update(value); };
    const openLocal = () => {
      let isDemo = false;
      try { isDemo = localStorage.getItem("life-os:mode") === "demo"; } catch { /* read() provides the storage error */ }
      setDemo(isDemo);
      key.current = isDemo ? "life-os:demo:v1" : "life-os:local:v1";
      const cache = read(key.current);
      revision.current = null;
      dirty.current = false;
      setWorkspace(cache.data);
      setSync(isDemo ? "Demo workspace · saved on this device" : "Local workspace · saved on this device");
      setReady(true);
    };
    openLocal();

    const loadCloud = async () => {
      const userId = currentUser.current;
      if (!userId || !alive.current || disposed) return;
      const run = generation.current;
      activeLoad.current?.abort();
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort("timeout"), 20_000);
      activeLoad.current = controller;
      cloudReady.current = false;
      setSync("Opening cloud workspace…");
      try {
        const response = await fetch("/api/data", { cache: "no-store", signal: controller.signal });
        const result = await response.json();
        if (!alive.current || disposed || controller.signal.aborted || run !== generation.current || userId !== currentUser.current) return;
        if (!response.ok) throw new Error(result.errorKey || result.error || "Cloud workspace unavailable.");
        if (result.userId !== userId || !Number.isSafeInteger(result.revision) || result.revision < 0) throw new Error("Your account changed while opening this workspace. Retry to load the correct account.");
        const cloud = appDataSchema.parse(result.data);
        const cache: WorkspaceCache = { version: 2, data: latest.current, revision: revision.current, dirty: dirty.current };
        if (needsWorkspaceRecovery(cache, cloud)) {
          const conflict = { local: latest.current, cloud, cloudRevision: result.revision };
          pendingRecovery.current = conflict;
          setRecovery(conflict);
          setError("This device has unsynced changes. Choose which copy to keep before cloud sync continues.");
          setSync("Device changes kept · recovery needed");
          persist(latest.current, true);
        } else {
          revision.current = result.revision;
          lastSent.current = JSON.stringify(cloud);
          dirty.current = false;
          pendingRecovery.current = null;
          setRecovery(null);
          setWorkspace(cloud);
          setError("");
          persist(cloud, false);
          cloudReady.current = true;
          setSync("All changes saved");
        }
      } catch (reason) {
        if (alive.current && !disposed && (!controller.signal.aborted || controller.signal.reason === "timeout") && run === generation.current && userId === currentUser.current) {
          setError(controller.signal.reason === "timeout" ? "The cloud workspace took too long to open. Your device copy is available; retry when your connection is ready." : reason instanceof Error ? reason.message : "Cloud unavailable. Your device copy has been kept.");
          setSync("Offline copy · cloud sync unavailable");
        }
      } finally {
        clearTimeout(timeout);
        if (activeLoad.current === controller) activeLoad.current = null;
        if (alive.current && !disposed && (!controller.signal.aborted || controller.signal.reason === "timeout") && run === generation.current) setReady(true);
      }
    };
    loadCloudRef.current = loadCloud;

    const changeIdentity = (next: User | null) => {
      if (!alive.current || disposed) return;
      const nextId = next?.id || null;
      if (nextId === currentUser.current) { setUser(next); return; }
      generation.current++;
      activeLoad.current?.abort();
      activeSave.current?.controller.abort();
      activeLoad.current = null;
      activeSave.current = null;
      currentUser.current = nextId;
      cloudReady.current = false;
      pendingRecovery.current = null;
      setRecovery(null);
      revision.current = null;
      dirty.current = false;
      lastSent.current = "";
      setError("");
      // Clear the previous account synchronously, before reading or fetching the next account.
      setWorkspace(emptyData());
      setUser(next);
      if (!nextId) { openLocal(); return; }
      setDemo(false);
      setReady(false);
      key.current = `life-os:cloud:${nextId}`;
      const cache = read(key.current, true);
      revision.current = cache.revision;
      dirty.current = cache.dirty;
      setWorkspace(cache.data);
      void loadCloud();
    };

    fetch("/api/config").then(response => response.json()).then(async settings => {
      if (!alive.current || disposed) return;
      setConfig(settings);
      if (!settings.supabaseConfigured) return;
      const supabase = createBrowserSupabase();
      // Listen before the network lookup so a sign-in or sign-out cannot fall into a subscription gap.
      const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => changeIdentity(session?.user || null));
      unsubscribe = () => listener.subscription.unsubscribe();
      const beforeLookup = generation.current;
      const { data: auth } = await supabase.auth.getUser();
      if (alive.current && !disposed && beforeLookup === generation.current) changeIdentity(auth.user);
    }).catch(() => { if (alive.current && !disposed) setError("Connection settings could not be checked. Local saving is available."); });

    return () => {
      disposed = true;
      alive.current = false;
      generation.current++;
      activeLoad.current?.abort();
      activeSave.current?.controller.abort();
      activeLoad.current = null;
      activeSave.current = null;
      loadCloudRef.current = null;
      unsubscribe?.();
    };
  }, [persist, read]);

  const setData = useCallback((updater: (value: AppData) => AppData) => {
    const next = updater(latest.current);
    latest.current = next;
    dirty.current = !!currentUser.current;
    update(next);
    persist(next, dirty.current);
    if (pendingRecovery.current) {
      pendingRecovery.current = { ...pendingRecovery.current, local: next };
      setRecovery(pendingRecovery.current);
    } else if (cloudReady.current) setSync("Changes saved on this device…");
  }, [persist]);

  useEffect(() => {
    if (!ready) return;
    const timer = setTimeout(() => void pump(), 700);
    return () => clearTimeout(timer);
  }, [data, ready, pump]);

  const retry = useCallback(async () => {
    if (!currentUser.current) return;
    if (!cloudReady.current || pendingRecovery.current) await loadCloudRef.current?.();
    else await pump();
  }, [pump]);

  const recoverLocal = useCallback(async () => {
    const conflict = pendingRecovery.current;
    if (!conflict || !currentUser.current) return;
    // Keep a cloud backup before the explicitly requested replacement.
    try { localStorage.setItem(`${key.current}:cloud-backup`, JSON.stringify(conflict.cloud)); } catch {
      setError("The cloud copy could not be backed up on this device. Export a backup or free browser storage before choosing a replacement.");
      return;
    }
    revision.current = conflict.cloudRevision;
    lastSent.current = JSON.stringify(conflict.cloud);
    dirty.current = true;
    pendingRecovery.current = null;
    setRecovery(null);
    cloudReady.current = true;
    setError("");
    persist(latest.current, true);
    await pump();
  }, [persist, pump]);

  const discardLocal = useCallback(() => {
    const conflict = pendingRecovery.current;
    if (!conflict || !currentUser.current) return;
    try { localStorage.setItem(`${key.current}:device-backup`, JSON.stringify(latest.current)); } catch {
      setError("The device copy could not be backed up. Export your workspace before choosing the cloud copy.");
      return;
    }
    revision.current = conflict.cloudRevision;
    latest.current = conflict.cloud;
    lastSent.current = JSON.stringify(conflict.cloud);
    dirty.current = false;
    pendingRecovery.current = null;
    setRecovery(null);
    update(conflict.cloud);
    cloudReady.current = true;
    setError("");
    persist(conflict.cloud, false);
    setSync("All changes saved");
  }, [persist]);

  const switchMode = useCallback((isDemo: boolean, value?: AppData) => {
    if (currentUser.current) return;
    setError("");
    try {
      localStorage.setItem("life-os:mode", isDemo ? "demo" : "local");
      key.current = isDemo ? "life-os:demo:v1" : "life-os:local:v1";
      const cached = read(key.current);
      const next = value || cached.data;
      setDemo(isDemo);
      revision.current = null;
      dirty.current = false;
      latest.current = next;
      update(next);
      persist(next, false);
      setSync(isDemo ? "Demo workspace · saved on this device" : "Local workspace · saved on this device");
    } catch { setError("Unable to open the saved workspace. Your current activities have been kept."); }
  }, [persist, read]);

  return { data, setData, ready, demo, user, config, sync, error, retry, switchMode, recovery, recoverLocal, discardLocal };
}
