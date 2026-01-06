import type { NextApiRequest, NextApiResponse } from "next";
import { createClient } from "@supabase/supabase-js";
import Twilio from "twilio";

function normalizePhone(raw: string | null): string | null {
  if (!raw) return null;
  let cleaned = raw.replace(/[^\d+]/g, "");
  if (cleaned.startsWith("+")) return cleaned;
  if (cleaned.length === 10) return `+1${cleaned}`;
  if (cleaned.length === 11 && cleaned.startsWith("1")) return `+${cleaned}`;
  if (cleaned.length > 0 && cleaned[0] !== "+") return `+${cleaned}`;
  return cleaned;
}

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const twilio = Twilio(process.env.TWILIO_ACCOUNT_SID!, process.env.TWILIO_AUTH_TOKEN!);

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    if (req.method !== "POST") return res.status(405).json({ error: "Use POST" });

    // Auth: require a real logged-in user session (client sends access token)
    const authHeader = req.headers.authorization || "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
    if (!token) return res.status(401).json({ error: "Missing auth token" });

    const { data: userData, error: userErr } = await supabaseAdmin.auth.getUser(token);
    if (userErr || !userData?.user) return res.status(401).json({ error: "Invalid auth token" });

    const userId = userData.user.id;

    const { recruitId, body } = req.body ?? {};
    if (!recruitId || !body || !String(body).trim()) {
      return res.status(400).json({ error: "Missing recruitId or body" });
    }

    // Load recruit (and ensure ownership matches)
    const { data: recruit, error: rErr } = await supabaseAdmin
      .from("recruits")
      .select("id, owner_user_id, phone")
      .eq("id", recruitId)
      .single();

    if (rErr || !recruit) return res.status(404).json({ error: rErr?.message ?? "Recruit not found" });

    if (recruit.owner_user_id !== userId) {
      return res.status(403).json({ error: "Forbidden" });
    }

    const to = normalizePhone(recruit.phone);
    if (!to) return res.status(400).json({ error: "Recruit phone is missing/invalid" });

    const from = process.env.TWILIO_FROM_NUMBER!;
    const text = String(body).trim();

    const msg = await twilio.messages.create({
      to,
      from,
      body: text,
    });

    // Log message
    const { error: mErr } = await supabaseAdmin.from("messages").insert([
      {
        owner_user_id: userId,
        recruit_id: recruitId,
        direction: "outbound",
        body: text,
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
