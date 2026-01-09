import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } }
);

function jsonError(message: string, status = 500, extra: any = {}) {
  return NextResponse.json({ error: message, ...extra }, { status });
}

function getAdminEmailSet() {
  const raw = (process.env.NEXT_PUBLIC_ADMIN_EMAILS || "").trim();
  if (!raw) return new Set<string>();
  return new Set(
    raw
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean)
  );
}

export async function GET(req: Request) {
  const adminEmails = getAdminEmailSet();
  if (adminEmails.size === 0) {
    return jsonError(
      "Admin is not configured. Add NEXT_PUBLIC_ADMIN_EMAILS in .env.local (comma-separated).",
      400
    );
  }

  // Require logged in + must be admin
  const authHeader = req.headers.get("authorization") || "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
  if (!token) return jsonError("Missing Authorization token.", 401);

  const { data: caller, error: callerErr } = await supabase.auth.getUser(token);
  if (callerErr || !caller?.user) return jsonError("Not authenticated.", 401);

  const callerEmail = String(caller.user.email || "").toLowerCase();
  if (!adminEmails.has(callerEmail)) return jsonError("Not authorized.", 403);

  // List users (Supabase Auth Admin)
  const { data, error } = await supabase.auth.admin.listUsers({ page: 1, perPage: 200 });

  if (error) return jsonError("Failed listing users", 500, { detail: error.message });

  const users = (data?.users || []).map((u) => ({
    id: u.id,
    email: u.email,
    created_at: u.created_at,
    last_sign_in_at: (u as any).last_sign_in_at ?? null,
  }));

  return NextResponse.json({ users }, { status: 200 });
}
