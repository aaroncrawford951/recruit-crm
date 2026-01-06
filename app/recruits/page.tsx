"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { supabaseBrowser } from "../../lib/supabase-browser";
import PageTitle from "@/app/components/PageTitle";

type Stage = {
  id: string;
  name: string;
  sort_order: number;
  is_locked?: boolean | null;
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

export default function RecruitsPage() {
  const supabase = supabaseBrowser();

  const [recruits, setRecruits] = useState<Recruit[]>([]);
  const [stages, setStages] = useState<Stage[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const stageNamesLower = useMemo(() => {
    return new Set(stages.map((s) => (s.name ?? "").trim().toLowerCase()));
  }, [stages]);

  function stageNameById(stageId: string | null) {
    if (!stageId) return "—";
    return stages.find((s) => s.id === stageId)?.name ?? "—";
  }

  async function loadStages(): Promise<Stage[]> {
    const { data, error } = await supabase
      .from("stages")
      .select("id, name, sort_order, is_locked")
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
    setLoading(true);
    setErr(null);

    const { data, error } = await supabase
      .from("recruits")
      .select("id, first_name, last_name, phone, status, stage_id, created_at")
      .order("created_at", { ascending: false });

    if (error) {
      setErr(error.message);
      setRecruits([]);
      setLoading(false);
      return;
    }

    setRecruits((data as Recruit[]) ?? []);
    setLoading(false);
  }

  async function loadAll() {
    await loadStages();
    await loadRecruits();
  }

  // ✅ Bootstraps defaults for brand new users (runs once; won't block app)
  useEffect(() => {
    const runBootstrap = async () => {
      try {
        const { data } = await supabase.auth.getSession();
        if (!data.session) return;

        const { error: bootErr } = await supabase.rpc("bootstrap_user_defaults");
        if (bootErr) {
          // Don't break UI, just log
          console.warn("bootstrap_user_defaults failed:", bootErr.message);
        }
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

  async function backfillMissingStages() {
    setErr(null);
    setBusy(true);

    const currentStages = stages.length ? stages : await loadStages();

    // Prefer Intake if it exists, otherwise fallback to "new"
    const intakeStage =
      currentStages.find((s) => (s.name ?? "").trim().toLowerCase() === "intake") ??
      currentStages.find((s) => (s.name ?? "").trim().toLowerCase() === "new");

    if (!intakeStage) {
      setErr('Could not find "Intake" (or "New") stage. Go to /stages and create it.');
      setBusy(false);
      return;
    }

    const missing = recruits.filter((r) => !r.stage_id).map((r) => r.id);
    if (missing.length === 0) {
      setErr("All recruits already have a stage.");
      setBusy(false);
      return;
    }

    const { error } = await supabase.from("recruits").update({ stage_id: intakeStage.id }).in("id", missing);

    if (error) {
      setErr(error.message);
      setBusy(false);
      return;
    }

    await loadRecruits();
    setBusy(false);
  }

  async function addRecruit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setErr(null);

    const formEl = e.currentTarget;
    const form = new FormData(formEl);

    const first_name = String(form.get("first_name") || "").trim();
    const last_name = String(form.get("last_name") || "").trim();
    const phoneRaw = String(form.get("phone") || "").trim();
    const phone = phoneRaw ? phoneRaw : null;

    const { data: authData } = await supabase.auth.getUser();
    const userId = authData?.user?.id;
    if (!userId) {
      setErr("Not logged in");
      return;
    }

    // Ensure stages are loaded
    const currentStages = stages.length ? stages : await loadStages();

    // Default stage = Intake if exists, else "New"
    const intakeStage =
      currentStages.find((s) => (s.name ?? "").trim().toLowerCase() === "intake") ??
      currentStages.find((s) => (s.name ?? "").trim().toLowerCase() === "new");

    const { error } = await supabase.from("recruits").insert([
      {
        first_name,
        last_name,
        phone,
        status: "new",
        owner_user_id: userId,
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

  const missingCount = recruits.filter((r) => !r.stage_id).length;

  return (
    <main style={{ padding: 40 }}>
<PageTitle>Recruits</PageTitle>

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
        <button type="submit">Add Recruit</button>
      </form>

      <div style={{ display: "flex", gap: 12, alignItems: "center", marginBottom: 12, flexWrap: "wrap" }}>
        <button onClick={backfillMissingStages} disabled={busy || missingCount === 0}>
          {busy ? "Working…" : `Assign Intake stage to ${missingCount} recruit(s)`}
        </button>

        <button onClick={loadAll} disabled={busy}>
          Refresh
        </button>
      </div>

      {err && <p style={{ color: "crimson" }}>{err}</p>}

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
                  onChange={async (e) => {
                    const stageId = e.target.value || null;
                    setErr(null);

                    const resp = await fetch("/api/recruits/change-stage", {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ recruitId: r.id, newStageId: stageId }),
                    });

                    const json = await resp.json();
                    if (!resp.ok) {
                      console.error(json);
                      alert(json.error || "Failed to change stage");
                      return;
                    }

                    // Update UI immediately
                    setRecruits((prev) => prev.map((x) => (x.id === r.id ? { ...x, stage_id: stageId } : x)));
                  }}
                  style={{ minWidth: 220 }}
                >
                  <option value="">—</option>
                  {stages.map((s) => (
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
