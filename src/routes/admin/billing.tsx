import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Search, Plus, Minus, Trash2, ScanBarcode, Printer, X, Users, FileText } from "lucide-react";
import { COMPANY, TAX_INVOICE, AUTO_PRINT_POS, PRINT_CSS } from "@/lib/company";
const logoUrl = COMPANY.logo;

export const Route = createFileRoute("/admin/billing")({
  head: () => ({ meta: [{ title: "Billing — ACH Admin" }] }),
  component: Billing,
});

type ColorVariation = {
  color: string;
  color_code: string;
  image_url: string;
  quantity: number;
  sold: number;
  remaining: number;
};

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

type SpecialBillingItem = {
  _id: string;
  product_name: string;
  pieces_sold: number;
  sold_for: number;
  unit_price: number;
  gst_rate: number;
};

type SpecialBillingClient = {
  name: string;
  contact: string;
  address: string;
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

  // Special Billing state
  const [billingMode, setBillingMode] = useState<"normal" | "special">("normal");
  const [specialClient, setSpecialClient] = useState<SpecialBillingClient>({ name: "", contact: "", address: "" });
  const [specialItems, setSpecialItems] = useState<SpecialBillingItem[]>([]);
  const [specialDiscount, setSpecialDiscount] = useState(0);
  const [specialDeliveryCharge, setSpecialDeliveryCharge] = useState(0);
  const [specialPackingCharge, setSpecialPackingCharge] = useState(0);
  const [specialPayment, setSpecialPayment] = useState<"CASH" | "UPI" | "CARD">("CASH");

  useEffect(() => {
    searchRef.current?.focus();
  }, []);

  function mapVariations(v: unknown): ColorVariation[] {
    if (!Array.isArray(v)) return [];
    return (v as any[])
      .filter((x) => x && typeof x === "object")
      .map((x) => ({
        color: String(x.color ?? ""),
        color_code: String(x.color_code ?? ""),
        image_url: String(x.image_url ?? ""),
        quantity: Number(x.quantity) || 0,
        sold: Number(x.sold) || 0,
        remaining: Number(x.remaining ?? (Number(x.quantity) || 0) - (Number(x.sold) || 0)),
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

  // Special Billing helpers
  const uid = () => typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : "sb-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 8);

  function addSpecialItem() {
    setSpecialItems((prev) => [
      ...prev,
      { _id: uid(), product_name: "", pieces_sold: 0, sold_for: 0, unit_price: 0, gst_rate: 0 },
    ]);
  }

  function updateSpecialItem(id: string, patch: Partial<SpecialBillingItem>) {
    setSpecialItems((prev) => prev.map((it) => (it._id === id ? { ...it, ...patch } : it)));
  }

  function removeSpecialItem(id: string) {
    setSpecialItems((prev) => prev.filter((it) => it._id !== id));
  }

  // Special Billing calculations
  const specialSubtotal = useMemo(
    () => specialItems.reduce((sum, it) => sum + (Number(it.sold_for) || 0), 0),
    [specialItems],
  );

  const specialGst = useMemo(
    () => specialItems.reduce((sum, it) => {
      const amount = Number(it.sold_for) || 0;
      const gstPct = Math.min(Math.max(Number(it.gst_rate) || 0, 0), 100);
      return sum + (amount * gstPct) / 100;
    }, 0),
    [specialItems],
  );

  const specialTotal = Math.max(
    0,
    specialSubtotal + specialGst - specialDiscount + specialDeliveryCharge + specialPackingCharge,
  );

  async function placeSpecialSale() {
    if (!specialClient.name.trim()) return toast.error("Client name is required");
    if (specialItems.length === 0) return toast.error("Add at least one item");

    const items = specialItems.map((it) => ({
      product_name: it.product_name,
      pieces_sold: Number(it.pieces_sold) || 0,
      sold_for: Number(it.sold_for) || 0,
      unit_price: Number(it.unit_price) || 0,
      gst_rate: Number(it.gst_rate) || 0,
    }));

    const { data, error } = await supabase.rpc("place_order", {
      _channel: "SPECIAL_BILLING" as never,
      _payment_method: specialPayment as never,
      _delivery_type: "SPECIAL" as never,
      _address_id: null as never,
      _items: [] as never,
      _notes: JSON.stringify({
        type: "SPECIAL_BILLING",
        client: specialClient,
        items,
        pieces_sold: specialItems.reduce((sum, it) => sum + (Number(it.pieces_sold) || 0), 0),
        sold_for_total: specialSubtotal,
        discount: specialDiscount,
        delivery_charge: specialDeliveryCharge,
        packing_charge: specialPackingCharge,
      }) as never,
      _tax_type: "CGST_SGST" as never,
      _shipping: specialDeliveryCharge + specialPackingCharge,
      _state: "Tamil Nadu" as never,
      _discount: specialDiscount,
    });

    if (error) return toast.error(error.message);
    setInvoice({ id: data as string, at: new Date().toISOString(), auto: AUTO_PRINT_POS });
    toast.success("Special Billing completed");
    resetSpecialBilling();
    qc.invalidateQueries();
  }

  function resetSpecialBilling() {
    setSpecialClient({ name: "", contact: "", address: "" });
    setSpecialItems([]);
    setSpecialDiscount(0);
    setSpecialDeliveryCharge(0);
    setSpecialPackingCharge(0);
    setSpecialPayment("CASH");
  }

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

  // ---- SPECIAL BILLING MODE ----
  if (billingMode === "special") {
    return (
      <div className="space-y-4">
        {/* Mode Selector */}
        <div className="flex items-center gap-2">
          <h1 className="text-xl font-bold text-foreground flex-1">Billing</h1>
          <button
            onClick={() => setBillingMode("normal")}
            className="flex items-center gap-1.5 rounded-lg border border-border bg-white px-3 py-2 text-xs font-semibold text-muted-foreground hover:bg-secondary-soft"
          >
            <ScanBarcode className="h-3.5 w-3.5" /> Normal Billing
          </button>
          <button
            className="flex items-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-xs font-semibold text-white"
          >
            <Users className="h-3.5 w-3.5" /> Special Billing
          </button>
        </div>

        <div className="grid gap-4 lg:grid-cols-[1fr_380px]">
          {/* Left: Special Billing Form */}
          <div className="space-y-4">
            {/* Client Details */}
            <div className="rounded-xl border border-border bg-white p-4 shadow-sm">
              <div className="flex items-center gap-2 mb-3">
                <Users className="h-4 w-4 text-primary" />
                <h2 className="text-sm font-bold text-foreground">Client / Customer Details</h2>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <div>
                  <label className="mb-1 block text-[11px] font-semibold text-muted-foreground">Client Name *</label>
                  <input
                    value={specialClient.name}
                    onChange={(e) => setSpecialClient({ ...specialClient, name: e.target.value })}
                    placeholder="Enter client name"
                    className="w-full rounded-lg border border-border bg-white px-3 py-2 text-sm outline-none focus:border-primary"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-[11px] font-semibold text-muted-foreground">Contact Number</label>
                  <input
                    value={specialClient.contact}
                    onChange={(e) => setSpecialClient({ ...specialClient, contact: e.target.value })}
                    placeholder="Phone number"
                    className="w-full rounded-lg border border-border bg-white px-3 py-2 text-sm outline-none focus:border-primary"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-[11px] font-semibold text-muted-foreground">Address</label>
                  <input
                    value={specialClient.address}
                    onChange={(e) => setSpecialClient({ ...specialClient, address: e.target.value })}
                    placeholder="Client address"
                    className="w-full rounded-lg border border-border bg-white px-3 py-2 text-sm outline-none focus:border-primary"
                  />
                </div>
              </div>
            </div>

            {/* Product / Sale Items */}
            <div className="rounded-xl border border-border bg-white p-4 shadow-sm">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <FileText className="h-4 w-4 text-primary" />
                  <h2 className="text-sm font-bold text-foreground">Product / Sale Details</h2>
                </div>
                <button
                  onClick={addSpecialItem}
                  className="flex items-center gap-1 rounded-lg bg-primary/10 px-3 py-1.5 text-xs font-semibold text-primary hover:bg-primary/20"
                >
                  <Plus className="h-3.5 w-3.5" /> Add Item
                </button>
              </div>

              {specialItems.length === 0 ? (
                <div className="py-8 text-center text-xs text-muted-foreground/70">
                  No items added. Click "Add Item" to begin.
                </div>
              ) : (
                <div className="space-y-3">
                  {specialItems.map((item, idx) => (
                    <div key={item._id} className="rounded-lg border border-border bg-muted/30 p-3">
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-[10px] font-bold text-muted-foreground uppercase">Item {idx + 1}</span>
                        <button
                          onClick={() => removeSpecialItem(item._id)}
                          className="rounded p-1 hover:bg-rose-50 text-rose-500"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                      <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
                        <div className="col-span-2">
                          <label className="mb-1 block text-[10px] font-semibold text-muted-foreground">Product / Item</label>
                          <input
                            value={item.product_name}
                            onChange={(e) => updateSpecialItem(item._id, { product_name: e.target.value })}
                            placeholder="Product name"
                            className="w-full rounded-lg border border-border bg-white px-3 py-2 text-sm outline-none focus:border-primary"
                          />
                        </div>
                        <div>
                          <label className="mb-1 block text-[10px] font-semibold text-muted-foreground">Pieces Sold</label>
                          <input
                            type="number"
                            min={0}
                            value={item.pieces_sold || ""}
                            onChange={(e) => updateSpecialItem(item._id, { pieces_sold: Number(e.target.value) || 0 })}
                            className="w-full rounded-lg border border-border bg-white px-3 py-2 text-sm outline-none focus:border-primary text-right"
                          />
                        </div>
                        <div>
                          <label className="mb-1 block text-[10px] font-semibold text-muted-foreground">Sold For (₹)</label>
                          <input
                            type="number"
                            min={0}
                            value={item.sold_for || ""}
                            onChange={(e) => updateSpecialItem(item._id, { sold_for: Number(e.target.value) || 0 })}
                            className="w-full rounded-lg border border-border bg-white px-3 py-2 text-sm outline-none focus:border-primary text-right"
                          />
                        </div>
                        <div>
                          <label className="mb-1 block text-[10px] font-semibold text-muted-foreground">GST %</label>
                          <input
                            type="number"
                            min={0}
                            max={100}
                            value={item.gst_rate || ""}
                            onChange={(e) => updateSpecialItem(item._id, { gst_rate: Number(e.target.value) || 0 })}
                            className="w-full rounded-lg border border-border bg-white px-3 py-2 text-sm outline-none focus:border-primary text-right"
                          />
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Right: Special Billing Summary */}
          <aside className="space-y-3 rounded-xl border border-border bg-white p-4 shadow-sm lg:sticky lg:top-20 h-fit">
            <div className="flex items-center justify-between">
              <div className="text-sm font-bold text-foreground">Special Billing Summary</div>
              {specialItems.length > 0 && (
                <button onClick={resetSpecialBilling} className="text-[11px] text-muted-foreground hover:text-rose-600">
                  Clear All
                </button>
              )}
            </div>

            {/* Client Info */}
            {specialClient.name && (
              <div className="rounded-lg bg-primary/5 p-2 text-xs">
                <div className="font-semibold text-primary">{specialClient.name}</div>
                {specialClient.contact && <div className="text-muted-foreground">{specialClient.contact}</div>}
                {specialClient.address && <div className="text-muted-foreground">{specialClient.address}</div>}
              </div>
            )}

            {specialItems.length === 0 ? (
              <div className="py-8 text-center text-xs text-muted-foreground/70">Add items to begin</div>
            ) : (
              <>
                {/* Items Summary */}
                <div className="rounded-lg bg-muted p-3 text-xs space-y-2">
                  {specialItems.map((it) => (
                    <div key={it._id} className="flex justify-between">
                      <span className="truncate flex-1">{it.product_name || "Unnamed"}</span>
                      <span className="font-semibold ml-2">₹{(Number(it.sold_for) || 0).toFixed(2)}</span>
                    </div>
                  ))}
                  <div className="border-t border-border pt-2 flex justify-between font-semibold">
                    <span>Subtotal ({specialItems.reduce((s, it) => s + (Number(it.pieces_sold) || 0), 0)} pieces)</span>
                    <span>₹{specialSubtotal.toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">GST</span>
                    <span>₹{specialGst.toFixed(2)}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">Discount</span>
                    <input
                      type="number"
                      min={0}
                      value={specialDiscount}
                      onChange={(e) => setSpecialDiscount(Math.max(0, Number(e.target.value) || 0))}
                      className="w-20 rounded border border-border px-2 py-0.5 text-right text-xs"
                    />
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">Delivery Charge</span>
                    <input
                      type="number"
                      min={0}
                      value={specialDeliveryCharge}
                      onChange={(e) => setSpecialDeliveryCharge(Math.max(0, Number(e.target.value) || 0))}
                      className="w-20 rounded border border-border px-2 py-0.5 text-right text-xs"
                    />
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">Packing Charge</span>
                    <input
                      type="number"
                      min={0}
                      value={specialPackingCharge}
                      onChange={(e) => setSpecialPackingCharge(Math.max(0, Number(e.target.value) || 0))}
                      className="w-20 rounded border border-border px-2 py-0.5 text-right text-xs"
                    />
                  </div>
                  <div className="flex justify-between border-t border-border pt-2 text-sm font-bold text-foreground">
                    <span>Total</span>
                    <span>₹{specialTotal.toFixed(2)}</span>
                  </div>
                </div>

                {/* Payment Method */}
                <div>
                  <div className="text-[11px] font-semibold text-muted-foreground mb-1.5">Payment Method</div>
                  <div className="grid grid-cols-3 gap-2">
                    {(["CASH", "UPI", "CARD"] as const).map((m) => (
                      <button
                        key={m}
                        onClick={() => setSpecialPayment(m)}
                        className={`rounded-lg border px-2 py-2 text-xs font-semibold transition ${
                          specialPayment === m
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
                    Total Payable
                  </div>
                  <div className="text-xl font-extrabold text-emerald-800 mt-1">
                    ₹{specialTotal.toFixed(2)}
                  </div>
                  <div className="text-[10px] text-emerald-600 mt-0.5">
                    via {specialPayment}
                  </div>
                </div>

                {/* Complete Sale */}
                <button
                  onClick={placeSpecialSale}
                  disabled={!specialClient.name.trim() || specialItems.length === 0}
                  className="w-full rounded-xl bg-primary py-3 text-sm font-bold text-white shadow disabled:opacity-50 hover:bg-primary/90 transition"
                >
                  Complete Special Sale — ₹{specialTotal.toFixed(2)}
                </button>
              </>
            )}
          </aside>
        </div>
      </div>
    );
  }

  // ---- NORMAL BILLING MODE ----
  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_380px]">
      {/* Left: Search + product display */}
      <div className="space-y-4">
        {/* Mode Selector */}
        <div className="flex items-center gap-2">
          <h1 className="text-xl font-bold text-foreground flex-1">Billing</h1>
          <button
            className="flex items-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-xs font-semibold text-white"
          >
            <ScanBarcode className="h-3.5 w-3.5" /> Normal Billing
          </button>
          <button
            onClick={() => setBillingMode("special")}
            className="flex items-center gap-1.5 rounded-lg border border-border bg-white px-3 py-2 text-xs font-semibold text-muted-foreground hover:bg-secondary-soft"
          >
            <Users className="h-3.5 w-3.5" /> Special Billing
          </button>
        </div>

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
              const vars = mapVariations(p.color_variations).filter((v) => v.color || v.color_code);
              const totalVariantQty = vars.reduce((s, v) => s + v.quantity, 0);
              const totalVariantSold = vars.reduce((s, v) => s + v.sold, 0);
              const totalVariantRemaining = vars.reduce((s, v) => s + (v.remaining ?? (v.quantity - v.sold)), 0);
              const hasVariants = vars.length > 0;
              const stockDisplay = hasVariants ? totalVariantRemaining : p.stock;
              const isOutOfStock = stockDisplay <= 0;
              return (
                <button
                  key={p.id}
                  onClick={() => addProduct(p)}
                  disabled={isOutOfStock}
                  className={`flex items-center gap-3 w-full px-3 py-2.5 rounded-lg hover:bg-secondary-soft text-left transition ${isOutOfStock ? "opacity-50" : ""}`}
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
                      {hasVariants && (
                        <span className="rounded bg-primary/10 px-1.5 py-0.5 text-[9px] font-semibold text-primary">
                          {vars.length} variant{vars.length !== 1 ? "s" : ""}
                        </span>
                      )}
                    </div>
                    {hasVariants && (
                      <div className="flex flex-wrap gap-1 mt-1">
                        {vars.slice(0, 4).map((v) => {
                          const rem = v.remaining ?? (v.quantity - v.sold);
                          const vOut = rem <= 0 && v.quantity > 0;
                          const vLow = rem > 0 && rem <= 2;
                          return (
                            <span
                              key={v.color + v.color_code}
                              className={`inline-flex items-center gap-0.5 rounded px-1 py-0.5 text-[8px] font-semibold ${
                                vOut ? "bg-rose-50 text-rose-600" : vLow ? "bg-amber-50 text-amber-600" : "bg-emerald-50 text-emerald-600"
                              }`}
                            >
                              {v.image_url ? <img src={v.image_url} alt="" className="h-2.5 w-2.5 rounded-full object-cover" /> : null}
                              {v.color || v.color_code}
                              {v.color_code ? <span className="opacity-60">({v.color_code})</span> : null}
                              <span className="opacity-60">·{rem}</span>
                            </span>
                          );
                        })}
                        {vars.length > 4 && <span className="text-[8px] text-muted-foreground">+{vars.length - 4}</span>}
                      </div>
                    )}
                  </div>
                  <div className="text-right shrink-0">
                    <span className={`text-xs font-semibold ${isOutOfStock ? "text-rose-600" : "text-emerald-600"}`}>
                      {isOutOfStock ? "Out of stock" : `${stockDisplay} left`}
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
              const vars = mapVariations(l.product.color_variations).filter((v) => v.color || v.color_code);
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
                          {vars.map((v) => {
                            const rem = v.remaining ?? (v.quantity - v.sold);
                            const vOut = rem <= 0 && v.quantity > 0;
                            return (
                              <button
                                key={v.color + v.color_code}
                                onClick={() => {
                                  if (vOut) { toast.error(`Only ${rem} left for ${v.color || v.color_code}`); return; }
                                  setLines(lines.map((x, j) =>
                                    j === i ? { ...x, color: v.color || v.color_code, colorImage: v.image_url } : x,
                                  ));
                                }}
                                disabled={vOut}
                                className={`flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[10px] font-semibold ${
                                  l.color === v.color || l.color === v.color_code
                                    ? "border-secondary bg-secondary/10 text-secondary"
                                    : vOut ? "border-border text-muted-foreground/40" : "border-border text-muted-foreground"
                                }`}
                              >
                                {v.image_url ? (
                                  <img src={v.image_url} alt="" className="h-3.5 w-3.5 rounded-full object-cover" />
                                ) : null}
                                {v.color || v.color_code}
                                {v.color_code ? <span className="opacity-60">({v.color_code})</span> : null}
                                <span className="opacity-60">·{rem}</span>
                              </button>
                            );
                          })}
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
