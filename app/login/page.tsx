"use client";

import { useEffect, useRef, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase-browser";

type Mode = "login" | "signup" | "forgot";

function getReturnToFromUrl(): string {
  if (typeof window === "undefined") return "/recruits";
  const params = new URLSearchParams(window.location.search);
  const raw = params.get("returnTo");

  // basic safety: only allow internal paths
  if (!raw) return "/recruits";
  if (!raw.startsWith("/")) return "/recruits";
  if (raw.startsWith("//")) return "/recruits";
  return raw;
}

function getSiteOrigin(): string {
  if (typeof window === "undefined") return "";
  return window.location.origin;
}

function validateEmail(e: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e.trim());
}

function passwordHint(p: string) {
  const min = p.length >= 8;
  const hasLetter = /[A-Za-z]/.test(p);
  const hasNumber = /\d/.test(p);
  if (min && hasLetter && hasNumber) return "Strong enough.";
  const missing = [
    !min ? "8+ chars" : null,
    !hasLetter ? "a letter" : null,
    !hasNumber ? "a number" : null,
  ].filter(Boolean);
  return `Suggested: include ${missing.join(", ")}.`;
}

export default function LoginPage() {
  const supabaseRef = useRef(supabaseBrowser());
  const supabase = supabaseRef.current;

  const [mode, setMode] = useState<Mode>("login");
  const [returnTo, setReturnTo] = useState("/recruits");

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  // signup-only
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");

  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    setReturnTo(getReturnToFromUrl());
  }, []);

  useEffect(() => {
    let cancelled = false;

    // If already logged in, redirect
    (async () => {
      const { data } = await supabase.auth.getSession();
      if (cancelled) return;
      if (data.session) {
        window.location.assign(returnTo || "/recruits");
      }
    })();

    // Redirect whenever a session appears
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      if (cancelled) return;
      if (session) {
        window.location.assign(returnTo || "/recruits");
      }
    });

    return () => {
      cancelled = true;
      sub.subscription.unsubscribe();
    };
  }, [supabase, returnTo]);

  function resetNotices() {
    setErr(null);
    setMsg(null);
  }

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    resetNotices();

    const cleanEmail = email.trim();
    const cleanPass = password;
    const origin = getSiteOrigin();

    try {
      if (!validateEmail(cleanEmail)) {
        setErr("Please enter a valid email address.");
        return;
      }

      if (mode === "forgot") {
        if (!origin) {
          setErr("Missing site origin (try again after page loads).");
          return;
        }

        const { error } = await supabase.auth.resetPasswordForEmail(cleanEmail, {
          redirectTo: `${origin}/reset-password`,
        });

        if (error) {
          setErr(error.message);
          return;
        }

        setMsg("Password reset email sent. Check your inbox (and spam).");
        return;
      }

      if (!cleanPass) {
        setErr("Please enter a password.");
        return;
      }

      if (mode === "login") {
        const { error } = await supabase.auth.signInWithPassword({
          email: cleanEmail,
          password: cleanPass,
        });

        if (error) {
          const m = (error.message || "").toLowerCase();
          if (m.includes("email not confirmed") || m.includes("confirm")) {
            setErr(
              "Your account exists, but your email isn’t confirmed yet. Check your inbox (and spam) for the confirmation link, then try logging in again."
            );
          } else {
            setErr(error.message);
          }
          return;
        }

        window.location.assign(returnTo || "/recruits");
        return;
      }

      // SIGN UP
      const fn = firstName.trim();
      const ln = lastName.trim();

      if (!fn || !ln) {
        setErr("Please enter your first and last name.");
        return;
      }

      if (!origin) {
        setErr("Missing site origin (try again after page loads).");
        return;
      }

      const { data, error } = await supabase.auth.signUp({
        email: cleanEmail,
        password: cleanPass,
        options: {
          data: { first_name: fn, last_name: ln },
          emailRedirectTo: `${origin}/login`,
        },
      });

      if (error) {
        setErr(error.message);
        return;
      }

      // If confirmations are OFF, you'll get a session immediately
      if (data.session) {
        window.location.assign(returnTo || "/recruits");
        return;
      }

      setMsg("Account created. Check your email to confirm your account, then log in.");
      setMode("login");
      setPassword("");
      setFirstName("");
      setLastName("");
    } catch (ex: unknown) {
      const message =
        ex instanceof Error ? ex.message : "Something went wrong. Please try again.";
      setErr(message);
    } finally {
      setBusy(false);
    }
  }

  const title =
    mode === "login" ? "Login" : mode === "signup" ? "Create account" : "Reset password";

  const showPassword = mode !== "forgot";

  return (
    <main style={{ padding: 40, maxWidth: 520 }}>
      <h1 style={{ fontSize: 44, marginBottom: 18 }}>{title}</h1>

      <form onSubmit={onSubmit} style={{ display: "grid", gap: 12 }}>
        <input
          placeholder="Email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          autoComplete="email"
          inputMode="email"
          style={{
            padding: 14,
            borderRadius: 12,
            border: "1px solid #e5e7eb",
            fontSize: 18,
          }}
        />

        {mode === "signup" && (
          <>
            <input
              placeholder="First name"
              value={firstName}
              onChange={(e) => setFirstName(e.target.value)}
              required
              style={{
                padding: 14,
                borderRadius: 12,
                border: "1px solid #e5e7eb",
                fontSize: 18,
              }}
            />
            <input
              placeholder="Last name"
              value={lastName}
              onChange={(e) => setLastName(e.target.value)}
              required
              style={{
                padding: 14,
                borderRadius: 12,
                border: "1px solid #e5e7eb",
                fontSize: 18,
              }}
            />
          </>
        )}

        {showPassword && (
          <>
            <input
              placeholder="Password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete={mode === "login" ? "current-password" : "new-password"}
              style={{
                padding: 14,
                borderRadius: 12,
                border: "1px solid #e5e7eb",
                fontSize: 18,
              }}
            />
            {mode === "signup" && (
              <div style={{ fontSize: 12, opacity: 0.75, marginTop: -6 }}>
                {passwordHint(password)}
              </div>
            )}
          </>
        )}

        <button
          type="submit"
          disabled={busy}
          style={{
            padding: 14,
            borderRadius: 12,
            border: "1px solid #e5e7eb",
            background: "white",
            fontSize: 22,
            fontWeight: 800,
            cursor: busy ? "not-allowed" : "pointer",
          }}
        >
          {busy
            ? "Working…"
            : mode === "login"
            ? "Log in"
            : mode === "signup"
            ? "Create account"
            : "Send reset link"}
        </button>

        {err && <p style={{ color: "crimson", marginTop: 4 }}>{err}</p>}
        {msg && <p style={{ color: "#065f46", marginTop: 4 }}>{msg}</p>}
      </form>

      <div style={{ marginTop: 16, display: "grid", gap: 10, opacity: 0.9 }}>
        {mode !== "signup" ? (
          <button
            type="button"
            onClick={() => {
              setMode("signup");
              resetNotices();
              setFirstName("");
              setLastName("");
            }}
            style={{
              background: "transparent",
              border: "none",
              textAlign: "left",
              padding: 0,
              cursor: "pointer",
              fontWeight: 800,
              textDecoration: "underline",
              color: "#0f172a",
            }}
          >
            New here? Create an account
          </button>
        ) : (
          <button
            type="button"
            onClick={() => {
              setMode("login");
              resetNotices();
              setFirstName("");
              setLastName("");
            }}
            style={{
              background: "transparent",
              border: "none",
              textAlign: "left",
              padding: 0,
              cursor: "pointer",
              fontWeight: 800,
              textDecoration: "underline",
              color: "#0f172a",
            }}
          >
            Already have an account? Log in instead
          </button>
        )}

        {mode !== "forgot" ? (
          <button
            type="button"
            onClick={() => {
              setMode("forgot");
              resetNotices();
              setPassword("");
            }}
            style={{
              background: "transparent",
              border: "none",
              textAlign: "left",
              padding: 0,
              cursor: "pointer",
              fontWeight: 700,
              textDecoration: "underline",
              color: "#334155",
            }}
          >
            Forgot password?
          </button>
        ) : (
          <button
            type="button"
            onClick={() => {
              setMode("login");
              resetNotices();
            }}
            style={{
              background: "transparent",
              border: "none",
              textAlign: "left",
              padding: 0,
              cursor: "pointer",
              fontWeight: 700,
              textDecoration: "underline",
              color: "#334155",
            }}
          >
            Back to login
          </button>
        )}
      </div>
    </main>
  );
}
