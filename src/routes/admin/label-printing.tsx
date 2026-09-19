import { createFileRoute, useSearch } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useState, useMemo, useCallback } from "react";
import {
  Search,
  Loader2,
  CheckCircle2,
  Clock,
  AlertCircle,
  RotateCcw,
  Package,
  Tags,
  RefreshCw,
  FileDown,
} from "lucide-react";
import { toast } from "sonner";

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

// Product details are loaded from products rather than the label batch snapshot
// so changes are reflected before a label is printed.
type SlotProduct = {
  product_id: string | null;
  quantity: number;
  unit_cost: number | null;
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
  const [creating, setCreating] = useState(false);

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
        .select("product_id,quantity,unit_cost,products(id,name,sku,barcode,price,stock,unit,material)")
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
        .maybeSingle();
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

  // Export label batch details to Excel (CSV format) for the client's label software
  const exportToExcel = useCallback(() => {
    if (!filteredItems || filteredItems.length === 0) {
      toast.error("No data to export");
      return;
    }

    const esc = (value: string) => {
      if (/[",\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
      return value;
    };

    const headers = [
      "Product Name",
      "SKU / Item Code",
      "Barcode Number",
      "Purchase Qty",
      "Labels to Print",
      "MRP / Selling Price",
    ];

    const rows = filteredItems.map((item) => {
      const product = item.product_id ? currentProductsById.get(item.product_id) : null;
      const exportPrice = Number(product?.price) > 0
        ? Number(product?.price)
        : (item.selling_price > 0 ? item.selling_price : (item.unit_price ?? 0));
      return [
        product?.name ?? item.product_name,
        product?.sku ?? "",
        product?.barcode ?? item.barcode ?? "",
        String(item.purchase_quantity),
        String(item.labels_to_print),
        exportPrice.toFixed(2),
      ];
    });

    const csvContent = [headers.join(","), ...rows.map((r) => r.map(esc).join(","))].join("\n");
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `label-printing-${selectedSlotId || "slot"}-${new Date().toISOString().slice(0, 10)}.xlsx`;
    link.click();
    URL.revokeObjectURL(url);
    toast.success(`Exported ${rows.length} items to Excel (CSV format)`);
  }, [filteredItems, currentProductsById, selectedSlotId]);

  // Export label batch details as a CSV file
  const exportToCsv = useCallback(() => {
    if (!filteredItems || filteredItems.length === 0) {
      toast.error("No data to export");
      return;
    }

    const esc = (value: string) => {
      if (/[",\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
      return value;
    };

    const headers = [
      "Product Name",
      "SKU / Item Code",
      "Barcode Number",
      "Purchase Qty",
      "Labels to Print",
      "MRP / Selling Price",
    ];

    const rows = filteredItems.map((item) => {
      const product = item.product_id ? currentProductsById.get(item.product_id) : null;
      const exportPrice = Number(product?.price) > 0
        ? Number(product?.price)
        : (item.selling_price > 0 ? item.selling_price : (item.unit_price ?? 0));
      return [
        product?.name ?? item.product_name,
        product?.sku ?? "",
        product?.barcode ?? item.barcode ?? "",
        String(item.purchase_quantity),
        String(item.labels_to_print),
        exportPrice.toFixed(2),
      ];
    });

    const csvContent = "\uFEFF" + [headers.join(","), ...rows.map((r) => r.map(esc).join(","))].join("\n");
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `label-printing-${selectedSlotId || "slot"}-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
    toast.success(`Exported ${rows.length} items to CSV`);
  }, [filteredItems, currentProductsById, selectedSlotId]);

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
                  const shownPrice = Number(product.price) > 0 ? Number(product.price) : (Number(item.unit_cost) || 0);
                  return (
                    <div key={`${item.product_id}-${index}`} className="rounded-md border border-border bg-white p-2.5 text-xs">
                      <p className="font-semibold text-foreground">{product.name}</p>
                      <div className="mt-1 grid grid-cols-2 gap-x-3 gap-y-1 text-muted-foreground">
                        <span>SKU: <b className="text-foreground">{product.sku || "—"}</b></span>
                        <span>Barcode: <b className="font-mono text-foreground">{product.barcode || "—"}</b></span>
                        <span>Price: <b className="text-foreground">₹{shownPrice.toFixed(2)}</b></span>
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

            {/* Actions */}
            {batch && (
              <div className="flex flex-wrap items-center gap-2">
                <div className="flex items-center gap-1">
                  <button
                    onClick={exportToCsv}
                    disabled={!batchItems || batchItems.length === 0}
                    className="flex items-center gap-1.5 rounded-lg border border-green-600 bg-white px-3 py-1.5 text-xs font-semibold text-green-700 hover:bg-green-50 disabled:opacity-50 transition"
                    title="Export to CSV"
                  >
                    <FileDown className="h-3.5 w-3.5" />
                    <span className="hidden sm:inline">Export CSV</span>
                    <span className="sm:hidden">CSV</span>
                  </button>
                  <button
                    onClick={exportToExcel}
                    disabled={!batchItems || batchItems.length === 0}
                    className="flex items-center gap-1.5 rounded-lg bg-green-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-green-700 disabled:opacity-50 transition"
                    title="Export to Excel for client label software"
                  >
                    <FileDown className="h-3.5 w-3.5" />
                    <span className="hidden sm:inline">Export Excel</span>
                    <span className="sm:hidden">Excel</span>
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
                Create a label batch for this slot to view and export the label details.
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
            Choose a slot above to view its label batch and export the product details.
          </p>
        </div>
      )}
    </div>
  );
}
