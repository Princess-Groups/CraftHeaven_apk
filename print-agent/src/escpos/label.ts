/**
 * Label Template Builder
 * Builds ESC/POS labels for SEZNIK JOSH LD0801 and similar label printers
 */

import {
  cmd, concat, init, text, feedLines, printBarcode, setAlign,
  setBold, setFontSize
} from "./commands.js";

export interface LabelData {
  // Printer settings
  printerType: "escpos" | "windows";
  labelWidth: number;    // mm
  labelHeight: number;   // mm

  // Product info
  productName: string;
  barcode: string;
  price: number;
  mrp?: number;
  sku?: string;

  // Store info
  storeName: string;
  storeAddress?: string;

  // Options
  copies: number;
  cutBetween?: boolean;
}

const MM_TO_DOTS = 8; // 203 DPI ≈ 8 dots/mm

export function buildLabel(data: LabelData): Uint8Array {
  const parts: Uint8Array[] = [];

  // Initialize
  parts.push(init());

  // Calculate dimensions in dots
  const widthDots = Math.round(data.labelWidth * MM_TO_DOTS);
  const heightDots = Math.round(data.labelHeight * MM_TO_DOTS);

  // For multiple copies
  for (let i = 0; i < data.copies; i++) {
    // Set print area for label size
    // ESC L - enter page mode
    parts.push(cmd(0x1b, 0x4c));

    // ESC W - set print area (x, y, width, height)
    parts.push(cmd(0x1b, 0x57,
      0, 0,  // x=0
      0, 0,  // y=0
      widthDots & 0xFF, (widthDots >> 8) & 0xFF,
      heightDots & 0xFF, (heightDots >> 8) & 0xFF
    ));

    // Print content
    parts.push(setAlign("center"));
    parts.push(setBold(true));
    parts.push(setFontSize(1, 0)); // Double width
    parts.push(text(data.storeName, { align: "center", bold: true, size: "double-width" }));
    parts.push(setFontSize(0, 0));
    parts.push(setBold(false));

    parts.push(feedLines(1));

    // Product name
    parts.push(text(data.productName, { align: "center", bold: true }));

    parts.push(feedLines(1));

    // Barcode
    if (data.barcode) {
      parts.push(printBarcode(data.barcode, {
        width: 2,
        height: 60,
        hriPosition: 2, // below
        hriFont: 0
      }));
      parts.push(feedLines(1));
    }

    // Price
    parts.push(setBold(true));
    parts.push(setFontSize(1, 1)); // Double size
    parts.push(text(`₹${data.price.toFixed(2)}`, { align: "center", bold: true, size: "double" }));
    parts.push(setFontSize(0, 0));
    parts.push(setBold(false));

    // MRP if different
    if (data.mrp && data.mrp !== data.price) {
      parts.push(text(`MRP: ₹${data.mrp.toFixed(2)}`, { align: "center" }));
    }

    // SKU
    if (data.sku) {
      parts.push(text(`SKU: ${data.sku}`, { align: "center" }));
    }

    // Store address
    if (data.storeAddress) {
      parts.push(feedLines(1));
      parts.push(text(data.storeAddress, { align: "center", size: "normal" }));
    }

    // ESC FF - print and return to standard mode
    parts.push(cmd(0x1b, 0x0c));

    // Cut between labels if requested
    if (data.cutBetween && i < data.copies - 1) {
      parts.push(cmd(0x1d, 0x56, 0x41, 0x01)); // Partial cut
    }
  }

  return concat(...parts);
}

// Build test label for SEZNIK JOSH LD0801 (40x30mm typical)
export function buildTestLabel(): Uint8Array {
  return buildLabel({
    printerType: "escpos",
    labelWidth: 40,
    labelHeight: 30,
    productName: "Acrylic Paint Set",
    barcode: "8901234567890",
    price: 450.00,
    mrp: 499.00,
    sku: "APS-12-001",
    storeName: "ATHIRA'S CREATIVE HAVEN",
    storeAddress: "Chennai, TN - 600018",
    copies: 1,
    cutBetween: true,
  });
}

// Build batch labels from label printing data
export function buildBatchLabels(
  items: Array<{
    productName: string;
    barcode: string;
    price: number;
    mrp?: number;
    sku?: string;
    quantity: number;
  }>,
  storeName: string,
  storeAddress: string,
  labelWidth: number,
  labelHeight: number
): Uint8Array {
  const parts: Uint8Array[] = [];
  parts.push(init());

  for (const item of items) {
    for (let i = 0; i < item.quantity; i++) {
      // Set label size for each label
      const widthDots = Math.round(labelWidth * MM_TO_DOTS);
      const heightDots = Math.round(labelHeight * MM_TO_DOTS);

      parts.push(cmd(0x1b, 0x4c)); // Page mode
      parts.push(cmd(0x1b, 0x57, 0, 0, 0, 0, widthDots & 0xFF, (widthDots >> 8) & 0xFF, heightDots & 0xFF, (heightDots >> 8) & 0xFF));

      parts.push(setAlign("center"));
      parts.push(setBold(true));
      parts.push(setFontSize(1, 0));
      parts.push(text(storeName, { align: "center", bold: true, size: "double-width" }));
      parts.push(setFontSize(0, 0));
      parts.push(setBold(false));
      parts.push(feedLines(1));
      parts.push(text(item.productName, { align: "center", bold: true }));
      parts.push(feedLines(1));

      if (item.barcode) {
        parts.push(printBarcode(item.barcode, { width: 2, height: 60, hriPosition: 2 }));
        parts.push(feedLines(1));
      }

      parts.push(setBold(true));
      parts.push(setFontSize(1, 1));
      parts.push(text(`₹${item.price.toFixed(2)}`, { align: "center", bold: true, size: "double" }));
      parts.push(setFontSize(0, 0));
      parts.push(setBold(false));

      if (item.mrp && item.mrp !== item.price) {
        parts.push(text(`MRP: ₹${item.mrp.toFixed(2)}`, { align: "center" }));
      }

      if (item.sku) {
        parts.push(text(`SKU: ${item.sku}`, { align: "center" }));
      }

      if (storeAddress) {
        parts.push(feedLines(1));
        parts.push(text(storeAddress, { align: "center" }));
      }

      parts.push(cmd(0x1b, 0x0c)); // Print page
      parts.push(cmd(0x1d, 0x56, 0x41, 0x01)); // Cut
    }
  }

  return concat(...parts);
}