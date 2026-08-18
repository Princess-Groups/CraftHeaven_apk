import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/admin/suppliers")({
  head: () => ({ meta: [{ title: "Suppliers — ACH Admin" }] }),
  component: Suppliers,
});

function Suppliers() {
  const qc = useQueryClient();
  const [form, setForm] = useState({ name: "", phone: "", email: "", gstin: "", address: "" });
  const { data } = useQuery({
    queryKey: ["sup"],
    queryFn: async () => (await supabase.from("suppliers").select("*").order("name")).data ?? [],
  });

  async function add() {
    if (!form.name.trim()) return toast.error("Name required");
    const { error } = await supabase.from("suppliers").insert(form);
    if (error) return toast.error(error.message);
    setForm({ name: "", phone: "", email: "", gstin: "", address: "" });
    qc.invalidateQueries({ queryKey: ["sup"] });
  }

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold">Suppliers</h1>
      <div className="rounded-xl border border-border bg-white p-4 shadow-sm grid grid-cols-2 lg:grid-cols-5 gap-2">
        {(["name", "phone", "email", "gstin", "address"] as const).map((k) => (
          <input
            key={k}
            value={form[k]}
            onChange={(e) => setForm({ ...form, [k]: e.target.value })}
            placeholder={k.charAt(0).toUpperCase() + k.slice(1)}
            className="rounded-lg border border-border px-3 py-2 text-sm"
          />
        ))}
        <button
          onClick={add}
          className="col-span-2 lg:col-span-5 flex items-center justify-center gap-1 rounded-lg bg-primary px-4 py-2 text-xs font-semibold text-white"
        >
          <Plus className="h-3.5 w-3.5" /> Add Supplier
        </button>
      </div>
      <div className="overflow-hidden rounded-xl border border-border bg-white shadow-sm">
        <table className="w-full text-sm">
          <thead className="bg-muted text-[11px] uppercase text-muted-foreground">
            <tr>
              <th className="p-3 text-left">S.No.</th>
              <th className="p-3 text-left">Name</th>
              <th className="p-3">Phone</th>
              <th className="p-3">Email</th>
              <th className="p-3">GSTIN</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {(data ?? []).map((s, i) => (
              <tr key={s.id} className="border-t border-border">
                <td className="p-3 text-xs font-semibold text-muted-foreground w-10">{i + 1}</td>
                <td className="p-3 font-medium">{s.name}</td>
                <td className="p-3 text-xs text-center">{s.phone ?? "—"}</td>
                <td className="p-3 text-xs text-center">{s.email ?? "—"}</td>
                <td className="p-3 text-xs text-center">{s.gstin ?? "—"}</td>
                <td className="p-3 text-right">
                  <button
                    onClick={async () => {
                      await supabase.from("suppliers").delete().eq("id", s.id);
                      qc.invalidateQueries({ queryKey: ["sup"] });
                    }}
                    className="text-rose-500"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </td>
              </tr>
            ))}
            {!data?.length && (
              <tr>
                <td colSpan={6} className="p-6 text-center text-xs text-muted-foreground/70">
                  No suppliers
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
