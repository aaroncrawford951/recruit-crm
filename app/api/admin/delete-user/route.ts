import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

function jsonError(message: string, extra?: any, status = 500) {
  return NextResponse.json({ error: message, ...extra }, { status });
}

function getAdminEmails() {
  const raw = process.env.NEXT_PUBLIC_ADMIN_EMAILS || "";
  return raw
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

export async function POST(req: Request) {
  try {
    const adminEmails = getAdminEmails();
    if (adminEmails.length === 0) {
      return jsonError(
        "Admin is not configured. Add NEXT_PUBLIC_ADMIN_EMAILS in .env.local (comma-separated).",
        {},
        400
      );
    }

    const authHeader = req.headers.get("authorization") || "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
    if (!token) return jsonError("Missing Authorization token", {}, 401);

    const { userId } = await req.json();
    if (!userId) return jsonError("Missing userId", {}, 400);

    const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
    if (!url || !anon || !serviceKey) {
      return jsonError("Missing Supabase env vars.", {}, 500);
    }

    const adminSb = createClient(url, serviceKey);

    // verify caller is an admin
    const callerSb = createClient(url, anon, {
      global: { headers: { Authorization: `Bearer ${token}` } },
    });

    const { data: caller, error: callerErr } = await callerSb.auth.getUser();
    if (callerErr || !caller?.user?.email) {
      return jsonError("Not authenticated", { detail: callerErr?.message }, 401);
    }

    const callerEmail = caller.user.email.toLowerCase();
    if (!adminEmails.includes(callerEmail)) {
      return jsonError("Forbidden (not an admin)", { callerEmail }, 403);
    }

    // helpers
    const cleanup: Array<{ step: string; ok: boolean; detail?: string }> = [];
    const okStep = (step: string) => cleanup.push({ step, ok: true });
    const badStep = (step: string, detail: string) => cleanup.push({ step, ok: false, detail });

    async function safeDelete(step: string, fn: () => Promise<{ error: any }>) {
      try {
        const { error } = await fn();
        if (error) badStep(step, error.message || String(error));
        else okStep(step);
      } catch (e: any) {
        badStep(step, e?.message || "Unknown error");
      }
    }

    // pull ids
    const { data: stages } = await adminSb
      .from("stages")
      .select("id, is_locked")
      .eq("owner_user_id", userId);

    const stageIds = (stages ?? []).map((s: any) => s.id);

    const { data: templates } = await adminSb
      .from("message_templates")
      .select("id")
      .eq("owner_user_id", userId);

    const templateIds = (templates ?? []).map((t: any) => t.id);

    const { data: recruits } = await adminSb
      .from("recruits")
      .select("id")
      .eq("owner_user_id", userId);

    const recruitIds = (recruits ?? []).map((r: any) => r.id);

    // A) recruit-related rows
    if (recruitIds.length) {
      await safeDelete("delete follow_ups", () =>
        adminSb.from("follow_ups").delete().in("recruit_id", recruitIds)
      );

      await safeDelete("delete messages", () =>
        adminSb.from("messages").delete().in("recruit_id", recruitIds)
      );

      await safeDelete("delete inbox_reads", () =>
        adminSb.from("inbox_reads").delete().in("recruit_id", recruitIds)
      );

      await safeDelete("delete recruits", () =>
        adminSb.from("recruits").delete().in("id", recruitIds)
      );
    }

    // B) stage_sequences mapping
    if (stageIds.length) {
      await safeDelete("delete stage_sequences", () =>
        adminSb.from("stage_sequences").delete().in("stage_id", stageIds)
      );
    }

    // C) templates
    if (templateIds.length) {
      await safeDelete("delete message_templates", () =>
        adminSb.from("message_templates").delete().in("id", templateIds)
      );
    }

    // D) IMPORTANT: unlock stages before deleting (admin-only cleanup)
    if (stageIds.length) {
      const { error: unlockErr } = await adminSb
        .from("stages")
        .update({ is_locked: false })
        .eq("owner_user_id", userId);

      if (unlockErr) {
        cleanup.push({ step: "unlock stages", ok: false, detail: unlockErr.message });
      } else {
        cleanup.push({ step: "unlock stages", ok: true });
      }

      await safeDelete("delete stages", () =>
        adminSb.from("stages").delete().in("id", stageIds)
      );
    }

    // E) delete auth user (admin api)
    const { error: delAuthErr } = await adminSb.auth.admin.deleteUser(userId);
    if (delAuthErr) {
      return jsonError(
        "Failed deleting auth user (admin SDK)",
        { userId, cleanup, detail: delAuthErr.message },
        500
      );
    }

    return NextResponse.json({ ok: true, userId, cleanup });
  } catch (e: any) {
    return jsonError("Server error", { detail: e?.message || String(e) }, 500);
  }
}
