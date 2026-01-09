// app/api/admin/delete-user/route.ts
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

function jsonError(message: string, extra: Record<string, any> = {}, status = 500) {
  return NextResponse.json({ error: message, ...extra }, { status });
}

function getAdminEmails() {
  const raw = process.env.NEXT_PUBLIC_ADMIN_EMAILS || "";
  return raw
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

type CleanupStep = { step: string; ok: boolean; detail?: string };

async function safeDelete(step: string, fn: () => any): Promise<CleanupStep> {
  try {
    // Supabase query builders are awaitable, but TS sometimes doesn’t type them as Promise.
    // So we accept "any" here, await it, and just look for `.error`.
    const resp: any = await fn();

    if (resp?.error) {
      const msg =
        typeof resp.error?.message === "string"
          ? resp.error.message
          : typeof resp.error === "string"
            ? resp.error
            : JSON.stringify(resp.error);

      return { step, ok: false, detail: msg };
    }

    return { step, ok: true };
  } catch (e: any) {
    return { step, ok: false, detail: e?.message || "Unknown error" };
  }
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

    const body = (await req.json().catch(() => null)) as { userId?: string } | null;
    const userId = body?.userId;
    if (!userId) return jsonError("Missing userId", {}, 400);

    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!url || !anon || !serviceKey) {
      return jsonError("Missing Supabase env vars.", {}, 500);
    }

    const adminSb = createClient(url, serviceKey);

    // Verify caller is admin
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

    const cleanup: CleanupStep[] = [];

    // Pull ids
    const { data: stages } = await adminSb.from("stages").select("id").eq("owner_user_id", userId);
    const stageIds = (stages ?? []).map((s: any) => s.id);

    const { data: templates } = await adminSb
      .from("message_templates")
      .select("id")
      .eq("owner_user_id", userId);
    const templateIds = (templates ?? []).map((t: any) => t.id);

    const { data: recruits } = await adminSb.from("recruits").select("id").eq("owner_user_id", userId);
    const recruitIds = (recruits ?? []).map((r: any) => r.id);

    // A) recruit-related rows
    if (recruitIds.length) {
      cleanup.push(
        await safeDelete("delete follow_ups", () =>
          adminSb.from("follow_ups").delete().in("recruit_id", recruitIds)
        )
      );

      cleanup.push(
        await safeDelete("delete messages", () =>
          adminSb.from("messages").delete().in("recruit_id", recruitIds)
        )
      );

      cleanup.push(
        await safeDelete("delete inbox_reads", () =>
          adminSb.from("inbox_reads").delete().in("recruit_id", recruitIds)
        )
      );

      cleanup.push(
        await safeDelete("delete recruits", () =>
          adminSb.from("recruits").delete().in("id", recruitIds)
        )
      );
    }

    // B) stage_sequences mapping
    if (stageIds.length) {
      cleanup.push(
        await safeDelete("delete stage_sequences", () =>
          adminSb.from("stage_sequences").delete().in("stage_id", stageIds)
        )
      );
    }

    // C) templates
    if (templateIds.length) {
      cleanup.push(
        await safeDelete("delete message_templates", () =>
          adminSb.from("message_templates").delete().in("id", templateIds)
        )
      );
    }

    // D) unlock stages before deleting
    if (stageIds.length) {
      const { error: unlockErr } = await adminSb
        .from("stages")
        .update({ is_locked: false })
        .eq("owner_user_id", userId);

      if (unlockErr) cleanup.push({ step: "unlock stages", ok: false, detail: unlockErr.message });
      else cleanup.push({ step: "unlock stages", ok: true });

      cleanup.push(
        await safeDelete("delete stages", () => adminSb.from("stages").delete().in("id", stageIds))
      );
    }

    // E) delete auth user
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
