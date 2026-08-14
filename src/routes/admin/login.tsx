import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Lock, User as UserIcon, ShieldCheck, KeyRound, Loader2 } from "lucide-react";
const logoUrl = "/ach-logo.png";
import { ensureAdminAccount, createAdminAccount, ADMIN_USER_ID, ADMIN_EMAIL } from "@/lib/admin-auth.functions";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";

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
  const [tab, setTab] = useState<"signin" | "create">("signin");

  // Create-admin form state
  const [newEmail, setNewEmail] = useState("");
  const [newUsername, setNewUsername] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [masterPassword, setMasterPassword] = useState("");
  const [creating, setCreating] = useState(false);

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

  async function onCreateAdmin(e: React.FormEvent) {
    e.preventDefault();
    setCreating(true);
    try {
      const result = await createAdminAccount({ data: {
        email: newEmail,
        username: newUsername,
        password: newPassword,
        masterPassword,
      }});
      if (result.ok) {
        toast.success("Admin account created!");
        setNewEmail(""); setNewUsername(""); setNewPassword(""); setMasterPassword("");
        setTab("signin");
        setEmail(newEmail);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Could not create admin account";
      toast.error(msg);
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-emerald-50/40 flex items-center justify-center px-4 py-10">
      <div className="w-full max-w-md">
        <div className="rounded-3xl bg-white shadow-xl border border-slate-200/70 overflow-hidden">
          <div className="bg-gradient-to-br from-secondary/90 to-primary/90 px-6 py-8 text-center text-white">
            <img src={logoUrl} alt="ACH" className="mx-auto h-14 w-14 rounded-full ring-2 ring-white/60 shadow-lg" />
            <h1 className="mt-3 font-display text-xl font-bold">Billing Software</h1>
            <p className="mt-1 text-xs opacity-90">Athira's Creative Haven — Admin Portal</p>
          </div>

          <Tabs value={tab} onValueChange={(v) => setTab(v as "signin" | "create")} className="p-6 pt-4">
            <TabsList className="grid w-full grid-cols-2 rounded-xl bg-slate-100 p-1">
              <TabsTrigger value="signin" className="rounded-lg text-xs font-semibold data-[state=active]:bg-white data-[state=active]:shadow">Sign In</TabsTrigger>
              <TabsTrigger value="create" className="rounded-lg text-xs font-semibold data-[state=active]:bg-white data-[state=active]:shadow">Create Admin</TabsTrigger>
            </TabsList>

            <TabsContent value="signin" className="mt-5 space-y-4">
              <div className="flex items-center gap-2 rounded-full bg-emerald-50 border border-emerald-100 px-3 py-2 text-[11px] text-emerald-800">
                <ShieldCheck className="h-3.5 w-3.5" /> Secure staff & admin access only
              </div>
              <form onSubmit={onSubmit} className="space-y-4">
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
              </form>
              <p className="text-center text-[11px] text-slate-500">
                Use your staff <span className="font-semibold">User ID</span> (e.g. ATHIRAMAM) or your registered email.
              </p>
            </TabsContent>

            <TabsContent value="create" className="mt-5">
              <form onSubmit={onCreateAdmin} className="space-y-3">
                <div className="flex items-center gap-2 rounded-full bg-primary/10 border border-primary/20 px-3 py-2 text-[11px] text-slate-700">
                  <KeyRound className="h-3.5 w-3.5 text-primary" /> Create a new admin — requires the main admin password
                </div>
                <label className="block">
                  <span className="text-xs font-semibold text-slate-600">Full name / Username</span>
                  <div className="mt-1 flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2.5 focus-within:border-secondary">
                    <UserIcon className="h-4 w-4 text-slate-400" />
                    <input type="text" required value={newUsername} onChange={(e) => setNewUsername(e.target.value)}
                      placeholder="e.g. ATHIRAMAM" className="flex-1 bg-transparent text-sm outline-none" />
                  </div>
                </label>
                <label className="block">
                  <span className="text-xs font-semibold text-slate-600">Email</span>
                  <div className="mt-1 flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2.5 focus-within:border-secondary">
                    <UserIcon className="h-4 w-4 text-slate-400" />
                    <input type="email" required value={newEmail} onChange={(e) => setNewEmail(e.target.value)}
                      placeholder="admin@athiras.com" className="flex-1 bg-transparent text-sm outline-none" />
                  </div>
                </label>
                <label className="block">
                  <span className="text-xs font-semibold text-slate-600">Password</span>
                  <div className="mt-1 flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2.5 focus-within:border-secondary">
                    <Lock className="h-4 w-4 text-slate-400" />
                    <input type="password" required value={newPassword} onChange={(e) => setNewPassword(e.target.value)}
                      placeholder="Min 6 characters" className="flex-1 bg-transparent text-sm outline-none" />
                  </div>
                </label>
                <label className="block">
                  <span className="text-xs font-semibold text-slate-600">Main admin password</span>
                  <div className="mt-1 flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2.5 focus-within:border-secondary">
                    <KeyRound className="h-4 w-4 text-slate-400" />
                    <input type="password" required value={masterPassword} onChange={(e) => setMasterPassword(e.target.value)}
                      placeholder="Main admin password" className="flex-1 bg-transparent text-sm outline-none" />
                  </div>
                </label>
                <button type="submit" disabled={creating}
                  className="w-full rounded-xl bg-secondary py-3 text-sm font-semibold text-white shadow hover:opacity-90 disabled:opacity-60">
                  {creating ? (<><Loader2 className="mr-2 inline h-4 w-4 animate-spin" /> Creating…</>) : "Create Admin Account"}
                </button>
              </form>
            </TabsContent>
          </Tabs>

          <div className="px-6 pb-6">
            <Link to="/" className="block text-center text-[11px] text-slate-400 hover:text-slate-600">← Back to store</Link>
          </div>
        </div>
      </div>
    </div>
  );
}
