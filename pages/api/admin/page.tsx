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
  const [supabase] = useState(() => supabaseBrowser());

  const [authReady, setAuthReady] = useState(false);
  const [token, setToken] = useState<string | null>(null);

  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const [users, setUsers] = useState<AdminUserRow[]>([]);

  // Auth guard + token
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

      setToken(session.access_token);
      setAuthReady(true);
    };

    run();
    return () => {
      cancelled = true;
    };
  }, [supabase]);

  async function loadUsers(t: string) {
    setLoading(true);
    setErr(null);
    setMsg(null);

    const resp = await fetch("/api/admin/users", {
      method: "GET",
      headers: { Authorization: `Bearer ${t}` },
    });

    const json = await resp.json();
    if (!resp.ok) {
      setErr(json.error || "Failed to load users");
      setUsers([]);
      setLoading(false);
      return;
    }

    setUsers((json.users as AdminUserRow[]) ?? []);
    setLoading(false);
  }

  useEffect(() => {
    if (!authReady || !token) return;
    loadUsers(token);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authReady, token]);

  async function deleteUser(userId: string, email: string | null) {
    if (!token) return;

    const ok = confirm(
      `Delete this user?\n\n${email ?? userId}\n\nThis will delete their account AND purge their recruits/stages/templates/messages/follow-ups. This cannot be undone.`
    );
    if (!ok) return;

    setBusyId(userId);
    setErr(null);
    setMsg(null);

    const resp = await fetch("/api/admin/users", {
      method: "DELETE",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ userId }),
    });

    const json = await resp.json();
    if (!resp.ok) {
      setErr(json.error || "Failed to delete user");
      setBusyId(null);
      return;
    }

    setUsers((prev) => prev.filter((u) => u.id !== userId));
    setMsg("User deleted.");
    setBusyId(null);
  }

  const count = useMemo(() => users.length, [users]);

  if (!authReady) return <main style={{ padding: 24 }}>Checking login…</main>;

  return (
    <main style={{ padding: 24, maxWidth: 1000 }}>
      <PageTitle>Admin — Users</PageTitle>

      <p style={{ opacity: 0.75, marginTop: -6 }}>
        Total: <b>{count}</b>
      </p>

      <div style={{ display: "flex", gap: 12, marginTop: 12 }}>
        <button
          onClick={() => token && loadUsers(token)}
          style={{
            padding: "10px 14px",
            borderRadius: 12,
            border: "1px solid #e5e5e5",
            background: "white",
            fontWeight: 800,
            cursor: "pointer",
          }}
        >
          Refresh
        </button>
      </div>

      {err && <p style={{ color: "crimson", marginTop: 12 }}>{err}</p>}
      {msg && <p style={{ color: "#065f46", marginTop: 12 }}>{msg}</p>}

      <div style={{ marginTop: 16, border: "1px solid #e5e5e5", borderRadius: 12, overflow: "hidden" }}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 220px 220px 140px", padding: 12, fontWeight: 900, background: "#f9fafb" }}>
          <div>Email</div>
          <div>Created</div>
          <div>Last sign-in</div>
          <div style={{ textAlign: "right" }}>Actions</div>
        </div>

        {loading ? (
          <div style={{ padding: 12, opacity: 0.8 }}>Loading…</div>
        ) : users.length === 0 ? (
          <div style={{ padding: 12, opacity: 0.8 }}>No users found.</div>
        ) : (
          users.map((u) => (
            <div
              key={u.id}
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 220px 220px 140px",
                padding: 12,
                borderTop: "1px solid #e5e5e5",
                alignItems: "center",
                gap: 12,
              }}
            >
              <div style={{ fontWeight: 800 }}>{u.email ?? "—"}</div>

              <div style={{ fontSize: 12, opacity: 0.8 }}>
                {u.created_at
                  ? new Date(u.created_at).toLocaleString("en-CA", {
                      timeZone: "America/Edmonton",
                      year: "numeric",
                      month: "short",
                      day: "2-digit",
                    })
                  : "—"}
              </div>

              <div style={{ fontSize: 12, opacity: 0.8 }}>
                {u.last_sign_in_at
                  ? new Date(u.last_sign_in_at).toLocaleString("en-CA", {
                      timeZone: "America/Edmonton",
                      year: "numeric",
                      month: "short",
                      day: "2-digit",
                    })
                  : "—"}
              </div>

              <div style={{ textAlign: "right" }}>
                <button
                  onClick={() => deleteUser(u.id, u.email)}
                  disabled={busyId === u.id}
                  style={{
                    padding: "8px 12px",
                    borderRadius: 12,
                    border: "1px solid #ef4444",
                    background: "white",
                    color: "#ef4444",
                    fontWeight: 900,
                    cursor: busyId === u.id ? "not-allowed" : "pointer",
                  }}
                >
                  {busyId === u.id ? "Deleting…" : "Delete"}
                </button>
              </div>
            </div>
          ))
        )}
      </div>
    </main>
  );
}
