// pages/api/messages/send.ts
import type { NextApiRequest, NextApiResponse } from "next";
import { createClient } from "@supabase/supabase-js";
import { sendSms } from "@/lib/sms/sendSms";
import { renderSmsFromTemplate } from "@/lib/sms/renderSmsFromTemplate";

function safeString(v: unknown) {
  return typeof v === "string" ? v : "";
}

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    if (req.method !== "POST") return res.status(405).json({ error: "Use POST" });

    const authHeader = req.headers.authorization || "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
    if (!token) return res.status(401).json({ error: "Missing auth token" });

    const { data: userData, error: userErr } = await supabaseAdmin.auth.getUser(token);
    if (userErr || !userData?.user) return res.status(401).json({ error: "Invalid auth token" });

    const userId = userData.user.id;

    const { recruitId, body } = req.body ?? {};
    const templateBody = safeString(body).trim();

    if (!recruitId || !templateBody) {
      return res.status(400).json({ error: "Missing recruitId or body" });
    }

    // Recruit (ownership)
    const { data: recruit, error: rErr } = await supabaseAdmin
      .from("recruits")
      .select("id, owner_user_id, first_name, last_name, phone")
      .eq("id", recruitId)
      .single();

    if (rErr || !recruit) return res.status(404).json({ error: rErr?.message ?? "Recruit not found" });
    if (recruit.owner_user_id !== userId) return res.status(403).json({ error: "Forbidden" });

    if (!recruit.phone) return res.status(400).json({ error: "Recruit phone is missing/invalid" });

    // Sender profile (auto-bootstrap if missing)
    const { data: existingProfile, error: pErr } = await supabaseAdmin
      .from("profiles")
      .select("first_name, last_name")
      .eq("id", userId)
      .maybeSingle();

    if (pErr) return res.status(500).json({ error: pErr.message });

    let senderFirst = existingProfile?.first_name ?? "";
    let senderLast = existingProfile?.last_name ?? "";

    if (!senderFirst && !senderLast) {
      const meta = (userData.user.user_metadata ?? {}) as any;
      const metaFirst = safeString(meta.first_name).trim();
      const metaLast = safeString(meta.last_name).trim();

      const email = safeString(userData.user.email);
      const emailName = email.includes("@") ? email.split("@")[0] : "";

      senderFirst = metaFirst || senderFirst || "";
      senderLast = metaLast || senderLast || "";

      if (!senderFirst && !senderLast && emailName) senderFirst = emailName;

      const { error: upErr } = await supabaseAdmin.from("profiles").upsert(
        [{ id: userId, first_name: senderFirst || null, last_name: senderLast || null }],
        { onConflict: "id" }
      );
      if (upErr) return res.status(500).json({ error: upErr.message });
    }

    // ✅ single render mapping
    const rendered = renderSmsFromTemplate({
      templateBody,
      recruit,
      sender: { first_name: senderFirst, last_name: senderLast },
    });

    // ✅ single send path
    const msg = await sendSms({
      to: recruit.phone,
      body: rendered,
      meta: { route: "pages/api/messages/send", recruit_id: recruitId, owner_user_id: userId },
    });

    // Log message
    const { error: mErr } = await supabaseAdmin.from("messages").insert([
      {
        owner_user_id: userId,
        recruit_id: recruitId,
        direction: "outbound",
        body: rendered,
        twilio_message_sid: msg.sid,
        from_phone: process.env.TWILIO_FROM_NUMBER || process.env.TWILIO_PHONE_NUMBER || null,
        to_phone: recruit.phone,
        status: "sent",
      },
    ]);
    if (mErr) return res.status(500).json({ error: mErr.message });

    return res.status(200).json({ ok: true, sid: msg.sid });
  } catch (e: any) {
    return res.status(500).json({ error: e?.message ?? "Server error", code: e?.code });
  }
}
