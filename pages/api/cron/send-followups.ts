// pages/api/cron/send-follow-ups.ts
import type { NextApiRequest, NextApiResponse } from "next";
import { createClient } from "@supabase/supabase-js";
import { sendSms } from "@/lib/sms/sendSms";
import { renderSmsFromTemplate } from "@/lib/sms/renderSmsFromTemplate";

function getBool(v: any) {
  return v === "1" || v === "true" || v === "yes";
}

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

function getBearerToken(req: NextApiRequest) {
  const auth = req.headers.authorization || "";
  if (auth.startsWith("Bearer ")) return auth.slice(7).trim();
  return null;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
// ✅ Allow GET (Vercel Cron uses GET) + POST (manual/testing)
if (req.method !== "GET" && req.method !== "POST") {
  return res.status(405).json({ error: "Method not allowed. Use GET or POST." });
}



    // ✅ CRON secret check
    const configuredSecret = process.env.CRON_SECRET;
    if (!configuredSecret) {
      return res.status(500).json({ error: "CRON_SECRET is not set on the server" });
    }

    // Prefer Authorization header; allow ?secret= as fallback
    const headerToken = getBearerToken(req);
    const querySecret = typeof req.query.secret === "string" ? req.query.secret : "";
    const provided = headerToken || querySecret;

    if (!provided || provided !== configuredSecret) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const debug = getBool(req.query.debug);
    const nowIso = new Date().toISOString();

    const { data: due, error: dueErr } = await supabaseAdmin
      .from("follow_ups")
      .select(
        `
          id,
          owner_user_id,
          recruit_id,
          template_id,
          scheduled_for,
          attempt_count,
          status,
          message_templates:template_id ( body ),
          recruits:recruit_id ( first_name, last_name, phone )
        `
      )
      .eq("status", "scheduled")
      .lte("scheduled_for", nowIso)
      .order("scheduled_for", { ascending: true })
      .limit(50);

    if (dueErr) return res.status(500).json({ error: dueErr.message, now: nowIso, debug });

    const followUps = (due as any[]) ?? [];
    if (followUps.length === 0) {
      return res.status(200).json({ now: nowIso, debug, checked: 0, sent: 0, failed: 0, previews: [] });
    }

    // Load sender profiles in one query
    const ownerIds = Array.from(new Set(followUps.map((x) => x.owner_user_id).filter(Boolean)));
    const { data: profiles, error: pErr } = await supabaseAdmin
      .from("profiles")
      .select("id, first_name, last_name")
      .in("id", ownerIds);

    if (pErr) return res.status(500).json({ error: pErr.message, now: nowIso, debug });

    const profileMap = new Map<string, { first_name: string | null; last_name: string | null }>();
    for (const p of (profiles as any[]) ?? []) {
      profileMap.set(p.id, { first_name: p.first_name ?? null, last_name: p.last_name ?? null });
    }

    let sent = 0;
    let failed = 0;
    const previews: any[] = [];

    for (const fu of followUps) {
      const followUpId = fu.id as string;

      try {
        const templateBody = fu.message_templates?.body as string | null;
        const recruit = fu.recruits as
          | { first_name: string | null; last_name: string | null; phone: string | null }
          | null;

        if (!templateBody) throw new Error("Missing message body (template deleted?)");
        if (!recruit) throw new Error("Missing recruit record (recruit deleted?)");
        if (!recruit.phone) throw new Error("Invalid phone number");

        const senderProfile = profileMap.get(fu.owner_user_id) ?? { first_name: null, last_name: null };

        const renderedBody = renderSmsFromTemplate({
          templateBody,
          recruit,
          sender: senderProfile,

        });

        previews.push({
          follow_up_id: followUpId,
          scheduled_for: fu.scheduled_for,
          template_body: templateBody,
          body: renderedBody,
          to: recruit.phone,
          recruit,
          sender: senderProfile,
        });

        if (debug) continue;

        const msg = await sendSms({
          to: recruit.phone,
          body: renderedBody,
          meta: {
            route: "pages/api/cron/send-follow-ups",
            follow_up_id: followUpId,
            recruit_id: fu.recruit_id,
            owner_user_id: fu.owner_user_id,
          },
        });

        const { error: mErr } = await supabaseAdmin.from("messages").insert([
          {
            owner_user_id: fu.owner_user_id,
            recruit_id: fu.recruit_id,
            direction: "outbound",
            body: renderedBody,
            twilio_message_sid: msg.sid,
            from_phone: process.env.TWILIO_FROM_NUMBER || process.env.TWILIO_PHONE_NUMBER || null,
            to_phone: recruit.phone,
            status: "sent",
          },
        ]);
        if (mErr) throw new Error(`Failed to log message: ${mErr.message}`);

        const { error: uErr } = await supabaseAdmin
          .from("follow_ups")
          .update({
            status: "sent",
            sent_at: new Date().toISOString(),
            error_message: null,
            last_attempt_at: new Date().toISOString(),
            attempt_count: (fu.attempt_count ?? 0) + 1,
          })
          .eq("id", followUpId);

        if (uErr) throw new Error(`Failed to update follow_up: ${uErr.message}`);

        sent++;
      } catch (e: any) {
        failed++;
        const errMsg = e?.message ?? "Unknown error";
        const errCode = e?.code ? ` (${e.code})` : "";

        if (!debug) {
          await supabaseAdmin
            .from("follow_ups")
            .update({
              status: "cancelled",
              error_message: `${errMsg}${errCode}`,
              last_attempt_at: new Date().toISOString(),
              attempt_count: (fu.attempt_count ?? 0) + 1,
            })
            .eq("id", fu.id);
        }
      }
    }

    return res.status(200).json({
      now: nowIso,
      debug,
      checked: followUps.length,
      sent,
      failed,
      previews: debug ? previews : [],
      note: debug ? "debug=1 → no sends, no DB updates" : "live run",
    });
  } catch (e: any) {
    return res.status(500).json({ error: e?.message ?? "Server error" });
  }
}
