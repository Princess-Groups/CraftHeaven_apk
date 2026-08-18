import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Search, Plus, Minus, Trash2, ScanBarcode, Printer, X, Truck } from "lucide-react";
const logoUrl = "/ach-logo.png";

export const Route = createFileRoute("/admin/pos")({
  head: () => ({ meta: [{ title: "POS Billing — ACH Admin" }] }),
  component: POS,
});

type ColorVariation = { color: string; image_url: string };

// States list — flexible so any Indian state can be added later. The business
// state (where the store is registered) is used as the comparison baseline for
// intra vs inter-state GST.
const INDIAN_STATES = [
  "Andhra Pradesh",
  "Arunachal Pradesh",
  "Assam",
  "Bihar",
  "Chhattisgarh",
  "Goa",
  "Gujarat",
  "Haryana",
  "Himachal Pradesh",
  "Jharkhand",
  "Karnataka",
  "Kerala",
  "Madhya Pradesh",
  "Maharashtra",
  "Manipur",
  "Meghalaya",
  "Mizoram",
  "Nagaland",
  "Odisha",
  "Punjab",
  "Rajasthan",
  "Sikkim",
  "Tamil Nadu",
  "Telangana",
  "Tripura",
  "Uttar Pradesh",
  "Uttarakhand",
  "West Bengal",
  "Andaman & Nicobar Islands",
  "Chandigarh",
  "Dadra & Nagar Haveli and Daman & Diu",
  "Delhi",
  "Jammu & Kashmir",
  "Ladakh",
  "Lakshadweep",
  "Puducherry",
] as const;

const BUSINESS_STATE = "Tamil Nadu";

type Product = {
  id: string;
  name: string;
  price: number;
  discount_price: number | null;
  stock: number;
  unit: string;
  barcode: string | null;
  sku: string | null;
  gst_rate: number | null;
  image_urls: string[];
  cgst_rate: number | null;
  sgst_rate: number | null;
  igst_rate: number | null;
  color: string | null;
  color_variations: ColorVariation[];
};
type Line = {
  product: Product;
  qty: number;
  color: string; // selected colour / variation
  colorImage: string;
};

function POS() {
  const qc = useQueryClient();
  const [q, setQ] = useState("");
  const [lines, setLines] = useState<Line[]>([]);
  const [payment, setPayment] = useState<"CASH" | "UPI" | "CARD">("CASH");
  const [discount, setDiscount] = useState(0);
  const [shipping, setShipping] = useState(0); // manual courier charges
  const [state, setState] = useState<string>(BUSINESS_STATE);
  const [invoice, setInvoice] = useState<null | { id: string; at: string }>(null);
  const scanRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    scanRef.current?.focus();
  }, []);

  // Intra-state (same state as business) ⇒ CGST + SGST; inter-state ⇒ IGST.
  const taxType: "NONE" | "CGST_SGST" | "IGST" = state === BUSINESS_STATE ? "CGST_SGST" : "IGST";

  const { data: products } = useQuery({
    queryKey: ["pos-products", q],
    queryFn: async () => {
      let query = supabase
        .from("products")
        .select(
          "id,name,price,discount_price,stock,unit,barcode,sku,gst_rate,image_urls,cgst_rate,sgst_rate,igst_rate,color,color_variations",
        )
        .limit(24);
      if (q.trim()) query = query.or(`name.ilike.%${q}%,barcode.eq.${q},sku.ilike.%${q}%`);
      else query = query.order("created_at", { ascending: false });
      const { data } = await query;
      return (data ?? []) as Product[];
    },
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

  function addProduct(p: Product) {
    if (p.stock <= 0) {
      toast.error(`${p.name} is out of stock`);
      return;
    }
    setLines((prev) => {
      const idx = prev.findIndex((l) => l.product.id === p.id);
      if (idx >= 0) {
        const next = [...prev];
        if (next[idx].qty + 1 > p.stock) {
          toast.error("Insufficient stock");
          return prev;
        }
        next[idx] = { ...next[idx], qty: next[idx].qty + 1 };
        return next;
      }
      // First pick: default to the product's main color / first variation photo.
      const vars = mapVariations(p.color_variations);
      const firstVar = vars.find((v) => v.color) ?? null;
      return [
        ...prev,
        {
          product: p,
          qty: 1,
          color: firstVar?.color ?? p.color ?? "",
          colorImage: firstVar?.image_url ?? p.image_urls?.[0] ?? "",
        },
      ];
    });
  }

  function pickVariation(i: number, v: { color: string; image_url: string }) {
    setLines((prev) =>
      prev.map((x, j) => (j !== i ? x : { ...x, color: v.color, colorImage: v.image_url })),
    );
  }

  async function onScan(e: React.FormEvent) {
    e.preventDefault();
    const code = q.trim();
    if (!code) return;
    const { data } = await supabase
      .from("products")
      .select(
        "id,name,price,discount_price,stock,barcode,sku,gst_rate,image_urls,cgst_rate,sgst_rate,igst_rate,color,color_variations",
      )
      .or(`barcode.eq.${code},sku.eq.${code}`)
      .maybeSingle();
    if (data) {
      addProduct(data as Product);
      setQ("");
      scanRef.current?.focus();
    } else toast.error("Product not found");
  }

  const subtotal = useMemo(
    () =>
      lines.reduce((s, l) => s + Number(l.product.discount_price ?? l.product.price) * l.qty, 0),
    [lines],
  );

  const gst = useMemo(() => {
    let cgst = 0,
      sgst = 0,
      igst = 0;
    for (const l of lines) {
      const line = Number(l.product.discount_price ?? l.product.price) * l.qty;
      const cg = Number(l.product.cgst_rate ?? 0);
      const sg = Number(l.product.sgst_rate ?? 0);
      const ig = Number(l.product.igst_rate ?? 0) || cg + sg;
      if (taxType === "CGST_SGST") {
        cgst += (line * cg) / 100;
        sgst += (line * sg) / 100;
      } else if (taxType === "IGST") {
        igst += (line * ig) / 100;
      }
    }
    return { cgst, sgst, igst, total: cgst + sgst + igst };
  }, [lines, taxType]);

  const total = Math.max(0, subtotal + gst.total - discount + shipping);

  async function placeSale() {
    if (!lines.length) return toast.error("Add at least one product");
    const items = lines.map((l) => ({
      product_id: l.product.id,
      quantity: l.qty,
      variation: l.color,
    }));
    const { data, error } = await supabase.rpc("place_order", {
      _channel: "IN_STORE" as never,
      _payment_method: payment as never,
      _delivery_type: "PICKUP" as never,
      _address_id: null as never,
      _items: items as never,
      _notes: `POS sale · discount ₹${discount}` as never,
      _tax_type: taxType as never,
      _shipping: shipping,
      _state: state as never,
    });
    if (error) return toast.error(error.message);
    setInvoice({ id: data as string, at: new Date().toISOString() });
    toast.success("Sale completed");
    qc.invalidateQueries();
  }

  function reset() {
    setLines([]);
    setDiscount(0);
    setShipping(0);
    setInvoice(null);
    setQ("");
    setState(BUSINESS_STATE);
    scanRef.current?.focus();
  }

  if (invoice) return <Invoice orderId={invoice.id} at={invoice.at} onDone={reset} />;

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_400px]">
      <div className="space-y-4">
        <form
          onSubmit={onScan}
          className="flex items-center gap-2 rounded-xl border border-border bg-white p-2 shadow-sm"
        >
          <ScanBarcode className="ml-2 h-5 w-5 text-secondary" />
          <input
            ref={scanRef}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Scan barcode or search by name / SKU…"
            className="flex-1 bg-transparent px-2 py-2 text-sm outline-none"
          />
          <button
            type="submit"
            className="rounded-lg bg-primary px-4 py-2 text-xs font-semibold text-white"
          >
            Add
          </button>
        </form>

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {(products ?? []).map((p) => {
            const price = Number(p.discount_price ?? p.price);
            const oos = p.stock <= 0;
            const vars = mapVariations(p.color_variations).filter((v) => v.color);
            return (
              <button
                key={p.id}
                onClick={() => addProduct(p)}
                disabled={oos}
                className={`overflow-hidden rounded-xl border border-border bg-white text-left shadow-sm transition hover:shadow-md ${oos ? "opacity-50" : ""}`}
              >
                <div className="aspect-square bg-muted">
                  {p.image_urls?.[0] ? (
                    <img
                      src={p.image_urls[0]}
                      alt={p.name}
                      className="h-full w-full object-cover"
                    />
                  ) : null}
                </div>
                <div className="p-2">
                  <div className="truncate text-xs font-semibold text-foreground">{p.name}</div>
                  <div className="mt-0.5 flex flex-wrap items-center gap-1">
                    {vars.length > 0 ? (
                      <span className="rounded bg-emerald-50 px-1 py-0.5 text-[9px] font-semibold text-emerald-700">
                        {vars.length} colours
                      </span>
                    ) : p.color ? (
                      <span className="rounded bg-secondary-soft px-1 py-0.5 text-[9px] font-semibold text-muted-foreground">
                        {p.color}
                      </span>
                    ) : null}
                    <span className="text-sm font-bold text-foreground ml-auto">₹{price}</span>
                  </div>
                  <div className="mt-0.5 flex items-center justify-between">
                    <span
                      className={`text-[10px] font-semibold ${oos ? "text-rose-600" : "text-emerald-600"}`}
                    >
                      {oos ? "Out" : `${p.stock} ${p.unit} left`}
                    </span>
                    {vars.length > 0 && !oos ? (
                      <span className="text-[10px] text-muted-foreground/70">
                        tap to pick colour
                      </span>
                    ) : null}
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      <aside className="space-y-3 rounded-xl border border-border bg-white p-4 shadow-sm lg:sticky lg:top-20 h-fit">
        <div className="flex items-center justify-between">
          <div className="text-sm font-bold text-foreground">Current Bill</div>
          {lines.length > 0 && (
            <button
              onClick={() => setLines([])}
              className="text-[11px] text-muted-foreground hover:text-rose-600"
            >
              Clear
            </button>
          )}
        </div>

        {/* Transaction state — intra vs inter */}
        <div className="rounded-lg bg-muted p-2">
          <div className="mb-1 flex items-center gap-1 text-[10px] font-semibold uppercase text-muted-foreground">
            <Truck className="h-3 w-3" /> Customer state
          </div>
          <select
            value={state}
            onChange={(e) => setState(e.target.value)}
            className="w-full rounded-md border border-border bg-white px-2 py-1.5 text-xs"
          >
            {INDIAN_STATES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
          <div
            className={`mt-1 text-[10px] font-semibold ${taxType === "CGST_SGST" ? "text-emerald-600" : "text-sky-600"}`}
          >
            {taxType === "CGST_SGST" ? "Intra-state → CGST + SGST" : "Inter-state → IGST"}
          </div>
        </div>

        <div className="max-h-56 space-y-2 overflow-y-auto">
          {lines.length === 0 && (
            <div className="py-8 text-center text-xs text-muted-foreground/70">No items yet</div>
          )}
          {lines.map((l, i) => {
            const price = Number(l.product.discount_price ?? l.product.price);
            return (
              <div key={l.product.id} className="rounded-lg border border-border p-2">
                <div className="flex items-start gap-2">
                  <div className="h-10 w-10 shrink-0 overflow-hidden rounded bg-secondary-soft">
                    {l.colorImage ? (
                      <img src={l.colorImage} alt="" className="h-full w-full object-cover" />
                    ) : null}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="truncate text-xs font-semibold text-foreground">
                      {l.product.name}
                    </div>
                    <div className="text-[10px] text-muted-foreground">
                      {l.color ? (
                        <span className="font-semibold text-emerald-700">{l.color}</span>
                      ) : null}
                      {l.color ? " · " : ""}₹{price} · GST {Number(l.product.gst_rate ?? 0)}%
                    </div>
                  </div>
                  <button
                    onClick={() => setLines(lines.filter((x) => x.product.id !== l.product.id))}
                    className="text-muted-foreground/70 hover:text-rose-600"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
                {/* Colour picker within the bill row */}
                {mapVariations(l.product.color_variations).filter((v) => v.color).length > 0 && (
                  <div className="mt-1.5 flex flex-wrap gap-1">
                    {mapVariations(l.product.color_variations)
                      .filter((v) => v.color)
                      .map((v) => (
                        <button
                          key={v.color}
                          onClick={() => pickVariation(i, v)}
                          className={`flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[10px] font-semibold ${l.color === v.color ? "border-secondary bg-secondary/10 text-secondary" : "border-border text-muted-foreground"}`}
                        >
                          {v.image_url ? (
                            <img
                              src={v.image_url}
                              alt=""
                              className="h-3.5 w-3.5 rounded-full object-cover"
                            />
                          ) : null}
                          {v.color}
                        </button>
                      ))}
                  </div>
                )}
                <div className="mt-2 flex items-center justify-between">
                  <div className="flex items-center gap-1 rounded-lg border border-border">
                    <button
                      onClick={() =>
                        setLines(
                          lines.map((x) =>
                            x.product.id === l.product.id
                              ? { ...x, qty: Math.max(0, Number((x.qty - 0.5).toFixed(3))) }
                              : x,
                          ),
                        )
                      }
                      className="p-1"
                    >
                      <Minus className="h-3 w-3" />
                    </button>
                    <input
                      type="number"
                      step="0.001"
                      min={0}
                      max={l.product.stock}
                      value={l.qty}
                      onChange={(e) =>
                        setLines(
                          lines.map((x) =>
                            x.product.id === l.product.id
                              ? {
                                  ...x,
                                  qty: Math.max(
                                    0,
                                    Math.min(x.product.stock, Number(e.target.value) || 0),
                                  ),
                                }
                              : x,
                          ),
                        )
                      }
                      className="w-14 rounded border-0 bg-transparent text-center text-xs font-semibold outline-none"
                    />
                    <button
                      onClick={() =>
                        setLines(
                          lines.map((x) =>
                            x.product.id === l.product.id
                              ? {
                                  ...x,
                                  qty: Math.min(x.product.stock, Number((x.qty + 0.5).toFixed(3))),
                                }
                              : x,
                          ),
                        )
                      }
                      className="p-1"
                    >
                      <Plus className="h-3 w-3" />
                    </button>
                  </div>
                  <div className="text-right">
                    <div className="text-[10px] text-muted-foreground/70">
                      {l.product.unit ?? "Nos"}
                    </div>
                    <div className="text-xs font-bold text-foreground">
                      ₹{(price * l.qty).toFixed(2)}
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        <div className="rounded-lg bg-muted p-3 text-xs space-y-1">
          <Row label="Subtotal" value={subtotal} />
          {taxType === "CGST_SGST" ? (
            <>
              {gst.cgst > 0 && <Row label={`CGST (Central Tax)`} value={gst.cgst} />}
              {gst.sgst > 0 && <Row label={`SGST (State Tax)`} value={gst.sgst} />}
            </>
          ) : (
            gst.igst > 0 && <Row label={`IGST (GST)`} value={gst.igst} />
          )}
          {gst.total === 0 && <Row label="GST" value={0} />}
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">Discount</span>
            <input
              type="number"
              min={0}
              value={discount}
              onChange={(e) => setDiscount(Math.max(0, Number(e.target.value) || 0))}
              className="w-20 rounded border border-border px-2 py-0.5 text-right text-xs"
            />
          </div>
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">Shipping / Courier (₹)</span>
            <input
              type="number"
              min={0}
              value={shipping}
              onChange={(e) => setShipping(Math.max(0, Number(e.target.value) || 0))}
              className="w-20 rounded border border-border px-2 py-0.5 text-right text-xs"
              placeholder="0"
            />
          </div>
          <div className="flex items-center justify-between border-t border-border pt-2 text-sm font-bold text-foreground">
            <span>Total</span>
            <span>₹{total.toFixed(2)}</span>
          </div>
        </div>

        <div>
          <div className="text-[11px] font-semibold text-muted-foreground mb-1">Payment</div>
          <div className="grid grid-cols-3 gap-2">
            {(["CASH", "UPI", "CARD"] as const).map((m) => (
              <button
                key={m}
                onClick={() => setPayment(m)}
                className={`rounded-lg border px-2 py-2 text-xs font-semibold ${payment === m ? "border-secondary bg-secondary/10 text-secondary" : "border-border text-muted-foreground"}`}
              >
                {m}
              </button>
            ))}
          </div>
        </div>

        <button
          onClick={placeSale}
          disabled={!lines.length}
          className="w-full rounded-xl bg-primary py-3 text-sm font-bold text-white shadow disabled:opacity-50 hover:bg-primary/90"
        >
          Charge ₹{total.toFixed(2)}
        </button>
      </aside>
    </div>
  );
}

function Row({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-semibold text-foreground">₹{value.toFixed(2)}</span>
    </div>
  );
}

function Invoice({ orderId, at, onDone }: { orderId: string; at: string; onDone: () => void }) {
  const { data } = useQuery({
    queryKey: ["invoice", orderId],
    queryFn: async () => {
      const { data: order } = await supabase.from("orders").select("*").eq("id", orderId).single();
      const { data: items } = await supabase
        .from("order_items")
        .select("*")
        .eq("order_id", orderId);
      return { order, items };
    },
  });
  const order: any = data?.order;
  return (
    <div className="mx-auto max-w-md">
      <div className="mb-3 flex items-center justify-between print:hidden">
        <button onClick={onDone} className="flex items-center gap-1 text-xs text-muted-foreground">
          <X className="h-4 w-4" /> New Sale
        </button>
        <button
          onClick={() => window.print()}
          className="flex items-center gap-1 rounded-lg bg-primary px-4 py-2 text-xs font-semibold text-white"
        >
          <Printer className="h-3.5 w-3.5" /> Print
        </button>
      </div>
      <div className="rounded-xl border border-border bg-white p-6 shadow-sm print:border-0 print:shadow-none">
        <div className="text-center border-b border-dashed border-border pb-3">
          <img src={logoUrl} alt="ACH" className="mx-auto h-12 w-12 rounded-full" />
          <div className="mt-2 font-display text-base font-bold">ATHIRA'S CREATIVE HAVEN</div>
          <div className="text-[10px] text-muted-foreground">Craft Supplies & Creative Classes</div>
          <div className="mt-1 text-[10px] text-muted-foreground">Tax Invoice</div>
        </div>
        <div className="py-3 text-[11px] text-muted-foreground flex justify-between">
          <div>Bill #: {orderId.slice(0, 8).toUpperCase()}</div>
          <div>{new Date(at).toLocaleString()}</div>
        </div>
        <table className="w-full text-[11px]">
          <thead className="border-b border-border text-muted-foreground">
            <tr>
              <th className="text-left py-1">Item</th>
              <th className="text-right">Qty</th>
              <th className="text-right">Price</th>
              <th className="text-right">Total</th>
            </tr>
          </thead>
          <tbody>
            {(data?.items ?? []).map((it: any) => (
              <tr key={it.id} className="border-b border-border">
                <td className="py-1 pr-2">
                  {it.product_name}
                  {it.variation ? (
                    <span className="ml-1 rounded bg-emerald-50 px-1 py-0.5 text-[10px] font-semibold text-emerald-700">
                      {it.variation}
                    </span>
                  ) : null}
                </td>
                <td className="text-right whitespace-nowrap">
                  {Number(it.quantity)} {it.unit ?? ""}
                </td>
                <td className="text-right">₹{Number(it.unit_price).toFixed(2)}</td>
                <td className="text-right">₹{Number(it.line_total).toFixed(2)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="mt-3 space-y-1 text-[12px]">
          <div className="flex justify-between">
            <span>Subtotal</span>
            <span>₹{Number(order?.subtotal ?? 0).toFixed(2)}</span>
          </div>
          {order?.tax_type === "CGST_SGST" ? (
            <>
              {Number(order?.cgst_amount ?? 0) > 0 && (
                <div className="flex justify-between">
                  <span>CGST (Central)</span>
                  <span>₹{Number(order?.cgst_amount ?? 0).toFixed(2)}</span>
                </div>
              )}
              {Number(order?.sgst_amount ?? 0) > 0 && (
                <div className="flex justify-between">
                  <span>SGST (State)</span>
                  <span>₹{Number(order?.sgst_amount ?? 0).toFixed(2)}</span>
                </div>
              )}
            </>
          ) : (
            Number(order?.igst_amount ?? 0) > 0 && (
              <div className="flex justify-between">
                <span>IGST</span>
                <span>₹{Number(order?.igst_amount ?? 0).toFixed(2)}</span>
              </div>
            )
          )}
          {Number(order?.shipping_charges ?? 0) > 0 && (
            <div className="flex justify-between">
              <span>Shipping / Courier</span>
              <span>₹{Number(order?.shipping_charges ?? 0).toFixed(2)}</span>
            </div>
          )}
          <div className="flex justify-between border-t border-border pt-1 text-sm font-bold">
            <span>Total</span>
            <span>₹{Number(order?.total ?? 0).toFixed(2)}</span>
          </div>
          <div className="text-[10px] text-muted-foreground">Payment: {order?.payment_method}</div>
        </div>
        <div className="mt-4 text-center text-[10px] text-muted-foreground">
          Thank you for shopping with us!
        </div>
      </div>
    </div>
  );
}
