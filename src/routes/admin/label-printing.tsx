import { createFileRoute, useSearch } from "@tanstack/react-router";
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

export const Route = createFileRoute("/admin/label-printing")({
  head: () => ({ meta: [{ title: "Label Printing — ACH Admin" }] }),
  validateSearch: (search: Record<string, unknown>) => ({
    slot: (search.slot as string) || undefined,
  }),
  component: LabelPrinting,
});

// ---------- Types ----------
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

type LabelBatch = {
  id: string;
  slot_id: string;
  slot_name: string;
  status: string;
  total_labels_required: number;
  total_labels_printed: number;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

type LabelBatchItem = {
  id: string;
  batch_id: string;
  product_id: string | null;
  product_name: string;
  barcode: string | null;
  purchase_quantity: number;
  labels_to_print: number;
  labels_printed: number;
  labels_remaining: number;
  unit_price: number;
  selling_price: number;
  sort_order: number;
  created_at: string;
};

type PrintHistory = {
  id: string;
  batch_id: string;
  product_name: string;
  barcode: string | null;
  quantity_printed: number;
  printed_by: string | null;
  printed_at: string;
  notes: string | null;
};

// Product details are loaded from products rather than the label batch snapshot
// so changes are reflected before a label is printed.
type SlotProduct = {
  product_id: string | null;
  quantity: number;
  products: {
    id: string;
    name: string;
    sku: string | null;
    barcode: string | null;
    price: number;
    stock: number;
    unit: string;
    material: string | null;
  } | null;
};

// ---------- Status Badge ----------
function StatusBadge({ status }: { status: string }) {
  const styles: Record<string, { bg: string; text: string; icon: React.ElementType }> = {
    not_printed: { bg: "bg-amber-50", text: "text-amber-700", icon: Clock },
    partially_printed: { bg: "bg-blue-50", text: "text-blue-700", icon: AlertCircle },
    printed: { bg: "bg-emerald-50", text: "text-emerald-700", icon: CheckCircle2 },
  };
  const s = styles[status] ?? styles.not_printed;
  const Icon = s.icon;
  const label = status === "not_printed" ? "Not Printed" : status === "partially_printed" ? "Partial" : "Printed";
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider ${s.bg} ${s.text}`}>
      <Icon className="h-3 w-3" />
      {label}
    </span>
  );
}

// ---------- Main Component ----------
function LabelPrinting() {
  const qc = useQueryClient();
  const { slot: urlSlotId } = useSearch({ from: "/admin/label-printing" });

  const [selectedSlotId, setSelectedSlotId] = useState<string>(urlSlotId || "");
  const [search, setSearch] = useState("");
  const [selectedItems, setSelectedItems] = useState<Set<string>>(new Set());
  const [editingItem, setEditingItem] = useState<string | null>(null);
  const [editValue, setEditValue] = useState<number>(0);
  const [showHistory, setShowHistory] = useState(false);
  const [printing, setPrinting] = useState(false);
  const [creating, setCreating] = useState(false);

  // Printer-related state
  const [selectedPrinterId, setSelectedPrinterId] = useState<string>("");
  const [printers, setPrinters] = useState<PrinterInfo[]>([]);
  const [printerLoading, setPrinterLoading] = useState(false);
  const [printerStatus, setPrinterStatus] = useState<Record<string, "connected" | "disconnected" | "error" | "unknown">>({});
  const [showPrinterSettings, setShowPrinterSettings] = useState(false);
  const [labelTemplate, setLabelTemplate] = useState<LabelTemplateOptions>(DEFAULT_LABEL_TEMPLATE);
  const [showPreview, setShowPreview] = useState(false);
  const [previewItems, setPreviewItems] = useState<LabelBatchItem[]>([]);

  // Store info for labels
  const storeName = "ATHIRA'S CREATIVE HAVEN";
  const storeAddress = "Chennai, TN - 600018";

  // Load hardware configuration from database
  const { data: hwData, refetch: refetchHardware } = useQuery({
    queryKey: ["hardware-config"],
    queryFn: () => getHardwareConfig(),
    refetchOnWindowFocus: false,
  });

  // Load printers on mount and when hardware config changes
  useEffect(() => {
    loadPrinters();
  }, []);

  // Initialize label template from hardware config when it loads
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

      // Auto-select label printer from hardware config
      if (cfg.label_printer_id && !selectedPrinterId) {
        setSelectedPrinterId(cfg.label_printer_id);
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

  // Fetch slots
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

  const {
    data: slotProducts,
    isLoading: slotProductsLoading,
    refetch: refetchSlotProducts,
  } = useQuery({
    queryKey: ["slot-products-for-labels", selectedSlotId],
    queryFn: async () => {
      if (!selectedSlotId) return [] as SlotProduct[];
      const { data, error } = await supabase
        .from("purchase_items")
        .select("product_id,quantity,products(id,name,sku,barcode,price,stock,unit,material)")
        .eq("slot_number", selectedSlotId);
      if (error) throw error;
      return (data ?? []) as unknown as SlotProduct[];
    },
    enabled: !!selectedSlotId,
    refetchOnWindowFocus: "always",
    refetchInterval: 15_000,
  });

  const currentProductsById = useMemo(
    () => new Map((slotProducts ?? []).flatMap((item) => item.products ? [[item.products.id, item.products] as const] : [])),
    [slotProducts]
  );

  // Fetch current batch for selected slot
  const { data: batch, isLoading: batchLoading } = useQuery({
    queryKey: ["label-batch", selectedSlotId],
    queryFn: async () => {
      if (!selectedSlotId) return null;
      const { data } = await supabase
        .from("label_batches")
        .select("*")
        .eq("slot_id", selectedSlotId)
        .order("created_at", { ascending: false })
        .limit(1)
        .single();
      return data as LabelBatch | null;
    },
    enabled: !!selectedSlotId,
  });

  // Fetch batch items
  const { data: batchItems, isLoading: itemsLoading } = useQuery({
    queryKey: ["label-batch-items", batch?.id],
    queryFn: async () => {
      if (!batch?.id) return [];
      const { data } = await supabase
        .from("label_batch_items")
        .select("*")
        .eq("batch_id", batch.id)
        .order("sort_order");
      return (data ?? []) as LabelBatchItem[];
    },
    enabled: !!batch?.id,
  });

  // Fetch print history
  const { data: printHistory, isLoading: historyLoading } = useQuery({
    queryKey: ["label-print-history", batch?.id],
    queryFn: async () => {
      if (!batch?.id) return [];
      const { data } = await supabase
        .from("label_print_history")
        .select("*")
        .eq("batch_id", batch.id)
        .order("printed_at", { ascending: false });
      return (data ?? []) as PrintHistory[];
    },
    enabled: !!batch?.id && showHistory,
  });

  // Filter items by search
  const filteredItems = useMemo(() => {
    if (!batchItems) return [];
    if (!search.trim()) return batchItems;
    const q = search.toLowerCase();
    return batchItems.filter((item) => {
      const product = item.product_id ? currentProductsById.get(item.product_id) : null;
      return (product?.name ?? item.product_name)?.toLowerCase().includes(q)
        || (product?.barcode ?? item.barcode)?.toLowerCase().includes(q)
        || product?.sku?.toLowerCase().includes(q);
    });
  }, [batchItems, search, currentProductsById]);

  // Summary stats
  const stats = useMemo(() => {
    if (!batchItems) return { total: 0, printed: 0, remaining: 0 };
    return batchItems.reduce(
      (acc, item) => ({
        total: acc.total + item.labels_to_print,
        printed: acc.printed + item.labels_printed,
        remaining: acc.remaining + (item.labels_to_print - item.labels_printed),
      }),
      { total: 0, printed: 0, remaining: 0 }
    );
  }, [batchItems]);

  // Auto-select all on select all
  const allSelected = filteredItems.length > 0 && filteredItems.every((item) => selectedItems.has(item.id));
  const someSelected = filteredItems.some((item) => selectedItems.has(item.id));

  // Create batch for slot
  const createBatch = useCallback(async () => {
    if (!selectedSlotId) return toast.error("Select a slot first");
    setCreating(true);
    try {
      const { data, error } = await supabase.rpc("create_label_batch_for_slot", {
        _slot_id: selectedSlotId,
      });
      if (error) throw error;
      if (!data) throw new Error("Failed to create label batch");
      toast.success("Label batch created");
      qc.invalidateQueries({ queryKey: ["label-batch", selectedSlotId] });
      qc.invalidateQueries({ queryKey: ["label-batch-items"] });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to create batch");
    } finally {
      setCreating(false);
    }
  }, [selectedSlotId, qc]);

  // Update item label count
  const updateItemQuantity = useCallback(
    async (itemId: string, newQty: number) => {
      try {
        const { error } = await supabase.rpc("update_label_item_quantity", {
          _item_id: itemId,
          _labels_to_print: Math.max(0, newQty),
        });
        if (error) throw error;
        setEditingItem(null);
        qc.invalidateQueries({ queryKey: ["label-batch-items", batch?.id] });
        qc.invalidateQueries({ queryKey: ["label-batch", selectedSlotId] });
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Failed to update");
      }
    },
    [batch?.id, selectedSlotId, qc]
  );

  // Print labels using Print Agent
  const printLabels = useCallback(
    async (itemIds?: string[]) => {
      if (!batch?.id || !selectedPrinterId) {
        if (!selectedPrinterId) toast.error("Please select a printer first");
        return;
      }
      setPrinting(true);
      try {
        const ids = itemIds || undefined;
        const quantities = ids?.map((id) => {
          const item = batchItems?.find((i) => i.id === id);
          return item ? item.labels_to_print - item.labels_printed : 0;
        });

        // First, mark labels as printed in database
        const { data, error } = await supabase.rpc("mark_labels_printed", {
          _batch_id: batch.id,
          _item_ids: ids || null,
          _quantities: quantities || null,
        });
        if (error) throw error;

        const printed = Number(data) || 0;
        if (printed > 0) {
          // Prepare items for Print Agent
          const itemsToPrint = ids
            ? batchItems?.filter((i) => ids.includes(i.id))
            : batchItems?.filter((i) => i.labels_printed < i.labels_to_print);

          if (itemsToPrint && itemsToPrint.length > 0) {
            // Use hardware config for template settings
            const cfg = hwData?.config;

            // Convert to LabelItem format for print service
            const labelItems: LabelItem[] = itemsToPrint.flatMap(item => {
              const product = item.product_id ? currentProductsById.get(item.product_id) : null;
              return Array(item.labels_to_print - item.labels_printed).fill(null).map(() => ({
                productName: product?.name ?? item.product_name,
                sku: product?.sku ?? undefined,
                barcode: product?.barcode ?? item.barcode ?? "N/A",
                sellingPrice: Number(product?.price ?? item.selling_price ?? 0),
                mrp: undefined,
                offerPrice: undefined,
                quantity: 1,
              }));
            });

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

            // Send to Print Agent
            const result = await printLabelsToAgent(printJob);
            if (result.status === "completed") {
              toast.success(`${printed} labels sent to printer`);
            } else {
              toast.warning("Print job queued");
            }
          }
        } else {
          toast.info("No labels to print");
        }

        qc.invalidateQueries({ queryKey: ["label-batch-items", batch.id] });
        qc.invalidateQueries({ queryKey: ["label-batch", selectedSlotId] });
        setSelectedItems(new Set());
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Failed to print");
      } finally {
        setPrinting(false);
      }
    },
    [batch?.id, batchItems, selectedSlotId, selectedPrinterId, labelTemplate, hwData?.config, currentProductsById, qc]
  );

  // Preview labels using print service
  const handlePreview = useCallback((itemIds?: string[]) => {
    if (!batch?.id) return;
    const ids = itemIds || undefined;
    const itemsToPrint = ids
      ? batchItems?.filter((i) => ids.includes(i.id))
      : batchItems?.filter((i) => i.labels_printed < i.labels_to_print);

    if (itemsToPrint && itemsToPrint.length > 0) {
      setPreviewItems(itemsToPrint);
      setShowPreview(true);
    }
  }, [batch?.id, batchItems]);

  // Open preview in new window
  const handleOpenPreview = useCallback((itemIds?: string[]) => {
    if (!batch?.id) return;
    const ids = itemIds || undefined;
    const itemsToPrint = ids
      ? batchItems?.filter((i) => ids.includes(i.id))
      : batchItems?.filter((i) => i.labels_printed < i.labels_to_print);

    if (itemsToPrint && itemsToPrint.length > 0) {
      const cfg = hwData?.config;
      // Merge hardware config with current labelTemplate
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
      const labelItems: LabelItem[] = itemsToPrint.flatMap(item => {
        const product = item.product_id ? currentProductsById.get(item.product_id) : null;
        return Array(item.labels_to_print - item.labels_printed).fill(null).map(() => ({
          productName: product?.name ?? item.product_name,
          sku: product?.sku ?? undefined,
          barcode: product?.barcode ?? item.barcode ?? "N/A",
          sellingPrice: Number(product?.price ?? item.selling_price ?? 0),
          mrp: undefined,
          offerPrice: undefined,
          quantity: 1,
        }));
      });
      openLabelPreview(labelItems, template, storeName, storeAddress);
    }
  }, [batch?.id, batchItems, labelTemplate, hwData?.config, currentProductsById]);

  // Toggle item selection
  function toggleItem(id: string) {
    setSelectedItems((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAll() {
    if (allSelected) {
      setSelectedItems(new Set());
    } else {
      setSelectedItems(new Set(filteredItems.map((i) => i.id)));
    }
  }

  const selectedSlot = (slots ?? []).find((s) => s.id === selectedSlotId);

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-bold text-foreground flex items-center gap-2">
          <Tags className="h-5 w-5 text-primary" />
          Label Printing
        </h1>
        {/* Printer Status Indicator */}
        {selectedPrinterId && (
          <div className="ml-auto flex items-center gap-2">
            <div className="flex items-center gap-1.5 rounded-lg border border-border bg-white px-3 py-1.5 shadow-sm">
              <Printer className="h-4 w-4 text-muted-foreground" />
              <select
                value={selectedPrinterId}
                onChange={(e) => {
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

      {/* Slot Selection */}
      <div className="rounded-xl border border-border bg-white shadow-sm p-4">
        <div className="flex flex-wrap items-end gap-4">
          <div className="flex-1 min-w-[200px] space-y-1">
            <label className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">
              Select Purchase Slot
            </label>
            <select
              value={selectedSlotId}
              onChange={(e) => {
                setSelectedSlotId(e.target.value);
                setSelectedItems(new Set());
                setEditingItem(null);
                setShowHistory(false);
              }}
              className="w-full rounded-lg border border-border bg-white px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
            >
              <option value="">— Choose a slot —</option>
              {(slots ?? []).map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} — {s.total_quantity ?? 0} units
                </option>
              ))}
            </select>
          </div>

          {selectedSlotId && !batch && (
            <button
              onClick={createBatch}
              disabled={creating}
              className="flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2.5 text-xs font-semibold text-white hover:bg-primary/90 disabled:opacity-50 transition"
            >
              {creating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Package className="h-3.5 w-3.5" />}
              {creating ? "Creating…" : "Create Label Batch"}
            </button>
          )}

          {selectedSlotId && batch && (
            <button
              onClick={() => setShowHistory(!showHistory)}
              className="flex items-center gap-1.5 rounded-lg border border-border bg-white px-4 py-2.5 text-xs font-semibold text-muted-foreground hover:bg-secondary-soft transition"
            >
              <History className="h-3.5 w-3.5" />
              {showHistory ? "Hide History" : "Print History"}
            </button>
          )}
        </div>

        {selectedSlotId && (
          <div className="mt-4 rounded-lg border border-border bg-muted/30 p-3">
            <div className="mb-2 flex items-center justify-between gap-3">
              <p className="text-xs font-bold text-foreground">Current product details</p>
              <button
                type="button"
                onClick={() => refetchSlotProducts()}
                className="flex items-center gap-1 text-[11px] font-semibold text-primary hover:underline"
              >
                <RefreshCw className="h-3 w-3" /> Refresh
              </button>
            </div>
            {slotProductsLoading ? (
              <div className="flex items-center gap-2 py-2 text-xs text-muted-foreground"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading product details...</div>
            ) : !slotProducts?.some((item) => item.products) ? (
              <p className="py-2 text-xs text-muted-foreground">No product assigned to this slot.</p>
            ) : (
              <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
                {slotProducts.filter((item) => item.products).map((item, index) => {
                  const product = item.products!;
                  return (
                    <div key={`${item.product_id}-${index}`} className="rounded-md border border-border bg-white p-2.5 text-xs">
                      <p className="font-semibold text-foreground">{product.name}</p>
                      <div className="mt-1 grid grid-cols-2 gap-x-3 gap-y-1 text-muted-foreground">
                        <span>SKU: <b className="text-foreground">{product.sku || "—"}</b></span>
                        <span>Barcode: <b className="font-mono text-foreground">{product.barcode || "—"}</b></span>
                        <span>Price: <b className="text-foreground">₹{Number(product.price).toFixed(2)}</b></span>
                        <span>Slot qty: <b className="text-foreground">{item.quantity} {product.unit}</b></span>
                        <span>Stock: <b className="text-foreground">{product.stock}</b></span>
                        {product.material && <span>Material: <b className="text-foreground">{product.material}</b></span>}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* Batch Summary */}
        {batch && (
          <div className="mt-4 p-3 rounded-lg bg-primary/5 border border-primary/20">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-3">
                <span className="text-sm font-bold text-foreground">
                  Slot #{batch.slot_name}
                </span>
                <StatusBadge status={batch.status} />
              </div>
              <span className="text-[10px] text-muted-foreground">
                Created {new Date(batch.created_at).toLocaleString()}
              </span>
            </div>
            <div className="grid grid-cols-3 gap-4 text-sm">
              <div>
                <span className="text-[10px] text-muted-foreground uppercase">Total Labels Required</span>
                <div className="font-bold text-foreground text-lg">{stats.total}</div>
              </div>
              <div>
                <span className="text-[10px] text-muted-foreground uppercase">Already Printed</span>
                <div className="font-bold text-emerald-600 text-lg">{stats.printed}</div>
              </div>
              <div>
                <span className="text-[10px] text-muted-foreground uppercase">Remaining</span>
                <div className={`font-bold text-lg ${stats.remaining > 0 ? "text-amber-600" : "text-emerald-600"}`}>
                  {stats.remaining}
                </div>
              </div>
            </div>
            {/* Progress bar */}
            <div className="mt-2 h-2 rounded-full bg-muted overflow-hidden">
              <div
                className="h-full bg-emerald-500 rounded-full transition-all"
                style={{ width: `${stats.total > 0 ? (stats.printed / stats.total) * 100 : 0}%` }}
              />
            </div>
          </div>
        )}
      </div>

      {/* Print History Panel */}
      {showHistory && batch && (
        <div className="rounded-xl border border-border bg-white shadow-sm overflow-hidden">
          <div className="px-4 py-3 bg-muted border-b border-border">
            <h3 className="text-sm font-bold text-foreground flex items-center gap-2">
              <History className="h-4 w-4 text-primary" />
              Print History — Slot #{batch.slot_name}
            </h3>
          </div>
          {historyLoading ? (
            <div className="p-8 text-center">
              <Loader2 className="h-5 w-5 animate-spin text-primary mx-auto" />
            </div>
          ) : printHistory && printHistory.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted text-[10px] uppercase text-muted-foreground">
                  <tr>
                    <th className="p-2.5 text-left">Product</th>
                    <th className="p-2.5 text-left">Barcode</th>
                    <th className="p-2.5 text-center">Qty Printed</th>
                    <th className="p-2.5 text-left">Printed At</th>
                  </tr>
                </thead>
                <tbody>
                  {printHistory.map((h) => (
                    <tr key={h.id} className="border-t border-border">
                      <td className="p-2.5 text-xs font-medium">{h.product_name}</td>
                      <td className="p-2.5 text-xs text-muted-foreground font-mono">{h.barcode || "—"}</td>
                      <td className="p-2.5 text-xs text-center font-bold text-primary">{h.quantity_printed}</td>
                      <td className="p-2.5 text-xs text-muted-foreground">
                        {new Date(h.printed_at).toLocaleString()}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="p-8 text-center text-xs text-muted-foreground/70">
              No print history yet for this batch.
            </div>
          )}
        </div>
      )}

      {/* Items Table */}
      {selectedSlotId && (
        <div className="rounded-xl border border-border bg-white shadow-sm overflow-hidden">
          {/* Table Header with Actions */}
          <div className="flex flex-wrap items-center justify-between px-4 py-3 border-b border-border gap-3">
            <div className="flex items-center gap-3">
              <h3 className="text-sm font-bold text-foreground">
                Products in Slot
                {batch && (
                  <span className="ml-2 text-xs font-normal text-muted-foreground">
                    ({filteredItems.length} product{filteredItems.length !== 1 ? "s" : ""})
                  </span>
                )}
              </h3>
              <div className="flex items-center gap-2 rounded-lg border border-border bg-white px-3 py-1.5 shadow-sm">
                <Search className="h-3.5 w-3.5 text-muted-foreground/70" />
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search products…"
                  className="bg-transparent text-xs outline-none w-40"
                />
              </div>
            </div>

            {/* Printer Selection & Actions */}
            {batch && (
              <div className="flex flex-wrap items-center gap-2">
                {/* Printer dropdown */}
                {printers.length > 0 && (
                  <div className="flex items-center gap-1.5">
                    <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide hidden sm:block">
                      Printer
                    </label>
                    <select
                      value={selectedPrinterId}
                      onChange={(e) => {
                        setSelectedPrinterId(e.target.value);
                        checkPrinterStatus(e.target.value);
                      }}
                      disabled={printerLoading}
                      className="rounded-lg border border-border bg-white px-3 py-1.5 text-xs outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary min-w-[180px]"
                    >
                      {printers.map(p => (
                        <option key={p.id} value={p.id}>
                          {p.name} {p.status === "connected" ? "✓" : p.status === "error" ? "✗" : "○"}
                        </option>
                      ))}
                    </select>
                    {printerLoading && <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />}
                    {selectedPrinterId && (
                      <span
                        className={`w-2 h-2 rounded-full ${
                          printerStatus[selectedPrinterId] === "connected" ? "bg-emerald-500" :
                          printerStatus[selectedPrinterId] === "error" ? "bg-red-500" :
                          "bg-amber-500"
                        }`}
                        title={printerStatus[selectedPrinterId] || "Unknown"}
                      />
                    )}
                  </div>
                )}

                {selectedItems.size > 0 && (
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => handlePreview(Array.from(selectedItems))}
                      disabled={printing}
                      className="rounded-lg border border-border bg-white px-3 py-1.5 text-xs font-semibold text-muted-foreground hover:bg-secondary-soft transition"
                      title="Preview Selected"
                    >
                      <Eye className="h-3.5 w-3.5" />
                      <span className="hidden sm:inline">Preview</span>
                    </button>
                    <button
                      onClick={() => handleOpenPreview(Array.from(selectedItems))}
                      disabled={printing}
                      className="rounded-lg border border-border bg-white px-3 py-1.5 text-xs font-semibold text-muted-foreground hover:bg-secondary-soft transition"
                      title="Open Preview in New Window"
                    >
                      <Maximize2 className="h-3.5 w-3.5" />
                    </button>
                    <button
                      onClick={() => printLabels(Array.from(selectedItems))}
                      disabled={printing || !selectedPrinterId}
                      className="flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-50 transition"
                    >
                      {printing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Printer className="h-3.5 w-3.5" />}
                      <span className="hidden sm:inline">Print Selected ({selectedItems.size})</span>
                      <span className="sm:hidden">Print</span>
                    </button>
                  </div>
                )}
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => handlePreview()}
                    disabled={printing || stats.remaining === 0}
                    className="rounded-lg border border-border bg-white px-3 py-1.5 text-xs font-semibold text-muted-foreground hover:bg-secondary-soft transition"
                    title="Preview All Labels"
                  >
                    <Eye className="h-3.5 w-3.5" />
                    <span className="hidden sm:inline">Preview All</span>
                  </button>
                  <button
                    onClick={() => handleOpenPreview()}
                    disabled={printing || stats.remaining === 0}
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
                      disabled={printing}
                      className="rounded-lg border border-border bg-white px-3 py-1.5 text-xs font-semibold text-muted-foreground hover:bg-secondary-soft transition"
                      title="Print Test Label"
                    >
                      <Wifi className="h-3.5 w-3.5" />
                      <span className="hidden sm:inline">Test Print</span>
                    </button>
                  )}
                  <button
                    onClick={() => printLabels()}
                    disabled={printing || stats.remaining === 0 || !selectedPrinterId}
                    className="flex items-center gap-1.5 rounded-lg bg-primary px-4 py-1.5 text-xs font-semibold text-white hover:bg-primary/90 disabled:opacity-50 transition"
                  >
                    {printing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Printer className="h-3.5 w-3.5" />}
                    <span className="hidden sm:inline">Print All Labels for This Slot</span>
                    <span className="sm:hidden">Print All</span>
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Loading State */}
          {(batchLoading || itemsLoading) && selectedSlotId && (
            <div className="p-12 text-center">
              <Loader2 className="h-6 w-6 animate-spin text-primary mx-auto" />
              <p className="text-sm text-muted-foreground mt-2">Loading label batch…</p>
            </div>
          )}

          {/* Empty State: No batch */}
          {!batchLoading && !batch && selectedSlotId && (
            <div className="p-12 text-center">
              <Package className="h-10 w-10 text-muted-foreground/30 mx-auto mb-3" />
              <p className="text-sm font-medium text-foreground">No Label Batch Found</p>
              <p className="text-xs text-muted-foreground/70 mt-1 mb-4">
                Create a label batch for this slot to start printing labels.
              </p>
              <button
                onClick={createBatch}
                disabled={creating}
                className="flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-xs font-semibold text-white hover:bg-primary/90 disabled:opacity-50 transition mx-auto"
              >
                {creating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Package className="h-3.5 w-3.5" />}
                {creating ? "Creating…" : "Create Label Batch"}
              </button>
            </div>
          )}

          {/* Empty State: No items */}
          {!itemsLoading && batch && filteredItems.length === 0 && (
            <div className="p-12 text-center">
              <Tags className="h-10 w-10 text-muted-foreground/30 mx-auto mb-3" />
              <p className="text-sm font-medium text-foreground">No Products Found</p>
              <p className="text-xs text-muted-foreground/70 mt-1">
                {search
                  ? "No products match your search."
                  : "This slot has no purchase items. Add products to this slot via Purchase Entry."}
              </p>
            </div>
          )}

          {/* Items Table */}
          {!itemsLoading && filteredItems.length > 0 && (
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
                    <th className="p-2.5 text-left">Barcode</th>
                    <th className="p-2.5 text-right">Purchase Qty</th>
                    <th className="p-2.5 text-right">Labels to Print</th>
                    <th className="p-2.5 text-right">Already Printed</th>
                    <th className="p-2.5 text-right">Remaining</th>
                    <th className="p-2.5 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredItems.map((item, idx) => {
                    const remaining = item.labels_to_print - item.labels_printed;
                    const isEditing = editingItem === item.id;
                    return (
                      <tr
                        key={item.id}
                        className={`border-t border-border transition ${
                          selectedItems.has(item.id) ? "bg-primary/5" : "hover:bg-secondary-soft/30"
                        }`}
                      >
                        <td className="p-2.5">
                          <input
                            type="checkbox"
                            checked={selectedItems.has(item.id)}
                            onChange={() => toggleItem(item.id)}
                            className="rounded border-border"
                          />
                        </td>
                        <td className="p-2.5 text-xs font-semibold text-muted-foreground">{idx + 1}</td>
                        <td className="p-2.5">
                          <div className="text-xs font-semibold text-foreground">{item.product_name}</div>
                        </td>
                        <td className="p-2.5 text-xs text-muted-foreground font-mono">{item.barcode || "—"}</td>
                        <td className="p-2.5 text-xs text-right font-semibold">{item.purchase_quantity}</td>
                        <td className="p-2.5 text-xs text-right">
                          {isEditing ? (
                            <input
                              type="number"
                              min={0}
                              value={editValue}
                              onChange={(e) => setEditValue(Number(e.target.value) || 0)}
                              onKeyDown={(e) => {
                                if (e.key === "Enter") updateItemQuantity(item.id, editValue);
                                if (e.key === "Escape") setEditingItem(null);
                              }}
                              className="w-20 rounded border border-primary bg-white px-2 py-1 text-xs text-right outline-none focus:ring-1 focus:ring-primary"
                              autoFocus
                            />
                          ) : (
                            <span className="font-bold text-primary">{item.labels_to_print}</span>
                          )}
                        </td>
                        <td className="p-2.5 text-xs text-right font-semibold text-emerald-600">
                          {item.labels_printed}
                        </td>
                        <td className="p-2.5 text-xs text-right">
                          <span
                            className={`font-bold ${
                              remaining > 0 ? "text-amber-600" : "text-emerald-600"
                            }`}
                          >
                            {remaining}
                          </span>
                        </td>
                        <td className="p-2.5 text-right">
                          <div className="flex items-center justify-end gap-1">
                            {isEditing ? (
                              <>
                                <button
                                  onClick={() => updateItemQuantity(item.id, editValue)}
                                  className="rounded bg-emerald-500 px-2 py-1 text-[10px] font-bold text-white hover:bg-emerald-600"
                                >
                                  Save
                                </button>
                                <button
                                  onClick={() => setEditingItem(null)}
                                  className="rounded bg-muted px-2 py-1 text-[10px] font-bold text-muted-foreground hover:bg-muted/80"
                                >
                                  Cancel
                                </button>
                              </>
                            ) : (
                              <>
                                <button
                                  onClick={() => {
                                    setEditingItem(item.id);
                                    setEditValue(item.labels_to_print);
                                  }}
                                  className="rounded p-1 hover:bg-primary/10 transition"
                                  title="Edit label count"
                                >
                                  <RotateCcw className="h-3.5 w-3.5 text-primary" />
                                </button>
                                {remaining > 0 && (
                                  <button
                                    onClick={() => printLabels([item.id])}
                                    disabled={printing}
                                    className="rounded p-1 hover:bg-emerald-50 transition"
                                    title={`Print ${remaining} label(s)`}
                                  >
                                    <Printer className="h-3.5 w-3.5 text-emerald-600" />
                                  </button>
                                )}
                              </>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                {/* Footer Totals */}
                <tfoot className="bg-muted/50 border-t border-border">
                  <tr>
                    <td colSpan={4} className="p-2.5 text-xs font-bold text-foreground text-right">
                      TOTALS
                    </td>
                    <td className="p-2.5 text-xs font-bold text-right">
                      {stats.total}
                    </td>
                    <td className="p-2.5 text-xs font-bold text-primary text-right">
                      {stats.total}
                    </td>
                    <td className="p-2.5 text-xs font-bold text-emerald-600 text-right">
                      {stats.printed}
                    </td>
                    <td className="p-2.5 text-xs font-bold text-right">
                      <span className={stats.remaining > 0 ? "text-amber-600" : "text-emerald-600"}>
                        {stats.remaining}
                      </span>
                    </td>
                    <td></td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Empty State: No slot selected */}
      {!selectedSlotId && (
        <div className="rounded-xl border border-dashed border-border bg-white/50 py-16 text-center">
          <Tags className="h-10 w-10 text-muted-foreground/30 mx-auto mb-3" />
          <p className="text-sm font-medium text-foreground">Select a Purchase Slot</p>
          <p className="text-xs text-muted-foreground/70 mt-1 max-w-sm mx-auto">
            Choose a slot above to view its label batch. You can create labels for all products in that slot
            and print them in one go.
          </p>
        </div>
      )}

      {/* Printer Settings Panel */}
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
                      const width = cfg?.label_width_mm ?? labelTemplate.labelWidth;
                      const height = cfg?.label_height_mm ?? labelTemplate.labelHeight;
                      printTestLabel(selectedPrinterId, width, height).then(() => toast.success("Test label sent")).catch(e => toast.error(e.message));
                    }}
                    disabled={printing}
                    className="flex items-center gap-2 w-full rounded-lg border border-border bg-white px-3 py-2 text-sm font-semibold text-muted-foreground hover:bg-secondary-soft transition disabled:opacity-50"
                  >
                    <Wifi className="h-4 w-4" />
                    Print Test Label
                  </button>
                </div>
              )}

              <div className="pt-2 border-t border-border">
                <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">
                  Label Template Settings
                </h4>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide block mb-1">
                      Label Width (mm)
                    </label>
                    <input
                      type="number"
                      min="10"
                      max="100"
                      step="1"
                      value={labelTemplate.labelWidth}
                      onChange={(e) => setLabelTemplate(prev => ({ ...prev, labelWidth: Number(e.target.value) }))}
                      className="w-full rounded-lg border border-border bg-white px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide block mb-1">
                      Label Height (mm)
                    </label>
                    <input
                      type="number"
                      min="10"
                      max="100"
                      step="1"
                      value={labelTemplate.labelHeight}
                      onChange={(e) => setLabelTemplate(prev => ({ ...prev, labelHeight: Number(e.target.value) }))}
                      className="w-full rounded-lg border border-border bg-white px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide block mb-1">
                      Margin (mm)
                    </label>
                    <input
                      type="number"
                      min="0"
                      max="10"
                      step="1"
                      value={labelTemplate.margin}
                      onChange={(e) => setLabelTemplate(prev => ({ ...prev, margin: Number(e.target.value) }))}
                      className="w-full rounded-lg border border-border bg-white px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide block mb-1">
                      Text Size
                    </label>
                    <select
                      value={labelTemplate.textSize}
                      onChange={(e) => setLabelTemplate(prev => ({ ...prev, textSize: e.target.value as "small" | "medium" | "large" }))}
                      className="w-full rounded-lg border border-border bg-white px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
                    >
                      <option value="small">Small</option>
                      <option value="medium">Medium</option>
                      <option value="large">Large</option>
                    </select>
                  </div>
                </div>
                <div className="mt-3 grid grid-cols-2 gap-2">
                  {[
                    { key: "showMRP", label: "Show MRP" },
                    { key: "showOfferPrice", label: "Show Offer Price" },
                    { key: "showBatchNumber", label: "Show Batch Number" },
                    { key: "showExpiryDate", label: "Show Expiry Date" },
                    { key: "showSKU", label: "Show SKU" },
                    { key: "showStoreName", label: "Show Store Name" },
                    { key: "showStoreAddress", label: "Show Store Address" },
                  ].map(({ key, label }) => (
                    <label key={key} className="flex items-center gap-2 text-xs">
                      <input
                        type="checkbox"
                        checked={labelTemplate[key as keyof LabelTemplateOptions] as boolean}
                        onChange={(e) => setLabelTemplate(prev => ({ ...prev, [key]: e.target.checked }))}
                        className="rounded border-border"
                      />
                      {label}
                    </label>
                  ))}
                </div>
              </div>
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

      {/* Preview Modal */}
      {showPreview && previewItems.length > 0 && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-4xl h-[90vh] rounded-xl bg-white shadow-xl flex flex-col">
            <div className="flex items-center justify-between p-4 border-b border-border">
              <h3 className="text-lg font-bold text-foreground">
                Label Preview - {previewItems.length} product(s)
              </h3>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => handleOpenPreview(
                    previewItems.map(i => i.id)
                  )}
                  className="rounded-lg border border-border bg-white px-3 py-1.5 text-xs font-semibold text-muted-foreground hover:bg-secondary-soft transition"
                >
                  <Maximize2 className="h-3.5 w-3.5" />
                  <span className="hidden sm:inline">Open in New Window</span>
                </button>
                <button
                  onClick={() => setShowPreview(false)}
                  className="rounded p-1 hover:bg-muted transition"
                >
                  <X className="h-5 w-5 text-muted-foreground" />
                </button>
              </div>
            </div>
            <div className="flex-1 overflow-auto p-4">
              {(() => {
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
                return (
                  <iframe
                    srcDoc={generateBatchLabelPreview(
                      previewItems.flatMap(item =>
                        Array(item.labels_to_print - item.labels_printed).fill(null).map(() => ({
                          productName: item.product_name,
                          sku: item.barcode || undefined,
                          barcode: item.barcode || "N/A",
                          sellingPrice: Number(item.selling_price || 0),
                          mrp: undefined,
                          offerPrice: undefined,
                          quantity: 1,
                        }))
                      ),
                      template,
                      storeName,
                      storeAddress
                    )}
                    className="w-full h-full border-0"
                    title="Label Preview"
                  />
                );
              })()}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
