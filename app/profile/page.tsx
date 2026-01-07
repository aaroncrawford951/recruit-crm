"use client";

import { useEffect, useState } from "react";
import PageTitle from "@/app/components/PageTitle";
import { supabaseBrowser } from "@/lib/supabase-browser";
import { waitForSession } from "@/lib/waitForSession";

type ProfileRow = {
  id: string;
  first_name: string | null;
  last_name: string | null;
};

export default function ProfilePage() {
  const [supabase] = useState(() => supabaseBrowser());

  const [authReady, setAuthReady] = useState(false);
  const [loading, setLoading] = useState(true);

  const [email, setEmail] = useState<string>("");
  const [userId, setUserId] = useState<string>("");

  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");

  const [newPassword, setNewPassword] = useState("");

  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // ---- Auth guard ----
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

  // ---- Load profile ----
  useEffect(() => {
    if (!authReady) return;

    const load = async () => {
      setLoading(true);
      setErr(null);
      setMsg(null);

      const { data: u } = await supabase.auth.getUser();
      const user = u.user;

      if (!user) {
        window.location.href = "/login";
        return;
      }

      setEmail(user.email ?? "");
      setUserId(user.id);

      // Try loading profiles row (if table/policies aren’t ready yet, we won’t hard-fail)
      const p = await supabase
        .from("profiles")
        .select("id, first_name, last_name")
        .eq("id", user.id)
        .maybeSingle();

      if (!p.error && p.data) {
        const row = p.data as ProfileRow;
        setFirstName(row.first_name ?? "");
        setLastName(row.last_name ?? "");
      }

      setLoading(false);
    };

    load();
  }, [authReady, supabase]);

  async function saveNames() {
    if (!userId) return;

    setSaving(true);
    setErr(null);
    setMsg(null);

    const { error } = await supabase.from("profiles").upsert({
      id: userId,
      first_name: firstName.trim(),
      last_name: lastName.trim(),
    });

    if (error) {
      setErr(error.message);
      setSaving(false);
      return;
    }

    setMsg("Saved.");
    setSaving(false);
    setTimeout(() => setMsg(null), 1200);
  }

  async function changePassword() {
    if (!newPassword.trim()) {
      setErr("Enter a new password.");
      return;
    }
    if (newPassword.trim().length < 8) {
      setErr("Password must be at least 8 characters.");
      return;
    }

    setSaving(true);
    setErr(null);
    setMsg(null);

    const { error } = await supabase.auth.updateUser({
      password: newPassword.trim(),
    });

    if (error) {
      setErr(error.message);
      setSaving(false);
      return;
    }

    setNewPassword("");
    setMsg("Password updated.");
    setSaving(false);
    setTimeout(() => setMsg(null), 1400);
  }

  if (!authReady) return <main style={{ padding: 24 }}>Checking login…</main>;
  if (loading) return <main style={{ padding: 24 }}>Loading…</main>;

  return (
    <main style={{ padding: 24, maxWidth: 700 }}>
      <PageTitle>Profile</PageTitle>

      <p style={{ opacity: 0.75, marginTop: -6 }}>
        This is the sender identity used for templates and outbound SMS.
      </p>

      {err && <p style={{ color: "crimson", marginTop: 12 }}>{err}</p>}
      {msg && <p style={{ color: "#065f46", marginTop: 12 }}>{msg}</p>}

      {/* Email (read-only) */}
      <div style={{ marginTop: 16, border: "1px solid #e5e5e5", borderRadius: 12, padding: 12 }}>
        <div style={{ fontWeight: 800, marginBottom: 8 }}>Account</div>

        <div style={{ fontSize: 14, opacity: 0.8 }}>Email</div>
        <div style={{ marginTop: 4, fontWeight: 700 }}>{email || "—"}</div>
      </div>

      {/* Names */}
      <div style={{ marginTop: 12, border: "1px solid #e5e5e5", borderRadius: 12, padding: 12 }}>
        <div style={{ fontWeight: 800, marginBottom: 8 }}>Sender name</div>

        <div style={{ display: "grid", gap: 10 }}>
          <div>
            <div style={{ fontSize: 14, opacity: 0.8 }}>First name</div>
            <input
              value={firstName}
              onChange={(e) => setFirstName(e.target.value)}
              placeholder="First name"
              style={{
                width: "100%",
                padding: 12,
                borderRadius: 12,
                border: "1px solid #e5e5e5",
                marginTop: 6,
              }}
            />
          </div>

          <div>
            <div style={{ fontSize: 14, opacity: 0.8 }}>Last name</div>
            <input
              value={lastName}
              onChange={(e) => setLastName(e.target.value)}
              placeholder="Last name"
              style={{
                width: "100%",
                padding: 12,
                borderRadius: 12,
                border: "1px solid #e5e5e5",
                marginTop: 6,
              }}
            />
          </div>

          <div style={{ display: "flex", justifyContent: "flex-end" }}>
            <button
              onClick={saveNames}
              disabled={saving}
              style={{
                padding: "10px 14px",
                borderRadius: 12,
                border: "1px solid #e5e5e5",
                background: "white",
                fontWeight: 800,
                cursor: saving ? "not-allowed" : "pointer",
              }}
            >
              {saving ? "Saving…" : "Save name"}
            </button>
          </div>
        </div>
      </div>

      {/* Password */}
      <div style={{ marginTop: 12, border: "1px solid #e5e5e5", borderRadius: 12, padding: 12 }}>
        <div style={{ fontWeight: 800, marginBottom: 8 }}>Password</div>

        <div style={{ display: "grid", gap: 10 }}>
          <input
            type="password"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            placeholder="New password (8+ characters)"
            style={{
              width: "100%",
              padding: 12,
              borderRadius: 12,
              border: "1px solid #e5e5e5",
            }}
          />

          <div style={{ display: "flex", justifyContent: "flex-end" }}>
            <button
              onClick={changePassword}
              disabled={saving}
              style={{
                padding: "10px 14px",
                borderRadius: 12,
                border: "1px solid #e5e5e5",
                background: "white",
                fontWeight: 800,
                cursor: saving ? "not-allowed" : "pointer",
              }}
            >
              {saving ? "Updating…" : "Update password"}
            </button>
          </div>

          <div style={{ fontSize: 12, opacity: 0.7 }}>
            Note: For security, the app can’t show your current password. You can only set a new one.
          </div>
        </div>
      </div>
    </main>
  );
}
