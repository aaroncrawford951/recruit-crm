"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import PageTitle from "@/app/components/PageTitle";
import { supabaseBrowser } from "@/lib/supabase-browser";
import { waitForSession } from "@/lib/waitForSession";

type InboxThreadRow = {
  recruit_id: string;
  first_name: string | null;
  last_name: string | null;
  phone: string | null;

  last_message_at: string | null;
  last_direction: "inbound" | "outbound" | null;
  last_body: string | null;

  unread_count: number;
};

export default function InboxPage() {
  const [supabase] = useState(() => supabaseBrowser());

  const [authReady, setAuthReady] = useState(false);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const [threads, setThreads] = useState<InboxThreadRow[]>([]);

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

  // ---- Load inbox threads ----
  useEffect(() => {
    if (!authReady) return;

    const load = async () => {
      setLoading(true);
      setErr(null);

      const { data, error } = await supabase
        .from("inbox_threads")
        .select("recruit_id, first_name, last_name, phone, last_message_at, last_direction, last_body, unread_count")
        .order("last_message_at", { ascending: false, nullsFirst: false })
        .limit(300);

      if (error) {
        setErr(error.message);
        setThreads([]);
      } else {
        setThreads((data as InboxThreadRow[]) ?? []);
      }

      setLoading(false);
    };

    load();
  }, [authReady, supabase]);

  if (!authReady) return <main style={{ padding: 24 }}>Checking login…</main>;

  return (
    <main style={{ padding: 24, maxWidth: 900 }}>
      <PageTitle>Inbox</PageTitle>

      <p style={{ opacity: 0.7, marginTop: -6 }}>
        Sorted by most recent activity. Threads with unread inbound messages are bold.
      </p>

      {loading && <p style={{ marginTop: 12, opacity: 0.8 }}>Loading…</p>}
      {err && <p style={{ marginTop: 12, color: "crimson" }}>{err}</p>}

      <div style={{ marginTop: 16, display: "grid", gap: 10 }}>
        {!loading &&
          !err &&
          threads.map((t) => {
            const name = `${t.first_name ?? ""} ${t.last_name ?? ""}`.trim() || "Recruit";
            const isUnread = (t.unread_count ?? 0) > 0;

            return (
              <Link
                key={t.recruit_id}
                href={`/inbox/${t.recruit_id}`}
                style={{
                  border: "1px solid #e5e5e5",
                  borderRadius: 12,
                  padding: 12,
                  textDecoration: "none",
                  color: "inherit",
                  background: isUnread ? "rgba(59,130,246,0.06)" : "white",
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center" }}>
                  <div style={{ fontWeight: isUnread ? 900 : 700 }}>
                    {name}
                    {isUnread && (
                      <span
                        style={{
                          marginLeft: 10,
                          fontSize: 12,
                          padding: "2px 8px",
                          borderRadius: 999,
                          border: "1px solid #bfdbfe",
                          background: "rgba(59,130,246,0.10)",
                          fontWeight: 800,
                        }}
                      >
                        Unread
                      </span>
                    )}
                  </div>

                  <div style={{ fontSize: 12, opacity: 0.75, fontWeight: isUnread ? 800 : 500 }}>
                    {t.last_message_at
                      ? new Date(t.last_message_at).toLocaleString("en-CA", {
                          timeZone: "America/Edmonton",
                          month: "short",
                          day: "2-digit",
                          hour: "2-digit",
                          minute: "2-digit",
                        })
                      : "—"}
                  </div>
                </div>

                <div style={{ marginTop: 6, fontSize: 12, opacity: 0.85, fontWeight: isUnread ? 700 : 400 }}>
                  {t.last_body ? t.last_body.slice(0, 120) : "No messages yet."}
                </div>

                <div style={{ marginTop: 6, fontSize: 12, opacity: 0.8 }}>
                  Phone: <b>{t.phone ?? "—"}</b>
                </div>
              </Link>
            );
          })}

        {!loading && !err && threads.length === 0 && (
          <div style={{ marginTop: 16, opacity: 0.8 }}>No messages yet.</div>
        )}
      </div>
    </main>
  );
}
