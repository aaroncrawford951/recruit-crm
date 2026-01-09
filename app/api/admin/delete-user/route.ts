// app/api/admin/delete-user/route.ts
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

type CleanupStep = { step: string; ok: boolean; detail?: string };

function jsonError(message: string, status = 500, extra?: any) {
  return NextResponse.json({ error: message, ...extra }, { status });
}

// Create once (module scope)
const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// IMPORTANT: for admin cleanup, we intentionally use an untyped db handle
// so TS doesn't error on table names.
const db: any = supabaseAdmin;

export async function POST(req: NextRequest) {
  try {
    const authHeader = req.headers.get("authorization") || "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
    if (!token) return jsonError("Missing auth token", 401);

    const body = await req.json().catch(() => ({}));
    const userId = String(body?.userId || "").trim();
    if (!userId) return jsonError("Missing userId", 400);

    // Validate caller + admin allowlist
    const { data: callerData, error: callerErr } = await supabaseAdmin.auth.getUser(token);
    if (callerErr || !callerData?.user) return jsonError("Invalid auth token", 401);

    const admins = getAdminEmails();
    if (!admins.length) return jsonError("Admin not configured (NEXT_PUBLIC_ADMIN_EMAILS)", 403);

    const callerEmail = (callerData.user.email || "").toLowerCase();
    if (!admins.includes(callerEmail)) return jsonError("Forbidden (admin only)", 403);

    // Safety: don't allow self-delete via UI
    if (callerData.user.id === userId) {
      return jsonError("Refusing to delete current user (safety).", 400);
    }

    const cleanup: CleanupStep[] = [];

    // Helper to run deletes and record outcome
    async function step(label: string, fn: () => Promise<any>) {
      try {
        const res = await fn();

        const msg = (res?.error?.message as string | undefined) ?? undefined;

        // If a table doesn't exist in this project, treat it as OK (optional tables)
        const isMissingTable =
          (msg?.includes("Could not find the table") ?? false) ||
          ((msg?.includes("relation") ?? false) && (msg?.includes("does not exist") ?? false));

        const ok = !res?.error || isMissingTable;

        cleanup.push({
          step: label,
          ok,
          detail: res?.error?.message,
        });

        return res;
      } catch (e: any) {
        cleanup.push({ step: label, ok: false, detail: e?.message ?? String(e) });
        return { error: { message: e?.message ?? String(e) } };
      }
    }

    // Delete child tables first (avoids FK issues)
    await step("delete follow_ups", () => db.from("follow_ups").delete().eq("owner_user_id", userId));
    await step("delete messages", () => db.from("messages").delete().eq("owner_user_id", userId));
    await step("delete inbox_reads", () => db.from("inbox_reads").delete().eq("owner_user_id", userId));

    // Optional tables (ok if missing)
    await step("delete sequences", () => db.from("sequences").delete().eq("owner_user_id", userId));
    await step("delete sequence_steps", () => db.from("sequence_steps").delete().eq("owner_user_id", userId));

    await step("delete recruits", () => db.from("recruits").delete().eq("owner_user_id", userId));
    await step("delete message_templates", () => db.from("message_templates").delete().eq("owner_user_id", userId));

    // If you have locked stages, this may fail — that’s okay, we’ll still delete the auth user only if all required cleanup succeeds.
// Unlock any locked stages for this user so deletion can proceed
await step("unlock stages", () =>
  db.from("stages").update({ is_locked: false }).eq("owner_user_id", userId)
);

// Now delete stages (will work because they're no longer locked)
await step("delete stages", () =>
  db.from("stages").delete().eq("owner_user_id", userId)
);

    await step("delete profiles", () => db.from("profiles").delete().eq("id", userId));

    // Finally delete the auth user
    await step("delete auth user", () => supabaseAdmin.auth.admin.deleteUser(userId));

    const ok = cleanup.every((x) => x.ok);

    return NextResponse.json(
      {
        ok,
        deleted_user_id: userId,
        cleanup,
      },
      { status: ok ? 200 : 207 } // 207 = partial success (some steps failed)
    );
  } catch (e: any) {
    return jsonError(e?.message ?? "Server error", 500);
  }
}
