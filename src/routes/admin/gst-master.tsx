import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useState, useMemo } from "react";
import {
  Edit3,
  Check,
  X,
  Search,
  Percent,
  ArrowRight,
  Save,
  Trash2,
  Filter,
  Info,
} from "lucide-react";
import { toast } from "sonner";
import {
  GST_RATES,
  GST_RATE_LABELS,
  PRODUCT_GST_MAP,
  CATEGORY_GST_MAP,
  autoAssignGst,
  splitCgstSgst,
  getGstOverrides,
  saveGstOverride,
  removeGstOverride,
} from "@/lib/gst-config";

export const Route = createFileRoute("/admin/gst-master")({
  head: () => ({ meta: [{ title: "GST Master — ACH Admin" }] }),
  component: GstMaster,
});

type Product = {
  id: string;
  name: string;
  category_id: string | null;
  gst_rate: number | null;
  cgst_rate: number | null;
  sgst_rate: number | null;
  igst_rate: number | null;
  price: number;
  stock: number;
  is_available: boolean;
};

type Category = {
  id: string;
  name: string;
  slug: string;
};

function GstMaster() {
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [filterCategory, setFilterCategory] = useState<string>("all");
  const [filterGst, setFilterGst] = useState<string>("all");
  const [editingProductId, setEditingProductId] = useState<string | null>(null);
  const [editingRate, setEditingRate] = useState<number>(0);
  const [overrides, setOverrides] = useState<Record<string, number>>(() => getGstOverrides());
  const [bulkCategory, setBulkCategory] = useState<string>("");
  const [bulkRate, setBulkRate] = useState<number>(18);
  const [showBulk, setShowBulk] = useState(false);

  const { data: products } = useQuery({
    queryKey: ["admin-products-gst"],
    queryFn: async () => {
      const { data } = await supabase
        .from("products")
        .select("id,name,category_id,gst_rate,cgst_rate,sgst_rate,igst_rate,price,stock,is_available")
        .order("name");
      return (data ?? []) as unknown as Product[];
    },
  });

  const { data: categories } = useQuery({
    queryKey: ["cats-gst"],
    queryFn: async () =>
      (await supabase.from("categories").select("id,name,slug").order("name")).data ?? [],
  });

  const categoryMap = useMemo(() => {
    const map: Record<string, string> = {};
    (categories ?? []).forEach((c: Category) => {
      map[c.id] = c.name;
    });
    return map;
  }, [categories]);

  // Compute effective GST for each product
  const enrichedProducts = useMemo(() => {
    return (products ?? []).map((p) => {
      const categoryName = p.category_id ? categoryMap[p.category_id] ?? null : null;
      const configRate = autoAssignGst(p.name, categoryName, undefined, null);
      const overrideRate = overrides[p.id];
      const effectiveRate = overrideRate ?? (p.gst_rate ?? configRate);
      const hasOverride = overrideRate !== undefined;
      const isAutoAssigned = !hasOverride && configRate > 0 && (p.gst_rate === 0 || p.gst_rate === null);
      return {
        ...p,
        categoryName,
        configRate,
        overrideRate,
        effectiveRate,
        hasOverride,
        isAutoAssigned,
      };
    });
  }, [products, categoryMap, overrides]);

  const filteredProducts = useMemo(() => {
    return enrichedProducts.filter((p) => {
      if (search && !p.name.toLowerCase().includes(search.toLowerCase())) return false;
      if (filterCategory !== "all" && p.category_id !== filterCategory) return false;
      if (filterGst !== "all") {
        const rate = Number(filterGst);
        if (p.effectiveRate !== rate) return false;
      }
      return true;
    });
  }, [enrichedProducts, search, filterCategory, filterGst]);

  // Stats
  const stats = useMemo(() => {
    const total = enrichedProducts.length;
    const withGst = enrichedProducts.filter((p) => p.effectiveRate > 0).length;
    const withoutGst = total - withGst;
    const withOverride = enrichedProducts.filter((p) => p.hasOverride).length;
    const autoMapped = enrichedProducts.filter((p) => p.isAutoAssigned).length;
    return { total, withGst, withoutGst, withOverride, autoMapped };
  }, [enrichedProducts]);

  function startEdit(product: typeof enrichedProducts[0]) {
    setEditingProductId(product.id);
    setEditingRate(product.effectiveRate);
  }

  function cancelEdit() {
    setEditingProductId(null);
    setEditingRate(0);
  }

  async function saveEdit(productId: string, rate: number) {
    const { splitCgstSgst: split } = await import("@/lib/gst-config");
    const { cgst, sgst } = split(rate);

    // Save override locally
    const newOverrides = { ...overrides, [productId]: rate };
    setOverrides(newOverrides);
    saveGstOverride(productId, rate);

    // Also update the product in the database
    const { error } = await supabase
      .from("products")
      .update({
        gst_rate: rate,
        cgst_rate: cgst,
        sgst_rate: sgst,
        igst_rate: rate,
      })
      .eq("id", productId);

    if (error) return toast.error(error.message);
    toast.success(`GST updated to ${rate}%`);
    setEditingProductId(null);
    qc.invalidateQueries({ queryKey: ["admin-products-gst"] });
  }

  async function removeOverride(productId: string) {
    removeGstOverride(productId);
    const newOverrides = { ...overrides };
    delete newOverrides[productId];
    setOverrides(newOverrides);

    // Reset product GST to 0 in DB (will be auto-assigned on next load)
    const { error } = await supabase
      .from("products")
      .update({ gst_rate: 0, cgst_rate: 0, sgst_rate: 0, igst_rate: 0 })
      .eq("id", productId);

    if (error) return toast.error(error.message);
    toast.success("GST override removed — will auto-assign on next load");
    qc.invalidateQueries({ queryKey: ["admin-products-gst"] });
  }

  async function bulkAssign() {
    if (!bulkCategory) return toast.error("Select a category");
    const categoryProducts = enrichedProducts.filter(
      (p) => p.category_id === bulkCategory && !p.hasOverride,
    );
    if (categoryProducts.length === 0) return toast.error("No products in this category to update");

    const { cgst, sgst } = splitCgstSgst(bulkRate);

    for (const p of categoryProducts) {
      saveGstOverride(p.id, bulkRate);
      await supabase
        .from("products")
        .update({
          gst_rate: bulkRate,
          cgst_rate: cgst,
          sgst_rate: sgst,
          igst_rate: bulkRate,
        })
        .eq("id", p.id);
    }

    setOverrides((prev) => {
      const next = { ...prev };
      categoryProducts.forEach((p) => { next[p.id] = bulkRate; });
      return next;
    });

    toast.success(`GST set to ${bulkRate}% for ${categoryProducts.length} products`);
    setShowBulk(false);
    qc.invalidateQueries({ queryKey: ["admin-products-gst"] });
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="text-xl font-bold text-foreground flex-1">GST Master</h1>
        <button
          onClick={() => setShowBulk(!showBulk)}
          className="flex items-center gap-1.5 rounded-lg border border-border bg-white px-3 py-2 text-xs font-semibold text-muted-foreground hover:bg-secondary-soft"
        >
          <Filter className="h-3.5 w-3.5" /> Bulk Assign
        </button>
      </div>

      {/* Info banner */}
      <div className="rounded-xl border border-sky-200 bg-sky-50 p-3 text-xs text-sky-800 flex items-start gap-2">
        <Info className="h-4 w-4 mt-0.5 shrink-0" />
        <div>
          <strong>GST Priority Logic:</strong> Manual Override → Product Mapping → Category Mapping → Default (0%).
          Edit any product's GST rate below. Changes are saved to the database and will be used in Billing and POS.
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard label="Total Products" value={stats.total} color="text-foreground" />
        <StatCard label="With GST Assigned" value={stats.withGst} color="text-emerald-600" />
        <StatCard label="No GST" value={stats.withoutGst} color="text-rose-600" />
        <StatCard label="Manual Overrides" value={stats.withOverride} color="text-amber-600" />
      </div>

      {/* Bulk Assign */}
      {showBulk && (
        <div className="rounded-xl border border-border bg-white p-4 shadow-sm">
          <div className="flex items-center gap-2 mb-3">
            <Filter className="h-4 w-4 text-primary" />
            <h2 className="text-sm font-bold text-foreground">Bulk Assign GST by Category</h2>
          </div>
          <div className="flex flex-wrap items-end gap-3">
            <div>
              <label className="mb-1 block text-[11px] font-semibold text-muted-foreground">Category</label>
              <select
                value={bulkCategory}
                onChange={(e) => setBulkCategory(e.target.value)}
                className="rounded-lg border border-border bg-white px-3 py-2 text-sm outline-none focus:border-primary"
              >
                <option value="">— Select Category —</option>
                {(categories ?? []).map((c: Category) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-[11px] font-semibold text-muted-foreground">GST Rate</label>
              <select
                value={bulkRate}
                onChange={(e) => setBulkRate(Number(e.target.value))}
                className="rounded-lg border border-border bg-white px-3 py-2 text-sm outline-none focus:border-primary"
              >
                {GST_RATES.map((r) => (
                  <option key={r} value={r}>{r}% — {GST_RATE_LABELS[r]?.split("—")[1]?.trim() || r}</option>
                ))}
              </select>
            </div>
            <button
              onClick={bulkAssign}
              className="flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-xs font-semibold text-white hover:bg-primary/90"
            >
              <Save className="h-3.5 w-3.5" /> Apply to Category
            </button>
          </div>
        </div>
      )}

      {/* GST Rate Legend */}
      <div className="rounded-xl border border-border bg-white p-3 shadow-sm">
        <div className="text-[11px] font-semibold text-muted-foreground mb-2">Available GST Rates</div>
        <div className="flex flex-wrap gap-2">
          {GST_RATES.map((rate) => (
            <span
              key={rate}
              className="inline-flex items-center gap-1 rounded-full border border-border bg-muted/50 px-3 py-1 text-xs font-semibold"
            >
              <Percent className="h-3 w-3" />
              {rate}%
              <span className="text-muted-foreground font-normal">
                — {GST_RATE_LABELS[rate]?.split("—")[1]?.trim()}
              </span>
            </span>
          ))}
        </div>
      </div>

      {/* Filters */}
      <div className="rounded-xl border border-border bg-white p-3 shadow-sm">
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex-1 min-w-[200px]">
            <label className="mb-1 block text-[11px] font-semibold text-muted-foreground">Search Product</label>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground/70" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search by product name…"
                className="w-full rounded-lg border border-border bg-white pl-9 pr-3 py-2 text-sm outline-none focus:border-primary"
              />
            </div>
          </div>
          <div>
            <label className="mb-1 block text-[11px] font-semibold text-muted-foreground">Category</label>
            <select
              value={filterCategory}
              onChange={(e) => setFilterCategory(e.target.value)}
              className="rounded-lg border border-border bg-white px-3 py-2 text-sm outline-none focus:border-primary"
            >
              <option value="all">All Categories</option>
              {(categories ?? []).map((c: Category) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-[11px] font-semibold text-muted-foreground">GST Rate</label>
            <select
              value={filterGst}
              onChange={(e) => setFilterGst(e.target.value)}
              className="rounded-lg border border-border bg-white px-3 py-2 text-sm outline-none focus:border-primary"
            >
              <option value="all">All Rates</option>
              {GST_RATES.map((r) => (
                <option key={r} value={r}>{r}%</option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* Products Table */}
      <div className="overflow-hidden rounded-xl border border-border bg-white shadow-sm">
        <table className="w-full text-sm">
          <thead className="bg-muted text-[11px] uppercase tracking-wider text-muted-foreground">
            <tr>
              <th className="p-3 text-left w-8">S.No</th>
              <th className="p-3 text-left">Product Name</th>
              <th className="p-3 text-left">Category</th>
              <th className="p-3 text-center">Config GST</th>
              <th className="p-3 text-center">Effective GST</th>
              <th className="p-3 text-center">Source</th>
              <th className="p-3 text-center">CGST/SGST</th>
              <th className="p-3 w-24"></th>
            </tr>
          </thead>
          <tbody>
            {filteredProducts.map((p, i) => (
              <tr key={p.id} className="border-t border-border hover:bg-secondary-soft/30">
                <td className="p-3 text-xs font-semibold text-muted-foreground w-8">{i + 1}</td>
                <td className="p-3">
                  <div className="text-sm font-semibold text-foreground">{p.name}</div>
                  <div className="text-[10px] text-muted-foreground">
                    ₹{Number(p.price).toFixed(0)} · Stock: {p.stock}
                  </div>
                </td>
                <td className="p-3 text-xs text-muted-foreground">
                  {p.categoryName || <span className="text-muted-foreground/50 italic">No category</span>}
                </td>
                <td className="p-3 text-center">
                  <span className="text-xs text-muted-foreground">{p.configRate}%</span>
                </td>
                <td className="p-3 text-center">
                  {editingProductId === p.id ? (
                    <select
                      value={editingRate}
                      onChange={(e) => setEditingRate(Number(e.target.value))}
                      className="rounded border border-primary/30 bg-primary/5 px-2 py-1 text-xs font-semibold text-right outline-none focus:ring-2 focus:ring-primary/30"
                    >
                      {GST_RATES.map((r) => (
                        <option key={r} value={r}>{r}%</option>
                      ))}
                    </select>
                  ) : (
                    <span
                      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-bold ${
                        p.effectiveRate > 0
                          ? "bg-emerald-100 text-emerald-700"
                          : "bg-muted text-muted-foreground"
                      }`}
                    >
                      {p.effectiveRate}%
                    </span>
                  )}
                </td>
                <td className="p-3 text-center">
                  {p.hasOverride ? (
                    <span className="inline-flex items-center gap-0.5 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold text-amber-700">
                      Manual
                    </span>
                  ) : p.isAutoAssigned ? (
                    <span className="inline-flex items-center gap-0.5 rounded-full bg-sky-100 px-2 py-0.5 text-[10px] font-bold text-sky-700">
                      Auto
                    </span>
                  ) : p.configRate > 0 ? (
                    <span className="inline-flex items-center gap-0.5 rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-bold text-emerald-700">
                      Product
                    </span>
                  ) : (
                    <span className="text-[10px] text-muted-foreground/50">—</span>
                  )}
                </td>
                <td className="p-3 text-center text-xs text-muted-foreground">
                  {p.effectiveRate > 0 ? (
                    <>
                      {splitCgstSgst(p.effectiveRate).cgst}%/{splitCgstSgst(p.effectiveRate).sgst}%
                    </>
                  ) : (
                    "—"
                  )}
                </td>
                <td className="p-3">
                  <div className="flex items-center justify-center gap-1">
                    {editingProductId === p.id ? (
                      <>
                        <button
                          onClick={() => saveEdit(p.id, editingRate)}
                          className="rounded p-1.5 hover:bg-emerald-50 text-emerald-600"
                          title="Save"
                        >
                          <Check className="h-3.5 w-3.5" />
                        </button>
                        <button
                          onClick={cancelEdit}
                          className="rounded p-1.5 hover:bg-muted text-muted-foreground"
                          title="Cancel"
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </>
                    ) : (
                      <>
                        <button
                          onClick={() => startEdit(p)}
                          className="rounded p-1.5 hover:bg-secondary-soft"
                          title="Edit GST"
                        >
                          <Edit3 className="h-3.5 w-3.5 text-muted-foreground" />
                        </button>
                        {p.hasOverride && (
                          <button
                            onClick={() => removeOverride(p.id)}
                            className="rounded p-1.5 hover:bg-rose-50"
                            title="Remove override"
                          >
                            <Trash2 className="h-3.5 w-3.5 text-rose-600" />
                          </button>
                        )}
                      </>
                    )}
                  </div>
                </td>
              </tr>
            ))}
            {!filteredProducts.length && (
              <tr>
                <td colSpan={8} className="p-8 text-center text-xs text-muted-foreground/70">
                  No products found
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="text-[11px] text-muted-foreground">
        Showing {filteredProducts.length} of {enrichedProducts.length} products
      </div>
    </div>
  );
}

function StatCard({
  label,
  value,
  color,
}: {
  label: string;
  value: number;
  color: string;
}) {
  return (
    <div className="rounded-xl border border-border bg-white p-3 shadow-sm">
      <div className="text-[11px] font-semibold text-muted-foreground">{label}</div>
      <div className={`text-xl font-extrabold mt-1 ${color}`}>{value}</div>
    </div>
  );
}
