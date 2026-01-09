import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

function csvEscape(value: unknown): string {
  const s = value === null || value === undefined ? "" : String(value);
  // Escape quotes and wrap if needed
  const needsWrap = /[",\n\r]/.test(s);
  const escaped = s.replace(/"/g, '""');
  return needsWrap ? `"${escaped}"` : escaped;
}

function toCsv(rows: Record<string, any>[], headers: string[]) {
  const lines: string[] = [];
  lines.push(headers.map(csvEscape).join(","));
  for (const r of rows) {
    lines.push(headers.map((h) => csvEscape(r[h])).join(","));
  }
  return lines.join("\n");
}

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function GET(req: NextRequest) {
  try {
    // Require logged-in user via bearer token
    const authHeader = req.headers.get("authorization") || "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
    if (!token) return NextResponse.json({ error: "Missing auth token" }, { status: 401 });

    const { data: userData, error: userErr } = await supabaseAdmin.auth.getUser(token);
    if (userErr || !userData?.user) return NextResponse.json({ error: "Invalid auth token" }, { status: 401 });

    const userId = userData.user.id;

    // Pull recruits + stage names
    const { data, error } = await supabaseAdmin
      .from("recruits")
      .select(
        `
        id,
        first_name,
        last_name,
        phone,
        status,
        created_at,
        stage_id,
        stages:stage_id ( name )
      `
      )
      .eq("owner_user_id", userId)
      .order("created_at", { ascending: false })
      .limit(5000);

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    const rows = (data ?? []).map((r: any) => ({
      id: r.id,
      first_name: r.first_name ?? "",
      last_name: r.last_name ?? "",
      phone: r.phone ?? "",
      status: r.status ?? "",
      stage: r.stages?.name ?? "",
      created_at: r.created_at ?? "",
    }));

    const headers = ["id", "first_name", "last_name", "phone", "status", "stage", "created_at"];
    const csv = toCsv(rows, headers);

    return new NextResponse(csv, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="recruits-${new Date().toISOString().slice(0, 10)}.csv"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Server error" }, { status: 500 });
  }
}
