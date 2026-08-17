import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useState } from "react";
import { Plus, Edit3, Trash2, Search, Upload, Image, X } from "lucide-react";
import { toast } from "sonner";
import { uploadProductImage, deleteProductImages } from "@/lib/upload";

export const Route = createFileRoute("/admin/products")({
  head: () => ({ meta: [{ title: "Products — ACH Admin" }] }),
  component: Products,
});

type Product = {
  id: string; name: string; slug: string; price: number; discount_price: number | null; stock: number;
  is_available: boolean; sku: string | null; barcode: string | null; category_id: string | null;
  gst_rate: number | null; reorder_level: number; image_urls: string[];
};

function Products() {
  const qc = useQueryClient();
  const [q, setQ] = useState("");
  const [editing, setEditing] = useState<Partial<Product> | null>(null);
  const [uploading, setUploading] = useState<string | null>(null);

  const { data: products } = useQuery({
    queryKey: ["admin-products", q],
    queryFn: async () => {
      let query = supabase.from("products").select("*").order("created_at", { ascending: false });
      if (q.trim()) query = query.ilike("name", `%${q}%`);
      const { data } = await query;
      return (data ?? []) as Product[];
    },
  });
  const { data: categories } = useQuery({
    queryKey: ["cats"], queryFn: async () => (await supabase.from("categories").select("id,name")).data ?? [],
  });

  async function save() {
    if (!editing?.name) return toast.error("Name required");
    const payload = {
      name: editing.name,
      slug: (editing.slug || editing.name).toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, ""),
      price: Number(editing.price ?? 0),
      discount_price: editing.discount_price ? Number(editing.discount_price) : null,
      stock: Number(editing.stock ?? 0),
      sku: editing.sku || null,
      barcode: editing.barcode || null,
      gst_rate: Number(editing.gst_rate ?? 0),
      reorder_level: Number(editing.reorder_level ?? 5),
      category_id: editing.category_id || null,
      is_available: editing.is_available ?? true,
      image_urls: editing.image_urls ?? [],
    };
    const res = editing.id
      ? await supabase.from("products").update(payload).eq("id", editing.id)
      : await supabase.from("products").insert(payload);
    if (res.error) return toast.error(res.error.message);
    toast.success("Saved");
    setEditing(null);
    qc.invalidateQueries({ queryKey: ["admin-products"] });
  }

  async function del(id: string) {
    if (!confirm("Delete this product?")) return;

    // First, get the product to find its images
    const { data: product } = await supabase.from("products").select("image_urls").eq("id", id).single();

    // Delete the product
    const { error } = await supabase.from("products").delete().eq("id", id);
    if (error) return toast.error(error.message);

    // Delete associated images from storage
    if (product?.image_urls?.length) {
      await deleteProductImages(product.image_urls);
    }

    toast.success("Deleted");
    qc.invalidateQueries({ queryKey: ["admin-products"] });
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="text-xl font-bold text-slate-900 flex-1">Products</h1>
        <div className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-1.5 shadow-sm">
          <Search className="h-4 w-4 text-slate-400" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search products…" className="bg-transparent text-sm outline-none w-56" />
        </div>
        <button onClick={() => setEditing({ is_available: true, gst_rate: 0, reorder_level: 5, image_urls: [] })}
          className="flex items-center gap-1.5 rounded-lg bg-slate-900 px-3 py-2 text-xs font-semibold text-white">
          <Plus className="h-3.5 w-3.5" /> Add Product
        </button>
      </div>

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-[11px] uppercase tracking-wider text-slate-500">
            <tr><th className="p-3 text-left">S.No.</th><th className="p-3 text-left">Product</th><th className="p-3 text-left">SKU</th><th className="p-3 text-right">Price</th><th className="p-3 text-right">Stock</th><th className="p-3 text-left">Status</th><th className="p-3 w-24"></th></tr>
          </thead>
          <tbody>
            {(products ?? []).map((p, i) => (
              <tr key={p.id} className="border-t border-slate-100">
                <td className="p-3 text-xs font-semibold text-slate-500 w-10">{i + 1}</td>
                <td className="p-3">
                  <div className="flex items-center gap-3">
                    <div className="h-9 w-9 overflow-hidden rounded-lg bg-slate-100">
                      {p.image_urls?.[0] && <img src={p.image_urls[0]} alt="" className="h-full w-full object-cover" />}
                    </div>
                    <div>
                      <div className="text-sm font-semibold text-slate-800">{p.name}</div>
                      <div className="text-[10px] text-slate-500">{p.barcode ?? "—"}</div>
                    </div>
                  </div>
                </td>
                <td className="p-3 text-xs text-slate-600">{p.sku ?? "—"}</td>
                <td className="p-3 text-right text-sm font-semibold">₹{Number(p.discount_price ?? p.price)}</td>
                <td className={`p-3 text-right text-sm font-semibold ${p.stock <= 0 ? "text-rose-600" : p.stock <= p.reorder_level ? "text-amber-600" : "text-emerald-600"}`}>{p.stock}</td>
                <td className="p-3">
                  <span className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold ${p.is_available && p.stock > 0 ? "bg-emerald-100 text-emerald-700" : "bg-rose-100 text-rose-700"}`}>
                    {p.stock <= 0 ? "Out of stock" : p.is_available ? "Active" : "Hidden"}
                  </span>
                </td>
                <td className="p-3">
                  <div className="flex items-center gap-1">
                    <button onClick={() => setEditing(p)} className="rounded p-1.5 hover:bg-slate-100"><Edit3 className="h-3.5 w-3.5 text-slate-600" /></button>
                    <button onClick={() => del(p.id)} className="rounded p-1.5 hover:bg-rose-50"><Trash2 className="h-3.5 w-3.5 text-rose-600" /></button>
                  </div>
                </td>
              </tr>
            ))}
            {!products?.length && <tr><td colSpan={7} className="p-8 text-center text-xs text-slate-400">No products yet</td></tr>}
          </tbody>
        </table>
      </div>

      {editing && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 grid place-items-center p-4" onClick={() => setEditing(null)}>
          <div className="w-full max-w-2xl rounded-2xl bg-white p-6 shadow-2xl max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-lg font-bold">{editing.id ? "Edit Product" : "Add Product"}</h2>
              <button onClick={() => setEditing(null)} className="text-slate-400">✕</button>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Name" className="col-span-2"><input value={editing.name ?? ""} onChange={(e) => setEditing({ ...editing, name: e.target.value })} className={inputCls} /></Field>
              <Field label="SKU"><input value={editing.sku ?? ""} onChange={(e) => setEditing({ ...editing, sku: e.target.value })} className={inputCls} /></Field>
              <Field label="Barcode"><input value={editing.barcode ?? ""} onChange={(e) => setEditing({ ...editing, barcode: e.target.value })} className={inputCls} /></Field>
              <Field label="Price (₹)"><input type="number" value={editing.price ?? ""} onChange={(e) => setEditing({ ...editing, price: Number(e.target.value) })} className={inputCls} /></Field>
              <Field label="Discount Price (₹)"><input type="number" value={editing.discount_price ?? ""} onChange={(e) => setEditing({ ...editing, discount_price: Number(e.target.value) })} className={inputCls} /></Field>
              <Field label="Stock"><input type="number" value={editing.stock ?? ""} onChange={(e) => setEditing({ ...editing, stock: Number(e.target.value) })} className={inputCls} /></Field>
              <Field label="Reorder Level"><input type="number" value={editing.reorder_level ?? 5} onChange={(e) => setEditing({ ...editing, reorder_level: Number(e.target.value) })} className={inputCls} /></Field>
              <Field label="GST %"><input type="number" value={editing.gst_rate ?? 0} onChange={(e) => setEditing({ ...editing, gst_rate: Number(e.target.value) })} className={inputCls} /></Field>
              <Field label="Category">
                <select value={editing.category_id ?? ""} onChange={(e) => setEditing({ ...editing, category_id: e.target.value })} className={inputCls}>
                  <option value="">— none —</option>
                  {(categories ?? []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </Field>
              <Field label="Product Image" className="col-span-2">
                <div className="space-y-2">
                  {/* Current image preview */}
                  {editing.image_urls?.[0] && (
                    <div className="flex items-center gap-2 p-2 bg-slate-50 rounded-lg">
                      <img
                        src={editing.image_urls[0]}
                        alt="Current"
                        className="h-16 w-16 object-cover rounded"
                      />
                      <span className="text-sm text-slate-600 flex-1">Current image</span>
                      <button
                        type="button"
                        onClick={() => setEditing({ ...editing, image_urls: [] })}
                        className="text-rose-600 hover:text-rose-700 text-sm font-medium"
                      >
                        Remove
                      </button>
                    </div>
                  )}

                  {/* Upload area */}
                  <label className="flex flex-col items-center justify-center p-6 border-2 border-dashed border-slate-300 rounded-lg cursor-pointer hover:border-secondary hover:bg-slate-50 transition-colors">
                    <input
                      type="file"
                      accept="image/*"
                      className="sr-only"
                      onChange={async (e) => {
                        const file = e.target.files?.[0];
                        if (!file) return;

                        // Validate file type
                        if (!file.type.startsWith("image/")) {
                          toast.error("Please select an image file");
                          return;
                        }

                        // Validate file size (5MB)
                        if (file.size > 5 * 1024 * 1024) {
                          toast.error("Image must be less than 5MB");
                          return;
                        }

                        setUploading(file.name);
                        try {
                          const imageUrl = await uploadProductImage(file, editing.id || undefined);
                          setEditing({ ...editing, image_urls: [imageUrl] });
                          toast.success("Image uploaded successfully");
                        } catch (err) {
                          toast.error(err instanceof Error ? err.message : "Failed to upload image");
                        } finally {
                          setUploading(null);
                          // Reset the input so the same file can be uploaded again if needed
                          e.target.value = "";
                        }
                      }}
                    />
                    {uploading ? (
                      <div className="flex flex-col items-center gap-2">
                        <div className="animate-spin rounded-full h-8 w-8 border-2 border-secondary border-t-transparent" />
                        <span className="text-sm text-slate-600">Uploading {uploading}...</span>
                      </div>
                    ) : (
                      <div className="flex flex-col items-center gap-2">
                        <Upload className="h-8 w-8 text-slate-400" />
                        <span className="text-sm font-medium text-slate-700">Click to upload or drag & drop</span>
                        <span className="text-xs text-slate-500">PNG, JPG, WebP up to 5MB</span>
                      </div>
                    )}
                  </label>

                  {/* Or URL input */}
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400">����</span>
                    <input
                      type="url"
                      value={editing.image_urls?.[0] ?? ""}
                      onChange={(e) => setEditing({ ...editing, image_urls: e.target.value ? [e.target.value] : [] })}
                      className={`${inputCls} pl-9`}
                      placeholder="Or enter image URL (https://...)"
                    />
                  </div>
                </div>
              </Field>
              <label className="col-span-2 flex items-center gap-2 text-sm">
                <input type="checkbox" checked={editing.is_available ?? true} onChange={(e) => setEditing({ ...editing, is_available: e.target.checked })} />
                Active (visible in shop)
              </label>
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <button onClick={() => setEditing(null)} className="rounded-lg border border-slate-200 px-4 py-2 text-sm">Cancel</button>
              <button onClick={save} className="rounded-lg bg-slate-900 px-5 py-2 text-sm font-semibold text-white">Save</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const inputCls = "w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-secondary";
function Field({ label, children, className = "" }: { label: string; children: React.ReactNode; className?: string }) {
  return <label className={`block ${className}`}><span className="mb-1 block text-[11px] font-semibold text-slate-600">{label}</span>{children}</label>;
}
