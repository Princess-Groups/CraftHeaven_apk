import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useState } from "react";
import { Plus, Edit3, Trash2, Search, Upload, Image, X, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { uploadProductImage, deleteProductImages } from "@/lib/upload";

export const Route = createFileRoute("/admin/products")({
  head: () => ({ meta: [{ title: "Products — ACH Admin" }] }),
  component: Products,
});

type ColorVariation = { color: string; image_url: string };

const UNITS = ["Nos", "KG", "G", "L", "ML", "M", "CM"] as const;

type Product = {
  id: string;
  name: string;
  slug: string;
  price: number;
  discount_price: number | null;
  stock: number;
  unit: string;
  is_available: boolean;
  sku: string | null;
  barcode: string | null;
  category_id: string | null;
  gst_rate: number | null;
  cgst_rate: number | null;
  sgst_rate: number | null;
  igst_rate: number | null;
  purchase_price: number | null;
  reorder_level: number;
  image_urls: string[];
  color: string | null;
  size: string | null;
  color_variations: ColorVariation[];
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
      return (data ?? []) as unknown as Product[];
    },
  });
  const { data: categories } = useQuery({
    queryKey: ["cats"],
    queryFn: async () => (await supabase.from("categories").select("id,name")).data ?? [],
  });

  function mapVariations(v: unknown): ColorVariation[] {
    if (!Array.isArray(v)) return [];
    return (v as any[])
      .filter((x) => x && typeof x === "object")
      .map((x) => ({
        color: String(x.color ?? ""),
        image_url: String(x.image_url ?? ""),
      }));
  }

  function upsertVariation(
    patch: Partial<Product>,
    idx: number,
    v: Partial<ColorVariation>,
  ): Partial<Product> {
    const vars = mapVariations(patch.color_variations);
    vars[idx] = { ...vars[idx], ...v };
    return { ...patch, color_variations: vars };
  }

  // Set the rates on the product whenever CGST/SGST change, so the single
  // "GST %" also reflects the current split.
  function applySplitGst(patch: Partial<Product>): Partial<Product> {
    const cg = Number(patch.cgst_rate ?? 0);
    const sg = Number(patch.sgst_rate ?? 0);
    const ig = Number(patch.igst_rate ?? 0);
    const total = ig > 0 ? ig : cg + sg;
    return { ...patch, gst_rate: total };
  }

  async function save() {
    if (!editing?.name) return toast.error("Name required");
    const payload = {
      name: editing.name,
      slug: (editing.slug || editing.name)
        .toLowerCase()
        .replace(/\s+/g, "-")
        .replace(/[^a-z0-9-]/g, ""),
      price: Number(editing.price ?? 0),
      discount_price: editing.discount_price ? Number(editing.discount_price) : null,
      stock: Number(editing.stock ?? 0),
      sku: editing.sku || null,
      barcode: editing.barcode || null,
      gst_rate: Number(editing.gst_rate ?? 0),
      cgst_rate: Number(editing.cgst_rate ?? 0),
      sgst_rate: Number(editing.sgst_rate ?? 0),
      igst_rate: Number(editing.igst_rate ?? 0),
      purchase_price: editing.purchase_price ? Number(editing.purchase_price) : null,
      reorder_level: Number(editing.reorder_level ?? 5),
      category_id: editing.category_id || null,
      is_available: editing.is_available ?? true,
      image_urls: editing.image_urls ?? [],
      color: editing.color || null,
      size: editing.size || null,
      unit: editing.unit || "Nos",
      color_variations: mapVariations(editing.color_variations),
    };
    const res = editing.id
      ? await supabase.from("products").update(payload).eq("id", editing.id)
      : await supabase.from("products").insert(payload);
    if (res.error) return toast.error(res.error.message);
    toast.success("Saved");
    setEditing(null);
    qc.invalidateQueries();
  }

  async function del(id: string) {
    if (!confirm("Delete this product?")) return;

    // First, get the product to find its images
    const { data: product } = await supabase
      .from("products")
      .select("image_urls")
      .eq("id", id)
      .single();

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
        <h1 className="text-xl font-bold text-foreground flex-1">Products</h1>
        <div className="flex items-center gap-2 rounded-lg border border-border bg-white px-3 py-1.5 shadow-sm">
          <Search className="h-4 w-4 text-muted-foreground/70" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search products…"
            className="bg-transparent text-sm outline-none w-56"
          />
        </div>
        <button
          onClick={() =>
            setEditing({
              is_available: true,
              gst_rate: 0,
              cgst_rate: 0,
              sgst_rate: 0,
              igst_rate: 0,
              unit: "Nos",
              reorder_level: 5,
              image_urls: [],
              color_variations: [],
            })
          }
          className="flex items-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-xs font-semibold text-white"
        >
          <Plus className="h-3.5 w-3.5" /> Add Product
        </button>
      </div>

      <div className="overflow-hidden rounded-xl border border-border bg-white shadow-sm">
        <table className="w-full text-sm">
          <thead className="bg-muted text-[11px] uppercase tracking-wider text-muted-foreground">
            <tr>
              <th className="p-3 text-left">S.No.</th>
              <th className="p-3 text-left">Product</th>
              <th className="p-3 text-left">SKU</th>
              <th className="p-3 text-left">Color / Variations</th>
              <th className="p-3 text-right">Purchase Price</th>
              <th className="p-3 text-right">Price</th>
              <th className="p-3 text-right">Stock</th>
              <th className="p-3 text-left">Status</th>
              <th className="p-3 w-24"></th>
            </tr>
          </thead>
          <tbody>
            {(products ?? []).map((p, i) => (
              <tr key={p.id} className="border-t border-border">
                <td className="p-3 text-xs font-semibold text-muted-foreground w-10">{i + 1}</td>
                <td className="p-3">
                  <div className="flex items-center gap-3">
                    <div className="h-9 w-9 overflow-hidden rounded-lg bg-secondary-soft">
                      {p.image_urls?.[0] && (
                        <img src={p.image_urls[0]} alt="" className="h-full w-full object-cover" />
                      )}
                    </div>
                    <div>
                      <div className="text-sm font-semibold text-foreground">{p.name}</div>
                      <div className="text-[10px] text-muted-foreground">{p.barcode ?? "—"}</div>
                    </div>
                  </div>
                </td>
                <td className="p-3 text-xs text-muted-foreground">{p.sku ?? "—"}</td>
                <td className="p-3">
                  <div className="flex flex-wrap items-center gap-1">
                    {p.color ? (
                      <span className="rounded bg-secondary-soft px-1.5 py-0.5 text-[10px] font-semibold text-muted-foreground">
                        {p.color}
                      </span>
                    ) : null}
                    {mapVariations(p.color_variations)
                      .filter((v) => v.color)
                      .slice(0, 3)
                      .map((v) => (
                        <span
                          key={v.color}
                          className="flex items-center gap-1 rounded bg-emerald-50 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-700"
                        >
                          {v.image_url ? (
                            <img
                              src={v.image_url}
                              alt=""
                              className="h-3 w-3 rounded-full object-cover"
                            />
                          ) : null}
                          {v.color}
                        </span>
                      ))}
                    {mapVariations(p.color_variations).filter((v) => v.color).length > 3 ? (
                      <span className="text-[10px] text-muted-foreground/70">
                        +{mapVariations(p.color_variations).filter((v) => v.color).length - 3}
                      </span>
                    ) : null}
                  </div>
                </td>
                <td className="p-3 text-right text-xs text-muted-foreground">
                  {p.purchase_price != null ? `₹${Number(p.purchase_price).toFixed(0)}` : "—"}
                </td>
                <td className="p-3 text-right text-sm font-semibold">
                  ₹{Number(p.discount_price ?? p.price)}
                </td>
                <td
                  className={`p-3 text-right text-sm font-semibold ${p.stock <= 0 ? "text-rose-600" : p.stock <= p.reorder_level ? "text-amber-600" : "text-emerald-600"}`}
                >
                  <span className="whitespace-nowrap">
                    {p.stock} {p.unit}
                  </span>
                </td>
                <td className="p-3">
                  <span
                    className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold ${p.is_available && p.stock > 0 ? "bg-emerald-100 text-emerald-700" : "bg-rose-100 text-rose-700"}`}
                  >
                    {p.stock <= 0 ? "Out of stock" : p.is_available ? "Active" : "Hidden"}
                  </span>
                </td>
                <td className="p-3">
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() =>
                        setEditing({ ...p, color_variations: mapVariations(p.color_variations) })
                      }
                      className="rounded p-1.5 hover:bg-secondary-soft"
                    >
                      <Edit3 className="h-3.5 w-3.5 text-muted-foreground" />
                    </button>
                    <button onClick={() => del(p.id)} className="rounded p-1.5 hover:bg-rose-50">
                      <Trash2 className="h-3.5 w-3.5 text-rose-600" />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {!products?.length && (
              <tr>
                <td colSpan={9} className="p-8 text-center text-xs text-muted-foreground/70">
                  No products yet
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {editing && (
        <div
          className="fixed inset-0 z-50 bg-primary/45 grid place-items-center p-4"
          onClick={() => setEditing(null)}
        >
          <div
            className="w-full max-w-2xl rounded-2xl bg-white p-6 shadow-2xl max-h-[90vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-lg font-bold">{editing.id ? "Edit Product" : "Add Product"}</h2>
              <button onClick={() => setEditing(null)} className="text-muted-foreground/70">
                ✕
              </button>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Name" className="col-span-2">
                <input
                  value={editing.name ?? ""}
                  onChange={(e) => setEditing({ ...editing, name: e.target.value })}
                  className={inputCls}
                />
              </Field>
              <Field label="SKU">
                <input
                  value={editing.sku ?? ""}
                  onChange={(e) => setEditing({ ...editing, sku: e.target.value })}
                  className={inputCls}
                />
              </Field>
              <Field label="Barcode">
                <input
                  value={editing.barcode ?? ""}
                  onChange={(e) => setEditing({ ...editing, barcode: e.target.value })}
                  className={inputCls}
                />
              </Field>
              <Field label="Purchase Price (₹) — what you paid">
                <input
                  type="number"
                  min={0}
                  value={editing.purchase_price ?? ""}
                  onChange={(e) =>
                    setEditing({ ...editing, purchase_price: Number(e.target.value) })
                  }
                  className={inputCls}
                />
              </Field>
              <Field label="Price / Selling Price (₹)">
                <input
                  type="number"
                  min={0}
                  value={editing.price ?? ""}
                  onChange={(e) => setEditing({ ...editing, price: Number(e.target.value) })}
                  className={inputCls}
                />
              </Field>
              <Field label="Discount Price (₹)">
                <input
                  type="number"
                  value={editing.discount_price ?? ""}
                  onChange={(e) =>
                    setEditing({ ...editing, discount_price: Number(e.target.value) })
                  }
                  className={inputCls}
                />
              </Field>
              <Field label="Stock (decimal supported)">
                <div className="flex gap-2">
                  <input
                    type="number"
                    step="0.001"
                    min={0}
                    value={editing.stock ?? ""}
                    onChange={(e) => setEditing({ ...editing, stock: Number(e.target.value) })}
                    className={inputCls}
                  />
                  <select
                    value={editing.unit || "Nos"}
                    onChange={(e) => setEditing({ ...editing, unit: e.target.value })}
                    className={`${inputCls} w-24`}
                  >
                    {UNITS.map((u) => (
                      <option key={u} value={u}>
                        {u}
                      </option>
                    ))}
                  </select>
                </div>
              </Field>
              <Field label="Reorder Level">
                <input
                  type="number"
                  value={editing.reorder_level ?? 5}
                  onChange={(e) =>
                    setEditing({ ...editing, reorder_level: Number(e.target.value) })
                  }
                  className={inputCls}
                />
              </Field>
              <Field label="Color">
                <input
                  value={editing.color ?? ""}
                  onChange={(e) => setEditing({ ...editing, color: e.target.value })}
                  className={inputCls}
                  placeholder="e.g. Pink"
                />
              </Field>
              <Field label="Size / Variant">
                <input
                  value={editing.size ?? ""}
                  onChange={(e) => setEditing({ ...editing, size: e.target.value })}
                  className={inputCls}
                  placeholder="e.g. M"
                />
              </Field>
              <Field label="CGST / Central Tax (%)">
                <input
                  type="number"
                  min={0}
                  step="0.01"
                  value={editing.cgst_rate ?? 0}
                  onChange={(e) =>
                    setEditing(applySplitGst({ ...editing, cgst_rate: Number(e.target.value) }))
                  }
                  className={inputCls}
                  placeholder="e.g. 9"
                />
              </Field>
              <Field label="SGST / State Tax (%)">
                <input
                  type="number"
                  min={0}
                  step="0.01"
                  value={editing.sgst_rate ?? 0}
                  onChange={(e) =>
                    setEditing(applySplitGst({ ...editing, sgst_rate: Number(e.target.value) }))
                  }
                  className={inputCls}
                  placeholder="e.g. 9"
                />
              </Field>
              <Field label="IGST / Inter-State (%)">
                <input
                  type="number"
                  min={0}
                  step="0.01"
                  value={editing.igst_rate ?? 0}
                  onChange={(e) =>
                    setEditing(applySplitGst({ ...editing, igst_rate: Number(e.target.value) }))
                  }
                  className={inputCls}
                  placeholder="e.g. 18"
                />
              </Field>
              <Field label="Category">
                <select
                  value={editing.category_id ?? ""}
                  onChange={(e) => setEditing({ ...editing, category_id: e.target.value })}
                  className={inputCls}
                >
                  <option value="">— none —</option>
                  {(categories ?? []).map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Product Image" className="col-span-2">
                <div className="space-y-2">
                  {/* Current image preview */}
                  {editing.image_urls?.[0] && (
                    <div className="flex items-center gap-2 p-2 bg-muted rounded-lg">
                      <img
                        src={editing.image_urls[0]}
                        alt="Current"
                        className="h-16 w-16 object-cover rounded"
                      />
                      <span className="text-sm text-muted-foreground flex-1">Current image</span>
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
                  <label className="flex flex-col items-center justify-center p-6 border-2 border-dashed border-border rounded-lg cursor-pointer hover:border-secondary hover:bg-muted transition-colors">
                    <input
                      type="file"
                      accept="image/*"
                      className="sr-only"
                      onChange={async (e) => {
                        const file = e.target.files?.[0];
                        if (!file) return;
                        if (!file.type.startsWith("image/"))
                          return toast.error("Please select an image file");
                        if (file.size > 5 * 1024 * 1024)
                          return toast.error("Image must be less than 5MB");
                        setUploading(file.name);
                        try {
                          const imageUrl = await uploadProductImage(file, editing.id || undefined);
                          setEditing({ ...editing, image_urls: [imageUrl] });
                          toast.success("Image uploaded successfully");
                        } catch (err) {
                          toast.error(
                            err instanceof Error ? err.message : "Failed to upload image",
                          );
                        } finally {
                          setUploading(null);
                          e.target.value = "";
                        }
                      }}
                    />
                    {uploading ? (
                      <div className="flex flex-col items-center gap-2">
                        <Loader2 className="h-8 w-8 animate-spin text-secondary" />
                        <span className="text-sm text-muted-foreground">
                          Uploading {uploading}...
                        </span>
                      </div>
                    ) : (
                      <div className="flex flex-col items-center gap-2">
                        <Upload className="h-8 w-8 text-muted-foreground/70" />
                        <span className="text-sm font-medium text-foreground/90">
                          Click to upload or drag & drop
                        </span>
                        <span className="text-xs text-muted-foreground">
                          PNG, JPG, WebP up to 5MB
                        </span>
                      </div>
                    )}
                  </label>

                  {/* Or URL input */}
                  <div className="relative">
                    <Image className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground/70" />
                    <input
                      type="url"
                      value={editing.image_urls?.[0] ?? ""}
                      onChange={(e) =>
                        setEditing({
                          ...editing,
                          image_urls: e.target.value ? [e.target.value] : [],
                        })
                      }
                      className={`${inputCls} pl-9`}
                      placeholder="Or enter image URL (https://...)"
                    />
                  </div>
                </div>
              </Field>

              {/* Color variations — each with its own photo */}
              <Field
                label="Color Variations (each colour can carry its own photo)"
                className="col-span-2"
              >
                <div className="space-y-2">
                  {mapVariations(editing.color_variations).map((v, vi) => (
                    <div
                      key={vi}
                      className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-muted p-2"
                    >
                      <input
                        value={v.color}
                        onChange={(e) =>
                          setEditing(upsertVariation({ ...editing }, vi, { color: e.target.value }))
                        }
                        className={`${inputCls} max-w-[140px]`}
                        placeholder={`Colour ${vi + 1} (e.g. Pink)`}
                      />
                      {v.image_url ? (
                        <img
                          src={v.image_url}
                          alt={v.color}
                          className="h-10 w-10 rounded object-cover"
                        />
                      ) : (
                        <span className="text-[10px] text-muted-foreground/70">no photo</span>
                      )}
                      <label className="flex cursor-pointer items-center gap-1.5 rounded-lg border border-border bg-white px-2.5 py-1.5 text-[11px] font-semibold text-muted-foreground hover:border-secondary">
                        <input
                          type="file"
                          accept="image/*"
                          className="sr-only"
                          onChange={async (e) => {
                            const f = e.target.files?.[0];
                            if (!f) return;
                            if (!f.type.startsWith("image/"))
                              return toast.error("Please select an image file");
                            if (f.size > 5 * 1024 * 1024)
                              return toast.error("Image must be less than 5MB");
                            setUploading(`var:${vi}`);
                            try {
                              const url = await uploadProductImage(f, editing.id || undefined);
                              setEditing(upsertVariation({ ...editing }, vi, { image_url: url }));
                              toast.success("Variation photo uploaded");
                            } catch (err) {
                              toast.error(
                                err instanceof Error ? err.message : "Failed to upload image",
                              );
                            } finally {
                              setUploading(null);
                              e.target.value = "";
                            }
                          }}
                        />
                        <Upload className="h-3.5 w-3.5" />
                        {v.image_url ? "Change" : "Add photo"}
                      </label>
                      <button
                        onClick={() =>
                          setEditing({
                            ...editing,
                            color_variations: mapVariations(editing.color_variations).filter(
                              (_, k) => k !== vi,
                            ),
                          })
                        }
                        className="ml-auto text-rose-500 hover:text-rose-700"
                        type="button"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  ))}
                  <button
                    onClick={() =>
                      setEditing({
                        ...editing,
                        color_variations: [
                          ...mapVariations(editing.color_variations),
                          { color: "", image_url: "" },
                        ],
                      })
                    }
                    className="flex items-center gap-1 text-xs font-semibold text-secondary"
                    type="button"
                  >
                    <Plus className="h-3.5 w-3.5" /> Add variation
                  </button>
                </div>
              </Field>
              <label className="col-span-2 flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={editing.is_available ?? true}
                  onChange={(e) => setEditing({ ...editing, is_available: e.target.checked })}
                />
                Active (visible in shop)
              </label>
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <button
                onClick={() => setEditing(null)}
                className="rounded-lg border border-border px-4 py-2 text-sm"
              >
                Cancel
              </button>
              <button
                onClick={save}
                className="rounded-lg bg-primary px-5 py-2 text-sm font-semibold text-white"
              >
                Save
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const inputCls =
  "w-full rounded-lg border border-border px-3 py-2 text-sm outline-none focus:border-secondary bg-white";
function Field({
  label,
  children,
  className = "",
}: {
  label: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <label className={`block ${className}`}>
      <span className="mb-1 block text-[11px] font-semibold text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}
