import type { NextApiRequest, NextApiResponse } from "next";
import { createClient } from "@supabase/supabase-js";

export const config = {
  api: { bodyParser: true },
};

function digitsOnly(raw: string) {
  return raw.replace(/[^\d]/g, "");
}

function normalizeE164(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const d = digitsOnly(String(raw));
  if (!d) return null;

  // If already includes country code
  if (d.length === 11 && d.startsWith("1")) return `+${d}`;
  // Assume North America 10-digit
  if (d.length === 10) return `+1${d}`;

  // Fallback: try making it +<digits>
  return `+${d}`;
}

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  // Always return empty TwiML (no auto-reply)
  const okXml = `<?xml version="1.0" encoding="UTF-8"?><Response></Response>`;

  try {
    if (req.method !== "POST") {
      return res.status(200).setHeader("Content-Type", "text/xml").send(okXml);
    }

    const fromRaw = (req.body?.From ?? req.body?.from) as string | undefined;
    const toRaw = (req.body?.To ?? req.body?.to) as string | undefined;
    const bodyRaw = (req.body?.Body ?? req.body?.body) as string | undefined;
    const sid = (req.body?.MessageSid ?? req.body?.SmsMessageSid ?? req.body?.sid) as string | undefined;

    const fromE164 = normalizeE164(fromRaw);
    const toE164 = normalizeE164(toRaw);
    const body = (bodyRaw ?? "").trim();

    if (!fromE164 || !toE164 || !body) {
      return res.status(200).setHeader("Content-Type", "text/xml").send(okXml);
    }

    const fromDigits = digitsOnly(fromE164); // e.g. 15871234567
    const last10 = fromDigits.slice(-10);    // e.g. 5871234567

    // 1) Try exact match first (best if you store +1XXXXXXXXXX)
    let recruit: any = null;

    const exact = await supabaseAdmin
      .from("recruits")
      .select("id, owner_user_id, phone")
      .eq("phone", fromE164)
      .maybeSingle();

    if (!exact.error && exact.data) {
      recruit = exact.data;
    }

    // 2) If not found, try common variants: 10-digit, 11-digit, +1, etc
    if (!recruit) {
      const v10 = last10;                 // 5871234567
      const v11 = `1${last10}`;           // 15871234567
      const vE164 = `+1${last10}`;        // +15871234567

      const variants = await supabaseAdmin
        .from("recruits")
        .select("id, owner_user_id, phone")
        .or(`phone.eq.${vE164},phone.eq.${v11},phone.eq.${v10}`)
        .limit(1);

      if (!variants.error && variants.data && variants.data.length > 0) {
        recruit = variants.data[0];
      }
    }

    // 3) If still not found, fuzzy match: phone contains last 10 digits (handles formatting like (587) 123-4567)
    if (!recruit) {
      const fuzzy = await supabaseAdmin
        .from("recruits")
        .select("id, owner_user_id, phone")
        .ilike("phone", `%${last10}%`)
        .limit(1);

      if (!fuzzy.error && fuzzy.data && fuzzy.data.length > 0) {
        recruit = fuzzy.data[0];
      }
    }

    // If we still can’t match, just return OK (Twilio won’t retry). We can add an "unmatched" table later.
    if (!recruit) {
      return res.status(200).setHeader("Content-Type", "text/xml").send(okXml);
    }

    // Insert inbound message
    await supabaseAdmin.from("messages").insert([
      {
        owner_user_id: recruit.owner_user_id,
        recruit_id: recruit.id,
        direction: "inbound",
        body,
        twilio_message_sid: sid ?? null,
        from_phone: fromE164,
        to_phone: toE164,
        status: "received",
      },
    ]);

    return res.status(200).setHeader("Content-Type", "text/xml").send(okXml);
  } catch {
    // Always respond OK to Twilio
    return res.status(200).setHeader("Content-Type", "text/xml").send(okXml);
  }
}
