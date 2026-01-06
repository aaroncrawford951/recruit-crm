"use client";

import { useEffect, useMemo, useState } from "react";
import PageTitle from "@/app/components/PageTitle";
import { supabaseBrowser } from "@/lib/supabase-browser";
import { waitForSession } from "@/lib/waitForSession";

type MasterStage = {
  id: string;
  name: string;
  sort_order: number;
  is_locked: boolean;
  created_at: string;
};

type MasterTemplate = {
  id: string;
  title: string;
  body: string;
  created_at: string;
};

type Tab = "stages" | "templates";

export default function AdminMasterPage() {
  const [supabase] = useState(() => supabaseBrowser());

  const [authReady, setAuthReady] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);

  const [tab, setTab] = useState<Tab>("stages");

  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const [stages, setStages] = useState<MasterStage[]>([]);
  const [templates, setTemplates] = useState<MasterTemplate[]>([]);

  // Create forms
  const [newStageName, setNewStageName] = useState("");
  const [newTemplateTitle, setNewTemplateTitle] = useState("");
  const [newTemplateBody, setNewTemplateBody] = useState("");

  const adminEmails = useMemo(() => {
    const raw = process.env.NEXT_PUBLIC_ADMIN_EMAILS || "";
    return raw
      .split(",")
      .map((x) => x.trim().toLowerCase())
      .filter(Boolean);
  }, []);

  // ---- Auth + Admin guard ----
  useEffect(() => {
    let cancelled = false;

    const run = async () => {
      const session = await waitForSession(supabase, 2000);
      if (cancelled) return;

      if (!session) {
        const returnTo = window.location.pathname + window.location.search;
        window.location.href = `/login?returnTo=${encodeURIComponent(returnTo)}`;
        return;
      }

      // Get user email
      const { data: u } = await supabase.auth.getUser();
      const email = (u.user?.email || "").toLowerCase();

      // If admin allowlist is not configured, block (prevents accidental exposure)
      if (adminEmails.length === 0) {
        setErr(
          "Admin is not configured. Add NEXT_PUBLIC_ADMIN_EMAILS in .env.local (comma-separated)."
        );
        setAuthReady(true);
        setIsAdmin(false);
        setLoading(false);
        return;
      }

      if (!adminEmails.includes(email)) {
        setErr("You do not have access to the admin master view.");
        setAuthReady(true);
        setIsAdmin(false);
        setLoading(false);
        return;
      }

      setAuthReady(true);
      setIsAdmin(true);
    };

    run();
    return () => {
      cancelled = true;
    };
  }, [supabase, adminEmails]);

  // ---- Load master data ----
  async function loadAll() {
    setLoading(true);
    setErr(null);
    setMsg(null);

    const [sRes, tRes] = await Promise.all([
      supabase
        .from("master_stages")
        .select("id, name, sort_order, is_locked, created_at")
        .order("sort_order", { ascending: true })
        .order("created_at", { ascending: true }),

      supabase
        .from("master_templates")
        .select("id, title, body, created_at")
        .order("created_at", { ascending: false }),
    ]);

    if (sRes.error) {
      setErr(sRes.error.message);
      setStages([]);
    } else {
      setStages((sRes.data as MasterStage[]) ?? []);
    }

    if (tRes.error) {
      setErr((prev) => prev ?? tRes.error!.message);
      setTemplates([]);
    } else {
      setTemplates((tRes.data as MasterTemplate[]) ?? []);
    }

    setLoading(false);
  }

  useEffect(() => {
    if (!authReady || !isAdmin) return;
    loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authReady, isAdmin]);

  // ---- Helpers ----
  function toast(text: string) {
    setMsg(text);
    setTimeout(() => setMsg(null), 1400);
  }

  // ---- Master Stages actions ----
  async function createStage() {
    setErr(null);
    setMsg(null);

    const name = newStageName.trim();
    if (!name) return;

    setBusy(true);

    const { error } = await supabase.from("master_stages").insert([
      {
        name,
        sort_order: stages.length ? Math.max(...stages.map((s) => s.sort_order)) + 10 : 10,
        is_locked: false,
      },
    ]);

    setBusy(false);

    if (error) {
      setErr(error.message);
      return;
    }

    setNewStageName("");
    toast("Stage added.");
    await loadAll();
  }

  async function renameStage(stageId: string, name: string) {
    setErr(null);
    setBusy(true);

    const { error } = await supabase
      .from("master_stages")
      .update({ name })
      .eq("id", stageId);

    setBusy(false);

    if (error) {
      setErr(error.message);
      return;
    }

    toast("Stage updated.");
    await loadAll();
  }

  async function updateStageOrder(stageId: string, sort_order: number) {
    setErr(null);
    setBusy(true);

    const { error } = await supabase
      .from("master_stages")
      .update({ sort_order })
      .eq("id", stageId);

    setBusy(false);

    if (error) {
      setErr(error.message);
      return;
    }

    toast("Order updated.");
    await loadAll();
  }

  async function deleteStage(stage: MasterStage) {
    if (stage.is_locked) return;

    const ok = confirm(
      `Delete master stage "${stage.name}"?\n\nThis only deletes the MASTER stage. Users won’t be affected until we add an “Apply master to users” button.`
    );
    if (!ok) return;

    setErr(null);
    setBusy(true);

    const { error } = await supabase.from("master_stages").delete().eq("id", stage.id);

    setBusy(false);

    if (error) {
      setErr(error.message);
      return;
    }

    toast("Stage deleted.");
    await loadAll();
  }

  // ---- Master Templates actions ----
  async function createTemplate() {
    setErr(null);
    setMsg(null);

    const title = newTemplateTitle.trim();
    const body = newTemplateBody.trim();

    if (!title) {
      setErr("Template title is required.");
      return;
    }
    if (!body) {
      setErr("Template body is required.");
      return;
    }

    setBusy(true);

    const { error } = await supabase.from("master_templates").insert([{ title, body }]);

    setBusy(false);

    if (error) {
      setErr(error.message);
      return;
    }

    setNewTemplateTitle("");
    setNewTemplateBody("");
    toast("Template added.");
    await loadAll();
  }

  async function updateTemplate(id: string, patch: Partial<Pick<MasterTemplate, "title" | "body">>) {
    setErr(null);
    setBusy(true);

    const { error } = await supabase.from("master_templates").update(patch).eq("id", id);

    setBusy(false);

    if (error) {
      setErr(error.message);
      return;
    }

    toast("Template saved.");
    await loadAll();
  }

  async function deleteTemplate(t: MasterTemplate) {
    const ok = confirm(
      `Delete master template "${t.title}"?\n\nThis only deletes the MASTER template. Users won’t be affected until we add “Apply master to users”.`
    );
    if (!ok) return;

    setErr(null);
    setBusy(true);

    const { error } = await supabase.from("master_templates").delete().eq("id", t.id);

    setBusy(false);

    if (error) {
      setErr(error.message);
      return;
    }

    toast("Template deleted.");
    await loadAll();
  }

  // ---- Render guards ----
  if (!authReady) return <main style={{ padding: 24 }}>Checking login…</main>;

  if (!isAdmin) {
    return (
      <main style={{ padding: 24, maxWidth: 900 }}>
        <PageTitle>Admin</PageTitle>
        <p style={{ color: "crimson", marginTop: 10 }}>{err ?? "No access."}</p>
      </main>
    );
  }

  return (
    <main style={{ padding: 24, maxWidth: 1000 }}>
      <PageTitle>Admin • Master Defaults</PageTitle>

      <p style={{ opacity: 0.75, marginTop: -6 }}>
        Edit the generic defaults. Users get these on first login (missing-only). Next we’ll add “Apply to users”.
      </p>

      {/* Tabs */}
      <div style={{ marginTop: 14, display: "flex", gap: 10, flexWrap: "wrap" }}>
        <button
          onClick={() => setTab("stages")}
          style={{
            padding: "8px 12px",
            borderRadius: 12,
            border: "1px solid #e5e5e5",
            background: tab === "stages" ? "rgba(59,130,246,0.10)" : "white",
            fontWeight: 800,
            cursor: "pointer",
          }}
        >
          Master Stages
        </button>
        <button
          onClick={() => setTab("templates")}
          style={{
            padding: "8px 12px",
            borderRadius: 12,
            border: "1px solid #e5e5e5",
            background: tab === "templates" ? "rgba(59,130,246,0.10)" : "white",
            fontWeight: 800,
            cursor: "pointer",
          }}
        >
          Master Templates
        </button>

        <button
          onClick={loadAll}
          disabled={busy}
          style={{
            marginLeft: "auto",
            padding: "8px 12px",
            borderRadius: 12,
            border: "1px solid #e5e5e5",
            background: "white",
            fontWeight: 700,
            cursor: busy ? "not-allowed" : "pointer",
          }}
        >
          Refresh
        </button>
      </div>

      {err && <p style={{ color: "crimson", marginTop: 12 }}>{err}</p>}
      {msg && <p style={{ color: "#065f46", marginTop: 12 }}>{msg}</p>}

      <hr style={{ margin: "18px 0" }} />

      {loading ? (
        <p>Loading…</p>
      ) : tab === "stages" ? (
        <section>
          <h2 style={{ fontSize: 18, fontWeight: 900 }}>Master Stages</h2>
          <p style={{ opacity: 0.75, marginTop: 6 }}>
            Intake is locked. You can add new stages and control order with sort_order.
          </p>

          {/* Add stage */}
          <div style={{ marginTop: 12, display: "flex", gap: 10, flexWrap: "wrap" }}>
            <input
              value={newStageName}
              onChange={(e) => setNewStageName(e.target.value)}
              placeholder="New stage name"
              style={{
                padding: 10,
                borderRadius: 12,
                border: "1px solid #e5e5e5",
                minWidth: 260,
              }}
            />
            <button
              onClick={createStage}
              disabled={busy || !newStageName.trim()}
              style={{
                padding: "10px 14px",
                borderRadius: 12,
                border: "1px solid #e5e5e5",
                background: "white",
                fontWeight: 800,
                cursor: busy ? "not-allowed" : "pointer",
              }}
            >
              Add stage
            </button>
          </div>

          {/* List */}
          <div style={{ marginTop: 14, display: "grid", gap: 10 }}>
            {stages.map((s) => (
              <div
                key={s.id}
                style={{
                  border: "1px solid #e5e5e5",
                  borderRadius: 12,
                  padding: 12,
                  display: "grid",
                  gap: 10,
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
                  <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                    <input
                      defaultValue={s.name}
                      disabled={s.is_locked || busy}
                      onBlur={(e) => {
                        const next = e.target.value.trim();
                        if (!next || next === s.name) return;
                        renameStage(s.id, next);
                      }}
                      style={{
                        padding: 10,
                        borderRadius: 12,
                        border: "1px solid #e5e5e5",
                        minWidth: 260,
                        fontWeight: 800,
                        opacity: s.is_locked ? 0.75 : 1,
                      }}
                    />

                    {s.is_locked && (
                      <span
                        style={{
                          fontSize: 12,
                          padding: "2px 8px",
                          borderRadius: 999,
                          border: "1px solid #fde68a",
                          background: "#fffbeb",
                          fontWeight: 800,
                        }}
                      >
                        Locked
                      </span>
                    )}
                  </div>

                  <button
                    onClick={() => deleteStage(s)}
                    disabled={busy || s.is_locked}
                    style={{
                      padding: "10px 14px",
                      borderRadius: 12,
                      border: `1px solid ${s.is_locked ? "#e5e5e5" : "#ef4444"}`,
                      background: "white",
                      color: s.is_locked ? "#6b7280" : "#ef4444",
                      fontWeight: 900,
                      cursor: busy || s.is_locked ? "not-allowed" : "pointer",
                    }}
                  >
                    Delete
                  </button>
                </div>

                <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                  <div style={{ fontSize: 12, opacity: 0.75 }}>sort_order</div>
                  <input
                    type="number"
                    defaultValue={s.sort_order}
                    disabled={busy}
                    onBlur={(e) => {
                      const next = Number(e.target.value);
                      if (Number.isNaN(next) || next === s.sort_order) return;
                      updateStageOrder(s.id, next);
                    }}
                    style={{
                      padding: 10,
                      borderRadius: 12,
                      border: "1px solid #e5e5e5",
                      width: 140,
                    }}
                  />
                  <div style={{ fontSize: 12, opacity: 0.6 }}>
                    Tip: Use 0, 10, 20… to leave room between items.
                  </div>
                </div>
              </div>
            ))}

            {stages.length === 0 && <div style={{ opacity: 0.8 }}>No master stages yet.</div>}
          </div>
        </section>
      ) : (
        <section>
          <h2 style={{ fontSize: 18, fontWeight: 900 }}>Master Templates</h2>
          <p style={{ opacity: 0.75, marginTop: 6 }}>
            These are the default templates new users start with (missing-only).
          </p>

          {/* Add template */}
          <div style={{ marginTop: 12, border: "1px solid #e5e5e5", borderRadius: 12, padding: 12 }}>
            <div style={{ display: "grid", gap: 10 }}>
              <input
                value={newTemplateTitle}
                onChange={(e) => setNewTemplateTitle(e.target.value)}
                placeholder="Template title"
                style={{
                  padding: 10,
                  borderRadius: 12,
                  border: "1px solid #e5e5e5",
                }}
              />

              <textarea
                value={newTemplateBody}
                onChange={(e) => setNewTemplateBody(e.target.value)}
                placeholder="Template body"
                rows={4}
                style={{
                  padding: 10,
                  borderRadius: 12,
                  border: "1px solid #e5e5e5",
                  resize: "vertical",
                }}
              />

              <div style={{ display: "flex", justifyContent: "flex-end" }}>
                <button
                  onClick={createTemplate}
                  disabled={busy || !newTemplateTitle.trim() || !newTemplateBody.trim()}
                  style={{
                    padding: "10px 14px",
                    borderRadius: 12,
                    border: "1px solid #e5e5e5",
                    background: "white",
                    fontWeight: 900,
                    cursor: busy ? "not-allowed" : "pointer",
                  }}
                >
                  Add template
                </button>
              </div>
            </div>
          </div>

          {/* List templates */}
          <div style={{ marginTop: 14, display: "grid", gap: 10 }}>
            {templates.map((t) => (
              <div
                key={t.id}
                style={{
                  border: "1px solid #e5e5e5",
                  borderRadius: 12,
                  padding: 12,
                  display: "grid",
                  gap: 10,
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
                  <input
                    defaultValue={t.title}
                    disabled={busy}
                    onBlur={(e) => {
                      const next = e.target.value.trim();
                      if (!next || next === t.title) return;
                      updateTemplate(t.id, { title: next });
                    }}
                    style={{
                      padding: 10,
                      borderRadius: 12,
                      border: "1px solid #e5e5e5",
                      minWidth: 320,
                      fontWeight: 900,
                    }}
                  />

                  <button
                    onClick={() => deleteTemplate(t)}
                    disabled={busy}
                    style={{
                      padding: "10px 14px",
                      borderRadius: 12,
                      border: "1px solid #ef4444",
                      background: "white",
                      color: "#ef4444",
                      fontWeight: 900,
                      cursor: busy ? "not-allowed" : "pointer",
                    }}
                  >
                    Delete
                  </button>
                </div>

                <textarea
                  defaultValue={t.body}
                  disabled={busy}
                  onBlur={(e) => {
                    const next = e.target.value;
                    if (next === t.body) return;
                    updateTemplate(t.id, { body: next });
                  }}
                  rows={4}
                  style={{
                    padding: 10,
                    borderRadius: 12,
                    border: "1px solid #e5e5e5",
                    resize: "vertical",
                  }}
                />
              </div>
            ))}

            {templates.length === 0 && <div style={{ opacity: 0.8 }}>No master templates yet.</div>}
          </div>
        </section>
      )}
    </main>
  );
}
