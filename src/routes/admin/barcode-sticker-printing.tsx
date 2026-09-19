import { createFileRoute, useSearch, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useState, useMemo, useCallback, useEffect } from "react";
import {
  Printer,
  Search,
  Loader2,
  CheckCircle2,
  Clock,
  AlertCircle,
  ChevronDown,
  ChevronUp,
  RotateCcw,
  History,
  Package,
  Tags,
  X,
  Eye,
  Wifi,
  WifiOff,
  Settings,
  Maximize2,
  RefreshCw,
  Download,
  FileSpreadsheet,
} from "lucide-react";
import { toast } from "sonner";
import {
  getPrinters,
  getPrinterStatus,
  printLabels as printLabelsToAgent,
  printTestLabel,
  generateBatchLabelPreview,
  openLabelPreview,
  type PrinterInfo,
  type LabelPrintJob,
  type LabelItem,
  type LabelTemplateOptions,
  DEFAULT_LABEL_TEMPLATE,
} from "@/lib/print-service";
import {
  getHardwareConfig,
  type HardwareConfig,
} from "@/lib/hardware";
import type { Json } from "@/integrations/supabase/types";

export const Route = createFileRoute("/admin/barcode-sticker-printing")({
  head: () => ({ meta: [{ title: "Barcode Sticker Printing — ACH Admin" }] }),
  validateSearch: (search: Record<string, unknown>) => ({
    purchase_id: (search.purchase_id as string) || undefined,
    slot: (search.slot as string) || undefined,
  }),
  component: BarcodeStickerPrinting,
});

type SlotRow = {
  id: string;
  name: string;
  total_charges: number | null;
  packing_charges: number | null;
  freight_charges: number | null;
  other_charges: number | null;
  total_quantity: number | null;
  notes: string | null;
  is_active: boolean | null;
  created_at: string;
};

type PurchaseRow = {
  id: string;
  invoice_no: string | null;
  purchase_date: string;
  supplier_id: string | null;
  status: string;
  created_at: string;
};

type PurchaseItemRow = {
  id: string;
  product_id: string;
  purchase_id: string;
  quantity: number;
  unit_cost: number;
  slot_number: string | null;
  slot_charge_per_product: number;
  unit: string;
};

type ProductRow = {
  id: string;
  name: string;
  barcode: string | null;
  sku: string | null;
  price: number;
  purchase_price: number | null;
  stock: number;
  unit: string;
  gst_rate: number | null;
  image_urls: string[];
  color_variations: Json;
};

type BarcodeStickerItem = {
  id: string;
  product_id: string;
  product_name: string;
  sku: string | null;
  barcode: string | null;
  quantity: number;
  selling_price: number;
  mrp: number;
  slot_id: string;
  slot_name: string;
};

function BarcodeStickerPrinting() {
  const qc = useQueryClient();
  const { purchase_id: urlPurchaseId, slot: urlSlotId } = useSearch({ from: "/admin/barcode-sticker-printing" });

  const [selectedPurchaseId, setSelectedPurchaseId] = useState<string>(urlPurchaseId || "");
  const [selectedSlotId, setSelectedSlotId] = useState<string>(urlSlotId || "");
  const [search, setSearch] = useState("");
  const [selectedItems, setSelectedItems] = useState<Set<string>>(new Set());
  const [showPreview, setShowPreview] = useState(false);
  const [previewItems, setPreviewItems] = useState<BarcodeStickerItem[]>([]);
  const [printing, setPrinting] = useState(false);

  const { data: hwData, refetch: refetchHardware } = useQuery({
    queryKey: ["hardware-config"],
    queryFn: () => getHardwareConfig(),
    refetchOnWindowFocus: false,
  });

  const [selectedPrinterId, setSelectedPrinterId] = useState<string>("");
  const [printers, setPrinters] = useState<PrinterInfo[]>([]);
  const [printerLoading, setPrinterLoading] = useState(false);
  const [printerStatus, setPrinterStatus] = useState<Record<string, "connected" | "disconnected" | "error" | "unknown">>({});
  const [showPrinterSettings, setShowPrinterSettings] = useState(false);
  const [labelTemplate, setLabelTemplate] = useState<LabelTemplateOptions>(DEFAULT_LABEL_TEMPLATE);

  const storeName = "ATHIRA'S CREATIVE HAVEN";
  const storeAddress = "Chennai, TN - 600018";

  // Printers are loaded ONLY when the user clicks Refresh (the localhost Print
  // Agent is often not running, so probing it on page load would log
  // "net::ERR_CONNECTION_REFUSED" to the console on every visit).

  useEffect(() => {
    if (hwData?.config) {
      const cfg = hwData.config;
      setLabelTemplate({
        labelWidth: cfg.label_width_mm ?? DEFAULT_LABEL_TEMPLATE.labelWidth,
        labelHeight: cfg.label_height_mm ?? DEFAULT_LABEL_TEMPLATE.labelHeight,
        margin: cfg.label_margin_mm ?? DEFAULT_LABEL_TEMPLATE.margin,
        barcodeType: cfg.label_barcode_type ?? DEFAULT_LABEL_TEMPLATE.barcodeType,
        barcodeHeight: DEFAULT_LABEL_TEMPLATE.barcodeHeight,
        barcodeWidth: DEFAULT_LABEL_TEMPLATE.barcodeWidth,
        textSize: DEFAULT_LABEL_TEMPLATE.textSize,
        showMRP: cfg.label_show_mrp ?? DEFAULT_LABEL_TEMPLATE.showMRP,
        showOfferPrice: cfg.label_show_offer_price ?? DEFAULT_LABEL_TEMPLATE.showOfferPrice,
        showBatchNumber: cfg.label_show_batch_number ?? DEFAULT_LABEL_TEMPLATE.showBatchNumber,
        showExpiryDate: cfg.label_show_expiry_date ?? DEFAULT_LABEL_TEMPLATE.showExpiryDate,
        showSKU: cfg.label_show_sku ?? DEFAULT_LABEL_TEMPLATE.showSKU,
        showStoreName: cfg.label_show_store_name ?? DEFAULT_LABEL_TEMPLATE.showStoreName,
        showStoreAddress: cfg.label_show_store_address ?? DEFAULT_LABEL_TEMPLATE.showStoreAddress,
      });

      if (cfg.label_printer_id && !selectedPrinterId) {
        setSelectedPrinterId(cfg.label_printer_id);
      }
    }
  }, [hwData?.config, selectedPrinterId]);

  const loadPrinters = useCallback(async () => {
    setPrinterLoading(true);
    try {
      if (hwData?.printers?.length) {
        setPrinters(hwData.printers);
        const defaultPrinter = hwData.printers.find(p => p.isDefault) || hwData.printers[0];
        if (defaultPrinter && !selectedPrinterId) {
          setSelectedPrinterId(defaultPrinter.id);
          checkPrinterStatus(defaultPrinter.id);
        }
      } else {
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

  const { data: purchases } = useQuery({
    queryKey: ["purchases-for-sticker"],
    queryFn: async () =>
      (await supabase
        .from("purchases")
        .select("id,invoice_no,purchase_date,supplier_id,status,created_at")
        .eq("status", "completed")
        .order("created_at", { ascending: false })
        .limit(50)
      ).data ?? [],
  });

  const { data: slots } = useQuery({
    queryKey: ["slots-lite"],
    queryFn: async () =>
      (await supabase
        .from("slots")
        .select("id,name,total_charges,packing_charges,freight_charges,other_charges,total_quantity")
        .eq("is_active", true)
        .order("name")
      ).data ?? [],
  });

  const { data: purchaseItems, isLoading: itemsLoading } = useQuery({
    queryKey: ["barcode-sticker-items", selectedPurchaseId],
    queryFn: async () => {
      if (!selectedPurchaseId) return [];
      const { data: items } = await supabase
        .from("purchase_items")
        .select("id,product_id,quantity,unit_cost,slot_number,slot_charge_per_product,unit")
        .eq("purchase_id", selectedPurchaseId);
      if (!items || items.length === 0) return [];

      const productIds = [...new Set(items.map(i => i.product_id).filter(Boolean))];
      if (productIds.length === 0) return [];

      const { data: products } = await supabase
        .from("products")
        .select("id,name,barcode,sku,price,purchase_price,stock,unit,gst_rate,image_urls,color_variations")
        .in("id", productIds);

      const productMap = new Map((products ?? []).map(p => [p.id, p]));
      const slotMap = new Map((slots ?? []).map(s => [s.id, s]));

      return items.map(item => {
        const product = productMap.get(item.product_id);
        const slot = item.slot_number ? slotMap.get(item.slot_number) : null;
        return {
          id: item.id,
          product_id: item.product_id,
          product_name: product?.name ?? "Unknown",
          sku: product?.sku ?? product?.barcode ?? null,
          barcode: product?.barcode ?? null,
          quantity: item.quantity,
          selling_price: Number(product?.price ?? 0),
          mrp: Number(product?.price ?? 0),
          slot_id: item.slot_number ?? "",
          slot_name: slot?.name ?? item.slot_number ?? "No Slot",
        } as BarcodeStickerItem;
      });
    },
    enabled: !!selectedPurchaseId,
  });

  const slotIds = useMemo(() => {
    if (!purchaseItems) return [];
    const seen = new Set<string>();
    return purchaseItems
      .filter(item => item.slot_id && !seen.has(item.slot_id) && seen.add(item.slot_id))
      .map(item => item.slot_id);
  }, [purchaseItems]);

  const filteredItems = useMemo(() => {
    if (!purchaseItems) return [];
    if (!selectedSlotId) return purchaseItems;
    if (!search.trim()) return purchaseItems.filter(item => item.slot_id === selectedSlotId);
    const q = search.toLowerCase();
    return purchaseItems.filter(
      item =>
        item.slot_id === selectedSlotId &&
        (item.product_name?.toLowerCase().includes(q) ||
          item.barcode?.toLowerCase().includes(q) ||
          item.sku?.toLowerCase().includes(q))
    );
  }, [purchaseItems, selectedSlotId, search]);

  const stats = useMemo(() => {
    if (!filteredItems) return { total: 0, uniqueProducts: 0 };
    const uniqueProducts = new Set(filteredItems.map(i => i.product_id)).size;
    return {
      total: filteredItems.reduce((sum, item) => sum + item.quantity, 0),
      uniqueProducts,
    };
  }, [filteredItems]);

  const allSelected = filteredItems.length > 0 && filteredItems.every(item => selectedItems.has(item.product_id));
  const someSelected = filteredItems.some(item => selectedItems.has(item.product_id));

  const exportToCSV = useCallback(() => {
    if (!filteredItems || filteredItems.length === 0) {
      toast.error("No data to export");
      return;
    }

    const headers = [
      "Product Name",
      "SKU / Item Code",
      "Barcode Number",
      "Quantity",
      "MRP / Selling Price",
      "Slot",
    ];

    const csvRows = filteredItems.map(item => [
      item.product_name,
      item.sku ?? "",
      item.barcode ?? "",
      item.quantity.toString(),
      item.selling_price.toFixed(2),
      item.slot_name,
    ]);

    const csvContent = [headers.join(","), ...csvRows.map(r => r.join(","))].join("\n");
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `barcode-sticker-${selectedSlotId || "all-slots"}-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
    toast.success(`Exported ${filteredItems.length} items to CSV for VPrint`);
  }, [filteredItems, selectedSlotId]);

  const exportToExcel = useCallback(() => {
    if (!filteredItems || filteredItems.length === 0) {
      toast.error("No data to export");
      return;
    }

    const headers = [
      "Product Name",
      "SKU / Item Code",
      "Barcode Number",
      "Quantity",
      "MRP / Selling Price",
      "Slot",
    ];

    const csvRows = filteredItems.map(item => [
      item.product_name,
      item.sku ?? "",
      item.barcode ?? "",
      item.quantity.toString(),
      item.selling_price.toFixed(2),
      item.slot_name,
    ]);

    const csvContent = [headers.join(","), ...csvRows.map(r => r.join(","))].join("\n");
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `barcode-sticker-${selectedSlotId || "all-slots"}-${new Date().toISOString().slice(0, 10)}.xlsx`;
    link.click();
    URL.revokeObjectURL(url);
    toast.success(`Exported ${filteredItems.length} items to Excel (CSV format) for VPrint`);
  }, [filteredItems, selectedSlotId]);

  function toggleItem(productId: string) {
    setSelectedItems(prev => {
      const next = new Set(prev);
      if (next.has(productId)) next.delete(productId);
      else next.add(productId);
      return next;
    });
  }

  function toggleAll() {
    if (allSelected) {
      setSelectedItems(new Set());
    } else {
      setSelectedItems(new Set(filteredItems.map(i => i.product_id)));
    }
  }

  const handlePreview = useCallback((itemIds?: string[]) => {
    if (!filteredItems) return;
    const ids = itemIds;
    const itemsToPrint = ids
      ? filteredItems.filter(i => ids.includes(i.product_id))
      : filteredItems;

    if (itemsToPrint && itemsToPrint.length > 0) {
      setPreviewItems(itemsToPrint);
      setShowPreview(true);
    }
  }, [filteredItems]);

  const handleOpenPreview = useCallback((itemIds?: string[]) => {
    if (!filteredItems) return;
    const ids = itemIds;
    const itemsToPrint = ids
      ? filteredItems.filter(i => ids.includes(i.product_id))
      : filteredItems;

    if (itemsToPrint && itemsToPrint.length > 0) {
      const cfg = hwData?.config;
      const template: LabelTemplateOptions = {
        ...labelTemplate,
        labelWidth: cfg?.label_width_mm ?? labelTemplate.labelWidth,
        labelHeight: cfg?.label_height_mm ?? labelTemplate.labelHeight,
        margin: cfg?.label_margin_mm ?? labelTemplate.margin,
        barcodeType: cfg?.label_barcode_type ?? labelTemplate.barcodeType,
        showMRP: cfg?.label_show_mrp ?? labelTemplate.showMRP,
        showOfferPrice: cfg?.label_show_offer_price ?? labelTemplate.showOfferPrice,
        showBatchNumber: cfg?.label_show_batch_number ?? labelTemplate.showBatchNumber,
        showExpiryDate: cfg?.label_show_expiry_date ?? labelTemplate.showExpiryDate,
        showSKU: cfg?.label_show_sku ?? labelTemplate.showSKU,
        showStoreName: cfg?.label_show_store_name ?? labelTemplate.showStoreName,
        showStoreAddress: cfg?.label_show_store_address ?? labelTemplate.showStoreAddress,
      };
      const labelItems: LabelItem[] = itemsToPrint.flatMap(item =>
        Array(item.quantity).fill(null).map(() => ({
          productName: item.product_name,
          sku: item.sku || undefined,
          barcode: item.barcode || "N/A",
          sellingPrice: Number(item.selling_price || 0),
          mrp: Number(item.mrp || 0),
          offerPrice: undefined,
          quantity: 1,
        }))
      );
      openLabelPreview(labelItems, template, storeName, storeAddress);
    }
  }, [filteredItems, labelTemplate, hwData?.config]);

  const printLabels = useCallback(
    async (itemIds?: string[]) => {
      if (!selectedPrinterId) {
        toast.error("Please select a printer first");
        return;
      }
      setPrinting(true);
      try {
        const ids = itemIds;
        const itemsToPrint = ids
          ? filteredItems?.filter(i => ids.includes(i.product_id))
          : filteredItems?.filter(i => i.quantity > 0);

        if (itemsToPrint && itemsToPrint.length > 0) {
          const cfg = hwData?.config;
          const labelItems: LabelItem[] = itemsToPrint.flatMap(item =>
            Array(item.quantity).fill(null).map(() => ({
              productName: item.product_name,
              sku: item.sku || undefined,
              barcode: item.barcode || "N/A",
              sellingPrice: Number(item.selling_price || 0),
              mrp: Number(item.mrp || 0),
              offerPrice: undefined,
              quantity: 1,
            }))
          );

          const printJob: LabelPrintJob = {
            printerId: selectedPrinterId,
            items: labelItems,
            storeName,
            storeAddress,
            labelWidth: cfg?.label_width_mm ?? labelTemplate.labelWidth,
            labelHeight: cfg?.label_height_mm ?? labelTemplate.labelHeight,
            margin: cfg?.label_margin_mm ?? labelTemplate.margin,
            copies: cfg?.default_label_copies ?? 1,
            template: (cfg?.label_template as "standard" | "compact" | "detailed") ?? "standard",
          };

          const result = await printLabelsToAgent(printJob);
          if (result.status === "completed") {
            toast.success(`${itemsToPrint.length} labels sent to printer`);
          } else {
            toast.warning("Print job queued");
          }
        }
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Failed to print");
      } finally {
        setPrinting(false);
      }
    },
    [filteredItems, selectedPrinterId, labelTemplate, hwData?.config]
  );

  const selectedPurchase = (purchases ?? []).find(p => p.id === selectedPurchaseId);
  const selectedSlot = (slots ?? []).find(s => s.id === selectedSlotId);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-bold text-foreground flex items-center gap-2">
          <Tags className="h-5 w-5 text-primary" />
          Barcode Sticker Printing
        </h1>
        {selectedPrinterId && (
          <div className="ml-auto flex items-center gap-2">
            <div className="flex items-center gap-1.5 rounded-lg border border-border bg-white px-3 py-1.5 shadow-sm">
              <Printer className="h-4 w-4 text-muted-foreground" />
              <select
                value={selectedPrinterId}
                onChange={e => {
                  setSelectedPrinterId(e.target.value);
                  checkPrinterStatus(e.target.value);
                }}
                className="bg-transparent text-sm outline-none"
              >
                {printers.map(p => (
                  <option key={p.id} value={p.id}>
                    {p.name} ({p.status})
                  </option>
                ))}
              </select>
              <span
                className={`w-2 h-2 rounded-full ${
                  printerStatus[selectedPrinterId] === "connected" ? "bg-emerald-500" :
                  printerStatus[selectedPrinterId] === "error" ? "bg-red-500" :
                  "bg-amber-500"
                }`}
                title={printerStatus[selectedPrinterId] || "Unknown"}
              />
            </div>
            <button
              onClick={() => setShowPrinterSettings(!showPrinterSettings)}
              className="rounded-lg p-2 border border-border bg-white hover:bg-secondary-soft transition"
              title="Printer Settings"
            >
              <Settings className="h-4 w-4 text-muted-foreground" />
            </button>
          </div>
        )}
      </div>

      <div className="rounded-xl border border-border bg-white shadow-sm p-4">
        <div className="flex flex-wrap items-end gap-4">
          <div className="flex-1 min-w-[250px] space-y-1">
            <label className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">
              Select Purchase
            </label>
            <select
              value={selectedPurchaseId}
              onChange={e => {
                setSelectedPurchaseId(e.target.value);
                setSelectedSlotId("");
                setSelectedItems(new Set());
              }}
              className="w-full rounded-lg border border-border bg-white px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
            >
              <option value="">— Choose a purchase —</option>
              {(purchases ?? []).map(p => (
                <option key={p.id} value={p.id}>
                  {p.invoice_no || p.id.slice(0, 8)} — {new Date(p.purchase_date).toLocaleDateString()} — {p.status}
                </option>
              ))}
            </select>
          </div>

          {selectedPurchaseId && (
            <div className="flex-1 min-w-[250px] space-y-1">
              <label className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">
                Select Slot (Optional)
              </label>
              <select
                value={selectedSlotId}
                onChange={e => {
                  setSelectedSlotId(e.target.value);
                  setSelectedItems(new Set());
                }}
                className="w-full rounded-lg border border-border bg-white px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
              >
                <option value="">— All Slots —</option>
                {slotIds.map(slotId => (
                  <option key={slotId} value={slotId}>
                    {(slots ?? []).find(s => s.id === slotId)?.name ?? slotId}
                  </option>
                ))}
              </select>
            </div>
          )}

          {selectedPurchaseId && (
            <div className="flex flex-wrap items-center gap-2">
              {filteredItems.length > 0 && (
                <div className="flex items-center gap-1">
                  <button
                    onClick={exportToCSV}
                    disabled={itemsLoading}
                    className="flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-50 transition"
                    title="Export to CSV for VPrint"
                  >
                    <FileSpreadsheet className="h-3.5 w-3.5" />
                    <span className="hidden sm:inline">Export CSV</span>
                    <span className="sm:hidden">CSV</span>
                  </button>
                  <button
                    onClick={exportToExcel}
                    disabled={itemsLoading}
                    className="flex items-center gap-1.5 rounded-lg bg-green-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-green-700 disabled:opacity-50 transition"
                    title="Export to Excel for VPrint"
                  >
                    <FileSpreadsheet className="h-3.5 w-3.5" />
                    <span className="hidden sm:inline">Export Excel</span>
                    <span className="sm:hidden">XLSX</span>
                  </button>
                </div>
              )}
            </div>
          )}
        </div>

        {selectedPurchaseId && selectedPurchase && (
          <div className="mt-4 p-3 rounded-lg bg-primary/5 border border-primary/20">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-3">
                <span className="text-sm font-bold text-foreground">
                  Purchase: {selectedPurchase.invoice_no || selectedPurchase.id.slice(0, 8).toUpperCase()}
                </span>
              </div>
              <span className="text-[10px] text-muted-foreground">
                Date: {new Date(selectedPurchase.purchase_date).toLocaleDateString()}
              </span>
            </div>
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <span className="text-[10px] text-muted-foreground uppercase">Total Items</span>
                <div className="font-bold text-foreground">{stats.uniqueProducts}</div>
              </div>
              <div>
                <span className="text-[10px] text-muted-foreground uppercase">Total Quantity</span>
                <div className="font-bold text-foreground">{stats.total}</div>
              </div>
            </div>
          </div>
        )}
      </div>

      {itemsLoading && selectedPurchaseId && (
        <div className="p-12 text-center">
          <Loader2 className="h-6 w-6 animate-spin text-primary mx-auto" />
          <p className="text-sm text-muted-foreground mt-2">Loading barcode sticker data…</p>
        </div>
      )}

      {!itemsLoading && selectedPurchaseId && filteredItems.length === 0 && (
        <div className="rounded-xl border border-border bg-white shadow-sm p-12 text-center">
          <Tags className="h-10 w-10 text-muted-foreground/30 mx-auto mb-3" />
          <p className="text-sm font-medium text-foreground">No Products Found</p>
          <p className="text-xs text-muted-foreground/70 mt-1">
            {selectedSlotId
              ? "No products in this slot for the selected purchase."
              : "No products found for this purchase. Complete a purchase entry first."}
          </p>
        </div>
      )}

      {selectedPurchaseId && !itemsLoading && filteredItems.length > 0 && (
        <div className="rounded-xl border border-border bg-white shadow-sm overflow-hidden">
          <div className="flex flex-wrap items-center justify-between px-4 py-3 border-b border-border gap-3">
            <div className="flex items-center gap-3">
              <h3 className="text-sm font-bold text-foreground">
                Products for Barcode Stickers
                {selectedSlotId && (
                  <span className="ml-2 text-xs font-normal text-muted-foreground">
                    (Slot: {(slots ?? []).find(s => s.id === selectedSlotId)?.name ?? selectedSlotId})
                  </span>
                )}
                <span className="ml-2 text-xs font-normal text-muted-foreground">
                  ({filteredItems.length} product{filteredItems.length !== 1 ? "s" : ""})
                </span>
              </h3>
              <div className="flex items-center gap-2 rounded-lg border border-border bg-white px-3 py-1.5 shadow-sm">
                <Search className="h-3.5 w-3.5 text-muted-foreground/70" />
                <input
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  placeholder="Search products…"
                  className="bg-transparent text-xs outline-none w-40"
                />
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {selectedItems.size > 0 && (
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => handlePreview(Array.from(selectedItems) as string[])}
                    className="rounded-lg border border-border bg-white px-3 py-1.5 text-xs font-semibold text-muted-foreground hover:bg-secondary-soft transition"
                    title="Preview Selected"
                  >
                    <Eye className="h-3.5 w-3.5" />
                    <span className="hidden sm:inline">Preview</span>
                  </button>
                  <button
                    onClick={() => handleOpenPreview(Array.from(selectedItems) as string[])}
                    className="rounded-lg border border-border bg-white px-3 py-1.5 text-xs font-semibold text-muted-foreground hover:bg-secondary-soft transition"
                    title="Open Preview in New Window"
                  >
                    <Maximize2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              )}
              <div className="flex items-center gap-1">
                <button
                  onClick={handlePreview}
                  className="rounded-lg border border-border bg-white px-3 py-1.5 text-xs font-semibold text-muted-foreground hover:bg-secondary-soft transition"
                  title="Preview All"
                >
                  <Eye className="h-3.5 w-3.5" />
                  <span className="hidden sm:inline">Preview All</span>
                </button>
                <button
                  onClick={handleOpenPreview}
                  className="rounded-lg border border-border bg-white px-3 py-1.5 text-xs font-semibold text-muted-foreground hover:bg-secondary-soft transition"
                  title="Open Preview in New Window"
                >
                  <Maximize2 className="h-3.5 w-3.5" />
                </button>
                {selectedPrinterId && (
                  <button
                    onClick={() => {
                      const cfg = hwData?.config;
                      const width = cfg?.label_width_mm ?? labelTemplate.labelWidth;
                      const height = cfg?.label_height_mm ?? labelTemplate.labelHeight;
                      printTestLabel(selectedPrinterId, width, height).then(() => toast.success("Test label sent")).catch(e => toast.error(e.message));
                    }}
                    className="rounded-lg border border-border bg-white px-3 py-1.5 text-xs font-semibold text-muted-foreground hover:bg-secondary-soft transition"
                    title="Print Test Label"
                  >
                    <Wifi className="h-3.5 w-3.5" />
                    <span className="hidden sm:inline">Test Print</span>
                  </button>
                )}
              </div>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted text-[10px] uppercase text-muted-foreground">
                <tr>
                  <th className="p-2.5 w-10">
                    <input
                      type="checkbox"
                      checked={allSelected}
                      onChange={toggleAll}
                      className="rounded border-border"
                    />
                  </th>
                  <th className="p-2.5 text-left">#</th>
                  <th className="p-2.5 text-left">Product Name</th>
                  <th className="p-2.5 text-left">SKU / Item Code</th>
                  <th className="p-2.5 text-left">Barcode Number</th>
                  <th className="p-2.5 text-right">Quantity</th>
                  <th className="p-2.5 text-right">MRP / Selling Price</th>
                  <th className="p-2.5 text-left">Slot</th>
                  <th className="p-2.5 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredItems.map((item, idx) => (
                  <tr
                    key={item.id}
                    className={`border-t border-border transition ${
                      selectedItems.has(item.product_id) ? "bg-primary/5" : "hover:bg-secondary-soft/30"
                    }`}
                  >
                    <td className="p-2.5">
                      <input
                        type="checkbox"
                        checked={selectedItems.has(item.product_id)}
                        onChange={() => toggleItem(item.product_id)}
                        className="rounded border-border"
                      />
                    </td>
                    <td className="p-2.5 text-xs font-semibold text-muted-foreground">{idx + 1}</td>
                    <td className="p-2.5">
                      <div className="text-xs font-semibold text-foreground">{item.product_name}</div>
                    </td>
                    <td className="p-2.5 text-xs text-muted-foreground font-mono">{item.sku || "—"}</td>
                    <td className="p-2.5 text-xs text-muted-foreground font-mono">{item.barcode || "—"}</td>
                    <td className="p-2.5 text-xs text-right font-semibold">{item.quantity}</td>
                    <td className="p-2.5 text-xs text-right font-semibold text-primary">₹{item.selling_price.toFixed(2)}</td>
                    <td className="p-2.5 text-xs text-muted-foreground">{item.slot_name}</td>
                    <td className="p-2.5 text-right">
                      <div className="flex items-center justify-end gap-1">
                        {selectedPrinterId && item.quantity > 0 && (
                          <button
                            onClick={() => printLabels([item.product_id])}
                            className="rounded p-1 hover:bg-emerald-50 transition"
                            title={`Print ${item.quantity} label(s)`}
                          >
                            <Printer className="h-3.5 w-3.5 text-emerald-600" />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="bg-muted/50 border-t border-border">
                <tr>
                  <td colSpan={5} className="p-2.5 text-xs font-bold text-foreground text-right">TOTALS</td>
                  <td className="p-2.5 text-xs font-bold text-right">{stats.total}</td>
                  <td className="p-2.5 text-xs font-bold text-primary text-right">—</td>
                  <td></td>
                  <td></td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      )}

      {!selectedPurchaseId && (
        <div className="rounded-xl border border-dashed border-border bg-white/50 py-16 text-center">
          <Tags className="h-10 w-10 text-muted-foreground/30 mx-auto mb-3" />
          <p className="text-sm font-medium text-foreground">Select a Purchase Entry</p>
          <p className="text-xs text-muted-foreground/70 mt-1 max-w-sm mx-auto">
            Choose a completed purchase above to view its products organized by slot for barcode sticker printing.
          </p>
        </div>
      )}

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
                    onChange={e => {
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
                      const width = cfg?.label_width_mm ?? labelTemplate.labelWidth;
                      const height = cfg?.label_height_mm ?? labelTemplate.labelHeight;
                      printTestLabel(selectedPrinterId, width, height).then(() => toast.success("Test label sent")).catch(e => toast.error(e.message));
                    }}
                    className="flex items-center gap-2 w-full rounded-lg border border-border bg-white px-3 py-2 text-sm font-semibold text-muted-foreground hover:bg-secondary-soft transition"
                  >
                    <Wifi className="h-4 w-4" />
                    Print Test Label
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
