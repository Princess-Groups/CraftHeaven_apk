import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useState, useMemo } from "react";
import { toast } from "sonner";
import {
  AlertTriangle,
  Search,
  Package,
  CheckCircle2,
  XCircle,
  ShoppingCart,
  Edit3,
  Check,
  Bell,
  ArrowRight,
} from "lucide-react";

export const Route = createFileRoute("/admin/inventory")({
  head: () => ({ meta: [{ title: "Inventory — ACH Admin" }] }),
  component: Inventory,
});

function Inventory() {
  const qc = useQueryClient();
  const [view, setView] = useState<"alerts" | "inventory">("alerts");
  const [filter, setFilter] = useState<"all" | "low" | "out" | "in">("all");
  const [searchQ, setSearchQ] = useState("");
  const [editingReorder, setEditingReorder] = useState<string | null>(null);
  const [reorderVal, setReorderVal] = useState("");

  const { data: products } = useQuery({
    queryKey: ["inv"],
    queryFn: async () =>
      (
        await supabase
          .from("products")
          .select("id,name,stock,unit,reorder_level,is_available,sku,barcode,purchase_price,price,category_id,image_urls,categories(name)")
          .order("stock", { ascending: true })
      ).data ?? [],
  });

  const { data: categories } = useQuery({
    queryKey: ["cats-lite"],
    queryFn: async () => (await supabase.from("categories").select("id,name")).data ?? [],
  });

  // Stats
  const stats = useMemo(() => {
    const all = (products ?? []) as any[];
    const total = all.length;
    const inStock = all.filter((p) => p.stock > (p.reorder_level ?? 5)).length;
    const low = all.filter((p) => p.stock > 0 && p.stock <= (p.reorder_level ?? 5)).length;
    const out = all.filter((p) => p.stock <= 0).length;
    return { total, inStock, low, out };
  }, [products]);

  // Filtered products for Stock Alert view
  const alertProducts = useMemo(() => {
    let list = (products ?? []) as any[];
    if (filter === "out") list = list.filter((p) => p.stock <= 0);
    else if (filter === "low") list = list.filter((p) => p.stock > 0 && p.stock <= (p.reorder_level ?? 5));
    else if (filter === "in") list = list.filter((p) => p.stock > (p.reorder_level ?? 5));
    if (searchQ.trim()) {
      const q = searchQ.toLowerCase();
      list = list.filter(
        (p) =>
          p.name?.toLowerCase().includes(q) ||
          p.barcode?.toLowerCase().includes(q) ||
          p.sku?.toLowerCase().includes(q) ||
          p.categories?.name?.toLowerCase().includes(q),
      );
    }
    return list;
  }, [products, filter, searchQ]);

  // Filtered products for inventory table view
  const inventoryProducts = useMemo(() => {
    let list = (products ?? []) as any[];
    if (filter === "out") list = list.filter((p) => p.stock <= 0);
    else if (filter === "low") list = list.filter((p) => p.stock > 0 && p.stock <= (p.reorder_level ?? 5));
    else if (filter === "in") list = list.filter((p) => p.stock > (p.reorder_level ?? 5));
    if (searchQ.trim()) {
      const q = searchQ.toLowerCase();
      list = list.filter(
        (p) =>
          p.name?.toLowerCase().includes(q) ||
          p.barcode?.toLowerCase().includes(q) ||
          p.sku?.toLowerCase().includes(q),
      );
    }
    return list;
  }, [products, filter, searchQ]);

  async function adjust(id: string, stock: number, product: any) {
    const { error } = await supabase
      .from("products")
      .update({ stock, is_available: stock > 0 })
      .eq("id", id);
    if (error) return toast.error(error.message);
    toast.success("Stock updated");
    qc.invalidateQueries({ queryKey: ["inv"] });

    // Auto-generate stock alert notification
    const reorder = product.reorder_level ?? 5;
    if (stock <= 0) {
      await supabase.from("admin_notifications").insert({
        kind: "stock_alert",
        title: "Out of Stock Alert",
        body: `${product.name} is currently out of stock.`,
        meta: { product_id: id, product_name: product.name, current_stock: stock, reorder_level: reorder },
        is_read: false,
      });
      qc.invalidateQueries({ queryKey: ["admin-notif-count"] });
    } else if (stock <= reorder) {
      await supabase.from("admin_notifications").insert({
        kind: "stock_alert",
        title: "Low Stock Alert",
        body: `${product.name} has only ${stock} units remaining.`,
        meta: { product_id: id, product_name: product.name, current_stock: stock, reorder_level: reorder },
        is_read: false,
      });
      qc.invalidateQueries({ queryKey: ["admin-notif-count"] });
    }
  }

  async function saveReorder(id: string) {
    const val = Number(reorderVal);
    if (isNaN(val) || val < 0) return toast.error("Invalid value");
    const { error } = await supabase.from("products").update({ reorder_level: val }).eq("id", id);
    if (error) return toast.error(error.message);
    toast.success("Minimum stock updated");
    setEditingReorder(null);
    qc.invalidateQueries({ queryKey: ["inv"] });
  }

  function getStatus(p: any) {
    if (p.stock <= 0) return "out";
    if (p.stock <= (p.reorder_level ?? 5)) return "low";
    return "in";
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center gap-3">
        <h1 className="text-xl font-bold text-foreground flex-1">Inventory</h1>
      </div>

      {/* View tabs */}
      <div className="flex rounded-lg border border-border bg-white p-1 text-xs font-semibold">
        <button
          onClick={() => { setView("alerts"); setFilter("all"); }}
          className={`flex items-center gap-1.5 px-4 py-1.5 rounded ${view === "alerts" ? "bg-primary text-white" : "text-muted-foreground"}`}
        >
          <Bell className="h-3.5 w-3.5" /> Stock Alert
          {(stats.low + stats.out) > 0 && (
            <span className="ml-1 rounded-full bg-amber-500 text-white px-1.5 py-0.5 text-[9px] font-bold">
              {stats.low + stats.out}
            </span>
          )}
        </button>
        <button
          onClick={() => { setView("inventory"); setFilter("all"); }}
          className={`flex items-center gap-1.5 px-4 py-1.5 rounded ${view === "inventory" ? "bg-primary text-white" : "text-muted-foreground"}`}
        >
          <Package className="h-3.5 w-3.5" /> All Inventory
        </button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <div className="rounded-xl border border-border bg-white p-4 shadow-sm">
          <div className="flex items-center gap-2">
            <Package className="h-4 w-4 text-muted-foreground" />
            <span className="text-[11px] uppercase text-muted-foreground">Total Products</span>
          </div>
          <div className="mt-1 text-xl font-bold text-foreground">{stats.total}</div>
        </div>
        <div className="rounded-xl border border-border bg-white p-4 shadow-sm">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4 text-emerald-600" />
            <span className="text-[11px] uppercase text-muted-foreground">In Stock</span>
          </div>
          <div className="mt-1 text-xl font-bold text-emerald-600">{stats.inStock}</div>
        </div>
        <div className="rounded-xl border border-border bg-white p-4 shadow-sm">
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-amber-600" />
            <span className="text-[11px] uppercase text-muted-foreground">Low Stock</span>
          </div>
          <div className="mt-1 text-xl font-bold text-amber-600">{stats.low}</div>
        </div>
        <div className="rounded-xl border border-border bg-white p-4 shadow-sm">
          <div className="flex items-center gap-2">
            <XCircle className="h-4 w-4 text-rose-600" />
            <span className="text-[11px] uppercase text-muted-foreground">Out of Stock</span>
          </div>
          <div className="mt-1 text-xl font-bold text-rose-600">{stats.out}</div>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex rounded-lg border border-border bg-white p-1 text-xs font-semibold">
          {[
            ["all", "All"],
            ["low", "Low Stock"],
            ["out", "Out of Stock"],
            ["in", "In Stock"],
          ].map(([k, l]) => (
            <button
              key={k}
              onClick={() => setFilter(k as any)}
              className={`px-3 py-1 rounded ${filter === k ? "bg-primary text-white" : "text-muted-foreground"}`}
            >
              {l}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2 rounded-lg border border-border bg-white px-3 py-1.5 shadow-sm">
          <Search className="h-4 w-4 text-muted-foreground/70" />
          <input
            value={searchQ}
            onChange={(e) => setSearchQ(e.target.value)}
            placeholder="Search by name, barcode, category…"
            className="bg-transparent text-sm outline-none w-56"
          />
        </div>
        <span className="text-xs text-muted-foreground">
          {view === "alerts" ? alertProducts.length : inventoryProducts.length} products
        </span>
      </div>

      {/* ================= STOCK ALERT VIEW ================= */}
      {view === "alerts" && (
        <>
          {alertProducts.length === 0 && (
            <div className="rounded-xl border-2 border-dashed border-border py-16 text-center">
              <CheckCircle2 className="mx-auto h-10 w-10 text-emerald-400 mb-3" />
              <div className="text-sm font-semibold text-foreground">All products are well stocked</div>
              <div className="text-xs text-muted-foreground mt-1">No low or out of stock alerts</div>
            </div>
          )}
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {alertProducts.map((p: any) => {
              const status = getStatus(p);
              const isOut = status === "out";
              const img = p.image_urls?.[0];
              return (
                <div
                  key={p.id}
                  className={`rounded-xl border bg-white p-4 shadow-sm transition hover:shadow-md ${
                    isOut ? "border-rose-200" : "border-amber-200"
                  }`}
                >
                  {/* Header with status */}
                  <div className="flex items-start justify-between mb-3">
                    <div className="flex items-center gap-3">
                      <div className="h-14 w-14 shrink-0 overflow-hidden rounded-lg bg-muted">
                        {img ? (
                          <img src={img} alt={p.name} className="h-full w-full object-cover" />
                        ) : (
                          <div className="h-full w-full grid place-items-center">
                            <Package className="h-6 w-6 text-muted-foreground/40" />
                          </div>
                        )}
                      </div>
                      <div className="min-w-0">
                        <div className="text-sm font-semibold text-foreground truncate">{p.name}</div>
                        <div className="text-[10px] text-muted-foreground">{p.barcode || "No barcode"}</div>
                      </div>
                    </div>
                    <span
                      className={`shrink-0 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold ${
                        isOut
                          ? "bg-rose-100 text-rose-700"
                          : "bg-amber-100 text-amber-700"
                      }`}
                    >
                      {isOut ? <XCircle className="h-3 w-3" /> : <AlertTriangle className="h-3 w-3" />}
                      {isOut ? "OUT OF STOCK" : "LOW STOCK"}
                    </span>
                  </div>

                  {/* Details */}
                  <div className="space-y-2 text-xs">
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Category</span>
                      <span className="font-medium">{p.categories?.name || "—"}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Current Stock</span>
                      <span className={`font-bold ${isOut ? "text-rose-600" : "text-amber-600"}`}>
                        {Number(p.stock)} {p.unit || "Nos"}
                      </span>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-muted-foreground">Minimum Stock</span>
                      {editingReorder === p.id ? (
                        <div className="flex items-center gap-1">
                          <input
                            type="number"
                            min={0}
                            value={reorderVal}
                            onChange={(e) => setReorderVal(e.target.value)}
                            onKeyDown={(e) => e.key === "Enter" && saveReorder(p.id)}
                            className="w-16 rounded border border-secondary px-1.5 py-0.5 text-xs text-right outline-none"
                            autoFocus
                          />
                          <button onClick={() => saveReorder(p.id)} className="rounded p-0.5 hover:bg-emerald-50 text-emerald-600">
                            <Check className="h-3 w-3" />
                          </button>
                        </div>
                      ) : (
                        <button
                          onClick={() => { setEditingReorder(p.id); setReorderVal(String(p.reorder_level ?? 5)); }}
                          className="flex items-center gap-1 rounded px-1.5 py-0.5 hover:bg-secondary-soft font-medium"
                        >
                          {p.reorder_level ?? 5}
                          <Edit3 className="h-3 w-3 text-muted-foreground" />
                        </button>
                      )}
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Retail Price</span>
                      <span className="font-semibold">₹{Number(p.price ?? 0).toFixed(0)}</span>
                    </div>
                  </div>

                  {/* Re-Stock button */}
                  <Link
                    to="/admin/purchases"
                    search={{ restock: p.id }}
                    className="mt-3 flex items-center justify-center gap-1.5 w-full rounded-lg bg-primary/10 py-2 text-xs font-semibold text-primary hover:bg-primary/20 transition"
                  >
                    <ShoppingCart className="h-3.5 w-3.5" /> Re-Stock
                    <ArrowRight className="h-3 w-3" />
                  </Link>
                </div>
              );
            })}
          </div>
        </>
      )}

      {/* ================= INVENTORY TABLE VIEW ================= */}
      {view === "inventory" && (
        <div className="overflow-hidden rounded-xl border border-border bg-white shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted text-[11px] uppercase text-muted-foreground">
                <tr>
                  <th className="p-3 text-left">S.No.</th>
                  <th className="p-3 text-left">Product</th>
                  <th className="p-3 text-left">Barcode</th>
                  <th className="p-3 text-left">Category</th>
                  <th className="p-3 text-right">Current Stock</th>
                  <th className="p-3 text-right">Unit</th>
                  <th className="p-3 text-right">Min Stock</th>
                  <th className="p-3 text-center">Status</th>
                  <th className="p-3 text-right">Purchase Cost</th>
                  <th className="p-3 text-right">Retail Price</th>
                  <th className="p-3 text-right">Adjust</th>
                </tr>
              </thead>
              <tbody>
                {inventoryProducts.map((p: any, i: number) => {
                  const isOut = p.stock <= 0;
                  const isLow = p.stock > 0 && p.stock <= (p.reorder_level ?? 5);
                  return (
                    <tr key={p.id} className="border-t border-border hover:bg-muted/30">
                      <td className="p-3 text-xs font-semibold text-muted-foreground w-10">{i + 1}</td>
                      <td className="p-3">
                        <div className="flex items-center gap-2">
                          <div className="h-8 w-8 shrink-0 overflow-hidden rounded bg-muted">
                            {p.image_urls?.[0] ? (
                              <img src={p.image_urls[0]} alt="" className="h-full w-full object-cover" />
                            ) : null}
                          </div>
                          <div>
                            <div className="font-medium text-foreground">{p.name}</div>
                            <div className="text-[10px] text-muted-foreground">{p.sku ?? "—"}</div>
                          </div>
                        </div>
                      </td>
                      <td className="p-3 text-xs text-muted-foreground font-mono">{p.barcode ?? "—"}</td>
                      <td className="p-3 text-xs text-muted-foreground">{p.categories?.name ?? "—"}</td>
                      <td className={`p-3 text-right font-bold ${isOut ? "text-rose-600" : isLow ? "text-amber-600" : "text-emerald-600"}`}>
                        {Number(p.stock)}
                      </td>
                      <td className="p-3 text-right text-sm font-semibold text-muted-foreground">{p.unit ?? "Nos"}</td>
                      <td className="p-3 text-right text-muted-foreground">{p.reorder_level ?? 5}</td>
                      <td className="p-3 text-center">
                        <span className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                          isOut ? "bg-rose-100 text-rose-700" : isLow ? "bg-amber-100 text-amber-700" : "bg-emerald-100 text-emerald-700"
                        }`}>
                          {isOut ? "Out of Stock" : isLow ? "Low Stock" : "In Stock"}
                        </span>
                      </td>
                      <td className="p-3 text-right text-xs text-muted-foreground">
                        {p.purchase_price != null ? `₹${Number(p.purchase_price).toFixed(0)}` : "—"}
                      </td>
                      <td className="p-3 text-right text-sm font-semibold">₹{Number(p.price ?? 0).toFixed(0)}</td>
                      <td className="p-3">
                        <div className="flex items-center gap-2 justify-center">
                          <input
                            type="number"
                            step="0.001"
                            min={0}
                            defaultValue={p.stock}
                            className="w-24 rounded border border-border px-2 py-1 text-xs text-right"
                            onBlur={(e) => {
                              const v = Number(e.target.value);
                              if (v !== p.stock) adjust(p.id, v, p);
                            }}
                          />
                        </div>
                      </td>
                    </tr>
                  );
                })}
                {!inventoryProducts.length && (
                  <tr>
                    <td colSpan={11} className="p-8 text-center text-xs text-muted-foreground/70">No products match</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
