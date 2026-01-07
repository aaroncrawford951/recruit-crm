import type { NextApiRequest, NextApiResponse } from "next";
import { createClient } from "@supabase/supabase-js";
import Twilio from "twilio";
import { renderTemplate } from "@/lib/renderTemplate";

// ---------- Helpers ----------
function normalizePhone(raw: string | null): string | null {
  if (!raw) return null;
  let cleaned = raw.replace(/[^\d+]/g, "");
  if (cleaned.startsWith("+")) return cleaned;
  if (cleaned.length === 10) return `+1${cleaned}`;
  if (cleaned.length === 11 && cleaned.startsWith("1")) return `+${cleaned}`;
  if (cleaned.length > 0 && cleaned[0] !== "+") return `+${cleaned}`;
  return cleaned;
}

function getBool(v: any) {
  return v === "1" || v === "true" || v === "yes";
}

// ---------- Clients ----------
const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY! // must be service role
);

const twilio = Twilio(process.env.TWILIO_ACCOUNT_SID!, process.env.TWILIO_AUTH_TOKEN!);

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    const secret = String(req.query.secret ?? "");
    if (!secret || secret !== process.env.CRON_SECRET) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const debug = getBool(req.query.debug);
    const nowIso = new Date().toISOString();

    // 1) get due followups + template + recruit + owner
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
      return res.status(200).json({
        now: nowIso,
        debug,
        checked: 0,
        sent: 0,
        failed: 0,
        previews: [],
      });
    }

    // 2) fetch sender profiles in one query
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

        if (!templateBody) throw new Error("Missing message body (template_id is null or template deleted)");
        if (!recruit) throw new Error("Missing recruit record (recruit deleted?)");

        const to = normalizePhone(recruit.phone);
        if (!to) throw new Error("Invalid phone number");

        const senderProfile = profileMap.get(fu.owner_user_id);
        const senderFirst = senderProfile?.first_name ?? "";
        const senderLast = senderProfile?.last_name ?? "";
        const senderFull = `${senderFirst} ${senderLast}`.trim();

        const renderedBody = renderTemplate(templateBody, {
          first_name: recruit.first_name ?? "",
          last_name: recruit.last_name ?? "",
          full_name: `${recruit.first_name ?? ""} ${recruit.last_name ?? ""}`.trim(),

          sender_first_name: senderFirst,
          sender_last_name: senderLast,
          sender_full_name: senderFull,

          // backward compatible token
          sender_name: senderFull || process.env.SENDER_NAME || "",
        }).trim();

        if (!renderedBody) throw new Error("Rendered message is empty");

        // Always record preview so we can prove what would send
        previews.push({
          follow_up_id: followUpId,
          scheduled_for: fu.scheduled_for,
          template_body: templateBody,
          rendered_body: renderedBody,
          to,
          recruit,
          sender: { sender_first_name: senderFirst, sender_last_name: senderLast },
        });

        if (debug) continue; // debug = no send, no DB updates

        // ✅ THE ACTUAL FIX: send renderedBody (NOT templateBody)
        const from = process.env.TWILIO_FROM_NUMBER!;
        const msg = await twilio.messages.create({
          to,
          from,
          body: renderedBody,
        });

        // Log outbound message with rendered text
        const { error: mErr } = await supabaseAdmin.from("messages").insert([
          {
            owner_user_id: fu.owner_user_id,
            recruit_id: fu.recruit_id,
            direction: "outbound",
            body: renderedBody, // ✅ store rendered
            twilio_message_sid: msg.sid,
            from_phone: from,
            to_phone: to,
            status: "sent",
          },
        ]);
        if (mErr) throw new Error(`Failed to log message: ${mErr.message}`);

        // Mark follow-up sent
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

        if (!debug) {
          await supabaseAdmin
            .from("follow_ups")
            .update({
              status: "cancelled",
              error_message: e?.message ?? "Unknown error",
              last_attempt_at: new Date().toISOString(),
              attempt_count: (fu.attempt_count ?? 0) + 1,
            })
            .eq("id", followUpId);
        }
      }
    }

    return res.status(200).json({
      now: nowIso,
      debug,
      checked: followUps.length,
      sent,
      failed,
      previews: debug ? previews : [], // only return previews in debug mode
      note: debug ? "debug=1 → no sends, no DB updates" : "live run",
    });
  } catch (e: any) {
    return res.status(500).json({ error: e?.message ?? "Server error" });
  }
}
