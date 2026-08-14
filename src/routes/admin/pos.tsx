import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Search, Plus, Minus, Trash2, ScanBarcode, Printer, IndianRupee, X } from "lucide-react";
const logoUrl = "/ach-logo.png";

export const Route = createFileRoute("/admin/pos")({
  head: () => ({ meta: [{ title: "POS Billing — ACH Admin" }] }),
  component: POS,
});

type Product = {
  id: string; name: string; price: number; discount_price: number | null; stock: number;
  barcode: string | null; sku: string | null; gst_rate: number | null; image_urls: string[];
};
type Line = { product: Product; qty: number };

function POS() {
  const qc = useQueryClient();
  const [q, setQ] = useState("");
  const [lines, setLines] = useState<Line[]>([]);
  const [payment, setPayment] = useState<"CASH" | "UPI" | "CARD">("CASH");
  const [discount, setDiscount] = useState(0);
  const [invoice, setInvoice] = useState<null | { id: string; at: string }>(null);
  const scanRef = useRef<HTMLInputElement>(null);

  useEffect(() => { scanRef.current?.focus(); }, []);

  const { data: products } = useQuery({
    queryKey: ["pos-products", q],
    queryFn: async () => {
      let query = supabase.from("products").select("id,name,price,discount_price,stock,barcode,sku,gst_rate,image_urls").limit(24);
      if (q.trim()) query = query.or(`name.ilike.%${q}%,barcode.eq.${q},sku.ilike.%${q}%`);
      else query = query.order("created_at", { ascending: false });
      const { data } = await query;
      return (data ?? []) as Product[];
    },
  });

  function addProduct(p: Product) {
    if (p.stock <= 0) { toast.error(`${p.name} is out of stock`); return; }
    setLines((prev) => {
      const idx = prev.findIndex((l) => l.product.id === p.id);
      if (idx >= 0) {
        const next = [...prev];
        if (next[idx].qty + 1 > p.stock) { toast.error("Insufficient stock"); return prev; }
        next[idx] = { ...next[idx], qty: next[idx].qty + 1 };
        return next;
      }
      return [...prev, { product: p, qty: 1 }];
    });
  }

  async function onScan(e: React.FormEvent) {
    e.preventDefault();
    const code = q.trim();
    if (!code) return;
    const { data } = await supabase.from("products").select("id,name,price,discount_price,stock,barcode,sku,gst_rate,image_urls")
      .or(`barcode.eq.${code},sku.eq.${code}`).maybeSingle();
    if (data) { addProduct(data as Product); setQ(""); scanRef.current?.focus(); }
    else toast.error("Product not found");
  }

  const subtotal = useMemo(
    () => lines.reduce((s, l) => s + Number(l.product.discount_price ?? l.product.price) * l.qty, 0),
    [lines]
  );
  const gst = useMemo(
    () => lines.reduce((s, l) => s + Number(l.product.discount_price ?? l.product.price) * l.qty * (Number(l.product.gst_rate ?? 0) / 100), 0),
    [lines]
  );
  const total = Math.max(0, subtotal + gst - discount);

  async function placeSale() {
    if (!lines.length) return toast.error("Add at least one product");
    const items = lines.map((l) => ({ product_id: l.product.id, quantity: l.qty }));
    const { data, error } = await supabase.rpc("place_order", {
      _channel: "IN_STORE" as never,
      _payment_method: payment as never,
      _delivery_type: "PICKUP" as never,
      _address_id: null as never,
      _items: items as never,
      _notes: `POS sale · discount ₹${discount}` as never,
    });
    if (error) return toast.error(error.message);
    setInvoice({ id: data as string, at: new Date().toISOString() });
    toast.success("Sale completed");
    qc.invalidateQueries();
  }

  function reset() {
    setLines([]); setDiscount(0); setInvoice(null); setQ(""); scanRef.current?.focus();
  }

  if (invoice) return <Invoice orderId={invoice.id} at={invoice.at} onDone={reset} />;

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_400px]">
      <div className="space-y-4">
        <form onSubmit={onScan} className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white p-2 shadow-sm">
          <ScanBarcode className="ml-2 h-5 w-5 text-secondary" />
          <input ref={scanRef} value={q} onChange={(e) => setQ(e.target.value)}
            placeholder="Scan barcode or search by name / SKU…"
            className="flex-1 bg-transparent px-2 py-2 text-sm outline-none" />
          <button type="submit" className="rounded-lg bg-slate-900 px-4 py-2 text-xs font-semibold text-white">Add</button>
        </form>

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {(products ?? []).map((p) => {
            const price = Number(p.discount_price ?? p.price);
            const oos = p.stock <= 0;
            return (
              <button key={p.id} onClick={() => addProduct(p)} disabled={oos}
                className={`overflow-hidden rounded-xl border border-slate-200 bg-white text-left shadow-sm transition hover:shadow-md ${oos ? "opacity-50" : ""}`}>
                <div className="aspect-square bg-slate-50">
                  {p.image_urls?.[0] ? <img src={p.image_urls[0]} alt={p.name} className="h-full w-full object-cover" /> : null}
                </div>
                <div className="p-2">
                  <div className="truncate text-xs font-semibold text-slate-800">{p.name}</div>
                  <div className="mt-0.5 flex items-center justify-between">
                    <span className="text-sm font-bold text-slate-900">₹{price}</span>
                    <span className={`text-[10px] font-semibold ${oos ? "text-rose-600" : "text-emerald-600"}`}>
                      {oos ? "Out" : `${p.stock} left`}
                    </span>
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      <aside className="space-y-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm lg:sticky lg:top-20 h-fit">
        <div className="flex items-center justify-between">
          <div className="text-sm font-bold text-slate-900">Current Bill</div>
          {lines.length > 0 && (
            <button onClick={() => setLines([])} className="text-[11px] text-slate-500 hover:text-rose-600">Clear</button>
          )}
        </div>

        <div className="max-h-72 space-y-2 overflow-y-auto">
          {lines.length === 0 && <div className="py-8 text-center text-xs text-slate-400">No items yet</div>}
          {lines.map((l) => {
            const price = Number(l.product.discount_price ?? l.product.price);
            return (
              <div key={l.product.id} className="rounded-lg border border-slate-100 p-2">
                <div className="flex items-start gap-2">
                  <div className="flex-1 min-w-0">
                    <div className="truncate text-xs font-semibold text-slate-800">{l.product.name}</div>
                    <div className="text-[10px] text-slate-500">₹{price} · GST {Number(l.product.gst_rate ?? 0)}%</div>
                  </div>
                  <button onClick={() => setLines(lines.filter((x) => x.product.id !== l.product.id))} className="text-slate-400 hover:text-rose-600">
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
                <div className="mt-2 flex items-center justify-between">
                  <div className="flex items-center gap-1 rounded-lg border border-slate-200">
                    <button onClick={() => setLines(lines.map(x => x.product.id === l.product.id ? { ...x, qty: Math.max(1, x.qty - 1) } : x))} className="p-1"><Minus className="h-3 w-3" /></button>
                    <span className="w-6 text-center text-xs font-semibold">{l.qty}</span>
                    <button onClick={() => setLines(lines.map(x => x.product.id === l.product.id ? { ...x, qty: Math.min(x.product.stock, x.qty + 1) } : x))} className="p-1"><Plus className="h-3 w-3" /></button>
                  </div>
                  <div className="text-xs font-bold text-slate-900">₹{(price * l.qty).toFixed(2)}</div>
                </div>
              </div>
            );
          })}
        </div>

        <div className="rounded-lg bg-slate-50 p-3 text-xs space-y-1">
          <Row label="Subtotal" value={subtotal} />
          <Row label="GST" value={gst} />
          <div className="flex items-center justify-between">
            <span className="text-slate-600">Discount</span>
            <input type="number" min={0} value={discount} onChange={(e) => setDiscount(Math.max(0, Number(e.target.value) || 0))}
              className="w-20 rounded border border-slate-200 px-2 py-0.5 text-right text-xs" />
          </div>
          <div className="flex items-center justify-between border-t border-slate-200 pt-2 text-sm font-bold text-slate-900">
            <span>Total</span><span>₹{total.toFixed(2)}</span>
          </div>
        </div>

        <div>
          <div className="text-[11px] font-semibold text-slate-600 mb-1">Payment</div>
          <div className="grid grid-cols-3 gap-2">
            {(["CASH", "UPI", "CARD"] as const).map((m) => (
              <button key={m} onClick={() => setPayment(m)}
                className={`rounded-lg border px-2 py-2 text-xs font-semibold ${payment === m ? "border-secondary bg-secondary/10 text-secondary" : "border-slate-200 text-slate-600"}`}>
                {m}
              </button>
            ))}
          </div>
        </div>

        <button onClick={placeSale} disabled={!lines.length}
          className="w-full rounded-xl bg-slate-900 py-3 text-sm font-bold text-white shadow disabled:opacity-50 hover:bg-slate-800">
          Charge ₹{total.toFixed(2)}
        </button>
      </aside>
    </div>
  );
}

function Row({ label, value }: { label: string; value: number }) {
  return <div className="flex items-center justify-between"><span className="text-slate-600">{label}</span><span className="font-semibold text-slate-800">₹{value.toFixed(2)}</span></div>;
}

function Invoice({ orderId, at, onDone }: { orderId: string; at: string; onDone: () => void }) {
  const { data } = useQuery({
    queryKey: ["invoice", orderId],
    queryFn: async () => {
      const { data: order } = await supabase.from("orders").select("*").eq("id", orderId).single();
      const { data: items } = await supabase.from("order_items").select("*").eq("order_id", orderId);
      return { order, items };
    },
  });
  return (
    <div className="mx-auto max-w-md">
      <div className="mb-3 flex items-center justify-between print:hidden">
        <button onClick={onDone} className="flex items-center gap-1 text-xs text-slate-600"><X className="h-4 w-4" /> New Sale</button>
        <button onClick={() => window.print()} className="flex items-center gap-1 rounded-lg bg-slate-900 px-4 py-2 text-xs font-semibold text-white">
          <Printer className="h-3.5 w-3.5" /> Print
        </button>
      </div>
      <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm print:border-0 print:shadow-none">
        <div className="text-center border-b border-dashed border-slate-300 pb-3">
          <img src={logoUrl} alt="ACH" className="mx-auto h-12 w-12 rounded-full" />
          <div className="mt-2 font-display text-base font-bold">ATHIRA'S CREATIVE HAVEN</div>
          <div className="text-[10px] text-slate-500">Craft Supplies & Creative Classes</div>
          <div className="mt-1 text-[10px] text-slate-500">Tax Invoice</div>
        </div>
        <div className="py-3 text-[11px] text-slate-600 flex justify-between">
          <div>Bill #: {orderId.slice(0, 8).toUpperCase()}</div>
          <div>{new Date(at).toLocaleString()}</div>
        </div>
        <table className="w-full text-[11px]">
          <thead className="border-b border-slate-200 text-slate-500">
            <tr><th className="text-left py-1">Item</th><th className="text-right">Qty</th><th className="text-right">Price</th><th className="text-right">Total</th></tr>
          </thead>
          <tbody>
            {(data?.items ?? []).map((it) => (
              <tr key={it.id} className="border-b border-slate-100">
                <td className="py-1 pr-2">{it.product_name}</td>
                <td className="text-right">{it.quantity}</td>
                <td className="text-right">₹{Number(it.unit_price).toFixed(2)}</td>
                <td className="text-right">₹{Number(it.line_total).toFixed(2)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="mt-3 space-y-1 text-[12px]">
          <div className="flex justify-between"><span>Subtotal</span><span>₹{Number(data?.order?.subtotal ?? 0).toFixed(2)}</span></div>
          <div className="flex justify-between border-t border-slate-200 pt-1 text-sm font-bold"><span>Total</span><span>₹{Number(data?.order?.total ?? 0).toFixed(2)}</span></div>
          <div className="text-[10px] text-slate-500">Payment: {data?.order?.payment_method}</div>
        </div>
        <div className="mt-4 text-center text-[10px] text-slate-500">Thank you for shopping with us!</div>
      </div>
    </div>
  );
}
