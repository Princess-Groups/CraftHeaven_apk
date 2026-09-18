/**
 * Purchase Entry Integration
 * Called when a purchase is completed to populate barcode sticker data
 */

import { PurchaseSlot, SlotProduct } from "../types/index.js";
import { barcodeStickerService } from "./barcode-sticker.js";

export interface PurchaseEntryData {
  slotId: string;
  slotName: string;
  date: string; // ISO string
  products: Array<{
    id: string;
    productName: string;
    sku: string;
    barcode: string;
    quantity: number;
    mrp: number;
    sellingPrice: number;
    gstRate: number;
    hsnCode?: string;
  }>;
}

/**
 * Call this function when a purchase entry is completed
 * This will make the slot available in the Barcode Sticker Printing section
 */
export function onPurchaseCompleted(purchaseData: PurchaseEntryData): void {
  const slot: PurchaseSlot = {
    id: purchaseData.slotId,
    name: purchaseData.slotName,
    date: purchaseData.date,
    products: purchaseData.products.map(p => ({
      id: p.id,
      productName: p.productName,
      sku: p.sku,
      barcode: p.barcode,
      quantity: p.quantity,
      mrp: p.mrp,
      sellingPrice: p.sellingPrice,
      gstRate: p.gstRate,
      hsnCode: p.hsnCode,
    })),
    totalQuantity: purchaseData.products.reduce((sum, p) => sum + p.quantity, 0),
    totalValue: purchaseData.products.reduce((sum, p) => sum + (p.sellingPrice * p.quantity), 0),
    status: "completed",
  };

  barcodeStickerService.addSlot(slot);
  console.log(`[Barcode Stickers] Added slot "${slot.name}" with ${slot.products.length} products`);
}

/**
 * Example usage in your purchase entry workflow:
 *
 * ```typescript
 * // After saving purchase to database
 * const purchaseData = {
 *   slotId: "slot-001",
 *   slotName: "Purchase Slot 1",
 *   date: new Date().toISOString(),
 *   products: [
 *     { id: "prod-1", productName: "Acrylic Paint Set", sku: "APS-12-001", barcode: "8901234567890", quantity: 10, mrp: 499, sellingPrice: 450, gstRate: 18, hsnCode: "3213" },
 *     { id: "prod-2", productName: "Canvas Board 12x12", sku: "CB-12-001", barcode: "8901234567891", quantity: 20, mrp: 149, sellingPrice: 120, gstRate: 18, hsnCode: "4907" },
 *   ]
 * };
 *
 * onPurchaseCompleted(purchaseData);
 * ```
 */

/**
 * Get all slots available for barcode sticker printing
 */
export function getBarcodeStickerSlots() {
  return barcodeStickerService.getCompletedSlots();
}

/**
 * Export barcode data for a specific slot
 */
export function exportBarcodeStickers(slotId: string, format: "csv" | "excel" | "json" = "excel") {
  return barcodeStickerService.createDownload(slotId, format);
}

/**
 * Get slot summary for UI display
 */
export function getSlotStickerSummary(slotId: string) {
  return barcodeStickerService.getSlotSummary(slotId);
}