// app/api/admin/list-users/route.ts
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

function getAdminEmails() {
  const raw = process.env.NEXT_PUBLIC_ADMIN_EMAILS || "";
  return raw
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function GET(req: NextRequest) {
  try {
    const authHeader = req.headers.get("authorization") || "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
    if (!token) return NextResponse.json({ error: "Missing auth token" }, { status: 401 });

    // Validate caller
    const { data: userData, error: userErr } = await supabaseAdmin.auth.getUser(token);
    if (userErr || !userData?.user) {
      return NextResponse.json({ error: "Invalid auth token" }, { status: 401 });
    }

    // Admin allowlist
    const email = (userData.user.email || "").toLowerCase();
    const admins = getAdminEmails();
    if (!admins.length) {
      return NextResponse.json(
        { error: "Admin not configured (NEXT_PUBLIC_ADMIN_EMAILS)" },
        { status: 403 }
      );
    }
    if (!admins.includes(email)) {
      return NextResponse.json({ error: "Forbidden (admin only)" }, { status: 403 });
    }

    // List users
    const page = 1;
    const perPage = 2000;

    const { data, error } = await supabaseAdmin.auth.admin.listUsers({ page, perPage });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    const users = (data?.users ?? []).map((u) => ({
      id: u.id,
      email: u.email ?? null,
      created_at: u.created_at ?? null,
      last_sign_in_at: (u as any).last_sign_in_at ?? null,
    }));

    return NextResponse.json(
      {
        users,
        meta: { page, perPage, returned: users.length },
      },
      { status: 200 }
    );
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Server error" }, { status: 500 });
  }
}
