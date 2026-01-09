"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import PageTitle from "@/app/components/PageTitle";
import { supabaseBrowser } from "@/lib/supabase-browser";
import { waitForSession } from "@/lib/waitForSession";

type InboxThreadRow = {
  recruit_id: string;
  owner_user_id: string;
  first_name: string | null;
  last_name: string | null;
  phone: string | null;

  last_message_at: string | null;
  last_message_body: string | null;

  is_unread: boolean | null;
};

function formatName(first: string | null, last: string | null) {
  const name = `${first ?? ""} ${last ?? ""}`.trim();
  return name || "Recruit";
}

function formatTimestamp(iso: string | null) {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString("en-CA", {
      timeZone: "America/Edmonton",
      month: "short",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return "—";
  }
}

export default function InboxPage() {
  const [supabase] = useState(() => supabaseBrowser());

  const [authReady, setAuthReady] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);

  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [threads, setThreads] = useState<InboxThreadRow[]>([]);

  // avoids spam-refresh if multiple messages arrive quickly
  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const loadThreads = async () => {
    setErr(null);

    const { data, error } = await supabase
      .from("inbox_threads")
      .select(
        "recruit_id, owner_user_id, first_name, last_name, phone, last_message_at, last_message_body, is_unread"
      )
      .order("last_message_at", { ascending: false })
      .limit(300);

    if (error) {
      setErr(error.message);
      setThreads([]);
      return;
    }

    setThreads((data as InboxThreadRow[]) ?? []);
  };

  const scheduleRefresh = () => {
    if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
    refreshTimerRef.current = setTimeout(() => {
      loadThreads();
    }, 250); // small debounce to batch multiple inserts
  };

  // ---- Auth guard + initial load ----
  useEffect(() => {
    let cancelled = false;

    const run = async () => {
      setLoading(true);

      const session = await waitForSession(supabase, 1500);
      if (cancelled) return;

      if (!session) {
        const returnTo = window.location.pathname + window.location.search;
        window.location.href = `/login?returnTo=${encodeURIComponent(returnTo)}`;
        return;
      }

      setUserId(session.user.id);
      setAuthReady(true);

      await loadThreads();
      setLoading(false);
    };

    run();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [supabase]);

  // ---- Realtime: refresh inbox when new messages arrive ----
  useEffect(() => {
    if (!authReady || !userId) return;

    // Subscribe to messages INSERT for this user.
    // When inbound webhook inserts a message row, we refresh inbox_threads.
    const channel = supabase
      .channel(`inbox-messages-${userId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "messages",
          filter: `owner_user_id=eq.${userId}`,
        },
        (_payload) => {
          scheduleRefresh();
        }
      )
      .subscribe((status) => {
        // Optional: helpful for debugging realtime connection
        // console.log("[realtime] inbox channel status:", status);
      });

    return () => {
      if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
      supabase.removeChannel(channel);
    };
  }, [authReady, userId, supabase]);

  // Optional: keep it fresh when tab refocuses
  useEffect(() => {
    if (!authReady) return;

    const onFocus = () => loadThreads();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authReady]);

  if (!authReady) return <main style={{ padding: 24 }}>Checking login…</main>;

  return (
    <main style={{ padding: 24, maxWidth: 900 }}>
      <PageTitle>Inbox</PageTitle>

      <p style={{ opacity: 0.7, marginTop: -6 }}>
        Live updates enabled. New inbound messages will bump the thread to the top.
      </p>

      {loading && <p style={{ marginTop: 12, opacity: 0.8 }}>Loading…</p>}
      {err && <p style={{ marginTop: 12, color: "crimson" }}>{err}</p>}

      <div style={{ marginTop: 16, display: "grid", gap: 10 }}>
        {!loading &&
          !err &&
          threads.map((t) => {
            const name = formatName(t.first_name, t.last_name);
            const isUnread = !!t.is_unread;

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
                    {formatTimestamp(t.last_message_at)}
                  </div>
                </div>

                <div style={{ marginTop: 6, fontSize: 12, opacity: 0.85, fontWeight: isUnread ? 700 : 400 }}>
                  {t.last_message_body ? t.last_message_body.slice(0, 120) : "No messages yet."}
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
