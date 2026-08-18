import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useState } from "react";
import { toast } from "sonner";
import { AlertTriangle } from "lucide-react";

export const Route = createFileRoute("/admin/inventory")({
  head: () => ({ meta: [{ title: "Inventory — ACH Admin" }] }),
  component: Inventory,
});

function Inventory() {
  const qc = useQueryClient();
  const [filter, setFilter] = useState<"all" | "low" | "out">("all");
  const { data: products } = useQuery({
    queryKey: ["inv"],
    queryFn: async () =>
      (
        await supabase
          .from("products")
          .select("id,name,stock,unit,reorder_level,is_available,sku")
          .order("stock", { ascending: true })
      ).data ?? [],
  });

  const filtered = (products ?? []).filter((p) => {
    if (filter === "out") return p.stock <= 0;
    if (filter === "low") return p.stock > 0 && p.stock <= (p.reorder_level ?? 5);
    return true;
  });

  async function adjust(id: string, stock: number) {
    const { error } = await supabase
      .from("products")
      .update({ stock, is_available: stock > 0 })
      .eq("id", id);
    if (error) return toast.error(error.message);
    toast.success("Stock updated");
    qc.invalidateQueries({ queryKey: ["inv"] });
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <h1 className="text-xl font-bold text-foreground flex-1">Inventory</h1>
        <div className="flex rounded-lg border border-border bg-white p-1 text-xs font-semibold">
          {[
            ["all", "All"],
            ["low", "Low Stock"],
            ["out", "Out of Stock"],
          ].map(([k, l]) => (
            <button
              key={k}
              onClick={() => setFilter(k as "all")}
              className={`px-3 py-1 rounded ${filter === k ? "bg-primary text-white" : "text-muted-foreground"}`}
            >
              {l}
            </button>
          ))}
        </div>
      </div>

      <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800 flex items-center gap-2">
        <AlertTriangle className="h-4 w-4" />
        Inventory is shared between the online store and POS billing. Every sale — online or offline
        — deducts from the same stock instantly.
      </div>

      <div className="overflow-hidden rounded-xl border border-border bg-white shadow-sm">
        <table className="w-full text-sm">
          <thead className="bg-muted text-[11px] uppercase text-muted-foreground">
            <tr>
              <th className="p-3 text-left">S.No.</th>
              <th className="p-3 text-left">Product</th>
              <th className="p-3">SKU</th>
              <th className="p-3 text-right">Current Stock</th>
              <th className="p-3 text-right">Unit</th>
              <th className="p-3 text-right">Reorder Level</th>
              <th className="p-3">Adjust</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((p, i) => (
              <tr key={p.id} className="border-t border-border">
                <td className="p-3 text-xs font-semibold text-muted-foreground w-10">{i + 1}</td>
                <td className="p-3 font-medium">{p.name}</td>
                <td className="p-3 text-xs text-muted-foreground text-center">{p.sku ?? "—"}</td>
                <td
                  className={`p-3 text-right font-bold ${p.stock <= 0 ? "text-rose-600" : p.stock <= p.reorder_level ? "text-amber-600" : "text-emerald-600"}`}
                >
                  {Number(p.stock)}
                </td>
                <td className="p-3 text-right text-sm font-semibold text-muted-foreground">
                  {p.unit ?? "Nos"}
                </td>
                <td className="p-3 text-right text-muted-foreground">{p.reorder_level}</td>
                <td className="p-3">
                  <div className="flex items-center gap-2 justify-center">
                    <input
                      type="number"
                      step="0.001"
                      min={0}
                      defaultValue={p.stock}
                      className="w-24 rounded border border-border px-2 py-1 text-xs"
                      onBlur={(e) => {
                        const v = Number(e.target.value);
                        if (v !== p.stock) adjust(p.id, v);
                      }}
                    />
                  </div>
                </td>
              </tr>
            ))}
            {!filtered.length && (
              <tr>
                <td colSpan={6} className="p-8 text-center text-xs text-muted-foreground/70">
                  No products match
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
