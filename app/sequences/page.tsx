"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

type Stage = { id: string; name: string; sort_order: number | null };
type Template = { id: string; title: string; sort_order: number | null };

type SequenceRow = {
  id: string;
  schedule_type: "relative" | "absolute";
  offset_minutes: number;
  send_date: string | null;
  send_time_local: string | null;
  timezone: string;
  created_at: string;
  message_templates?: { title: string | null } | null;
};

type Unit = "minutes" | "hours" | "days";

function minutesFromParts(amount: number, unit: Unit) {
  if (unit === "minutes") return amount;
  if (unit === "hours") return amount * 60;
  return amount * 1440;
}

export default function SequencesPage() {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const [stages, setStages] = useState<Stage[]>([]);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [selectedStageId, setSelectedStageId] = useState("");

  const [sequences, setSequences] = useState<SequenceRow[]>([]);

  // Form
  const [scheduleType, setScheduleType] = useState<"relative" | "absolute">("relative");
  const [templateId, setTemplateId] = useState("");

  // Relative (ONLY offset)
  const [amount, setAmount] = useState<number>(1);
  const [unit, setUnit] = useState<Unit>("days");

  // Absolute (required)
  const [sendDate, setSendDate] = useState("");
  const [sendTime, setSendTime] = useState("");

  // Timezone (required)
  const [timezone, setTimezone] = useState("America/Edmonton");
  const timezones = ["America/Edmonton", "America/Vancouver", "America/Winnipeg", "America/Toronto"];

  async function loadInitial() {
    setBusy(true);
    setErr(null);

    try {
      const s = await supabase
        .from("stages")
        .select("id, name, sort_order")
        .order("sort_order", { ascending: true })
        .order("created_at", { ascending: true });

      if (s.error) throw new Error(s.error.message);

      setStages((s.data ?? []) as Stage[]);
      if (!selectedStageId && s.data?.[0]?.id) setSelectedStageId(s.data[0].id);

      const t = await supabase
        .from("message_templates")
        .select("id, title, sort_order")
        .order("sort_order", { ascending: true })
        .order("created_at", { ascending: true });

      if (t.error) throw new Error(t.error.message);
      setTemplates((t.data ?? []) as Template[]);
    } catch (e: any) {
      setErr(e?.message ?? "Failed to load.");
    } finally {
      setBusy(false);
    }
  }

  async function loadSequences(stageId: string) {
    if (!stageId) {
      setSequences([]);
      return;
    }

    setErr(null);

    const r = await supabase
      .from("stage_sequences")
      .select(
        `
        id,
        schedule_type,
        offset_minutes,
        send_date,
        send_time_local,
        timezone,
        created_at,
        message_templates:template_id ( title )
      `
      )
      .eq("stage_id", stageId)
      .order("created_at", { ascending: true });

    if (r.error) {
      setErr(r.error.message);
      setSequences([]);
      return;
    }

    // ✅ TS fix: cast joined select result
setSequences(((r.data ?? []) as unknown) as SequenceRow[]);
  }

  useEffect(() => {
    loadInitial();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (selectedStageId) loadSequences(selectedStageId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedStageId]);

  useEffect(() => {
    setErr(null);
    if (scheduleType === "relative") {
      // remove absolute-only fields so they never interfere
      setSendDate("");
      setSendTime("");
    }
  }, [scheduleType]);

  async function addSequence() {
    setErr(null);

    if (!selectedStageId) return setErr("Select a stage.");
    if (!templateId) return setErr("Select a template.");
    if (!timezone) return setErr("Timezone is required.");

    if (scheduleType === "relative") {
      if (!Number.isFinite(amount) || amount < 0) return setErr("Delay must be 0 or greater.");
    } else {
      if (!sendDate) return setErr("Date is required for Specific date.");
      if (!sendTime) return setErr("Time is required for Specific date.");
    }

    setBusy(true);

    try {
      const { data: authData, error: authErr } = await supabase.auth.getUser();
      if (authErr) throw new Error(authErr.message);

      const userId = authData.user?.id;
      if (!userId) throw new Error("Not logged in.");

      const payload =
        scheduleType === "relative"
          ? {
              owner_user_id: userId,
              stage_id: selectedStageId,
              template_id: templateId,
              schedule_type: "relative" as const,
              offset_minutes: minutesFromParts(amount, unit),
              send_date: null,
              send_time_local: null, // ✅ ALWAYS NULL for relative
              timezone,
            }
          : {
              owner_user_id: userId,
              stage_id: selectedStageId,
              template_id: templateId,
              schedule_type: "absolute" as const,
              offset_minutes: 0,
              send_date: sendDate,
              send_time_local: sendTime, // ✅ REQUIRED for specific date
              timezone,
            };

      const ins = await supabase.from("stage_sequences").insert([payload]);
      if (ins.error) throw new Error(ins.error.message);

      // Reset
      setTemplateId("");
      setAmount(1);
      setUnit("days");
      setSendDate("");
      setSendTime("");

      await loadSequences(selectedStageId);
    } catch (e: any) {
      setErr(e?.message ?? "Failed to add sequence.");
    } finally {
      setBusy(false);
    }
  }

  async function deleteSequence(id: string) {
    setErr(null);
    setBusy(true);
    try {
      const del = await supabase.from("stage_sequences").delete().eq("id", id);
      if (del.error) throw new Error(del.error.message);
      await loadSequences(selectedStageId);
    } catch (e: any) {
      setErr(e?.message ?? "Failed to delete.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ padding: 24, maxWidth: 980 }}>
      <h1 style={{ fontSize: 24, fontWeight: 800 }}>Sequences</h1>
      <p style={{ opacity: 0.75, marginTop: 6 }}>
        Relative rules send after a delay from stage entry (no date/time). Specific date rules send at an exact date/time.
      </p>

      {err && <div style={{ marginTop: 12, color: "crimson" }}>{err}</div>}

      <div style={{ marginTop: 16, display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
        <div style={{ fontWeight: 800 }}>Stage</div>
        <select
          value={selectedStageId}
          onChange={(e) => setSelectedStageId(e.target.value)}
          style={{ padding: 8, borderRadius: 10, border: "1px solid #e5e5e5" }}
        >
          {stages.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
        {busy && <span style={{ opacity: 0.7 }}>Working…</span>}
      </div>

      {/* Add rule */}
      <div style={{ marginTop: 16, border: "1px solid #e5e5e5", borderRadius: 12, padding: 12 }}>
        <div style={{ fontWeight: 900, marginBottom: 10 }}>Add follow-up</div>

        {/* Type toggle */}
        <div style={{ display: "flex", gap: 14, flexWrap: "wrap", alignItems: "center" }}>
          <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <input type="radio" checked={scheduleType === "relative"} onChange={() => setScheduleType("relative")} />
            Relative (delay from stage entry)
          </label>

          <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <input type="radio" checked={scheduleType === "absolute"} onChange={() => setScheduleType("absolute")} />
            Specific date
          </label>
        </div>

        <div style={{ marginTop: 12, display: "grid", gap: 12 }}>
          {/* Template */}
          <div style={{ display: "grid", gap: 6 }}>
            <div style={{ fontWeight: 800 }}>Template</div>
            <select
              value={templateId}
              onChange={(e) => setTemplateId(e.target.value)}
              style={{ padding: 10, borderRadius: 10, border: "1px solid #e5e5e5" }}
            >
              <option value="">Select template…</option>
              {templates.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.title}
                </option>
              ))}
            </select>
          </div>

          {/* Timezone */}
          <div style={{ display: "grid", gap: 6 }}>
            <div style={{ fontWeight: 800 }}>Timezone (required)</div>
            <select
              value={timezone}
              onChange={(e) => setTimezone(e.target.value)}
              style={{ padding: 10, borderRadius: 10, border: "1px solid #e5e5e5", maxWidth: 320 }}
            >
              {timezones.map((tz) => (
                <option key={tz} value={tz}>
                  {tz}
                </option>
              ))}
            </select>
          </div>

          {/* Relative (NO date/time inputs here at all) */}
          {scheduleType === "relative" && (
            <div style={{ display: "grid", gap: 10 }}>
              <div style={{ fontWeight: 800 }}>Delay from stage entry</div>
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "end" }}>
                <div style={{ display: "grid", gap: 6 }}>
                  <div style={{ fontWeight: 700 }}>Amount</div>
                  <input
                    type="number"
                    value={amount}
                    onChange={(e) => setAmount(Number(e.target.value))}
                    style={{ padding: 10, borderRadius: 10, border: "1px solid #e5e5e5", width: 140 }}
                    min={0}
                  />
                </div>

                <div style={{ display: "grid", gap: 6 }}>
                  <div style={{ fontWeight: 700 }}>Unit</div>
                  <select
                    value={unit}
                    onChange={(e) => setUnit(e.target.value as Unit)}
                    style={{ padding: 10, borderRadius: 10, border: "1px solid #e5e5e5" }}
                  >
                    <option value="minutes">minutes</option>
                    <option value="hours">hours</option>
                    <option value="days">days</option>
                  </select>
                </div>
              </div>
            </div>
          )}

          {/* Absolute (date + time required) */}
          {scheduleType === "absolute" && (
            <div style={{ display: "grid", gap: 10 }}>
              <div style={{ fontWeight: 800 }}>Specific date & time</div>
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "end" }}>
                <div style={{ display: "grid", gap: 6 }}>
                  <div style={{ fontWeight: 700 }}>Date (required)</div>
                  <input
                    type="date"
                    value={sendDate}
                    onChange={(e) => setSendDate(e.target.value)}
                    style={{ padding: 10, borderRadius: 10, border: "1px solid #e5e5e5", width: 220 }}
                  />
                </div>

                <div style={{ display: "grid", gap: 6 }}>
                  <div style={{ fontWeight: 700 }}>Time (required)</div>
                  <input
                    type="time"
                    value={sendTime}
                    onChange={(e) => setSendTime(e.target.value)}
                    style={{ padding: 10, borderRadius: 10, border: "1px solid #e5e5e5", width: 160 }}
                  />
                </div>
              </div>
            </div>
          )}

          <button
            onClick={addSequence}
            disabled={busy}
            style={{
              padding: "10px 14px",
              borderRadius: 10,
              border: "1px solid #e5e5e5",
              background: "white",
              cursor: busy ? "not-allowed" : "pointer",
              fontWeight: 900,
              width: 120,
            }}
          >
            Add
          </button>
        </div>
      </div>

      {/* Existing */}
      <div style={{ marginTop: 16, border: "1px solid #e5e5e5", borderRadius: 12, padding: 12 }}>
        <div style={{ fontWeight: 900, marginBottom: 10 }}>Current rules</div>

        {sequences.length === 0 ? (
          <div style={{ opacity: 0.75 }}>No rules yet for this stage.</div>
        ) : (
          <div style={{ display: "grid", gap: 10 }}>
            {sequences.map((s) => {
              const title = s.message_templates?.title ?? "—";

              return (
                <div
                  key={s.id}
                  style={{
                    border: "1px solid #eee",
                    borderRadius: 12,
                    padding: 12,
                    display: "flex",
                    justifyContent: "space-between",
                    gap: 12,
                    alignItems: "center",
                    background: "white",
                  }}
                >
                  <div style={{ display: "grid", gap: 4 }}>
                    <div style={{ fontWeight: 900 }}>{title}</div>

                    <div style={{ opacity: 0.85 }}>
                      {s.schedule_type === "relative" ? (
                        <>
                          <b>Relative</b>: {s.offset_minutes} minutes after stage entry • <b>{s.timezone}</b>
                        </>
                      ) : (
                        <>
                          <b>Specific date</b>: <b>{s.send_date}</b> at <b>{s.send_time_local}</b> •{" "}
                          <b>{s.timezone}</b>
                        </>
                      )}
                    </div>
                  </div>

                  <button
                    onClick={() => deleteSequence(s.id)}
                    disabled={busy}
                    style={{
                      padding: "8px 10px",
                      borderRadius: 10,
                      border: "1px solid #e5e5e5",
                      background: "white",
                      cursor: busy ? "not-allowed" : "pointer",
                      fontWeight: 900,
                    }}
                  >
                    Delete
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
