import { NextResponse } from "next/server";
import { isSupabaseConfigured } from "@/lib/supabase/config";

export function GET() {
  return NextResponse.json({ supabaseConfigured: isSupabaseConfigured(), aiConfigured: Boolean(process.env.GEMINI_API_KEY) }, { headers: { "Cache-Control": "no-store" } });
}
