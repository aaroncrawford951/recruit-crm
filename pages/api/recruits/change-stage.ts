import type { NextApiRequest, NextApiResponse } from "next";
import { createClient } from "@supabase/supabase-js";

function isTerminalStage(name: string) {
  const n = (name || "").trim().toLowerCase();
  return n === "hired" || n === "not interested";
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    if (req.method !== "POST") return res.status(405).json({ error: "Use POST" });

    const { recruitId, newStageId } = req.body ?? {};
    if (!recruitId || !newStageId) {
      return res.status(400).json({ error: "Missing recruitId or newStageId" });
    }

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    // Load recruit (need owner + old stage)
    const { data: recruit, error: recruitErr } = await supabase
      .from("recruits")
      .select("id, owner_user_id, stage_id")
      .eq("id", recruitId)
      .single();

    if (recruitErr || !recruit) {
      return res.status(404).json({ error: recruitErr?.message ?? "Recruit not found" });
    }

    const oldStageId = recruit.stage_id;

    // Update recruit stage
    const { error: updErr } = await supabase
      .from("recruits")
      .update({ stage_id: newStageId })
      .eq("id", recruitId);

    if (updErr) return res.status(500).json({ error: updErr.message });

    // Cancel scheduled follow-ups from old stage (or all scheduled if old is null)
    if (oldStageId) {
      await supabase
        .from("follow_ups")
        .update({ status: "cancelled" })
        .eq("recruit_id", recruitId)
        .eq("owner_user_id", recruit.owner_user_id)
        .eq("status", "scheduled")
        .eq("stage_id", oldStageId);
    } else {
      await supabase
        .from("follow_ups")
        .update({ status: "cancelled" })
        .eq("recruit_id", recruitId)
        .eq("owner_user_id", recruit.owner_user_id)
        .eq("status", "scheduled");
    }

    // Load new stage (name for terminal check)
    const { data: stage, error: stageErr } = await supabase
      .from("stages")
      .select("id, name")
      .eq("id", newStageId)
      .single();

    if (stageErr || !stage) {
      return res.status(404).json({ error: stageErr?.message ?? "Stage not found" });
    }

    // Stop for terminal stages
    if (isTerminalStage(stage.name)) {
      return res.status(200).json({ ok: true, cancelledOld: true, created: 0, terminal: true });
    }

    // Load sequences for this stage + owner
    const { data: sequences, error: seqErr } = await supabase
      .from("stage_sequences")
      .select("id, template_id, schedule_type, offset_minutes, send_date, send_time_local, timezone")
      .eq("stage_id", newStageId)
      .eq("owner_user_id", recruit.owner_user_id)
      .order("created_at", { ascending: true });

    if (seqErr) return res.status(500).json({ error: seqErr.message });

    const inserts =
      (sequences ?? [])
        .map((s: any) => {
          // Relative scheduling
          if (s.schedule_type === "relative") {
            const mins = Number(s.offset_minutes ?? 0);
            const when = new Date(Date.now() + mins * 60_000).toISOString();
            return {
              owner_user_id: recruit.owner_user_id,
              recruit_id: recruitId,
              stage_id: newStageId,
              template_id: s.template_id,
              scheduled_for: when,
              status: "scheduled",
              source_sequence_id: s.id,
            };
          }

          // Absolute scheduling (requires date + time + timezone)
          if (!s.send_date || !s.send_time_local || !s.timezone) return null;

          // Store as local timestamp string; DB will store as timestamptz
          const when = `${s.send_date} ${s.send_time_local}:00`;

          return {
            owner_user_id: recruit.owner_user_id,
            recruit_id: recruitId,
            stage_id: newStageId,
            template_id: s.template_id,
            scheduled_for: when,
            status: "scheduled",
            source_sequence_id: s.id,
          };
        })
        .filter(Boolean) as any[];

    if (inserts.length === 0) {
      return res.status(200).json({ ok: true, cancelledOld: true, created: 0, reason: "no sequences" });
    }

    // Upsert so re-entering a stage re-schedules instead of duplicate error
    const { error: upErr } = await supabase
      .from("follow_ups")
      .upsert(inserts, { onConflict: "recruit_id,source_sequence_id" });

    if (upErr) return res.status(500).json({ error: upErr.message });

    return res.status(200).json({ ok: true, cancelledOld: true, created: inserts.length });
  } catch (e: any) {
    return res.status(500).json({ error: e?.message ?? "Server error" });
  }
}
