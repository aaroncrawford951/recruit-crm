import type { NextApiRequest, NextApiResponse } from "next";
import { createClient } from "@supabase/supabase-js";

function parseAdminEmails(): string[] {
  const raw = process.env.NEXT_PUBLIC_ADMIN_EMAILS || "";
  return raw
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

function getBearer(req: NextApiRequest): string | null {
  const h = req.headers.authorization || "";
  const m = h.match(/^Bearer\s+(.+)$/i);
  return m ? m[1] : null;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    const adminEmails = parseAdminEmails();
    if (adminEmails.length === 0) {
      return res.status(500).json({
        error: "Admin is not configured. Add NEXT_PUBLIC_ADMIN_EMAILS in .env.local (comma-separated).",
      });
    }

    const token = getBearer(req);
    if (!token) return res.status(401).json({ error: "Missing Authorization Bearer token" });

    // 1) Verify requester using anon key (safe)
    const supabaseAnon = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    );

    const { data: userData, error: userErr } = await supabaseAnon.auth.getUser(token);
    if (userErr || !userData?.user?.email) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const requesterEmail = userData.user.email.toLowerCase();
    if (!adminEmails.includes(requesterEmail)) {
      return res.status(403).json({ error: "Forbidden (not an admin)" });
    }

    // 2) Admin actions via service role
    const supabaseAdmin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    if (req.method === "GET") {
      const { data, error } = await supabaseAdmin.auth.admin.listUsers({ page: 1, perPage: 200 });
      if (error) return res.status(500).json({ error: error.message });

      // Keep response small / useful
      const users = (data?.users ?? []).map((u) => ({
        id: u.id,
        email: u.email,
        created_at: u.created_at,
        last_sign_in_at: (u as any).last_sign_in_at ?? null,
      }));

      return res.status(200).json({ users });
    }

    if (req.method === "DELETE") {
      const { userId } = req.body ?? {};
      if (!userId) return res.status(400).json({ error: "Missing userId" });

      // Purge app data first
      const { error: purgeErr } = await supabaseAdmin.rpc("admin_purge_user_data", { p_user_id: userId });
      if (purgeErr) return res.status(500).json({ error: purgeErr.message });

      // Then delete auth user
      const { error: delErr } = await supabaseAdmin.auth.admin.deleteUser(userId);
      if (delErr) return res.status(500).json({ error: delErr.message });

      return res.status(200).json({ ok: true });
    }

    return res.status(405).json({ error: "Method not allowed" });
  } catch (e: any) {
    return res.status(500).json({ error: e?.message ?? "Server error" });
  }
}
