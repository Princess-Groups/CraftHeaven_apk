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
} from "lucide-react";
import { toast } from "sonner";
import { uploadProductImage } from "@/lib/upload";
import { Label } from "@/components/ui/label";

export const Route = createFileRoute("/admin/purchases")({
  head: () => ({ meta: [{ title: "Purchase Entry — ACH Admin" }] }),
  validateSearch: (search: Record<string, unknown>) => ({
    restock: (search.restock as string) || undefined,
  }),
  component: Purchases,
});

// ---------- Types ----------
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
  purchase_packing_charge: number;
  purchase_freight_charges: number;
  other_charges: number;
  total_unit_cost: number;
  final_purchase_cost: number;
  retail_selling_price: number;
  wholesale_price: number;
  profit_per_piece_pct: number;
  pieces_sold: number;
  sold_for: number;
  total_sold: number;
  minimum_stock: number;
  current_stock: number;
  rack_location: string;
  delivery_packing_charge: number;
  delivery_charge: number;
  re_stock: number;
  gst_rate: number;
  gst_amount: number;
  discount: number;
  total_final: number;
  cash_received_by: string;
  remark: string;
  mrp: number;
  mop: number;
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
  purchase_packing_charge: 0,
  purchase_freight_charges: 0,
  other_charges: 0,
  total_unit_cost: 0,
  final_purchase_cost: 0,
  retail_selling_price: 0,
  wholesale_price: 0,
  profit_per_piece_pct: 0,
  pieces_sold: 0,
  sold_for: 0,
  total_sold: 0,
  minimum_stock: 5,
  current_stock: 0,
  rack_location: "",
  delivery_packing_charge: 0,
  delivery_charge: 0,
  re_stock: 0,
  gst_rate: 0,
  gst_amount: 0,
  discount: 0,
  total_final: 0,
  cash_received_by: "",
  remark: "",
  mrp: 0,
  mop: 0,
});

const UNITS = ["Nos", "Packet", "Unit", "Kilogram", "Gram", "Liter", "ML", "Meter", "Centimeter", "Inch", "DIAM"] as const;
const PAYMENT_METHODS = ["UPI", "CASH", "GPAY", "CARD"] as const;

// ---------- Calculated fields ----------
function calcRow(r: ProductRow): ProductRow {
  // Auto-calculate quantity from Total Unit / Per Packet Value when units match and values exist
  let qty = Number(r.quantity) || 0;
  const ppv = Number(r.per_packet_value) || 0;
  const tu = Number(r.total_unit) || 0;
  if (ppv > 0 && tu > 0 && r.per_packet_unit === r.total_unit_type && r.total_unit_type !== "Nos") {
    qty = Math.round((tu / ppv) * 100) / 100;
  }
  const up = Number(r.unit_price) || 0;
  const total_price = qty * up;
  const total_unit_cost = up + Number(r.purchase_packing_charge) + Number(r.purchase_freight_charges) + Number(r.other_charges);
  const final_purchase_cost = total_unit_cost * qty;
  const rsp = Number(r.retail_selling_price) || 0;
  const profit_pct = rsp > 0 && total_unit_cost > 0 ? ((rsp - total_unit_cost) / total_unit_cost) * 100 : 0;
  const pieces = Number(r.pieces_sold) || 0;
  const sold_for_val = Number(r.sold_for) || 0;
  const total_sold = pieces * sold_for_val;
  const gst_pct = Math.min(Math.max(Number(r.gst_rate) || 0, 0), 100);
  const gst = final_purchase_cost * gst_pct / 100;
  const discount = Number(r.discount) || 0;
  const total_final = final_purchase_cost + Number(r.delivery_packing_charge) + Number(r.delivery_charge) + gst - discount;

  return {
    ...r,
    quantity: qty,
    total_price,
    total_unit_cost,
    final_purchase_cost,
    profit_per_piece_pct: Math.round(profit_pct * 100) / 100,
    total_sold,
    gst_amount: Math.round(gst * 100) / 100,
    total_final: Math.round(total_final * 100) / 100,
  };
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
}: {
  value: string;
  onChange: (val: string) => void;
  suppliers: { id: string; name: string }[];
}) {
  const [inputVal, setInputVal] = useState(value || "");
  const [open, setOpen] = useState(false);
  const [highlightIdx, setHighlightIdx] = useState(-1);
  const inputRef = useRef<HTMLInputElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

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
        select(trimmedInput);
      } else if (filtered.length === 1) {
        select(filtered[0].name);
      } else if (isNew) {
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
                select(trimmedInput);
              }}
              onMouseEnter={() => setHighlightIdx(filtered.length)}
              className={`w-full text-left px-3 py-2 text-sm border-t border-border/50 transition ${
                highlightIdx === filtered.length ? "bg-primary/10 text-primary font-medium" : "hover:bg-secondary-soft"
              }`}
            >
              <span className="text-muted-foreground">Add new: </span>
              <span className="font-semibold">{trimmedInput}</span>
            </button>
          )}
        </div>
      )}
    </div>
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

  const rowsRef = useRef(rows);
  rowsRef.current = rows;

  // Re-Stock: read URL param and pre-fill product
  const { restock: restockId } = useSearch({ from: "/admin/purchases" });
  useEffect(() => {
    if (!restockId) return;
    async function loadRestock() {
      const { data: product } = await supabase
        .from("products")
        .select("id,name,barcode,category_id,price,purchase_price,stock,reorder_level,unit,image_urls")
        .eq("id", restockId)
        .single();
      if (!product) return toast.error("Product not found");
      const newRow = {
        ...blankRow(1),
        id: product.id,
        name: product.name ?? "",
        barcode: product.barcode ?? "",
        category_id: product.category_id ?? "",
        retail_selling_price: Number(product.price ?? 0),
        unit_price: Number(product.purchase_price ?? 0),
        current_stock: Number(product.stock ?? 0),
        minimum_stock: Number(product.reorder_level ?? 5),
        per_packet_unit: product.unit ?? "Nos",
        image_url: product.image_urls?.[0] ?? "",
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
          .select("id,barcode,name,category_id,stock,reorder_level,unit,price,purchase_price,image_urls,sku")
          .order("created_at", { ascending: false })
      ).data ?? [],
  });

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
        discount: acc.discount + r.discount,
      }),
      { total_price: 0, final_purchase_cost: 0, total_final: 0, gst: 0, discount: 0 },
    );
  }, [calculatedRows]);

  const patchRow = useCallback((idx: number, patch: Partial<ProductRow>) => {
    setRows((prev) => prev.map((r, i) => (i === idx ? { ...r, ...patch } : r)));
  }, []);

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
    // Remove blank row if it was a new product with no name
    if (editingIdx !== null) {
      const row = rows[editingIdx];
      if (row && !row.name.trim() && !row.id) {
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
      const next = prev.filter((_, i) => i !== idx);
      return next.map((r, i) => ({ ...r, serial: i + 1 }));
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
          const { error: supErr } = await supabase
            .from("suppliers")
            .insert({ name: row.supplier_name.trim() });
          if (supErr) {
            console.error("Failed to add supplier:", supErr);
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
        stock: Number(row.current_stock) || 0,
        reorder_level: Number(row.minimum_stock) || 5,
        unit: row.per_packet_unit || "Nos",
        image_urls: row.image_url ? [row.image_url] : [],
        color: row.colour || null,
        is_available: (Number(row.current_stock) || 0) > 0,
      };

      if (row.id) {
        await supabase.from("products").update(productPayload).eq("id", row.id);
      } else {
        const { data: newProduct } = await supabase
          .from("products")
          .insert(productPayload)
          .select("id")
          .single();
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

  // ---- Export to CSV ----
  function exportCSV() {
    const headers = [
      "S.No", "Barcode", "Supplier Name", "Supplier Bill No", "Category", "Date",
      "Product Name", "Material", "Colour", "Per Packet Value", "Per Packet Unit", "Total Unit", "Total Unit Type", "Qty", "Unit Price", "Total Price",
      "Packing Charge", "Freight Charges", "Other Charges", "Total Unit Cost",
      "Final Purchase Cost", "Retail Selling Price", "Wholesale Price", "Profit %",
      "Pieces Sold", "Sold For", "Total Sold", "Min Stock", "Current Stock",
      "Rack Location", "Del Packing Amt", "Del Charge Amt", "Re Stock",
      "GST %", "GST Amt", "Discount", "Total Final",
      "Payment", "Remark", "MRP", "MOP",
    ];
    const csvRows = calculatedRows.map((r) => [
      r.serial, r.barcode, r.supplier_name, r.supplier_bill_no, r.category_id, r.date,
      r.name, r.material, r.colour, r.per_packet_value, r.per_packet_unit, r.total_unit, r.total_unit_type, r.quantity, r.unit_price,
      r.total_price, r.purchase_packing_charge, r.purchase_freight_charges,
      r.other_charges, r.total_unit_cost, r.final_purchase_cost, r.retail_selling_price,
      r.wholesale_price, r.profit_per_piece_pct, r.pieces_sold, r.sold_for,
      r.total_sold, r.minimum_stock, r.current_stock, r.rack_location,
      r.delivery_packing_charge, r.delivery_charge, r.re_stock,
      r.gst_rate, r.gst_amount, r.discount, r.total_final,
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
          purchase_packing_charge: Number(cols[14]) || 0,
          purchase_freight_charges: Number(cols[15]) || 0,
          other_charges: Number(cols[16]) || 0,
          retail_selling_price: Number(cols[19]) || 0,
          wholesale_price: Number(cols[20]) || 0,
          pieces_sold: Number(cols[22]) || 0,
          sold_for: Number(cols[23]) || 0,
          minimum_stock: Number(cols[25]) || 5,
          current_stock: Number(cols[26]) || 0,
          rack_location: cols[27] ?? "",
          cash_received_by: cols[34] ?? "",
          remark: cols[35] ?? "",
          mrp: Number(cols[36]) || 0,
          mop: Number(cols[37]) || 0,
        });
      }
      if (!newRows.length) return toast.error("No valid rows found in CSV");
      setRows(newRows);
      toast.success(`Imported ${newRows.length} rows`);
    };
    reader.readAsText(file);
    e.target.value = "";
  }

  // 38-field form definitions in exact user-specified sequence
  const FORM_FIELDS: { key: string; label: string; type: string; ro?: boolean; unitField?: string }[] = [
    { key: "barcode", label: "Barcode", type: "text" },
    { key: "supplier_name", label: "Supplier Name", type: "select-supplier" },
    { key: "supplier_bill_no", label: "Supplier Bill Number", type: "text" },
    { key: "category_id", label: "Craft Material Category", type: "select-category" },
    { key: "image_url", label: "Image", type: "image" },
    { key: "date", label: "Date", type: "date" },
    { key: "name", label: "Product Name", type: "text" },
    { key: "material", label: "Material", type: "text" },
    { key: "colour", label: "Colour", type: "text" },
    { key: "per_packet_value", label: "Per Packet Value", type: "unit-pair", unitField: "per_packet_unit" },
    { key: "total_unit", label: "Total Unit", type: "unit-pair", unitField: "total_unit_type" },
    { key: "quantity", label: "Quantity", type: "number" },
    { key: "unit_price", label: "Unit Price", type: "number" },
    { key: "total_price", label: "Total Price", type: "number", ro: true },
    { key: "purchase_packing_charge", label: "Purchase Packing Charge", type: "number" },
    { key: "purchase_freight_charges", label: "(Transport) Purchase Freight Charges", type: "number" },
    { key: "other_charges", label: "Other Charges", type: "number" },
    { key: "total_unit_cost", label: "Total Unit Cost", type: "number", ro: true },
    { key: "final_purchase_cost", label: "Final Purchase Cost", type: "number", ro: true },
    { key: "retail_selling_price", label: "Retail Selling Price", type: "number" },
    { key: "wholesale_price", label: "Wholesale Price", type: "number" },
    { key: "profit_per_piece_pct", label: "Profit Per Piece %", type: "number", ro: true },
    { key: "pieces_sold", label: "Number of Pieces Sold", type: "number" },
    { key: "sold_for", label: "Sold For", type: "number" },
    { key: "total_sold", label: "Total", type: "number", ro: true },
    { key: "minimum_stock", label: "Minimum Stock", type: "number" },
    { key: "current_stock", label: "Current Stock", type: "number" },
    { key: "rack_location", label: "Rack Location", type: "text" },
    { key: "delivery_packing_charge", label: "Delivery Packing Charge", type: "number" },
    { key: "delivery_charge", label: "Delivery Charge", type: "number" },
    { key: "re_stock", label: "Re Stock", type: "number" },
    { key: "gst_rate", label: "GST %", type: "number" },
    { key: "gst_amount", label: "GST Amount", type: "number", ro: true },
    { key: "discount", label: "Discount", type: "number" },
    { key: "total_final", label: "Total Final", type: "number", ro: true },
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
      case "select-supplier":
        return (
          <SupplierCombobox
            value={String(row[field] || "")}
            onChange={(val) => patchRow(idx, { supplier_name: val })}
            suppliers={suppliers ?? []}
          />
        );
      case "select-category":
        return (
          <select
            value={String(row[field])}
            onChange={(e) => patchRow(idx, { [field]: e.target.value })}
            className="w-full rounded-lg border border-border bg-white px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
          >
            <option value="">— select —</option>
            {(categories ?? []).map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        );
      case "select-unit":
        return (
          <UnitCell row={row} field={field} options={UNITS} idx={idx} />
        );
      case "unit-pair": {
        const unitField = fieldDef.unitField as keyof ProductRow;
        return (
          <div className="flex gap-2">
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
        <h1 className="text-xl font-bold text-foreground flex-1">Purchase Entry</h1>
        <div className="flex items-center gap-2 rounded-lg border border-border bg-white px-3 py-1.5 shadow-sm">
          <Search className="h-4 w-4 text-muted-foreground/70" />
          <input
            value={searchQ}
            onChange={(e) => setSearchQ(e.target.value)}
            placeholder="Search existing products…"
            className="bg-transparent text-sm outline-none w-48"
          />
        </div>
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
                setRows((prev) => [...prev, {
                  ...blankRow(prev.length + 1),
                  id: p.id,
                  barcode: p.barcode ?? "",
                  name: p.name ?? "",
                  category_id: p.category_id ?? "",
                  current_stock: p.stock ?? 0,
                  minimum_stock: p.reorder_level ?? 5,
                  per_packet_unit: p.unit ?? "Nos",
                  retail_selling_price: Number(p.price ?? 0),
                  unit_price: Number(p.purchase_price ?? 0),
                  image_url: p.image_urls?.[0] ?? "",
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
            {/* Save button at bottom */}
            <div className="flex justify-end gap-2 mt-4 pt-3 border-t border-border">
              <button
                onClick={cancelForm}
                className="rounded-lg border border-border px-4 py-2 text-xs font-semibold text-muted-foreground hover:bg-secondary-soft transition"
              >
                Cancel
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
                      <td className="px-3 py-2.5">
                        <div className="flex items-center justify-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                          <button
                            onClick={(e) => { e.stopPropagation(); deleteRow(idx); }}
                            disabled={calculatedRows.length <= 1}
                            className="rounded p-1 hover:bg-rose-50 disabled:opacity-30"
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

          {/* Grand Totals */}
          {calculatedRows.length > 0 && (
            <div className="rounded-xl border border-border bg-white shadow-sm p-4">
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
                <div className="space-y-1">
                  <Label className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">Total Price</Label>
                  <div className="text-lg font-bold text-foreground">₹{grandTotals.total_price.toFixed(2)}</div>
                </div>
                <div className="space-y-1">
                  <Label className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">Final Purchase Cost</Label>
                  <div className="text-lg font-bold text-foreground">₹{grandTotals.final_purchase_cost.toFixed(2)}</div>
                </div>
                <div className="space-y-1">
                  <Label className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">Total Final</Label>
                  <div className="text-lg font-bold text-emerald-700">₹{grandTotals.total_final.toFixed(2)}</div>
                </div>
                <div className="space-y-1">
                  <Label className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">GST</Label>
                  <div className="text-lg font-bold text-foreground">₹{grandTotals.gst.toFixed(2)}</div>
                </div>
                <div className="space-y-1">
                  <Label className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">Discount</Label>
                  <div className="text-lg font-bold text-foreground">₹{grandTotals.discount.toFixed(2)}</div>
                </div>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
