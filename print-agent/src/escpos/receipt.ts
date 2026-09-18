/**
 * Receipt Template Builder
 * Builds ESC/POS receipt from structured print job data
 */

import {
  cmd, concat, init, text, feedLines, feedAndCut, partialCut,
  kickDrawer, printBarcode, setAlign, setBold, setFontSize
} from "./commands.js";

export interface ReceiptData {
  // Printer settings
  printerType: "escpos" | "windows";
  paperWidth: "58mm" | "80mm";

  // Invoice info
  invoiceNumber: string;
  invoiceDate: string; // ISO string

  // Store info
  storeName: string;
  storeTagline?: string;
  storeGSTIN?: string;
  storeAddress: string[];
  storePhone?: string;
  storeEmail?: string;
  storeWebsite?: string;
  storeCIN?: string;

  // Customer info (optional for retail)
  customerName?: string;
  customerPhone?: string;
  customerAddress?: string;

  // Items
  items: ReceiptItem[];

  // Totals
  subtotal: number;
  discount: number;
  tax: number;
  shippingCharge: number;
  grandTotal: number;

  // Payment
  paymentMethod: "CASH" | "UPI" | "CARD" | "COD";

  // Footer
  footerLines?: string[];

  // Options
  cutPaper?: boolean;
  openCashDrawer?: boolean;
  printBarcode?: boolean;
  barcodeData?: string;
}

export interface ReceiptItem {
  name: string;
  variation?: string;
  quantity: number;
  unit: string;
  unitPrice: number;
  lineTotal: number;
  gstRate?: number;
  hsnCode?: string;
}

const CHAR_WIDTH_58 = 32;  // chars per line at 58mm
const CHAR_WIDTH_80 = 42;  // chars per line at 80mm

function getLineWidth(paperWidth: "58mm" | "80mm"): number {
  return paperWidth === "58mm" ? CHAR_WIDTH_58 : CHAR_WIDTH_80;
}

function formatMoney(amount: number): string {
  return `₹${amount.toFixed(2)}`;
}

function padLeft(str: string, width: number): string {
  return str.padStart(width);
}

function padRight(str: string, width: number): string {
  return str.padEnd(width);
}

function truncate(str: string, maxLen: number): string {
  if (str.length <= maxLen) return str;
  return str.slice(0, maxLen - 1) + "…";
}

function buildItemLine(item: ReceiptItem, paperWidth: "58mm" | "80mm"): string[] {
  const width = getLineWidth(paperWidth);
  const lines: string[] = [];

  // Item name (with variation)
  let name = item.name;
  if (item.variation) name += ` (${item.variation})`;
  name = truncate(name, width);
  lines.push(name);

  // Qty x Price = Total
  const qtyStr = `${item.quantity} ${item.unit}`;
  const priceStr = formatMoney(item.unitPrice);
  const totalStr = formatMoney(item.lineTotal);

  if (paperWidth === "58mm") {
    // 58mm: compact format
    lines.push(`${qtyStr} x ${priceStr} = ${totalStr}`);
    if (item.gstRate && item.gstRate > 0) {
      lines.push(`  GST: ${item.gstRate}%`);
    }
  } else {
    // 80mm: more space
    const line = `${padRight(qtyStr, 12)}${padRight(priceStr, 12)}${padLeft(totalStr, 10)}`;
    lines.push(line);
    if (item.gstRate && item.gstRate > 0) {
      lines.push(`  GST: ${item.gstRate}%  HSN: ${item.hsnCode || "-"}`);
    }
  }

  return lines;
}

export function buildReceipt(data: ReceiptData): Uint8Array {
  const width = getLineWidth(data.paperWidth);
  const parts: Uint8Array[] = [];

  // Initialize
  parts.push(init());

  // Header - Store Name
  parts.push(setAlign("center"));
  parts.push(setBold(true));
  parts.push(setFontSize(1, 1)); // Double size
  parts.push(text(data.storeName, { align: "center", bold: true, size: "double" }));
  parts.push(setFontSize(0, 0));
  parts.push(setBold(false));

  // Tagline
  if (data.storeTagline) {
    parts.push(text(data.storeTagline, { align: "center" }));
  }

  // GSTIN
  if (data.storeGSTIN) {
    parts.push(text(`GSTIN: ${data.storeGSTIN}`, { align: "center" }));
  }

  // Address lines
  for (const addr of data.storeAddress) {
    if (addr.trim()) parts.push(text(addr, { align: "center" }));
  }

  // Contact
  const contacts: string[] = [];
  if (data.storePhone) contacts.push(`Ph: ${data.storePhone}`);
  if (data.storeEmail) contacts.push(data.storeEmail);
  if (data.storeWebsite) contacts.push(data.storeWebsite);
  if (contacts.length > 0) {
    parts.push(text(contacts.join(" | "), { align: "center" }));
  }

  // CIN
  if (data.storeCIN) {
    parts.push(text(`CIN: ${data.storeCIN}`, { align: "center" }));
  }

  parts.push(feedLines(1));

  // Separator
  parts.push(text("-".repeat(width), { align: "center" }));

  // Invoice title
  parts.push(text("TAX INVOICE", { align: "center", bold: true }));

  parts.push(feedLines(1));

  // Invoice details
  parts.push(setAlign("left"));
  parts.push(text(`Invoice: ${data.invoiceNumber}`));
  parts.push(text(`Date: ${formatDate(data.invoiceDate)}`));

  // Customer info (if provided)
  if (data.customerName) {
    parts.push(feedLines(1));
    parts.push(text("Customer:", { bold: true }));
    parts.push(text(data.customerName));
    if (data.customerPhone) parts.push(text(data.customerPhone));
    if (data.customerAddress) parts.push(text(truncate(data.customerAddress, width)));
  }

  parts.push(text("-".repeat(width), { align: "center" }));

  // Column headers
  if (data.paperWidth === "58mm") {
    parts.push(text("Item           Qty    Price   Total", { bold: true }));
  } else {
    parts.push(text("Item                    Qty     Price      Total", { bold: true }));
  }
  parts.push(text("-".repeat(width), { align: "center" }));

  // Items
  for (const item of data.items) {
    const itemLines = buildItemLine(item, data.paperWidth);
    for (const line of itemLines) {
      parts.push(text(line));
    }
  }

  parts.push(text("-".repeat(width), { align: "center" }));

  // Totals
  const rightAlign = (label: string, value: string) => {
    const labelWidth = width - value.length - 1;
    return `${padRight(label, labelWidth)} ${value}`;
  };

  parts.push(text(rightAlign("Subtotal", formatMoney(data.subtotal))));

  if (data.discount > 0) {
    parts.push(text(rightAlign("Discount", `-${formatMoney(data.discount)}`)));
  }

  if (data.shippingCharge > 0) {
    parts.push(text(rightAlign("Shipping", formatMoney(data.shippingCharge))));
  }

  parts.push(text(rightAlign("Tax", formatMoney(data.tax))));

  parts.push(text("-".repeat(width), { align: "center" }));

  // Grand total - double size
  parts.push(setBold(true));
  parts.push(setFontSize(1, 0)); // Double width
  parts.push(text(rightAlign("TOTAL", formatMoney(data.grandTotal)), { bold: true, size: "double-width" }));
  parts.push(setFontSize(0, 0));
  parts.push(setBold(false));

  parts.push(feedLines(1));

  // Payment method
  parts.push(text(`Payment: ${data.paymentMethod}`, { align: "center", bold: true }));

  parts.push(feedLines(1));

  // Barcode (invoice number)
  if (data.printBarcode && data.barcodeData) {
    parts.push(setAlign("center"));
    parts.push(printBarcode(data.barcodeData, { width: 2, height: 80 }));
    parts.push(feedLines(1));
  }

  // Footer lines
  const footer = data.footerLines || [
    "Thank you for shopping with us!",
    "Goods once sold will not be taken back or exchanged."
  ];

  for (const line of footer) {
    parts.push(text(line, { align: "center" }));
  }

  parts.push(feedLines(2));

  // Cash drawer
  if (data.openCashDrawer && data.paymentMethod === "CASH") {
    parts.push(kickDrawer());
  }

  // Cut paper
  if (data.cutPaper !== false) {
    parts.push(partialCut());
  } else {
    parts.push(feedLines(3));
  }

  return concat(...parts);
}

function formatDate(isoString: string): string {
  try {
    const date = new Date(isoString);
    return date.toLocaleString("en-IN", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hour12: true,
    });
  } catch {
    return isoString;
  }
}

// Build a test receipt
export function buildTestReceipt(paperWidth: "58mm" | "80mm" = "80mm"): Uint8Array {
  return buildReceipt({
    printerType: "escpos",
    paperWidth,
    invoiceNumber: "TEST-001",
    invoiceDate: new Date().toISOString(),
    storeName: "ATHIRA'S CREATIVE HAVEN",
    storeTagline: "Craft Supplies & Creative Classes",
    storeGSTIN: "33XXXXX0000X1Z5",
    storeAddress: [
      "No. 12, Craft Street, Teynampet",
      "Chennai, Tamil Nadu - 600018"
    ],
    storePhone: "+91 98765 43210",
    storeEmail: "hello@athirascreativehaven.in",
    items: [
      { name: "Acrylic Paint Set", quantity: 1, unit: "Nos", unitPrice: 450.00, lineTotal: 450.00, gstRate: 18 },
      { name: "Canvas Board 12x12", quantity: 2, unit: "Nos", unitPrice: 120.00, lineTotal: 240.00, gstRate: 18 },
      { name: "Brush Set - 12 pcs", quantity: 1, unit: "Nos", unitPrice: 350.00, lineTotal: 350.00, gstRate: 18 },
    ],
    subtotal: 1040.00,
    discount: 40.00,
    tax: 180.00,
    shippingCharge: 0,
    grandTotal: 1180.00,
    paymentMethod: "CASH",
    footerLines: [
      "Thank you for shopping with us!",
      "Goods once sold will not be taken back or exchanged."
    ],
    cutPaper: true,
    openCashDrawer: true,
    printBarcode: true,
    barcodeData: "TEST-001",
  });
}