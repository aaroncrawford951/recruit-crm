import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

function jsonError(message: string, status = 500, extra?: any) {
  return NextResponse.json({ error: message, ...extra }, { status });
}

export async function POST(req: NextRequest) {
  try {
    // 1) Require user auth (browser will pass a Bearer token)
    const authHeader = req.headers.get("authorization") || "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
    if (!token) return jsonError("Missing auth token", 401);

    const supabaseAdmin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    // Validate caller token (and get user id)
    const { data: caller, error: callerErr } = await supabaseAdmin.auth.getUser(token);
    if (callerErr || !caller?.user) return jsonError("Invalid auth token", 401);

    // 2) Call your existing cron logic by making an internal request
    //    (so we don’t duplicate code)
    const baseUrl =
      process.env.NEXT_PUBLIC_SITE_URL ||
      process.env.NEXT_PUBLIC_VERCEL_URL?.startsWith("http")
        ? process.env.NEXT_PUBLIC_VERCEL_URL
        : `https://${process.env.NEXT_PUBLIC_VERCEL_URL}`;

    if (!baseUrl) {
      return jsonError(
        "Missing NEXT_PUBLIC_SITE_URL or NEXT_PUBLIC_VERCEL_URL. Add NEXT_PUBLIC_SITE_URL to env.",
        500
      );
    }

    const cronSecret = process.env.CRON_SECRET;
    if (!cronSecret) return jsonError("Missing CRON_SECRET in env", 500);

    const resp = await fetch(`${baseUrl}/api/cron/send-followups`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${cronSecret}`,
        "Content-Type": "application/json",
      },
    });

    const json = await resp.json().catch(() => ({}));
    if (!resp.ok) {
      return jsonError(json?.error || "Cron run failed", resp.status, { detail: json });
    }

    return NextResponse.json({ ok: true, result: json }, { status: 200 });
  } catch (e: any) {
    return jsonError(e?.message ?? "Server error", 500);
  }
}
