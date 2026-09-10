import { createFileRoute, useSearch } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useState, useRef, useCallback, useMemo, useEffect, memo } from "react";
import {
  Plus,
  Trash2,
  Search,
  Download,
  Upload,
  Save,
  X,
  Loader2,
  ImageIcon,
  ChevronLeft,
  Percent,
} from "lucide-react";
import { toast } from "sonner";
import { uploadProductImage } from "@/lib/upload";
import { Label } from "@/components/ui/label";
import { autoAssignGst, GST_RATES, GST_RATE_LABELS } from "@/lib/gst-config";

export const Route = createFileRoute("/admin/purchases")({
  head: () => ({ meta: [{ title: "Purchase Entry — ACH Admin" }] }),
  validateSearch: (search: Record<string, unknown>) => ({
    restock: (search.restock as string) || undefined,
  }),
  component: Purchases,
});

// ---------- Types ----------
type ColorVariant = {
  _id: string;
  color_name: string;
  color_code: string;
  color_image: string;
  quantity: number;
};

type ProductRow = {
  _rowId: string;
  id: string;
  serial: number;
  barcode: string;
  supplier_name: string;
  supplier_bill_no: string;
  category_id: string;
  image_url: string;
  date: string;
  name: string;
  material: string;
  colour: string;
  per_packet_unit: string;
  per_packet_value: number;
  total_unit: number;
  total_unit_type: string;
  quantity: number;
  unit_price: number;
  total_price: number;
  purchase_packing_freight_charge: number;
  slot_id: string;
  slot_total_charge: number;
  slot_charge_per_product: number;
  other_charges: number;
  total_unit_cost: number;
  final_purchase_cost: number;
  retail_profit_pct: number;
  retail_selling_price: number;
  wholesale_profit_pct: number;
  wholesale_price: number;
  profit_per_piece_pct: number;
  discount_type: "amount" | "percentage";
  discount_pct: number;
  discount_amount: number;
  minimum_stock: number;
  current_stock: number;
  rack_location: string;
  delivery_packing_charge: number;
  delivery_charge: number;
  per_unit_delivery_packing: number;
  per_unit_delivery: number;
  per_unit_total_charges: number;
  re_stock: number;
  gst_rate: number;
  gst_is_custom: boolean;
  gst_amount: number;
  discount: number;
  total_final: number;
  cash_received_by: string;
  remark: string;
  mrp: number;
  mop: number;
  color_variants: ColorVariant[];
};

const uid = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : "r-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 8);

const blankRow = (serial: number): ProductRow => ({
  _rowId: uid(),
  id: "",
  serial,
  barcode: "",
  supplier_name: "",
  supplier_bill_no: "",
  category_id: "",
  image_url: "",
  date: new Date().toISOString().slice(0, 10),
  name: "",
  material: "",
  colour: "",
  per_packet_unit: "Nos",
  per_packet_value: 0,
  total_unit: 0,
  total_unit_type: "Nos",
  quantity: 1,
  unit_price: 0,
  total_price: 0,
  purchase_packing_freight_charge: 0,
  slot_id: "",
  slot_total_charge: 0,
  slot_charge_per_product: 0,
  other_charges: 0,
  total_unit_cost: 0,
  final_purchase_cost: 0,
  retail_profit_pct: 0,
  retail_selling_price: 0,
  wholesale_profit_pct: 0,
  wholesale_price: 0,
  profit_per_piece_pct: 0,
  discount_type: "amount",
  discount_pct: 0,
  discount_amount: 0,
  minimum_stock: 5,
  current_stock: 0,
  rack_location: "",
  delivery_packing_charge: 0,
  delivery_charge: 0,
  per_unit_delivery_packing: 0,
  per_unit_delivery: 0,
  per_unit_total_charges: 0,
  re_stock: 0,
  gst_rate: 0,
  gst_is_custom: false,
  gst_amount: 0,
  discount: 0,
  total_final: 0,
  cash_received_by: "",
  remark: "",
  mrp: 0,
  mop: 0,
  color_variants: [],
});

const UNITS = ["Nos", "Packet", "Unit", "Kilogram", "Gram", "Liter", "ML", "Meter", "Centimeter", "Inch", "DIAM"] as const;
const PAYMENT_METHODS = ["UPI", "CASH", "GPAY", "CARD"] as const;

// ---------- Calculated fields ----------
function calcRow(r: ProductRow): ProductRow {
  // Auto-calculate total quantity from color variants if any exist
  const variants = r.color_variants || [];
  const variantTotalQty = variants.reduce((sum, v) => sum + (Number(v.quantity) || 0), 0);
  const qty = variants.length > 0 ? variantTotalQty : (Number(r.quantity) || 0);
  const ppv = Number(r.per_packet_value) || 0;
  const autoTotalUnit = ppv > 0 ? Math.round(qty * ppv * 100) / 100 : 0;
  // Use auto-calculated total_unit when per_packet_value is provided; otherwise fall back to manual entry
  const tu = ppv > 0 ? autoTotalUnit : (Number(r.total_unit) || 0);
  // Carry over the per packet unit type to total unit type when auto-calculating
  const autoTotalUnitType = ppv > 0 ? r.per_packet_unit : r.total_unit_type;
  const up = Number(r.unit_price) || 0;
  const total_price = qty * up;
  const perUnitPF = Number(r.purchase_packing_freight_charge) || 0;
  const totalPF = Math.round(perUnitPF * qty * 100) / 100;
  const total_unit_cost = up + perUnitPF + Number(r.other_charges);
  const final_purchase_cost = total_unit_cost * qty;

  // Auto-calculate selling prices from profit percentages when provided
  const retailProfitPct = Number(r.retail_profit_pct) || 0;
  const wholesaleProfitPct = Number(r.wholesale_profit_pct) || 0;
  const retail_selling_price = retailProfitPct > 0 && final_purchase_cost > 0
    ? Math.round(final_purchase_cost * (1 + retailProfitPct / 100) * 100) / 100
    : Number(r.retail_selling_price) || 0;
  const wholesale_price = wholesaleProfitPct > 0 && final_purchase_cost > 0
    ? Math.round(final_purchase_cost * (1 + wholesaleProfitPct / 100) * 100) / 100
    : Number(r.wholesale_price) || 0;

  const rsp = retail_selling_price;
  const profit_pct = rsp > 0 && total_unit_cost > 0 ? ((rsp - total_unit_cost) / total_unit_cost) * 100 : 0;
  const gst_pct = Math.min(Math.max(Number(r.gst_rate) || 0, 0), 100);
  const gst = final_purchase_cost * gst_pct / 100;

  // Discount calculation: supports both fixed amount and percentage
  const discountType = r.discount_type || "amount";
  const discountPct = Math.min(Math.max(Number(r.discount_pct) || 0, 0), 100);
  const discountAmount = Number(r.discount_amount) || 0;
  const discount = discountType === "percentage"
    ? Math.round(final_purchase_cost * discountPct / 100 * 100) / 100
    : discountAmount;

  // Delivery & Packing charge distribution across quantity
  const deliveryPackingCharge = Number(r.delivery_packing_charge) || 0;
  const deliveryCharge = Number(r.delivery_charge) || 0;
  const perUnitDeliveryPacking = qty > 0 ? Math.round(deliveryPackingCharge / qty * 100) / 100 : 0;
  const perUnitDelivery = qty > 0 ? Math.round(deliveryCharge / qty * 100) / 100 : 0;
  const perUnitTotalCharges = perUnitDeliveryPacking + perUnitDelivery;

  const total_final = final_purchase_cost + deliveryPackingCharge + deliveryCharge + gst - discount;

  return {
    ...r,
    quantity: qty,
    total_unit: tu,
    total_unit_type: autoTotalUnitType,
    total_price,
    total_unit_cost,
    final_purchase_cost,
    slot_charge_per_product: r.slot_id ? totalPF : r.slot_charge_per_product,
    per_unit_delivery_packing: perUnitDeliveryPacking,
    per_unit_delivery: perUnitDelivery,
    per_unit_total_charges: perUnitTotalCharges,
    retail_selling_price,
    wholesale_price,
    profit_per_piece_pct: Math.round(profit_pct * 100) / 100,
    discount_amount: discount,
    gst_amount: Math.round(gst * 100) / 100,
    total_final: Math.round(total_final * 100) / 100,
  };
}

// ---------- Slot charge calculation ----------
// Recalculate per-product slot charges for a given slot.
// Each product gets: perUnitCost × its own quantity
function recalcSlotCharges(
  rows: ProductRow[],
  slotId: string,
  totalSlotCharge: number,
  perUnitCost: number,
): ProductRow[] {
  if (!slotId) return rows;
  const slotProducts = rows.filter((r) => r.slot_id === slotId);
  if (slotProducts.length === 0) return rows;

  return rows.map((r) => {
    if (r.slot_id === slotId) {
      const qty = Number(r.quantity) || 0;
      const totalPF = Math.round(perUnitCost * qty * 100) / 100;
      return {
        ...r,
        slot_total_charge: totalSlotCharge,
        purchase_packing_freight_charge: perUnitCost,
        slot_charge_per_product: totalPF,
      };
    }
    return r;
  });
}

// Helper: compute per-unit cost from a slot
function getSlotPerUnitCost(
  slot: { packing_charges?: number | null; freight_charges?: number | null; other_charges?: number | null; total_quantity?: number | null } | undefined,
): number {
  if (!slot) return 0;
  const total = (slot.packing_charges ?? 0) + (slot.freight_charges ?? 0) + (slot.other_charges ?? 0);
  const qty = slot.total_quantity ?? 1;
  return qty > 0 ? Math.round((total / qty) * 100) / 100 : 0;
}

// Recalculate all slot charges across all slots in the rows
function recalcAllSlotCharges(rows: ProductRow[], slotsList: { id: string; packing_charges?: number | null; freight_charges?: number | null; other_charges?: number | null; total_quantity?: number | null }[]): ProductRow[] {
  // Build a map of slot_id -> total_slot_charge from the first product in each slot
  const slotTotals = new Map<string, number>();
  for (const r of rows) {
    if (r.slot_id && !slotTotals.has(r.slot_id)) {
      slotTotals.set(r.slot_id, r.slot_total_charge || 0);
    }
  }
  let result = rows;
  Array.from(slotTotals.entries()).forEach(([slotId, totalCharge]) => {
    const slot = slotsList.find((s) => s.id === slotId);
    const perUnit = getSlotPerUnitCost(slot);
    result = recalcSlotCharges(result, slotId, totalCharge, perUnit);
  });
  return result;
}

// Get the list of unique slot IDs from the rows
function getSlotIds(rows: ProductRow[]): string[] {
  const seen = new Set<string>();
  return rows.filter((r) => r.slot_id && !seen.has(r.slot_id) && seen.add(r.slot_id)).map((r) => r.slot_id);
}

// Get the total charge for a slot (from the first product's slot_total_charge)
function getSlotTotalCharge(rows: ProductRow[], slotId: string): number {
  const first = rows.find((r) => r.slot_id === slotId);
  return first?.slot_total_charge || 0;
}

// ---------- Draft persistence (localStorage) ----------
const DRAFTS_KEY = "ach_purchase_drafts";

type DraftEntry = {
  draft_id: string;
  created_at: string;
  updated_at: string;
  rows: ProductRow[];
  slot_totals: Record<string, number>;
  label: string;
};

function saveDraft(draft: DraftEntry): void {
  const existing = loadDrafts();
  const idx = existing.findIndex((d) => d.draft_id === draft.draft_id);
  draft.updated_at = new Date().toISOString();
  if (idx >= 0) {
    existing[idx] = draft;
  } else {
    existing.unshift(draft);
  }
  localStorage.setItem(DRAFTS_KEY, JSON.stringify(existing));
}

function loadDrafts(): DraftEntry[] {
  try {
    const raw = localStorage.getItem(DRAFTS_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function loadDraft(draftId: string): DraftEntry | undefined {
  return loadDrafts().find((d) => d.draft_id === draftId);
}

function deleteDraft(draftId: string): void {
  const existing = loadDrafts().filter((d) => d.draft_id !== draftId);
  localStorage.setItem(DRAFTS_KEY, JSON.stringify(existing));
}

function makeDraftLabel(rows: ProductRow[]): string {
  const firstNamed = rows.find((r) => r.name?.trim());
  const count = rows.length;
  if (firstNamed) return `${firstNamed.name}${count > 1 ? ` +${count - 1} more` : ""}`;
  return `Draft (${count} product${count !== 1 ? "s" : ""})`;
}

// ---------- Stable Cell component ----------
let _patchRowRef: ((idx: number, patch: Partial<ProductRow>) => void) | null = null;
let _handleImageUploadRef: ((idx: number, file: File) => void) | null = null;
let _uploadingRef: string | null = null;

const UnitCell = memo(function UnitCell({
  row,
  field,
  options,
  idx,
}: {
  row: ProductRow;
  field: keyof ProductRow;
  options?: readonly string[];
  idx: number;
}) {
  const val = String(row[field] || "");
  if (val === "Packet" || val.startsWith("Packet ")) {
    return (
      <input
        type="text"
        value={val}
        onChange={(e) => _patchRowRef?.(idx, { [field]: e.target.value })}
        className="w-full rounded-lg border border-border bg-white px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
        placeholder="e.g. 500 Gram, 1 KG"
      />
    );
  }
  return (
    <select
      value={val}
      onChange={(e) => _patchRowRef?.(idx, { [field]: e.target.value })}
      className="w-full rounded-lg border border-border bg-white px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
    >
      {options?.map((o) => (
        <option key={o} value={o}>{o}</option>
      ))}
    </select>
  );
});

// ---------- Supplier Combobox ----------
const SupplierCombobox = memo(function SupplierCombobox({
  value,
  onChange,
  suppliers,
  onSupplierAdded,
}: {
  value: string;
  onChange: (val: string) => void;
  suppliers: { id: string; name: string }[];
  onSupplierAdded?: () => void;
}) {
  const [inputVal, setInputVal] = useState(value || "");
  const [open, setOpen] = useState(false);
  const [highlightIdx, setHighlightIdx] = useState(-1);
  const [showAddModal, setShowAddModal] = useState(false);
  const [newSupName, setNewSupName] = useState("");
  const [newSupPhone, setNewSupPhone] = useState("");
  const [newSupGstin, setNewSupGstin] = useState("");
  const [savingNew, setSavingNew] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const qc = useQueryClient();

  // Sync external value changes
  useEffect(() => { setInputVal(value || ""); }, [value]);

  const filtered = useMemo(() => {
    if (!inputVal.trim()) return suppliers ?? [];
    const q = inputVal.toLowerCase();
    return (suppliers ?? []).filter((s) => s.name?.toLowerCase().includes(q));
  }, [inputVal, suppliers]);

  const trimmedInput = inputVal.trim();
  const isNew = trimmedInput.length > 0 && !(suppliers ?? []).some(
    (s) => s.name?.toLowerCase() === trimmedInput.toLowerCase()
  );

  function select(name: string) {
    setInputVal(name);
    onChange(name);
    setOpen(false);
    setHighlightIdx(-1);
  }

  async function addNewSupplier() {
    if (!newSupName.trim()) return toast.error("Supplier name is required");
    // Check duplicate
    const dup = suppliers?.find((s) => s.name?.toLowerCase() === newSupName.trim().toLowerCase());
    if (dup) return toast.error("A supplier with this name already exists");
    setSavingNew(true);
    try {
      const payload = {
        name: newSupName.trim(),
        phone: newSupPhone.trim() || null,
        gstin: newSupGstin.trim() || null,
      };
      const { data, error } = await supabase.from("suppliers").insert(payload).select();
      if (error) {
        console.error("[Purchases] Supplier insert error:", error);
        throw error;
      }
      if (!data || data.length === 0) {
        console.error("[Purchases] Supplier insert returned no data — possible RLS issue");
        throw new Error("Supplier insert returned no data. Check your permissions.");
      }
      toast.success("Supplier added");
      qc.invalidateQueries({ queryKey: ["suppliers-lite"] });
      qc.invalidateQueries({ queryKey: ["sup"] });
      if (onSupplierAdded) onSupplierAdded();
      // Auto-select the new supplier
      select(newSupName.trim());
      setShowAddModal(false);
      setNewSupName("");
      setNewSupPhone("");
      setNewSupGstin("");
    } catch (err) {
      console.error("[Purchases] Supplier save failed:", err);
      toast.error(err instanceof Error ? err.message : "Failed to add supplier");
    } finally {
      setSavingNew(false);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (!open) {
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        setOpen(true);
      }
      return;
    }
    const totalItems = filtered.length + (isNew ? 1 : 0);
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlightIdx((i) => (i + 1) % totalItems);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlightIdx((i) => (i - 1 + totalItems) % totalItems);
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (highlightIdx >= 0 && highlightIdx < filtered.length) {
        select(filtered[highlightIdx].name);
      } else if (isNew && highlightIdx === filtered.length) {
        // Open add modal instead of just selecting
        setNewSupName(trimmedInput);
        setShowAddModal(true);
        setOpen(false);
      } else if (filtered.length === 1) {
        select(filtered[0].name);
      } else if (isNew) {
        setNewSupName(trimmedInput);
        setShowAddModal(true);
        setOpen(false);
      }
    } else if (e.key === "Escape") {
      setOpen(false);
      setHighlightIdx(-1);
    }
  }

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  return (
    <>
      <div ref={wrapperRef} className="relative">
        <input
          ref={inputRef}
          type="text"
          value={inputVal}
          onChange={(e) => {
            setInputVal(e.target.value);
            setHighlightIdx(-1);
            if (!open) setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={handleKeyDown}
          placeholder="Type to search supplier…"
          className="w-full rounded-lg border border-border bg-white px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
          autoComplete="off"
        />
        {open && (
          <div
            ref={listRef}
            className="absolute z-50 mt-1 w-full rounded-lg border border-border bg-white shadow-lg max-h-48 overflow-y-auto"
          >
            {filtered.length === 0 && !isNew && (
              <div className="px-3 py-2 text-xs text-muted-foreground/70 italic">
                No suppliers found
              </div>
            )}
            {filtered.map((s, i) => (
              <button
                key={s.id}
                type="button"
                onMouseDown={(e) => {
                  e.preventDefault();
                  select(s.name);
                }}
                onMouseEnter={() => setHighlightIdx(i)}
                className={`w-full text-left px-3 py-2 text-sm transition ${
                  highlightIdx === i ? "bg-primary/10 text-primary font-medium" : "hover:bg-secondary-soft"
                }`}
              >
                {s.name}
              </button>
            ))}
            {isNew && (
              <button
                type="button"
                onMouseDown={(e) => {
                  e.preventDefault();
                  setNewSupName(trimmedInput);
                  setShowAddModal(true);
                  setOpen(false);
                }}
                onMouseEnter={() => setHighlightIdx(filtered.length)}
                className={`w-full text-left px-3 py-2 text-sm border-t border-border/50 transition ${
                  highlightIdx === filtered.length ? "bg-emerald-50 text-emerald-700 font-medium" : "hover:bg-emerald-50"
                }`}
              >
                <span className="text-emerald-600">+ Add new supplier: </span>
                <span className="font-semibold">{trimmedInput}</span>
              </button>
            )}
          </div>
        )}
      </div>
      {/* Inline Add Supplier Modal */}
      {showAddModal && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40" onMouseDown={() => { setShowAddModal(false); setNewSupName(""); setNewSupPhone(""); setNewSupGstin(""); }}>
          <div className="bg-white rounded-xl shadow-2xl border border-border w-full max-w-sm p-4 space-y-3" onMouseDown={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold text-foreground">Add New Supplier</h3>
              <button onClick={() => { setShowAddModal(false); setNewSupName(""); setNewSupPhone(""); setNewSupGstin(""); }} className="rounded p-1 hover:bg-muted">
                <X className="h-4 w-4 text-muted-foreground" />
              </button>
            </div>
            <div className="space-y-2">
              <div className="space-y-1">
                <label className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">Supplier Name *</label>
                <input
                  value={newSupName}
                  onChange={(e) => setNewSupName(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") addNewSupplier(); }}
                  placeholder="e.g. ABC Traders"
                  className="w-full rounded-lg border border-border bg-white px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
                  autoFocus
                />
              </div>
              <div className="space-y-1">
                <label className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">Phone</label>
                <input
                  value={newSupPhone}
                  onChange={(e) => setNewSupPhone(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") addNewSupplier(); }}
                  placeholder="e.g. 9876543210"
                  className="w-full rounded-lg border border-border bg-white px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
                />
              </div>
              <div className="space-y-1">
                <label className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">GSTIN</label>
                <input
                  value={newSupGstin}
                  onChange={(e) => setNewSupGstin(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") addNewSupplier(); }}
                  placeholder="e.g. 27AABCU9603R1ZM"
                  className="w-full rounded-lg border border-border bg-white px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
                />
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-2 border-t border-border">
              <button onClick={() => { setShowAddModal(false); setNewSupName(""); setNewSupPhone(""); setNewSupGstin(""); }} className="rounded-lg border border-border px-3 py-1.5 text-xs font-semibold text-muted-foreground hover:bg-secondary-soft transition">Cancel</button>
              <button onClick={addNewSupplier} disabled={savingNew || !newSupName.trim()} className="flex items-center gap-1 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-50 transition">
                {savingNew ? <Loader2 className="h-3 w-3 animate-spin" /> : <Plus className="h-3 w-3" />}
                {savingNew ? "Adding…" : "Add Supplier"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
});

// ---------- Product Name Autocomplete ----------
const ProductNameCombobox = memo(function ProductNameCombobox({
  value,
  onChange,
  categories,
  existingProducts,
}: {
  value: string;
  onChange: (val: string) => void;
  categories: { id: string; name: string }[];
  existingProducts: { id: string; name: string }[];
}) {
  const [inputVal, setInputVal] = useState(value || "");
  const [open, setOpen] = useState(false);
  const [highlightIdx, setHighlightIdx] = useState(-1);
  const inputRef = useRef<HTMLInputElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // Sync external value changes
  useEffect(() => { setInputVal(value || ""); }, [value]);

  // Build combined suggestion list: unique category names + product names
  const allSuggestions = useMemo(() => {
    const names = new Set<string>();
    // Add category names first (higher priority)
    for (const c of categories ?? []) {
      if (c.name?.trim()) names.add(c.name.trim());
    }
    // Add existing product names
    for (const p of existingProducts ?? []) {
      if (p.name?.trim()) names.add(p.name.trim());
    }
    return Array.from(names);
  }, [categories, existingProducts]);

  const filtered = useMemo(() => {
    const q = inputVal.trim().toLowerCase();
    if (!q) return allSuggestions;
    // Partial-word, case-insensitive matching
    return allSuggestions.filter((n) => n.toLowerCase().includes(q));
  }, [inputVal, allSuggestions]);

  const trimmedInput = inputVal.trim();
  const isExactMatch = trimmedInput.length > 0 && allSuggestions.some(
    (n) => n.toLowerCase() === trimmedInput.toLowerCase()
  );

  function select(name: string) {
    setInputVal(name);
    onChange(name);
    setOpen(false);
    setHighlightIdx(-1);
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (!open) {
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        setOpen(true);
      }
      return;
    }
    // Total items: filtered suggestions + optional "use this value" option
    const hasNewOption = trimmedInput.length > 0 && !isExactMatch;
    const totalItems = filtered.length + (hasNewOption ? 1 : 0);
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlightIdx((i) => (i + 1) % totalItems);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlightIdx((i) => (i - 1 + totalItems) % totalItems);
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (highlightIdx >= 0 && highlightIdx < filtered.length) {
        select(filtered[highlightIdx]);
      } else if (hasNewOption && highlightIdx === filtered.length) {
        select(trimmedInput);
      } else if (filtered.length === 1) {
        select(filtered[0]);
      } else if (hasNewOption) {
        select(trimmedInput);
      }
    } else if (e.key === "Escape") {
      setOpen(false);
      setHighlightIdx(-1);
    }
  }

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  return (
    <div ref={wrapperRef} className="relative">
      <input
        ref={inputRef}
        type="text"
        value={inputVal}
        onChange={(e) => {
          setInputVal(e.target.value);
          onChange(e.target.value);
          setHighlightIdx(-1);
          if (!open) setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={handleKeyDown}
        placeholder="Type to search or enter product name…"
        className="w-full rounded-lg border border-border bg-white px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
        autoComplete="off"
      />
      {open && (
        <div
          ref={listRef}
          className="absolute z-50 mt-1 w-full rounded-lg border border-border bg-white shadow-lg max-h-48 overflow-y-auto"
        >
          {filtered.length === 0 && !(trimmedInput.length > 0 && !isExactMatch) && (
            <div className="px-3 py-2 text-xs text-muted-foreground/70 italic">
              No matching materials found
            </div>
          )}
          {filtered.map((name, i) => (
            <button
              key={name}
              type="button"
              onMouseDown={(e) => {
                e.preventDefault();
                select(name);
              }}
              onMouseEnter={() => setHighlightIdx(i)}
              className={`w-full text-left px-3 py-2 text-sm transition ${
                highlightIdx === i ? "bg-primary/10 text-primary font-medium" : "hover:bg-secondary-soft"
              }`}
            >
              {name}
            </button>
          ))}
          {trimmedInput.length > 0 && !isExactMatch && (
            <button
              type="button"
              onMouseDown={(e) => {
                e.preventDefault();
                select(trimmedInput);
              }}
              onMouseEnter={() => setHighlightIdx(filtered.length)}
              className={`w-full text-left px-3 py-2 text-sm border-t border-border/50 transition ${
                highlightIdx === filtered.length ? "bg-primary/10 text-primary font-medium" : "hover:bg-secondary-soft"
              }`}
            >
              <span className="text-muted-foreground">Use new name: </span>
              <span className="font-semibold">{trimmedInput}</span>
            </button>
          )}
        </div>
      )}
    </div>
  );
});

// ---------- Category Combobox (typeahead searchable with + Add) ----------
const CategoryCombobox = memo(function CategoryCombobox({
  value,
  onChange,
  categories,
  onCategoryAdded,
}: {
  value: string;
  onChange: (val: string) => void;
  categories: { id: string; name: string }[];
  onCategoryAdded?: () => void;
}) {
  const [inputVal, setInputVal] = useState("");
  const [open, setOpen] = useState(false);
  const [highlightIdx, setHighlightIdx] = useState(-1);
  const [showAddModal, setShowAddModal] = useState(false);
  const [newCatName, setNewCatName] = useState("");
  const [savingNew, setSavingNew] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const qc = useQueryClient();

  // Compute display name from value (category_id)
  const displayName = useMemo(() => {
    if (!value) return "";
    const cat = categories?.find((c) => c.id === value);
    return cat?.name || value;
  }, [value, categories]);

  // Use displayName as the effective input value when dropdown is closed
  const effectiveInputVal = open ? inputVal : displayName;

  // Build suggestion list
  const allSuggestions = useMemo(() => {
    const names: string[] = [];
    for (const c of categories ?? []) {
      if (c.name?.trim()) names.push(c.name.trim());
    }
    return names;
  }, [categories]);

  const filtered = useMemo(() => {
    const q = effectiveInputVal.trim().toLowerCase();
    if (!q) return allSuggestions;
    return allSuggestions.filter((n) => n.toLowerCase().includes(q));
  }, [effectiveInputVal, allSuggestions]);

  const trimmedInput = effectiveInputVal.trim();
  const isExactMatch =
    trimmedInput.length > 0 &&
    allSuggestions.some((n) => n.toLowerCase() === trimmedInput.toLowerCase());

  function selectCategory(categoryId: string, categoryName: string) {
    setInputVal("");
    setOpen(false);
    setHighlightIdx(-1);
    onChange(categoryId);
  }

  async function addNewCategory() {
    if (!newCatName.trim()) return toast.error("Category name is required");
    // Check duplicate
    const dup = categories?.find((c) => c.name?.toLowerCase() === newCatName.trim().toLowerCase());
    if (dup) return toast.error("A category with this name already exists");
    setSavingNew(true);
    try {
      const slug = newCatName.trim().toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "");
      const { data: newCat, error } = await supabase
        .from("categories")
        .insert({ name: newCatName.trim(), slug })
        .select("id,name")
        .single();
      if (error) {
        console.error("[Purchases] Category insert error:", error);
        throw error;
      }
      if (!newCat) {
        console.error("[Purchases] Category insert returned no data — possible RLS issue");
        throw new Error("Category insert returned no data. Check your permissions.");
      }
      toast.success("Category added");
      qc.invalidateQueries({ queryKey: ["cats-lite"] });
      qc.invalidateQueries({ queryKey: ["admin-cats"] });
      if (onCategoryAdded) onCategoryAdded();
      // Auto-select the newly created category
      selectCategory(newCat.id, newCat.name);
      setShowAddModal(false);
      setNewCatName("");
    } catch (err) {
      console.error("[Purchases] Category save failed:", err);
      toast.error(err instanceof Error ? err.message : "Failed to add category");
    } finally {
      setSavingNew(false);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (!open) {
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        setOpen(true);
      }
      return;
    }
    // Layout: [Select (if value)] + filtered + [Add New (if custom input)]
    const hasSelectOption = value ? 1 : 0;
    const hasAddNew = trimmedInput.length > 0 && !isExactMatch ? 1 : 0;
    const totalItems = hasSelectOption + filtered.length + hasAddNew;

    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlightIdx((i) => (i + 1) % totalItems);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlightIdx((i) => (i - 1 + totalItems) % totalItems);
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (hasSelectOption && highlightIdx === 0) {
        selectCategory("", "");
      } else if (highlightIdx >= hasSelectOption && highlightIdx < hasSelectOption + filtered.length) {
        const catIdx = highlightIdx - hasSelectOption;
        const cat = categories?.find((c) => c.name === filtered[catIdx]);
        if (cat) selectCategory(cat.id, cat.name);
      } else if (hasAddNew && highlightIdx === hasSelectOption + filtered.length) {
        // Trigger the add new modal
        setNewCatName(trimmedInput);
        setShowAddModal(true);
        setOpen(false);
      } else if (filtered.length === 1) {
        const cat = categories?.find((c) => c.name === filtered[0]);
        if (cat) selectCategory(cat.id, cat.name);
      } else if (hasAddNew) {
        setNewCatName(trimmedInput);
        setShowAddModal(true);
        setOpen(false);
      }
    } else if (e.key === "Escape") {
      setOpen(false);
      setHighlightIdx(-1);
    }
  }

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  return (
    <>
      <div ref={wrapperRef} className="relative">
        <input
          ref={inputRef}
          type="text"
          value={effectiveInputVal}
          onChange={(e) => {
            setInputVal(e.target.value);
            setHighlightIdx(-1);
            if (!open) setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={handleKeyDown}
          placeholder="Type to search categories…"
          className="w-full rounded-lg border border-border bg-white px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
          autoComplete="off"
        />
        {open && (
          <div className="absolute z-50 mt-1 w-full rounded-lg border border-border bg-white shadow-lg max-h-60 overflow-hidden flex flex-col">
            <div className="flex items-center border-b px-3 shrink-0">
              <Search className="mr-2 h-4 w-4 shrink-0 opacity-50" />
              <input
                type="text"
                value={inputVal}
                onChange={(e) => {
                  setInputVal(e.target.value);
                  setHighlightIdx(-1);
                }}
                onKeyDown={handleKeyDown}
                placeholder="Search categories…"
                className="flex h-10 w-full bg-transparent py-3 text-sm outline-none placeholder:text-muted-foreground"
              />
            </div>
            <div className="max-h-52 overflow-y-auto p-1">
              {value && (
                <button
                  type="button"
                  onMouseDown={(e) => { e.preventDefault(); selectCategory("", ""); }}
                  onMouseEnter={() => setHighlightIdx(0)}
                  className={`w-full text-left px-3 py-2 text-sm transition ${highlightIdx === 0 ? "bg-primary/10 text-primary font-medium" : "hover:bg-secondary-soft"}`}
                >
                  <span className="text-muted-foreground">— Select —</span>
                </button>
              )}
              {filtered.map((name, i) => {
                const cat = categories?.find((c) => c.name === name);
                const isSelected = cat?.id === value;
                const idx = (value ? 1 : 0) + i;
                return (
                  <button
                    key={name}
                    type="button"
                    onMouseDown={(e) => { e.preventDefault(); if (cat) selectCategory(cat.id, cat.name); }}
                    onMouseEnter={() => setHighlightIdx(idx)}
                    className={`w-full text-left px-3 py-2 text-sm transition ${highlightIdx === idx ? "bg-primary/10 text-primary font-medium" : "hover:bg-secondary-soft"} ${isSelected ? "bg-secondary-soft" : ""}`}
                  >
                    {name}
                  </button>
                );
              })}
              {trimmedInput.length > 0 && !isExactMatch && (
                <button
                  type="button"
                  onMouseDown={(e) => {
                    e.preventDefault();
                    setNewCatName(trimmedInput);
                    setShowAddModal(true);
                    setOpen(false);
                  }}
                  onMouseEnter={() => setHighlightIdx((value ? 1 : 0) + filtered.length)}
                  className={`w-full text-left px-3 py-2 text-sm border-t border-border/50 transition ${highlightIdx === (value ? 1 : 0) + filtered.length ? "bg-emerald-50 text-emerald-700 font-medium" : "hover:bg-emerald-50"}`}
                >
                  <span className="text-emerald-600">+ Add new: </span>
                  <span className="font-semibold">{trimmedInput}</span>
                </button>
              )}
              {filtered.length === 0 && trimmedInput.length > 0 && !isExactMatch && (
                <div className="px-3 py-2 text-xs text-muted-foreground/70 italic">
                  No matching categories found
                </div>
              )}
            </div>
          </div>
        )}
      </div>
      {/* Inline Add Category Modal */}
      {showAddModal && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40" onMouseDown={() => { setShowAddModal(false); setNewCatName(""); }}>
          <div className="bg-white rounded-xl shadow-2xl border border-border w-full max-w-sm p-4 space-y-3" onMouseDown={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold text-foreground">Add New Category</h3>
              <button onClick={() => { setShowAddModal(false); setNewCatName(""); }} className="rounded p-1 hover:bg-muted">
                <X className="h-4 w-4 text-muted-foreground" />
              </button>
            </div>
            <input
              value={newCatName}
              onChange={(e) => setNewCatName(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") addNewCategory(); }}
              placeholder="Category name *"
              className="w-full rounded-lg border border-border bg-white px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
              autoFocus
            />
            <div className="flex justify-end gap-2">
              <button onClick={() => { setShowAddModal(false); setNewCatName(""); }} className="rounded-lg border border-border px-3 py-1.5 text-xs font-semibold text-muted-foreground hover:bg-secondary-soft transition">Cancel</button>
              <button onClick={addNewCategory} disabled={savingNew || !newCatName.trim()} className="flex items-center gap-1 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-50 transition">
                {savingNew ? <Loader2 className="h-3 w-3 animate-spin" /> : <Plus className="h-3 w-3" />}
                {savingNew ? "Adding…" : "Add Category"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
});

// ---------- Material Combobox (filtered by category, with + Add) ----------
const MaterialCombobox = memo(function MaterialCombobox({
  value,
  onChange,
  categoryId,
  materials,
  onMaterialAdded,
}: {
  value: string;
  onChange: (val: string) => void;
  categoryId: string;
  materials: { id: string; name: string; category_id: string | null }[];
  onMaterialAdded?: () => void;
}) {
  const [inputVal, setInputVal] = useState("");
  const [open, setOpen] = useState(false);
  const [highlightIdx, setHighlightIdx] = useState(-1);
  const [showAddModal, setShowAddModal] = useState(false);
  const [newMatName, setNewMatName] = useState("");
  const [savingNew, setSavingNew] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const qc = useQueryClient();

  // Filter materials by selected category
  const categoryMaterials = useMemo(() => {
    if (!categoryId) return [];
    return materials.filter((m) => m.category_id === categoryId);
  }, [materials, categoryId]);

  // Compute display name from value
  const displayName = useMemo(() => {
    if (!value) return "";
    const mat = materials.find((m) => m.id === value);
    return mat?.name || value;
  }, [value, materials]);

  // Sync input when value changes externally
  useEffect(() => {
    if (!open) {
      setInputVal(displayName);
    }
  }, [displayName, open]);

  // Build suggestion list from category materials
  const allSuggestions = useMemo(() => {
    const names: string[] = [];
    for (const m of categoryMaterials) {
      if (m.name?.trim()) names.push(m.name.trim());
    }
    return names;
  }, [categoryMaterials]);

  const filtered = useMemo(() => {
    const q = inputVal.trim().toLowerCase();
    if (!q) return allSuggestions;
    return allSuggestions.filter((n) => n.toLowerCase().includes(q));
  }, [inputVal, allSuggestions]);

  const trimmedInput = inputVal.trim();
  const isExactMatch =
    trimmedInput.length > 0 &&
    allSuggestions.some((n) => n.toLowerCase() === trimmedInput.toLowerCase());

  function selectMaterial(materialId: string, materialName: string) {
    onChange(materialId);
    setInputVal(materialName);
    setOpen(false);
    setHighlightIdx(-1);
  }

  async function addNewMaterial() {
    if (!newMatName.trim()) return toast.error("Material name is required");
    if (!categoryId) return toast.error("Please select a category first");
    // Check duplicate
    const dup = materials?.find(
      (m) => m.name?.toLowerCase() === newMatName.trim().toLowerCase() && m.category_id === categoryId
    );
    if (dup) return toast.error("A material with this name already exists in this category");
    setSavingNew(true);
    try {
      const { data: newMat, error } = await supabase
        .from("materials")
        .insert({ name: newMatName.trim(), category_id: categoryId, is_active: true })
        .select("id,name")
        .single();
      if (error) {
        console.error("[Purchases] Material insert error:", error);
        throw error;
      }
      if (!newMat) {
        console.error("[Purchases] Material insert returned no data — possible RLS issue");
        throw new Error("Material insert returned no data. Check your permissions.");
      }
      toast.success("Material added");
      qc.invalidateQueries({ queryKey: ["materials-lite"] });
      qc.invalidateQueries({ queryKey: ["admin-materials"] });
      if (onMaterialAdded) onMaterialAdded();
      selectMaterial(newMat.id, newMat.name);
      setShowAddModal(false);
      setNewMatName("");
    } catch (err) {
      console.error("[Purchases] Material save failed:", err);
      toast.error(err instanceof Error ? err.message : "Failed to add material");
    } finally {
      setSavingNew(false);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (!open) {
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        setOpen(true);
      }
      return;
    }
    const hasSelectOption = value ? 1 : 0;
    const hasAddNew = trimmedInput.length > 0 && !isExactMatch ? 1 : 0;
    const totalItems = hasSelectOption + filtered.length + hasAddNew;

    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlightIdx((i) => (i + 1) % totalItems);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlightIdx((i) => (i - 1 + totalItems) % totalItems);
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (hasSelectOption && highlightIdx === 0) {
        selectMaterial("", "");
      } else if (highlightIdx >= hasSelectOption && highlightIdx < hasSelectOption + filtered.length) {
        const matIdx = highlightIdx - hasSelectOption;
        const mat = categoryMaterials.find((m) => m.name === filtered[matIdx]);
        if (mat) selectMaterial(mat.id, mat.name);
      } else if (hasAddNew && highlightIdx === hasSelectOption + filtered.length) {
        setNewMatName(trimmedInput);
        setShowAddModal(true);
        setOpen(false);
      } else if (filtered.length === 1) {
        const mat = categoryMaterials.find((m) => m.name === filtered[0]);
        if (mat) selectMaterial(mat.id, mat.name);
      } else if (hasAddNew) {
        setNewMatName(trimmedInput);
        setShowAddModal(true);
        setOpen(false);
      }
    } else if (e.key === "Escape") {
      setOpen(false);
      setHighlightIdx(-1);
    }
  }

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  return (
    <>
      <div ref={wrapperRef} className="relative">
        <input
          ref={inputRef}
          type="text"
          value={inputVal}
          onChange={(e) => {
            setInputVal(e.target.value);
            setHighlightIdx(-1);
            if (!open) setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={handleKeyDown}
          placeholder={categoryId ? "Type to search materials…" : "Select category first…"}
          disabled={!categoryId}
          className="w-full rounded-lg border border-border bg-white px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary disabled:bg-muted/50 disabled:cursor-not-allowed"
          autoComplete="off"
        />
        {open && categoryId && (
          <div className="absolute z-50 mt-1 w-full rounded-lg border border-border bg-white shadow-lg max-h-60 overflow-hidden flex flex-col">
            <div className="flex items-center border-b px-3 shrink-0">
              <Search className="mr-2 h-4 w-4 shrink-0 opacity-50" />
              <input
                type="text"
                value={inputVal}
                onChange={(e) => { setInputVal(e.target.value); setHighlightIdx(-1); }}
                onKeyDown={handleKeyDown}
                placeholder="Search materials…"
                className="flex h-10 w-full bg-transparent py-3 text-sm outline-none placeholder:text-muted-foreground"
              />
            </div>
            <div className="max-h-52 overflow-y-auto p-1">
              {value && (
                <button type="button" onMouseDown={(e) => { e.preventDefault(); selectMaterial("", ""); }}
                  onMouseEnter={() => setHighlightIdx(0)}
                  className={`w-full text-left px-3 py-2 text-sm transition ${highlightIdx === 0 ? "bg-primary/10 text-primary font-medium" : "hover:bg-secondary-soft"}`}>
                  <span className="text-muted-foreground">— Select —</span>
                </button>
              )}
              {filtered.map((name, i) => {
                const mat = categoryMaterials.find((m) => m.name === name);
                const isSelected = mat?.id === value;
                const idx = (value ? 1 : 0) + i;
                return (
                  <button key={name} type="button"
                    onMouseDown={(e) => { e.preventDefault(); if (mat) selectMaterial(mat.id, mat.name); }}
                    onMouseEnter={() => setHighlightIdx(idx)}
                    className={`w-full text-left px-3 py-2 text-sm transition ${highlightIdx === idx ? "bg-primary/10 text-primary font-medium" : "hover:bg-secondary-soft"} ${isSelected ? "bg-secondary-soft" : ""}`}>
                    {name}
                  </button>
                );
              })}
              {trimmedInput.length > 0 && !isExactMatch && (
                <button type="button"
                  onMouseDown={(e) => { e.preventDefault(); setNewMatName(trimmedInput); setShowAddModal(true); setOpen(false); }}
                  onMouseEnter={() => setHighlightIdx((value ? 1 : 0) + filtered.length)}
                  className={`w-full text-left px-3 py-2 text-sm border-t border-border/50 transition ${highlightIdx === (value ? 1 : 0) + filtered.length ? "bg-emerald-50 text-emerald-700 font-medium" : "hover:bg-emerald-50"}`}>
                  <span className="text-emerald-600">+ Add new: </span>
                  <span className="font-semibold">{trimmedInput}</span>
                </button>
              )}
              {filtered.length === 0 && trimmedInput.length > 0 && !isExactMatch && (
                <div className="px-3 py-2 text-xs text-muted-foreground/70 italic">No matching materials found</div>
              )}
            </div>
          </div>
        )}
      </div>
      {/* Inline Add Material Modal */}
      {showAddModal && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40" onMouseDown={() => { setShowAddModal(false); setNewMatName(""); }}>
          <div className="bg-white rounded-xl shadow-2xl border border-border w-full max-w-sm p-4 space-y-3" onMouseDown={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold text-foreground">Add New Material</h3>
              <button onClick={() => { setShowAddModal(false); setNewMatName(""); }} className="rounded p-1 hover:bg-muted">
                <X className="h-4 w-4 text-muted-foreground" />
              </button>
            </div>
            {!categoryId && <p className="text-xs text-amber-600">Please select a category first.</p>}
            <input
              value={newMatName}
              onChange={(e) => setNewMatName(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") addNewMaterial(); }}
              placeholder="Material name *"
              className="w-full rounded-lg border border-border bg-white px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
              disabled={!categoryId}
              autoFocus
            />
            <div className="flex justify-end gap-2">
              <button onClick={() => { setShowAddModal(false); setNewMatName(""); }} className="rounded-lg border border-border px-3 py-1.5 text-xs font-semibold text-muted-foreground hover:bg-secondary-soft transition">Cancel</button>
              <button onClick={addNewMaterial} disabled={savingNew || !newMatName.trim() || !categoryId} className="flex items-center gap-1 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-50 transition">
                {savingNew ? <Loader2 className="h-3 w-3 animate-spin" /> : <Plus className="h-3 w-3" />}
                {savingNew ? "Adding…" : "Add Material"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
});

// ---------- Component ----------
function Purchases() {
  const qc = useQueryClient();
  const [rows, setRows] = useState<ProductRow[]>([]);
  const [searchQ, setSearchQ] = useState("");
  const [uploading, setUploading] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [editingIdx, setEditingIdx] = useState<number | null>(null);
  const [activeDraftId, setActiveDraftId] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<DraftEntry[]>([]);
  const [showDrafts, setShowDrafts] = useState(false);
  const [slotTotals, setSlotTotals] = useState<Record<string, number>>({});

  // Add New Slot modal state
  const [showAddSlotModal, setShowAddSlotModal] = useState(false);
  const [addSlotIdx, setAddSlotIdx] = useState<number | null>(null);
  const [newSlotName, setNewSlotName] = useState("");
  const [newSlotTotalAmount, setNewSlotTotalAmount] = useState(0);
  const [newSlotTotalUnits, setNewSlotTotalUnits] = useState(0);
  const [newSlotNotes, setNewSlotNotes] = useState("");
  const [savingNewSlot, setSavingNewSlot] = useState(false);

  // Listen for custom event to open add-slot modal
  useEffect(() => {
    function handleOpenAddSlot(e: Event) {
      const detail = (e as CustomEvent).detail;
      setAddSlotIdx(detail?.idx ?? null);
      setNewSlotName("");
      setNewSlotTotalAmount(0);
      setNewSlotTotalUnits(0);
      setNewSlotNotes("");
      setShowAddSlotModal(true);
    }
    window.addEventListener("open-add-slot", handleOpenAddSlot);
    return () => window.removeEventListener("open-add-slot", handleOpenAddSlot);
  }, []);

  // Function to save a new slot from inline modal
  async function saveNewSlotInline() {
    if (!newSlotName.trim()) return toast.error("Slot name is required");
    if (newSlotTotalUnits <= 0) return toast.error("Total slot units must be greater than 0");
    // Check duplicate
    const dup = (slotsList ?? []).find((s) => s.name?.toLowerCase() === newSlotName.trim().toLowerCase());
    if (dup) return toast.error("A slot with this name already exists");
    setSavingNewSlot(true);
    try {
      const totalAmount = Number(newSlotTotalAmount) || 0;
      const totalUnits = Number(newSlotTotalUnits) || 0;
      const payload = {
        name: newSlotName.trim(),
        total_charges: totalAmount,
        packing_charges: totalAmount,
        freight_charges: 0,
        other_charges: 0,
        total_quantity: totalUnits,
        notes: newSlotNotes.trim() || null,
        is_active: true,
      };
      const { data: newSlot, error } = await supabase.from("slots").insert(payload).select("id,name,packing_charges,freight_charges,other_charges,total_quantity,total_charges").single();
      if (error) {
        console.error("[Purchases] Slot insert error:", error);
        throw error;
      }
      if (!newSlot) {
        console.error("[Purchases] Slot insert returned no data — possible RLS issue");
        throw new Error("Slot insert returned no data. Check your permissions.");
      }
      toast.success("Slot created");
      qc.invalidateQueries({ queryKey: ["slots"] });
      qc.invalidateQueries({ queryKey: ["slots-lite"] });
      // Auto-select the new slot in the row
      if (addSlotIdx !== null && addSlotIdx >= 0 && addSlotIdx < rows.length) {
        const slotPerUnit = totalUnits > 0 ? totalAmount / totalUnits : 0;
        const productQty = Number(rows[addSlotIdx]?.quantity) || 0;
        const totalPF = Math.round(slotPerUnit * productQty * 100) / 100;
        patchRow(addSlotIdx, {
          slot_id: newSlot.id,
          slot_total_charge: totalAmount,
          slot_charge_per_product: totalPF,
          purchase_packing_freight_charge: Math.round(slotPerUnit * 100) / 100,
        });
      }
      setShowAddSlotModal(false);
      setNewSlotName("");
      setNewSlotTotalAmount(0);
      setNewSlotTotalUnits(0);
      setNewSlotNotes("");
    } catch (err) {
      console.error("[Purchases] Slot save failed:", err);
      toast.error(err instanceof Error ? err.message : "Failed to create slot");
    } finally {
      setSavingNewSlot(false);
    }
  }

  const rowsRef = useRef(rows);
  rowsRef.current = rows;

  // Re-Stock: read URL param and pre-fill product
  const { restock: restockId } = useSearch({ from: "/admin/purchases" });
  useEffect(() => {
    if (!restockId) return;
    const rid: string = restockId;
    async function loadRestock() {
      const { data: product } = await supabase
        .from("products")
        .select("id,name,barcode,category_id,price,purchase_price,stock,reorder_level,unit,image_urls,color_variations")
        .eq("id", rid)
        .single();
      if (!product) return toast.error("Product not found");
      const catName = product.category_id
        ? (categories ?? []).find((c: { id: string; name: string }) => c.id === product.category_id)?.name ??
          (categories ?? []).find((c: { id: string; name: string }) => c.name.toLowerCase() === (product.category_id ?? "").toLowerCase())?.name ??
          product.category_id
        : null;
      const assignedGst = autoAssignGst(product.name ?? "", catName, undefined, null);
      const newRow = {
        ...blankRow(1),
        id: product.id,
        name: product.name ?? "",
        barcode: product.barcode ?? "",
        category_id: product.category_id ?? "",
        gst_rate: assignedGst,
        gst_is_custom: false,
        retail_selling_price: Number(product.price ?? 0),
        unit_price: Number(product.purchase_price ?? 0),
        current_stock: Number(product.stock ?? 0),
        minimum_stock: Number(product.reorder_level ?? 5),
        per_packet_unit: product.unit ?? "Nos",
        image_url: product.image_urls?.[0] ?? "",
        color_variants: Array.isArray(product.color_variations)
          ? (product.color_variations as any[]).map((v: any) => ({
              _id: uid(),
              color_name: v.color || "",
              color_code: v.color_code || "",
              color_image: v.image_url || "",
              quantity: Number(v.quantity) || 0,
            }))
          : [],
      };
      setRows([newRow]);
      setEditingIdx(0);
      setFormOpen(true);
      toast.success(`Loaded for re-stocking: ${product.name}`);
    }
    loadRestock();
  }, [restockId]);

  // Reference data
  const { data: suppliers } = useQuery({
    queryKey: ["suppliers-lite"],
    queryFn: async () => (await supabase.from("suppliers").select("id,name").order("name")).data ?? [],
  });
  const { data: categories } = useQuery({
    queryKey: ["cats-lite"],
    queryFn: async () => (await supabase.from("categories").select("id,name")).data ?? [],
  });

  // Existing products for search
  const { data: existingProducts } = useQuery({
    queryKey: ["purchase-products"],
    queryFn: async () =>
      (
        await supabase
          .from("products")
          .select("id,barcode,name,category_id,stock,reorder_level,unit,price,purchase_price,image_urls,sku,color_variations")
          .order("created_at", { ascending: false })
      ).data ?? [],
  });

  // Materials for material autocomplete (filtered by category in component)
  const { data: allMaterials } = useQuery({
    queryKey: ["materials-lite"],
    queryFn: async () =>
      (
        await supabase
          .from("materials")
          .select("id,name,category_id")
          .eq("is_active", true)
          .order("name")
      ).data ?? [],
  });

  // Slots for slot selection
  const { data: slotsList } = useQuery({
    queryKey: ["slots-lite"],
    queryFn: async () =>
      (
        await supabase
          .from("slots")
          .select("id,name,total_charges,packing_charges,freight_charges,other_charges,total_quantity")
          .eq("is_active", true)
          .order("name")
      ).data ?? [],
  });

  // Load drafts on mount
  useEffect(() => {
    setDrafts(loadDrafts());
  }, []);

  // Fetch recent purchase data via useQuery
  const { data: recentPurchaseData } = useQuery({
    queryKey: ["recent-purchase-load"],
    enabled: !restockId,
    queryFn: async () => {
      // 1. Get most recent purchase
      const { data: purchase } = await supabase
        .from("purchases")
        .select("id, supplier_id")
        .order("created_at", { ascending: false })
        .limit(1)
        .single();
      if (!purchase) return null;

      // 2. Get supplier name
      let supplierName = "";
      if (purchase.supplier_id) {
        const { data: sup } = await supabase
          .from("suppliers")
          .select("name")
          .eq("id", purchase.supplier_id)
          .single();
        supplierName = sup?.name ?? "";
      }

      // 3. Get purchase items
      const { data: items } = await supabase
        .from("purchase_items")
        .select("product_id, quantity, unit_cost, slot_number, slot_charge_per_product, unit")
        .eq("purchase_id", purchase.id);
      if (!items || items.length === 0) return null;

      // 4. Get product details
      const productIds = [...new Set(items.map((i) => i.product_id).filter(Boolean))];
      if (productIds.length === 0) return null;

      const { data: products } = await supabase
        .from("products")
        .select("id, name, barcode, category_id, price, purchase_price, stock, reorder_level, unit, image_urls, color_variations")
        .in("id", productIds);

      return { items, products: products ?? [], supplierName };
    },
  });

  // Apply recent purchase data to rows
  useEffect(() => {
    if (!recentPurchaseData || rows.length > 0) return;
    const { items, products: productList, supplierName } = recentPurchaseData;
    const productMap = new Map(productList.map((p: any) => [p.id, p]));

    const mappedRows: ProductRow[] = items.map((item: any, i: number) => {
      const product = productMap.get(item.product_id);
      const catName = product?.category_id
        ? (categories ?? []).find((c) => c.id === product.category_id)?.name ?? product.category_id
        : null;
      const assignedGst = autoAssignGst(product?.name ?? "", catName, undefined, null);
      return {
        ...blankRow(i + 1),
        id: item.product_id ?? "",
        barcode: product?.barcode ?? "",
        name: product?.name ?? "",
        category_id: product?.category_id ?? "",
        supplier_name: supplierName,
        gst_rate: assignedGst,
        gst_is_custom: false,
        current_stock: Number(product?.stock ?? 0),
        minimum_stock: Number(product?.reorder_level ?? 5),
        per_packet_unit: item.unit ?? product?.unit ?? "Nos",
        unit_price: Number(item.unit_cost ?? product?.purchase_price ?? 0),
        retail_selling_price: Number(product?.price ?? 0),
        quantity: Number(item.quantity ?? 1),
        slot_id: item.slot_number ?? "",
        slot_charge_per_product: Number(item.slot_charge_per_product ?? 0),
        image_url: product?.image_urls?.[0] ?? "",
        color_variants: Array.isArray(product?.color_variations)
          ? (product.color_variations as any[]).map((v: any) => ({
              _id: uid(),
              color_name: v.color || "",
              color_code: v.color_code || "",
              color_image: v.image_url || "",
              quantity: Number(v.quantity) || 0,
            }))
          : [],
      };
    });
    setRows(mappedRows);
  }, [recentPurchaseData, categories]);

  // Save as Draft function
  const saveAsDraft = useCallback(() => {
    if (rows.length === 0) return toast.error("No products to save");
    const draftId = activeDraftId || uid();
    // Ensure all fields are preserved by merging with blankRow defaults
    const safeRows = rows.map((r) => ({ ...blankRow(r.serial), ...r }));
    const draft: DraftEntry = {
      draft_id: draftId,
      created_at: activeDraftId ? (drafts.find((d) => d.draft_id === draftId)?.created_at || new Date().toISOString()) : new Date().toISOString(),
      updated_at: new Date().toISOString(),
      rows: recalcAllSlotCharges(safeRows, slotsList ?? []),
      slot_totals: slotTotals,
      label: makeDraftLabel(rows),
    };
    saveDraft(draft);
    setActiveDraftId(draftId);
    setDrafts(loadDrafts());
    toast.success("Draft saved successfully");
  }, [rows, activeDraftId, drafts, slotTotals]);

  // Load a draft
  const loadDraftEntry = useCallback((draftId: string) => {
    const draft = loadDraft(draftId);
    if (!draft) return toast.error("Draft not found");
    setRows(draft.rows);
    setSlotTotals(draft.slot_totals || {});
    setActiveDraftId(draft.draft_id);
    setShowDrafts(false);
    setFormOpen(false);
    setEditingIdx(null);
    toast.success("Draft loaded");
  }, []);

  // Delete a draft
  const deleteDraftEntry = useCallback((draftId: string) => {
    deleteDraft(draftId);
    setDrafts(loadDrafts());
    if (activeDraftId === draftId) setActiveDraftId(null);
    toast.success("Draft deleted");
  }, [activeDraftId]);

  // New Purchase Entry (clear everything)
  const newPurchaseEntry = useCallback(() => {
    setRows([]);
    setActiveDraftId(null);
    setSlotTotals({});
    setFormOpen(false);
    setEditingIdx(null);
  }, []);

  const filteredProducts = useMemo(() => {
    if (!searchQ.trim()) return [];
    const q = searchQ.toLowerCase();
    return (existingProducts ?? []).filter(
      (p) =>
        p.name?.toLowerCase().includes(q) ||
        p.barcode?.toLowerCase().includes(q) ||
        p.sku?.toLowerCase().includes(q),
    );
  }, [searchQ, existingProducts]);

  const calculatedRows = useMemo(() => rows.map(calcRow), [rows]);

  const grandTotals = useMemo(() => {
    return calculatedRows.reduce(
      (acc, r) => ({
        total_price: acc.total_price + r.total_price,
        final_purchase_cost: acc.final_purchase_cost + r.final_purchase_cost,
        total_final: acc.total_final + r.total_final,
        gst: acc.gst + r.gst_amount,
        discount: acc.discount + r.discount_amount,
        total_packing_freight: acc.total_packing_freight + (r.slot_charge_per_product || 0),
        total_quantity: acc.total_quantity + (Number(r.quantity) || 0),
        total_other_charges: acc.total_other_charges + (Number(r.other_charges) || 0),
      }),
      { total_price: 0, final_purchase_cost: 0, total_final: 0, gst: 0, discount: 0, total_packing_freight: 0, total_quantity: 0, total_other_charges: 0 },
    );
  }, [calculatedRows]);

  const patchRow = useCallback((idx: number, patch: Partial<ProductRow>) => {
    setRows((prev) => {
      let next = prev.map((r, i) => (i === idx ? { ...r, ...patch } : r));

      // Auto-assign GST when category_id or name changes (unless user explicitly set gst_rate)
      if (patch.category_id !== undefined || patch.name !== undefined) {
        const row = next[idx];
        const catName = row.category_id
          ? (categories ?? []).find((c: { id: string; name: string }) => c.id === row.category_id)?.name ??
            (categories ?? []).find((c: { id: string; name: string }) => c.name.toLowerCase() === (row.category_id ?? "").toLowerCase())?.name ??
            row.category_id
          : null;
        // Only auto-assign if the user hasn't manually overridden GST (i.e., gst_rate wasn't in the patch)
        if (patch.gst_rate === undefined) {
          const autoRate = autoAssignGst(row.name ?? "", catName, undefined, null);
          if (autoRate > 0 && (row.gst_rate === 0 || row.gst_rate === null || row.gst_rate === undefined)) {
            next[idx] = { ...next[idx], gst_rate: autoRate, gst_is_custom: false };
          }
        }
      }
      // Auto-recalculate slot charge when quantity changes (if slot is assigned)
      if (patch.quantity !== undefined) {
        const row = next[idx];
        if (row.slot_id) {
          const slot = (slotsList ?? []).find((s) => s.id === row.slot_id);
          if (slot) {
            const totalCharges = (slot.packing_charges ?? 0) + (slot.freight_charges ?? 0) + (slot.other_charges ?? 0);
            const perUnit = (slot.total_quantity ?? 1) > 0 ? totalCharges / (slot.total_quantity ?? 1) : 0;
            const qty = Number(row.quantity) || 0;
            const totalPF = Math.round(perUnit * qty * 100) / 100;
            // purchase_packing_freight_charge = per-unit cost, slot_charge_per_product = total charges
            next[idx] = { ...next[idx], purchase_packing_freight_charge: Math.round(perUnit * 100) / 100, slot_charge_per_product: totalPF };
          }
        }
      }
      // Handle slot changes: recalculate charges for affected slots
      if (patch.slot_id !== undefined || patch.slot_total_charge !== undefined) {
        const row = prev[idx];
        const newSlotId = patch.slot_id !== undefined ? patch.slot_id : row.slot_id;
        const newTotalCharge = patch.slot_total_charge !== undefined ? patch.slot_total_charge : row.slot_total_charge;

        // If slot_id changed, recalculate both old and new slots
        if (patch.slot_id !== undefined && patch.slot_id !== row.slot_id) {
          // Recalculate old slot if it exists
          if (row.slot_id) {
            const oldProducts = next.filter((r) => r.slot_id === row.slot_id);
            if (oldProducts.length > 0) {
              const oldTotalCharge = oldProducts[0].slot_total_charge || 0;
              const oldSlot = (slotsList ?? []).find((s) => s.id === row.slot_id);
              next = recalcSlotCharges(next, row.slot_id, oldTotalCharge, getSlotPerUnitCost(oldSlot));
            }
          }
          // Update slot totals map
          if (newSlotId) {
            const existingProducts = next.filter((r) => r.slot_id === newSlotId);
            const newSlot = (slotsList ?? []).find((s) => s.id === newSlotId);
            const newPerUnit = getSlotPerUnitCost(newSlot);
            if (existingProducts.length <= 1) {
              next = recalcSlotCharges(next, newSlotId, newTotalCharge || 0, newPerUnit);
            } else {
              const existingTotal = existingProducts[0].slot_total_charge || 0;
              next = recalcSlotCharges(next, newSlotId, existingTotal, newPerUnit);
            }
          }
        } else if (patch.slot_total_charge !== undefined) {
          // Only total charge changed - recalculate this slot
          if (newSlotId) {
            const changedSlot = (slotsList ?? []).find((s) => s.id === newSlotId);
            next = recalcSlotCharges(next, newSlotId, newTotalCharge || 0, getSlotPerUnitCost(changedSlot));
          }
        }
      }
      return next;
    });
  }, [slotsList]);

  useEffect(() => { _patchRowRef = patchRow; }, [patchRow]);

  const handleImageUpload = useCallback(async (idx: number, file: File) => {
    if (!file.type.startsWith("image/")) return toast.error("Select an image file");
    if (file.size > 5 * 1024 * 1024) return toast.error("Image must be less than 5MB");
    setUploading(rowsRef.current[idx]._rowId);
    try {
      const url = await uploadProductImage(file);
      patchRow(idx, { image_url: url });
      toast.success("Image uploaded");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploading(null);
    }
  }, [patchRow]);

  useEffect(() => { _handleImageUploadRef = handleImageUpload; }, [handleImageUpload]);
  useEffect(() => { _uploadingRef = uploading; }, [uploading]);

  function addProduct() {
    const newIdx = rows.length;
    setRows((prev) => [...prev, blankRow(prev.length + 1)]);
    setEditingIdx(newIdx);
    setFormOpen(true);
  }

  function editProduct(idx: number) {
    setEditingIdx(idx);
    setFormOpen(true);
  }

  function cancelForm() {
    // Remove blank row if it was a new product with no name (only if no slot assigned)
    if (editingIdx !== null) {
      const row = rows[editingIdx];
      if (row && !row.name.trim() && !row.id && !row.slot_id) {
        setRows((prev) => {
          const next = prev.filter((_, i) => i !== editingIdx);
          return next.map((r, i) => ({ ...r, serial: i + 1 }));
        });
      }
    }
    setFormOpen(false);
    setEditingIdx(null);
  }

  function deleteRow(idx: number) {
    setRows((prev) => {
      const deletedRow = prev[idx];
      let next = prev.filter((_, i) => i !== idx);
      next = next.map((r, i) => ({ ...r, serial: i + 1 }));

      // Recalculate slot charges for the deleted row's slot
      if (deletedRow?.slot_id) {
        const slotProducts = next.filter((r) => r.slot_id === deletedRow.slot_id);
        if (slotProducts.length > 0) {
          const totalCharge = slotProducts[0].slot_total_charge || 0;
          const delSlot = (slotsList ?? []).find((s) => s.id === deletedRow.slot_id);
          next = recalcSlotCharges(next, deletedRow.slot_id, totalCharge, getSlotPerUnitCost(delSlot));
        }
      }
      return next;
    });
    if (editingIdx === idx) {
      setFormOpen(false);
      setEditingIdx(null);
    }
  }

  // Save single product
  async function saveProduct() {
    if (editingIdx === null) return;
    const row = calculatedRows[editingIdx];
    if (!row.name.trim()) return toast.error("Product name is required");
    setSaving(true);
    try {
      // Auto-create supplier if it's a new name
      if (row.supplier_name?.trim()) {
        const { data: existingSuppliers } = await supabase
          .from("suppliers")
          .select("id")
          .ilike("name", row.supplier_name.trim());
        if (!existingSuppliers?.length) {
          const { data: newSup, error: supErr } = await supabase
            .from("suppliers")
            .insert({ name: row.supplier_name.trim() })
            .select("id")
            .single();
          if (supErr) {
            console.error("[Purchases] Supplier auto-create error:", supErr);
            // Don't block product save for supplier failure — just log it
          } else {
            qc.invalidateQueries({ queryKey: ["suppliers-lite"] });
          }
        }
      }

      const slug = row.name
        .toLowerCase()
        .replace(/\s+/g, "-")
        .replace(/[^a-z0-9-]/g, "");
      const productPayload = {
        name: row.name.trim(),
        slug,
        barcode: row.barcode || null,
        sku: row.barcode || null,
        category_id: row.category_id || null,
        price: Number(row.retail_selling_price) || 0,
        purchase_price: Number(row.unit_price) || 0,
        stock: Math.round(Number(row.current_stock) || 0),
        reorder_level: Math.round(Number(row.minimum_stock) || 5),
        unit: row.per_packet_unit || "Nos",
        image_urls: row.image_url ? [row.image_url] : [],
        color: row.colour || null,
        is_available: (Number(row.current_stock) || 0) > 0,
        color_variations: (row.color_variants || []).map((v) => ({
          color: v.color_name || v.color_code || "",
          color_code: v.color_code || "",
          image_url: v.color_image || "",
          quantity: Math.round(Number(v.quantity) || 0),
          sold: 0,
          remaining: Math.round(Number(v.quantity) || 0),
        })),
      };

      if (row.id) {
        const { error: updateErr } = await supabase.from("products").update(productPayload).eq("id", row.id);
        if (updateErr) {
          console.error("[Purchases] Product update error:", updateErr);
          throw updateErr;
        }
      } else {
        const { data: newProduct, error: insertErr } = await supabase
          .from("products")
          .insert(productPayload)
          .select("id")
          .single();
        if (insertErr) {
          console.error("[Purchases] Product insert error:", insertErr);
          throw insertErr;
        }
        if (newProduct) {
          patchRow(editingIdx, { id: newProduct.id });
        }
      }
      toast.success("Product saved successfully");
      setFormOpen(false);
      setEditingIdx(null);
      qc.invalidateQueries();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  }

  // ---- Submit full purchase to backend (products + slots) ----
  async function submitPurchase() {
    if (rows.length === 0) return toast.error("No products to submit");
    const named = rows.filter((r) => r.name.trim());
    if (named.length === 0) return toast.error("At least one product must have a name");
    setSaving(true);
    try {
      const recalcRows = recalcAllSlotCharges(rows, slotsList ?? []);

      // Group products by supplier for the purchase record
      const supplierName = recalcRows.find((r) => r.supplier_name?.trim())?.supplier_name?.trim() || "";
      let supplierId: string | null = null;
      if (supplierName) {
        const { data: existing } = await supabase.from("suppliers").select("id").ilike("name", supplierName).limit(1);
        if (existing?.length) {
          supplierId = existing[0].id;
        } else {
          const { data: newSup, error: supInsertErr } = await supabase.from("suppliers").insert({ name: supplierName }).select("id").single();
          if (supInsertErr) {
            console.error("[Purchases] Supplier auto-create error:", supInsertErr);
            throw new Error("Failed to create supplier: " + supInsertErr.message);
          }
          if (newSup) {
            supplierId = newSup.id;
            qc.invalidateQueries({ queryKey: ["suppliers-lite"] });
          }
        }
      }

      // Calculate total combined packing/freight charge (exclude slot-assigned products to avoid double-counting with slot charges)
      const totalCombinedCharge = recalcRows
        .filter((r) => !r.slot_id)
        .reduce((sum, r) => sum + (Number(r.purchase_packing_freight_charge) || 0), 0);

      // Build items JSON for the RPC
      const items = recalcRows.map((r) => ({
        product_id: r.id || null,
        name: r.name.trim(),
        sku: r.barcode || null,
        category_id: r.category_id || null,
        brand_id: null,
        color: r.colour || null,
        size: null,
        unit_cost: Number(r.unit_price) || 0,
        selling_price: Number(r.retail_selling_price) || 0,
        quantity: Math.round(Number(r.quantity) || 1),
        slot_number: r.slot_id || null,
        color_variations: (r.color_variants || []).map((v) => ({
          color: v.color_name || v.color_code || "",
          color_code: v.color_code || "",
          image_url: v.color_image || "",
          quantity: Number(v.quantity) || 0,
          sold: 0,
          remaining: Number(v.quantity) || 0,
        })),
      }));

      // Call the create RPC
      const { data: purchaseId, error: rpcErr } = await supabase.rpc("create_purchase_with_products", {
        _items: items,
        _supplier_id: supplierId || undefined,
        _invoice_no: recalcRows[0]?.supplier_bill_no || undefined,
        _purchase_date: recalcRows[0]?.date || new Date().toISOString().slice(0, 10),
        _notes: undefined,
        _purchase_packing_freight_charge: totalCombinedCharge,
      });

      if (rpcErr) throw rpcErr;
      if (!purchaseId) throw new Error("Failed to create purchase");

      // Persist slot charges via upsert_purchase_slot for each unique slot
      const slotIds = getSlotIds(recalcRows);
      for (const slotId of slotIds) {
        const totalCharge = getSlotTotalCharge(recalcRows, slotId);
        const { error: slotErr } = await supabase.rpc("upsert_purchase_slot", {
          _purchase_id: purchaseId,
          _slot_number: slotId,
          _total_slot_charge: totalCharge,
        });
        if (slotErr) console.error("Slot save error:", slotErr);
      }

      toast.success(`Purchase submitted! ${recalcRows.length} products saved.`);
      setRows([]);
      setActiveDraftId(null);
      setSlotTotals({});
      setFormOpen(false);
      setEditingIdx(null);
      qc.invalidateQueries();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to submit purchase");
    } finally {
      setSaving(false);
    }
  }

  // ---- Export to CSV ----
  function exportCSV() {
    const headers = [
      "S.No", "Barcode", "Supplier Name", "Supplier Bill No", "Category", "Date",
      "Product Name", "Material", "Colour", "Per Packet Value", "Per Packet Unit", "Total Unit", "Total Unit Type", "Qty", "Unit Price", "Total Price",
      "Purchase, Packing & Freight Charges", "Slot", "Slot Charge (Per Product)", "Other Charges", "Total Unit Cost",
      "Final Purchase Cost", "Retail Selling Price", "Wholesale Price", "Profit %",
      "Min Stock", "Current Stock",
      "Rack Location", "Del Packing Amt", "Del Charge Amt", "Re Stock",
      "GST %", "GST Amt", "Discount Type", "Discount %", "Discount Amount", "Total Final",
      "Payment", "Remark", "MRP", "MOP",
    ];
    const csvRows = calculatedRows.map((r) => [
      r.serial, r.barcode, r.supplier_name, r.supplier_bill_no, r.category_id, r.date,
      r.name, r.material, r.colour, r.per_packet_value, r.per_packet_unit, r.total_unit, r.total_unit_type, r.quantity, r.unit_price,
      r.total_price, r.purchase_packing_freight_charge,
      r.slot_id, r.slot_charge_per_product,
      r.other_charges, r.total_unit_cost, r.final_purchase_cost, r.retail_selling_price,
      r.wholesale_price, r.profit_per_piece_pct,
      r.minimum_stock, r.current_stock, r.rack_location,
      r.delivery_packing_charge, r.delivery_charge, r.re_stock,
      r.gst_rate, r.gst_amount, r.discount_type, r.discount_pct, r.discount_amount, r.total_final,
      r.cash_received_by, r.remark, r.mrp, r.mop,
    ]);
    const csv = [headers.join(","), ...csvRows.map((r) => r.join(","))].join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `purchase-entry-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success("Exported to CSV");
  }

  // ---- Import from CSV ----
  function importCSV(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = ev.target?.result as string;
      const lines = text.split("\n").filter(Boolean);
      if (lines.length < 2) return toast.error("No data rows found");
      const newRows: ProductRow[] = [];
      for (let i = 1; i < lines.length; i++) {
        const cols = lines[i].split(",");
        if (!cols[6]?.trim()) continue;
        newRows.push({
          ...blankRow(newRows.length + 1),
          barcode: cols[1] ?? "",
          supplier_name: cols[2] ?? "",
          supplier_bill_no: cols[3] ?? "",
          category_id: cols[4] ?? "",
          date: cols[5] ?? new Date().toISOString().slice(0, 10),
          name: cols[6] ?? "",
          material: cols[7] ?? "",
          colour: cols[8] ?? "",
          per_packet_unit: cols[9] ?? "Nos",
          quantity: Number(cols[11]) || 1,
          unit_price: Number(cols[12]) || 0,
          purchase_packing_freight_charge: (Number(cols[14]) || 0) + (Number(cols[15]) || 0),
          other_charges: Number(cols[16]) || 0,
          retail_selling_price: Number(cols[19]) || 0,
          wholesale_price: Number(cols[20]) || 0,
          minimum_stock: Number(cols[23]) || 5,
          current_stock: Number(cols[24]) || 0,
          rack_location: cols[25] ?? "",
          cash_received_by: cols[32] ?? "",
          remark: cols[33] ?? "",
          mrp: Number(cols[34]) || 0,
          mop: Number(cols[35]) || 0,
        });
      }
      if (!newRows.length) return toast.error("No valid rows found in CSV");
      setRows(newRows);
      toast.success(`Imported ${newRows.length} rows`);
    };
    reader.readAsText(file);
    e.target.value = "";
  }

  // Form definitions for the purchase entry form
  const FORM_FIELDS: { key: string; label: string; type: string; ro?: boolean; unitField?: string }[] = [
    { key: "slot_id", label: "Slot", type: "select-slot-auto" },
    { key: "barcode", label: "Barcode", type: "text" },
    { key: "supplier_name", label: "Supplier Name", type: "select-supplier" },
    { key: "supplier_bill_no", label: "Supplier Bill Number", type: "text" },
    { key: "category_id", label: "Craft Material Category", type: "select-category" },
    { key: "image_url", label: "Image", type: "image" },
    { key: "date", label: "Date", type: "date" },
    { key: "name", label: "Product Name", type: "select-product-name" },
    { key: "material", label: "Material", type: "select-material" },
    { key: "colour", label: "Colour", type: "text" },
    { key: "per_packet_value", label: "Per Packet Value", type: "unit-pair", unitField: "per_packet_unit" },
    { key: "total_unit", label: "Total Unit", type: "unit-pair", unitField: "total_unit_type" },
    { key: "quantity", label: "Quantity", type: "number" },
    { key: "unit_price", label: "Unit Price", type: "number" },
    { key: "total_price", label: "Total Price", type: "number", ro: true },
    { key: "purchase_packing_freight_charge", label: "Per Unit Packing & Freight Cost (₹)", type: "number" },
    { key: "slot_charge_per_product", label: "Total Packing & Freight Charges (₹)", type: "number", ro: true },
    { key: "other_charges", label: "Other Charges", type: "number" },
    { key: "total_unit_cost", label: "Total Unit Cost", type: "number", ro: true },
    { key: "final_purchase_cost", label: "Final Purchase Cost", type: "number", ro: true },
    { key: "retail_profit_pct", label: "Retail Profit %", type: "number" },
    { key: "retail_selling_price", label: "Retail Selling Price", type: "number", ro: true },
    { key: "wholesale_profit_pct", label: "Wholesale Profit %", type: "number" },
    { key: "wholesale_price", label: "Wholesale Selling Price", type: "number", ro: true },
    { key: "profit_per_piece_pct", label: "Profit Per Piece %", type: "number", ro: true },
    { key: "minimum_stock", label: "Minimum Stock", type: "number" },
    { key: "current_stock", label: "Current Stock", type: "number" },
    { key: "rack_location", label: "Rack Location", type: "text" },
    { key: "delivery_packing_charge", label: "Packing Charge (Total)", type: "number" },
    { key: "delivery_charge", label: "Delivery Charge (Total)", type: "number" },
    { key: "per_unit_delivery_packing", label: "Packing Charge / Unit", type: "number", ro: true },
    { key: "per_unit_delivery", label: "Delivery Charge / Unit", type: "number", ro: true },
    { key: "per_unit_total_charges", label: "Total Charges / Unit", type: "number", ro: true },
    { key: "re_stock", label: "Re Stock", type: "number" },
    { key: "gst_rate", label: "GST %", type: "select-gst" },
    { key: "gst_amount", label: "GST Amount", type: "number", ro: true },
    { key: "discount_type", label: "Discount Type", type: "select-discount-type" },
    { key: "discount_pct", label: "Discount %", type: "number" },
    { key: "discount_amount", label: "Discount Amount (₹)", type: "number", ro: true },
    { key: "total_final", label: "Final Price (₹)", type: "number", ro: true },
    { key: "cash_received_by", label: "Cash Received By (UPI/CASH/GPAY)", type: "select-payment" },
    { key: "remark", label: "Remark", type: "text" },
    { key: "mrp", label: "MRP (Maximum Retail Price)", type: "number" },
    { key: "mop", label: "MOP (Market Operating Price)", type: "number" },
  ];

  function renderFieldInput(
    idx: number,
    fieldDef: { key: string; label: string; type: string; ro?: boolean; unitField?: string },
    row: ProductRow
  ) {
    const field = fieldDef.key as keyof ProductRow;
    switch (fieldDef.type) {
      case "select-product-name":
        return (
          <ProductNameCombobox
            value={String(row[field] || "")}
            onChange={(val) => patchRow(idx, { name: val })}
            categories={categories ?? []}
            existingProducts={existingProducts ?? []}
          />
        );
      case "select-supplier":
        return (
          <SupplierCombobox
            value={String(row[field] || "")}
            onChange={(val) => patchRow(idx, { supplier_name: val })}
            suppliers={suppliers ?? []}
            onSupplierAdded={() => {
              qc.invalidateQueries({ queryKey: ["suppliers-lite"] });
              qc.invalidateQueries({ queryKey: ["sup"] });
            }}
          />
        );
      case "select-discount-type":
        return (
          <select
            value={String(row.discount_type || "amount")}
            onChange={(e) => patchRow(idx, { discount_type: e.target.value as "amount" | "percentage" })}
            className="w-full rounded-lg border border-border bg-white px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
          >
            <option value="amount">₹ Amount</option>
            <option value="percentage">% Percentage</option>
          </select>
        );
      case "select-gst":
        return (
          <div className="space-y-1.5">
            <div className="flex items-center gap-1">
              <Percent className="h-3.5 w-3.5 text-muted-foreground/60 shrink-0" />
              <select
                value={row.gst_is_custom ? "others" : String(Number(row.gst_rate) || 0)}
                onChange={(e) => {
                  const val = e.target.value;
                  if (val === "others") {
                    patchRow(idx, { gst_is_custom: true, gst_rate: row.gst_rate || 0 });
                  } else {
                    patchRow(idx, { gst_is_custom: false, gst_rate: Number(val) });
                  }
                }}
                className="w-full rounded-lg border border-border bg-white px-2 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
              >
                {GST_RATES.map((r) => (
                  <option key={r} value={r}>{r}% — {GST_RATE_LABELS[r]?.split("—")[1]?.trim() || r}</option>
                ))}
                <option value="others">Others — Custom %</option>
              </select>
            </div>
            {row.gst_is_custom && (
              <div className="flex items-center gap-1.5">
                <span className="text-[10px] font-semibold text-muted-foreground whitespace-nowrap">Enter GST %:</span>
                <input
                  type="number"
                  min="0"
                  max="100"
                  step="0.1"
                  value={String(row.gst_rate || "")}
                  onChange={(e) => {
                    const v = Math.min(Math.max(Number(e.target.value) || 0, 0), 100);
                    patchRow(idx, { gst_rate: v });
                  }}
                  placeholder="e.g. 2.5"
                  className="flex-1 rounded-lg border border-primary/30 bg-primary/5 px-2 py-1.5 text-sm outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary text-right font-semibold"
                />
              </div>
            )}
          </div>
        );
      case "select-category":
        return (
          <CategoryCombobox
            value={String(row[field] || "")}
            onChange={(val) => patchRow(idx, { category_id: val, material: "" })}
            categories={categories ?? []}
            onCategoryAdded={() => {
              qc.invalidateQueries({ queryKey: ["cats-lite"] });
              qc.invalidateQueries({ queryKey: ["admin-cats"] });
            }}
          />
        );
      case "select-material":
        return (
          <MaterialCombobox
            value={String(row.material || "")}
            onChange={(val) => patchRow(idx, { material: val })}
            categoryId={String(row.category_id || "")}
            materials={allMaterials ?? []}
            onMaterialAdded={() => {
              qc.invalidateQueries({ queryKey: ["materials-lite"] });
              qc.invalidateQueries({ queryKey: ["admin-materials"] });
            }}
          />
        );
      case "select-slot-auto": {
        // Auto-calculate packing & freight based on slot's per-unit charge and product quantity
        const currentSlotId = String(row.slot_id || "");
        const selectedSlot = (slotsList ?? []).find((s) => s.id === currentSlotId);
        const qty = Number(row.quantity) || 0;
        const perUnitPackingFreight = selectedSlot
          ? (((selectedSlot.packing_charges ?? 0) + (selectedSlot.freight_charges ?? 0) + (selectedSlot.other_charges ?? 0)) /
             (selectedSlot.total_quantity ?? 1))
          : 0;
        const totalPackingFreight = Math.round(perUnitPackingFreight * qty * 100) / 100;

        return (
          <div className="space-y-1">
            <div className="flex gap-1.5">
              <select
                value={currentSlotId}
                onChange={(e) => {
                  const val = e.target.value;
                  if (val === "__add_new__") {
                    // Trigger add new slot modal via custom event
                    window.dispatchEvent(new CustomEvent("open-add-slot", { detail: { idx } }));
                    return;
                  }
                  const slot = (slotsList ?? []).find((s) => s.id === val);
                  const slotPerUnit = slot
                    ? (((slot.packing_charges ?? 0) + (slot.freight_charges ?? 0) + (slot.other_charges ?? 0)) /
                       (slot.total_quantity ?? 1))
                    : 0;
                  const productQty = Number(row.quantity) || 0;
                  const totalPF = Math.round(slotPerUnit * productQty * 100) / 100;
                  patchRow(idx, {
                    slot_id: val,
                    slot_total_charge: slot?.total_charges ?? 0,
                    slot_charge_per_product: totalPF,
                    purchase_packing_freight_charge: Math.round(slotPerUnit * 100) / 100,
                  });
                }}
                className="flex-1 rounded-lg border border-border bg-white px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
              >
                <option value="">— no slot —</option>
                {(slotsList ?? []).map((s) => {
                  const sPerUnit = ((s.packing_charges ?? 0) + (s.freight_charges ?? 0) + (s.other_charges ?? 0)) / (s.total_quantity ?? 1);
                  return (
                    <option key={s.id} value={s.id}>
                      {s.name} (₹{sPerUnit.toFixed(2)}/unit)
                    </option>
                  );
                })}
                <option value="__add_new__">+ Add New Slot</option>
              </select>
            </div>
            {selectedSlot && (
              <div className="mt-1 p-2 rounded-lg bg-primary/5 border border-primary/20 space-y-1">
                <div className="flex items-center justify-between text-[11px]">
                  <span className="text-muted-foreground">Per Unit Packing & Freight Cost</span>
                  <span className="font-bold text-primary">₹{perUnitPackingFreight.toFixed(2)}</span>
                </div>
                {qty > 0 && (
                  <div className="flex items-center justify-between text-[11px]">
                    <span className="text-muted-foreground">Total Packing & Freight ({qty} × ₹{perUnitPackingFreight.toFixed(2)})</span>
                    <span className="font-bold text-foreground">₹{totalPackingFreight.toFixed(2)}</span>
                  </div>
                )}
              </div>
            )}
          </div>
        );
      }
      case "select-slot": {
        const existingSlots = getSlotIds(rows);
        const currentSlotId = String(row.slot_id || "");
        const isFirstInSlot = currentSlotId && rows.filter((r) => r.slot_id === currentSlotId).length <= 1;
        return (
          <div className="flex gap-2">
            <select
              value={currentSlotId}
              onChange={(e) => {
                const val = e.target.value;
                if (val === "__new__") {
                  // Create new slot
                  const newSlotNum = existingSlots.length + 1;
                  const newSlotId = `slot-${newSlotNum}`;
                  patchRow(idx, { slot_id: newSlotId, slot_total_charge: 0, slot_charge_per_product: 0 });
                } else {
                  patchRow(idx, { slot_id: val });
                }
              }}
              className="flex-1 rounded-lg border border-border bg-white px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
            >
              <option value="">— no slot —</option>
              {existingSlots.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
              <option value="__new__">+ Create New Slot</option>
            </select>
            {currentSlotId && (
              <span className="flex items-center gap-1 rounded-lg bg-primary/10 px-2 py-1 text-[10px] font-bold text-primary whitespace-nowrap">
                {currentSlotId}
              </span>
            )}
          </div>
        );
      }
      case "slot-charge": {
        const slotId = String(row.slot_id || "");
        if (!slotId) {
          return (
            <input
              type="number"
              value=""
              disabled
              placeholder="Select a slot first"
              className="w-full rounded-lg border border-border bg-muted/30 px-3 py-2 text-sm text-right outline-none cursor-not-allowed text-muted-foreground"
            />
          );
        }
        // Check if this is the first product in the slot
        const productsInSlot = rows.filter((r) => r.slot_id === slotId);
        const isFirstProduct = productsInSlot.length <= 1 || productsInSlot[0]._rowId === row._rowId;
        if (isFirstProduct) {
          // First product: allow manual entry of total slot charge
          return (
            <div className="space-y-1">
              <input
                type="number"
                defaultValue={String(row.slot_total_charge || "")}
                onChange={(e) => {
                  const v = Number(e.target.value) || 0;
                  patchRow(idx, { slot_total_charge: v });
                }}
                className="w-full rounded-lg border border-primary/30 bg-primary/5 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary text-right font-semibold"
                step="0.01"
                placeholder="Total slot charge"
              />
              <div className="text-[10px] text-muted-foreground text-right">
                Per product: ₹{row.slot_charge_per_product?.toFixed(2) || "0.00"} ({productsInSlot.length} product{productsInSlot.length !== 1 ? "s" : ""})
              </div>
            </div>
          );
        }
        // Subsequent products: show auto-calculated amount (read-only)
        return (
          <div className="space-y-1">
            <input
              type="number"
              value={String(row.slot_charge_per_product?.toFixed(2) || "")}
              readOnly
              className="w-full rounded-lg border border-border bg-muted/50 px-3 py-2 text-sm font-semibold text-right outline-none cursor-default"
            />
            <div className="text-[10px] text-primary font-semibold text-right">
              Auto-calculated • {productsInSlot.length} products in {slotId}
            </div>
          </div>
        );
      }
      case "select-unit":
        return (
          <UnitCell row={row} field={field} options={UNITS} idx={idx} />
        );
      case "unit-pair": {
        const unitField = fieldDef.unitField as keyof ProductRow;
        // Auto-calculated total_unit: read-only when per_packet_value is provided
        const isAutoTotalUnit = field === "total_unit" && Number(row.per_packet_value) > 0;
        return (
          <div className="flex gap-2">
            {isAutoTotalUnit ? (
              <input
                type="number"
                value={String(row[field] ?? "")}
                readOnly
                className="flex-1 rounded-lg border border-primary/30 bg-primary/5 px-3 py-2 text-sm font-semibold text-right outline-none cursor-default"
                step="0.01"
              />
            ) : (
              <input
                type="number"
                defaultValue={String(row[field] ?? "")}
                onChange={(e) => {
                  const v = Number(e.target.value) || 0;
                  patchRow(idx, { [field]: v });
                }}
                className="flex-1 rounded-lg border border-border bg-white px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary text-right"
                step="0.01"
                placeholder="Value"
              />
            )}
            <select
              value={String(row[unitField] || "Nos")}
              onChange={(e) => patchRow(idx, { [unitField]: e.target.value })}
              className="w-28 rounded-lg border border-border bg-white px-2 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
            >
              {UNITS.map((o) => (
                <option key={o} value={o}>{o}</option>
              ))}
            </select>
          </div>
        );
      }
      case "select-payment":
        return (
          <select
            value={String(row[field])}
            onChange={(e) => patchRow(idx, { [field]: e.target.value })}
            className="w-full rounded-lg border border-border bg-white px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
          >
            {PAYMENT_METHODS.map((o) => (
              <option key={o} value={o}>{o}</option>
            ))}
          </select>
        );
      case "image":
        return (
          <div className="flex items-center gap-2">
            {row[field] ? (
              <div className="relative">
                <img src={String(row[field])} alt="" className="h-12 w-12 rounded-lg object-cover border border-border" />
                <button
                  onClick={() => patchRow(idx, { image_url: "" })}
                  className="absolute -right-1.5 -top-1.5 h-5 w-5 rounded-full bg-rose-500 text-white grid place-items-center shadow"
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            ) : null}
            <label className="cursor-pointer text-muted-foreground/60 hover:text-primary transition">
              <input
                type="file"
                accept="image/*"
                className="sr-only"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) _handleImageUploadRef?.(idx, f);
                }}
              />
              {_uploadingRef === row._rowId ? (
                <Loader2 className="h-5 w-5 animate-spin" />
              ) : (
                <ImageIcon className="h-5 w-5" />
              )}
            </label>
          </div>
        );
      case "date":
        return (
          <input
            type="date"
            value={String(row[field] ?? "")}
            onChange={(e) => patchRow(idx, { [field]: e.target.value })}
            className="w-full rounded-lg border border-border bg-white px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
          />
        );
      case "number":
        if (fieldDef.ro) {
          return (
            <input
              type="number"
              value={String(row[field] ?? "")}
              readOnly
              className="w-full rounded-lg border border-border bg-muted/50 px-3 py-2 text-sm font-semibold text-right outline-none cursor-default"
            />
          );
        }
        // Auto-read-only for Purchase, Packing & Freight Charges when product is in a slot
        if (field === "purchase_packing_freight_charge" && row.slot_id) {
          return (
            <div className="space-y-1">
              <input
                type="number"
                value={String(row[field] ?? "")}
                readOnly
                className="w-full rounded-lg border border-primary/30 bg-primary/5 px-3 py-2 text-sm font-semibold text-right outline-none cursor-default"
              />
              <div className="text-[10px] text-primary font-semibold text-right">
                Auto from {row.slot_id} • Per unit
              </div>
            </div>
          );
        }
        // Auto-read-only for Total Packing & Freight Charges when product is in a slot
        if (field === "slot_charge_per_product" && row.slot_id) {
          return (
            <div className="space-y-1">
              <input
                type="number"
                value={String(row[field] ?? "")}
                readOnly
                className="w-full rounded-lg border border-primary/30 bg-primary/5 px-3 py-2 text-sm font-semibold text-right outline-none cursor-default"
              />
              <div className="text-[10px] text-primary font-semibold text-right">
                = {Number(row.quantity) || 0} × ₹{(Number(row.purchase_packing_freight_charge) || 0).toFixed(2)}
              </div>
            </div>
          );
        }
        return (
          <input
            type="number"
            defaultValue={String(row[field] ?? "")}
            onChange={(e) => {
              const v = Number(e.target.value) || 0;
              patchRow(idx, { [field]: v });
            }}
            className="w-full rounded-lg border border-border bg-white px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary text-right"
            step="0.01"
          />
        );
      default:
        return (
          <input
            type="text"
            defaultValue={String(row[field] ?? "")}
            onChange={(e) => patchRow(idx, { [field]: e.target.value })}
            className="w-full rounded-lg border border-border bg-white px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
          />
        );
    }
  }

  const activeRow = editingIdx !== null ? calculatedRows[editingIdx] : null;

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-bold text-foreground flex-1">
          Purchase Entry
          {activeDraftId && (
            <span className="ml-2 inline-flex items-center gap-1 rounded-full bg-amber-100 px-2.5 py-0.5 text-[10px] font-bold text-amber-700 uppercase tracking-wider">
              Draft
            </span>
          )}
        </h1>
        <div className="flex items-center gap-2 rounded-lg border border-border bg-white px-3 py-1.5 shadow-sm">
          <Search className="h-4 w-4 text-muted-foreground/70" />
          <input
            value={searchQ}
            onChange={(e) => setSearchQ(e.target.value)}
            placeholder="Search existing products…"
            className="bg-transparent text-sm outline-none w-48"
          />
        </div>
        {rows.length > 0 && (
          <>
            <button
              onClick={submitPurchase}
              disabled={saving}
              className="flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-2 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-50 transition"
            >
              {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
              {saving ? "Submitting…" : "Submit Purchase"}
            </button>
            <button
              onClick={saveAsDraft}
              className="flex items-center gap-1.5 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-700 hover:bg-amber-100 transition"
            >
              <Save className="h-3.5 w-3.5" /> Save Draft
            </button>
          </>
        )}
        <button
          onClick={newPurchaseEntry}
          className="flex items-center gap-1.5 rounded-lg border border-border bg-white px-3 py-2 text-xs font-semibold text-muted-foreground hover:bg-secondary-soft"
        >
          <Plus className="h-3.5 w-3.5" /> New Entry
        </button>
        <label className="flex items-center gap-1.5 rounded-lg border border-border bg-white px-3 py-2 text-xs font-semibold text-muted-foreground cursor-pointer hover:bg-secondary-soft">
          <Upload className="h-3.5 w-3.5" /> Import CSV
          <input type="file" accept=".csv" className="sr-only" onChange={importCSV} />
        </label>
        <button
          onClick={exportCSV}
          className="flex items-center gap-1.5 rounded-lg border border-border bg-white px-3 py-2 text-xs font-semibold text-muted-foreground hover:bg-secondary-soft"
        >
          <Download className="h-3.5 w-3.5" /> Export CSV
        </button>
        <button
          onClick={() => qc.invalidateQueries()}
          className="flex items-center gap-1.5 rounded-lg border border-border bg-white px-3 py-2 text-xs font-semibold text-muted-foreground hover:bg-secondary-soft"
        >
          <Search className="h-3.5 w-3.5" /> Refresh
        </button>
      </div>

      {/* Drafts Panel */}
      {drafts.length > 0 && !formOpen && (
        <div className="rounded-xl border border-border bg-white shadow-sm overflow-hidden">
          <button
            onClick={() => setShowDrafts(!showDrafts)}
            className="w-full flex items-center justify-between px-4 py-2.5 text-xs font-semibold text-muted-foreground hover:bg-secondary-soft/30 transition"
          >
            <span className="flex items-center gap-2">
              <Save className="h-3.5 w-3.5" />
              Saved Drafts ({drafts.length})
            </span>
            <span className="text-[10px]">{showDrafts ? "▲ Hide" : "▼ Show"}</span>
          </button>
          {showDrafts && (
            <div className="border-t border-border divide-y divide-border/50">
              {drafts.map((d) => (
                <div key={d.draft_id} className="flex items-center justify-between px-4 py-2.5 hover:bg-secondary-soft/20 transition">
                  <div className="flex-1 min-w-0">
                    <div className="text-xs font-semibold text-foreground truncate">{d.label}</div>
                    <div className="text-[10px] text-muted-foreground">
                      {d.rows.length} product{d.rows.length !== 1 ? "s" : ""} · Updated {new Date(d.updated_at).toLocaleDateString()}
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <button
                      onClick={() => loadDraftEntry(d.draft_id)}
                      className="rounded-lg bg-primary/10 px-3 py-1 text-[10px] font-bold text-primary hover:bg-primary/20 transition"
                    >
                      Load & Edit
                    </button>
                    <button
                      onClick={() => deleteDraftEntry(d.draft_id)}
                      className="rounded-lg p-1 hover:bg-rose-50 transition"
                      title="Delete draft"
                    >
                      <Trash2 className="h-3.5 w-3.5 text-rose-500" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Product search results dropdown */}
      {searchQ.trim() && filteredProducts.length > 0 && (
        <div className="rounded-xl border border-border bg-white shadow-lg p-2 max-h-60 overflow-y-auto">
          <div className="text-[10px] font-semibold text-muted-foreground uppercase px-2 mb-1">
            Existing products — click to load
          </div>
          {filteredProducts.slice(0, 20).map((p) => (
            <button
              key={p.id}
              onClick={() => {
                const newIdx = rows.length;
                const catName = p.category_id
                  ? (categories ?? []).find((c: { id: string; name: string }) => c.id === p.category_id)?.name ??
                    (categories ?? []).find((c: { id: string; name: string }) => c.name.toLowerCase() === (p.category_id ?? "").toLowerCase())?.name ??
                    p.category_id
                  : null;
                const assignedGst = autoAssignGst(p.name ?? "", catName, undefined, null);
                setRows((prev) => [...prev, {
                  ...blankRow(prev.length + 1),
                  id: p.id,
                  barcode: p.barcode ?? "",
                  name: p.name ?? "",
                  category_id: p.category_id ?? "",
                  gst_rate: assignedGst,
                  gst_is_custom: false,
                  current_stock: p.stock ?? 0,
                  minimum_stock: p.reorder_level ?? 5,
                  per_packet_unit: p.unit ?? "Nos",
                  retail_selling_price: Number(p.price ?? 0),
                  unit_price: Number(p.purchase_price ?? 0),
                  image_url: p.image_urls?.[0] ?? "",
                  color_variants: Array.isArray(p.color_variations)
                    ? (p.color_variations as any[]).map((v: any) => ({
                        _id: uid(),
                        color_name: v.color || "",
                        color_code: v.color_code || "",
                        color_image: v.image_url || "",
                        quantity: Number(v.quantity) || 0,
                      }))
                    : [],
                }]);
                setEditingIdx(newIdx);
                setFormOpen(true);
                setSearchQ("");
                toast.success(`Loaded: ${p.name}`);
              }}
              className="flex items-center gap-3 w-full px-2 py-1.5 rounded-lg hover:bg-secondary-soft text-left"
            >
              <div className="flex-1 min-w-0">
                <div className="text-xs font-semibold text-foreground truncate">{p.name}</div>
                <div className="text-[10px] text-muted-foreground">
                  {p.barcode || "No barcode"} · Stock: {p.stock} · ₹{p.price}
                </div>
              </div>
            </button>
          ))}
        </div>
      )}

      {/* ====== INLINE PRODUCT ENTRY FORM ====== */}
      {formOpen && activeRow && (
        <div className="rounded-xl border-2 border-primary/30 bg-white shadow-card overflow-hidden">
          {/* Form Header */}
          <div className="flex items-center justify-between px-4 py-3 bg-primary/5 border-b border-border">
            <div className="flex items-center gap-3">
              <button onClick={cancelForm} className="rounded-lg p-1 hover:bg-secondary-soft transition" title="Back to list">
                <ChevronLeft className="h-5 w-5 text-muted-foreground" />
              </button>
              <h2 className="text-sm font-bold text-primary">
                {activeRow.id ? `Edit Product ${String(activeRow.serial).padStart(2, "0")}` : `Add Product ${String(activeRow.serial).padStart(2, "0")}`}
                {activeRow.slot_id && (
                  <span className="ml-2 inline-flex items-center rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-bold text-primary">
                    {activeRow.slot_id}
                  </span>
                )}
              </h2>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={cancelForm}
                className="rounded-lg border border-border px-3 py-1.5 text-xs font-semibold text-muted-foreground hover:bg-secondary-soft transition"
              >
                Cancel
              </button>
              <button
                onClick={saveProduct}
                disabled={saving || !activeRow.name.trim()}
                className="flex items-center gap-1.5 rounded-lg bg-primary px-4 py-1.5 text-xs font-semibold text-white hover:bg-primary/90 disabled:opacity-50 transition"
              >
                {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
                {saving ? "Saving…" : "Save Product"}
              </button>
            </div>
          </div>

          {/* 38-Field Continuous Form */}
          <div className="p-4">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
              {FORM_FIELDS.map((f) => (
                <div key={f.key} className="space-y-1">
                  <Label className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">
                    {f.label}
                  </Label>
                  {renderFieldInput(editingIdx!, f, activeRow)}
                </div>
              ))}
            </div>

            {/* ===== COLOR / VARIANT MANAGEMENT ===== */}
            <div className="mt-4 pt-3 border-t border-border">
              <div className="flex items-center justify-between mb-3">
                <div>
                  <h3 className="text-sm font-bold text-foreground">Color / Variants</h3>
                  <p className="text-[10px] text-muted-foreground">
                    Add multiple colors with individual quantities. Total quantity will be auto-calculated.
                  </p>
                </div>
                <button
                  onClick={() => {
                    const variants = activeRow.color_variants || [];
                    patchRow(editingIdx!, {
                      color_variants: [
                        ...variants,
                        { _id: uid(), color_name: "", color_code: "", color_image: "", quantity: 0 },
                      ],
                    });
                  }}
                  className="flex items-center gap-1 rounded-lg bg-primary/10 px-3 py-1.5 text-xs font-semibold text-primary hover:bg-primary/20 transition"
                >
                  <Plus className="h-3.5 w-3.5" /> Add Color
                </button>
              </div>

              {/* Variant total display */}
              {(activeRow.color_variants?.length ?? 0) > 0 && (
                <div className="mb-3 flex items-center gap-4 rounded-lg bg-muted/50 p-2">
                  <span className="text-[11px] font-semibold text-muted-foreground">
                    Variants: {activeRow.color_variants?.length ?? 0}
                  </span>
                  <span className="text-[11px] font-semibold text-primary">
                    Total Qty: {activeRow.color_variants?.reduce((s, v) => s + (Number(v.quantity) || 0), 0) ?? 0}
                  </span>
                </div>
              )}

              {/* Variant rows */}
              {(activeRow.color_variants?.length ?? 0) > 0 && (
                <div className="space-y-2">
                  {activeRow.color_variants!.map((variant, vi) => (
                    <div
                      key={variant._id}
                      className="flex flex-wrap items-end gap-2 rounded-lg border border-border bg-muted/30 p-3"
                    >
                      <div className="flex-1 min-w-[120px] space-y-1">
                        <Label className="text-[10px] font-semibold text-muted-foreground">Color Name</Label>
                        <input
                          value={variant.color_name}
                          onChange={(e) => {
                            const variants = [...activeRow.color_variants!];
                            variants[vi] = { ...variants[vi], color_name: e.target.value };
                            patchRow(editingIdx!, { color_variants: variants });
                          }}
                          placeholder="e.g. White"
                          className="w-full rounded-lg border border-border bg-white px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
                        />
                      </div>
                      <div className="flex-1 min-w-[100px] space-y-1">
                        <Label className="text-[10px] font-semibold text-muted-foreground">Color Code</Label>
                        <input
                          value={variant.color_code}
                          onChange={(e) => {
                            const variants = [...activeRow.color_variants!];
                            variants[vi] = { ...variants[vi], color_code: e.target.value };
                            patchRow(editingIdx!, { color_variants: variants });
                          }}
                          placeholder="e.g. WH01"
                          className="w-full rounded-lg border border-border bg-white px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
                        />
                      </div>
                      <div className="w-24 space-y-1">
                        <Label className="text-[10px] font-semibold text-muted-foreground">Qty</Label>
                        <input
                          type="number"
                          min={0}
                          value={variant.quantity || ""}
                          onChange={(e) => {
                            const variants = [...activeRow.color_variants!];
                            variants[vi] = { ...variants[vi], quantity: Number(e.target.value) || 0 };
                            patchRow(editingIdx!, { color_variants: variants });
                          }}
                          className="w-full rounded-lg border border-border bg-white px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary text-right"
                        />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-[10px] font-semibold text-muted-foreground">Image</Label>
                        <div className="flex items-center gap-1">
                          {variant.color_image ? (
                            <div className="relative">
                              <img src={variant.color_image} alt="" className="h-9 w-9 rounded-lg object-cover border border-border" />
                              <button
                                onClick={() => {
                                  const variants = [...activeRow.color_variants!];
                                  variants[vi] = { ...variants[vi], color_image: "" };
                                  patchRow(editingIdx!, { color_variants: variants });
                                }}
                                className="absolute -right-1 -top-1 h-4 w-4 rounded-full bg-rose-500 text-white grid place-items-center shadow"
                              >
                                <X className="h-2.5 w-2.5" />
                              </button>
                            </div>
                          ) : null}
                          <label className="cursor-pointer text-muted-foreground/60 hover:text-primary transition">
                            <input
                              type="file"
                              accept="image/*"
                              className="sr-only"
                              onChange={async (e) => {
                                const f = e.target.files?.[0];
                                if (!f) return;
                                setUploading(variant._id);
                                try {
                                  const url = await uploadProductImage(f);
                                  const variants = [...activeRow.color_variants!];
                                  variants[vi] = { ...variants[vi], color_image: url };
                                  patchRow(editingIdx!, { color_variants: variants });
                                  toast.success("Color image uploaded");
                                } catch (err) {
                                  toast.error(err instanceof Error ? err.message : "Upload failed");
                                } finally {
                                  setUploading(null);
                                  e.target.value = "";
                                }
                              }}
                            />
                            {uploading === variant._id ? (
                              <Loader2 className="h-5 w-5 animate-spin" />
                            ) : (
                              <ImageIcon className="h-5 w-5" />
                            )}
                          </label>
                        </div>
                      </div>
                      <button
                        onClick={() => {
                          const variants = activeRow.color_variants!.filter((_, k) => k !== vi);
                          patchRow(editingIdx!, { color_variants: variants });
                        }}
                        className="rounded p-1.5 hover:bg-rose-50 text-rose-500 mb-0.5"
                        title="Remove color"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  ))}
                </div>
              )}

              {(activeRow.color_variants?.length ?? 0) === 0 && (
                <div className="rounded-lg border border-dashed border-border p-4 text-center text-xs text-muted-foreground/70">
                  No color variants added. Click "Add Color" to manage multiple colors for this product.
                </div>
              )}
            </div>

            {/* ===== SALES SUMMARY ===== */}
            {activeRow && activeRow.name && (
              <div className="mt-4 pt-3 border-t border-border">
                <h3 className="text-sm font-bold text-foreground mb-3">Sales Summary</h3>
                <div className="rounded-lg border border-border bg-muted/30 p-4 space-y-3">
                  {/* Per Product Summary */}
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
                    <div>
                      <span className="text-[10px] text-muted-foreground uppercase">Product</span>
                      <div className="font-semibold text-foreground">{activeRow.name}</div>
                    </div>
                    <div>
                      <span className="text-[10px] text-muted-foreground uppercase">Quantity</span>
                      <div className="font-semibold text-foreground">{activeRow.quantity || 0} units</div>
                    </div>
                    <div>
                      <span className="text-[10px] text-muted-foreground uppercase">Product Price</span>
                      <div className="font-semibold text-foreground">₹{(Number(activeRow.unit_price) || 0).toFixed(2)}/unit</div>
                    </div>
                    <div>
                      <span className="text-[10px] text-muted-foreground uppercase">Per Unit Packing & Freight</span>
                      <div className="font-semibold text-primary">₹{(Number(activeRow.purchase_packing_freight_charge) || 0).toFixed(2)}/unit</div>
                    </div>
                    <div>
                      <span className="text-[10px] text-muted-foreground uppercase">Total Unit Cost</span>
                      <div className="font-semibold text-foreground">₹{(Number(activeRow.total_unit_cost) || 0).toFixed(2)}</div>
                    </div>
                    <div>
                      <span className="text-[10px] text-muted-foreground uppercase">GST %</span>
                      <div className="font-semibold text-foreground">{(Number(activeRow.gst_rate) || 0)}%</div>
                    </div>
                    <div>
                      <span className="text-[10px] text-muted-foreground uppercase">Discount</span>
                      <div className="font-semibold text-foreground">₹{(Number(activeRow.discount_amount) || 0).toFixed(2)}</div>
                    </div>
                    <div>
                      <span className="text-[10px] text-muted-foreground uppercase">Selling Price</span>
                      <div className="font-semibold text-emerald-600">₹{(Number(activeRow.retail_selling_price) || 0).toFixed(2)}/unit</div>
                    </div>
                  </div>

                  {/* Overall Totals */}
                  <div className="pt-2 border-t border-border">
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
                      <div>
                        <span className="text-[10px] text-muted-foreground uppercase">Total Purchase Cost</span>
                        <div className="font-bold text-foreground">₹{(Number(activeRow.final_purchase_cost) || 0).toFixed(2)}</div>
                      </div>
                      <div>
                        <span className="text-[10px] text-muted-foreground uppercase">Total GST</span>
                        <div className="font-bold text-foreground">₹{(Number(activeRow.gst_amount) || 0).toFixed(2)}</div>
                      </div>
                      <div>
                        <span className="text-[10px] text-muted-foreground uppercase">Total Selling Value</span>
                        <div className="font-bold text-emerald-600">₹{((Number(activeRow.retail_selling_price) || 0) * (Number(activeRow.quantity) || 0)).toFixed(2)}</div>
                      </div>
                      <div>
                        <span className="text-[10px] text-muted-foreground uppercase">Final Price</span>
                        <div className="font-bold text-primary text-lg">₹{(Number(activeRow.total_final) || 0).toFixed(2)}</div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Save button at bottom */}
            <div className="flex justify-end gap-2 mt-4 pt-3 border-t border-border">
              <button
                onClick={cancelForm}
                className="rounded-lg border border-border px-4 py-2 text-xs font-semibold text-muted-foreground hover:bg-secondary-soft transition"
              >
                Cancel
              </button>
              <button
                onClick={() => { saveAsDraft(); setFormOpen(false); setEditingIdx(null); }}
                className="flex items-center gap-1.5 rounded-lg border border-amber-300 bg-amber-50 px-4 py-2 text-xs font-semibold text-amber-700 hover:bg-amber-100 transition"
              >
                <Save className="h-3.5 w-3.5" /> Save Draft
              </button>
              <button
                onClick={submitPurchase}
                disabled={saving}
                className="flex items-center gap-1.5 rounded-lg bg-emerald-600 px-4 py-2 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-50 transition"
              >
                {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
                {saving ? "Submitting…" : "Submit Purchase"}
              </button>
              <button
                onClick={saveProduct}
                disabled={saving || !activeRow.name.trim()}
                className="flex items-center gap-1.5 rounded-lg bg-primary px-5 py-2 text-xs font-semibold text-white hover:bg-primary/90 disabled:opacity-50 transition"
              >
                {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
                {saving ? "Saving…" : "Save Product"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ====== COMPACT PRODUCT LIST ====== */}
      {!formOpen && (
        <>
          {/* Sticky Add Product Button */}
          <button
            onClick={addProduct}
            className="w-full flex items-center justify-center gap-2 rounded-xl bg-primary py-2.5 text-xs font-semibold text-white hover:bg-primary/90 shadow-sm transition sticky top-0 z-10"
          >
            <Plus className="h-4 w-4" /> Add Product
          </button>

          {/* Product List */}
          {calculatedRows.length > 0 ? (
            <div className="rounded-xl border border-border bg-white shadow-sm overflow-hidden">
              <table className="w-full border-collapse text-sm">
                <thead>
                  <tr className="bg-muted">
                    <th className="px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-muted-foreground text-center border-b border-border w-12">#</th>
                    <th className="px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-muted-foreground text-left border-b border-border">Product Name</th>
                    <th className="px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-muted-foreground text-center border-b border-border w-20">Slot</th>
                    <th className="px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-muted-foreground text-right border-b border-border w-24">Slot Charge</th>
                    <th className="px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-muted-foreground text-center border-b border-border w-20">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {calculatedRows.map((row, idx) => (
                    <tr
                      key={row._rowId}
                      onClick={() => editProduct(idx)}
                      className="group hover:bg-secondary-soft/30 border-b border-border/50 last:border-0 cursor-pointer transition"
                    >
                      <td className="px-3 py-2.5 text-center text-xs text-muted-foreground font-semibold">{row.serial}</td>
                      <td className="px-3 py-2.5 text-xs font-semibold text-foreground">
                        {row.name || <span className="text-muted-foreground italic">No name</span>}
                      </td>
                      <td className="px-3 py-2.5 text-center">
                        {row.slot_id ? (
                          <span className="inline-flex items-center rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-bold text-primary">
                            {row.slot_id}
                          </span>
                        ) : (
                          <span className="text-[10px] text-muted-foreground/50">—</span>
                        )}
                      </td>
                      <td className="px-3 py-2.5 text-right text-xs font-semibold text-foreground">
                        {row.slot_charge_per_product > 0 ? (
                          <span>₹{row.slot_charge_per_product.toFixed(2)}</span>
                        ) : (
                          <span className="text-muted-foreground/50">—</span>
                        )}
                      </td>
                      <td className="px-3 py-2.5">
                        <div className="flex items-center justify-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                          <button
                            onClick={(e) => { e.stopPropagation(); deleteRow(idx); }}
                            className="rounded p-1 hover:bg-rose-50"
                            title="Delete product"
                          >
                            <Trash2 className="h-3.5 w-3.5 text-rose-600" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="rounded-xl border border-dashed border-border bg-white/50 py-12 text-center">
              <p className="text-sm text-muted-foreground">No products added yet.</p>
              <p className="text-xs text-muted-foreground/70 mt-1">Click <strong>+ Add Product</strong> to begin.</p>
            </div>
          )}

          {/* ===== SALES SUMMARY 1: Per Product Summary ===== */}
          {calculatedRows.length > 0 && (
            <div className="rounded-xl border border-border bg-white shadow-sm overflow-hidden">
              <div className="px-4 py-3 bg-primary/5 border-b border-border">
                <h3 className="text-sm font-bold text-primary">Sales Summary 1 — Per Product Summary</h3>
                <p className="text-[10px] text-muted-foreground">Individual product-level billing details</p>
              </div>
              <div className="divide-y divide-border">
                {calculatedRows.map((r) => (
                  <div key={r._rowId} className="p-4 hover:bg-secondary-soft/20 transition">
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-bold text-muted-foreground">#{r.serial}</span>
                        <span className="text-sm font-semibold text-foreground">{r.name || "Unnamed"}</span>
                        {r.slot_id && (
                          <span className="inline-flex items-center rounded-full bg-primary/10 px-1.5 py-0.5 text-[9px] font-bold text-primary">
                            {r.slot_id}
                          </span>
                        )}
                      </div>
                      <span className="text-sm font-bold text-primary">₹{(Number(r.total_final) || 0).toFixed(2)}</span>
                    </div>
                    <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-2 text-[11px]">
                      <div>
                        <span className="text-muted-foreground">Product Price</span>
                        <div className="font-semibold">₹{(Number(r.unit_price) || 0).toFixed(2)}/unit</div>
                      </div>
                      <div>
                        <span className="text-muted-foreground">Quantity</span>
                        <div className="font-semibold">{Number(r.quantity) || 0}</div>
                      </div>
                      <div>
                        <span className="text-muted-foreground">Packing & Freight</span>
                        <div className="font-semibold">₹{(Number(r.slot_charge_per_product) || 0).toFixed(2)}</div>
                      </div>
                      <div>
                        <span className="text-muted-foreground">GST ({(Number(r.gst_rate) || 0)}%)</span>
                        <div className="font-semibold">₹{(Number(r.gst_amount) || 0).toFixed(2)}</div>
                      </div>
                      <div>
                        <span className="text-muted-foreground">Discount</span>
                        <div className="font-semibold">₹{(Number(r.discount_amount) || 0).toFixed(2)}</div>
                      </div>
                      <div>
                        <span className="text-muted-foreground">Final Price</span>
                        <div className="font-bold text-primary">₹{(Number(r.total_final) || 0).toFixed(2)}</div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ===== SALES SUMMARY 2: Total Unit / Multi-Product Summary ===== */}
          {calculatedRows.length > 0 && (
            <div className="rounded-xl border border-border bg-white shadow-sm overflow-hidden">
              <div className="px-4 py-3 bg-emerald-50 border-b border-border">
                <h3 className="text-sm font-bold text-emerald-700">Sales Summary 2 — Total Unit / Multi-Product Summary</h3>
                <p className="text-[10px] text-muted-foreground">Combined totals across all products</p>
              </div>
              <div className="p-4">
                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
                  <div className="space-y-1">
                    <Label className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">Total Products</Label>
                    <div className="text-lg font-bold text-foreground">{calculatedRows.length}</div>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">Total Quantity</Label>
                    <div className="text-lg font-bold text-foreground">{grandTotals.total_quantity}</div>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">Total Product Amount</Label>
                    <div className="text-lg font-bold text-foreground">₹{grandTotals.total_price.toFixed(2)}</div>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">Total Packing & Freight</Label>
                    <div className="text-lg font-bold text-primary">₹{grandTotals.total_packing_freight.toFixed(2)}</div>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">Total GST</Label>
                    <div className="text-lg font-bold text-foreground">₹{grandTotals.gst.toFixed(2)}</div>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">Total Discount</Label>
                    <div className="text-lg font-bold text-foreground">₹{grandTotals.discount.toFixed(2)}</div>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">Total Other Charges</Label>
                    <div className="text-lg font-bold text-foreground">₹{grandTotals.total_other_charges.toFixed(2)}</div>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">Total Final Price</Label>
                    <div className="text-lg font-bold text-emerald-700">₹{grandTotals.total_final.toFixed(2)}</div>
                  </div>
                </div>

                {/* Per-Slot Breakdown */}
                {getSlotIds(calculatedRows).length > 0 && (
                  <div className="mt-4 pt-3 border-t border-border">
                    <Label className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide mb-2 block">
                      Slot-wise Charge Split
                    </Label>
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                      {getSlotIds(calculatedRows).map((slotId) => {
                        const totalCharge = getSlotTotalCharge(calculatedRows, slotId);
                        const productCount = calculatedRows.filter((r) => r.slot_id === slotId).length;
                        const perProduct = productCount > 0 ? totalCharge / productCount : 0;
                        return (
                          <div key={slotId} className="rounded-lg bg-primary/5 border border-primary/20 px-3 py-2">
                            <div className="flex items-center justify-between">
                              <span className="text-[10px] font-bold text-primary uppercase">{slotId}</span>
                              <span className="text-[10px] text-muted-foreground">{productCount} product{productCount !== 1 ? "s" : ""}</span>
                            </div>
                            <div className="flex items-center justify-between mt-1">
                              <span className="text-xs text-muted-foreground">Total: ₹{totalCharge.toFixed(2)}</span>
                              <span className="text-xs font-bold text-primary">₹{perProduct.toFixed(2)}/product</span>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
        </>
      )}

      {/* ====== ADD NEW SLOT MODAL ====== */}
      {showAddSlotModal && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40" onMouseDown={() => { setShowAddSlotModal(false); setNewSlotName(""); setNewSlotTotalAmount(0); setNewSlotTotalUnits(0); setNewSlotNotes(""); }}>
          <div className="bg-white rounded-xl shadow-2xl border border-border w-full max-w-md p-4 space-y-3" onMouseDown={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold text-foreground">Add New Slot</h3>
              <button onClick={() => { setShowAddSlotModal(false); setNewSlotName(""); setNewSlotTotalAmount(0); setNewSlotTotalUnits(0); setNewSlotNotes(""); }} className="rounded p-1 hover:bg-muted">
                <X className="h-4 w-4 text-muted-foreground" />
              </button>
            </div>
            <div className="space-y-2">
              <div className="space-y-1">
                <label className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">Slot Name *</label>
                <input
                  value={newSlotName}
                  onChange={(e) => setNewSlotName(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") saveNewSlotInline(); }}
                  placeholder="e.g. 1, 2, A"
                  className="w-full rounded-lg border border-border bg-white px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
                  autoFocus
                />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <label className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">Total Amount (₹)</label>
                  <input
                    type="number"
                    min={0}
                    step="0.01"
                    value={newSlotTotalAmount || ""}
                    onChange={(e) => setNewSlotTotalAmount(Number(e.target.value) || 0)}
                    placeholder="0"
                    className="w-full rounded-lg border border-border bg-white px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary text-right"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">Total Units *</label>
                  <input
                    type="number"
                    min={0}
                    value={newSlotTotalUnits || ""}
                    onChange={(e) => setNewSlotTotalUnits(Number(e.target.value) || 0)}
                    placeholder="0"
                    className="w-full rounded-lg border border-border bg-white px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary text-right"
                  />
                </div>
              </div>
              {newSlotTotalUnits > 0 && (
                <div className="p-2 rounded-lg bg-primary/5 border border-primary/20">
                  <span className="text-[10px] text-muted-foreground uppercase">Per Unit Cost: </span>
                  <span className="text-xs font-bold text-primary">₹{((Number(newSlotTotalAmount) || 0) / newSlotTotalUnits).toFixed(2)}/unit</span>
                </div>
              )}
              <div className="space-y-1">
                <label className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">Notes</label>
                <input
                  value={newSlotNotes}
                  onChange={(e) => setNewSlotNotes(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") saveNewSlotInline(); }}
                  placeholder="Optional notes"
                  className="w-full rounded-lg border border-border bg-white px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
                />
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-2 border-t border-border">
              <button onClick={() => { setShowAddSlotModal(false); setNewSlotName(""); setNewSlotTotalAmount(0); setNewSlotTotalUnits(0); setNewSlotNotes(""); }} className="rounded-lg border border-border px-3 py-1.5 text-xs font-semibold text-muted-foreground hover:bg-secondary-soft transition">Cancel</button>
              <button onClick={saveNewSlotInline} disabled={savingNewSlot || !newSlotName.trim() || newSlotTotalUnits <= 0} className="flex items-center gap-1 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-50 transition">
                {savingNewSlot ? <Loader2 className="h-3 w-3 animate-spin" /> : <Plus className="h-3 w-3" />}
                {savingNewSlot ? "Adding…" : "Add Slot"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
