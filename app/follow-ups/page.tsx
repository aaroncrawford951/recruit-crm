"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase-browser";
import { waitForSession } from "../../lib/waitForSession";
import PageTitle from "@/app/components/PageTitle";

type FollowUpStatus = "scheduled" | "cancelled" | "sent";

type FollowUpRow = {
  id: string;
  scheduled_for: string;
  status: FollowUpStatus;
  recruits?: { id: string; first_name: string | null; last_name: string | null } | null;
  stages?: { name: string | null } | null;
  message_templates?: { title: string | null } | null;
};

export default function FollowUpsPage() {
  const router = useRouter();

  // keep a stable client instance
  const [supabase] = useState(() => supabaseBrowser());

  const [authReady, setAuthReady] = useState(false);

  const [followUps, setFollowUps] = useState<FollowUpRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [statusFilter, setStatusFilter] = useState<"scheduled" | "cancelled" | "all">("scheduled");
  const [hidePast, setHidePast] = useState(true);

  // ---- Auth guard (waits for session restore; prevents loop) ----
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

  // ---- Load follow-ups ----
  useEffect(() => {
    if (!authReady) return;

    const load = async () => {
      setLoading(true);
      setError(null);

      let query = supabase
        .from("follow_ups")
        .select(
          `
          id,
          scheduled_for,
          status,
          recruits:recruit_id ( id, first_name, last_name ),
          stages:stage_id ( name ),
          message_templates:template_id ( title )
        `
        )
        .order("scheduled_for", { ascending: true })
        .limit(400);

      if (statusFilter !== "all") {
        query = query.eq("status", statusFilter);
      }

      if (hidePast && statusFilter === "scheduled") {
        query = query.gte("scheduled_for", new Date().toISOString());
      }

      const { data, error } = await query;

      if (error) {
        setError(error.message);
        setFollowUps([]);
      } else {
        setFollowUps((data as any) ?? []);
      }

      setLoading(false);
    };

    load();
  }, [authReady, statusFilter, hidePast, supabase]);

  const header = useMemo(() => {
    return statusFilter === "scheduled"
      ? "Upcoming Follow-ups"
      : statusFilter === "cancelled"
      ? "Cancelled Follow-ups"
      : "All Follow-ups";
  }, [statusFilter]);

  if (!authReady) {
    return <main style={{ padding: 24 }}>Checking login…</main>;
  }

  return (
    <main style={{ padding: 24 }}>
<PageTitle>Follow-ups</PageTitle>
      <p style={{ opacity: 0.7, marginTop: 8 }}>
        Scheduled follow-ups generated from stage sequences. (SMS sending via cron.)
      </p>

      {/* Filters */}
      <div style={{ marginTop: 12, display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
        <div style={{ display: "flex", gap: 8 }}>
          <button
            onClick={() => setStatusFilter("scheduled")}
            style={{
              padding: "6px 10px",
              borderRadius: 10,
              border: "1px solid #e5e5e5",
              background: "white",
              fontWeight: statusFilter === "scheduled" ? 800 : 500,
              cursor: "pointer",
            }}
          >
            Scheduled
          </button>
          <button
            onClick={() => setStatusFilter("cancelled")}
            style={{
              padding: "6px 10px",
              borderRadius: 10,
              border: "1px solid #e5e5e5",
              background: "white",
              fontWeight: statusFilter === "cancelled" ? 800 : 500,
              cursor: "pointer",
            }}
          >
            Cancelled
          </button>
          <button
            onClick={() => setStatusFilter("all")}
            style={{
              padding: "6px 10px",
              borderRadius: 10,
              border: "1px solid #e5e5e5",
              background: "white",
              fontWeight: statusFilter === "all" ? 800 : 500,
              cursor: "pointer",
            }}
          >
            All
          </button>
        </div>

        <label style={{ display: "flex", gap: 8, alignItems: "center", opacity: 0.9 }}>
          <input type="checkbox" checked={hidePast} onChange={(e) => setHidePast(e.target.checked)} />
          Hide past (scheduled only)
        </label>

        <button
          onClick={() => router.refresh?.()}
          style={{
            padding: "6px 10px",
            borderRadius: 10,
            border: "1px solid #e5e5e5",
            background: "white",
            cursor: "pointer",
          }}
        >
          Refresh page
        </button>
      </div>

      {loading && <p style={{ marginTop: 12, opacity: 0.8 }}>Loading…</p>}
      {error && <p style={{ marginTop: 12, color: "crimson" }}>{error}</p>}

      <div style={{ marginTop: 16, display: "grid", gap: 10 }}>
        {!loading &&
          !error &&
          followUps.map((fu: any) => {
            const r = fu.recruits;
            const s = fu.stages;
            const t = fu.message_templates;

            return (
              <div
                key={fu.id}
                style={{
                  border: "1px solid #e5e5e5",
                  borderRadius: 12,
                  padding: 12,
                  opacity: fu.status === "cancelled" ? 0.55 : 1,
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
                  <div style={{ fontWeight: 700 }}>
                    <Link href={`/recruits/${r?.id ?? ""}`} style={{ textDecoration: "underline" }}>
                      {r?.first_name ?? ""} {r?.last_name ?? ""}
                    </Link>
                  </div>

                  <div style={{ opacity: 0.85 }}>
                    {fu.scheduled_for
                      ? new Date(fu.scheduled_for).toLocaleString("en-CA", {
                          timeZone: "America/Edmonton",
                          year: "numeric",
                          month: "short",
                          day: "2-digit",
                          hour: "2-digit",
                          minute: "2-digit",
                        })
                      : "—"}
                  </div>
                </div>

                <div style={{ marginTop: 6, opacity: 0.9 }}>
                  Status: <b>{fu.status}</b> • Stage: <b>{s?.name ?? "—"}</b> • Template:{" "}
                  <b>{t?.title ?? "—"}</b>
                </div>
              </div>
            );
          })}

        {!loading && !error && followUps.length === 0 && (
          <div style={{ marginTop: 16, opacity: 0.8 }}>
            No follow-ups match your filters. Try switching to <b>All</b> and/or unchecking <b>Hide past</b>.
          </div>
        )}
      </div>
    </main>
  );
}
