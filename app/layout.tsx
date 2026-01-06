'use client'

import Link from "next/link";
import { supabaseBrowser } from "@/lib/supabase-browser";
import "./globals.css";

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const supabase = supabaseBrowser();

  async function handleLogout() {
    await supabase.auth.signOut();
    window.location.href = "/login";
  }

  return (
    <html lang="en">
      <body>
        <nav
          style={{
            padding: 16,
            background: "#0f172a",
            borderBottom: "1px solid #020617",
            display: "flex",
            gap: 24,
            alignItems: "center",
            justifyContent: "space-between",
            flexWrap: "wrap",
          }}
        >
          {/* Left side: logo + links */}
          <div style={{ display: "flex", gap: 16, alignItems: "center", flexWrap: "wrap" }}>
            <Link href="/recruits" style={{ display: "flex", alignItems: "center" }}>
              <img
                src="/logo.png"
                alt="Company Logo"
                style={{ height: 32, width: "auto" }}
              />
            </Link>

            <Link href="/recruits" style={{ color: "white", textDecoration: "none" }}>Recruits
            </Link>
            <Link href="/stages" style={{ color: "white", textDecoration: "none" }}>
              Stages
            </Link>
            <Link href="/templates" style={{ color: "white", textDecoration: "none" }}>
              Templates
            </Link>
            <Link href="/sequences" style={{ color: "white", textDecoration: "none" }}>
              Sequences
            </Link>
             <Link href="/follow-ups" style={{ color: "white", textDecoration: "none" }}>
              Follow-ups
            </Link>
            <Link href="/inbox" style={{ color: "white", textDecoration: "none" }}>
              Inbox
            </Link>
          </div>

          {/* Right side: logout */}
          <button
            onClick={handleLogout}
            style={{
              background: "transparent",
              color: "white",
              border: "1px solid #475569",
              borderRadius: 8,
              padding: "6px 12px",
              cursor: "pointer",
              fontWeight: 600,
            }}
          >
            Log out
          </button>
        </nav>

        <main
          style={{
            padding: 16,
            background: "white",
            color: "#111827",
          }}
        >
          {children}
        </main>
      </body>
    </html>
  );
}
