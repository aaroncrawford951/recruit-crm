import type { NextApiRequest, NextApiResponse } from "next";
import { createClient } from "@supabase/supabase-js";
import Twilio from "twilio";
import { renderTemplate } from "@/lib/renderTemplate";

function normalizePhone(raw: string | null): string | null {
  if (!raw) return null;
  let cleaned = raw.replace(/[^\d+]/g, "");
  if (cleaned.startsWith("+")) return cleaned;
  if (cleaned.length === 10) return `+1${cleaned}`;
  if (cleaned.length === 11 && cleaned.startsWith("1")) return `+${cleaned}`;
  if (cleaned.length > 0 && cleaned[0] !== "+") return `+${cleaned}`;
  return cleaned;
}

function safeString(v: any) {
  return typeof v === "string" ? v : "";
}

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const twilio = Twilio(process.env.TWILIO_ACCOUNT_SID!, process.env.TWILIO_AUTH_TOKEN!);

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    if (req.method !== "POST") return res.status(405).json({ error: "Use POST" });

    // Auth token from client
    const authHeader = req.headers.authorization || "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
    if (!token) return res.status(401).json({ error: "Missing auth token" });

    const { data: userData, error: userErr } = await supabaseAdmin.auth.getUser(token);
    if (userErr || !userData?.user) return res.status(401).json({ error: "Invalid auth token" });

    const userId = userData.user.id;

    const { recruitId, body } = req.body ?? {};
    const rawBody = safeString(body).trim();

    if (!recruitId || !rawBody) {
      return res.status(400).json({ error: "Missing recruitId or body" });
    }

    // Load recruit (and ensure ownership matches)
    const { data: recruit, error: rErr } = await supabaseAdmin
      .from("recruits")
      .select("id, owner_user_id, first_name, last_name, phone")
      .eq("id", recruitId)
      .single();

    if (rErr || !recruit) return res.status(404).json({ error: rErr?.message ?? "Recruit not found" });
    if (recruit.owner_user_id !== userId) return res.status(403).json({ error: "Forbidden" });

    const to = normalizePhone(recruit.phone);
    if (!to) return res.status(400).json({ error: "Recruit phone is missing/invalid" });

    // ----------------------------
    // Load sender profile (AUTO-CREATE if missing)
    // ----------------------------
    const { data: existingProfile, error: pErr } = await supabaseAdmin
      .from("profiles")
      .select("first_name, last_name")
      .eq("id", userId)
      .maybeSingle();

    if (pErr) return res.status(500).json({ error: pErr.message });

    let senderFirst = existingProfile?.first_name ?? "";
    let senderLast = existingProfile?.last_name ?? "";

    // If profile is missing or blank, try to bootstrap from auth metadata
    if (!senderFirst && !senderLast) {
      const meta = (userData.user.user_metadata ?? {}) as any;
      const metaFirst = safeString(meta.first_name).trim();
      const metaLast = safeString(meta.last_name).trim();

      // Fallback: derive something from email if needed (optional)
      const email = safeString(userData.user.email);
      const emailName = email.includes("@") ? email.split("@")[0] : "";

      senderFirst = metaFirst || senderFirst || "";
      senderLast = metaLast || senderLast || "";

      // If still empty, use email prefix as first name
      if (!senderFirst && !senderLast && emailName) {
        senderFirst = emailName;
      }

      // Upsert so next time it exists
      const { error: upErr } = await supabaseAdmin.from("profiles").upsert(
        [
          {
            id: userId,
            first_name: senderFirst || null,
            last_name: senderLast || null,
          },
        ],
        { onConflict: "id" }
      );

      if (upErr) return res.status(500).json({ error: upErr.message });
    }

    const senderFull = `${senderFirst} ${senderLast}`.trim();

    // Render variables (support both new + old tokens)
    const rendered = renderTemplate(rawBody, {
      // recruit
      first_name: recruit.first_name ?? "",
      last_name: recruit.last_name ?? "",
      full_name: `${recruit.first_name ?? ""} ${recruit.last_name ?? ""}`.trim(),

      // sender (new)
      sender_first_name: senderFirst,
      sender_last_name: senderLast,
      sender_full_name: senderFull,

      // backward compat
      sender_name: senderFull || senderFirst || process.env.SENDER_NAME || "Directions Group",
    }).trim();

    const from = process.env.TWILIO_FROM_NUMBER!;
    const msg = await twilio.messages.create({
      to,
      from,
      body: rendered,
    });

    // Log message (store rendered body)
    const { error: mErr } = await supabaseAdmin.from("messages").insert([
      {
        owner_user_id: userId,
        recruit_id: recruitId,
        direction: "outbound",
        body: rendered,
        twilio_message_sid: msg.sid,
        from_phone: from,
        to_phone: to,
        status: "sent",
      },
    ]);

    if (mErr) return res.status(500).json({ error: mErr.message });

    return res.status(200).json({ ok: true, sid: msg.sid });
  } catch (e: any) {
    return res.status(500).json({ error: e?.message ?? "Server error" });
  }
}
