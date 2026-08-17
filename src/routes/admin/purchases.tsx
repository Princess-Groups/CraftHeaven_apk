import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useState } from "react";
import { Plus, Trash2, Pencil, Eye } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/admin/purchases")({
  head: () => ({ meta: [{ title: "Purchase Entry — ACH Admin" }] }),
  component: Purchases,
});

// Local key for line rows — used only as a React key, never stored in the DB.
function uid(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return "row-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 8);
}

type Line = {
  id: string;
  product_id: string; // linked product when editing an existing purchase line
  name: string;
  sku: string;
  category_id: string;
  brand_id: string;
  color: string;
  size: string;
  quantity: number;
  unit_cost: number; // purchase price per unit
  selling_price: number;
};

const blankLine = (): Line => ({
  id: uid(),
  product_id: "",
  name: "", sku: "", category_id: "", brand_id: "", color: "", size: "",
  quantity: 1, unit_cost: 0, selling_price: 0,
});

type PurchaseItemRow = {
  id: string;
  product_id: string;
  quantity: number;
  unit_cost: number;
  line_total: number;
  products: {
    name: string;
    sku: string | null;
    color: string | null;
    size: string | null;
    category_id: string | null;
    brand_id: string | null;
    price: number | null;
  } | null;
};
type PurchaseRow = {
  id: string;
  invoice_no: string | null;
  purchase_date: string;
  total: number;
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

  // --- Reference data -----------------------------------------------------
  const { data: suppliers } = useQuery({
    queryKey: ["suppliers-lite"],
    queryFn: async () => (await supabase.from("suppliers").select("id,name").order("name")).data ?? [],
  });
  const { data: categories } = useQuery({
    queryKey: ["cats-lite"],
    queryFn: async () => (await supabase.from("categories").select("id,name").order("name")).data ?? [],
  });
  const { data: brands } = useQuery({
    queryKey: ["brands-lite"],
    queryFn: async () => (await supabase.from("brands").select("id,name").order("name")).data ?? [],
  });
  const { data: catalog } = useQuery({
    queryKey: ["catalog-lite"],
    queryFn: async () =>
      (await supabase.from("products").select("id,sku,barcode,name,category_id,brand_id,color,size,purchase_price,price")).data ?? [],
  });

  // --- Purchase history / report ------------------------------------------
  const { data: purchases } = useQuery({
    queryKey: ["purchase-report"],
    queryFn: async () =>
      (await supabase
        .from("purchases")
        .select("id,invoice_no,purchase_date,total,supplier_id,suppliers(name),purchase_items(id,product_id,quantity,unit_cost,line_total,products(name,sku,color,size,category_id,brand_id,price))")
        .order("purchase_date", { ascending: false })
        .order("created_at", { ascending: false })
        .limit(100)).data ?? [],
  });

  const subtotal = lines.reduce((s, l) => s + (l.quantity || 0) * (l.unit_cost || 0), 0);

  // --- SKU lookup: prefill an existing product ---------------------------------
  function onSkuBlur(idx: number, sku: string) {
    if (!sku.trim()) return;
    const needle = sku.trim().toLowerCase();
    const hit = (catalog ?? []).find(
      (p) => p.sku?.toLowerCase() === needle || p.barcode?.toLowerCase() === needle
    );
    if (!hit) return;
    setLines((prev) => prev.map((l, j) => {
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
        selling_price: l.selling_price || Number(hit.price ?? 0),
        unit_cost: l.unit_cost || Number(hit.purchase_price ?? 0),
      };
    }));
    toast.success(`Matched existing product: ${hit.name}`);
  }

  // --- Save / edit ------------------------------------------------------------
  async function save() {
    const valid = lines.filter((l) => l.name.trim() && (l.quantity || 0) > 0);
    if (!valid.length) return toast.error("Add at least one product line with a name and quantity");
    const items = valid.map((l) => ({
      ...(l.product_id ? { product_id: l.product_id } : {}),
      name: l.name.trim(),
      sku: l.sku.trim(),
      category_id: l.category_id || null,
      brand_id: l.brand_id || null,
      color: l.color.trim(),
      size: l.size.trim(),
      quantity: Math.max(1, Number(l.quantity) || 1),
      unit_cost: Math.max(0, Number(l.unit_cost) || 0),
      selling_price: Math.max(0, Number(l.selling_price) || 0),
    }));

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
        ? "Purchase updated — product & stock recalculated"
        : valid.length === 1
          ? `“${valid[0].name}” created/updated & added to stock`
          : "Purchase recorded — products created & stock added"
    );
    resetForm();
    qc.invalidateQueries();
  }

  function resetForm() {
    setSupplier(""); setInvoiceNo("");
    setPurchaseDate(new Date().toISOString().slice(0, 10));
    setLines([blankLine()]);
    setEditingId(null);
  }

  function startEdit(p: PurchaseRow) {
    const items = (p.purchase_items ?? []).filter(Boolean);
    setEditingId(p.id);
    setSupplier(p.supplier_id ?? "");
    setInvoiceNo(p.invoice_no ?? "");
    setPurchaseDate((p.purchase_date ?? "").slice(0, 10));
    setLines(items.length
      ? items.map((it) => ({
          id: uid(),
          product_id: it.product_id ?? "",
          name: it.products?.name ?? "",
          sku: it.products?.sku ?? "",
          category_id: it.products?.category_id ?? "",
          brand_id: it.products?.brand_id ?? "",
          color: it.products?.color ?? "",
          size: it.products?.size ?? "",
          quantity: it.quantity,
          unit_cost: Number(it.unit_cost),
          selling_price: Number(it.products?.price ?? 0),
        }))
      : [blankLine()]);
    window.scrollTo({ top: 0, behavior: "smooth" });
    toast.info("Editing purchase — save to update the same record & stock");
  }

  async function confirmDelete() {
    if (!deleteTarget) return;
    const { error } = await supabase.rpc("delete_purchase_with_stock_reversal", { _purchase_id: deleteTarget.id });
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
      return [{ ...p, productName: "—", sku: "", qty: 0, unitCost: 0, lineTotal: Number(p.total), isHeader: true }];
    }
    return items.map((it, i) => ({
      ...p,
      productName: it.products?.name ?? "—",
      sku: it.products?.sku ?? "",
      qty: it.quantity,
      unitCost: Number(it.unit_cost),
      lineTotal: Number(it.line_total),
      isHeader: i === 0,
    }));
  });

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-bold text-slate-900">Purchase Entry</h1>

      {/* ================= Purchase form ================= */}
      <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm space-y-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <label className="block">
            <span className="text-[11px] font-semibold text-slate-600">Supplier</span>
            <select value={supplier} onChange={(e) => setSupplier(e.target.value)} className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm">
              <option value="">— select —</option>
              {(suppliers ?? []).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </label>
          <label className="block">
            <span className="text-[11px] font-semibold text-slate-600">Invoice / Bill No.</span>
            <input value={invoiceNo} onChange={(e) => setInvoiceNo(e.target.value)} className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm" placeholder="e.g. INV-1024" />
          </label>
          <label className="block">
            <span className="text-[11px] font-semibold text-slate-600">Purchase Date</span>
            <input type="date" value={purchaseDate} onChange={(e) => setPurchaseDate(e.target.value)} className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm" />
          </label>
        </div>

        <div className="space-y-3">
          {lines.map((l, i) => (
            <div key={l.id} className="rounded-lg border border-slate-200 bg-slate-50/60 p-3">
              <div className="mb-2 flex items-center justify-between">
                <span className="rounded-md bg-slate-900 px-2 py-0.5 text-[10px] font-bold text-white">S.NO. {i + 1}</span>
                <button
                  onClick={() => setLines(lines.filter((_, j) => j !== i))}
                  disabled={lines.length === 1}
                  className="flex items-center gap-1 text-[11px] font-semibold text-rose-600 disabled:opacity-30"
                >
                  <Trash2 className="h-3.5 w-3.5" /> Remove line
                </button>
              </div>
              <div className="grid grid-cols-2 gap-2 md:grid-cols-4 lg:grid-cols-6">
                <LineField label="Product Name">
                  <input value={l.name} onChange={(e) => setLines(lines.map((x, j) => j === i ? { ...x, name: e.target.value } : x))} className={inputCls} placeholder="e.g. Handmade Necklace" />
                </LineField>
                <LineField label="Product Code / SKU">
                  <input value={l.sku} onChange={(e) => setLines(lines.map((x, j) => j === i ? { ...x, sku: e.target.value } : x))} onBlur={(e) => onSkuBlur(i, e.target.value)} className={inputCls} placeholder="e.g. NCL-GOLD" />
                </LineField>
                <LineField label="Category">
                  <select value={l.category_id} onChange={(e) => setLines(lines.map((x, j) => j === i ? { ...x, category_id: e.target.value } : x))} className={inputCls}>
                    <option value="">— none —</option>
                    {(categories ?? []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                </LineField>
                <LineField label="Brand">
                  <select value={l.brand_id} onChange={(e) => setLines(lines.map((x, j) => j === i ? { ...x, brand_id: e.target.value } : x))} className={inputCls}>
                    <option value="">— none —</option>
                    {(brands ?? []).map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                  </select>
                </LineField>
                <LineField label="Color">
                  <input value={l.color} onChange={(e) => setLines(lines.map((x, j) => j === i ? { ...x, color: e.target.value } : x))} className={inputCls} placeholder="e.g. Gold" />
                </LineField>
                <LineField label="Size / Variant">
                  <input value={l.size} onChange={(e) => setLines(lines.map((x, j) => j === i ? { ...x, size: e.target.value } : x))} className={inputCls} placeholder="e.g. M / 20cm" />
                </LineField>
                <LineField label="Quantity">
                  <input type="number" min={1} value={l.quantity} onChange={(e) => setLines(lines.map((x, j) => j === i ? { ...x, quantity: Number(e.target.value) } : x))} className={inputCls} />
                </LineField>
                <LineField label="Purchase Price (₹)">
                  <input type="number" min={0} value={l.unit_cost} onChange={(e) => setLines(lines.map((x, j) => j === i ? { ...x, unit_cost: Number(e.target.value) } : x))} className={inputCls} />
                </LineField>
                <LineField label="Selling Price (₹)">
                  <input type="number" min={0} value={l.selling_price} onChange={(e) => setLines(lines.map((x, j) => j === i ? { ...x, selling_price: Number(e.target.value) } : x))} className={inputCls} />
                </LineField>
              </div>
            </div>
          ))}
          <button onClick={() => setLines([...lines, blankLine()])} className="flex items-center gap-1 text-xs font-semibold text-secondary">
            <Plus className="h-3.5 w-3.5" /> Add product line
          </button>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-3">
          <div className="text-xs text-slate-500">
            Saving a purchase <span className="font-semibold text-slate-700">automatically creates/updates the product</span> (matched by SKU), adds it to inventory, and records purchase history. No separate Product Entry needed.
          </div>
          <div className="flex items-center gap-3">
            {editingId && (
              <button onClick={resetForm} className="rounded-lg border border-slate-200 px-4 py-2 text-sm text-slate-600">Cancel edit</button>
            )}
            <div className="text-sm text-slate-600">Total: <span className="font-bold text-slate-900">₹{subtotal.toFixed(2)}</span></div>
            <button onClick={save} className="rounded-lg bg-slate-900 px-5 py-2 text-sm font-semibold text-white">
              {editingId ? "Update Purchase" : "Save Purchase"}
            </button>
          </div>
        </div>
      </div>

      {/* ================= Purchase report ================= */}
      <div>
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-slate-700">Purchase Report / History</h2>
          <span className="text-[11px] text-slate-400">{reportRows.length} line(s)</span>
        </div>
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-[11px] uppercase text-slate-500">
              <tr>
                <th className="p-3 text-left">S.No.</th>
                <th className="p-3 text-left">Purchase Date</th>
                <th className="p-3 text-left">Product Name</th>
                <th className="p-3 text-left">SKU / Code</th>
                <th className="p-3 text-right">Qty</th>
                <th className="p-3 text-left">Supplier</th>
                <th className="p-3 text-right">Purchase Price</th>
                <th className="p-3 text-right">Total Amount</th>
                <th className="p-3 text-left">Invoice No.</th>
                <th className="p-3 text-center">Actions</th>
              </tr>
            </thead>
            <tbody>
              {reportRows.map((r, idx) => (
                <tr key={`${r.id}-${idx}`} className="border-t border-slate-100 hover:bg-slate-50/50">
                  <td className="p-3 text-xs font-semibold text-slate-500">{idx + 1}</td>
                  <td className="p-3 text-xs text-slate-600">{new Date(r.purchase_date).toLocaleDateString()}</td>
                  <td className="p-3 font-medium text-slate-800">{r.productName}</td>
                  <td className="p-3 text-xs text-slate-500">{r.sku || "—"}</td>
                  <td className="p-3 text-right font-semibold">{r.qty}</td>
                  <td className="p-3 text-xs">{r.suppliers?.name ?? "—"}</td>
                  <td className="p-3 text-right">₹{Number(r.unitCost).toFixed(2)}</td>
                  <td className="p-3 text-right font-semibold">₹{Number(r.lineTotal).toFixed(2)}</td>
                  <td className="p-3 text-xs">{r.invoice_no ?? "—"}</td>
                  <td className="p-3">
                    <div className="flex items-center justify-center gap-1.5">
                      <button onClick={() => setViewing(viewing?.id === r.id ? null : r)} className="rounded p-1.5 hover:bg-slate-100" title="View details">
                        <Eye className="h-3.5 w-3.5 text-slate-600" />
                      </button>
                      <button onClick={() => startEdit(r)} className="rounded p-1.5 hover:bg-slate-100" title="Edit purchase">
                        <Pencil className="h-3.5 w-3.5 text-secondary" />
                      </button>
                      <button onClick={() => setDeleteTarget(r)} className="rounded p-1.5 hover:bg-rose-50" title="Delete purchase">
                        <Trash2 className="h-3.5 w-3.5 text-rose-600" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {!reportRows.length && (
                <tr><td colSpan={10} className="p-8 text-center text-xs text-slate-400">No purchases recorded yet — first purchase will create the product and add stock.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* ================= View details ================= */}
      {viewing && (
        <ViewDetails purchase={viewing} onClose={() => setViewing(null)} onEdit={() => { startEdit(viewing); setViewing(null); }} />
      )}

      {/* ================= Delete confirmation popup ================= */}
      {deleteTarget && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-slate-900/50 p-4">
          <div className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-2xl">
            <div className="mx-auto mb-3 grid h-12 w-12 place-items-center rounded-full bg-rose-50"><Trash2 className="h-6 w-6 text-rose-600" /></div>
            <h3 className="text-center text-base font-bold text-slate-900">Delete purchase entry?</h3>
            <p className="mt-2 text-center text-sm text-slate-500">
              Are you sure you want to delete this purchase entry? The stock added by this purchase will be <span className="font-semibold text-rose-600">reversed automatically</span>. This cannot be undone.
            </p>
            <div className="mt-5 grid grid-cols-2 gap-2">
              <button onClick={() => setDeleteTarget(null)} className="rounded-lg border border-slate-200 px-4 py-2.5 text-sm font-semibold text-slate-700">Cancel</button>
              <button onClick={confirmDelete} className="rounded-lg bg-rose-600 px-4 py-2.5 text-sm font-semibold text-white">Delete</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function ViewDetails({ purchase, onClose, onEdit }: { purchase: PurchaseRow; onClose: () => void; onEdit: () => void }) {
  const items = (purchase.purchase_items ?? []).filter(Boolean);
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-bold text-slate-900">Purchase #{purchase.id.slice(0, 8).toUpperCase()}</h3>
        <div className="flex items-center gap-2">
          <button onClick={onEdit} className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-secondary">Edit</button>
          <button onClick={onClose} className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs text-slate-600">Close</button>
        </div>
      </div>
      <div className="mb-3 grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
        <div><div className="text-slate-500">Supplier</div><div className="font-semibold">{purchase.suppliers?.name ?? "—"}</div></div>
        <div><div className="text-slate-500">Invoice No.</div><div className="font-semibold">{purchase.invoice_no ?? "—"}</div></div>
        <div><div className="text-slate-500">Purchase Date</div><div className="font-semibold">{new Date(purchase.purchase_date).toLocaleDateString()}</div></div>
        <div><div className="text-slate-500">Total</div><div className="font-semibold">₹{Number(purchase.total).toFixed(2)}</div></div>
      </div>
      <table className="w-full text-xs">
        <thead className="text-[10px] uppercase text-slate-500 border-b border-slate-200">
          <tr><th className="text-left py-1">Product</th><th className="text-left">SKU</th><th className="text-right">Qty</th><th className="text-right">Cost</th><th className="text-right">Line Total</th></tr>
        </thead>
        <tbody>
          {items.map((it) => (
            <tr key={it.id} className="border-b border-slate-100">
              <td className="py-1.5 font-semibold">{it.products?.name ?? "—"}</td>
              <td>{it.products?.sku ?? "—"}</td>
              <td className="text-right">{it.quantity}</td>
              <td className="text-right">₹{Number(it.unit_cost).toFixed(2)}</td>
              <td className="text-right font-semibold">₹{Number(it.line_total).toFixed(2)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const inputCls = "w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-sm outline-none focus:border-secondary";
function LineField({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="block"><span className="mb-1 block text-[10px] font-semibold text-slate-500">{label}</span>{children}</label>;
}