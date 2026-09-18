/**
 * Core Types for ACH Print Agent
 */

// Purchase Entry / Slot Types
export interface SlotProduct {
  id: string;
  productName: string;
  sku: string;
  barcode: string;
  quantity: number;
  mrp: number;
  sellingPrice: number;
  gstRate: number;
  hsnCode?: string;
}

export interface PurchaseSlot {
  id: string;
  name: string;
  date: string; // ISO string
  products: SlotProduct[];
  totalQuantity: number;
  totalValue: number;
  status: "pending" | "completed" | "cancelled";
}

// Barcode Sticker Export Types
export interface BarcodeStickerItem {
  productName: string;
  sku: string;
  barcode: string;
  quantity: number;
  mrp: number;
  sellingPrice: number;
}

export interface BarcodeStickerExport {
  slotId: string;
  slotName: string;
  exportDate: string;
  items: BarcodeStickerItem[];
}

// Billing Types
export interface BillingItem {
  id: string;
  productName: string;
  sku: string;
  barcode: string;
  quantity: number;
  unitPrice: number;
  discount: number;
  gstRate: number;
  gstAmount: number;
  lineTotal: number;
  hsnCode?: string;
}

export interface BillingSummary {
  invoiceNumber: string;
  invoiceDate: string;
  items: BillingItem[];
  subtotal: number;
  totalDiscount: number;
  totalTax: number;
  shippingCharge: number;
  grandTotal: number;
  paymentMethod: "CASH" | "UPI" | "CARD" | "COD";
  customerName?: string;
  customerPhone?: string;
  customerAddress?: string;
}

// Store/Business Info
export interface StoreInfo {
  name: string;
  tagline?: string;
  gstin: string;
  address: string[];
  phone?: string;
  email?: string;
  website?: string;
  cin?: string;
}

// Receipt Printer Settings
export interface ReceiptPrinterSettings {
  enabled: boolean;
  printerId: string;
  printerType: "usb" | "serial" | "network" | "windows" | "bluetooth";
  paperWidth: "58mm" | "80mm";
  // USB
  vendorId?: number;
  productId?: number;
  // Serial/Bluetooth
  port?: string;
  baudRate?: number;
  // Network
  ip?: string;
  portNumber?: number;
  // Windows
  windowsPrinterName?: string;
  // Common options
  autoCut: boolean;
  openCashDrawer: boolean;
  printBarcode: boolean;
  printLogo: boolean;
  footerLines: string[];
}

// POSIFLOW CN811 specific defaults
export const POSIFLOW_CN811_DEFAULTS: Partial<ReceiptPrinterSettings> = {
  printerType: "usb",
  paperWidth: "80mm",
  vendorId: 0x0483, // Common STM32 VID for thermal printers
  productId: 0x5740,
  baudRate: 115200,
  autoCut: true,
  openCashDrawer: true,
  printBarcode: true,
  printLogo: false,
  footerLines: [
    "Thank you for shopping with us!",
    "Goods once sold will not be taken back or exchanged."
  ]
};