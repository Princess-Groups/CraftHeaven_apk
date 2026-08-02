import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Lock, User as UserIcon, ShieldCheck } from "lucide-react";
import logoAsset from "@/assets/ach-logo.png.asset.json";
import { ensureAdminAccount, ADMIN_USER_ID, ADMIN_EMAIL } from "@/lib/admin-auth.functions";

export const Route = createFileRoute("/admin/login")({
  head: () => ({ meta: [{ title: "Admin Login — Athira's Creative Haven" }] }),
  component: AdminLogin,
});

function toEmail(userId: string) {
  const v = userId.trim();
  if (v.includes("@")) return v.toLowerCase();
  if (v.toUpperCase() === ADMIN_USER_ID) return ADMIN_EMAIL;
  return `${v.toLowerCase()}@ach.local`;
}

function AdminLogin() {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      const loginEmail = toEmail(email);

      // Provision the fixed ATHIRAMAM admin account on first use
      if (loginEmail === ADMIN_EMAIL) {
        try { await ensureAdminAccount(); } catch { /* fall through to sign-in */ }
      }

      const { data: signIn, error } = await supabase.auth.signInWithPassword({ email: loginEmail, password });
      if (error) throw error;
      const uid = signIn.user?.id;
      if (!uid) throw new Error("Sign-in failed");

      // Bootstrap first admin (no-op if an admin already exists)
      await supabase.rpc("bootstrap_admin");

      const { data: roles } = await supabase.from("user_roles").select("role").eq("user_id", uid);
      const allowed = roles?.some((r) => r.role === "admin" || r.role === "staff");
      if (!allowed) {
        await supabase.auth.signOut();
        toast.error("Access denied. This account is not authorized for the billing software.");
        return;
      }
      toast.success("Welcome back!");
      navigate({ to: "/admin" });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Sign-in failed";
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  }


  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-emerald-50/40 flex items-center justify-center px-4 py-10">
      <div className="w-full max-w-md">
        <div className="rounded-3xl bg-white shadow-xl border border-slate-200/70 overflow-hidden">
          <div className="bg-gradient-to-br from-secondary/90 to-primary/90 px-6 py-8 text-center text-white">
            <img src={logoAsset.url} alt="ACH" className="mx-auto h-14 w-14 rounded-full ring-2 ring-white/60 shadow-lg" />
            <h1 className="mt-3 font-display text-xl font-bold">Billing Software</h1>
            <p className="mt-1 text-xs opacity-90">Athira's Creative Haven — Admin Portal</p>
          </div>
          <form onSubmit={onSubmit} className="p-6 space-y-4">
            <div className="flex items-center gap-2 rounded-full bg-emerald-50 border border-emerald-100 px-3 py-2 text-[11px] text-emerald-800">
              <ShieldCheck className="h-3.5 w-3.5" /> Secure staff & admin access only
            </div>
            <label className="block">
              <span className="text-xs font-semibold text-slate-600">User ID</span>
              <div className="mt-1 flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2.5 focus-within:border-secondary">
                <UserIcon className="h-4 w-4 text-slate-400" />
                <input type="text" required autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)}
                  placeholder="ATHIRAMAM"
                  className="flex-1 bg-transparent text-sm outline-none" />

              </div>
            </label>
            <label className="block">
              <span className="text-xs font-semibold text-slate-600">Password</span>
              <div className="mt-1 flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2.5 focus-within:border-secondary">
                <Lock className="h-4 w-4 text-slate-400" />
                <input type="password" required autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••" className="flex-1 bg-transparent text-sm outline-none" />
              </div>
            </label>
            <button type="submit" disabled={loading}
              className="w-full rounded-xl bg-slate-900 py-3 text-sm font-semibold text-white shadow hover:bg-slate-800 disabled:opacity-60">
              {loading ? "Signing in…" : "Sign In"}
            </button>
            <p className="text-center text-[11px] text-slate-500">
              Use your staff <span className="font-semibold">User ID</span> (e.g. ATHIRAMAM) or your registered email.
            </p>

            <Link to="/" className="block text-center text-[11px] text-slate-400 hover:text-slate-600">← Back to store</Link>
          </form>
        </div>
      </div>
    </div>
  );
}
