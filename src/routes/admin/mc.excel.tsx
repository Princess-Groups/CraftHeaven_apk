import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useState, useRef } from "react";
import { FileSpreadsheet, Upload, Download, AlertTriangle, CheckCircle, X } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/admin/mc/excel")({
  head: () => ({ meta: [{ title: "Excel Import / Export — Multi-Channel" }] }),
  component: MCExcel,
});

type ImportRow = {
  name: string;
  sku: string;
  barcode: string;
  category: string;
  purchase_price: number;
  selling_price: number;
  stock: number;
  unit: string;
  supplier: string;
  valid: boolean;
  errors: string[];
};

function MCExcel() {
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [importType, setImportType] = useState<"products" | "inventory" | "pricing">("products");
  const [preview, setPreview] = useState<ImportRow[]>([]);
  const [importing, setImporting] = useState(false);
  const [showPreview, setShowPreview] = useState(false);

  const { data: importJobs } = useQuery({
    queryKey: ["mc-import-jobs"],
    queryFn: async () =>
      (await supabase.from("mc_import_jobs").select("*").order("created_at", { ascending: false }).limit(20)).data ?? [],
  });

  function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = ev.target?.result as string;
      const lines = text.split("\n").filter(Boolean);
      if (lines.length < 2) return toast.error("No data rows found");
      const headers = lines[0].split(",").map((h) => h.trim().toLowerCase());
      const rows: ImportRow[] = [];
      for (let i = 1; i < lines.length; i++) {
        const cols = lines[i].split(",").map((c) => c.trim());
        const errors: string[] = [];
        const name = cols[headers.indexOf("name")] || cols[headers.indexOf("product name")] || "";
        const sku = cols[headers.indexOf("sku")] || "";
        const barcode = cols[headers.indexOf("barcode")] || "";
        const purchasePrice = Number(cols[headers.indexOf("purchase price")] || cols[headers.indexOf("purchase_price")] || 0);
        const sellingPrice = Number(cols[headers.indexOf("selling price")] || cols[headers.indexOf("selling_price")] || 0);
        const stock = Number(cols[headers.indexOf("stock")] || cols[headers.indexOf("quantity")] || 0);
        if (!name.trim()) errors.push("Missing product name");
        if (sellingPrice <= 0) errors.push("Invalid selling price");
        if (stock < 0) errors.push("Invalid stock quantity");
        // Duplicate check
        if (rows.some((r) => r.sku && r.sku === sku && sku)) errors.push("Duplicate SKU");
        if (rows.some((r) => r.barcode && r.barcode === barcode && barcode)) errors.push("Duplicate barcode");
        rows.push({
          name: name.trim(),
          sku,
          barcode,
          category: cols[headers.indexOf("category")] || "",
          purchase_price: purchasePrice,
          selling_price: sellingPrice,
          stock,
          unit: cols[headers.indexOf("unit")] || "Nos",
          supplier: cols[headers.indexOf("supplier")] || "",
          valid: errors.length === 0,
          errors,
        });
      }
      setPreview(rows);
      setShowPreview(true);
    };
    reader.readAsText(file);
    e.target.value = "";
  }

  async function runImport() {
    const validRows = preview.filter((r) => r.valid);
    if (!validRows.length) return toast.error("No valid rows to import");
    setImporting(true);
    const jobRes = await supabase.from("mc_import_jobs").insert({
      filename: `manual-import-${new Date().toISOString().slice(0, 10)}.csv`,
      entity_type: importType,
      status: "IMPORTING",
      total_rows: preview.length,
      valid_rows: validRows.length,
      error_rows: preview.length - validRows.length,
    }).select("id").single();

    let imported = 0;
    for (const row of validRows) {
      if (importType === "products") {
        const { error } = await supabase.from("mc_master_products").insert({
          name: row.name,
          sku: row.sku || null,
          barcode: row.barcode || null,
          purchase_price: row.purchase_price,
          selling_price: row.selling_price,
          current_stock: row.stock,
          available_stock: row.stock,
          unit: row.unit,
          supplier_name: row.supplier || null,
          status: "ACTIVE",
        });
        if (!error) imported++;
      }
    }

    if (jobRes.data) {
      await supabase.from("mc_import_jobs").update({
        status: "COMPLETED",
        imported_by: (await supabase.auth.getUser()).data.user?.id,
        completed_at: new Date().toISOString(),
      }).eq("id", jobRes.data.id);
    }

    toast.success(`Imported ${imported} of ${validRows.length} valid rows`);
    setShowPreview(false);
    setPreview([]);
    setImporting(false);
    qc.invalidateQueries({ queryKey: ["mc-master-products"] });
    qc.invalidateQueries({ queryKey: ["mc-import-jobs"] });
  }

  function exportProducts() {
    supabase.from("mc_master_products").select("*").then(({ data }) => {
      if (!data?.length) return toast.error("No products to export");
      const headers = ["Name", "SKU", "Barcode", "Category", "Purchase Price", "Selling Price", "Stock", "Unit", "Supplier", "Status"];
      const rows = data.map((p) => [p.name, p.sku ?? "", p.barcode ?? "", p.category_id ?? "", p.purchase_price, p.selling_price, p.current_stock, p.unit, p.supplier_name ?? "", p.status]);
      const csv = [headers.join(","), ...rows.map((r) => r.join(","))].join("\n");
      const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
      const a = document.createElement("a");
      a.href = url;
      a.download = `mc-products-${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success("Products exported");
    });
  }

  function exportInventory() {
    supabase.from("mc_inventory").select("*, mc_master_products(name,sku)").then(({ data }) => {
      if (!data?.length) return toast.error("No inventory to export");
      const headers = ["Product", "SKU", "Physical Stock", "Available", "Reserved", "Sold", "Damaged", "Reorder Level"];
      const rows = data.map((i) => [i.mc_master_products?.name ?? "", i.mc_master_products?.sku ?? "", i.physical_stock, i.available_stock, i.reserved_stock, i.sold_stock, i.damaged_stock, i.reorder_level]);
      const csv = [headers.join(","), ...rows.map((r) => r.join(","))].join("\n");
      const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
      const a = document.createElement("a");
      a.href = url;
      a.download = `mc-inventory-${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success("Inventory exported");
    });
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <FileSpreadsheet className="h-5 w-5 text-primary" />
        <h1 className="text-xl font-bold text-foreground">Excel Import / Export</h1>
      </div>

      {/* Import Section */}
      <div className="rounded-xl border border-border bg-white shadow-sm p-4">
        <h2 className="text-sm font-bold text-foreground mb-3">Import Data</h2>
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex gap-1 rounded-lg border border-border bg-white p-0.5">
            {(["products", "inventory", "pricing"] as const).map((t) => (
              <button key={t} onClick={() => setImportType(t)} className={`rounded-md px-2.5 py-1 text-[11px] font-semibold capitalize transition ${importType === t ? "bg-primary text-white" : "text-muted-foreground hover:bg-secondary-soft"}`}>
                {t}
              </button>
            ))}
          </div>
          <label className="flex items-center gap-1.5 rounded-lg border border-border bg-white px-3 py-2 text-xs font-semibold text-muted-foreground cursor-pointer hover:bg-secondary-soft">
            <Upload className="h-3.5 w-3.5" /> Upload CSV
            <input ref={fileRef} type="file" accept=".csv" className="sr-only" onChange={handleFileUpload} />
          </label>
          <p className="text-[10px] text-muted-foreground/70">
            Required columns: {importType === "products" ? "Name, SKU, Barcode, Purchase Price, Selling Price, Stock" : importType === "inventory" ? "Product, Quantity, Type" : "Product, Channel, Price"}
          </p>
        </div>
      </div>

      {/* Export Section */}
      <div className="rounded-xl border border-border bg-white shadow-sm p-4">
        <h2 className="text-sm font-bold text-foreground mb-3">Export Data</h2>
        <div className="flex flex-wrap gap-2">
          <button onClick={exportProducts} className="flex items-center gap-1.5 rounded-lg border border-border bg-white px-3 py-2 text-xs font-semibold text-muted-foreground hover:bg-secondary-soft">
            <Download className="h-3.5 w-3.5" /> Products
          </button>
          <button onClick={exportInventory} className="flex items-center gap-1.5 rounded-lg border border-border bg-white px-3 py-2 text-xs font-semibold text-muted-foreground hover:bg-secondary-soft">
            <Download className="h-3.5 w-3.5" /> Inventory
          </button>
        </div>
      </div>

      {/* Import Preview Modal */}
      {showPreview && (
        <div className="fixed inset-0 z-50 bg-black/40 grid place-items-center p-4" onClick={() => setShowPreview(false)}>
          <div className="w-full max-w-3xl rounded-2xl bg-white p-6 shadow-2xl max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-sm font-bold text-foreground">Import Preview</h2>
              <button onClick={() => setShowPreview(false)} className="rounded-lg p-1 hover:bg-secondary-soft"><X className="h-4 w-4" /></button>
            </div>
            <div className="flex gap-3 mb-3">
              <div className="flex items-center gap-1 text-xs"><CheckCircle className="h-3.5 w-3.5 text-green-600" /> {preview.filter((r) => r.valid).length} valid</div>
              <div className="flex items-center gap-1 text-xs"><AlertTriangle className="h-3.5 w-3.5 text-rose-600" /> {preview.filter((r) => !r.valid).length} errors</div>
            </div>
            <div className="rounded-lg border border-border overflow-hidden max-h-64 overflow-y-auto">
              <table className="w-full text-xs">
                <thead className="bg-muted sticky top-0">
                  <tr>
                    <th className="px-2 py-1.5 text-left font-bold">#</th>
                    <th className="px-2 py-1.5 text-left font-bold">Name</th>
                    <th className="px-2 py-1.5 text-left font-bold">SKU</th>
                    <th className="px-2 py-1.5 text-right font-bold">Price</th>
                    <th className="px-2 py-1.5 text-right font-bold">Stock</th>
                    <th className="px-2 py-1.5 text-center font-bold">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.map((r, i) => (
                    <tr key={i} className={`border-t border-border/50 ${r.valid ? "" : "bg-rose-50/50"}`}>
                      <td className="px-2 py-1.5">{i + 1}</td>
                      <td className="px-2 py-1.5 font-semibold">{r.name}</td>
                      <td className="px-2 py-1.5 font-mono">{r.sku || "—"}</td>
                      <td className="px-2 py-1.5 text-right">₹{r.selling_price}</td>
                      <td className="px-2 py-1.5 text-right">{r.stock}</td>
                      <td className="px-2 py-1.5 text-center">
                        {r.valid ? (
                          <CheckCircle className="h-3.5 w-3.5 text-green-600 inline" />
                        ) : (
                          <span className="text-[9px] text-rose-600" title={r.errors.join(", ")}>{r.errors.length} error(s)</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex justify-end gap-2 mt-4">
              <button onClick={() => setShowPreview(false)} className="rounded-lg border border-border px-4 py-2 text-xs font-semibold text-muted-foreground hover:bg-secondary-soft">Cancel</button>
              <button onClick={runImport} disabled={importing || preview.filter((r) => r.valid).length === 0} className="rounded-lg bg-primary px-5 py-2 text-xs font-semibold text-white hover:bg-primary/90 disabled:opacity-50">
                {importing ? "Importing…" : `Import ${preview.filter((r) => r.valid).length} Rows`}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Import History */}
      <div className="rounded-xl border border-border bg-white shadow-sm overflow-hidden">
        <div className="px-4 py-3 border-b border-border">
          <h2 className="text-sm font-bold text-foreground">Import History</h2>
        </div>
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-muted">
              <th className="px-3 py-2 text-[10px] font-bold uppercase text-muted-foreground text-left border-b border-border">Date</th>
              <th className="px-3 py-2 text-[10px] font-bold uppercase text-muted-foreground text-left border-b border-border">File</th>
              <th className="px-3 py-2 text-[10px] font-bold uppercase text-muted-foreground text-center border-b border-border">Type</th>
              <th className="px-3 py-2 text-[10px] font-bold uppercase text-muted-foreground text-center border-b border-border">Status</th>
              <th className="px-3 py-2 text-[10px] font-bold uppercase text-muted-foreground text-center border-b border-border">Rows</th>
            </tr>
          </thead>
          <tbody>
            {(importJobs ?? []).map((j) => (
              <tr key={j.id} className="border-b border-border/50 last:border-0">
                <td className="px-3 py-2 text-xs">{new Date(j.created_at).toLocaleString("en-IN")}</td>
                <td className="px-3 py-2 text-xs font-mono truncate max-w-[200px]">{j.filename}</td>
                <td className="px-3 py-2 text-center text-xs uppercase">{j.entity_type}</td>
                <td className="px-3 py-2 text-center">
                  <span className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded-full ${
                    j.status === "COMPLETED" ? "bg-green-50 text-green-700" :
                    j.status === "FAILED" ? "bg-rose-50 text-rose-700" :
                    "bg-gray-50 text-gray-600"
                  }`}>{j.status}</span>
                </td>
                <td className="px-3 py-2 text-center text-xs">{j.valid_rows}/{j.total_rows}</td>
              </tr>
            ))}
            {(!importJobs || importJobs.length === 0) && (
              <tr><td colSpan={5} className="px-6 py-8 text-center text-xs text-muted-foreground/70">No import history</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
