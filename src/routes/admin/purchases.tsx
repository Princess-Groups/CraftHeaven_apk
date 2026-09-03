import { createFileRoute, useSearch } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useState, useRef, useCallback, useMemo, useEffect, memo } from "react";
import {
  Plus,
  Trash2,
  Copy,
  Search,
  Download,
  Upload,
  Save,
  X,
  Loader2,
  ImageIcon,
} from "lucide-react";
import { toast } from "sonner";
import { uploadProductImage } from "@/lib/upload";

export const Route = createFileRoute("/admin/purchases")({
  head: () => ({ meta: [{ title: "Purchase Entry — ACH Admin" }] }),
  validateSearch: (search: Record<string, unknown>) => ({
    restock: (search.restock as string) || undefined,
  }),
  component: Purchases,
});

// ---------- Types ----------
type ColorVariation = { color: string; image_url: string };

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
  gst_amount: 0,
  discount: 0,
  total_final: 0,
  cash_received_by: "",
  remark: "",
  mrp: 0,
  mop: 0,
});

const UNITS = ["Nos", "KG", "G", "L", "ML", "M", "CM", "INC", "DIAM"] as const;
const PAYMENT_METHODS = ["UPI", "CASH", "GPAY", "CARD"] as const;

// ---------- Calculated fields ----------
function calcRow(r: ProductRow): ProductRow {
  const qty = Number(r.quantity) || 0;
  const up = Number(r.unit_price) || 0;
  const total_price = qty * up;
  const total_unit_cost = up + Number(r.purchase_packing_charge) + Number(r.purchase_freight_charges) + Number(r.other_charges);
  const final_purchase_cost = total_unit_cost * qty;
  const rsp = Number(r.retail_selling_price) || 0;
  const profit_pct = rsp > 0 && total_unit_cost > 0 ? ((rsp - total_unit_cost) / total_unit_cost) * 100 : 0;
  const pieces = Number(r.pieces_sold) || 0;
  const sold_for_val = Number(r.sold_for) || 0;
  const total_sold = pieces * sold_for_val;
  const del_packing = final_purchase_cost * 0.02;
  const del_charge = final_purchase_cost * 0.05;
  const gst = final_purchase_cost * 0.05;
  const disc = final_purchase_cost * 0.02;
  const total_final = final_purchase_cost + del_packing + del_charge + gst - disc;

  return {
    ...r,
    total_price,
    total_unit_cost,
    final_purchase_cost,
    profit_per_piece_pct: Math.round(profit_pct * 100) / 100,
    total_sold,
    delivery_packing_charge: Math.round(del_packing * 100) / 100,
    delivery_charge: Math.round(del_charge * 100) / 100,
    gst_amount: Math.round(gst * 100) / 100,
    discount: Math.round(disc * 100) / 100,
    total_final: Math.round(total_final * 100) / 100,
  };
}

// ---------- Stable Cell component (outside parent) ----------
// We store patchRow in a ref so the Cell never needs to re-render
// when only the handler reference changes.
let _patchRowRef: ((idx: number, patch: Partial<ProductRow>) => void) | null = null;
let _handleImageUploadRef: ((idx: number, file: File) => void) | null = null;
let _uploadingRef: string | null = null;

const Cell = memo(function Cell({
  row,
  field,
  type = "text",
  options,
  width,
  readOnly,
}: {
  row: ProductRow;
  field: keyof ProductRow;
  type?: string;
  options?: readonly string[];
  width?: string;
  readOnly?: boolean;
}) {
  const val = row[field];

  if (options) {
    return (
      <select
        value={String(val)}
        onChange={(e) => _patchRowRef?.(row.serial - 1, { [field]: e.target.value })}
        className="h-full w-full border-0 bg-transparent px-1.5 py-1 text-[11px] outline-none focus:bg-secondary-soft"
        style={{ minWidth: width ?? 80 }}
      >
        {options.map((o) => (
          <option key={o} value={o}>{o}</option>
        ))}
      </select>
    );
  }

  if (type === "image") {
    return (
      <div className="flex items-center gap-1 px-1">
        {val ? (
          <div className="relative">
            <img src={String(val)} alt="" className="h-7 w-7 rounded object-cover" />
            <button
              onClick={() => _patchRowRef?.(row.serial - 1, { image_url: "" })}
              className="absolute -right-1 -top-1 h-3.5 w-3.5 rounded-full bg-rose-500 text-white grid place-items-center"
            >
              <X className="h-2 w-2" />
            </button>
          </div>
        ) : null}
        <label className="cursor-pointer text-muted-foreground/60 hover:text-secondary">
          <input
            type="file"
            accept="image/*"
            className="sr-only"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) _handleImageUploadRef?.(row.serial - 1, f);
            }}
          />
          {_uploadingRef === row._rowId ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <ImageIcon className="h-3.5 w-3.5" />
          )}
        </label>
      </div>
    );
  }

  return (
    <input
      type={type}
      defaultValue={String(val ?? "")}
      readOnly={readOnly}
      onChange={(e) => {
        const v = type === "number" ? Number(e.target.value) || 0 : e.target.value;
        _patchRowRef?.(row.serial - 1, { [field]: v });
      }}
      className={`h-full w-full border-0 bg-transparent px-1.5 py-1 text-[11px] outline-none ${
        readOnly ? "text-muted-foreground font-semibold" : "focus:bg-secondary-soft"
      } ${type === "number" ? "text-right" : ""}`}
      style={{ minWidth: width ?? 80 }}
      step={type === "number" ? "0.01" : undefined}
    />
  );
});

// ---------- Component ----------
function Purchases() {
  const qc = useQueryClient();
  const tableRef = useRef<HTMLDivElement>(null);
  const [rows, setRows] = useState<ProductRow[]>([blankRow(1)]);
  const [searchQ, setSearchQ] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [uploading, setUploading] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Refs to keep stable references for Cell
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
      setRows([{
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
      }]);
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

  // Existing products for search/edit
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

  // Filter existing products for search
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

  // Calculated rows
  const calculatedRows = useMemo(() => rows.map(calcRow), [rows]);

  // Grand totals
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

  // ---- Row operations ----
  const patchRow = useCallback((idx: number, patch: Partial<ProductRow>) => {
    setRows((prev) => prev.map((r, i) => (i === idx ? { ...r, ...patch } : r)));
  }, []);

  // Keep the module-level refs updated so Cell can use them
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

  function addRow() {
    setRows((prev) => [...prev, blankRow(prev.length + 1)]);
  }

  function addProduct() {
    setRows((prev) => [...prev, blankRow(prev.length + 1)]);
    // Focus the new row's Product Name field after render
    setTimeout(() => {
      const table = tableRef.current;
      if (!table) return;
      const rows = table.querySelectorAll("tbody tr");
      const lastRow = rows[rows.length - 1];
      if (lastRow) {
        const inputs = lastRow.querySelectorAll("input");
        // Product Name is column index 7 (0-based)
        for (const inp of inputs) {
          if (inp.getAttribute("type") === "text" && !inp.readOnly) {
            inp.focus();
            break;
          }
        }
      }
    }, 50);
  }

  function duplicateRow(idx: number) {
    setRows((prev) => {
      const copy = { ...prev[idx], _rowId: uid(), id: "", serial: prev.length + 1 };
      const next = [...prev];
      next.splice(idx + 1, 0, copy);
      return next.map((r, i) => ({ ...r, serial: i + 1 }));
    });
  }

  function deleteRow(idx: number) {
    setRows((prev) => {
      if (prev.length <= 1) return prev;
      const next = prev.filter((_, i) => i !== idx);
      return next.map((r, i) => ({ ...r, serial: i + 1 }));
    });
  }

  // ---- Save all rows ----
  async function saveAll() {
    const valid = calculatedRows.filter((r) => r.name.trim());
    if (!valid.length) return toast.error("At least one product name is required");
    setSaving(true);
    try {
      for (const r of valid) {
        const slug = r.name
          .toLowerCase()
          .replace(/\s+/g, "-")
          .replace(/[^a-z0-9-]/g, "");
        const productPayload = {
          name: r.name.trim(),
          slug,
          barcode: r.barcode || null,
          sku: r.barcode || null,
          category_id: r.category_id || null,
          price: Number(r.retail_selling_price) || 0,
          purchase_price: Number(r.unit_price) || 0,
          stock: Number(r.current_stock) || 0,
          reorder_level: Number(r.minimum_stock) || 5,
          unit: r.per_packet_unit || "Nos",
          image_urls: r.image_url ? [r.image_url] : [],
          color: r.colour || null,
          is_available: (Number(r.current_stock) || 0) > 0,
        };

        if (r.id) {
          await supabase.from("products").update(productPayload).eq("id", r.id);
        } else {
          const { data: newProduct } = await supabase
            .from("products")
            .insert(productPayload)
            .select("id")
            .single();
          if (newProduct) {
            patchRow(calculatedRows.indexOf(r), { id: newProduct.id });
          }
        }
      }
      toast.success(`${valid.length} product(s) saved successfully`);
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
      "Product Name", "Material", "Colour", "Unit", "Qty", "Unit Price", "Total Price",
      "Packing Charge", "Freight Charges", "Other Charges", "Total Unit Cost",
      "Final Purchase Cost", "Retail Selling Price", "Wholesale Price", "Profit %",
      "Pieces Sold", "Sold For", "Total Sold", "Min Stock", "Current Stock",
      "Rack Location", "Del Packing 2%", "Del Charge 5%", "Re Stock", "GST 5%",
      "Discount 2%", "Total", "Payment", "Remark", "MRP", "MOP",
    ];
    const csvRows = calculatedRows.map((r) => [
      r.serial, r.barcode, r.supplier_name, r.supplier_bill_no, r.category_id, r.date,
      r.name, r.material, r.colour, r.per_packet_unit, r.quantity, r.unit_price,
      r.total_price, r.purchase_packing_charge, r.purchase_freight_charges,
      r.other_charges, r.total_unit_cost, r.final_purchase_cost, r.retail_selling_price,
      r.wholesale_price, r.profit_per_piece_pct, r.pieces_sold, r.sold_for,
      r.total_sold, r.minimum_stock, r.current_stock, r.rack_location,
      r.delivery_packing_charge, r.delivery_charge, r.re_stock, r.gst_amount,
      r.discount, r.total_final, r.cash_received_by, r.remark, r.mrp, r.mop,
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
          quantity: Number(cols[10]) || 1,
          unit_price: Number(cols[11]) || 0,
          purchase_packing_charge: Number(cols[13]) || 0,
          purchase_freight_charges: Number(cols[14]) || 0,
          other_charges: Number(cols[15]) || 0,
          retail_selling_price: Number(cols[18]) || 0,
          wholesale_price: Number(cols[19]) || 0,
          pieces_sold: Number(cols[21]) || 0,
          sold_for: Number(cols[22]) || 0,
          minimum_stock: Number(cols[24]) || 5,
          current_stock: Number(cols[25]) || 0,
          rack_location: cols[26] ?? "",
          cash_received_by: cols[33] ?? "",
          remark: cols[34] ?? "",
          mrp: Number(cols[35]) || 0,
          mop: Number(cols[36]) || 0,
        });
      }
      if (!newRows.length) return toast.error("No valid rows found in CSV");
      setRows(newRows);
      toast.success(`Imported ${newRows.length} rows`);
    };
    reader.readAsText(file);
    e.target.value = "";
  }

  // Column definitions
  const COLS = [
    { key: "serial", label: "S.No", w: 45, type: "text", ro: true },
    { key: "barcode", label: "Barcode", w: 100, type: "text" },
    { key: "supplier_name", label: "Supplier Name", w: 130, type: "select-supplier" },
    { key: "supplier_bill_no", label: "Supplier Bill No", w: 110, type: "text" },
    { key: "category_id", label: "Category", w: 120, type: "select-category" },
    { key: "image_url", label: "Image", w: 60, type: "image" },
    { key: "date", label: "Date", w: 110, type: "date" },
    { key: "name", label: "Product Name", w: 150, type: "text" },
    { key: "material", label: "Material", w: 100, type: "text" },
    { key: "colour", label: "Colour", w: 90, type: "text" },
    { key: "per_packet_unit", label: "Unit", w: 80, type: "select-unit" },
    { key: "quantity", label: "Qty", w: 65, type: "number" },
    { key: "unit_price", label: "Unit Price", w: 85, type: "number" },
    { key: "total_price", label: "Total Price", w: 85, type: "number", ro: true },
    { key: "purchase_packing_charge", label: "Packing Charge", w: 100, type: "number" },
    { key: "purchase_freight_charges", label: "Freight Charges", w: 100, type: "number" },
    { key: "other_charges", label: "Other Charges", w: 90, type: "number" },
    { key: "total_unit_cost", label: "Total Unit Cost", w: 100, type: "number", ro: true },
    { key: "final_purchase_cost", label: "Final Purchase Cost", w: 110, type: "number", ro: true },
    { key: "retail_selling_price", label: "Retail Price", w: 90, type: "number" },
    { key: "wholesale_price", label: "Wholesale Price", w: 95, type: "number" },
    { key: "profit_per_piece_pct", label: "Profit %", w: 70, type: "number", ro: true },
    { key: "pieces_sold", label: "Pieces Sold", w: 80, type: "number" },
    { key: "sold_for", label: "Sold For", w: 80, type: "number" },
    { key: "total_sold", label: "Total Sold", w: 80, type: "number", ro: true },
    { key: "minimum_stock", label: "Min Stock", w: 75, type: "number" },
    { key: "current_stock", label: "Current Stock", w: 80, type: "number" },
    { key: "rack_location", label: "Rack Location", w: 95, type: "text" },
    { key: "delivery_packing_charge", label: "Del Packing 2%", w: 95, type: "number", ro: true },
    { key: "delivery_charge", label: "Del Charge 5%", w: 95, type: "number", ro: true },
    { key: "re_stock", label: "Re Stock", w: 75, type: "number" },
    { key: "gst_amount", label: "GST 5%", w: 75, type: "number", ro: true },
    { key: "discount", label: "Discount 2%", w: 85, type: "number", ro: true },
    { key: "total_final", label: "Total", w: 85, type: "number", ro: true },
    { key: "cash_received_by", label: "Payment", w: 90, type: "select-payment" },
    { key: "remark", label: "Remark", w: 100, type: "text" },
    { key: "mrp", label: "MRP", w: 80, type: "number" },
    { key: "mop", label: "MOP", w: 80, type: "number" },
  ];

  function renderCell(idx: number, col: (typeof COLS)[number], row: ProductRow) {
    const field = col.key as keyof ProductRow;
    switch (col.type) {
      case "select-supplier":
        return (
          <select
            value={String(row[field])}
            onChange={(e) => patchRow(idx, { [field]: e.target.value })}
            className="h-full w-full border-0 bg-transparent px-1.5 py-1 text-[11px] outline-none focus:bg-secondary-soft"
            style={{ minWidth: col.w }}
          >
            <option value="">— select —</option>
            {(suppliers ?? []).map((s) => (
              <option key={s.id} value={s.name}>{s.name}</option>
            ))}
          </select>
        );
      case "select-category":
        return (
          <select
            value={String(row[field])}
            onChange={(e) => patchRow(idx, { [field]: e.target.value })}
            className="h-full w-full border-0 bg-transparent px-1.5 py-1 text-[11px] outline-none focus:bg-secondary-soft"
            style={{ minWidth: col.w }}
          >
            <option value="">— select —</option>
            {(categories ?? []).map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        );
      case "select-unit":
        return <Cell row={row} field={field} options={UNITS} width={col.w} />;
      case "select-payment":
        return <Cell row={row} field={field} options={PAYMENT_METHODS} width={col.w} />;
      case "image":
        return <Cell row={row} field={field} type="image" />;
      case "date":
        return <Cell row={row} field={field} type="date" width={col.w} />;
      case "number":
        return <Cell row={row} field={field} type="number" width={col.w} readOnly={col.ro} />;
      default:
        return <Cell row={row} field={field} width={col.w} readOnly={col.ro} />;
    }
  }

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
          onClick={addProduct}
          className="flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-xs font-semibold text-white hover:bg-primary/90"
        >
          <Plus className="h-3.5 w-3.5" /> Add Product
        </button>
        <button
          onClick={saveAll}
          disabled={saving}
          className="flex items-center gap-1.5 rounded-lg bg-secondary px-4 py-2 text-xs font-semibold text-white hover:bg-secondary/90 disabled:opacity-60"
        >
          {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
          {saving ? "Saving…" : "Save All"}
        </button>
      </div>

      {/* Product search results dropdown */}
      {searchQ.trim() && filteredProducts.length > 0 && (
        <div className="rounded-xl border border-border bg-white shadow-lg p-2 max-h-60 overflow-y-auto">
          <div className="text-[10px] font-semibold text-muted-foreground uppercase px-2 mb-1">
            Existing products — click to load into next empty row
          </div>
          {filteredProducts.slice(0, 20).map((p) => (
            <button
              key={p.id}
              onClick={() => {
                const emptyIdx = calculatedRows.findIndex((r) => !r.name.trim());
                if (emptyIdx < 0) {
                  setRows((prev) => [...prev, blankRow(prev.length + 1)]);
                }
                setTimeout(() => {
                  setRows((prev) => {
                    const idx = emptyIdx >= 0 ? emptyIdx : prev.length - 1;
                    const updated = [...prev];
                    updated[idx] = { ...updated[idx],
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
                    };
                    return updated;
                  });
                }, 0);
                setSearchQ("");
                toast.success(`Loaded: ${p.name}`);
              }}
              className="flex items-center gap-3 w-full px-2 py-1.5 rounded-lg hover:bg-secondary-soft text-left"
            >
              <div className="h-8 w-8 rounded bg-muted overflow-hidden shrink-0">
                {p.image_urls?.[0] ? (
                  <img src={p.image_urls[0]} alt="" className="h-full w-full object-cover" />
                ) : null}
              </div>
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

      {/* Excel-style table */}
      <div className="rounded-xl border border-border bg-white shadow-sm overflow-hidden">
        <div ref={tableRef} className="overflow-auto max-h-[calc(100vh-220px)]">
          <table className="border-collapse" style={{ minWidth: COLS.reduce((s, c) => s + c.w, 0) }}>
            <thead className="sticky top-0 z-20">
              <tr>
                {COLS.map((col) => (
                  <th
                    key={col.key}
                    className="bg-muted text-[10px] font-bold uppercase tracking-wider text-muted-foreground border border-border px-1 py-2 text-center whitespace-nowrap"
                    style={{ minWidth: col.w, maxWidth: col.w }}
                  >
                    {col.label}
                  </th>
                ))}
                <th className="bg-muted text-[10px] font-bold uppercase tracking-wider text-muted-foreground border border-border px-1 py-2 w-20">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody>
              {calculatedRows.map((row, idx) => (
                <tr key={row._rowId} className="group hover:bg-secondary-soft/30">
                  {COLS.map((col) => (
                    <td
                      key={col.key}
                      className="border border-border p-0 h-8"
                      style={{ minWidth: col.w, maxWidth: col.w + 20 }}
                    >
                      {renderCell(idx, col, row)}
                    </td>
                  ))}
                  <td className="border border-border p-1 h-8 w-20">
                    <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button
                        onClick={() => duplicateRow(idx)}
                        className="rounded p-1 hover:bg-secondary-soft"
                        title="Duplicate row"
                      >
                        <Copy className="h-3 w-3 text-muted-foreground" />
                      </button>
                      <button
                        onClick={() => deleteRow(idx)}
                        disabled={calculatedRows.length <= 1}
                        className="rounded p-1 hover:bg-rose-50 disabled:opacity-30"
                        title="Delete row"
                      >
                        <Trash2 className="h-3 w-3 text-rose-600" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="bg-muted font-bold">
                <td colSpan={13} className="border border-border px-2 py-1.5 text-[11px] text-right text-muted-foreground">
                  GRAND TOTALS:
                </td>
                <td className="border border-border px-1.5 py-1.5 text-[11px] text-right">
                  ₹{grandTotals.total_price.toFixed(2)}
                </td>
                <td colSpan={3} className="border border-border px-1.5 py-1.5 text-[11px] text-right">—</td>
                <td className="border border-border px-1.5 py-1.5 text-[11px] text-right">
                  ₹{grandTotals.final_purchase_cost.toFixed(2)}
                </td>
                <td colSpan={14} className="border border-border px-1.5 py-1.5 text-[11px] text-right">—</td>
                <td className="border border-border px-1.5 py-1.5 text-[11px] text-right text-emerald-700">
                  ₹{grandTotals.total_final.toFixed(2)}
                </td>
                <td className="border border-border px-1.5 py-1.5 text-[11px] text-right">
                  GST: ₹{grandTotals.gst.toFixed(2)}
                </td>
                <td className="border border-border px-1.5 py-1.5 text-[11px] text-right">
                  Disc: ₹{grandTotals.discount.toFixed(2)}
                </td>
                <td className="border border-border"></td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>

      {/* Quick add row button at bottom */}
      <button
        onClick={addProduct}
        className="w-full rounded-xl border-2 border-dashed border-border py-3 text-xs font-semibold text-muted-foreground hover:border-secondary hover:text-secondary transition"
      >
        <Plus className="inline h-3.5 w-3.5 mr-1" /> Add new product row
      </button>
    </div>
  );
}
