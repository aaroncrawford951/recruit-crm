// lib/sms/renderSmsFromTemplate.ts
import { renderTemplate } from "@/lib/renderTemplate";

type RecruitLike = {
  first_name?: string | null;
  last_name?: string | null;
};

type SenderLike = {
  first_name?: string | null;
  last_name?: string | null;
};

type RenderArgs = {
  templateBody: string;
  recruit: RecruitLike;
  sender: SenderLike;
  prefix?: string;
};

export function renderSmsFromTemplate({ templateBody, recruit, sender, prefix }: RenderArgs) {
  const senderFirst = sender.first_name ?? "";
  const senderLast = sender.last_name ?? "";
  const senderFull = `${senderFirst} ${senderLast}`.trim();

  const rendered = renderTemplate(templateBody ?? "", {
    // recruit
    first_name: recruit.first_name ?? "",
    last_name: recruit.last_name ?? "",
    full_name: `${recruit.first_name ?? ""} ${recruit.last_name ?? ""}`.trim(),

    // sender
    sender_first_name: senderFirst,
    sender_last_name: senderLast,
    sender_full_name: senderFull,

    // backward compat
    sender_name: senderFull || senderFirst || process.env.SENDER_NAME || "Directions Group",
  }).trim();

  const p = (prefix ?? "").trim();
  const finalBody = `${p}${p ? " " : ""}${rendered}`.trim();

  return finalBody;
}
