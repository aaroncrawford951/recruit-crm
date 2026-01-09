"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase-browser";
import "./globals.css";

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const supabase = supabaseBrowser();

  async function handleLogout() {
    await supabase.auth.signOut();
    router.push("/login");
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
            alignItems: "center",
            gap: 16,
            flexWrap: "wrap",
          }}
        >
          {/* Logo */}
          <Link href="/recruits" style={{ display: "flex", alignItems: "center" }}>
            <img src="/logo.png" alt="Company Logo" style={{ height: 32 }} />
          </Link>

          {/* Main nav */}
          <div style={{ display: "flex", gap: 16, alignItems: "center", flexWrap: "wrap" }}>
            <Link href="/recruits" style={{ color: "white", textDecoration: "none" }}>
              Recruits
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

          {/* Right side: Logout + Profile */}
{/* Right side: Profile + Logout */}
<div
  style={{
    marginLeft: "auto",
    display: "flex",
    gap: 14,
    alignItems: "center",
  }}
>
  <Link
    href="/profile"
    style={{
      color: "white",
      textDecoration: "none",
      fontWeight: 800,
    }}
  >
    Profile
  </Link>

  <button
    onClick={handleLogout}
    style={{
      background: "transparent",
      border: "1px solid rgba(255,255,255,0.3)",
      color: "white",
      padding: "6px 12px",
      borderRadius: 10,
      fontWeight: 700,
      cursor: "pointer",
    }}
  >
    Log out
  </button>
</div>

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
