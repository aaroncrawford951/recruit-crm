"use client";

import { useEffect, useMemo, useState } from "react";
import PageTitle from "@/app/components/PageTitle";
import { supabaseBrowser } from "@/lib/supabase-browser";
import { waitForSession } from "@/lib/waitForSession";

type AdminUserRow = {
  id: string;
  email: string | null;
  created_at: string | null;
  last_sign_in_at: string | null;
};

export default function AdminUsersPage() {
  const supabase = useMemo(() => supabaseBrowser(), []);

  const [authReady, setAuthReady] = useState(false);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [users, setUsers] = useState<AdminUserRow[]>([]);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setErr(null);

    const session = await waitForSession(supabase, 1500);
    if (!session) {
      const returnTo = window.location.pathname + window.location.search;
      window.location.href = `/login?returnTo=${encodeURIComponent(returnTo)}`;
      return;
    }

    const token = session.access_token;

    try {
      const resp = await fetch("/api/admin/list-users", {
        method: "GET",
        headers: { Authorization: `Bearer ${token}` },
      });

      const json = await resp.json().catch(() => ({}));

      if (!resp.ok) {
        setErr(json?.error || `Failed to load users (${resp.status})`);
        setUsers([]);
        setLoading(false);
        return;
      }

      setUsers((json.users as AdminUserRow[]) ?? []);
      setLoading(false);
    } catch (e: any) {
      setErr(e?.message ?? "Failed to load users.");
      setUsers([]);
      setLoading(false);
    }
  }

  useEffect(() => {
    let cancelled = false;

    const run = async () => {
      const session = await waitForSession(supabase, 1500);
      if (cancelled) return;

      if (!session) {
        const returnTo = window.location.pathname + window.location.search;
        window.location.href = `/login?returnTo=${encodeURIComponent(returnTo)}`;
        return;
      }

      setAuthReady(true);
    };

    run();
    return () => {
      cancelled = true;
    };
  }, [supabase]);

  useEffect(() => {
    if (!authReady) return;
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authReady]);

  async function onDelete(userId: string, email: string | null) {
    const ok = confirm(`Delete this user?\n\n${email ?? userId}\n\nThis is permanent.`);
    if (!ok) return;

    setDeletingId(userId);
    setErr(null);

    const session = await waitForSession(supabase, 1500);
    const token = session?.access_token;
    if (!token) {
      setErr("Not logged in.");
      setDeletingId(null);
      return;
    }

    const resp = await fetch("/api/admin/delete-user", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ userId }),
    });

    const json = await resp.json().catch(() => ({}));

    if (!resp.ok) {
      setErr(json?.error || `Delete failed (${resp.status})`);
      setDeletingId(null);
      return;
    }

    // remove from UI and refresh
    setUsers((prev) => prev.filter((u) => u.id !== userId));
    setDeletingId(null);
  }

  if (!authReady) return <main style={{ padding: 24 }}>Checking login…</main>;

  return (
    <main style={{ padding: 24, maxWidth: 900 }}>
      <PageTitle>Admin — Users</PageTitle>
      <p style={{ opacity: 0.7, marginTop: -6 }}>
        View all accounts and delete users (hard delete).
      </p>

      <div style={{ marginTop: 12, display: "flex", gap: 12 }}>
        <button
          onClick={load}
          style={{
            padding: "10px 14px",
            borderRadius: 12,
            border: "1px solid #e5e7eb",
            background: "white",
            fontWeight: 800,
            cursor: "pointer",
          }}
        >
          Refresh
        </button>
      </div>

      {loading && (
        <div style={{ marginTop: 16 }}>
          <div
            style={{
              display: "inline-block",
              padding: "12px 18px",
              borderRadius: 14,
              border: "1px solid #e5e7eb",
              background: "white",
              fontWeight: 800,
            }}
          >
            Loading…
          </div>
        </div>
      )}

      {err && <p style={{ marginTop: 16, color: "crimson", fontWeight: 700 }}>{err}</p>}

      {!loading && !err && (
        <div style={{ marginTop: 16, display: "grid", gap: 10 }}>
          {users.map((u) => (
            <div
              key={u.id}
              style={{
                border: "1px solid #e5e7eb",
                borderRadius: 12,
                padding: 12,
                background: "white",
                display: "flex",
                justifyContent: "space-between",
                gap: 12,
                alignItems: "center",
                flexWrap: "wrap",
              }}
            >
              <div style={{ minWidth: 320 }}>
                <div style={{ fontWeight: 900 }}>{u.email ?? "—"}</div>
                <div style={{ fontSize: 12, opacity: 0.75, marginTop: 4 }}>
                  id: {u.id}
                </div>
                <div style={{ fontSize: 12, opacity: 0.75, marginTop: 2 }}>
                  created:{" "}
                  {u.created_at
                    ? new Date(u.created_at).toLocaleString("en-CA", { timeZone: "America/Edmonton" })
                    : "—"}
                </div>
              </div>

              <button
                onClick={() => onDelete(u.id, u.email)}
                disabled={deletingId === u.id}
                style={{
                  padding: "10px 14px",
                  borderRadius: 12,
                  border: "1px solid #ef4444",
                  background: "white",
                  color: "#ef4444",
                  fontWeight: 900,
                  cursor: deletingId === u.id ? "not-allowed" : "pointer",
                }}
              >
                {deletingId === u.id ? "Deleting…" : "Delete"}
              </button>
            </div>
          ))}

          {users.length === 0 && <div style={{ opacity: 0.8 }}>No users found.</div>}
        </div>
      )}
    </main>
  );
}
