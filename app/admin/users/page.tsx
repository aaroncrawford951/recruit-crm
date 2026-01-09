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

type CleanupStep = {
  step: string;
  ok: boolean;
  detail?: string;
};

type ListUsersResponse = {
  users: AdminUserRow[];
};

type DeleteUserResponse = {
  ok: boolean;
  userId: string;
  cleanup?: CleanupStep[];
};

function fmt(dt: string | null | undefined) {
  if (!dt) return "—";
  try {
    return new Date(dt).toLocaleString("en-CA", { timeZone: "America/Edmonton" });
  } catch {
    return dt;
  }
}

export default function AdminUsersPage() {
  const supabase = useMemo(() => supabaseBrowser(), []);

  const [authReady, setAuthReady] = useState(false);

  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const [users, setUsers] = useState<AdminUserRow[]>([]);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const [lastDeleted, setLastDeleted] = useState<{
    userId: string;
    email?: string | null;
    cleanup?: CleanupStep[];
  } | null>(null);

  const [me, setMe] = useState<{ id: string; email: string | null } | null>(null);

  // ---- Auth guard + identify current user ----
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

      // Who am I? (for highlighting / "you" tag)
      const { data, error } = await supabase.auth.getUser();
      if (!cancelled) {
        if (!error && data?.user) {
          setMe({ id: data.user.id, email: data.user.email ?? null });
        } else {
          setMe(null);
        }
        setAuthReady(true);
      }
    };

    run();
    return () => {
      cancelled = true;
    };
  }, [supabase]);

  async function load() {
    setLoading(true);
    setErr(null);
    setLastDeleted(null);

    const session = await waitForSession(supabase, 1500);
    if (!session) {
      const returnTo = window.location.pathname + window.location.search;
      window.location.href = `/login?returnTo=${encodeURIComponent(returnTo)}`;
      return;
    }

    try {
      const resp = await fetch("/api/admin/list-users", {
        method: "GET",
        headers: { Authorization: `Bearer ${session.access_token}` },
      });

      const json: Partial<ListUsersResponse> = await resp.json().catch(() => ({}));

      if (!resp.ok) {
        setUsers([]);
        setErr((json as any)?.error || `Failed to load users (${resp.status})`);
        setLoading(false);
        return;
      }

      setUsers(Array.isArray(json.users) ? (json.users as AdminUserRow[]) : []);
      setLoading(false);
    } catch (e: any) {
      setUsers([]);
      setErr(e?.message ?? "Failed to load users.");
      setLoading(false);
    }
  }

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
    setLastDeleted(null);

    const session = await waitForSession(supabase, 1500);
    if (!session) {
      setErr("Not logged in.");
      setDeletingId(null);
      return;
    }

    try {
      const resp = await fetch("/api/admin/delete-user", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ userId }),
      });

      const json: Partial<DeleteUserResponse> & { error?: string } = await resp.json().catch(() => ({}));

      if (!resp.ok) {
        setErr(json.error || `Delete failed (${resp.status})`);
        setDeletingId(null);
        return;
      }

      // Remove from UI and show cleanup report
      setUsers((prev) => prev.filter((u) => u.id !== userId));
      setLastDeleted({ userId, email, cleanup: json.cleanup });
      setDeletingId(null);
    } catch (e: any) {
      setErr(e?.message ?? "Delete failed.");
      setDeletingId(null);
    }
  }

  if (!authReady) return <main style={{ padding: 24 }}>Checking login…</main>;

  return (
    <main style={{ padding: 24, maxWidth: 980 }}>
      <PageTitle>Admin — Users</PageTitle>
      <p style={{ opacity: 0.7, marginTop: -6 }}>
        View all accounts and delete users (hard delete + data cleanup).
      </p>

      <div style={{ marginTop: 12, display: "flex", gap: 12, flexWrap: "wrap" }}>
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

        {me?.email && (
          <div style={{ fontSize: 12, opacity: 0.75, alignSelf: "center" }}>
            Logged in as <b>{me.email}</b>
          </div>
        )}
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

      {lastDeleted && (
        <div
          style={{
            marginTop: 16,
            border: "1px solid #bbf7d0",
            background: "rgba(34,197,94,0.06)",
            borderRadius: 12,
            padding: 12,
          }}
        >
          <div style={{ fontWeight: 900 }}>Deleted: {lastDeleted.email ?? lastDeleted.userId}</div>
          {Array.isArray(lastDeleted.cleanup) && lastDeleted.cleanup.length > 0 ? (
            <div style={{ marginTop: 8, display: "grid", gap: 6 }}>
              {lastDeleted.cleanup.map((s, idx) => (
                <div key={idx} style={{ fontSize: 12, opacity: 0.9 }}>
                  {s.ok ? "✅" : "❌"} <b>{s.step}</b>
                  {!s.ok && s.detail ? <span style={{ opacity: 0.75 }}> — {s.detail}</span> : null}
                </div>
              ))}
            </div>
          ) : (
            <div style={{ marginTop: 8, fontSize: 12, opacity: 0.75 }}>
              (No cleanup report returned — API may not be returning `cleanup` yet.)
            </div>
          )}
        </div>
      )}

      {!loading && !err && (
        <div style={{ marginTop: 16, display: "grid", gap: 10 }}>
          {users.map((u) => {
            const isMe = me?.id === u.id;

            return (
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
                <div style={{ minWidth: 360 }}>
                  <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                    <div style={{ fontWeight: 900 }}>{u.email ?? "—"}</div>
                    {isMe && (
                      <span
                        style={{
                          fontSize: 12,
                          padding: "2px 8px",
                          borderRadius: 999,
                          border: "1px solid #bfdbfe",
                          background: "rgba(59,130,246,0.10)",
                          fontWeight: 800,
                        }}
                      >
                        You
                      </span>
                    )}
                  </div>

                  <div style={{ fontSize: 12, opacity: 0.75, marginTop: 6 }}>id: {u.id}</div>

                  <div style={{ fontSize: 12, opacity: 0.75, marginTop: 2 }}>
                    created: <b>{fmt(u.created_at)}</b>
                  </div>

                  <div style={{ fontSize: 12, opacity: 0.75, marginTop: 2 }}>
                    last sign-in: <b>{fmt(u.last_sign_in_at)}</b>
                  </div>
                </div>

                <button
                  onClick={() => onDelete(u.id, u.email)}
                  disabled={deletingId === u.id || isMe}
                  title={isMe ? "For safety, you can't delete yourself from this screen." : "Delete user"}
                  style={{
                    padding: "10px 14px",
                    borderRadius: 12,
                    border: "1px solid #ef4444",
                    background: "white",
                    color: "#ef4444",
                    fontWeight: 900,
                    cursor: deletingId === u.id || isMe ? "not-allowed" : "pointer",
                    opacity: isMe ? 0.5 : 1,
                  }}
                >
                  {deletingId === u.id ? "Deleting…" : isMe ? "Can't delete self" : "Delete"}
                </button>
              </div>
            );
          })}

          {users.length === 0 && <div style={{ opacity: 0.8 }}>No users found.</div>}
        </div>
      )}
    </main>
  );
}
