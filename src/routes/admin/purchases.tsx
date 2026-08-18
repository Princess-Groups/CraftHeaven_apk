import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { Json } from "@/integrations/supabase/types";
import { useState } from "react";
import { Plus, Trash2, Pencil, Eye, Upload, Loader2, X } from "lucide-react";
import { toast } from "sonner";
import { uploadProductImage } from "@/lib/upload";

export const Route = createFileRoute("/admin/purchases")({
  head: () => ({ meta: [{ title: "Purchase Entry — ACH Admin" }] }),
  component: Purchases,
});

// Local key for line rows — used only as a React key, never stored in the DB.
function uid(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return "row-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 8);
}

type ColorVariation = { color: string; image_url: string };

type Line = {
  id: string;
  product_id: string; // linked product when editing an existing purchase line
  name: string;
  sku: string;
  category_id: string;
  brand_id: string;
  color: string;
  color_variations: ColorVariation[]; // multiple colour variants, each with its own photo
  size: string;
  quantity: number;
  unit: string; // Nos | KG | G | L | ML | M | CM — mandatory per line
  unit_cost: number; // purchase price per unit — stays independent from selling price
  selling_price: number;
  cgst_rate: number; // Central Tax %
  sgst_rate: number; // State Tax %
  igst_rate: number; // Inter-state Tax % (used when > 0)
  image_url: string; // main product photo
};

const blankLine = (): Line => ({
  id: uid(),
  product_id: "",
  name: "",
  sku: "",
  category_id: "",
  brand_id: "",
  color: "",
  color_variations: [],
  size: "",
  quantity: 1,
  unit: "Nos",
  unit_cost: 0,
  selling_price: 0,
  cgst_rate: 0,
  sgst_rate: 0,
  igst_rate: 0,
  image_url: "",
});

type PurchaseItemRow = {
  id: string;
  product_id: string;
  quantity: number;
  unit: string;
  unit_cost: number;
  line_total: number;
  products: {
    name: string;
    sku: string | null;
    unit: string | null;
    color: string | null;
    size: string | null;
    category_id: string | null;
    brand_id: string | null;
    price: number | null;
    purchase_price: number | null;
    cgst_rate: number | null;
    sgst_rate: number | null;
    igst_rate: number | null;
    image_urls: string[] | null;
    color_variations: Json | null;
  } | null;
};
type PurchaseRow = {
  id: string;
  invoice_no: string | null;
  purchase_date: string;
  total: number;
  tax: number;
  supplier_id: string | null;
  suppliers: { name: string } | null;
  purchase_items: PurchaseItemRow[] | null;
};

function Purchases() {
  const qc = useQueryClient();

  // --- Form state ---------------------------------------------------------
  const [supplier, setSupplier] = useState("");
  const [invoiceNo, setInvoiceNo] = useState("");
  const [purchaseDate, setPurchaseDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [lines, setLines] = useState<Line[]>([blankLine()]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<PurchaseRow | null>(null);
  const [viewing, setViewing] = useState<PurchaseRow | null>(null);
  const [uploading, setUploading] = useState<string | null>(null);

  // --- Reference data -----------------------------------------------------
  const { data: suppliers } = useQuery({
    queryKey: ["suppliers-lite"],
    queryFn: async () =>
      (await supabase.from("suppliers").select("id,name").order("name")).data ?? [],
  });
  const { data: categories } = useQuery({
    queryKey: ["cats-lite"],
    queryFn: async () =>
      (await supabase.from("categories").select("id,name").order("name")).data ?? [],
  });
  const { data: brands } = useQuery({
    queryKey: ["brands-lite"],
    queryFn: async () => (await supabase.from("brands").select("id,name").order("name")).data ?? [],
  });
  const { data: catalog } = useQuery({
    queryKey: ["catalog-lite"],
    queryFn: async () =>
      (
        await supabase
          .from("products")
          .select(
            "id,sku,barcode,name,category_id,brand_id,color,size,unit,purchase_price,price,cgst_rate,sgst_rate,igst_rate,image_urls,color_variations",
          )
      ).data ?? [],
  });

  // --- Purchase history / report ------------------------------------------
  const { data: purchases } = useQuery({
    queryKey: ["purchase-report"],
    queryFn: async () =>
      (
        await supabase
          .from("purchases")
          .select(
            "id,invoice_no,purchase_date,total,tax,supplier_id,suppliers(name),purchase_items(id,product_id,quantity,unit,unit_cost,line_total,products(name,sku,unit,color,size,category_id,brand_id,price,purchase_price,cgst_rate,sgst_rate,igst_rate,image_urls,color_variations))",
          )
          .order("purchase_date", { ascending: false })
          .order("created_at", { ascending: false })
          .limit(100)
      ).data ?? [],
  });

  const subtotal = lines.reduce((s, l) => s + (l.quantity || 0) * (l.unit_cost || 0), 0);
  const purchaseTax = lines.reduce((s, l) => {
    const igst = Number(l.igst_rate) || 0;
    const rate = igst > 0 ? igst : (Number(l.cgst_rate) || 0) + (Number(l.sgst_rate) || 0);
    return s + ((l.quantity || 0) * (l.unit_cost || 0) * rate) / 100;
  }, 0);

  // --- SKU lookup: prefill an existing product ---------------------------------
  function onSkuBlur(idx: number, sku: string) {
    if (!sku.trim()) return;
    const needle = sku.trim().toLowerCase();
    const hit = (catalog ?? []).find(
      (p: any) => p.sku?.toLowerCase() === needle || p.barcode?.toLowerCase() === needle,
    );
    if (!hit) return;
    setLines((prev) =>
      prev.map((l, j) => {
        if (j !== idx) return l;
        return {
          ...l,
          product_id: l.product_id || hit.id,
          sku: hit.sku ?? hit.barcode ?? l.sku,
          name: l.name || hit.name,
          category_id: l.category_id || (hit.category_id ?? ""),
          brand_id: l.brand_id || (hit.brand_id ?? ""),
          color: l.color || (hit.color ?? ""),
          size: l.size || (hit.size ?? ""),
          unit: l.unit || hit.unit || "Nos",
          selling_price: l.selling_price || Number(hit.price ?? 0),
          unit_cost: l.unit_cost || Number(hit.purchase_price ?? 0),
          cgst_rate: l.cgst_rate || Number(hit.cgst_rate ?? 0),
          sgst_rate: l.sgst_rate || Number(hit.sgst_rate ?? 0),
          igst_rate: l.igst_rate || Number(hit.igst_rate ?? 0),
          image_url: l.image_url || (hit.image_urls?.[0] ?? ""),
          color_variations: l.color_variations.length
            ? l.color_variations
            : Array.isArray(hit.color_variations)
              ? (hit.color_variations as any[])
                  .filter((v: any) => v && typeof v === "object")
                  .map((v: any) => ({
                    color: String(v.color ?? ""),
                    image_url: String(v.image_url ?? ""),
                  }))
              : [],
        };
      }),
    );
    toast.success(`Matched existing product: ${hit.name}`);
  }

  // --- Photo upload helpers -------------------------------------------------
  async function uploadLinePhoto(lineId: string, field: string, file: File) {
    if (!file.type.startsWith("image/")) return toast.error("Please select an image file");
    if (file.size > 5 * 1024 * 1024) return toast.error("Image must be less than 5MB");
    const key = `${lineId}::${field}`;
    setUploading(key);
    try {
      const url = await uploadProductImage(file);
      setLines((prev) =>
        prev.map((l) => {
          if (l.id !== lineId) return l;
          if (field === "main") return { ...l, image_url: url };
          const idx = Number(field.split(":")[1]);
          const vars = [...l.color_variations];
          vars[idx] = { ...vars[idx], image_url: url };
          return { ...l, color_variations: vars };
        }),
      );
      toast.success("Photo uploaded");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to upload image");
    } finally {
      setUploading(null);
    }
  }

  function patchLine(i: number, patch: Partial<Line>) {
    setLines((prev) => prev.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  }
  function setVariation(i: number, idx: number, patch: Partial<ColorVariation>) {
    setLines((prev) =>
      prev.map((x, j) => {
        if (j !== i) return x;
        const vars = [...x.color_variations];
        vars[idx] = { ...vars[idx], ...patch };
        return { ...x, color_variations: vars };
      }),
    );
  }
  function addVariation(i: number) {
    setLines((prev) =>
      prev.map((x, j) =>
        j !== i
          ? x
          : { ...x, color_variations: [...x.color_variations, { color: "", image_url: "" }] },
      ),
    );
  }
  function removeVariation(i: number, idx: number) {
    setLines((prev) =>
      prev.map((x, j) =>
        j !== i ? x : { ...x, color_variations: x.color_variations.filter((_, k) => k !== idx) },
      ),
    );
  }

  // --- Save / edit ------------------------------------------------------------
  async function save() {
    const valid = lines.filter((l) => l.name.trim() && (l.quantity || 0) > 0 && l.unit.trim());
    if (!valid.length) return toast.error("Each product line needs a name, quantity and a unit");
    const badUnit = lines.some((l) => l.name.trim() && !l.unit.trim());
    if (badUnit) return toast.error("Please select a unit for each product line");
    const items = valid.map((l) => {
      const variations = l.color_variations.filter((v) => v.color.trim());
      return {
        ...(l.product_id ? { product_id: l.product_id } : {}),
        name: l.name.trim(),
        sku: l.sku.trim(),
        category_id: l.category_id || null,
        brand_id: l.brand_id || null,
        color: l.color.trim(),
        color_variations: variations.length ? variations : null,
        size: l.size.trim(),
        unit: l.unit.trim(),
        quantity: Number(l.quantity) || 0.001,
        unit_cost: Math.max(0, Number(l.unit_cost) || 0),
        selling_price: Math.max(0, Number(l.selling_price) || 0),
        cgst_rate: Math.max(0, Number(l.cgst_rate) || 0),
        sgst_rate: Math.max(0, Number(l.sgst_rate) || 0),
        igst_rate: Math.max(0, Number(l.igst_rate) || 0),
        image_url: l.image_url,
      };
    });

    const args = {
      _supplier_id: (supplier || null) as never,
      _invoice_no: invoiceNo,
      _purchase_date: purchaseDate,
      _notes: null as never,
      _items: items as never,
    };
    const res = editingId
      ? await supabase.rpc("update_purchase_with_products", { ...args, _purchase_id: editingId })
      : await supabase.rpc("create_purchase_with_products", args);
    if (res.error) return toast.error(res.error.message);

    toast.success(
      editingId
        ? "Purchase updated — product, photo, variations & stock recalculated"
        : valid.length === 1
          ? `“${valid[0].name}” created/updated & added to stock`
          : "Purchase recorded — products, photos & stock updated",
    );
    resetForm();
    qc.invalidateQueries();
  }

  function resetForm() {
    setSupplier("");
    setInvoiceNo("");
    setPurchaseDate(new Date().toISOString().slice(0, 10));
    setLines([blankLine()]);
    setEditingId(null);
    setUploading(null);
  }

  function startEdit(p: PurchaseRow) {
    const items = (p.purchase_items ?? []).filter(Boolean);
    setEditingId(p.id);
    setSupplier(p.supplier_id ?? "");
    setInvoiceNo(p.invoice_no ?? "");
    setPurchaseDate((p.purchase_date ?? "").slice(0, 10));
    setLines(
      items.length
        ? items.map((it) => ({
            id: uid(),
            product_id: it.product_id ?? "",
            name: it.products?.name ?? "",
            sku: it.products?.sku ?? "",
            category_id: it.products?.category_id ?? "",
            brand_id: it.products?.brand_id ?? "",
            color: it.products?.color ?? "",
            size: it.products?.size ?? "",
            unit: it.unit || it.products?.unit || "Nos",
            quantity: Number(it.quantity),
            unit_cost: Number(it.unit_cost),
            selling_price: Number(it.products?.price ?? 0),
            cgst_rate: Number(it.products?.cgst_rate ?? 0),
            sgst_rate: Number(it.products?.sgst_rate ?? 0),
            igst_rate: Number(it.products?.igst_rate ?? 0),
            image_url: (it.products?.image_urls ?? [])[0] ?? "",
            color_variations: Array.isArray(it.products?.color_variations)
              ? (it.products.color_variations as any[])
                  .filter((v) => v && typeof v === "object")
                  .map((v: any) => ({
                    color: String(v.color ?? ""),
                    image_url: String(v.image_url ?? ""),
                  }))
              : [],
          }))
        : [blankLine()],
    );
    window.scrollTo({ top: 0, behavior: "smooth" });
    toast.info("Editing purchase — save to update the same record & stock");
  }

  async function confirmDelete() {
    if (!deleteTarget) return;
    const { error } = await supabase.rpc("delete_purchase_with_stock_reversal", {
      _purchase_id: deleteTarget.id,
    });
    if (error) {
      setDeleteTarget(null);
      return toast.error(error.message);
    }
    toast.success("Purchase deleted — stock reversed");
    setDeleteTarget(null);
    if (viewing?.id === deleteTarget.id) setViewing(null);
    qc.invalidateQueries();
  }

  // --- Flatten purchases into report rows -----------------------------------
  const reportRows = (purchases ?? []).flatMap((p) => {
    const items = (p.purchase_items ?? []).filter(Boolean);
    if (!items.length) {
      return [
        {
          ...p,
          productName: "—",
          sku: "",
          color: "",
          unit: "Nos",
          qty: 0,
          unitCost: 0,
          lineTotal: Number(p.total),
          isHeader: true,
        },
      ];
    }
    return items.map((it, i) => ({
      ...p,
      productName: it.products?.name ?? "—",
      sku: it.products?.sku ?? "",
      color: it.products?.color ?? "",
      unit: it.unit || it.products?.unit || "Nos",
      qty: it.quantity,
      unitCost: Number(it.unit_cost),
      lineTotal: Number(it.line_total),
      isHeader: i === 0,
    }));
  });

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-bold text-foreground">Purchase Entry</h1>

      {/* ================= Purchase form ================= */}
      <div className="rounded-xl border border-border bg-white p-5 shadow-sm space-y-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <label className="block">
            <span className="text-[11px] font-semibold text-muted-foreground">Supplier</span>
            <select
              value={supplier}
              onChange={(e) => setSupplier(e.target.value)}
              className="mt-1 w-full rounded-lg border border-border px-3 py-2 text-sm"
            >
              <option value="">— select —</option>
              {(suppliers ?? []).map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="text-[11px] font-semibold text-muted-foreground">
              Invoice / Bill No.
            </span>
            <input
              value={invoiceNo}
              onChange={(e) => setInvoiceNo(e.target.value)}
              className="mt-1 w-full rounded-lg border border-border px-3 py-2 text-sm"
              placeholder="e.g. INV-1024"
            />
          </label>
          <label className="block">
            <span className="text-[11px] font-semibold text-muted-foreground">Purchase Date</span>
            <input
              type="date"
              value={purchaseDate}
              onChange={(e) => setPurchaseDate(e.target.value)}
              className="mt-1 w-full rounded-lg border border-border px-3 py-2 text-sm"
            />
          </label>
        </div>

        <div className="space-y-3">
          {lines.map((l, i) => (
            <div key={l.id} className="rounded-lg border border-border bg-secondary-soft/60 p-3">
              <div className="mb-2 flex items-center justify-between">
                <span className="rounded-md bg-primary px-2 py-0.5 text-[10px] font-bold text-white">
                  S.NO. {i + 1}
                </span>
                <button
                  onClick={() => setLines(lines.filter((_, j) => j !== i))}
                  disabled={lines.length === 1}
                  className="flex items-center gap-1 text-[11px] font-semibold text-rose-600 disabled:opacity-30"
                >
                  <Trash2 className="h-3.5 w-3.5" /> Remove line
                </button>
              </div>

              {/* Product photo */}
              <div className="mb-3 flex flex-wrap items-center gap-3">
                <LineField label="Product Photo">
                  <div className="space-y-2">
                    {l.image_url ? (
                      <div className="flex items-center gap-2 rounded-lg bg-white p-2 border border-border">
                        <img
                          src={l.image_url}
                          alt="Product"
                          className="h-14 w-14 rounded object-cover"
                        />
                        <button
                          onClick={() => patchLine(i, { image_url: "" })}
                          className="ml-auto flex items-center gap-1 text-[11px] font-semibold text-rose-600 hover:underline"
                        >
                          <X className="h-3.5 w-3.5" /> Remove
                        </button>
                      </div>
                    ) : null}
                    <label className="flex cursor-pointer items-center justify-center gap-2 rounded-lg border-2 border-dashed border-border bg-white px-3 py-2 text-xs font-medium text-muted-foreground hover:border-secondary hover:text-secondary">
                      <input
                        type="file"
                        accept="image/*"
                        className="sr-only"
                        onChange={async (e) => {
                          const f = e.target.files?.[0];
                          if (f) {
                            await uploadLinePhoto(l.id, "main", f);
                            e.target.value = "";
                          }
                        }}
                      />
                      {uploading === `${l.id}::main` ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Upload className="h-3.5 w-3.5" />
                      )}
                      {l.image_url ? "Change photo" : "Upload photo"}
                    </label>
                  </div>
                </LineField>
              </div>

              <div className="grid grid-cols-2 gap-2 md:grid-cols-4 lg:grid-cols-6">
                <LineField label="Product Name">
                  <input
                    value={l.name}
                    onChange={(e) => patchLine(i, { name: e.target.value })}
                    className={inputCls}
                    placeholder="e.g. Handmade Necklace"
                  />
                </LineField>
                <LineField label="Product Code / SKU">
                  <input
                    value={l.sku}
                    onChange={(e) => patchLine(i, { sku: e.target.value })}
                    onBlur={(e) => onSkuBlur(i, e.target.value)}
                    className={inputCls}
                    placeholder="e.g. NCL-GOLD"
                  />
                </LineField>
                <LineField label="Category">
                  <select
                    value={l.category_id}
                    onChange={(e) => patchLine(i, { category_id: e.target.value })}
                    className={inputCls}
                  >
                    <option value="">— none —</option>
                    {(categories ?? []).map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </LineField>
                <LineField label="Brand">
                  <select
                    value={l.brand_id}
                    onChange={(e) => patchLine(i, { brand_id: e.target.value })}
                    className={inputCls}
                  >
                    <option value="">— none —</option>
                    {(brands ?? []).map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.name}
                      </option>
                    ))}
                  </select>
                </LineField>
                <LineField label="Color">
                  <input
                    value={l.color}
                    onChange={(e) => patchLine(i, { color: e.target.value })}
                    className={inputCls}
                    placeholder="e.g. Gold"
                  />
                </LineField>
                <LineField label="Size / Variant">
                  <input
                    value={l.size}
                    onChange={(e) => patchLine(i, { size: e.target.value })}
                    className={inputCls}
                    placeholder="e.g. M / 20cm"
                  />
                </LineField>
                <LineField label="Quantity (decimal ok)">
                  <input
                    type="number"
                    step="0.001"
                    min={0}
                    value={l.quantity}
                    onChange={(e) => patchLine(i, { quantity: Number(e.target.value) })}
                    className={inputCls}
                    placeholder="e.g. 1.5"
                  />
                </LineField>
                <LineField label="Unit">
                  <select
                    value={l.unit}
                    onChange={(e) => patchLine(i, { unit: e.target.value })}
                    className={inputCls}
                  >
                    <option value="Nos">Nos</option>
                    <option value="KG">KG</option>
                    <option value="G">G</option>
                    <option value="L">L</option>
                    <option value="ML">ML</option>
                    <option value="M">M</option>
                    <option value="CM">CM</option>
                  </select>
                </LineField>
                <LineField label="Purchase Price (₹)">
                  <input
                    type="number"
                    min={0}
                    value={l.unit_cost}
                    onChange={(e) => patchLine(i, { unit_cost: Number(e.target.value) })}
                    className={inputCls}
                    placeholder="e.g. 100"
                  />
                </LineField>
                <LineField label="Selling Price (₹)">
                  <input
                    type="number"
                    min={0}
                    value={l.selling_price}
                    onChange={(e) => patchLine(i, { selling_price: Number(e.target.value) })}
                    className={inputCls}
                    placeholder="e.g. 200"
                  />
                </LineField>
                <LineField label="CGST / Central Tax (%)">
                  <input
                    type="number"
                    min={0}
                    step="0.01"
                    value={l.cgst_rate}
                    onChange={(e) => patchLine(i, { cgst_rate: Number(e.target.value) })}
                    className={inputCls}
                    placeholder="e.g. 9"
                  />
                </LineField>
                <LineField label="SGST / State Tax (%)">
                  <input
                    type="number"
                    min={0}
                    step="0.01"
                    value={l.sgst_rate}
                    onChange={(e) => patchLine(i, { sgst_rate: Number(e.target.value) })}
                    className={inputCls}
                    placeholder="e.g. 9"
                  />
                </LineField>
                <LineField label="IGST / Inter-State (%)">
                  <input
                    type="number"
                    min={0}
                    step="0.01"
                    value={l.igst_rate}
                    onChange={(e) => patchLine(i, { igst_rate: Number(e.target.value) })}
                    className={inputCls}
                    placeholder="e.g. 18"
                  />
                </LineField>
              </div>

              {/* Color variations — each with its own photo */}
              <div className="mt-3 rounded-lg border border-border bg-white p-3">
                <div className="mb-2 flex items-center justify-between">
                  <span className="text-[11px] font-semibold text-muted-foreground">
                    Color Variations (optional) — each colour can carry its own photo
                  </span>
                  <button
                    onClick={() => addVariation(i)}
                    className="flex items-center gap-1 text-[11px] font-semibold text-secondary hover:underline"
                  >
                    <Plus className="h-3.5 w-3.5" /> Add variation
                  </button>
                </div>
                {!l.color_variations.length ? (
                  <div className="text-[11px] text-muted-foreground/70">
                    No colour variations yet — e.g. Pink → pink photo, Green → green photo.
                  </div>
                ) : (
                  <div className="space-y-2">
                    {l.color_variations.map((v, vi) => (
                      <div key={vi} className="flex flex-wrap items-center gap-2">
                        <input
                          value={v.color}
                          onChange={(e) => setVariation(i, vi, { color: e.target.value })}
                          className={inputCls + " w-32"}
                          placeholder={`Colour ${vi + 1} (e.g. Pink)`}
                        />
                        {v.image_url ? (
                          <div className="relative">
                            <img
                              src={v.image_url}
                              alt={v.color}
                              className="h-10 w-10 rounded object-cover"
                            />
                            <button
                              onClick={() => setVariation(i, vi, { image_url: "" })}
                              className="absolute -right-1 -top-1 grid h-4 w-4 place-items-center rounded-full bg-rose-600 text-white"
                            >
                              <X className="h-3 w-3" />
                            </button>
                          </div>
                        ) : null}
                        <label
                          className={`flex cursor-pointer items-center gap-1.5 rounded-lg border border-border bg-muted px-2.5 py-1.5 text-[11px] font-semibold text-muted-foreground hover:border-secondary ${uploading === `${l.id}::var:${vi}` ? "opacity-60" : ""}`}
                        >
                          <input
                            type="file"
                            accept="image/*"
                            className="sr-only"
                            onChange={async (e) => {
                              const f = e.target.files?.[0];
                              if (f) {
                                await uploadLinePhoto(l.id, `var:${vi}`, f);
                                e.target.value = "";
                              }
                            }}
                          />
                          {uploading === `${l.id}::var:${vi}` ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <Upload className="h-3.5 w-3.5" />
                          )}
                          {v.image_url ? "Change" : "Photo"}
                        </label>
                        <button
                          onClick={() => removeVariation(i, vi)}
                          className="text-rose-600 hover:underline text-[11px] font-semibold"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          ))}
          <button
            onClick={() => setLines([...lines, blankLine()])}
            className="flex items-center gap-1 text-xs font-semibold text-secondary"
          >
            <Plus className="h-3.5 w-3.5" /> Add product line
          </button>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-3">
          <div className="text-xs text-muted-foreground">
            Saving a purchase{" "}
            <span className="font-semibold text-foreground/90">
              automatically creates/updates the product
            </span>{" "}
            (matched by SKU), syncs the photo &amp; colour variations, adds it to inventory, and
            records purchase history.
          </div>
          <div className="flex items-center gap-3">
            {editingId && (
              <button
                onClick={resetForm}
                className="rounded-lg border border-border px-4 py-2 text-sm text-muted-foreground"
              >
                Cancel edit
              </button>
            )}
            <div className="text-sm space-y-0.5 text-muted-foreground text-right">
              <div>
                Subtotal: <span className="font-bold text-foreground">₹{subtotal.toFixed(2)}</span>
              </div>
              {purchaseTax > 0 && (
                <div className="text-[11px]">
                  Purchase tax: <span className="font-semibold">₹{purchaseTax.toFixed(2)}</span>
                </div>
              )}
            </div>
            <button
              onClick={save}
              className="rounded-lg bg-primary px-5 py-2 text-sm font-semibold text-white"
            >
              {editingId ? "Update Purchase" : "Save Purchase"}
            </button>
          </div>
        </div>
      </div>

      {/* ================= Purchase report ================= */}
      <div>
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-foreground/90">Purchase Report / History</h2>
          <span className="text-[11px] text-muted-foreground/70">{reportRows.length} line(s)</span>
        </div>
        <div className="overflow-x-auto rounded-xl border border-border bg-white shadow-sm">
          <table className="w-full text-sm">
            <thead className="bg-muted text-[11px] uppercase text-muted-foreground">
              <tr>
                <th className="p-3 text-left">S.No.</th>
                <th className="p-3 text-left">Purchase Date</th>
                <th className="p-3 text-left">Product Name</th>
                <th className="p-3 text-left">SKU / Code</th>
                <th className="p-3 text-left">Color</th>
                <th className="p-3 text-right">Qty / Unit</th>
                <th className="p-3 text-left">Supplier</th>
                <th className="p-3 text-right">Purchase Price</th>
                <th className="p-3 text-right">Total Amount</th>
                <th className="p-3 text-left">Invoice No.</th>
                <th className="p-3 text-center">Actions</th>
              </tr>
            </thead>
            <tbody>
              {reportRows.map((r, idx) => (
                <tr key={`${r.id}-${idx}`} className="border-t border-border hover:bg-muted/50">
                  <td className="p-3 text-xs font-semibold text-muted-foreground">{idx + 1}</td>
                  <td className="p-3 text-xs text-muted-foreground">
                    {new Date(r.purchase_date).toLocaleDateString()}
                  </td>
                  <td className="p-3 font-medium text-foreground">{r.productName}</td>
                  <td className="p-3 text-xs text-muted-foreground">{r.sku || "—"}</td>
                  <td className="p-3 text-xs text-muted-foreground">{r.color || "—"}</td>
                  <td className="p-3 text-right font-semibold whitespace-nowrap">
                    {r.qty} {r.unit}
                  </td>
                  <td className="p-3 text-xs">{r.suppliers?.name ?? "—"}</td>
                  <td className="p-3 text-right">₹{Number(r.unitCost).toFixed(2)}</td>
                  <td className="p-3 text-right font-semibold">
                    ₹{Number(r.lineTotal).toFixed(2)}
                  </td>
                  <td className="p-3 text-xs">{r.invoice_no ?? "—"}</td>
                  <td className="p-3">
                    <div className="flex items-center justify-center gap-1.5">
                      <button
                        onClick={() => setViewing(viewing?.id === r.id ? null : r)}
                        className="rounded p-1.5 hover:bg-secondary-soft"
                        title="View details"
                      >
                        <Eye className="h-3.5 w-3.5 text-muted-foreground" />
                      </button>
                      <button
                        onClick={() => startEdit(r)}
                        className="rounded p-1.5 hover:bg-secondary-soft"
                        title="Edit purchase"
                      >
                        <Pencil className="h-3.5 w-3.5 text-secondary" />
                      </button>
                      <button
                        onClick={() => setDeleteTarget(r)}
                        className="rounded p-1.5 hover:bg-rose-50"
                        title="Delete purchase"
                      >
                        <Trash2 className="h-3.5 w-3.5 text-rose-600" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {!reportRows.length && (
                <tr>
                  <td colSpan={11} className="p-8 text-center text-xs text-muted-foreground/70">
                    No purchases recorded yet — first purchase will create the product and add
                    stock.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* ================= View details ================= */}
      {viewing && (
        <ViewDetails
          purchase={viewing}
          onClose={() => setViewing(null)}
          onEdit={() => {
            startEdit(viewing);
            setViewing(null);
          }}
        />
      )}

      {/* ================= Delete confirmation popup ================= */}
      {deleteTarget && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-primary/45 p-4">
          <div className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-2xl">
            <div className="mx-auto mb-3 grid h-12 w-12 place-items-center rounded-full bg-rose-50">
              <Trash2 className="h-6 w-6 text-rose-600" />
            </div>
            <h3 className="text-center text-base font-bold text-foreground">
              Delete purchase entry?
            </h3>
            <p className="mt-2 text-center text-sm text-muted-foreground">
              Are you sure you want to delete this purchase entry? The stock added by this purchase
              will be <span className="font-semibold text-rose-600">reversed automatically</span>.
              This cannot be undone.
            </p>
            <div className="mt-5 grid grid-cols-2 gap-2">
              <button
                onClick={() => setDeleteTarget(null)}
                className="rounded-lg border border-border px-4 py-2.5 text-sm font-semibold text-foreground/90"
              >
                Cancel
              </button>
              <button
                onClick={confirmDelete}
                className="rounded-lg bg-rose-600 px-4 py-2.5 text-sm font-semibold text-white"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function ViewDetails({
  purchase,
  onClose,
  onEdit,
}: {
  purchase: PurchaseRow;
  onClose: () => void;
  onEdit: () => void;
}) {
  const items = (purchase.purchase_items ?? []).filter(Boolean);
  return (
    <div className="rounded-xl border border-border bg-white p-5 shadow-sm">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-bold text-foreground">
          Purchase #{purchase.id.slice(0, 8).toUpperCase()}
        </h3>
        <div className="flex items-center gap-2">
          <button
            onClick={onEdit}
            className="rounded-lg border border-border px-3 py-1.5 text-xs font-semibold text-secondary"
          >
            Edit
          </button>
          <button
            onClick={onClose}
            className="rounded-lg border border-border px-3 py-1.5 text-xs text-muted-foreground"
          >
            Close
          </button>
        </div>
      </div>
      <div className="mb-3 grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
        <div>
          <div className="text-muted-foreground">Supplier</div>
          <div className="font-semibold">{purchase.suppliers?.name ?? "—"}</div>
        </div>
        <div>
          <div className="text-muted-foreground">Invoice No.</div>
          <div className="font-semibold">{purchase.invoice_no ?? "—"}</div>
        </div>
        <div>
          <div className="text-muted-foreground">Purchase Date</div>
          <div className="font-semibold">
            {new Date(purchase.purchase_date).toLocaleDateString()}
          </div>
        </div>
        <div>
          <div className="text-muted-foreground">Total</div>
          <div className="font-semibold">₹{Number(purchase.total).toFixed(2)}</div>
        </div>
      </div>
      <table className="w-full text-xs">
        <thead className="text-[10px] uppercase text-muted-foreground border-b border-border">
          <tr>
            <th className="text-left py-1">Product</th>
            <th className="text-left">SKU</th>
            <th className="text-left">Color</th>
            <th className="text-right">Qty / Unit</th>
            <th className="text-right">Cost</th>
            <th className="text-right">Line Total</th>
          </tr>
        </thead>
        <tbody>
          {items.map((it) => (
            <tr key={it.id} className="border-b border-border">
              <td className="py-1.5 font-semibold">{it.products?.name ?? "—"}</td>
              <td>{it.products?.sku ?? "—"}</td>
              <td>{it.products?.color ?? "—"}</td>
              <td className="text-right whitespace-nowrap">
                {Number(it.quantity)} {it.unit}
              </td>
              <td className="text-right">₹{Number(it.unit_cost).toFixed(2)}</td>
              <td className="text-right font-semibold">₹{Number(it.line_total).toFixed(2)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {Number(purchase.tax) > 0 ? (
        <div className="mt-2 flex justify-end text-xs text-muted-foreground">
          Purchase tax (GST):{" "}
          <span className="ml-1 font-semibold">₹{Number(purchase.tax).toFixed(2)}</span>
        </div>
      ) : null}
    </div>
  );
}

const inputCls =
  "w-full rounded-lg border border-border bg-white px-2.5 py-1.5 text-sm outline-none focus:border-secondary";
function LineField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[10px] font-semibold text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}
