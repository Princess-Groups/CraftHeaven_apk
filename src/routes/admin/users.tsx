import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { ShieldCheck, User } from "lucide-react";

export const Route = createFileRoute("/admin/users")({
  head: () => ({ meta: [{ title: "Users & Staff — ACH Admin" }] }),
  component: Users,
});

const ROLES = ["admin", "staff", "customer"] as const;

function Users() {
  const qc = useQueryClient();
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
    qc.invalidateQueries({ queryKey: ["users-roles"] });
  }

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold">Users & Staff</h1>
      <div className="overflow-hidden rounded-xl border border-border bg-white shadow-sm">
        <table className="w-full text-sm">
          <thead className="bg-muted text-[11px] uppercase text-muted-foreground">
            <tr>
              <th className="p-3 text-left">S.No.</th>
              <th className="p-3 text-left">User</th>
              <th className="p-3">Roles</th>
              <th className="p-3">Grant</th>
            </tr>
          </thead>
          <tbody>
            {(data ?? []).map((u, i) => (
              <tr key={u.id} className="border-t border-border">
                <td className="p-3 text-xs font-semibold text-muted-foreground w-10">{i + 1}</td>
                <td className="p-3">
                  <div className="flex items-center gap-2">
                    <div className="grid h-8 w-8 place-items-center rounded-full bg-secondary-soft">
                      <User className="h-4 w-4 text-muted-foreground" />
                    </div>
                    <div>
                      <div className="text-sm font-medium">{u.full_name || "—"}</div>
                      <div className="text-[10px] text-muted-foreground">
                        {u.phone || u.id.slice(0, 8)}
                      </div>
                    </div>
                  </div>
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
                    <option value="">+ Grant role</option>
                    {ROLES.filter((r) => !u.roles.some((x) => x.role === r)).map((r) => (
                      <option key={r} value={r}>
                        {r}
                      </option>
                    ))}
                  </select>
                </td>
              </tr>
            ))}
            {!data?.length && (
              <tr>
                <td colSpan={4} className="p-6 text-center text-xs text-muted-foreground/70">
                  No users
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
