import { NextRequest, NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/config";

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code");
  const type = request.nextUrl.searchParams.get("type");
  const returnUrl = new URL("/", request.nextUrl.origin);
  if (!isSupabaseConfigured() || !code) {
    returnUrl.searchParams.set("auth_error", "The sign-in link is missing or expired. Request a new one.");
  } else {
    try {
      const supabase = await createServerSupabase();
      const { error } = await supabase.auth.exchangeCodeForSession(code);
      if (error) returnUrl.searchParams.set("auth_error", "The sign-in link has expired. Request a new one.");
      else if (type === "recovery" || request.nextUrl.searchParams.get("next") === "reset") returnUrl.searchParams.set("reset_password", "1");
    } catch {
      returnUrl.searchParams.set("auth_error", "Sign-in is temporarily unavailable. Please try again.");
    }
  }
  return NextResponse.redirect(returnUrl, { headers: { "Cache-Control": "private, no-store" } });
}
