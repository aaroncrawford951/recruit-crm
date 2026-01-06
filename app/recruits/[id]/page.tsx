"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";

type StageRow = {
  id: string;
  name: string;
  sort_order: number | null;
};

type RecruitRow = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  phone: string | null;
  created_at: string;
  stage_id: string | null;
  notes: string | null;
  notes_updated_at: string | null;
};

export default function RecruitDetailPage() {
  const router = useRouter();
  const params = useParams();
  const recruitId = (params?.id as string) || "";

  const [authReady, setAuthReady] = useState(false);

  const [loading, setLoading] = useState(true);
  const [savingStage, setSavingStage] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const [recruit, setRecruit] = useState<RecruitRow | null>(null);
  const [stages, setStages] = useState<StageRow[]>([]);
  const [stageId, setStageId] = useState<string>("");

  // Notes + autosave
  const [notes, setNotes] = useState<string>("");
  const [notesUpdatedAt, setNotesUpdatedAt] = useState<string | null>(null);
  const [notesLastSavedValue, setNotesLastSavedValue] = useState<string>("");

  const [notesStatus, setNotesStatus] = useState<"idle" | "dirty" | "saving" | "saved" | "error">("idle");
  const [notesStatusMsg, setNotesStatusMsg] = useState<string>("");

  const stageName = useMemo(() => {
    const s = stages.find((x) => x.id === stageId);
    return s?.name ?? "—";
  }, [stages, stageId]);

  // ---------- Auth guard ----------
  useEffect(() => {
    const run = async () => {
      const { data } = await supabase.auth.getSession();
      if (!data.session) {
        router.replace("/login");
        return;
      }
      setAuthReady(true);
    };
    run();
  }, [router]);

  // ---------- Load page data ----------
  useEffect(() => {
    if (!authReady) return;
    if (!recruitId) return;

    const load = async () => {
      setLoading(true);
      setError(null);
      setSuccess(null);

      // stages
      const stagesRes = await supabase
        .from("stages")
        .select("id, name, sort_order")
        .order("sort_order", { ascending: true })
        .order("created_at", { ascending: true });

      if (stagesRes.error) {
        setError(stagesRes.error.message);
        setLoading(false);
        return;
      }
      setStages((stagesRes.data ?? []) as StageRow[]);

      // recruit
      const recruitRes = await supabase
        .from("recruits")
        .select("id, first_name, last_name, phone, created_at, stage_id, notes, notes_updated_at")
        .eq("id", recruitId)
        .single();

      if (recruitRes.error) {
        setError(recruitRes.error.message);
        setLoading(false);
        return;
      }

      const r = recruitRes.data as RecruitRow;
      setRecruit(r);

      setStageId(r.stage_id ?? "");

      const initialNotes = r.notes ?? "";
      setNotes(initialNotes);
      setNotesLastSavedValue(initialNotes);
      setNotesUpdatedAt(r.notes_updated_at ?? null);
      setNotesStatus("idle");
      setNotesStatusMsg("");

      setLoading(false);
    };

    load();
  }, [authReady, recruitId]);

  // ---------- Save stage ----------
  async function saveStage(newStageId: string) {
    if (!recruit) return;
    if (!newStageId) return;

    setSavingStage(true);
    setError(null);
    setSuccess(null);

    const { error } = await supabase.from("recruits").update({ stage_id: newStageId }).eq("id", recruit.id);

    if (error) {
      setError(error.message);
      setSavingStage(false);
      return;
    }

    setSuccess("Stage updated.");
    setRecruit({ ...recruit, stage_id: newStageId });
    setSavingStage(false);
    setTimeout(() => setSuccess(null), 1200);
  }

  // ---------- Save notes (used by autosave) ----------
  async function saveNotes(options?: { silent?: boolean }) {
    if (!recruit) return;

    if (notes === notesLastSavedValue) return;

    setNotesStatus("saving");
    setNotesStatusMsg("Saving…");

    const nowIso = new Date().toISOString();

    const { error } = await supabase
      .from("recruits")
      .update({
        notes,
        notes_updated_at: nowIso,
      })
      .eq("id", recruit.id);

    if (error) {
      setNotesStatus("error");
      setNotesStatusMsg("Couldn’t save");
      return;
    }

    setNotesLastSavedValue(notes);
    setNotesUpdatedAt(nowIso);

    setNotesStatus("saved");
    setNotesStatusMsg("Saved");
    setTimeout(() => {
      setNotesStatus("idle");
      setNotesStatusMsg("");
    }, 900);

    if (!options?.silent) {
      setSuccess("Notes saved.");
      setTimeout(() => setSuccess(null), 1200);
    }
  }

  // ---------- Autosave debounce ----------
  useEffect(() => {
    if (!recruit) return;

    if (notes !== notesLastSavedValue) {
      if (notesStatus !== "saving") {
        setNotesStatus("dirty");
        setNotesStatusMsg("Unsaved");
      }
    } else {
      if (notesStatus === "dirty") {
        setNotesStatus("idle");
        setNotesStatusMsg("");
      }
    }

    const t = setTimeout(() => {
      if (notes !== notesLastSavedValue) {
        saveNotes({ silent: true });
      }
    }, 800);

    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [notes, recruit?.id]);

  // ---------- Delete recruit (HARD delete, DB cascades messages + follow_ups) ----------
  async function handleDeleteRecruit() {
    if (!recruit) return;
    if (deleting) return;

    const ok = confirm(
      "Delete this recruit?\n\nThis permanently deletes:\n• the recruit\n• all follow-ups\n• all messages\n\nThis cannot be undone."
    );
    if (!ok) return;

    setDeleting(true);
    setError(null);
    setSuccess(null);

    const { error } = await supabase.from("recruits").delete().eq("id", recruit.id);

    if (error) {
      setError(error.message);
      setDeleting(false);
      return;
    }

    router.push("/recruits");
  }

  if (!authReady) {
    return <main style={{ padding: 40, maxWidth: 720 }}>Checking login…</main>;
  }

  if (loading) {
    return <main style={{ padding: 40, maxWidth: 720 }}>Loading…</main>;
  }

  if (!recruit) {
    return (
      <main style={{ padding: 40, maxWidth: 720 }}>
        <button onClick={() => router.push("/recruits")}>← Back</button>
        <p style={{ marginTop: 16, color: "crimson" }}>Recruit not found.</p>
      </main>
    );
  }

  return (
    <main style={{ padding: 40, maxWidth: 720 }}>
      <button onClick={() => router.push("/recruits")}>← Back</button>

      <h1 style={{ marginTop: 12 }}>
        {recruit.first_name ?? ""} {recruit.last_name ?? ""}
      </h1>

      <div style={{ fontSize: 12, opacity: 0.8, marginBottom: 16 }}>
        Added:{" "}
        {new Date(recruit.created_at).toLocaleString("en-CA", {
          timeZone: "America/Edmonton",
        })}
      </div>

      {error && <p style={{ color: "crimson" }}>{error}</p>}
      {success && <p style={{ color: "green" }}>{success}</p>}

      {/* Stage */}
      <div style={{ marginTop: 14, border: "1px solid #e5e5e5", borderRadius: 12, padding: 12 }}>
        <div style={{ fontWeight: 800, marginBottom: 8 }}>Stage</div>

        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <select
            value={stageId}
            onChange={(e) => setStageId(e.target.value)}
            style={{ padding: 10, borderRadius: 10, border: "1px solid #e5e5e5", minWidth: 260 }}
          >
            <option value="">Select stage…</option>
            {stages.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>

          <button
            onClick={() => saveStage(stageId)}
            disabled={savingStage || !stageId}
            style={{
              padding: "10px 14px",
              borderRadius: 10,
              border: "1px solid #e5e5e5",
              background: "white",
              cursor: savingStage ? "not-allowed" : "pointer",
              fontWeight: 800,
            }}
          >
            {savingStage ? "Saving…" : "Save stage"}
          </button>

          <div style={{ opacity: 0.7 }}>
            Current: <b>{stageName}</b>
          </div>
        </div>
      </div>

      {/* Notes (Autosave) */}
      <div style={{ marginTop: 14, border: "1px solid #e5e5e5", borderRadius: 12, padding: 12 }}>
        <div style={{ fontWeight: 800, marginBottom: 8 }}>Notes</div>

        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          onBlur={() => saveNotes({ silent: true })}
          placeholder="Add notes about this recruit…"
          rows={8}
          style={{
            width: "100%",
            padding: 10,
            borderRadius: 10,
            border: "1px solid #e5e5e5",
            resize: "vertical",
          }}
        />

        <div style={{ marginTop: 10, display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
          <div style={{ opacity: 0.7 }}>{notesStatusMsg}</div>

          {notesUpdatedAt && (
            <div style={{ opacity: 0.7 }}>
              Last updated:{" "}
              {new Date(notesUpdatedAt).toLocaleString("en-CA", {
                timeZone: "America/Edmonton",
                year: "numeric",
                month: "short",
                day: "2-digit",
                hour: "2-digit",
                minute: "2-digit",
              })}
            </div>
          )}
        </div>
      </div>

      {/* Contact */}
      <div style={{ marginTop: 14, border: "1px solid #e5e5e5", borderRadius: 12, padding: 12 }}>
        <div style={{ fontWeight: 800, marginBottom: 8 }}>Contact</div>
        <div style={{ opacity: 0.85 }}>
          Phone: <b>{recruit.phone ?? "—"}</b>
        </div>
      </div>

      {/* Delete */}
      <div style={{ marginTop: 16, display: "flex", justifyContent: "flex-end" }}>
        <button
          onClick={handleDeleteRecruit}
          disabled={deleting}
          style={{
            padding: "10px 14px",
            borderRadius: 12,
            border: "1px solid #ef4444",
            background: "white",
            color: "#ef4444",
            fontWeight: 800,
            cursor: deleting ? "not-allowed" : "pointer",
          }}
        >
          {deleting ? "Deleting…" : "Delete recruit"}
        </button>
      </div>
    </main>
  );
}
