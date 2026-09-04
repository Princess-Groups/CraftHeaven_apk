import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useState } from "react";
import { Users, Plus, Trash2, Shield } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/admin/mc/users")({
  head: () => ({ meta: [{ title: "User Management — Multi-Channel" }] }),
  component: MCUserManagement,
});

const MC_ROLES = [
  { value: "admin", label: "Super Admin", desc: "Full access to all modules" },
  { value: "inventory_manager", label: "Inventory Manager", desc: "Products + Stock + Inventory" },
  { value: "purchase_manager", label: "Purchase Manager", desc: "Purchase-related functions" },
  { value: "billing_staff", label: "Billing Staff", desc: "Billing and sales" },
  { value: "accounts_staff", label: "Accounts Staff", desc: "Accounting and financial reports" },
  { value: "marketplace_manager", label: "Marketplace Manager", desc: "Amazon + Flipkart + Meesho + Orders" },
  { value: "viewer", label: "Viewer", desc: "Read-only access to reports" },
] as const;

type UserRole = {
  id: string;
  user_id: string;
  role: string;
  profiles: { full_name: string; phone: string } | null;
};

function MCUserManagement() {
  const qc = useQueryClient();
  const [showAdd, setShowAdd] = useState(false);
  const [newUser, setNewUser] = useState({ email: "", password: "", full_name: "", role: "viewer" });

  const { data: roles } = useQuery({
    queryKey: ["mc-user-roles"],
    queryFn: async () =>
      (await supabase.from("user_roles").select("*, profiles(full_name,phone)").order("role")).data ?? [],
  });

  async function addUser() {
    if (!newUser.email.trim() || !newUser.password.trim()) return toast.error("Email and password required");
    try {
      const { data, error } = await supabase.auth.admin.createUser({
        email: newUser.email,
        password: newUser.password,
        email_confirm: true,
      });
      if (error) return toast.error(error.message);
      if (data.user) {
        await supabase.from("user_roles").insert({ user_id: data.user.id, role: newUser.role });
        await supabase.from("profiles").insert({ id: data.user.id, full_name: newUser.full_name || newUser.email });
        toast.success("User created");
        setShowAdd(false);
        setNewUser({ email: "", password: "", full_name: "", role: "viewer" });
        qc.invalidateQueries({ queryKey: ["mc-user-roles"] });
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to create user");
    }
  }

  async function updateRole(userId: string, newRole: string) {
    const { error } = await supabase.from("user_roles").update({ role: newRole }).eq("user_id", userId);
    if (error) return toast.error(error.message);
    toast.success("Role updated");
    qc.invalidateQueries({ queryKey: ["mc-user-roles"] });
  }

  async function removeUser(userId: string) {
    if (!confirm("Remove this user's role?")) return;
    const { error } = await supabase.from("user_roles").delete().eq("user_id", userId);
    if (error) return toast.error(error.message);
    toast.success("User role removed");
    qc.invalidateQueries({ queryKey: ["mc-user-roles"] });
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <Users className="h-5 w-5 text-primary" />
        <h1 className="text-xl font-bold text-foreground flex-1">User Management</h1>
        <button onClick={() => setShowAdd(true)} className="flex items-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-xs font-semibold text-white hover:bg-primary/90">
          <Plus className="h-3.5 w-3.5" /> Add User
        </button>
      </div>

      {/* Role Reference */}
      <div className="rounded-xl border border-border bg-white shadow-sm p-4">
        <h2 className="text-sm font-bold text-foreground mb-2 flex items-center gap-1.5"><Shield className="h-4 w-4" /> Available Roles</h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
          {MC_ROLES.map((r) => (
            <div key={r.value} className="rounded-lg border border-border/50 p-2">
              <div className="text-[11px] font-bold text-foreground">{r.label}</div>
              <div className="text-[9px] text-muted-foreground">{r.desc}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Users Table */}
      <div className="rounded-xl border border-border bg-white shadow-sm overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-muted">
              <th className="px-3 py-2 text-[10px] font-bold uppercase text-muted-foreground text-left border-b border-border">#</th>
              <th className="px-3 py-2 text-[10px] font-bold uppercase text-muted-foreground text-left border-b border-border">Name</th>
              <th className="px-3 py-2 text-[10px] font-bold uppercase text-muted-foreground text-left border-b border-border">Phone</th>
              <th className="px-3 py-2 text-[10px] font-bold uppercase text-muted-foreground text-center border-b border-border">Role</th>
              <th className="px-3 py-2 text-[10px] font-bold uppercase text-muted-foreground text-center border-b border-border w-20">Actions</th>
            </tr>
          </thead>
          <tbody>
            {(roles ?? []).map((r, i) => (
              <tr key={r.id} className="border-b border-border/50 last:border-0 hover:bg-secondary-soft/20">
                <td className="px-3 py-2 text-xs text-muted-foreground">{i + 1}</td>
                <td className="px-3 py-2 text-xs font-semibold">{r.profiles?.full_name ?? "—"}</td>
                <td className="px-3 py-2 text-xs text-muted-foreground">{r.profiles?.phone ?? "—"}</td>
                <td className="px-3 py-2 text-center">
                  <select value={r.role} onChange={(e) => updateRole(r.user_id, e.target.value)} className="rounded border border-border px-2 py-1 text-[10px] font-semibold bg-white">
                    {MC_ROLES.map((ro) => <option key={ro.value} value={ro.value}>{ro.label}</option>)}
                  </select>
                </td>
                <td className="px-3 py-2 text-center">
                  <button onClick={() => removeUser(r.user_id)} className="rounded p-1 hover:bg-rose-50"><Trash2 className="h-3.5 w-3.5 text-rose-600" /></button>
                </td>
              </tr>
            ))}
            {(!roles || roles.length === 0) && (
              <tr><td colSpan={5} className="px-6 py-8 text-center text-xs text-muted-foreground/70">No users found</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Add User Modal */}
      {showAdd && (
        <div className="fixed inset-0 z-50 bg-black/40 grid place-items-center p-4" onClick={() => setShowAdd(false)}>
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-sm font-bold text-foreground mb-4">Add New User</h2>
            <div className="space-y-3">
              <div className="space-y-1">
                <label className="text-[11px] font-semibold text-muted-foreground uppercase">Full Name</label>
                <input value={newUser.full_name} onChange={(e) => setNewUser({ ...newUser, full_name: e.target.value })} className={inputCls} />
              </div>
              <div className="space-y-1">
                <label className="text-[11px] font-semibold text-muted-foreground uppercase">Email</label>
                <input type="email" value={newUser.email} onChange={(e) => setNewUser({ ...newUser, email: e.target.value })} className={inputCls} />
              </div>
              <div className="space-y-1">
                <label className="text-[11px] font-semibold text-muted-foreground uppercase">Password</label>
                <input type="password" value={newUser.password} onChange={(e) => setNewUser({ ...newUser, password: e.target.value })} className={inputCls} />
              </div>
              <div className="space-y-1">
                <label className="text-[11px] font-semibold text-muted-foreground uppercase">Role</label>
                <select value={newUser.role} onChange={(e) => setNewUser({ ...newUser, role: e.target.value })} className={inputCls}>
                  {MC_ROLES.map((r) => <option key={r.value} value={r.value}>{r.label} — {r.desc}</option>)}
                </select>
              </div>
            </div>
            <div className="flex justify-end gap-2 mt-4">
              <button onClick={() => setShowAdd(false)} className="rounded-lg border border-border px-4 py-2 text-xs font-semibold text-muted-foreground hover:bg-secondary-soft">Cancel</button>
              <button onClick={addUser} className="rounded-lg bg-primary px-5 py-2 text-xs font-semibold text-white hover:bg-primary/90">Create User</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const inputCls = "w-full rounded-lg border border-border bg-white px-3 py-2 text-sm outline-none focus:border-primary";
