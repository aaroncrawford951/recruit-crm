"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import PageTitle from "@/app/components/PageTitle";
import { supabaseBrowser } from "@/lib/supabase-browser";

type Stage = {
  id: string;
  name: string;
  sort_order: number | null;
  is_locked?: boolean | null;
  created_at?: string | null;
};

type Recruit = {
  id: string;
  first_name: string;
  last_name: string;
  phone: string | null;
  status: string | null;
  stage_id: string | null;
  created_at: string;
};

function safeString(v: unknown) {
  return typeof v === "string" ? v : "";
}

export default function RecruitsPage() {
  const supabase = useMemo(() => supabaseBrowser(), []);

  const [recruits, setRecruits] = useState<Recruit[]>([]);
  const [stages, setStages] = useState<Stage[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Always show locked stages (Intake) at the top, then by sort_order, then created_at
  const stagesForDropdown = useMemo(() => {
    const copy = [...stages];
    copy.sort((a, b) => {
      const al = a.is_locked ? 1 : 0;
      const bl = b.is_locked ? 1 : 0;
      if (al !== bl) return bl - al; // locked first

      const as = Number.isFinite(Number(a.sort_order)) ? Number(a.sort_order) : 999999;
      const bs = Number.isFinite(Number(b.sort_order)) ? Number(b.sort_order) : 999999;
      if (as !== bs) return as - bs;

      const ac = a.created_at ? new Date(a.created_at).getTime() : 0;
      const bc = b.created_at ? new Date(b.created_at).getTime() : 0;
      return ac - bc;
    });
    return copy;
  }, [stages]);

  function stageNameById(stageId: string | null) {
    if (!stageId) return "—";
    return stages.find((s) => s.id === stageId)?.name ?? "—";
  }

  async function loadStages(): Promise<Stage[]> {
    setErr(null);

    const { data, error } = await supabase
      .from("stages")
      .select("id, name, sort_order, is_locked, created_at")
      // Prefer to have DB order it, but we also re-sort client-side above (belt + suspenders)
      .order("is_locked", { ascending: false })
      .order("sort_order", { ascending: true })
      .order("created_at", { ascending: true });

    if (error) {
      setErr(error.message);
      setStages([]);
      return [];
    }

    const loaded = (data as Stage[]) ?? [];
    setStages(loaded);
    return loaded;
  }

  async function loadRecruits() {
    setErr(null);

    const { data, error } = await supabase
      .from("recruits")
      .select("id, first_name, last_name, phone, status, stage_id, created_at")
      .order("created_at", { ascending: false });

    if (error) {
      setErr(error.message);
      setRecruits([]);
      return;
    }

    setRecruits((data as Recruit[]) ?? []);
  }

  async function loadAll() {
    setLoading(true);
    try {
      await Promise.all([loadStages(), loadRecruits()]);
    } finally {
      setLoading(false);
    }
  }

  // Bootstrap defaults for new users (won’t block UI)
  useEffect(() => {
    const runBootstrap = async () => {
      try {
        const { data } = await supabase.auth.getSession();
        if (!data.session) return;

        const { error } = await supabase.rpc("bootstrap_user_defaults");
        if (error) console.warn("bootstrap_user_defaults failed:", error.message);
      } catch (e: any) {
        console.warn("bootstrap_user_defaults exception:", e?.message ?? e);
      }
    };

    runBootstrap();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Initial page load
  useEffect(() => {
    loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function addRecruit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setErr(null);

    const formEl = e.currentTarget;
    const form = new FormData(formEl);

    const first_name = safeString(form.get("first_name")).trim();
    const last_name = safeString(form.get("last_name")).trim();
    const phoneRaw = safeString(form.get("phone")).trim();
    const phone = phoneRaw ? phoneRaw : null;

    if (!first_name || !last_name) {
      setErr("First and last name are required.");
      return;
    }

    const { data: authData, error: authErr } = await supabase.auth.getUser();
    if (authErr) {
      setErr(authErr.message);
      return;
    }
    const userId = authData.user?.id;
    if (!userId) {
      setErr("Not logged in.");
      return;
    }

    // Ensure stages are loaded for default selection
    const currentStages = stages.length ? stages : await loadStages();

    const intakeStage =
      currentStages.find((s) => (s.name ?? "").trim().toLowerCase() === "intake") ??
      currentStages.find((s) => (s.name ?? "").trim().toLowerCase() === "new") ??
      null;

    const { error } = await supabase.from("recruits").insert([
      {
        owner_user_id: userId,
        first_name,
        last_name,
        phone,
        status: "new",
        stage_id: intakeStage?.id ?? null,
      },
    ]);

    if (error) {
      setErr(error.message);
      return;
    }

    formEl.reset();
    await loadRecruits();
  }

  async function backfillMissingStages() {
    setErr(null);
    setBusy(true);

    try {
      const currentStages = stages.length ? stages : await loadStages();

      const intakeStage =
        currentStages.find((s) => (s.name ?? "").trim().toLowerCase() === "intake") ??
        currentStages.find((s) => (s.name ?? "").trim().toLowerCase() === "new") ??
        null;

      if (!intakeStage) {
        setErr('Could not find "Intake" (or "New") stage. Go to /stages and create it.');
        return;
      }

      const missing = recruits.filter((r) => !r.stage_id).map((r) => r.id);
      if (missing.length === 0) {
        setErr("All recruits already have a stage.");
        return;
      }

      const { error } = await supabase.from("recruits").update({ stage_id: intakeStage.id }).in("id", missing);
      if (error) {
        setErr(error.message);
        return;
      }

      await loadRecruits();
    } finally {
      setBusy(false);
    }
  }

  async function changeStage(recruitId: string, newStageId: string | null) {
    setErr(null);

    const resp = await fetch("/api/recruits/change-stage", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ recruitId, newStageId }),
    });

    const json = await resp.json().catch(() => ({}));
    if (!resp.ok) {
      console.error(json);
      alert(json?.error || "Failed to change stage");
      return;
    }

    setRecruits((prev) => prev.map((r) => (r.id === recruitId ? { ...r, stage_id: newStageId } : r)));
  }

  async function downloadCsv() {
    setErr(null);

    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    if (!token) {
      setErr("Not logged in.");
      return;
    }

    const resp = await fetch("/api/recruits/export", {
      method: "GET",
      headers: { Authorization: `Bearer ${token}` },
    });

    if (!resp.ok) {
      const json = await resp.json().catch(() => ({}));
      setErr(json?.error || "Export failed.");
      return;
    }

    const blob = await resp.blob();
    const url = window.URL.createObjectURL(blob);

    const a = document.createElement("a");
    a.href = url;
    a.download = `recruits-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();

    window.URL.revokeObjectURL(url);
  }

  const missingCount = recruits.filter((r) => !r.stage_id).length;

  return (
    <main style={{ padding: 40 }}>
      <PageTitle>Recruits</PageTitle>

      {err && <p style={{ color: "crimson", marginTop: 12 }}>{err}</p>}

      <form
        onSubmit={addRecruit}
        style={{
          marginTop: 16,
          marginBottom: 16,
          display: "flex",
          gap: 8,
          flexWrap: "wrap",
        }}
      >
        <input name="first_name" placeholder="First name" required />
        <input name="last_name" placeholder="Last name" required />
        <input name="phone" placeholder="Phone" />
        <button type="submit" disabled={busy}>
          Add Recruit
        </button>
      </form>

      <div style={{ display: "flex", gap: 12, alignItems: "center", marginBottom: 12, flexWrap: "wrap" }}>
        <button onClick={backfillMissingStages} disabled={busy || missingCount === 0}>
          {busy ? "Working…" : `Assign Intake stage to ${missingCount} recruit(s)`}
        </button>

        <button onClick={loadAll} disabled={busy}>
          {loading ? "Refreshing…" : "Refresh"}
        </button>

        <button onClick={downloadCsv} disabled={busy || loading}>
          Export CSV
        </button>
      </div>

      {loading ? (
        <p>Loading...</p>
      ) : (
        <ul style={{ paddingLeft: 18 }}>
          {recruits.map((r) => (
            <li key={r.id} style={{ marginBottom: 10 }}>
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  gap: 12,
                  alignItems: "center",
                  flexWrap: "wrap",
                }}
              >
                <Link href={`/recruits/${r.id}`}>
                  <strong>
                    {r.first_name} {r.last_name}
                  </strong>
                </Link>

                <select
                  value={r.stage_id ?? ""}
                  onChange={(e) => changeStage(r.id, e.target.value || null)}
                  style={{ minWidth: 220 }}
                >
                  <option value="">—</option>
                  {stagesForDropdown.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </div>

              <div style={{ fontSize: 12, opacity: 0.8 }}>
                Stage: {stageNameById(r.stage_id)} • Added: {new Date(r.created_at).toLocaleString()}
              </div>
            </li>
          ))}

          {recruits.length === 0 && <p>No recruits yet.</p>}
        </ul>
      )}
    </main>
  );
}
