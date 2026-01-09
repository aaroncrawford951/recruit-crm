// lib/sms/sendSms.ts
import Twilio from "twilio";
import crypto from "crypto";

type SendSmsArgs = {
  to: string;
  body: string;
  from?: string;
  messagingServiceSid?: string;
  meta?: Record<string, unknown>;
};

function deploymentFingerprint() {
  return {
    vercelEnv: process.env.VERCEL_ENV ?? "unknown",
    commitSha:
      process.env.VERCEL_GIT_COMMIT_SHA ||
      process.env.VERCEL_GITHUB_COMMIT_SHA ||
      process.env.VERCEL_GITLAB_COMMIT_SHA ||
      process.env.VERCEL_BITBUCKET_COMMIT_SHA ||
      "unknown",
    region: process.env.VERCEL_REGION ?? "unknown",
  };
}

function normalizePhone(raw: string): string {
  const cleaned = (raw || "").replace(/[^\d+]/g, "");
  if (!cleaned) return "";
  if (cleaned.startsWith("+")) return cleaned;
  if (cleaned.length === 10) return `+1${cleaned}`;
  if (cleaned.length === 11 && cleaned.startsWith("1")) return `+${cleaned}`;
  if (cleaned[0] !== "+") return `+${cleaned}`;
  return cleaned;
}

function bodyHash(body: string) {
  return crypto.createHash("sha256").update(body, "utf8").digest("hex").slice(0, 12);
}

function assertNoTemplateTokens(body: string) {
  // Block any unresolved mustache-style tokens
  // e.g. {{first_name}} or {{ sender_first_name }}
  const hasMustacheToken = /{{\s*[\w.-]+\s*}}/.test(body);
  if (hasMustacheToken || body.includes("{{") || body.includes("}}")) {
    const err: any = new Error(
      "Blocked SMS send: body contains unresolved template tokens (e.g. {{first_name}})."
    );
    err.code = "UNRENDERED_TEMPLATE_BLOCKED";
    throw err;
  }
}

export async function sendSms(args: SendSmsArgs) {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;

  if (!accountSid || !authToken) {
    throw new Error("Missing TWILIO_ACCOUNT_SID or TWILIO_AUTH_TOKEN");
  }

  const toRaw = (args.to || "").trim();
  const body = (args.body || "").trim();

  if (!toRaw) throw new Error("sendSms: missing 'to'");
  if (!body) throw new Error("sendSms: missing 'body'");

  const to = normalizePhone(toRaw);
  if (!to) throw new Error("sendSms: invalid 'to' phone number");

  assertNoTemplateTokens(body);

  const client = Twilio(accountSid, authToken);

  const resolvedMessagingServiceSid =
    args.messagingServiceSid || process.env.TWILIO_MESSAGING_SERVICE_SID;

  const resolvedFrom =
    args.from || process.env.TWILIO_FROM_NUMBER || process.env.TWILIO_PHONE_NUMBER;

  if (!resolvedMessagingServiceSid && !resolvedFrom) {
    throw new Error(
      "Missing TWILIO_MESSAGING_SERVICE_SID or TWILIO_FROM_NUMBER/TWILIO_PHONE_NUMBER"
    );
  }

  // Keep payload as a plain object; Twilio validates at runtime.
  // Avoids TS type issues across Twilio versions.
  const payload: any = {
    to,
    body,
    ...(resolvedMessagingServiceSid
      ? { messagingServiceSid: resolvedMessagingServiceSid }
      : { from: resolvedFrom }),
  };

  const fp = deploymentFingerprint();
  const meta = args.meta || {};
  const hash = bodyHash(body);

  console.log("[sendSms] sending", {
    to,
    bodyHash: hash,
    bodyPreview: body.slice(0, 120),
    bodyLength: body.length,
    using: resolvedMessagingServiceSid ? "messagingServiceSid" : "from",
    ...fp,
    meta,
  });

  const res = await client.messages.create(payload);

  console.log("[sendSms] sent", {
    sid: res.sid,
    status: res.status,
    to: res.to,
    bodyHash: hash,
    ...fp,
    meta,
  });

  return res;
}
