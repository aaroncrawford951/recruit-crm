"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { supabase } from "@/lib/supabase";

type MessageRow = {
  id: string;
  recruit_id: string;
  direction: "inbound" | "outbound";
  body: string;
  created_at: string;
  from_phone: string | null;
  to_phone: string | null;
  read_at?: string | null;
};

type RecruitRow = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  phone: string | null;
};

export default function InboxThreadPage() {
  const router = useRouter();
  const params = useParams();
  const recruitId = (params?.recruitId as string) || "";

  const [recruit, setRecruit] = useState<RecruitRow | null>(null);
  const [messages, setMessages] = useState<MessageRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);

  const title = useMemo(() => {
    const n = `${recruit?.first_name ?? ""} ${recruit?.last_name ?? ""}`.trim();
    return n || "Recruit";
  }, [recruit]);

  const loadThread = async () => {
    setLoading(true);
    setErr(null);

    // ---- Auth guard ----
    const { data: sess } = await supabase.auth.getSession();
    if (!sess.session) {
      const returnTo = window.location.pathname + window.location.search;
      window.location.href = `/login?returnTo=${encodeURIComponent(returnTo)}`;
      return;
    }

    // ✅ STEP 4 GOES HERE:
    // Mark all unread inbound messages in this thread as "read"
    await supabase
      .from("messages")
      .update({ read_at: new Date().toISOString() })
      .eq("recruit_id", recruitId)
      .eq("direction", "inbound")
      .is("read_at", null);

    // ---- Load recruit ----
    const r = await supabase
      .from("recruits")
      .select("id, first_name, last_name, phone")
      .eq("id", recruitId)
      .single();

    if (r.error) {
      setErr(r.error.message);
      setLoading(false);
      return;
    }
    setRecruit(r.data as any);

    // ---- Load messages ----
    const m = await supabase
      .from("messages")
      .select("id, recruit_id, direction, body, created_at, from_phone, to_phone, read_at")
      .eq("recruit_id", recruitId)
      .order("created_at", { ascending: true })
      .limit(500);

    if (m.error) {
      setErr(m.error.message);
      setLoading(false);
      return;
    }

    setMessages((m.data as any) ?? []);
    setLoading(false);
  };

  useEffect(() => {
    if (!recruitId) return;
    loadThread();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recruitId]);

  const onSend = async () => {
    if (!draft.trim()) return;
    if (!recruit?.phone) {
      alert("This recruit has no phone number.");
      return;
    }

    setSending(true);

    // Get access token for API auth
    const { data: sess } = await supabase.auth.getSession();
    const token = sess.session?.access_token;

    if (!token) {
      alert("Not logged in.");
      setSending(false);
      return;
    }

    const text = draft.trim();

    const resp = await fetch("/api/messages/send", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ recruitId, body: text }),
    });

    const json = await resp.json();

    if (!resp.ok) {
      alert(json.error || "Failed to send");
      setSending(false);
      return;
    }

    setDraft("");
    await loadThread();
    setSending(false);
  };

  if (loading) return <div style={{ padding: 24 }}>Loading…</div>;
  if (err) return <div style={{ padding: 24, color: "crimson" }}>{err}</div>;

  return (
    <div style={{ padding: 24, maxWidth: 900 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <button onClick={() => router.push("/inbox")} style={{ cursor: "pointer" }}>
          ← Back
        </button>

        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 22, fontWeight: 800 }}>{title}</div>
          <div style={{ opacity: 0.7, marginTop: 2 }}>
            Phone: {recruit?.phone ?? "—"} •{" "}
            <Link href={`/recruits/${recruitId}`} style={{ textDecoration: "underline" }}>
              View recruit
            </Link>
          </div>
        </div>
      </div>

      {/* Thread */}
      <div style={{ marginTop: 16, border: "1px solid #e5e5e5", borderRadius: 12, padding: 12 }}>
        {messages.length === 0 ? (
          <div style={{ opacity: 0.75 }}>No messages yet.</div>
        ) : (
          <div style={{ display: "grid", gap: 10 }}>
            {messages.map((msg) => {
              const isOut = msg.direction === "outbound";
              return (
                <div
                  key={msg.id}
                  style={{
                    display: "flex",
                    justifyContent: isOut ? "flex-end" : "flex-start",
                  }}
                >
                  <div
                    style={{
                      maxWidth: "75%",
                      border: "1px solid #e5e5e5",
                      borderRadius: 12,
                      padding: 10,
                      background: "white",
                      opacity: 0.95,
                    }}
                  >
                    <div style={{ fontSize: 12, opacity: 0.7, marginBottom: 4 }}>
                      {isOut ? "You" : "Them"} •{" "}
                      {new Date(msg.created_at).toLocaleString("en-CA", {
                        timeZone: "America/Edmonton",
                        year: "numeric",
                        month: "short",
                        day: "2-digit",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </div>
                    <div style={{ whiteSpace: "pre-wrap" }}>{msg.body}</div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Reply box */}
      <div style={{ marginTop: 12, display: "grid", gap: 8 }}>
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Type a message…"
          rows={3}
          style={{
            width: "100%",
            border: "1px solid #e5e5e5",
            borderRadius: 12,
            padding: 10,
            resize: "vertical",
          }}
          onKeyDown={(e) => {
            // Cmd/Ctrl + Enter to send
            if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
              e.preventDefault();
              onSend();
            }
          }}
        />
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
          <div style={{ fontSize: 12, opacity: 0.7 }}>Tip: Cmd/Ctrl + Enter to send</div>
          <button
            onClick={onSend}
            disabled={sending || !draft.trim()}
            style={{
              padding: "8px 12px",
              borderRadius: 12,
              border: "1px solid #e5e5e5",
              background: "white",
              cursor: sending ? "not-allowed" : "pointer",
              fontWeight: 700,
            }}
          >
            {sending ? "Sending…" : "Send"}
          </button>
        </div>
      </div>
    </div>
  );
}
