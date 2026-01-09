"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase-browser";

type TemplateRow = {
  id: string;
  title: string;
  body: string | null;
  sort_order: number | null;
  created_at: string;
};

function arrayMove<T>(arr: T[], from: number, to: number) {
  const copy = [...arr];
  const [item] = copy.splice(from, 1);
  copy.splice(to, 0, item);
  return copy;
}

export default function TemplatesPage() {
  const supabase = useMemo(() => supabaseBrowser(), []);

  const [authLoading, setAuthLoading] = useState(true);
  const [userId, setUserId] = useState<string | null>(null);

  const [templates, setTemplates] = useState<TemplateRow[]>([]);

  const [loading, setLoading] = useState(true);
  const [savingOrder, setSavingOrder] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");

  const dragFromIdRef = useRef<string | null>(null);

  // ---- Auth check
  useEffect(() => {
    const run = async () => {
      setAuthLoading(true);
      setErr(null);

      const { data, error } = await supabase.auth.getUser();
      if (error) {
        setUserId(null);
      } else {
        setUserId(data.user?.id ?? null);
      }

      setAuthLoading(false);
    };

    run();
  }, [supabase]);

  async function loadTemplates() {
    setErr(null);

    const res = await supabase
      .from("message_templates")
      .select("id, title, body, sort_order, created_at")
      .order("sort_order", { ascending: true })
      .order("created_at", { ascending: true });

    if (res.error) {
      setErr(res.error.message);
      setTemplates([]);
      return;
    }

    setTemplates((res.data ?? []) as TemplateRow[]);
  }

  useEffect(() => {
    if (!userId) return;

    const run = async () => {
      setLoading(true);
      try {
        await loadTemplates();
      } finally {
        setLoading(false);
      }
    };

    run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  async function createTemplate() {
    setErr(null);

    if (!userId) {
      setErr("Not logged in.");
      return;
    }
    if (!title.trim()) {
      setErr("Title is required.");
      return;
    }

    setLoading(true);
    try {
      // Put new template at end
      const maxRes = await supabase
        .from("message_templates")
        .select("sort_order")
        .order("sort_order", { ascending: false })
        .limit(1);

      if (maxRes.error) throw new Error(maxRes.error.message);

      const currentMax = (maxRes.data?.[0]?.sort_order ?? 0) as number;
      const nextSort = (Number.isFinite(currentMax) ? currentMax : 0) + 1;

      const ins = await supabase.from("message_templates").insert([
        {
          owner_user_id: userId,
          title: title.trim(),
          body: body.trim() ? body.trim() : null,
          sort_order: nextSort,
        },
      ]);

      if (ins.error) throw new Error(ins.error.message);

      setTitle("");
      setBody("");
      await loadTemplates();
    } catch (e: any) {
      setErr(e?.message ?? "Failed to create template.");
    } finally {
      setLoading(false);
    }
  }

  async function deleteTemplate(id: string) {
    setErr(null);

    setLoading(true);
    try {
      const del = await supabase.from("message_templates").delete().eq("id", id);
      if (del.error) throw new Error(del.error.message);

      await loadTemplates();
    } catch (e: any) {
      setErr(e?.message ?? "Failed to delete template.");
    } finally {
      setLoading(false);
    }
  }

  async function persistOrder(newList: TemplateRow[]) {
    setSavingOrder(true);
    setErr(null);

    try {
      for (let i = 0; i < newList.length; i++) {
        const t = newList[i];
        const upd = await supabase
          .from("message_templates")
          .update({ sort_order: i + 1 })
          .eq("id", t.id);

        if (upd.error) throw new Error(upd.error.message);
      }

      setTemplates(newList.map((t, idx) => ({ ...t, sort_order: idx + 1 })));
    } catch (e: any) {
      setErr(e?.message ?? "Failed to save order.");
      await loadTemplates();
    } finally {
      setSavingOrder(false);
    }
  }

  function onDragStart(id: string) {
    dragFromIdRef.current = id;
  }

  async function onDrop(overId: string) {
    const fromId = dragFromIdRef.current;
    dragFromIdRef.current = null;

    if (!fromId || fromId === overId) return;

    const oldIndex = templates.findIndex((t) => t.id === fromId);
    const newIndex = templates.findIndex((t) => t.id === overId);
    if (oldIndex === -1 || newIndex === -1) return;

    const newList = arrayMove(templates, oldIndex, newIndex);
    setTemplates(newList);
    await persistOrder(newList);
  }

  if (authLoading) return <div style={{ padding: 24 }}>Checking login…</div>;

  if (!userId) {
    return (
      <div style={{ padding: 24 }}>
        <h1 style={{ fontSize: 24, fontWeight: 700 }}>Templates</h1>
        <p style={{ opacity: 0.8, marginTop: 8 }}>
          You’re not logged in. Please log in to manage templates.
        </p>
      </div>
    );
  }

  return (
    <div style={{ padding: 24, maxWidth: 980 }}>
      <h1 style={{ fontSize: 24, fontWeight: 700 }}>Templates</h1>
      <p style={{ opacity: 0.75, marginTop: 6 }}>
        Drag templates to reorder.
      </p>

      {err && <div style={{ marginTop: 12, color: "crimson", whiteSpace: "pre-wrap" }}>{err}</div>}

      {/* Create */}
      <div style={{ marginTop: 16, border: "1px solid #e5e5e5", borderRadius: 12, padding: 12 }}>
        <div style={{ fontWeight: 700, marginBottom: 10 }}>Create template</div>

        <div style={{ display: "grid", gap: 10 }}>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Template title"
            style={{ padding: 10, borderRadius: 10, border: "1px solid #e5e5e5" }}
          />
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="Message body (SMS)…"
            rows={4}
            style={{
              padding: 10,
              borderRadius: 10,
              border: "1px solid #e5e5e5",
              resize: "vertical",
            }}
          />

          <button
            onClick={createTemplate}
            disabled={loading || savingOrder}
            style={{
              padding: "10px 14px",
              borderRadius: 10,
              border: "1px solid #e5e5e5",
              background: "white",
              cursor: loading || savingOrder ? "not-allowed" : "pointer",
              fontWeight: 700,
              width: 160,
            }}
          >
            {loading ? "Saving…" : "Create"}
          </button>
        </div>
      </div>

      {/* List */}
      <div style={{ marginTop: 16, border: "1px solid #e5e5e5", borderRadius: 12, padding: 12 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
          <div style={{ fontWeight: 700 }}>Templates (drag to reorder)</div>
          <div style={{ opacity: 0.7, fontSize: 13 }}>{savingOrder ? "Saving order…" : "Tip: drag the row"}</div>
        </div>

        {loading ? (
          <div style={{ marginTop: 10, opacity: 0.8 }}>Loading…</div>
        ) : templates.length === 0 ? (
          <div style={{ marginTop: 10, opacity: 0.8 }}>No templates yet.</div>
        ) : (
          <div style={{ marginTop: 10, display: "grid", gap: 10 }}>
            {templates.map((t) => (
              <div
                key={t.id}
                draggable
                onDragStart={() => onDragStart(t.id)}
                onDragOver={(e) => e.preventDefault()}
                onDrop={() => onDrop(t.id)}
                style={{
                  border: "1px solid #eee",
                  borderRadius: 12,
                  padding: 12,
                  display: "flex",
                  justifyContent: "space-between",
                  gap: 12,
                  alignItems: "flex-start",
                  background: "white",
                  cursor: "grab",
                }}
                title="Drag to reorder"
              >
                <div style={{ display: "grid", gap: 6, flex: 1 }}>
                  <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                    <div style={{ fontWeight: 800 }}>{t.title}</div>
                    <div style={{ opacity: 0.65, fontSize: 13 }}>Order: {t.sort_order ?? "—"}</div>
                  </div>

                  {t.body ? (
                    <div style={{ whiteSpace: "pre-wrap", opacity: 0.85 }}>{t.body}</div>
                  ) : (
                    <div style={{ opacity: 0.6 }}>(No body)</div>
                  )}
                </div>

                <button
                  onClick={() => deleteTemplate(t.id)}
                  disabled={loading || savingOrder}
                  style={{
                    padding: "8px 10px",
                    borderRadius: 10,
                    border: "1px solid #e5e5e5",
                    background: "white",
                    cursor: loading || savingOrder ? "not-allowed" : "pointer",
                    fontWeight: 700,
                  }}
                >
                  Delete
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
