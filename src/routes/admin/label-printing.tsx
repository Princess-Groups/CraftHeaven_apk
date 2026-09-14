import { createFileRoute, useSearch } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useState, useMemo, useCallback } from "react";
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
    return batchItems.filter(
      (item) =>
        item.product_name?.toLowerCase().includes(q) ||
        item.barcode?.toLowerCase().includes(q)
    );
  }, [batchItems, search]);

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

  // Print labels
  const printLabels = useCallback(
    async (itemIds?: string[]) => {
      if (!batch?.id) return;
      setPrinting(true);
      try {
        const ids = itemIds || undefined;
        const quantities = ids?.map((id) => {
          const item = batchItems?.find((i) => i.id === id);
          return item ? item.labels_to_print - item.labels_printed : 0;
        });

        const { data, error } = await supabase.rpc("mark_labels_printed", {
          _batch_id: batch.id,
          _item_ids: ids || null,
          _quantities: quantities || null,
        });
        if (error) throw error;

        const printed = Number(data) || 0;
        if (printed > 0) {
          // Generate print content
          const itemsToPrint = ids
            ? batchItems?.filter((i) => ids.includes(i.id))
            : batchItems?.filter((i) => i.labels_printed < i.labels_to_print);

          if (itemsToPrint && itemsToPrint.length > 0) {
            generatePrintContent(itemsToPrint);
          }
          toast.success(`${printed} labels marked as printed`);
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
    [batch?.id, batchItems, selectedSlotId, qc]
  );

  // Generate print content (barcode labels)
  function generatePrintContent(items: LabelBatchItem[]) {
    const printWindow = window.open("", "_blank", "width=800,height=600");
    if (!printWindow) {
      toast.error("Pop-up blocked. Please allow pop-ups for printing.");
      return;
    }

    const labels: string[] = [];
    for (const item of items) {
      const qty = item.labels_printed > 0
        ? item.labels_to_print - (item.labels_printed - (item.labels_to_print - item.labels_printed))
        : item.labels_to_print;
      // Just print labels_to_print minus already printed
      const remaining = item.labels_to_print - item.labels_printed;
      for (let i = 0; i < remaining; i++) {
        labels.push(`
          <div class="label">
            <div class="barcode">${item.barcode || "N/A"}</div>
            <div class="product-name">${item.product_name}</div>
            <div class="price">₹${Number(item.selling_price || 0).toFixed(2)}</div>
          </div>
        `);
      }
    }

    printWindow.document.write(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>Labels - ${batch?.slot_name || "Batch"}</title>
        <style>
          * { margin: 0; padding: 0; box-sizing: border-box; }
          body { font-family: Arial, sans-serif; padding: 10px; }
          .label {
            border: 1px solid #ccc;
            padding: 8px;
            margin: 4px;
            display: inline-block;
            width: 2.5in;
            height: 1.5in;
            vertical-align: top;
            text-align: center;
            page-break-inside: avoid;
          }
          .barcode { font-family: monospace; font-size: 14px; font-weight: bold; margin: 4px 0; }
          .product-name { font-size: 11px; margin: 4px 0; word-wrap: break-word; max-height: 2.5em; overflow: hidden; }
          .price { font-size: 12px; font-weight: bold; color: #333; }
          @media print {
            body { padding: 0; }
            .label { border: 1px solid #000; }
          }
        </style>
      </head>
      <body>
        <h3>Labels - Slot ${batch?.slot_name || ""} (${items.length} products, ${stats.remaining} labels)</h3>
        <hr style="margin: 8px 0;"/>
        ${labels.join("")}
      </body>
      </html>
    `);
    printWindow.document.close();
    printWindow.print();
  }

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
          <div className="flex items-center justify-between px-4 py-3 border-b border-border">
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
            {batch && (
              <div className="flex items-center gap-2">
                {selectedItems.size > 0 && (
                  <button
                    onClick={() => printLabels(Array.from(selectedItems))}
                    disabled={printing}
                    className="flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-2 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-50 transition"
                  >
                    {printing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Printer className="h-3.5 w-3.5" />}
                    Print Selected ({selectedItems.size})
                  </button>
                )}
                <button
                  onClick={() => printLabels()}
                  disabled={printing || stats.remaining === 0}
                  className="flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-xs font-semibold text-white hover:bg-primary/90 disabled:opacity-50 transition"
                >
                  {printing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Printer className="h-3.5 w-3.5" />}
                  Print All Labels for This Slot
                </button>
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
    </div>
  );
}
