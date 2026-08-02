import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/admin/purchases")({
  head: () => ({ meta: [{ title: "Purchase Entry — ACH Admin" }] }),
  component: Purchases,
});

type Row = { product_id: string; quantity: number; unit_cost: number };

function Purchases() {
  const qc = useQueryClient();
  const [supplier, setSupplier] = useState<string>("");
  const [invoiceNo, setInvoiceNo] = useState("");
  const [rows, setRows] = useState<Row[]>([{ product_id: "", quantity: 1, unit_cost: 0 }]);

  const { data: suppliers } = useQuery({
    queryKey: ["suppliers-lite"],
    queryFn: async () => (await supabase.from("suppliers").select("id,name").order("name")).data ?? [],
  });
  const { data: products } = useQuery({
    queryKey: ["prods-lite"],
    queryFn: async () => (await supabase.from("products").select("id,name,sku").order("name")).data ?? [],
  });
  const { data: recent } = useQuery({
    queryKey: ["recent-purchases"],
    queryFn: async () => (await supabase.from("purchases").select("*,suppliers(name)").order("created_at", { ascending: false }).limit(15)).data ?? [],
  });

  const subtotal = rows.reduce((s, r) => s + r.quantity * r.unit_cost, 0);

  async function submit() {
    const valid = rows.filter((r) => r.product_id && r.quantity > 0);
    if (!valid.length) return toast.error("Add at least one product line");
    const { data: user } = await supabase.auth.getUser();
    const { data: p, error } = await supabase.from("purchases").insert({
      supplier_id: supplier || null,
      invoice_no: invoiceNo || null,
      subtotal, tax: 0, total: subtotal,
      created_by: user.user?.id ?? null,
    }).select("id").single();
    if (error || !p) return toast.error(error?.message ?? "Failed");
    const items = valid.map((r) => ({ purchase_id: p.id, product_id: r.product_id, quantity: r.quantity, unit_cost: r.unit_cost, line_total: r.quantity * r.unit_cost }));
    const { error: e2 } = await supabase.from("purchase_items").insert(items);
    if (e2) return toast.error(e2.message);
    toast.success("Purchase recorded — stock updated automatically");
    setRows([{ product_id: "", quantity: 1, unit_cost: 0 }]);
    setInvoiceNo(""); setSupplier("");
    qc.invalidateQueries();
  }

  return (
    <div className="space-y-5">
      <h1 className="text-xl font-bold text-slate-900">Purchase Entry</h1>

      <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className="text-[11px] font-semibold text-slate-600">Supplier</span>
            <select value={supplier} onChange={(e) => setSupplier(e.target.value)} className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm">
              <option value="">— select —</option>
              {(suppliers ?? []).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </label>
          <label className="block">
            <span className="text-[11px] font-semibold text-slate-600">Invoice No.</span>
            <input value={invoiceNo} onChange={(e) => setInvoiceNo(e.target.value)} className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm" />
          </label>
        </div>

        <div className="rounded-lg border border-slate-100">
          <div className="grid grid-cols-[1fr_100px_120px_40px] gap-2 border-b border-slate-100 bg-slate-50 p-2 text-[11px] font-semibold text-slate-500">
            <div>Product</div><div>Quantity</div><div>Unit Cost (₹)</div><div></div>
          </div>
          {rows.map((r, i) => (
            <div key={i} className="grid grid-cols-[1fr_100px_120px_40px] gap-2 border-b border-slate-100 p-2 items-center">
              <select value={r.product_id} onChange={(e) => setRows(rows.map((x, j) => j === i ? { ...x, product_id: e.target.value } : x))} className="rounded border border-slate-200 px-2 py-1.5 text-sm">
                <option value="">— select product —</option>
                {(products ?? []).map((p) => <option key={p.id} value={p.id}>{p.name}{p.sku ? ` (${p.sku})` : ""}</option>)}
              </select>
              <input type="number" min={1} value={r.quantity} onChange={(e) => setRows(rows.map((x, j) => j === i ? { ...x, quantity: Number(e.target.value) } : x))} className="rounded border border-slate-200 px-2 py-1.5 text-sm" />
              <input type="number" min={0} value={r.unit_cost} onChange={(e) => setRows(rows.map((x, j) => j === i ? { ...x, unit_cost: Number(e.target.value) } : x))} className="rounded border border-slate-200 px-2 py-1.5 text-sm" />
              <button onClick={() => setRows(rows.filter((_, j) => j !== i))} className="text-rose-500 disabled:opacity-30" disabled={rows.length === 1}><Trash2 className="h-4 w-4" /></button>
            </div>
          ))}
          <button onClick={() => setRows([...rows, { product_id: "", quantity: 1, unit_cost: 0 }])} className="flex items-center gap-1 p-2 text-xs text-secondary font-semibold">
            <Plus className="h-3.5 w-3.5" /> Add row
          </button>
        </div>

        <div className="flex items-center justify-between border-t border-slate-100 pt-3">
          <div className="text-xs text-slate-500">Recording a purchase automatically increases product stock.</div>
          <div className="flex items-center gap-4">
            <div className="text-sm">Total: <span className="font-bold">₹{subtotal.toFixed(2)}</span></div>
            <button onClick={submit} className="rounded-lg bg-slate-900 px-5 py-2 text-sm font-semibold text-white">Save Purchase</button>
          </div>
        </div>
      </div>

      <div>
        <h2 className="mb-2 text-sm font-semibold text-slate-700">Recent Purchases</h2>
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-[11px] uppercase text-slate-500"><tr><th className="p-3 text-left">Date</th><th className="p-3 text-left">Supplier</th><th className="p-3 text-left">Invoice</th><th className="p-3 text-right">Total</th></tr></thead>
            <tbody>
              {(recent ?? []).map((r) => (
                <tr key={r.id} className="border-t border-slate-100">
                  <td className="p-3 text-xs">{new Date(r.created_at).toLocaleDateString()}</td>
                  <td className="p-3 text-sm">{(r as { suppliers?: { name?: string } }).suppliers?.name ?? "—"}</td>
                  <td className="p-3 text-xs">{r.invoice_no ?? "—"}</td>
                  <td className="p-3 text-right font-semibold">₹{Number(r.total).toFixed(2)}</td>
                </tr>
              ))}
              {!recent?.length && <tr><td colSpan={4} className="p-6 text-center text-xs text-slate-400">No purchases recorded yet</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
