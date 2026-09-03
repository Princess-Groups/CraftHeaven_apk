import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Search, Plus, Minus, Trash2, ScanBarcode, Printer, X } from "lucide-react";
import { COMPANY, TAX_INVOICE, AUTO_PRINT_POS, PRINT_CSS } from "@/lib/company";
const logoUrl = COMPANY.logo;

export const Route = createFileRoute("/admin/billing")({
  head: () => ({ meta: [{ title: "Billing — ACH Admin" }] }),
  component: Billing,
});

type ColorVariation = { color: string; image_url: string };

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

type BillLine = {
  product: Product;
  qty: number;
  color: string;
  colorImage: string;
};

function Billing() {
  const qc = useQueryClient();
  const [searchQuery, setSearchQuery] = useState("");
  const [searchType, setSearchType] = useState<"barcode" | "name">("barcode");
  const [lines, setLines] = useState<BillLine[]>([]);
  const [payment, setPayment] = useState<"CASH" | "UPI" | "CARD">("CASH");
  const [discount, setDiscount] = useState(0);
  const [shippingCharge, setShippingCharge] = useState(0);
  const [invoice, setInvoice] = useState<null | { id: string; at: string; auto?: boolean }>(null);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    searchRef.current?.focus();
  }, []);

  function mapVariations(v: unknown): ColorVariation[] {
    if (!Array.isArray(v)) return [];
    return (v as any[])
      .filter((x) => x && typeof x === "object")
      .map((x) => ({
        color: String(x.color ?? ""),
        image_url: String(x.image_url ?? ""),
      }));
  }

  // Search products by barcode or name
  const { data: searchResults } = useQuery({
    queryKey: ["billing-search", searchQuery, searchType],
    queryFn: async () => {
      if (!searchQuery.trim()) return [];
      let query = supabase
        .from("products")
        .select(
          "id,name,price,discount_price,stock,unit,barcode,sku,gst_rate,image_urls,cgst_rate,sgst_rate,igst_rate,color,color_variations",
        )
        .limit(10);
      if (searchType === "barcode") {
        query = query.or(`barcode.eq.${searchQuery.trim()},sku.eq.${searchQuery.trim()}`);
      } else {
        query = query.ilike("name", `%${searchQuery.trim()}%`);
      }
      const { data } = await query;
      return (data ?? []) as Product[];
    },
    enabled: searchQuery.trim().length > 0,
  });

  const addProduct = useCallback((p: Product) => {
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
    setSearchQuery("");
    setShowSuggestions(false);
    searchRef.current?.focus();
    toast.success(`Added: ${p.name}`);
  }, []);

  // Auto-search on barcode scan (Enter key)
  function onSearchSubmit(e: React.FormEvent) {
    e.preventDefault();
    const q = searchQuery.trim();
    if (!q) return;
    if (searchResults && searchResults.length === 1) {
      addProduct(searchResults[0]);
    } else if (searchResults && searchResults.length > 0) {
      setShowSuggestions(true);
    } else {
      toast.error("Product not found");
    }
  }

  // USB scanner support
  useEffect(() => {
    let buf = "";
    let timer: ReturnType<typeof setTimeout> | undefined;
    function onKey(e: KeyboardEvent) {
      if ((e.target as HTMLElement)?.tagName === "INPUT") return;
      if (e.key === "Enter") {
        if (buf.length >= 3) {
          e.preventDefault();
          setSearchQuery(buf);
          setSearchType("barcode");
        }
        buf = "";
        if (timer) clearTimeout(timer);
        return;
      }
      if (e.key.length === 1) {
        buf += e.key;
        if (timer) clearTimeout(timer);
        timer = setTimeout(() => (buf = ""), 80);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const subtotal = useMemo(
    () => lines.reduce((s, l) => s + Number(l.product.discount_price ?? l.product.price) * l.qty, 0),
    [lines],
  );

  const gst = useMemo(() => {
    let total = 0;
    for (const l of lines) {
      const line = Number(l.product.discount_price ?? l.product.price) * l.qty;
      const rate = Number(l.product.gst_rate ?? 0);
      total += (line * rate) / 100;
    }
    return total;
  }, [lines]);

  const total = Math.max(0, subtotal + gst - discount + shippingCharge);

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
      _notes: `Billing sale · discount ₹${discount}` as never,
      _tax_type: "CGST_SGST" as never,
      _shipping: shippingCharge,
      _state: "Tamil Nadu" as never,
      _discount: discount,
    });
    if (error) return toast.error(error.message);
    setInvoice({ id: data as string, at: new Date().toISOString(), auto: AUTO_PRINT_POS });
    toast.success("Sale completed");
    qc.invalidateQueries();
  }

  function reset() {
    setLines([]);
    setDiscount(0);
    setShippingCharge(0);
    setInvoice(null);
    setSearchQuery("");
    searchRef.current?.focus();
  }

  if (invoice) return <Invoice orderId={invoice.id} at={invoice.at} onDone={reset} auto={invoice.auto} />;

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_380px]">
      {/* Left: Search + product display */}
      <div className="space-y-4">
        {/* Search bar */}
        <form
          onSubmit={onSearchSubmit}
          className="rounded-xl border border-border bg-white p-3 shadow-sm"
        >
          <div className="flex items-center gap-2 mb-2">
            <button
              type="button"
              onClick={() => { setSearchType("barcode"); setSearchQuery(""); searchRef.current?.focus(); }}
              className={`rounded-lg px-3 py-1.5 text-xs font-semibold ${searchType === "barcode" ? "bg-primary text-white" : "bg-muted text-muted-foreground"}`}
            >
              <ScanBarcode className="inline h-3.5 w-3.5 mr-1" /> Barcode
            </button>
            <button
              type="button"
              onClick={() => { setSearchType("name"); setSearchQuery(""); searchRef.current?.focus(); }}
              className={`rounded-lg px-3 py-1.5 text-xs font-semibold ${searchType === "name" ? "bg-primary text-white" : "bg-muted text-muted-foreground"}`}
            >
              <Search className="inline h-3.5 w-3.5 mr-1" /> Product Name
            </button>
          </div>
          <div className="flex items-center gap-2">
            <ScanBarcode className="h-5 w-5 text-secondary ml-1" />
            <input
              ref={searchRef}
              value={searchQuery}
              onChange={(e) => {
                setSearchQuery(e.target.value);
                setShowSuggestions(e.target.value.trim().length > 0);
              }}
              onFocus={() => searchQuery.trim() && setShowSuggestions(true)}
              placeholder={searchType === "barcode" ? "Scan or type barcode…" : "Search by product name…"}
              className="flex-1 bg-transparent px-2 py-2 text-sm outline-none"
            />
            <button
              type="submit"
              className="rounded-lg bg-primary px-4 py-2 text-xs font-semibold text-white"
            >
              Search
            </button>
          </div>
        </form>

        {/* Search results / suggestions */}
        {showSuggestions && searchResults && searchResults.length > 0 && (
          <div className="rounded-xl border border-border bg-white shadow-lg p-2 max-h-80 overflow-y-auto">
            <div className="flex items-center justify-between px-2 mb-1">
              <span className="text-[10px] font-semibold text-muted-foreground uppercase">
                {searchResults.length} product(s) found
              </span>
              <button onClick={() => setShowSuggestions(false)} className="text-muted-foreground/60 hover:text-foreground">
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
            {searchResults.map((p) => {
              const price = Number(p.discount_price ?? p.price);
              const vars = mapVariations(p.color_variations).filter((v) => v.color);
              return (
                <button
                  key={p.id}
                  onClick={() => addProduct(p)}
                  disabled={p.stock <= 0}
                  className={`flex items-center gap-3 w-full px-3 py-2.5 rounded-lg hover:bg-secondary-soft text-left transition ${p.stock <= 0 ? "opacity-50" : ""}`}
                >
                  <div className="h-14 w-14 shrink-0 overflow-hidden rounded-lg bg-muted">
                    {p.image_urls?.[0] ? (
                      <img src={p.image_urls[0]} alt={p.name} className="h-full w-full object-cover" />
                    ) : null}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-semibold text-foreground">{p.name}</div>
                    <div className="text-[10px] text-muted-foreground mt-0.5">
                      {p.barcode || "No barcode"} · {p.sku || ""}
                    </div>
                    <div className="flex items-center gap-2 mt-1">
                      <span className="text-sm font-bold text-foreground">₹{price}</span>
                      {vars.length > 0 && (
                        <span className="rounded bg-emerald-50 px-1.5 py-0.5 text-[9px] font-semibold text-emerald-700">
                          {vars.length} colours
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <span className={`text-xs font-semibold ${p.stock <= 0 ? "text-rose-600" : "text-emerald-600"}`}>
                      {p.stock <= 0 ? "Out of stock" : `${p.stock} left`}
                    </span>
                  </div>
                </button>
              );
            })}
          </div>
        )}

        {/* Selected products in bill */}
        {lines.length > 0 && (
          <div className="space-y-2">
            <div className="text-xs font-semibold text-muted-foreground uppercase">
              Bill Items ({lines.length})
            </div>
            {lines.map((l, i) => {
              const price = Number(l.product.discount_price ?? l.product.price);
              const vars = mapVariations(l.product.color_variations).filter((v) => v.color);
              return (
                <div key={l.product.id} className="rounded-xl border border-border bg-white p-3 shadow-sm">
                  <div className="flex items-start gap-3">
                    <div className="h-12 w-12 shrink-0 overflow-hidden rounded-lg bg-muted">
                      {l.colorImage ? (
                        <img src={l.colorImage} alt="" className="h-full w-full object-cover" />
                      ) : null}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-semibold text-foreground">{l.product.name}</div>
                      <div className="text-[10px] text-muted-foreground">
                        {l.color ? <span className="font-semibold text-emerald-700">{l.color}</span> : null}
                        {l.color ? " · " : ""}₹{price} · GST {Number(l.product.gst_rate ?? 0)}%
                      </div>
                      {vars.length > 0 && (
                        <div className="mt-1.5 flex flex-wrap gap-1">
                          {vars.map((v) => (
                            <button
                              key={v.color}
                              onClick={() =>
                                setLines(lines.map((x, j) =>
                                  j === i ? { ...x, color: v.color, colorImage: v.image_url } : x,
                                ))
                              }
                              className={`flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[10px] font-semibold ${
                                l.color === v.color
                                  ? "border-secondary bg-secondary/10 text-secondary"
                                  : "border-border text-muted-foreground"
                              }`}
                            >
                              {v.image_url ? (
                                <img src={v.image_url} alt="" className="h-3.5 w-3.5 rounded-full object-cover" />
                              ) : null}
                              {v.color}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                    <button
                      onClick={() => setLines(lines.filter((_, j) => j !== i))}
                      className="text-muted-foreground/70 hover:text-rose-600"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                  <div className="mt-2 flex items-center justify-between">
                    <div className="flex items-center gap-1 rounded-lg border border-border">
                      <button
                        onClick={() =>
                          setLines(lines.map((x, j) =>
                            j === i
                              ? { ...x, qty: Math.max(0, Number((x.qty - 1).toFixed(3))) }
                              : x,
                          ))
                        }
                        className="p-1.5"
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
                          setLines(lines.map((x, j) =>
                            j === i
                              ? { ...x, qty: Math.max(0, Math.min(x.product.stock, Number(e.target.value) || 0)) }
                              : x,
                          ))
                        }
                        className="w-14 rounded border-0 bg-transparent text-center text-xs font-semibold outline-none"
                      />
                      <button
                        onClick={() =>
                          setLines(lines.map((x, j) =>
                            j === i
                              ? { ...x, qty: Math.min(x.product.stock, Number((x.qty + 1).toFixed(3))) }
                              : x,
                          ))
                        }
                        className="p-1.5"
                      >
                        <Plus className="h-3 w-3" />
                      </button>
                    </div>
                    <div className="text-right">
                      <div className="text-[10px] text-muted-foreground/70">{l.product.unit ?? "Nos"}</div>
                      <div className="text-sm font-bold text-foreground">₹{(price * l.qty).toFixed(2)}</div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {lines.length === 0 && (
          <div className="rounded-xl border-2 border-dashed border-border py-16 text-center">
            <ScanBarcode className="mx-auto h-10 w-10 text-muted-foreground/30 mb-3" />
            <div className="text-sm font-semibold text-muted-foreground/70">No products added yet</div>
            <div className="text-xs text-muted-foreground/50 mt-1">Search by barcode or product name to add items</div>
          </div>
        )}
      </div>

      {/* Right: Billing calculation panel */}
      <aside className="space-y-3 rounded-xl border border-border bg-white p-4 shadow-sm lg:sticky lg:top-20 h-fit">
        <div className="flex items-center justify-between">
          <div className="text-sm font-bold text-foreground">Billing Summary</div>
          {lines.length > 0 && (
            <button onClick={() => setLines([])} className="text-[11px] text-muted-foreground hover:text-rose-600">
              Clear All
            </button>
          )}
        </div>

        {lines.length === 0 ? (
          <div className="py-8 text-center text-xs text-muted-foreground/70">Add products to begin billing</div>
        ) : (
          <>
            <div className="rounded-lg bg-muted p-3 text-xs space-y-2">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Subtotal ({lines.length} items)</span>
                <span className="font-semibold">₹{subtotal.toFixed(2)}</span>
              </div>

              {/* Delivery Packing Charge */}
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Delivery Packing Charge</span>
                <input
                  type="number"
                  min={0}
                  defaultValue={0}
                  className="w-20 rounded border border-border px-2 py-0.5 text-right text-xs"
                  onBlur={(e) => {
                    // This is an additional charge, can be set manually
                  }}
                />
              </div>

              {/* Shipping Charge (renamed from Delivery Charge 5%) */}
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Shipping Charge</span>
                <input
                  type="number"
                  min={0}
                  value={shippingCharge}
                  onChange={(e) => setShippingCharge(Math.max(0, Number(e.target.value) || 0))}
                  className="w-20 rounded border border-border px-2 py-0.5 text-right text-xs"
                  placeholder="0"
                />
              </div>

              {/* GST */}
              <div className="flex justify-between">
                <span className="text-muted-foreground">GST</span>
                <span className="font-semibold">₹{gst.toFixed(2)}</span>
              </div>

              {/* Discount */}
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

              {/* Total */}
              <div className="flex justify-between border-t border-border pt-2 text-sm font-bold text-foreground">
                <span>Total</span>
                <span>₹{total.toFixed(2)}</span>
              </div>
            </div>

            {/* Payment Method */}
            <div>
              <div className="text-[11px] font-semibold text-muted-foreground mb-1.5">Payment Method</div>
              <div className="grid grid-cols-3 gap-2">
                {(["CASH", "UPI", "CARD"] as const).map((m) => (
                  <button
                    key={m}
                    onClick={() => setPayment(m)}
                    className={`rounded-lg border px-2 py-2 text-xs font-semibold transition ${
                      payment === m
                        ? "border-secondary bg-secondary/10 text-secondary"
                        : "border-border text-muted-foreground hover:bg-secondary-soft"
                    }`}
                  >
                    {m}
                  </button>
                ))}
              </div>
            </div>

            {/* Total Cash Received */}
            <div className="rounded-lg bg-emerald-50 p-3 text-center">
              <div className="text-[10px] uppercase tracking-wider text-emerald-700 font-semibold">
                Total Cash Received
              </div>
              <div className="text-xl font-extrabold text-emerald-800 mt-1">
                ₹{total.toFixed(2)}
              </div>
              <div className="text-[10px] text-emerald-600 mt-0.5">
                via {payment}
              </div>
            </div>

            {/* Charge button */}
            <button
              onClick={placeSale}
              disabled={!lines.length}
              className="w-full rounded-xl bg-primary py-3 text-sm font-bold text-white shadow disabled:opacity-50 hover:bg-primary/90 transition"
            >
              Complete Sale — ₹{total.toFixed(2)}
            </button>
          </>
        )}
      </aside>
    </div>
  );
}

// ---------- Invoice component (same as POS) ----------
function Invoice({
  orderId,
  at,
  onDone,
  auto,
}: {
  orderId: string;
  at: string;
  onDone: () => void;
  auto?: boolean;
}) {
  const { data } = useQuery({
    queryKey: ["invoice", orderId],
    queryFn: async () => {
      const { data: order } = await supabase.from("orders").select("*").eq("id", orderId).single();
      const { data: items } = await supabase
        .from("order_items")
        .select("*, products(hsn_code)")
        .eq("order_id", orderId);
      return { order, items };
    },
  });
  const order: any = data?.order;
  const items: any[] = data?.items ?? [];

  useEffect(() => {
    if (document.getElementById("ach-print-css")) return;
    const st = document.createElement("style");
    st.id = "ach-print-css";
    st.textContent = PRINT_CSS;
    document.head.appendChild(st);
  }, []);

  useEffect(() => {
    if (auto && data) {
      const t = setTimeout(() => window.print(), 250);
      return () => clearTimeout(t);
    }
  }, [auto, data]);

  const total = Number(order?.total ?? 0);
  const invoiceNo = orderId.slice(0, 8).toUpperCase();

  return (
    <div className="mx-auto max-w-md">
      <div className="mb-3 flex items-center justify-between no-print">
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
      <div className="print-area rounded-xl border border-border bg-white p-6 shadow-sm print:border-0 print:shadow-none">
        <div className="ind">
          <div className="hdr">
            {COMPANY.logo ? (
              <img src={COMPANY.logo} alt={COMPANY.name} className="mx-auto mb-1 h-12 w-12 rounded-full object-contain" style={{ background: "#fff !important" }} />
            ) : null}
            <div className="nm">{COMPANY.name}</div>
            {COMPANY.tagline ? <div className="tg">{COMPANY.tagline}</div> : null}
            <div className="gst">GSTIN : {COMPANY.gstin}</div>
          </div>
          <div className="addr text-center">
            {COMPANY.addressLine1}
            {COMPANY.addressLine2 ? <>, {COMPANY.addressLine2}</> : null}
            {COMPANY.addressLine3 ? <>, {COMPANY.addressLine3}</> : null}
            <div className="row" style={{ justifyContent: "center", flexWrap: "wrap" }}>
              {COMPANY.phone ? <span>Ph: {COMPANY.phone}</span> : null}
              {COMPANY.email ? <span>{COMPANY.email}</span> : null}
              {COMPANY.website ? <span>{COMPANY.website}</span> : null}
            </div>
            {COMPANY.cin ? <div className="g">CIN: {COMPANY.cin}</div> : null}
          </div>
          <div className="sep" />
          <div className="hdr">
            <div className="b" style={{ fontSize: 13 }}>{TAX_INVOICE ? "TAX INVOICE" : "INVOICE"}</div>
          </div>
          <div className="row g">
            <span>Invoice No: <span className="b">{invoiceNo}</span></span>
            <span>{new Date(at).toLocaleString()}</span>
          </div>
          <div className="sep" />
          <table>
            <thead>
              <tr style={{ background: "transparent" }}>
                <th style={{ width: "42%" }}>Item / HSN</th>
                <th className="right" style={{ textAlign: "right", width: "9%" }}>Qty</th>
                <th className="right" style={{ textAlign: "right", width: "15%" }}>Rate</th>
                <th className="right" style={{ textAlign: "right", width: "11%" }}>GST%</th>
                <th className="right" style={{ textAlign: "right", width: "18%" }}>Amount</th>
              </tr>
            </thead>
            <tbody>
              {items.map((it: any) => {
                const taxPct = Number(it.cgst_rate ?? 0) + Number(it.sgst_rate ?? 0);
                const hsn = it.products?.hsn_code ?? "";
                return (
                  <tr key={it.id}>
                    <td>
                      <div className="itm b">{it.product_name}</div>
                      {it.variation ? <div className="g">{it.variation}</div> : null}
                      {hsn ? <div className="g">HSN: {hsn}</div> : null}
                    </td>
                    <td className="right" style={{ textAlign: "right", whiteSpace: "nowrap" }}>{Number(it.quantity)} {it.unit ?? ""}</td>
                    <td className="right" style={{ textAlign: "right" }}>{Number(it.unit_price).toFixed(2)}</td>
                    <td className="right" style={{ textAlign: "right" }}>{taxPct > 0 ? `${taxPct}%` : "—"}</td>
                    <td className="right b" style={{ textAlign: "right" }}>{Number(it.line_total).toFixed(2)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <div className="sep" />
          <div className="row"><span>Subtotal</span><span>{Number(order?.subtotal ?? 0).toFixed(2)}</span></div>
          {Number(order?.discount ?? 0) > 0 && (
            <div className="row"><span>Discount</span><span>-{Number(order?.discount ?? 0).toFixed(2)}</span></div>
          )}
          {Number(order?.shipping_charges ?? 0) > 0 && (
            <div className="row"><span>Shipping Charge</span><span>{Number(order?.shipping_charges ?? 0).toFixed(2)}</span></div>
          )}
          <div className="sep" />
          <div className="row tt"><span>Total</span><span>{total.toFixed(2)}</span></div>
          <div className="words"><span className="b">Rupees {inWords(total)} only</span></div>
          <div className="row g"><span>Payment</span><span>{order?.payment_method ?? ""}</span></div>
          <div className="sep" />
          <div className="foot b">Thank you for shopping with us!</div>
          <div className="foot">Goods once sold will not be taken back or exchanged.</div>
        </div>
      </div>
    </div>
  );
}

// Number to words
const ONES = ["","One","Two","Three","Four","Five","Six","Seven","Eight","Nine","Ten","Eleven","Twelve","Thirteen","Fourteen","Fifteen","Sixteen","Seventeen","Eighteen","Nineteen"];
const TENS = ["","","Twenty","Thirty","Forty","Fifty","Sixty","Seventy","Eighty","Ninety"];
function two(n: number): string { if (n < 20) return ONES[n]; return TENS[Math.floor(n / 10)] + (n % 10 ? " " + ONES[n % 10] : ""); }
function three(n: number): string { const h = Math.floor(n / 100); const rest = n % 100; return (h ? ONES[h] + " Hundred" + (rest ? " " : "") : "") + (rest ? two(rest) : ""); }
function inWords(v: number): string {
  if (!isFinite(v) || v < 0) return "";
  let whole = Math.floor(v);
  const paise = Math.round((v - whole) * 100);
  let s = "";
  if (whole >= 1e7) { s += three(Math.floor(whole / 1e7)) + " Crore "; whole %= 1e7; }
  if (whole >= 1e5) { s += two(Math.floor(whole / 1e5)) + " Lakh "; whole %= 1e5; }
  if (whole >= 1e3) { s += three(Math.floor(whole / 1e3)) + " Thousand "; whole %= 1e3; }
  if (whole > 0) s += three(whole);
  if (s === "") s = "Zero";
  return s.trim() + (paise ? " And " + two(paise) + " Paise" : "");
}
