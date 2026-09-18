/**
 * Barcode Sticker Printing Service
 * Handles post-purchase barcode data extraction and CSV/Excel export for VPrint
 */

import { SlotProduct, PurchaseSlot, BarcodeStickerItem, BarcodeStickerExport } from "../types/index.js";

export class BarcodeStickerService {
  private slots: Map<string, PurchaseSlot> = new Map();

  // Add a completed purchase slot
  addSlot(slot: PurchaseSlot): void {
    this.slots.set(slot.id, slot);
  }

  // Get all completed slots
  getCompletedSlots(): PurchaseSlot[] {
    return Array.from(this.slots.values()).filter(s => s.status === "completed");
  }

  // Get slot by ID
  getSlot(slotId: string): PurchaseSlot | undefined {
    return this.slots.get(slotId);
  }

  // Get products for a slot formatted for barcode sticker printing
  getStickerData(slotId: string): BarcodeStickerItem[] {
    const slot = this.slots.get(slotId);
    if (!slot) return [];

    return slot.products.map(product => ({
      productName: product.productName,
      sku: product.sku,
      barcode: product.barcode,
      quantity: product.quantity,
      mrp: product.mrp,
      sellingPrice: product.sellingPrice,
    }));
  }

  // Export to CSV format for VPrint
  exportToCSV(slotId: string): string {
    const slot = this.slots.get(slotId);
    if (!slot) throw new Error(`Slot ${slotId} not found`);

    const items = this.getStickerData(slotId);

    // VPrint compatible CSV format
    const headers = [
      "Product Name",
      "SKU / Item Code",
      "Barcode Number",
      "Quantity",
      "MRP",
      "Selling Price"
    ];

    const rows = items.map(item => [
      this.escapeCSV(item.productName),
      this.escapeCSV(item.sku),
      this.escapeCSV(item.barcode),
      item.quantity.toString(),
      `₹${item.mrp.toFixed(2)}`,
      `₹${item.sellingPrice.toFixed(2)}`
    ]);

    return [headers.join(","), ...rows.map(r => r.join(","))].join("\n");
  }

  // Export to Excel-compatible CSV (with BOM for Excel)
  exportToExcelCSV(slotId: string): Uint8Array {
    const csv = this.exportToCSV(slotId);
    // Add UTF-8 BOM for Excel compatibility
    const bom = new Uint8Array([0xEF, 0xBB, 0xBF]);
    const content = new TextEncoder().encode(csv);
    const result = new Uint8Array(bom.length + content.length);
    result.set(bom);
    result.set(content, bom.length);
    return result;
  }

  // Generate full export object
  generateExport(slotId: string): BarcodeStickerExport {
    const slot = this.slots.get(slotId);
    if (!slot) throw new Error(`Slot ${slotId} not found`);

    return {
      slotId: slot.id,
      slotName: slot.name,
      exportDate: new Date().toISOString(),
      items: this.getStickerData(slotId)
    };
  }

  // Export as JSON for API consumption
  exportToJSON(slotId: string): string {
    const exportData = this.generateExport(slotId);
    return JSON.stringify(exportData, null, 2);
  }

  // Create downloadable file
  createDownload(slotId: string, format: "csv" | "json" | "excel" = "excel"): {
    filename: string;
    content: Uint8Array;
    mimeType: string;
  } {
    const slot = this.slots.get(slotId);
    if (!slot) throw new Error(`Slot ${slotId} not found`);

    const safeSlotName = slot.name.replace(/[^a-zA-Z0-9]/g, "_");
    const dateStr = new Date().toISOString().split("T")[0];

    switch (format) {
      case "csv": {
        const content = new TextEncoder().encode(this.exportToCSV(slotId));
        return {
          filename: `Barcode_Stickers_${safeSlotName}_${dateStr}.csv`,
          content,
          mimeType: "text/csv"
        };
      }
      case "excel": {
        const content = this.exportToExcelCSV(slotId);
        return {
          filename: `Barcode_Stickers_${safeSlotName}_${dateStr}.csv`,
          content,
          mimeType: "text/csv"
        };
      }
      case "json": {
        const content = new TextEncoder().encode(this.exportToJSON(slotId));
        return {
          filename: `Barcode_Stickers_${safeSlotName}_${dateStr}.json`,
          content,
          mimeType: "application/json"
        };
      }
    }
  }

  // VPrint-specific format (extended columns)
  exportForVPrint(slotId: string): string {
    const slot = this.slots.get(slotId);
    if (!slot) throw new Error(`Slot ${slotId} not found`);

    const items = this.getStickerData(slotId);

    // VPrint typically expects these columns
    const headers = [
      "ItemCode",
      "ItemName",
      "Barcode",
      "Qty",
      "MRP",
      "SalePrice",
      "GST%",
      "HSNCode"
    ];

    const rows = slot.products.map(product => [
      this.escapeCSV(product.sku),
      this.escapeCSV(product.productName),
      this.escapeCSV(product.barcode),
      product.quantity.toString(),
      product.mrp.toFixed(2),
      product.sellingPrice.toFixed(2),
      product.gstRate.toString(),
      product.hsnCode || ""
    ]);

    return [headers.join(","), ...rows.map(r => r.join(","))].join("\n");
  }

  private escapeCSV(value: string): string {
    if (value.includes(",") || value.includes("\"") || value.includes("\n")) {
      return `"${value.replace(/"/g, "\"\"")}"`;
    }
    return value;
  }

  // Get summary for UI display
  getSlotSummary(slotId: string): {
    slotName: string;
    totalProducts: number;
    totalQuantity: number;
    products: Array<{ name: string; sku: string; barcode: string; qty: number; mrp: number; price: number }>;
  } | null {
    const slot = this.slots.get(slotId);
    if (!slot) return null;

    return {
      slotName: slot.name,
      totalProducts: slot.products.length,
      totalQuantity: slot.totalQuantity,
      products: slot.products.map(p => ({
        name: p.productName,
        sku: p.sku,
        barcode: p.barcode,
        qty: p.quantity,
        mrp: p.mrp,
        price: p.sellingPrice
      }))
    };
  }

  // Clear old slots (optional cleanup)
  clearOldSlots(olderThanDays: number = 30): number {
    const cutoff = Date.now() - (olderThanDays * 24 * 60 * 60 * 1000);
    let cleared = 0;

    for (const [id, slot] of this.slots.entries()) {
      const slotDate = new Date(slot.date).getTime();
      if (slotDate < cutoff) {
        this.slots.delete(id);
        cleared++;
      }
    }

    return cleared;
  }
}

// Singleton instance
export const barcodeStickerService = new BarcodeStickerService();