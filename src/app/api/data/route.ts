import {localizeMessage,requestLanguage} from "@/i18n/core";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { appDataSchema } from "@/lib/validation";
import { emptyData } from "@/lib/types";
import { createServerSupabase } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { sameRequestOrigin } from "@/lib/supabase/request-origin";

export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store" };
const fail = (error:string,status:number,request:Request)=>NextResponse.json({error:localizeMessage(requestLanguage(request),error,true),errorKey:error},{status,headers});

async function authenticated() {
  if (!isSupabaseConfigured()) return null;
  const client = await createServerSupabase();
  const { data: { user }, error } = await client.auth.getUser();
  return !error && user ? { client, user } : null;
}

export async function GET(request:Request) {
  try {
    if (!isSupabaseConfigured()) return fail("Add Supabase settings to enable cloud sync. Your local data is still available.", 503, request);
    const session = await authenticated();
    if (!session) return fail("Sign in to load your cloud data.", 401, request);
    const { data, error } = await session.client.rpc("load_life_os");
    if (error) return fail("Cloud data could not be loaded. Check your connection and database setup.", 503, request);
    const envelope = z.object({ data: z.unknown(), revision: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER) })
      .refine(value => 'data' in value).safeParse(data);
    if (!envelope.success) return fail("Your cloud data needs a compatible app version. Your local copy has been kept.", 422, request);
    const snapshot = envelope.data;
    const initial=emptyData();initial.preferences.language=requestLanguage(request);
    const parsed = appDataSchema.safeParse(snapshot.data ?? initial);
    if (!parsed.success) return fail("Your cloud data needs a compatible app version. Your local copy has been kept.", 422, request);
    return NextResponse.json({ data: parsed.data, revision: snapshot.revision, userId: session.user.id }, { headers });
  } catch {
    return fail("Cloud sync is temporarily unavailable. Your local data has been kept.", 503, request);
  }
}

export async function PUT(request: NextRequest) {
  try {
    if (!sameRequestOrigin(request)) return fail("This request could not be verified. Refresh Life OS and try again.", 403, request);
    if (!isSupabaseConfigured()) return fail("Cloud sync is not configured. Your changes remain saved locally.", 503, request);
    const session = await authenticated();
    if (!session) return fail("Sign in again to sync your changes. Your local data has been kept.", 401, request);
    const text = await request.text();
    if (text.length > 2_000_000) return fail("This backup is too large to sync in one request.", 413, request);
    let body: unknown;
    try { body = JSON.parse(text); } catch { return fail("This sync request is incomplete. Please try again.", 400, request); }
    const parsed = z.object({ data: appDataSchema, revision: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER), userId: z.string().uuid() }).safeParse(body);
    if (!parsed.success) return fail("Some data could not be validated. Your local copy has been kept.", 422, request);
    if (parsed.data.userId !== session.user.id) return fail("The signed-in account changed. Your local data has been kept; sign in to the intended account before syncing.", 409, request);
    const collections = [parsed.data.data.events, parsed.data.data.tasks, parsed.data.data.mealTemplates, parsed.data.data.workoutPlans, parsed.data.data.exerciseLogs, ...parsed.data.data.workoutPlans.map(plan => plan.exercises)];
    const uuid = z.string().uuid();
    if (collections.some(collection => new Set(collection.map(row => row.id)).size !== collection.length || collection.some(row => !uuid.safeParse(row.id).success))) {
      return fail("This workspace contains sample or duplicate record identifiers. Keep demo data separate and use new activities in your personal workspace before syncing.", 422, request);
    }
    const { data, error } = await session.client.rpc("save_life_os", { p_data: parsed.data.data, p_expected_revision: parsed.data.revision });
    if (error?.code === "40001") return fail("Your cloud data changed on another device. Load the latest cloud copy before syncing again.", 409, request);
    if (error || typeof data !== "number" || !Number.isSafeInteger(data) || data <= parsed.data.revision) return fail("Changes could not be synced. Check your connection and database setup; your local copy is safe.", 503, request);
    return NextResponse.json({ revision: data, userId: session.user.id }, { headers });
  } catch {
    return fail("Cloud sync is temporarily unavailable. Your local changes have been kept.", 503, request);
  }
}
