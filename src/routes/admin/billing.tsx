import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Search, Plus, Minus, Trash2, ScanBarcode, Printer, X, Users, FileText, Percent, Info, Usb, Bluetooth, CheckCircle2, AlertCircle, Settings, Wifi, WifiOff, Maximize2, Eye, Loader2, RefreshCw } from "lucide-react";
import { COMPANY, TAX_INVOICE, AUTO_PRINT_POS, PRINT_CSS } from "@/lib/company";
import { autoAssignGst, splitCgstSgst, GST_RATES, GST_RATE_LABELS, calcGstAmount } from "@/lib/gst-config";
import {
  getPrinters,
  getPrinterStatus,
  printReceipt,
  printTestLabel,
  generateLabelPreview,
  openLabelPreview,
  type PrinterInfo,
  type ReceiptPrintJob,
} from "@/lib/print-service";
import {
  getHardwareConfig,
  type HardwareConfig,
} from "@/lib/hardware";
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
  wholesale_price: number | null | undefined;
  purchase_price: number | null | undefined;
  total_unit_cost: number | null | undefined;
  stock: number;
  unit: string;
  barcode: string | null;
  sku: string | null;
  gst_rate: number | null;
  image_urls: string[];
  cgst_rate: number | null;
  sgst_rate: number | null;
  igst_rate: number | null;
  category_id: string | null;
  color: string | null;
  material: string | null;
  color_variations: ColorVariation[];
};

type BillLine = {
  product: Product;
  qty: number;
  color: string;
  colorImage: string;
  gstOverride: number | null; // per-line manual override, null = use product's GST
  priceType: "RETAIL" | "WHOLESALE";
};

// Best available price for a product: retail price first, else the unit cost
// stored by purchase entry (so products saved with price = 0 still bill/shoow the
// correct amount).
function productPrice(p: Product, wholesale = false): number {
  if (wholesale && Number(p.wholesale_price ?? 0) > 0) return Number(p.wholesale_price);
  const retail = Number(p.discount_price ?? p.price);
  if (retail > 0) return retail;
  const cost = Number(p.total_unit_cost ?? 0);
  if (cost > 0) return cost;
  return Number(p.purchase_price ?? 0);
}

// Effective unit price for a bill line: wholesale lines bill at the product's
// wholesale price (fall back to retail/cost when none is set).
function unitPriceFor(l: BillLine): number {
  return productPrice(l.product, l.priceType === "WHOLESALE");
}

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
  const [lines, setLines] = useState<BillLine[]>([]);
  const [payment, setPayment] = useState<"CASH" | "UPI" | "CARD">("CASH");
  const [discount, setDiscount] = useState(0);
  const [shippingCharge, setShippingCharge] = useState(0);
  const [invoice, setInvoice] = useState<null | { id: string; at: string; auto?: boolean }>(null);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);

  // Barcode scanner state
  const [scannerStatus, setScannerStatus] = useState<"idle" | "scanning" | "found" | "not-found">("idle");
  const [lastScannedBarcode, setLastScannedBarcode] = useState<string>("");
  const [scannerError, setScannerError] = useState<string>("");
  const [showScannerHelp, setShowScannerHelp] = useState(false);

  // Printer state
  const [selectedPrinterId, setSelectedPrinterId] = useState<string>("");
  const [printers, setPrinters] = useState<PrinterInfo[]>([]);
  const [printerLoading, setPrinterLoading] = useState(false);
  const [printerStatus, setPrinterStatus] = useState<Record<string, "connected" | "disconnected" | "error" | "unknown">>({});
  const [showPrinterSettings, setShowPrinterSettings] = useState(false);

  // Hardware config from database
  const { data: hwData, refetch: refetchHardware } = useQuery({
    queryKey: ["hardware-config"],
    queryFn: () => getHardwareConfig(),
    refetchOnWindowFocus: false,
  });

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

  // Search products by barcode or name (fires on every keystroke)
  const { data: searchResults, isLoading: searchLoading } = useQuery({
    queryKey: ["billing-search", searchQuery],
    queryFn: async () => {
      if (!searchQuery.trim()) return [];
      const q = searchQuery.trim();
      let query = supabase
        .from("products")
        .select(
          "id,name,price,discount_price,wholesale_price,purchase_price,total_unit_cost,stock,unit,barcode,sku,gst_rate,image_urls,cgst_rate,sgst_rate,igst_rate,category_id,color,material,color_variations",
        )
        .limit(50);
      // Unified type-to-search: match product name, barcode or SKU as a substring.
      query = query.or(
        `name.ilike.%${q}%,barcode.ilike.%${q}%,sku.ilike.%${q}%,material.ilike.%${q}%`,
      );
      const { data } = await query;
      return (data ?? []) as unknown as Product[];
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
          gstOverride: null,
          priceType: "RETAIL",
        },
      ];
    });
    setSearchQuery("");
    setShowSuggestions(false);
    searchRef.current?.focus();
    toast.success(`Added: ${p.name}`);
  }, []);

  // Handle barcode scan result - add product to bill or show error
  useEffect(() => {
    if (searchQuery.trim().length < 1) return;
    if (searchLoading) return;

    if (searchResults && searchResults.length === 1) {
      // Single product found - add it
      addProduct(searchResults[0]);
      setScannerStatus("found");
      setScannerError("");
      // Clear after showing success briefly
      setTimeout(() => setScannerStatus("idle"), 1500);
    } else if (searchResults && searchResults.length > 1) {
      // Multiple matches - show suggestions
      setShowSuggestions(true);
      setScannerStatus("found");
      setScannerError("");
    } else {
      // No product found
      setScannerStatus("not-found");
      setScannerError(`Product not found for: "${searchQuery.trim()}"`);
      setTimeout(() => setScannerStatus("idle"), 3000);
    }
  }, [searchResults, searchLoading, searchQuery, addProduct]);

  // Categories query for GST auto-assignment
  const { data: categories } = useQuery({
    queryKey: ["billing-cats"],
    queryFn: async () => (await supabase.from("categories").select("id,name")).data ?? [],
  });

  const categoryNameMap = useMemo(() => {
    const map: Record<string, string> = {};
    (categories ?? []).forEach((c: { id: string; name: string }) => { map[c.id] = c.name; });
    return map;
  }, [categories]);

  // Get the effective GST rate for a bill line (override > product default > auto-assign)
  function getEffectiveGst(line: BillLine): number {
    if (line.gstOverride !== null && line.gstOverride !== undefined) return line.gstOverride;
    const categoryName = line.product.category_id ? categoryNameMap[line.product.category_id] ?? null : null;
    return autoAssignGst(line.product.name, categoryName, line.product.id, Number(line.product.gst_rate ?? 0));
  }

  // Update a line's GST override
  function setLineGstOverride(lineIndex: number, rate: number | null) {
    setLines((prev) => prev.map((l, i) => i === lineIndex ? { ...l, gstOverride: rate } : l));
  }

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
    let isComposing = false;

    function onKeyDown(e: KeyboardEvent) {
      const target = e.target as HTMLElement;
      // Don't intercept if user is typing in an input/textarea
      if (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable) return;

      // Handle composition events (IME input)
      if (e.key === "Process" || e.key === "CompositionStart") {
        isComposing = true;
        return;
      }
      if (e.key === "CompositionEnd") {
        isComposing = false;
        return;
      }
      if (isComposing) return;

      // Enter key = potential end of barcode
      if (e.key === "Enter") {
        if (buf.length >= 3) {
          e.preventDefault();
          const barcode = buf.trim();
          setSearchQuery(barcode);
          setLastScannedBarcode(barcode);
          setScannerStatus("scanning");

          // The search will happen automatically via the query
          // We'll handle the result in a separate effect
        }
        buf = "";
        if (timer) clearTimeout(timer);
        return;
      }

      // Accumulate printable characters (single key presses)
      if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
        buf += e.key;
        if (timer) clearTimeout(timer);
        // 80ms timeout - if no key for 80ms, assume it's manual typing, not a scanner
        timer = setTimeout(() => {
          buf = "";
        }, 80);
      }
    }

    function onKeyUp(e: KeyboardEvent) {
      // We only use keydown for barcode detection
    }

    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      if (timer) clearTimeout(timer);
    };
  }, []);

  // Load printers on mount and when hardware config changes
  useEffect(() => {
    loadPrinters();
  }, []);

  // Initialize receipt printer from hardware config when it loads
  useEffect(() => {
    if (hwData?.config) {
      const cfg = hwData.config;
      // Auto-select receipt printer from hardware config
      if (cfg.receipt_printer_id && !selectedPrinterId) {
        setSelectedPrinterId(cfg.receipt_printer_id);
      }
    }
  }, [hwData?.config, selectedPrinterId]);

  const loadPrinters = useCallback(async () => {
    setPrinterLoading(true);
    try {
      // Use printers from hardware config (fetched server-side from Print Agent)
      if (hwData?.printers?.length) {
        setPrinters(hwData.printers);
        // Auto-select default printer if none selected
        const defaultPrinter = hwData.printers.find(p => p.isDefault) || hwData.printers[0];
        if (defaultPrinter && !selectedPrinterId) {
          setSelectedPrinterId(defaultPrinter.id);
          checkPrinterStatus(defaultPrinter.id);
        }
      } else {
        // Fallback to client-side fetch
        const printerList = await getPrinters();
        setPrinters(printerList);
        const defaultPrinter = printerList.find(p => p.isDefault) || printerList[0];
        if (defaultPrinter && !selectedPrinterId) {
          setSelectedPrinterId(defaultPrinter.id);
          checkPrinterStatus(defaultPrinter.id);
        }
      }
    } catch (error) {
      console.error("Failed to load printers:", error);
    } finally {
      setPrinterLoading(false);
    }
  }, [hwData?.printers, selectedPrinterId]);

  const checkPrinterStatus = useCallback(async (printerId: string) => {
    try {
      const status = await getPrinterStatus(printerId);
      setPrinterStatus(prev => ({ ...prev, [printerId]: status.status }));
    } catch (error) {
      setPrinterStatus(prev => ({ ...prev, [printerId]: "error" }));
    }
  }, []);

  const subtotal = useMemo(
    () => lines.reduce((s, l) => s + unitPriceFor(l) * l.qty, 0),
    [lines],
  );

  const gst = useMemo(() => {
    let total = 0;
    for (const l of lines) {
      const line = unitPriceFor(l) * l.qty;
      const rate = getEffectiveGst(l);
      total += calcGstAmount(line, rate);
    }
    return total;
  }, [lines, categoryNameMap]);

  // Per-line final prices
  const lineDetails = useMemo(() => {
    return lines.map((l) => {
      const unitPrice = unitPriceFor(l);
      const lineSubtotal = unitPrice * l.qty;
      const gstRate = getEffectiveGst(l);
      const gstAmount = calcGstAmount(lineSubtotal, gstRate);
      const productFinalPrice = Math.round((lineSubtotal + gstAmount) * 100) / 100;
      const finalUnitPrice = l.qty > 0 ? Math.round((productFinalPrice / l.qty) * 100) / 100 : unitPrice;
      return {
        unitPrice,
        lineSubtotal,
        gstRate,
        gstAmount,
        productFinalPrice,
        finalUnitPrice,
      };
    });
  }, [lines, categoryNameMap]);

  const totalFinalPrice = useMemo(
    () => lineDetails.reduce((s, d) => s + d.productFinalPrice, 0),
    [lineDetails],
  );

  const totalQuantity = useMemo(
    () => lines.reduce((s, l) => s + l.qty, 0),
    [lines],
  );

  const total = Math.max(0, totalFinalPrice - discount + shippingCharge);

  async function placeSale() {
    if (!lines.length) return toast.error("Add at least one product");
    const items = lines.map((l) => ({
      product_id: l.product.id,
      quantity: l.qty,
      variation: l.color,
      price_type: l.priceType,
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

    const invoiceId = data as string;
    const invoiceDate = new Date().toISOString();
    setInvoice({ id: invoiceId, at: invoiceDate, auto: AUTO_PRINT_POS });
    toast.success("Sale completed");
    qc.invalidateQueries();

    // Print receipt via Print Agent if printer is selected
    if (selectedPrinterId && printers.find(p => p.id === selectedPrinterId)?.status === "connected") {
      printReceiptViaAgent(invoiceId, invoiceDate);
    }
  }

  // Print receipt via Print Agent
  const printReceiptViaAgent = useCallback(async (orderId: string, invoiceDate: string) => {
    if (!selectedPrinterId) return;

    try {
      // Get hardware config for receipt options
      const cfg = hwData?.config;

      // Fetch order details
      const { data: order } = await supabase.from("orders").select("*").eq("id", orderId).single();
      const { data: orderItems } = await supabase
        .from("order_items")
        .select("*, products(hsn_code)")
        .eq("order_id", orderId);

      if (!order) throw new Error("Order not found");

      // Build receipt items
      const receiptItems = (orderItems ?? []).map((it: any) => ({
        name: it.product_name,
        variation: it.variation || undefined,
        quantity: Number(it.quantity),
        unit: it.unit ?? "Nos",
        unitPrice: Number(it.unit_price),
        lineTotal: Number(it.line_total),
        gstRate: Number(it.cgst_rate ?? 0) + Number(it.sgst_rate ?? 0),
        hsnCode: it.products?.hsn_code,
      }));

      const printJob: ReceiptPrintJob = {
        printerId: selectedPrinterId,
        invoiceNumber: orderId.slice(0, 8).toUpperCase(),
        invoiceDate,
        storeInfo: {
          name: COMPANY.name,
          tagline: COMPANY.tagline,
          gstin: COMPANY.gstin,
          address: [COMPANY.addressLine1, COMPANY.addressLine2, COMPANY.addressLine3].filter(Boolean),
          phone: COMPANY.phone,
          email: COMPANY.email,
          website: COMPANY.website,
          cin: COMPANY.cin,
        },
        items: receiptItems,
        totals: {
          subtotal: Number(order.subtotal ?? 0),
          discount: Number(order.discount ?? 0),
          tax: Number(order.tax ?? 0),
          shippingCharge: Number(order.shipping_charges ?? 0),
          grandTotal: Number(order.total ?? 0),
          cgstAmount: Number(order.cgst_amount ?? 0),
          sgstAmount: Number(order.sgst_amount ?? 0),
          igstAmount: Number(order.igst_amount ?? 0),
        },
        paymentMethod: order.payment_method as "CASH" | "UPI" | "CARD" | "COD",
        footerLines: [
          "Thank you for shopping with us!",
          "Goods once sold will not be taken back or exchanged."
        ],
        options: {
          cutPaper: cfg?.receipt_auto_cut ?? true,
          openCashDrawer: cfg?.receipt_open_cash_drawer ?? (payment === "CASH"),
          printBarcode: cfg?.receipt_print_barcode ?? false,
          barcodeData: orderId.slice(0, 8).toUpperCase(),
          printLogo: cfg?.receipt_print_logo ?? true,
          printGstBreakdown: cfg?.receipt_print_gst_breakdown ?? true,
        },
      };

      const result = await printReceipt(printJob);
      if (result.status === "completed") {
        toast.success("Receipt printed");
      } else {
        toast.warning("Print job queued");
      }
    } catch (error) {
      console.error("Print receipt error:", error);
      toast.error("Failed to print receipt");
    }
  }, [selectedPrinterId, payment, hwData?.config]);

  function reset() {
    setLines([]);
    setDiscount(0);
    setShippingCharge(0);
    setInvoice(null);
    setSearchQuery("");
    searchRef.current?.focus();
  }

  const handlePrintReceipt = useCallback(() => {
    if (invoice) {
      printReceiptViaAgent(invoice.id, invoice.at);
    }
  }, [invoice, printReceiptViaAgent]);

  if (invoice) return <Invoice orderId={invoice.id} at={invoice.at} onDone={reset} auto={invoice.auto} selectedPrinterId={selectedPrinterId} onPrintReceipt={handlePrintReceipt} />;

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
                          <div className="flex items-center gap-1">
                            <Percent className="h-3.5 w-3.5 text-muted-foreground/60" />
                            <select
                              value={item.gst_rate || 0}
                              onChange={(e) => updateSpecialItem(item._id, { gst_rate: Number(e.target.value) || 0 })}
                              className="w-full rounded-lg border border-border bg-white px-2 py-2 text-sm outline-none focus:border-primary"
                            >
                              {GST_RATES.map((r) => (
                                <option key={r} value={r}>{r}%{r === 18 ? " — Standard" : r === 5 ? " — Textile" : r === 12 ? " — Tailoring" : r === 28 ? " — Luxury" : r === 0 ? " — Exempt" : ""}</option>
                              ))}
                            </select>
                          </div>
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

  // Live type-to-search results list (each result is a clickable product tile)
  const searchTriggerList: React.ReactElement[] = [];
  if (searchQuery.trim()) {
    (searchResults ?? []).forEach((p) => {
      const price = productPrice(p);
      const vars = mapVariations(p.color_variations).filter((v) => v.color || v.color_code);
      const totalVariantQty = vars.reduce((s, v) => s + v.quantity, 0);
      const totalVariantSold = vars.reduce((s, v) => s + v.sold, 0);
      const totalVariantRemaining = vars.reduce((s, v) => s + (v.remaining ?? (v.quantity - v.sold)), 0);
      const hasVariants = vars.length > 0;
      const stockDisplay = hasVariants ? totalVariantRemaining : p.stock;
      const isOutOfStock = stockDisplay <= 0;
      searchTriggerList.push(
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
        </button>,
      );
    });
  }

  return (
    <>
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
          <div className="flex items-center gap-2 mb-1">
            <Search className="h-4 w-4 text-muted-foreground" />
            <span className="text-xs font-semibold text-muted-foreground">Type name / SKU / barcode to search live</span>
          </div>
          <div className="flex items-center gap-2">
            <ScanBarcode className="h-5 w-5 text-secondary ml-1" />
            <input
              ref={searchRef}
              value={searchQuery}
              onChange={(e) => {
                setSearchQuery(e.target.value);
                setShowSuggestions(true);
              }}
              onFocus={() => searchQuery.trim() && setShowSuggestions(true)}
              placeholder="Search product name, SKU or barcode…"
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

        {/* Scanner Status & Help Section */}
        <div className="rounded-xl border border-border bg-white p-3 shadow-sm">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <ScanBarcode className="h-4 w-4 text-secondary" />
              <span className="text-sm font-semibold text-foreground">Barcode Scanner</span>
            </div>
            <button
              onClick={() => setShowScannerHelp(!showScannerHelp)}
              className="flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-medium text-muted-foreground hover:bg-secondary-soft transition"
            >
              <Info className="h-3.5 w-3.5" />
              {showScannerHelp ? "Hide Help" : "Show Help"}
            </button>
          </div>

          {/* Scanner Status Indicator */}
          <div className="mt-2 flex items-center gap-2 text-xs">
            <span className={`flex h-2 w-2 rounded-full ${scannerStatus === "found" ? "bg-emerald-500" : scannerStatus === "not-found" ? "bg-rose-500" : scannerStatus === "scanning" ? "bg-amber-500 animate-pulse" : "bg-muted-foreground/30"}`} />
            <span className="text-muted-foreground">
              {scannerStatus === "found" && `Product found: ${lastScannedBarcode}`}
              {scannerStatus === "not-found" && `Not found: ${lastScannedBarcode}`}
              {scannerStatus === "scanning" && "Scanning..."}
              {scannerStatus === "idle" && "Ready — scan a barcode or type to search"}
            </span>
            {scannerError && (
              <span className="ml-auto text-rose-600 font-medium">{scannerError}</span>
            )}
          </div>

          {/* Scanner Help Panel */}
          {showScannerHelp && (
            <div className="mt-3 p-3 rounded-lg bg-muted/50 border border-border/50 space-y-2">
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Usb className="h-3.5 w-3.5" />
                <span><strong>USB Scanners:</strong> Plug in — works instantly as a keyboard. No driver needed.</span>
              </div>
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Bluetooth className="h-3.5 w-3.5" />
                <span><strong>Bluetooth Scanners:</strong> Pair with Windows, set to "HID/Keyboard mode". Scans appear as keystrokes.</span>
              </div>
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
                <span><strong>Auto-detection:</strong> Fast keystrokes ({'<' }80ms gap) + Enter key = barcode scan. Normal typing is ignored.</span>
              </div>
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <AlertCircle className="h-3.5 w-3.5 text-amber-600" />
                <span><strong>Requirements:</strong> Scanner must send <kbd className="px-1 py-0.5 bg-white/50 rounded text-[9px] font-mono">Enter</kbd> after barcode. Configure via scanner manual.</span>
              </div>
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Search className="h-3.5 w-3.5" />
                <span><strong>Fallback:</strong> Use the search box above to manually type barcode or product name anytime.</span>
              </div>
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Info className="h-3.5 w-3.5" />
                <span><strong>Supported formats:</strong> EAN-13, UPC-A, Code 128, Code 39, QR (if scanner outputs text). Matches <code>products.barcode</code> or <code>products.sku</code>.</span>
              </div>
            </div>
          )}
        </div>

        {/* Search results / suggestions — updates live as you type */}
        {showSuggestions && searchQuery.trim() && (
          <div className="rounded-xl border border-border bg-white shadow-lg p-2 max-h-[28rem] overflow-y-auto">
            <div className="flex items-center justify-between px-2 mb-1">
              <span className="text-[10px] font-semibold text-muted-foreground uppercase">
                {searchResults === null || searchResults === undefined ? (
                  searchLoading ? "Searching…" : "No matching products"
                ) : searchResults.length === 0 ? (
                  searchLoading ? "Searching…" : "No matching products"
                ) : (
                  `${searchResults.length} product(s) found`
                )}
              </span>
              <button onClick={() => setShowSuggestions(false)} className="text-muted-foreground/60 hover:text-foreground">
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
            {searchTriggerList.length > 0 ? (
              searchTriggerList
            ) : (
              searchResults && searchResults.length === 0 && !searchLoading ? (
                <div className="py-8 text-center text-xs text-muted-foreground/70">
                  No products match "{searchQuery.trim()}"
                </div>
              ) : (
                <div className="py-8 text-center text-xs text-muted-foreground/70">Searching products…</div>
              )
            )}
          </div>
        )}

        {/* Selected products in bill */}
        {lines.length > 0 && (
          <div className="space-y-2">
            <div className="text-xs font-semibold text-muted-foreground uppercase">
              Bill Items ({lines.length})
            </div>
            {lines.map((l, i) => {
              const price = unitPriceFor(l);
              const hasWholesale = Number(l.product.wholesale_price ?? 0) > 0;
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
                        {l.color ? " · " : ""}₹{price}
                        {hasWholesale && l.priceType === "WHOLESALE" ? (
                          <span className="ml-1 rounded bg-primary/10 px-1 py-px text-[8px] font-bold text-primary">WHOLESALE</span>
                        ) : null}
                      </div>
                      {/* Retail / Wholesale toggle */}
                      {hasWholesale && (
                        <div className="mt-1.5 inline-flex items-center gap-0.5 rounded-lg bg-muted p-0.5">
                          <button
                            type="button"
                            onClick={() => setLines(lines.map((x, j) => (j === i ? { ...x, priceType: "RETAIL" } : x)))}
                            className={`rounded-md px-2.5 py-1 text-[10px] font-semibold transition ${
                              l.priceType === "RETAIL" ? "bg-white text-foreground shadow-sm" : "text-muted-foreground"
                            }`}
                          >
                            Retail · ₹{productPrice(l.product)}
                          </button>
                          <button
                            type="button"
                            onClick={() => setLines(lines.map((x, j) => (j === i ? { ...x, priceType: "WHOLESALE" } : x)))}
                            className={`rounded-md px-2.5 py-1 text-[10px] font-semibold transition ${
                              l.priceType === "WHOLESALE" ? "bg-white text-foreground shadow-sm" : "text-muted-foreground"
                            }`}
                          >
                            Wholesale · ₹{l.product.wholesale_price}
                          </button>
                        </div>
                      )}
                      {/* Per-line GST override */}
                      <div className="mt-1 flex items-center gap-1">
                        <Percent className="h-3 w-3 text-muted-foreground/60" />
                        <select
                          value={l.gstOverride ?? ""}
                          onChange={(e) => {
                            const val = e.target.value;
                            setLineGstOverride(i, val === "" ? null : Number(val));
                          }}
                          className="rounded border border-border bg-white px-1.5 py-0.5 text-[10px] font-semibold outline-none focus:border-primary cursor-pointer"
                          title="GST rate — select to override"
                        >
                          <option value="">Auto ({getEffectiveGst(l)}%)</option>
                          {GST_RATES.map((r) => (
                            <option key={r} value={r}>{r}%{r === 18 ? " — Standard" : r === 5 ? " — Textile" : r === 12 ? " — Tailoring" : r === 28 ? " — Luxury" : ""}</option>
                          ))}
                        </select>
                        {l.gstOverride !== null && l.gstOverride !== undefined && (
                          <span className="text-[9px] font-bold text-amber-600">Override</span>
                        )}
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
                      <div className="text-[10px] text-muted-foreground/70">{l.product.unit ?? "Nos"} × {l.qty}</div>
                      <div className="text-[10px] text-muted-foreground">Unit: ₹{price.toFixed(2)} + GST {lineDetails[i]?.gstRate ?? 0}%</div>
                      <div className="text-[10px] text-primary font-semibold">Final: ₹{lineDetails[i]?.finalUnitPrice.toFixed(2)}/unit</div>
                      <div className="text-sm font-bold text-foreground">₹{lineDetails[i]?.productFinalPrice.toFixed(2)}</div>
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
                <span className="text-muted-foreground">Subtotal ({lines.length} items, {totalQuantity} units)</span>
                <span className="font-semibold">₹{subtotal.toFixed(2)}</span>
              </div>

              {/* Total GST */}
              <div className="flex justify-between">
                <span className="text-muted-foreground">Total GST</span>
                <span className="font-semibold">₹{gst.toFixed(2)}</span>
              </div>

              {/* Total Before Discount */}
              <div className="flex justify-between font-semibold">
                <span>Total (before discount/shipping)</span>
                <span>₹{totalFinalPrice.toFixed(2)}</span>
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
                Total Final Price
              </div>
              <div className="text-xl font-extrabold text-emerald-800 mt-1">
                ₹{total.toFixed(2)}
              </div>
              {totalQuantity > 0 && (
                <div className="text-[10px] text-emerald-600 mt-0.5">
                  Single Unit Final Price: ₹{(total / totalQuantity).toFixed(2)}/unit · {totalQuantity} units
                </div>
              )}
              <div className="text-[10px] text-emerald-600 mt-0.5">
                via {payment}
              </div>
            </div>

            {/* Printer Selection */}
            {printers.length > 0 && (
              <div className="rounded-lg border border-border bg-white p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Receipt Printer</span>
                  <span
                    className={`w-2 h-2 rounded-full ${
                      printerStatus[selectedPrinterId] === "connected" ? "bg-emerald-500" :
                      printerStatus[selectedPrinterId] === "error" ? "bg-red-500" :
                      "bg-amber-500"
                    }`}
                  />
                </div>
                <div className="flex items-center gap-2">
                  <Printer className="h-4 w-4 text-muted-foreground" />
                  <select
                    value={selectedPrinterId}
                    onChange={(e) => {
                      setSelectedPrinterId(e.target.value);
                      checkPrinterStatus(e.target.value);
                    }}
                    disabled={printerLoading}
                    className="flex-1 rounded-lg border border-border bg-white px-2 py-1.5 text-xs outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
                  >
                    {printers.map(p => (
                      <option key={p.id} value={p.id}>
                        {p.name} {p.status === "connected" ? "✓" : p.status === "error" ? "✗" : "○"}
                      </option>
                    ))}
                  </select>
                  {printerLoading && <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />}
                </div>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => setShowPrinterSettings(!showPrinterSettings)}
                    className="flex-1 rounded-lg border border-border bg-white px-2 py-1.5 text-xs font-semibold text-muted-foreground hover:bg-secondary-soft transition"
                  >
                    <Settings className="h-3.5 w-3.5 inline mr-1" /> Settings
                  </button>
                  {selectedPrinterId && (
                    <button
                      onClick={() => {
                        const cfg = hwData?.config;
                        const width = cfg?.label_width_mm ?? 40;
                        const height = cfg?.label_height_mm ?? 30;
                        printTestLabel(selectedPrinterId, width, height).then(() => toast.success("Test label sent")).catch(e => toast.error(e.message));
                      }}
                      disabled={printerLoading}
                      className="flex-1 rounded-lg border border-border bg-white px-2 py-1.5 text-xs font-semibold text-muted-foreground hover:bg-secondary-soft transition disabled:opacity-50"
                    >
                      <Wifi className="h-3.5 w-3.5 inline mr-1" /> Test
                    </button>
                  )}
                </div>
              </div>
            )}

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

    {/* Printer Settings Panel Modal */}
    {showPrinterSettings && (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
        <div className="w-full max-w-md rounded-xl bg-white shadow-xl p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-bold text-foreground">Printer Settings</h3>
            <div className="flex items-center gap-2">
              <button
                onClick={() => refetchHardware()}
                className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-semibold text-muted-foreground hover:bg-secondary-soft"
                title="Refresh from Hardware Settings"
              >
                <RefreshCw className="h-3.5 w-3.5" />
              </button>
              <button
                onClick={() => setShowPrinterSettings(false)}
                className="rounded p-1 hover:bg-muted transition"
              >
                <X className="h-5 w-5 text-muted-foreground" />
              </button>
            </div>
          </div>

          <div className="space-y-4">
            <div>
              <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide block mb-2">
                Select Printer
              </label>
              {printerLoading ? (
                <div className="flex items-center gap-2">
                  <Loader2 className="h-5 w-5 animate-spin text-primary" />
                  <span className="text-sm text-muted-foreground">Loading printers...</span>
                </div>
              ) : printers.length === 0 ? (
                <div className="rounded-lg border border-dashed border-border bg-white/50 py-8 text-center">
                  <WifiOff className="h-8 w-8 text-muted-foreground/30 mx-auto mb-2" />
                  <p className="text-sm text-muted-foreground">No printers found</p>
                  <p className="text-xs text-muted-foreground/70 mt-1">
                    Ensure the Print Agent is running on localhost:3030
                  </p>
                  <button
                    onClick={loadPrinters}
                    className="mt-3 text-xs font-semibold text-primary hover:underline"
                  >
                    Refresh
                  </button>
                </div>
              ) : (
                <select
                  value={selectedPrinterId}
                  onChange={(e) => {
                    setSelectedPrinterId(e.target.value);
                    checkPrinterStatus(e.target.value);
                  }}
                  className="w-full rounded-lg border border-border bg-white px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
                >
                  {printers.map(p => (
                    <option key={p.id} value={p.id}>
                      {p.name} ({p.type}) - {p.status}
                    </option>
                  ))}
                </select>
              )}
            </div>

            {selectedPrinterId && (
              <div className="rounded-lg border border-border bg-muted/30 p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-foreground">Status</span>
                  <span
                    className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-bold ${
                      printerStatus[selectedPrinterId] === "connected" ? "bg-emerald-50 text-emerald-700" :
                      printerStatus[selectedPrinterId] === "error" ? "bg-red-50 text-red-700" :
                      "bg-amber-50 text-amber-700"
                    }`}
                  >
                    <span className={`w-1.5 h-1.5 rounded-full ${
                      printerStatus[selectedPrinterId] === "connected" ? "bg-emerald-500" :
                      printerStatus[selectedPrinterId] === "error" ? "bg-red-500" :
                      "bg-amber-500"
                    }`} />
                    {printerStatus[selectedPrinterId] || "Unknown"}
                  </span>
                </div>
                <button
                  onClick={() => checkPrinterStatus(selectedPrinterId)}
                  className="text-xs font-semibold text-primary hover:underline w-full"
                >
                  Refresh Status
                </button>
                <button
                  onClick={() => {
                    const cfg = hwData?.config;
                    const width = cfg?.label_width_mm ?? 40;
                    const height = cfg?.label_height_mm ?? 30;
                    printTestLabel(selectedPrinterId, width, height).then(() => toast.success("Test label sent")).catch(e => toast.error(e.message));
                  }}
                  disabled={printerLoading}
                  className="flex items-center gap-2 w-full rounded-lg border border-border bg-white px-3 py-2 text-sm font-semibold text-muted-foreground hover:bg-secondary-soft transition disabled:opacity-50"
                >
                  <Wifi className="h-4 w-4" />
                  Print Test Label
                </button>
              </div>
            )}
          </div>

          <div className="mt-6 flex justify-end gap-2">
            <button
              onClick={() => setShowPrinterSettings(false)}
              className="rounded-lg border border-border bg-white px-4 py-2 text-sm font-semibold text-muted-foreground hover:bg-secondary-soft transition"
            >
              Close
            </button>
          </div>
        </div>
      </div>
    )}
  </>
);
}

// ---------- Invoice component (same as POS) ----------
function Invoice({
  orderId,
  at,
  onDone,
  auto,
  selectedPrinterId,
  onPrintReceipt,
}: {
  orderId: string;
  at: string;
  onDone: () => void;
  auto?: boolean;
  selectedPrinterId?: string;
  onPrintReceipt?: () => Promise<void>;
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
        <div className="flex items-center gap-2">
          <button
            onClick={() => window.print()}
            className="flex items-center gap-1 rounded-lg bg-primary px-4 py-2 text-xs font-semibold text-white"
          >
            <Printer className="h-3.5 w-3.5" /> Print (Browser)
          </button>
          {selectedPrinterId && onPrintReceipt && (
            <button
              onClick={onPrintReceipt}
              className="flex items-center gap-1 rounded-lg bg-emerald-600 px-4 py-2 text-xs font-semibold text-white hover:bg-emerald-700 transition"
              title="Print directly to thermal receipt printer (POSIFLOW CN811)"
            >
              <Printer className="h-3.5 w-3.5" /> Print Bill
            </button>
          )}
        </div>
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
