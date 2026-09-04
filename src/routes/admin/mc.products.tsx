import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useState, useMemo } from "react";
import { Plus, Trash2, Search, X, Loader2, PackageSearch, Link2 } from "lucide-react";
import { toast } from "sonner";
import { uploadProductImage } from "@/lib/upload";

export const Route = createFileRoute("/admin/mc/products")({
  head: () => ({ meta: [{ title: "Master Products — Multi-Channel" }] }),
  component: MasterProducts,
});

type MasterProduct = {
  id: string;
  name: string;
  sku: string | null;
  barcode: string | null;
  category_id: string | null;
  subcategory: string | null;
  brand_id: string | null;
  description: string | null;
  image_url: string | null;
  size: string | null;
  colour: string | null;
  material: string | null;
  unit: string;
  purchase_price: number;
  base_cost: number;
  selling_price: number;
  minimum_stock: number;
  current_stock: number;
  available_stock: number;
  reserved_stock: number;
  damaged_stock: number;
  supplier_name: string | null;
  gst_rate: number;
  status: string;
  linked_product_id: string | null;
  created_at: string;
  updated_at: string;
};

const STATUS_OPTIONS = ["ACTIVE", "INACTIVE", "DRAFT", "DISCONTINUED"] as const;

function MasterProducts() {
  const qc = useQueryClient();
  const [searchQ, setSearchQ] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("ALL");
  const [editing, setEditing] = useState<Partial<MasterProduct> | null>(null);
  const [uploading, setUploading] = useState(false);

  const { data: products, isLoading } = useQuery({
    queryKey: ["mc-master-products", searchQ, statusFilter],
    queryFn: async () => {
      let q = supabase.from("mc_master_products").select("*").order("created_at", { ascending: false });
      if (searchQ.trim()) {
        q = q.or(`name.ilike.%${searchQ}%,sku.ilike.%${searchQ}%,barcode.ilike.%${searchQ}%`);
      }
      if (statusFilter !== "ALL") {
        q = q.eq("status", statusFilter);
      }
      return (await q).data ?? [];
    },
  });

  const { data: categories } = useQuery({
    queryKey: ["cats-lite"],
    queryFn: async () => (await supabase.from("categories").select("id,name")).data ?? [],
  });

  const { data: brands } = useQuery({
    queryKey: ["brands-lite"],
    queryFn: async () => (await supabase.from("brands").select("id,name")).data ?? [],
  });

  // For linking to existing products
  const { data: existingProducts } = useQuery({
    queryKey: ["existing-products-link"],
    queryFn: async () =>
      (await supabase.from("products").select("id,name,sku,barcode,stock,price,purchase_price")).data ?? [],
  });

  const filtered = useMemo(() => {
    if (!searchQ.trim()) return products ?? [];
    const q = searchQ.toLowerCase();
    return (products ?? []).filter(
      (p) => p.name?.toLowerCase().includes(q) || p.sku?.toLowerCase().includes(q) || p.barcode?.toLowerCase().includes(q),
    );
  }, [searchQ, products]);

  async function save() {
    if (!editing?.name?.trim()) return toast.error("Product name is required");
    const payload = {
      name: editing.name.trim(),
      sku: editing.sku || null,
      barcode: editing.barcode || null,
      category_id: editing.category_id || null,
      subcategory: editing.subcategory || null,
      brand_id: editing.brand_id || null,
      description: editing.description || null,
      image_url: editing.image_url || null,
      size: editing.size || null,
      colour: editing.colour || null,
      material: editing.material || null,
      unit: editing.unit || "Nos",
      purchase_price: Number(editing.purchase_price) || 0,
      base_cost: Number(editing.base_cost) || 0,
      selling_price: Number(editing.selling_price) || 0,
      minimum_stock: Number(editing.minimum_stock) || 5,
      current_stock: Number(editing.current_stock) || 0,
      available_stock: Number(editing.current_stock) || 0,
      supplier_name: editing.supplier_name || null,
      gst_rate: Number(editing.gst_rate) || 0,
      status: editing.status || "ACTIVE",
      linked_product_id: editing.linked_product_id || null,
    };

    if (editing.id) {
      const { error } = await supabase.from("mc_master_products").update(payload).eq("id", editing.id);
      if (error) return toast.error(error.message);
    } else {
      const { error } = await supabase.from("mc_master_products").insert(payload);
      if (error) return toast.error(error.message);
    }
    toast.success(editing.id ? "Product updated" : "Product created");
    setEditing(null);
    qc.invalidateQueries({ queryKey: ["mc-master-products"] });
  }

  async function del(id: string) {
    if (!confirm("Delete this product? This cannot be undone.")) return;
    const { error } = await supabase.from("mc_master_products").delete().eq("id", id);
    if (error) return toast.error(error.message);
    toast.success("Product deleted");
    qc.invalidateQueries({ queryKey: ["mc-master-products"] });
  }

  async function handleImageUpload(file: File) {
    if (!file.type.startsWith("image/")) return toast.error("Select an image file");
    setUploading(true);
    try {
      const url = await uploadProductImage(file);
      setEditing((prev) => prev ? { ...prev, image_url: url } : null);
      toast.success("Image uploaded");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  }

  function autoLinkToExisting(mp: MasterProduct) {
    if (!existingProducts?.length) return toast.info("No existing products to link");
    const match = existingProducts.find(
      (ep) => (ep.sku && mp.sku && ep.sku === mp.sku) || (ep.barcode && mp.barcode && ep.barcode === mp.barcode) || ep.name?.toLowerCase() === mp.name?.toLowerCase(),
    );
    if (match) {
      setEditing((prev) => prev ? { ...prev, linked_product_id: match.id } : null);
      toast.success(`Matched with existing product: ${match.name}`);
    } else {
      toast.info("No matching existing product found");
    }
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-wrap items-center gap-3">
        <PackageSearch className="h-5 w-5 text-primary" />
        <h1 className="text-xl font-bold text-foreground flex-1">Master Product Database</h1>
        <div className="flex items-center gap-2 rounded-lg border border-border bg-white px-3 py-1.5 shadow-sm">
          <Search className="h-4 w-4 text-muted-foreground/70" />
          <input
            value={searchQ}
            onChange={(e) => setSearchQ(e.target.value)}
            placeholder="Search products…"
            className="bg-transparent text-sm outline-none w-48"
          />
        </div>
        <div className="flex gap-1 rounded-lg border border-border bg-white p-0.5 shadow-sm">
          {["ALL", ...STATUS_OPTIONS].map((s) => (
            <button
              key={s}
              onClick={() => setStatusFilter(s)}
              className={`rounded-md px-2.5 py-1 text-[11px] font-semibold transition ${
                statusFilter === s ? "bg-primary text-white" : "text-muted-foreground hover:bg-secondary-soft"
              }`}
            >
              {s}
            </button>
          ))}
        </div>
        <button
          onClick={() => setEditing({ status: "ACTIVE", unit: "Nos", minimum_stock: 5 })}
          className="flex items-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-xs font-semibold text-white hover:bg-primary/90"
        >
          <Plus className="h-3.5 w-3.5" /> Add Product
        </button>
      </div>

      {/* Products Table */}
      <div className="rounded-xl border border-border bg-white shadow-sm overflow-hidden">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="bg-muted">
              <th className="px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-muted-foreground text-center border-b border-border w-10">#</th>
              <th className="px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-muted-foreground text-left border-b border-border">Product</th>
              <th className="px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-muted-foreground text-left border-b border-border">SKU</th>
              <th className="px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-muted-foreground text-right border-b border-border">Purchase ₹</th>
              <th className="px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-muted-foreground text-right border-b border-border">Selling ₹</th>
              <th className="px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-muted-foreground text-center border-b border-border">Stock</th>
              <th className="px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-muted-foreground text-center border-b border-border">Status</th>
              <th className="px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-muted-foreground text-center border-b border-border w-20">Actions</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((p, i) => (
              <tr key={p.id} className="border-b border-border/50 last:border-0 hover:bg-secondary-soft/30 transition">
                <td className="px-3 py-2.5 text-center text-xs text-muted-foreground font-semibold">{i + 1}</td>
                <td className="px-3 py-2.5">
                  <div className="flex items-center gap-2">
                    {p.image_url ? (
                      <img src={p.image_url} alt="" className="h-8 w-8 rounded-lg object-cover border border-border" />
                    ) : (
                      <div className="h-8 w-8 rounded-lg bg-muted grid place-items-center">
                        <PackageSearch className="h-4 w-4 text-muted-foreground/50" />
                      </div>
                    )}
                    <div>
                      <div className="text-xs font-semibold text-foreground">{p.name}</div>
                      {p.linked_product_id && (
                        <div className="text-[9px] text-primary flex items-center gap-0.5">
                          <Link2 className="h-2.5 w-2.5" /> Linked
                        </div>
                      )}
                    </div>
                  </div>
                </td>
                <td className="px-3 py-2.5 text-xs text-muted-foreground font-mono">{p.sku || "—"}</td>
                <td className="px-3 py-2.5 text-xs text-right font-semibold">₹{(p.purchase_price ?? 0).toLocaleString("en-IN")}</td>
                <td className="px-3 py-2.5 text-xs text-right font-semibold">₹{(p.selling_price ?? 0).toLocaleString("en-IN")}</td>
                <td className="px-3 py-2.5 text-center">
                  <span className={`text-xs font-bold ${
                    (p.current_stock ?? 0) <= 0 ? "text-rose-600" :
                    (p.current_stock ?? 0) <= (p.minimum_stock ?? 5) ? "text-amber-600" :
                    "text-emerald-600"
                  }`}>{p.current_stock ?? 0}</span>
                </td>
                <td className="px-3 py-2.5 text-center">
                  <span className={`text-[10px] font-semibold uppercase px-2 py-0.5 rounded-full ${
                    p.status === "ACTIVE" ? "bg-green-50 text-green-700" :
                    p.status === "INACTIVE" ? "bg-gray-50 text-gray-600" :
                    p.status === "DRAFT" ? "bg-blue-50 text-blue-700" :
                    "bg-rose-50 text-rose-700"
                  }`}>{p.status}</span>
                </td>
                <td className="px-3 py-2.5">
                  <div className="flex items-center justify-center gap-1">
                    <button onClick={() => setEditing(p)} className="rounded p-1 hover:bg-secondary-soft text-xs text-primary font-semibold">Edit</button>
                    <button onClick={() => del(p.id)} className="rounded p-1 hover:bg-rose-50"><Trash2 className="h-3.5 w-3.5 text-rose-600" /></button>
                  </div>
                </td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr><td colSpan={8} className="px-6 py-12 text-center text-xs text-muted-foreground/70">
                {isLoading ? "Loading products…" : "No products found. Click 'Add Product' to create one."}
              </td></tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Edit/Create Modal */}
      {editing && (
        <div className="fixed inset-0 z-50 bg-black/40 grid place-items-center p-4" onClick={() => setEditing(null)}>
          <div className="w-full max-w-2xl rounded-2xl bg-white p-6 shadow-2xl max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-sm font-bold text-foreground">{editing.id ? "Edit Product" : "Add New Product"}</h2>
              <button onClick={() => setEditing(null)} className="rounded-lg p-1 hover:bg-secondary-soft"><X className="h-4 w-4" /></button>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Product Name" span={2}>
                <input value={editing.name || ""} onChange={(e) => setEditing({ ...editing, name: e.target.value })} className={inputCls} />
              </Field>
              <Field label="SKU">
                <input value={editing.sku || ""} onChange={(e) => setEditing({ ...editing, sku: e.target.value })} className={inputCls} />
              </Field>
              <Field label="Barcode">
                <input value={editing.barcode || ""} onChange={(e) => setEditing({ ...editing, barcode: e.target.value })} className={inputCls} />
              </Field>
              <Field label="Category">
                <select value={editing.category_id || ""} onChange={(e) => setEditing({ ...editing, category_id: e.target.value })} className={inputCls}>
                  <option value="">— Select —</option>
                  {(categories ?? []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </Field>
              <Field label="Brand">
                <select value={editing.brand_id || ""} onChange={(e) => setEditing({ ...editing, brand_id: e.target.value })} className={inputCls}>
                  <option value="">— Select —</option>
                  {(brands ?? []).map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                </select>
              </Field>
              <Field label="Subcategory">
                <input value={editing.subcategory || ""} onChange={(e) => setEditing({ ...editing, subcategory: e.target.value })} className={inputCls} />
              </Field>
              <Field label="Description">
                <textarea value={editing.description || ""} onChange={(e) => setEditing({ ...editing, description: e.target.value })} className={inputCls} rows={2} />
              </Field>
              <Field label="Size">
                <input value={editing.size || ""} onChange={(e) => setEditing({ ...editing, size: e.target.value })} className={inputCls} />
              </Field>
              <Field label="Colour">
                <input value={editing.colour || ""} onChange={(e) => setEditing({ ...editing, colour: e.target.value })} className={inputCls} />
              </Field>
              <Field label="Material">
                <input value={editing.material || ""} onChange={(e) => setEditing({ ...editing, material: e.target.value })} className={inputCls} />
              </Field>
              <Field label="Unit">
                <select value={editing.unit || "Nos"} onChange={(e) => setEditing({ ...editing, unit: e.target.value })} className={inputCls}>
                  {["Nos", "Packet", "Unit", "Kilogram", "Gram", "Liter", "ML", "Meter"].map((u) => <option key={u} value={u}>{u}</option>)}
                </select>
              </Field>
              <Field label="Purchase Price (₹)">
                <input type="number" value={editing.purchase_price ?? 0} onChange={(e) => setEditing({ ...editing, purchase_price: Number(e.target.value) })} className={inputCls} />
              </Field>
              <Field label="Base Cost (₹)">
                <input type="number" value={editing.base_cost ?? 0} onChange={(e) => setEditing({ ...editing, base_cost: Number(e.target.value) })} className={inputCls} />
              </Field>
              <Field label="Selling Price (₹)">
                <input type="number" value={editing.selling_price ?? 0} onChange={(e) => setEditing({ ...editing, selling_price: Number(e.target.value) })} className={inputCls} />
              </Field>
              <Field label="GST %">
                <input type="number" value={editing.gst_rate ?? 0} onChange={(e) => setEditing({ ...editing, gst_rate: Number(e.target.value) })} className={inputCls} />
              </Field>
              <Field label="Minimum Stock">
                <input type="number" value={editing.minimum_stock ?? 5} onChange={(e) => setEditing({ ...editing, minimum_stock: Number(e.target.value) })} className={inputCls} />
              </Field>
              <Field label="Current Stock">
                <input type="number" value={editing.current_stock ?? 0} onChange={(e) => setEditing({ ...editing, current_stock: Number(e.target.value) })} className={inputCls} />
              </Field>
              <Field label="Supplier Name">
                <input value={editing.supplier_name || ""} onChange={(e) => setEditing({ ...editing, supplier_name: e.target.value })} className={inputCls} />
              </Field>
              <Field label="Status">
                <select value={editing.status || "ACTIVE"} onChange={(e) => setEditing({ ...editing, status: e.target.value })} className={inputCls}>
                  {STATUS_OPTIONS.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
              </Field>
              <Field label="Image" span={2}>
                <div className="flex items-center gap-2">
                  {editing.image_url && <img src={editing.image_url} alt="" className="h-10 w-10 rounded-lg object-cover border" />}
                  <label className="cursor-pointer text-xs text-primary font-semibold hover:underline">
                    <input type="file" accept="image/*" className="sr-only" onChange={(e) => { const f = e.target.files?.[0]; if (f) handleImageUpload(f); }} />
                    {uploading ? <Loader2 className="h-4 w-4 animate-spin inline" /> : "Upload Image"}
                  </label>
                  {editing.image_url && (
                    <button onClick={() => setEditing({ ...editing, image_url: null })} className="text-rose-500 text-xs hover:underline">Remove</button>
                  )}
                </div>
              </Field>
              <Field label="Link to Existing Product" span={2}>
                <div className="flex items-center gap-2">
                  <select
                    value={editing.linked_product_id || ""}
                    onChange={(e) => setEditing({ ...editing, linked_product_id: e.target.value || null })}
                    className={inputCls}
                  >
                    <option value="">— No link —</option>
                    {(existingProducts ?? []).map((ep) => (
                      <option key={ep.id} value={ep.id}>{ep.name} ({ep.sku || ep.barcode || "no code"})</option>
                    ))}
                  </select>
                  <button onClick={() => autoLinkToExisting(editing as MasterProduct)} className="rounded-lg border border-border px-2 py-2 text-xs font-semibold text-primary hover:bg-primary/5 whitespace-nowrap" title="Auto-detect matching product">
                    <Link2 className="h-3.5 w-3.5 inline mr-1" /> Auto-Link
                  </button>
                </div>
              </Field>
            </div>
            <div className="flex justify-end gap-2 mt-4 pt-3 border-t border-border">
              <button onClick={() => setEditing(null)} className="rounded-lg border border-border px-4 py-2 text-xs font-semibold text-muted-foreground hover:bg-secondary-soft">Cancel</button>
              <button onClick={save} className="rounded-lg bg-primary px-5 py-2 text-xs font-semibold text-white hover:bg-primary/90">
                {editing.id ? "Update Product" : "Create Product"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Field({ label, span, children }: { label: string; span?: number; children: React.ReactNode }) {
  return (
    <div className={span === 2 ? "col-span-2 space-y-1" : "space-y-1"}>
      <label className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">{label}</label>
      {children}
    </div>
  );
}

const inputCls = "w-full rounded-lg border border-border bg-white px-3 py-2 text-sm outline-none focus:border-primary";
