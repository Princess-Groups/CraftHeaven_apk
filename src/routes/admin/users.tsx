import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useState } from "react";
import { toast } from "sonner";
import {
  ShieldCheck,
  User,
  Plus,
  Edit3,
  Trash2,
  X,
  Check,
  Eye,
  EyeOff,
  UserPlus,
  Users as UsersIcon,
} from "lucide-react";

export const Route = createFileRoute("/admin/users")({
  head: () => ({ meta: [{ title: "Users / Staff — ACH Admin" }] }),
  component: Users,
});

const ROLES = ["admin", "staff", "customer"] as const;

function Users() {
  const qc = useQueryClient();
  const [showAddForm, setShowAddForm] = useState(false);
  const [editingUser, setEditingUser] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editPhone, setEditPhone] = useState("");

  // Add user form
  const [newEmail, setNewEmail] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [newName, setNewName] = useState("");
  const [newPhone, setNewPhone] = useState("");
  const [newRole, setNewRole] = useState<"admin" | "staff">("staff");
  const [showPassword, setShowPassword] = useState(false);
  const [creating, setCreating] = useState(false);

  const { data } = useQuery({
    queryKey: ["users-roles"],
    queryFn: async () => {
      const [{ data: profiles }, { data: roles }] = await Promise.all([
        supabase.from("profiles").select("id,full_name,phone,created_at"),
        supabase.from("user_roles").select("user_id,role,id"),
      ]);
      return (profiles ?? []).map((p) => ({
        ...p,
        roles: (roles ?? []).filter((r) => r.user_id === p.id),
      }));
    },
  });

  async function setRole(userId: string, role: string) {
    if (!confirm(`Grant ${role} role?`)) return;
    const { error } = await supabase
      .from("user_roles")
      .insert({ user_id: userId, role: role as never });
    if (error) return toast.error(error.message);
    toast.success("Role granted");
    qc.invalidateQueries({ queryKey: ["users-roles"] });
  }

  async function removeRole(rowId: string) {
    if (!confirm("Remove this role?")) return;
    const { error } = await supabase.from("user_roles").delete().eq("id", rowId);
    if (error) return toast.error(error.message);
    toast.success("Role removed");
    qc.invalidateQueries({ queryKey: ["users-roles"] });
  }

  async function createUser() {
    if (!newEmail.trim()) return toast.error("Email required");
    if (!newPassword.trim()) return toast.error("Password required");
    if (newPassword.length < 6) return toast.error("Password must be at least 6 characters");
    setCreating(true);
    try {
      // Create auth user via Supabase admin API (requires service role key)
      // For now, we'll use the client-side sign up approach
      const { data, error } = await supabase.auth.signUp({
        email: newEmail.trim(),
        password: newPassword,
        options: {
          data: {
            full_name: newName.trim() || null,
            phone: newPhone.trim() || null,
          },
        },
      });
      if (error) return toast.error(error.message);
      if (data.user) {
        // Create profile
        await supabase.from("profiles").upsert({
          id: data.user.id,
          full_name: newName.trim() || null,
          phone: newPhone.trim() || null,
        });
        // Grant role
        await supabase.from("user_roles").insert({
          user_id: data.user.id,
          role: newRole,
        });
        toast.success(`User created: ${newEmail}`);
        setShowAddForm(false);
        setNewEmail("");
        setNewPassword("");
        setNewName("");
        setNewPhone("");
        qc.invalidateQueries({ queryKey: ["users-roles"] });
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to create user");
    } finally {
      setCreating(false);
    }
  }

  async function updateUserProfile(userId: string) {
    const { error } = await supabase
      .from("profiles")
      .update({ full_name: editName.trim() || null, phone: editPhone.trim() || null })
      .eq("id", userId);
    if (error) return toast.error(error.message);
    toast.success("Profile updated");
    setEditingUser(null);
    qc.invalidateQueries({ queryKey: ["users-roles"] });
  }

  async function deleteUser(userId: string) {
    if (!confirm("Are you sure you want to remove this user? This action cannot be undone.")) return;
    // Remove roles first
    await supabase.from("user_roles").delete().eq("user_id", userId);
    // Note: We can't delete the auth user from client side without admin API
    // Just remove roles to effectively deactivate
    toast.success("User roles removed (account deactivated)");
    qc.invalidateQueries({ queryKey: ["users-roles"] });
  }

  const admins = (data ?? []).filter((u) => u.roles.some((r) => r.role === "admin"));
  const staff = (data ?? []).filter((u) => u.roles.some((r) => r.role === "staff"));
  const customers = (data ?? []).filter((u) => u.roles.some((r) => r.role === "customer"));

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <h1 className="text-xl font-bold text-foreground flex-1">Users / Staff</h1>
        <button
          onClick={() => setShowAddForm(!showAddForm)}
          className="flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-xs font-semibold text-white hover:bg-primary/90"
        >
          <UserPlus className="h-3.5 w-3.5" /> Add User
        </button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-3">
        <div className="rounded-xl border border-border bg-white p-4 shadow-sm">
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-4 w-4 text-secondary" />
            <span className="text-[11px] uppercase text-muted-foreground">Admins</span>
          </div>
          <div className="mt-1 text-xl font-bold text-foreground">{admins.length}</div>
        </div>
        <div className="rounded-xl border border-border bg-white p-4 shadow-sm">
          <div className="flex items-center gap-2">
            <UsersIcon className="h-4 w-4 text-emerald-600" />
            <span className="text-[11px] uppercase text-muted-foreground">Staff</span>
          </div>
          <div className="mt-1 text-xl font-bold text-foreground">{staff.length}</div>
        </div>
        <div className="rounded-xl border border-border bg-white p-4 shadow-sm">
          <div className="flex items-center gap-2">
            <User className="h-4 w-4 text-muted-foreground" />
            <span className="text-[11px] uppercase text-muted-foreground">Customers</span>
          </div>
          <div className="mt-1 text-xl font-bold text-foreground">{customers.length}</div>
        </div>
      </div>

      {/* Add User Form */}
      {showAddForm && (
        <div className="rounded-xl border border-border bg-white p-5 shadow-sm">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-bold text-foreground">Add New User</h2>
            <button onClick={() => setShowAddForm(false)} className="text-muted-foreground/70 hover:text-foreground">
              <X className="h-4 w-4" />
            </button>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="mb-1 block text-[11px] font-semibold text-muted-foreground">Email *</span>
              <input
                type="email"
                value={newEmail}
                onChange={(e) => setNewEmail(e.target.value)}
                className="w-full rounded-lg border border-border px-3 py-2 text-sm outline-none focus:border-secondary"
                placeholder="user@example.com"
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-[11px] font-semibold text-muted-foreground">Password *</span>
              <div className="relative">
                <input
                  type={showPassword ? "text" : "password"}
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  className="w-full rounded-lg border border-border px-3 py-2 pr-10 text-sm outline-none focus:border-secondary"
                  placeholder="Min 6 characters"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground/60"
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </label>
            <label className="block">
              <span className="mb-1 block text-[11px] font-semibold text-muted-foreground">Full Name</span>
              <input
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                className="w-full rounded-lg border border-border px-3 py-2 text-sm outline-none focus:border-secondary"
                placeholder="John Doe"
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-[11px] font-semibold text-muted-foreground">Phone</span>
              <input
                value={newPhone}
                onChange={(e) => setNewPhone(e.target.value)}
                className="w-full rounded-lg border border-border px-3 py-2 text-sm outline-none focus:border-secondary"
                placeholder="91XXXXXXXXXX"
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-[11px] font-semibold text-muted-foreground">Role</span>
              <select
                value={newRole}
                onChange={(e) => setNewRole(e.target.value as "admin" | "staff")}
                className="w-full rounded-lg border border-border px-3 py-2 text-sm outline-none focus:border-secondary"
              >
                <option value="staff">Staff</option>
                <option value="admin">Admin</option>
              </select>
            </label>
          </div>
          <div className="mt-4 flex justify-end gap-2">
            <button
              onClick={() => setShowAddForm(false)}
              className="rounded-lg border border-border px-4 py-2 text-sm"
            >
              Cancel
            </button>
            <button
              onClick={createUser}
              disabled={creating}
              className="flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-xs font-semibold text-white hover:bg-primary/90 disabled:opacity-60"
            >
              {creating ? "Creating…" : "Create User"}
            </button>
          </div>
        </div>
      )}

      {/* Users table */}
      <div className="overflow-hidden rounded-xl border border-border bg-white shadow-sm">
        <table className="w-full text-sm">
          <thead className="bg-muted text-[11px] uppercase text-muted-foreground">
            <tr>
              <th className="p-3 text-left">S.No.</th>
              <th className="p-3 text-left">User</th>
              <th className="p-3 text-left">Phone</th>
              <th className="p-3">Roles</th>
              <th className="p-3">Grant Role</th>
              <th className="p-3 text-center">Actions</th>
            </tr>
          </thead>
          <tbody>
            {(data ?? []).map((u, i) => (
              <tr key={u.id} className="border-t border-border hover:bg-muted/30">
                <td className="p-3 text-xs font-semibold text-muted-foreground w-10">{i + 1}</td>
                <td className="p-3">
                  <div className="flex items-center gap-2">
                    <div className="grid h-8 w-8 place-items-center rounded-full bg-secondary-soft">
                      <User className="h-4 w-4 text-muted-foreground" />
                    </div>
                    <div>
                      {editingUser === u.id ? (
                        <input
                          value={editName}
                          onChange={(e) => setEditName(e.target.value)}
                          className="rounded border border-secondary px-2 py-0.5 text-sm outline-none"
                          autoFocus
                        />
                      ) : (
                        <div className="text-sm font-medium">{u.full_name || "—"}</div>
                      )}
                      <div className="text-[10px] text-muted-foreground">{u.id.slice(0, 8)}</div>
                    </div>
                  </div>
                </td>
                <td className="p-3 text-xs text-center">
                  {editingUser === u.id ? (
                    <input
                      value={editPhone}
                      onChange={(e) => setEditPhone(e.target.value)}
                      className="rounded border border-secondary px-2 py-0.5 text-xs outline-none w-24"
                    />
                  ) : (
                    u.phone || "—"
                  )}
                </td>
                <td className="p-3">
                  <div className="flex flex-wrap gap-1 justify-center">
                    {u.roles.map((r) => (
                      <button
                        key={r.id}
                        onClick={() => removeRole(r.id)}
                        className="inline-flex items-center gap-1 rounded-full bg-secondary/15 text-secondary px-2 py-0.5 text-[10px] font-semibold hover:bg-rose-100 hover:text-rose-600"
                      >
                        <ShieldCheck className="h-3 w-3" /> {r.role} ✕
                      </button>
                    ))}
                    {!u.roles.length && (
                      <span className="text-[10px] text-muted-foreground/50">No roles</span>
                    )}
                  </div>
                </td>
                <td className="p-3 text-center">
                  <select
                    onChange={(e) => {
                      if (e.target.value) {
                        setRole(u.id, e.target.value);
                        e.target.value = "";
                      }
                    }}
                    className="rounded-lg border border-border bg-white px-2 py-1 text-xs"
                  >
                    <option value="">+ Grant</option>
                    {ROLES.filter((r) => !u.roles.some((x) => x.role === r)).map((r) => (
                      <option key={r} value={r}>{r}</option>
                    ))}
                  </select>
                </td>
                <td className="p-3">
                  <div className="flex items-center justify-center gap-1">
                    {editingUser === u.id ? (
                      <>
                        <button
                          onClick={() => updateUserProfile(u.id)}
                          className="rounded p-1.5 hover:bg-emerald-50 text-emerald-600"
                          title="Save"
                        >
                          <Check className="h-3.5 w-3.5" />
                        </button>
                        <button
                          onClick={() => setEditingUser(null)}
                          className="rounded p-1.5 hover:bg-muted text-muted-foreground"
                          title="Cancel"
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </>
                    ) : (
                      <>
                        <button
                          onClick={() => {
                            setEditingUser(u.id);
                            setEditName(u.full_name ?? "");
                            setEditPhone(u.phone ?? "");
                          }}
                          className="rounded p-1.5 hover:bg-secondary-soft"
                          title="Edit user"
                        >
                          <Edit3 className="h-3.5 w-3.5 text-muted-foreground" />
                        </button>
                        <button
                          onClick={() => deleteUser(u.id)}
                          className="rounded p-1.5 hover:bg-rose-50"
                          title="Remove user roles"
                        >
                          <Trash2 className="h-3.5 w-3.5 text-rose-600" />
                        </button>
                      </>
                    )}
                  </div>
                </td>
              </tr>
            ))}
            {!data?.length && (
              <tr>
                <td colSpan={6} className="p-6 text-center text-xs text-muted-foreground/70">
                  No users
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <p className="text-[11px] text-muted-foreground">
        Admin and Staff accounts are managed here. Use "Add User" to create new accounts with email and password.
        Roles control access levels. Deleting a user removes their roles but the auth account must be managed via Supabase dashboard.
      </p>
    </div>
  );
}
