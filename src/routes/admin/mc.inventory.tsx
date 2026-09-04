import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useState, useMemo } from "react";
import { Search, Boxes, AlertTriangle, XCircle, Clock, ArrowRightLeft, Plus, Minus } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/admin/mc/inventory")({
  head: () => ({ meta: [{ title: "Multi-Channel Inventory" }] }),
  component: MCInventory,
});

type InventoryItem = {
  id: string;
  master_product_id: string;
  variant_id: string | null;
  physical_stock: number;
  available_stock: number;
  reserved_stock: number;
  sold_stock: number;
  damaged_stock: number;
  reorder_level: number;
  last_updated: string;
  mc_master_products: { name: string; sku: string; image_url: string | null; unit: string } | null;
};

type Movement = {
  id: string;
  master_product_id: string;
  quantity: number;
  movement_type: string;
  channel: string | null;
  source: string | null;
  destination: string | null;
  reference_id: string | null;
  notes: string | null;
  created_at: string;
  mc_master_products: { name: string } | null;
};

function MCInventory() {
  const qc = useQueryClient();
  const [view, setView] = useState<"stock" | "movements">("stock");
  const [filter, setFilter] = useState<"all" | "low" | "out" | "high">("all");
  const [searchQ, setSearchQ] = useState("");
  const [adjusting, setAdjusting] = useState<string | null>(null);
  const [adjustVal, setAdjustVal] = useState("");
  const [adjustType, setAdjustType] = useState<"PURCHASE" | "SALE" | "DAMAGED" | "ADJUSTMENT">("PURCHASE");
  const [showNewMovement, setShowNewMovement] = useState(false);
  const [newMovement, setNewMovement] = useState({ product_id: "", quantity: 1, type: "PURCHASE" as string, channel: "", notes: "" });

  const { data: inventory, isLoading } = useQuery({
    queryKey: ["mc-inventory", filter, searchQ],
    queryFn: async () => {
      let q = supabase
        .from("mc_inventory")
        .select("*, mc_master_products(name,sku,image_url,unit)")
        .order("physical_stock", { ascending: true });
      if (searchQ.trim()) {
        q = q.ilike("mc_master_products.name", `%${searchQ}%`);
      }
      return (await q).data ?? [];
    },
  });

  const { data: movements } = useQuery({
    queryKey: ["mc-movements"],
    queryFn: async () =>
      (await supabase
        .from("mc_inventory_movements")
        .select("*, mc_master_products(name)")
        .order("created_at", { ascending: false })
        .limit(100)
      ).data ?? [],
  });

  const { data: products } = useQuery({
    queryKey: ["mc-products-for-inv"],
    queryFn: async () =>
      (await supabase.from("mc_master_products").select("id,name,sku").order("name")).data ?? [],
  });

  const stats = useMemo(() => {
    const items = inventory ?? [];
    const total = items.length;
    const totalStock = items.reduce((s, i) => s + (Number(i.physical_stock) || 0), 0);
    const available = items.reduce((s, i) => s + (Number(i.available_stock) || 0), 0);
    const reserved = items.reduce((s, i) => s + (Number(i.reserved_stock) || 0), 0);
    const damaged = items.reduce((s, i) => s + (Number(i.damaged_stock) || 0), 0);
    const low = items.filter((i) => (i.physical_stock ?? 0) > 0 && (i.physical_stock ?? 0) <= (i.reorder_level ?? 5)).length;
    const out = items.filter((i) => (i.physical_stock ?? 0) <= 0).length;
    return { total, totalStock, available, reserved, damaged, low, out };
  }, [inventory]);

  const filteredItems = useMemo(() => {
    const items = inventory ?? [];
    if (filter === "low") return items.filter((i) => (i.physical_stock ?? 0) > 0 && (i.physical_stock ?? 0) <= (i.reorder_level ?? 5));
    if (filter === "out") return items.filter((i) => (i.physical_stock ?? 0) <= 0);
    if (filter === "high") return items.filter((i) => (i.physical_stock ?? 0) > (i.reorder_level ?? 5));
    return items;
  }, [inventory, filter]);

  async function adjustStock(inv: InventoryItem) {
    const qty = Number(adjustVal);
    if (!qty || qty <= 0) return toast.error("Enter a valid quantity");
    const { error } = await supabase.from("mc_inventory_movements").insert({
      master_product_id: inv.master_product_id,
      quantity: qty,
      movement_type: adjustType,
      channel: null,
      source: adjustType === "PURCHASE" ? "Manual Adjustment" : null,
      destination: adjustType === "SALE" ? "Manual Sale" : null,
      notes: `Manual ${adjustType.toLowerCase()} adjustment`,
    });
    if (error) return toast.error(error.message);
    toast.success(`Stock ${adjustType.toLowerCase()}ed: ${qty}`);
    setAdjusting(null);
    setAdjustVal("");
    qc.invalidateQueries({ queryKey: ["mc-inventory"] });
    qc.invalidateQueries({ queryKey: ["mc-movements"] });
  }

  async function addMovement() {
    if (!newMovement.product_id) return toast.error("Select a product");
    if (!newMovement.quantity || newMovement.quantity <= 0) return toast.error("Enter valid quantity");
    const { error } = await supabase.from("mc_inventory_movements").insert({
      master_product_id: newMovement.product_id,
      quantity: newMovement.quantity,
      movement_type: newMovement.type,
      channel: newMovement.channel || null,
      notes: newMovement.notes || null,
    });
    if (error) return toast.error(error.message);
    toast.success("Movement recorded");
    setShowNewMovement(false);
    setNewMovement({ product_id: "", quantity: 1, type: "PURCHASE", channel: "", notes: "" });
    qc.invalidateQueries({ queryKey: ["mc-inventory"] });
    qc.invalidateQueries({ queryKey: ["mc-movements"] });
  }

  const statCards = [
    { label: "Total Products", value: stats.total, icon: Boxes, color: "text-blue-600", bg: "bg-blue-50" },
    { label: "Total Stock", value: stats.totalStock, icon: Boxes, color: "text-emerald-600", bg: "bg-emerald-50" },
    { label: "Low Stock", value: stats.low, icon: AlertTriangle, color: "text-amber-600", bg: "bg-amber-50" },
    { label: "Out of Stock", value: stats.out, icon: XCircle, color: "text-rose-600", bg: "bg-rose-50" },
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <Boxes className="h-5 w-5 text-primary" />
        <h1 className="text-xl font-bold text-foreground flex-1">Multi-Channel Inventory</h1>
        <div className="flex gap-1 rounded-lg border border-border bg-white p-0.5 shadow-sm">
          <button onClick={() => setView("stock")} className={`rounded-md px-3 py-1.5 text-xs font-semibold transition ${view === "stock" ? "bg-primary text-white" : "text-muted-foreground hover:bg-secondary-soft"}`}>
            <Boxes className="h-3.5 w-3.5 inline mr-1" /> Stock
          </button>
          <button onClick={() => setView("movements")} className={`rounded-md px-3 py-1.5 text-xs font-semibold transition ${view === "movements" ? "bg-primary text-white" : "text-muted-foreground hover:bg-secondary-soft"}`}>
            <ArrowRightLeft className="h-3.5 w-3.5 inline mr-1" /> Movements
          </button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {statCards.map((s) => {
          const Icon = s.icon;
          return (
            <div key={s.label} className="rounded-xl border border-border bg-white p-3 shadow-sm">
              <div className="flex items-center gap-2">
                <div className={`grid h-8 w-8 place-items-center rounded-lg ${s.bg}`}>
                  <Icon className={`h-4 w-4 ${s.color}`} />
                </div>
                <div>
                  <div className="text-[10px] font-semibold uppercase text-muted-foreground">{s.label}</div>
                  <div className="text-base font-bold text-foreground">{s.value}</div>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {view === "stock" && (
        <>
          {/* Filters */}
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex gap-1 rounded-lg border border-border bg-white p-0.5">
              {(["all", "low", "out", "high"] as const).map((f) => (
                <button key={f} onClick={() => setFilter(f)} className={`rounded-md px-2.5 py-1 text-[11px] font-semibold transition ${filter === f ? "bg-primary text-white" : "text-muted-foreground hover:bg-secondary-soft"}`}>
                  {f === "all" ? "All" : f === "low" ? "Low Stock" : f === "out" ? "Out of Stock" : "In Stock"}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-2 rounded-lg border border-border bg-white px-3 py-1.5 shadow-sm">
              <Search className="h-4 w-4 text-muted-foreground/70" />
              <input value={searchQ} onChange={(e) => setSearchQ(e.target.value)} placeholder="Search…" className="bg-transparent text-sm outline-none w-40" />
            </div>
            <button onClick={() => setShowNewMovement(true)} className="flex items-center gap-1 rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-white hover:bg-primary/90 ml-auto">
              <Plus className="h-3.5 w-3.5" /> Record Movement
            </button>
          </div>

          {/* Inventory Table */}
          <div className="rounded-xl border border-border bg-white shadow-sm overflow-hidden">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="bg-muted">
                  <th className="px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-muted-foreground text-left border-b border-border">Product</th>
                  <th className="px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-muted-foreground text-center border-b border-border">Physical</th>
                  <th className="px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-muted-foreground text-center border-b border-border">Available</th>
                  <th className="px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-muted-foreground text-center border-b border-border">Reserved</th>
                  <th className="px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-muted-foreground text-center border-b border-border">Sold</th>
                  <th className="px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-muted-foreground text-center border-b border-border">Damaged</th>
                  <th className="px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-muted-foreground text-center border-b border-border">Reorder Lvl</th>
                  <th className="px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-muted-foreground text-center border-b border-border">Status</th>
                  <th className="px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-muted-foreground text-center border-b border-border w-32">Adjust</th>
                </tr>
              </thead>
              <tbody>
                {filteredItems.map((item) => {
                  const stock = Number(item.physical_stock) || 0;
                  const reorder = Number(item.reorder_level) || 5;
                  const status = stock <= 0 ? "OUT" : stock <= reorder ? "LOW" : "OK";
                  return (
                    <tr key={item.id} className="border-b border-border/50 last:border-0 hover:bg-secondary-soft/20">
                      <td className="px-3 py-2.5">
                        <div className="flex items-center gap-2">
                          {item.mc_master_products?.image_url ? (
                            <img src={item.mc_master_products.image_url} alt="" className="h-7 w-7 rounded object-cover border" />
                          ) : (
                            <div className="h-7 w-7 rounded bg-muted grid place-items-center text-[10px] text-muted-foreground">📦</div>
                          )}
                          <div>
                            <div className="text-xs font-semibold">{item.mc_master_products?.name ?? "Unknown"}</div>
                            <div className="text-[10px] text-muted-foreground font-mono">{item.mc_master_products?.sku ?? "—"}</div>
                          </div>
                        </div>
                      </td>
                      <td className="px-3 py-2.5 text-center text-xs font-bold">{stock}</td>
                      <td className="px-3 py-2.5 text-center text-xs font-semibold text-emerald-600">{item.available_stock ?? 0}</td>
                      <td className="px-3 py-2.5 text-center text-xs text-amber-600">{item.reserved_stock ?? 0}</td>
                      <td className="px-3 py-2.5 text-center text-xs text-muted-foreground">{item.sold_stock ?? 0}</td>
                      <td className="px-3 py-2.5 text-center text-xs text-rose-600">{item.damaged_stock ?? 0}</td>
                      <td className="px-3 py-2.5 text-center text-xs">{reorder}</td>
                      <td className="px-3 py-2.5 text-center">
                        <span className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded-full ${
                          status === "OUT" ? "bg-rose-50 text-rose-700" :
                          status === "LOW" ? "bg-amber-50 text-amber-700" :
                          "bg-green-50 text-green-700"
                        }`}>{status}</span>
                      </td>
                      <td className="px-3 py-2.5">
                        {adjusting === item.id ? (
                          <div className="flex items-center gap-1">
                            <select value={adjustType} onChange={(e) => setAdjustType(e.target.value as typeof adjustType)} className="rounded border border-border px-1 py-0.5 text-[10px]">
                              <option value="PURCHASE">Purchase</option>
                              <option value="SALE">Sale</option>
                              <option value="DAMAGED">Damaged</option>
                              <option value="ADJUSTMENT">Adjust</option>
                            </select>
                            <input type="number" value={adjustVal} onChange={(e) => setAdjustVal(e.target.value)} className="w-16 rounded border border-border px-1 py-0.5 text-[10px] text-right" autoFocus onKeyDown={(e) => { if (e.key === "Enter") adjustStock(item); if (e.key === "Escape") setAdjusting(null); }} />
                            <button onClick={() => adjustStock(item)} className="text-primary text-[10px] font-bold">✓</button>
                          </div>
                        ) : (
                          <button onClick={() => { setAdjusting(item.id); setAdjustVal(""); }} className="text-[10px] font-semibold text-primary hover:underline">Adjust</button>
                        )}
                      </td>
                    </tr>
                  );
                })}
                {filteredItems.length === 0 && (
                  <tr><td colSpan={9} className="px-6 py-12 text-center text-xs text-muted-foreground/70">
                    {isLoading ? "Loading inventory…" : "No inventory records found"}
                  </td></tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}

      {view === "movements" && (
        <div className="rounded-xl border border-border bg-white shadow-sm overflow-hidden">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="bg-muted">
                <th className="px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-muted-foreground text-left border-b border-border">Date</th>
                <th className="px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-muted-foreground text-left border-b border-border">Product</th>
                <th className="px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-muted-foreground text-center border-b border-border">Type</th>
                <th className="px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-muted-foreground text-center border-b border-border">Qty</th>
                <th className="px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-muted-foreground text-center border-b border-border">Channel</th>
                <th className="px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-muted-foreground text-left border-b border-border">Notes</th>
              </tr>
            </thead>
            <tbody>
              {(movements ?? []).map((m) => (
                <tr key={m.id} className="border-b border-border/50 last:border-0">
                  <td className="px-3 py-2 text-xs text-muted-foreground">{new Date(m.created_at).toLocaleDateString("en-IN")}</td>
                  <td className="px-3 py-2 text-xs font-semibold">{m.mc_master_products?.name ?? "—"}</td>
                  <td className="px-3 py-2 text-center">
                    <span className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded-full ${
                      m.movement_type === "PURCHASE" ? "bg-green-50 text-green-700" :
                      m.movement_type === "SALE" ? "bg-blue-50 text-blue-700" :
                      m.movement_type === "DAMAGED" ? "bg-rose-50 text-rose-700" :
                      "bg-gray-50 text-gray-600"
                    }`}>{m.movement_type}</span>
                  </td>
                  <td className="px-3 py-2 text-center text-xs font-bold">{m.quantity}</td>
                  <td className="px-3 py-2 text-center text-xs text-muted-foreground">{m.channel || "—"}</td>
                  <td className="px-3 py-2 text-xs text-muted-foreground max-w-[200px] truncate">{m.notes || "—"}</td>
                </tr>
              ))}
              {(!movements || movements.length === 0) && (
                <tr><td colSpan={6} className="px-6 py-12 text-center text-xs text-muted-foreground/70">No movements recorded yet</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* New Movement Modal */}
      {showNewMovement && (
        <div className="fixed inset-0 z-50 bg-black/40 grid place-items-center p-4" onClick={() => setShowNewMovement(false)}>
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-sm font-bold text-foreground mb-4">Record Stock Movement</h2>
            <div className="space-y-3">
              <div className="space-y-1">
                <label className="text-[11px] font-semibold text-muted-foreground uppercase">Product</label>
                <select value={newMovement.product_id} onChange={(e) => setNewMovement({ ...newMovement, product_id: e.target.value })} className={inputCls}>
                  <option value="">— Select —</option>
                  {(products ?? []).map((p) => <option key={p.id} value={p.id}>{p.name} ({p.sku || "no SKU"})</option>)}
                </select>
              </div>
              <div className="space-y-1">
                <label className="text-[11px] font-semibold text-muted-foreground uppercase">Movement Type</label>
                <select value={newMovement.type} onChange={(e) => setNewMovement({ ...newMovement, type: e.target.value })} className={inputCls}>
                  {["PURCHASE", "SALE", "RETURN", "DAMAGED", "ADJUSTMENT", "TRANSFER"].map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
              <div className="space-y-1">
                <label className="text-[11px] font-semibold text-muted-foreground uppercase">Quantity</label>
                <input type="number" value={newMovement.quantity} onChange={(e) => setNewMovement({ ...newMovement, quantity: Number(e.target.value) })} className={inputCls} min={1} />
              </div>
              <div className="space-y-1">
                <label className="text-[11px] font-semibold text-muted-foreground uppercase">Channel (optional)</label>
                <select value={newMovement.channel} onChange={(e) => setNewMovement({ ...newMovement, channel: e.target.value })} className={inputCls}>
                  <option value="">— None —</option>
                  {["WEBSITE", "AMAZON", "FLIPKART", "MEESHO"].map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
              <div className="space-y-1">
                <label className="text-[11px] font-semibold text-muted-foreground uppercase">Notes</label>
                <input value={newMovement.notes} onChange={(e) => setNewMovement({ ...newMovement, notes: e.target.value })} className={inputCls} placeholder="Optional notes…" />
              </div>
            </div>
            <div className="flex justify-end gap-2 mt-4">
              <button onClick={() => setShowNewMovement(false)} className="rounded-lg border border-border px-4 py-2 text-xs font-semibold text-muted-foreground hover:bg-secondary-soft">Cancel</button>
              <button onClick={addMovement} className="rounded-lg bg-primary px-5 py-2 text-xs font-semibold text-white hover:bg-primary/90">Record</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const inputCls = "w-full rounded-lg border border-border bg-white px-3 py-2 text-sm outline-none focus:border-primary";
