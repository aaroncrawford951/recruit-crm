import type { NextApiRequest, NextApiResponse } from "next";
import { createClient } from "@supabase/supabase-js";
import Twilio from "twilio";

// ---------- Helpers ----------
function normalizePhone(raw: string | null): string | null {
  if (!raw) return null;

  let cleaned = raw.replace(/[^\d+]/g, "");
  if (cleaned.startsWith("+")) return cleaned;

  if (cleaned.length === 10) return `+1${cleaned}`;
  if (cleaned.length === 11 && cleaned.startsWith("1")) return `+${cleaned}`;

  return `+${cleaned}`;
}

function getCronSecret(req: NextApiRequest) {
  const fromQuery = req.query.secret;
  const fromHeader = req.headers["x-cron-secret"];
  const q = Array.isArray(fromQuery) ? fromQuery[0] : fromQuery;
  const h = Array.isArray(fromHeader) ? fromHeader[0] : fromHeader;
  return (q || h || "").toString();
}

// ---------- Clients ----------
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const twilio = Twilio(process.env.TWILIO_ACCOUNT_SID!, process.env.TWILIO_AUTH_TOKEN!);

// ---------- Handler ----------
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    // ---- Security check ----
    const provided = getCronSecret(req);
    const expected = process.env.CRON_SECRET || "";

    if (!expected) {
      return res.status(500).json({ error: "CRON_SECRET is not set in .env.local" });
    }

    if (!provided || provided !== expected) {
      return res.status(401).json({ error: "Unauthorized (bad or missing secret)" });
    }

    // ---- Fetch due follow-ups ----
    const now = new Date().toISOString();

    const { data: followUps, error } = await supabase
      .from("follow_ups")
     .select(`
  id,
  owner_user_id,
  recruit_id,
  scheduled_for,
  status,
  message_templates:template_id ( body ),
  recruits:recruit_id ( phone )
`)
      .eq("status", "scheduled")
      .lte("scheduled_for", now)
      .order("scheduled_for", { ascending: true })
      .limit(50);

    if (error) return res.status(500).json({ error: error.message });

    let sent = 0;
    let failed = 0;

    for (const fu of followUps ?? []) {
      try {
        const body = (fu as any).message_templates?.body as string | undefined;
        const rawPhone = (fu as any).recruits?.phone as string | null;

        if (!body) throw new Error("Missing template body");
        const to = normalizePhone(rawPhone);
        if (!to) throw new Error("Invalid phone number");

        // ---- Send SMS ----
       const from = process.env.TWILIO_FROM_NUMBER!;

const msg = await twilio.messages.create({
  to,
  from,
  body,
});

// Log outbound message
await supabase.from("messages").insert([
  {
    owner_user_id: (fu as any).owner_user_id,
    recruit_id: (fu as any).recruit_id,
    direction: "outbound",
    body,
    twilio_message_sid: msg.sid,
    from_phone: from,
    to_phone: to,
    status: "sent",
  },
]);


        // ---- Mark sent ----
        const upd = await supabase
          .from("follow_ups")
          .update({
            status: "sent",
            sent_at: new Date().toISOString(),
            error_message: null,
          })
          .eq("id", (fu as any).id);

        if (upd.error) throw new Error(`DB update failed: ${upd.error.message}`);

        sent++;
      } catch (e: any) {
        failed++;

        // IMPORTANT: do NOT cancel on failure. Keep scheduled so you can retry.
        await supabase
          .from("follow_ups")
          .update({
            error_message: e?.message ?? "Unknown error",
          })
          .eq("id", (fu as any).id);
      }
    }

    return res.status(200).json({
      checked: followUps?.length ?? 0,
      sent,
      failed,
      now,
    });
  } catch (e: any) {
    return res.status(500).json({ error: e?.message ?? "Server error" });
  }
}
