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
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import { toast } from "sonner";
import { uploadProductImage } from "@/lib/upload";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

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
  delivery_packing_rate: number;
  delivery_packing_charge: number;
  delivery_charge_rate: number;
  delivery_charge: number;
  re_stock: number;
  gst_rate: number;
  gst_amount: number;
  discount_rate: number;
  discount: number;
  total_final: number;
  cash_received_by: string;
  remark: string;
  mrp: number;
  mop: number;
  packets: number;
  total_unit: number;
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
  delivery_packing_rate: 0,
  delivery_packing_charge: 0,
  delivery_charge_rate: 0,
  delivery_charge: 0,
  re_stock: 0,
  gst_rate: 0,
  gst_amount: 0,
  discount_rate: 0,
  discount: 0,
  total_final: 0,
  cash_received_by: "",
  remark: "",
  mrp: 0,
  mop: 0,
  packets: 1,
  total_unit: 0,
});

const UNITS = ["Nos", "Packet", "Unit", "KG", "G", "L", "ML", "M", "CM", "INC", "DIAM"] as const;
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
  const del_packing_pct = Math.min(Math.max(Number(r.delivery_packing_rate) || 0, 0), 100);
  const del_charge_pct = Math.min(Math.max(Number(r.delivery_charge_rate) || 0, 0), 100);
  const gst_pct = Math.min(Math.max(Number(r.gst_rate) || 0, 0), 100);
  const disc_pct = Math.min(Math.max(Number(r.discount_rate) || 0, 0), 100);
  const del_packing = final_purchase_cost * del_packing_pct / 100;
  const del_charge = final_purchase_cost * del_charge_pct / 100;
  const gst = final_purchase_cost * gst_pct / 100;
  const disc = final_purchase_cost * disc_pct / 100;
  const total_final = final_purchase_cost + del_packing + del_charge + gst - disc;

  // Per Packet Unit / Total Unit calculation
  const packets = Number(r.packets) || 0;
  const total_unit = qty * packets;

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
    total_unit,
  };
}

// ---------- Stable Cell component (outside parent) ----------
// We store patchRow in a ref so the Cell never needs to re-render
// when only the handler reference changes.
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

  // If the value is "Packet" or starts with "Packet" followed by a space (manual entry mode)
  // show a text input for manual entry
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

  // Otherwise, show the dropdown
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

// ---------- Component ----------
function Purchases() {
  const qc = useQueryClient();
  const [rows, setRows] = useState<ProductRow[]>([blankRow(1)]);
  const [searchQ, setSearchQ] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [uploading, setUploading] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [dialogIdx, setDialogIdx] = useState<number | null>(null);

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
    const newIdx = rows.length;
    setRows((prev) => [...prev, blankRow(prev.length + 1)]);
    setDialogIdx(newIdx);
    setDialogOpen(true);
  }

  function editProduct(idx: number) {
    setDialogIdx(idx);
    setDialogOpen(true);
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
      "Rack Location", "Del Packing %", "Del Packing Amt", "Del Charge %", "Del Charge Amt",
      "Re Stock", "GST %", "GST Amt", "Discount %", "Discount Amt", "Total",
      "Payment", "Remark", "MRP", "MOP",
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

  // Field layout definitions for each Product Entry Card
  const FIELD_GROUPS = [
    {
      title: "Product Details",
      fields: [
        { key: "serial", label: "Serial No.", type: "text", ro: true },
        { key: "name", label: "Product Name", type: "text" },
        { key: "barcode", label: "Barcode", type: "text" },
        { key: "image_url", label: "Image", type: "image" },
        { key: "date", label: "Date", type: "date" },
        { key: "category_id", label: "Category", type: "select-category" },
        { key: "supplier_name", label: "Supplier Name", type: "select-supplier" },
        { key: "supplier_bill_no", label: "Supplier Bill No", type: "text" },
      ],
    },
    {
      title: "Pricing",
      fields: [
        { key: "unit_price", label: "Unit Price", type: "number" },
        { key: "total_price", label: "Total Price", type: "number", ro: true },
        { key: "retail_selling_price", label: "Retail Price", type: "number" },
        { key: "wholesale_price", label: "Wholesale Price", type: "number" },
        { key: "mrp", label: "MRP", type: "number" },
        { key: "mop", label: "MOP", type: "number" },
        { key: "profit_per_piece_pct", label: "Profit %", type: "number", ro: true },
      ],
    },
    {
      title: "Per Packet Unit & Total Unit",
      fields: [
        { key: "per_packet_unit", label: "Per Packet Unit", type: "select-unit" },
        { key: "quantity", label: "Quantity (Per Packet)", type: "number" },
        { key: "packets", label: "Number of Packets", type: "number" },
        { key: "total_unit", label: "Total Unit", type: "number", ro: true },
      ],
    },
    {
      title: "Charges & Cost",
      fields: [
        { key: "purchase_packing_charge", label: "Packing Charge", type: "number" },
        { key: "purchase_freight_charges", label: "Freight Charges", type: "number" },
        { key: "other_charges", label: "Other Charges", type: "number" },
        { key: "total_unit_cost", label: "Total Unit Cost", type: "number", ro: true },
        { key: "final_purchase_cost", label: "Final Purchase Cost", type: "number", ro: true },
      ],
    },
    {
      title: "Delivery & Tax",
      fields: [
        { key: "delivery_packing_rate", label: "Del Packing %", type: "number" },
        { key: "delivery_packing_charge", label: "Del Packing Amt", type: "number", ro: true },
        { key: "delivery_charge_rate", label: "Del Charge %", type: "number" },
        { key: "delivery_charge", label: "Del Charge Amt", type: "number", ro: true },
        { key: "gst_rate", label: "GST %", type: "number" },
        { key: "gst_amount", label: "GST Amt", type: "number", ro: true },
        { key: "discount_rate", label: "Discount %", type: "number" },
        { key: "discount", label: "Discount Amt", type: "number", ro: true },
        { key: "total_final", label: "Total Final", type: "number", ro: true },
      ],
    },
    {
      title: "Stock & Sales",
      fields: [
        { key: "minimum_stock", label: "Min Stock", type: "number" },
        { key: "current_stock", label: "Current Stock", type: "number" },
        { key: "rack_location", label: "Rack Location", type: "text" },
        { key: "re_stock", label: "Re Stock", type: "number" },
        { key: "pieces_sold", label: "Pieces Sold", type: "number" },
        { key: "sold_for", label: "Sold For", type: "number" },
        { key: "total_sold", label: "Total Sold", type: "number", ro: true },
      ],
    },
    {
      title: "Other",
      fields: [
        { key: "material", label: "Material", type: "text" },
        { key: "colour", label: "Colour", type: "text" },
        { key: "cash_received_by", label: "Payment", type: "select-payment" },
        { key: "remark", label: "Remark", type: "text" },
      ],
    },
  ];

  // Collapsible section state
  const [collapsedSections, setCollapsedSections] = useState<Record<string, boolean>>({});
  const toggleSection = (cardId: string, sectionTitle: string) => {
    const key = `${cardId}-${sectionTitle}`;
    setCollapsedSections((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  function renderFieldInput(
    idx: number,
    fieldDef: { key: string; label: string; type: string; ro?: boolean },
    row: ProductRow
  ) {
    const field = fieldDef.key as keyof ProductRow;
    switch (fieldDef.type) {
      case "select-supplier":
        return (
          <select
            value={String(row[field])}
            onChange={(e) => patchRow(idx, { [field]: e.target.value })}
            className="w-full rounded-lg border border-border bg-white px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
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
          <UnitCell
            row={row}
            field={field}
            options={UNITS}
            idx={idx}
          />
        );
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
        if (fieldDef.ro) {
          return (
            <input
              type="text"
              value={String(row[field] ?? "")}
              readOnly
              className="w-full rounded-lg border border-border bg-muted/50 px-3 py-2 text-sm font-semibold outline-none cursor-default"
            />
          );
        }
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

      {/* Compact Product List */}
      <div className="rounded-xl border border-border bg-white shadow-sm overflow-hidden">
        <div className="overflow-auto max-h-[calc(100vh-220px)]">
          <table className="w-full border-collapse text-sm">
            <thead className="sticky top-0 z-10">
              <tr className="bg-muted">
                <th className="px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-muted-foreground text-center border-b border-border w-12">S.No</th>
                <th className="px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-muted-foreground text-left border-b border-border">Product Name</th>
                <th className="px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-muted-foreground text-left border-b border-border">Barcode</th>
                <th className="px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-muted-foreground text-right border-b border-border">Unit Price</th>
                <th className="px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-muted-foreground text-right border-b border-border">Qty</th>
                <th className="px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-muted-foreground text-right border-b border-border">Total Price</th>
                <th className="px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-muted-foreground text-right border-b border-border">Final Cost</th>
                <th className="px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-muted-foreground text-center border-b border-border w-24">Actions</th>
              </tr>
            </thead>
            <tbody>
              {calculatedRows.map((row, idx) => (
                <tr key={row._rowId} className="group hover:bg-secondary-soft/30 border-b border-border/50 last:border-0">
                  <td className="px-3 py-2 text-center text-xs text-muted-foreground font-semibold">{row.serial}</td>
                  <td className="px-3 py-2 text-xs font-semibold text-foreground">{row.name || <span className="text-muted-foreground italic">No name</span>}</td>
                  <td className="px-3 py-2 text-xs text-muted-foreground">{row.barcode || "—"}</td>
                  <td className="px-3 py-2 text-xs text-right text-foreground">₹{(Number(row.unit_price) || 0).toFixed(2)}</td>
                  <td className="px-3 py-2 text-xs text-right text-foreground">{row.quantity}</td>
                  <td className="px-3 py-2 text-xs text-right font-semibold text-foreground">₹{(Number(row.total_price) || 0).toFixed(2)}</td>
                  <td className="px-3 py-2 text-xs text-right font-semibold text-emerald-700">₹{(Number(row.final_purchase_cost) || 0).toFixed(2)}</td>
                  <td className="px-3 py-2">
                    <div className="flex items-center justify-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button
                        onClick={() => editProduct(idx)}
                        className="rounded p-1 hover:bg-secondary-soft text-primary"
                        title="Edit product"
                      >
                        <Search className="h-3.5 w-3.5" />
                      </button>
                      <button
                        onClick={() => duplicateRow(idx)}
                        className="rounded p-1 hover:bg-secondary-soft"
                        title="Duplicate product"
                      >
                        <Copy className="h-3.5 w-3.5 text-muted-foreground" />
                      </button>
                      <button
                        onClick={() => deleteRow(idx)}
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
              {calculatedRows.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-4 py-8 text-center text-sm text-muted-foreground">
                    No products yet. Click <strong>+ Add Product</strong> to begin.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Grand Totals */}
      <Card className="shadow-card border-border/60">
        <CardContent className="p-4">
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
        </CardContent>
      </Card>

      {/* Bottom Add Product button */}
      <button
        onClick={addProduct}
        className="w-full flex items-center justify-center gap-2 rounded-xl border-2 border-dashed border-primary/30 py-3 text-xs font-semibold text-primary hover:border-primary hover:bg-primary-soft/50 transition"
      >
        <Plus className="h-4 w-4" /> Add Product
      </button>

      {/* Product Entry Dialog Overlay */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-base font-bold text-primary">
              {dialogIdx !== null && calculatedRows[dialogIdx]?.name
                ? `Edit Product ${String(calculatedRows[dialogIdx].serial).padStart(2, "0")}`
                : "Add New Product"}
            </DialogTitle>
          </DialogHeader>
          {dialogIdx !== null && calculatedRows[dialogIdx] && (
            <div className="space-y-4 pt-2">
              {FIELD_GROUPS.map((group) => {
                const sectionKey = `dialog-${group.title}`;
                const isCollapsed = collapsedSections[sectionKey] ?? (group.title !== "Product Details" && group.title !== "Per Packet Unit & Total Unit");
                return (
                  <div key={group.title} className="rounded-xl border border-border/50 bg-white/50 overflow-hidden">
                    <button
                      onClick={() => toggleSection("dialog", group.title)}
                      className="w-full flex items-center justify-between px-4 py-2.5 bg-muted/30 hover:bg-muted/50 transition text-left"
                    >
                      <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                        {group.title}
                      </span>
                      {isCollapsed ? (
                        <ChevronDown className="h-4 w-4 text-muted-foreground" />
                      ) : (
                        <ChevronUp className="h-4 w-4 text-muted-foreground" />
                      )}
                    </button>
                    {!isCollapsed && (
                      <div className="p-4">
                        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                          {group.fields.map((f) => (
                            <div key={f.key} className="space-y-1">
                              <Label className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">
                                {f.label}
                              </Label>
                              {renderFieldInput(dialogIdx, f, calculatedRows[dialogIdx])}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
