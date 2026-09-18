/**
 * Print Service - Communicates with local Print Agent via HTTP/WebSocket
 * Handles receipt and label printing through the Windows Print Agent
 */

// Print Agent base URL - can be overridden via environment variable
const PRINT_AGENT_BASE = import.meta.env.VITE_PRINT_AGENT_URL || "http://localhost:3030";

export interface PrinterInfo {
  id: string;
  name: string;
  type: "usb" | "serial" | "network" | "windows";
  status: "connected" | "disconnected" | "error" | "unknown";
  paperWidth?: "58mm" | "80mm";
  labelWidth?: number;
  labelHeight?: number;
  capabilities: string[];
  isDefault?: boolean;
}

export interface PrintJobResult {
  jobId: string;
  status: "queued" | "printing" | "completed" | "failed";
  message?: string;
}

export interface ReceiptPrintJob {
  printerId: string;
  invoiceNumber: string;
  invoiceDate: string; // ISO string
  storeInfo: {
    name: string;
    tagline?: string;
    gstin?: string;
    address: string[];
    phone?: string;
    email?: string;
    website?: string;
    cin?: string;
  };
  customerInfo?: {
    name?: string;
    phone?: string;
    address?: string;
  };
  items: ReceiptItem[];
  totals: {
    subtotal: number;
    discount: number;
    tax: number;
    shippingCharge: number;
    grandTotal: number;
    cgstAmount?: number;
    sgstAmount?: number;
    igstAmount?: number;
  };
  paymentMethod: "CASH" | "UPI" | "CARD" | "COD";
  footerLines?: string[];
  options?: {
    cutPaper?: boolean;
    openCashDrawer?: boolean;
    printBarcode?: boolean;
    barcodeData?: string;
    printLogo?: boolean;
    printGstBreakdown?: boolean;
  };
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

export interface LabelPrintJob {
  printerId: string;
  items: LabelItem[];
  storeName: string;
  storeAddress?: string;
  labelWidth: number; // mm
  labelHeight: number; // mm
  margin?: number; // mm
  copies?: number;
  template?: "standard" | "compact" | "detailed";
}

export interface LabelItem {
  productName: string;
  sku?: string;
  barcode: string;
  mrp?: number;
  sellingPrice: number;
  offerPrice?: number;
  batchNumber?: string;
  expiryDate?: string; // ISO string
  quantity: number; // number of labels to print for this item
}

export interface LabelTemplateOptions {
  labelWidth: number;
  labelHeight: number;
  margin: number;
  barcodeType: "CODE128" | "EAN13" | "QR";
  barcodeHeight: number;
  barcodeWidth: number;
  textSize: "small" | "medium" | "large";
  showMRP: boolean;
  showOfferPrice: boolean;
  showBatchNumber: boolean;
  showExpiryDate: boolean;
  showSKU: boolean;
  showStoreName: boolean;
  showStoreAddress: boolean;
}

export const DEFAULT_LABEL_TEMPLATE: LabelTemplateOptions = {
  labelWidth: 40,
  labelHeight: 30,
  margin: 2,
  barcodeType: "CODE128",
  barcodeHeight: 60,
  barcodeWidth: 2,
  textSize: "medium",
  showMRP: true,
  showOfferPrice: true,
  showBatchNumber: true,
  showExpiryDate: true,
  showSKU: true,
  showStoreName: true,
  showStoreAddress: true,
};

export interface PrinterStatusResponse {
  printerId: string;
  status: "connected" | "disconnected" | "error" | "unknown";
  lastSeen?: string;
  error?: string;
}

// Fetch available printers from Print Agent
export async function getPrinters(): Promise<PrinterInfo[]> {
  try {
    const response = await fetch(`${PRINT_AGENT_BASE}/printers`, {
      method: "GET",
      headers: { "Content-Type": "application/json" },
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch printers: ${response.status}`);
    }

    const data = await response.json();
    return data.printers || [];
  } catch (error) {
    console.error("Error fetching printers:", error);
    // Return mock data for development if Print Agent not running
    if (import.meta.env.DEV) {
      return getMockPrinters();
    }
    throw error;
  }
}

// Get specific printer status
export async function getPrinterStatus(printerId: string): Promise<PrinterStatusResponse> {
  try {
    const response = await fetch(`${PRINT_AGENT_BASE}/printer/status?printerId=${encodeURIComponent(printerId)}`, {
      method: "GET",
      headers: { "Content-Type": "application/json" },
    });

    if (!response.ok) {
      throw new Error(`Failed to get printer status: ${response.status}`);
    }

    return await response.json();
  } catch (error) {
    console.error("Error getting printer status:", error);
    return { printerId, status: "error", error: String(error) };
  }
}

// Print receipt via Print Agent
export async function printReceipt(job: ReceiptPrintJob): Promise<PrintJobResult> {
  try {
    const response = await fetch(`${PRINT_AGENT_BASE}/print/receipt`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(job),
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: "Print failed" }));
      throw new Error(error.error || `Print failed: ${response.status}`);
    }

    return await response.json();
  } catch (error) {
    console.error("Error printing receipt:", error);
    throw error;
  }
}

// Print labels via Print Agent
export async function printLabels(job: LabelPrintJob): Promise<PrintJobResult> {
  try {
    const response = await fetch(`${PRINT_AGENT_BASE}/print/label`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(job),
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: "Label print failed" }));
      throw new Error(error.error || `Label print failed: ${response.status}`);
    }

    return await response.json();
  } catch (error) {
    console.error("Error printing labels:", error);
    throw error;
  }
}

// Send test print to printer
export async function printTestLabel(printerId: string, labelWidth: number, labelHeight: number): Promise<PrintJobResult> {
  try {
    const response = await fetch(`${PRINT_AGENT_BASE}/printer/test`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ printerId, labelWidth, labelHeight }),
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: "Test print failed" }));
      throw new Error(error.error || `Test print failed: ${response.status}`);
    }

    return await response.json();
  } catch (error) {
    console.error("Error printing test label:", error);
    throw error;
  }
}

// Preview label - generates HTML for browser preview
export function generateLabelPreview(
  item: LabelItem,
  template: LabelTemplateOptions,
  storeName: string,
  storeAddress?: string
): string {
  const { labelWidth, labelHeight, margin, barcodeType, barcodeHeight, barcodeWidth, textSize, showMRP, showOfferPrice, showBatchNumber, showExpiryDate, showSKU, showStoreName, showStoreAddress } = template;

  // Calculate dimensions in pixels (assuming 8px per mm at 203 DPI)
  const pxPerMm = 8;
  const widthPx = labelWidth * pxPerMm;
  const heightPx = labelHeight * pxPerMm;
  const marginPx = margin * pxPerMm;

  const textSizes = { small: "10px", medium: "12px", large: "14px" };
  const fontSize = textSizes[textSize];

  const lines: string[] = [];
  let yPos = marginPx;

  // Store name
  if (showStoreName && storeName) {
    lines.push(`
      <div style="position: absolute; top: ${yPos}px; left: ${marginPx}px; right: ${marginPx}px;
           text-align: center; font-weight: bold; font-size: ${fontSize}; line-height: 1.2;">
        ${escapeHtml(storeName)}
      </div>
    `);
    yPos += parseInt(fontSize) * 1.5;
  }

  // Product name
  lines.push(`
    <div style="position: absolute; top: ${yPos}px; left: ${marginPx}px; right: ${marginPx}px;
         text-align: center; font-weight: bold; font-size: ${fontSize}; line-height: 1.2; word-wrap: break-word;">
      ${escapeHtml(item.productName)}
    </div>
  `);
  yPos += parseInt(fontSize) * 1.5;

  // Barcode
  const barcodeValue = item.barcode || "N/A";
  // Use a barcode generator - for preview we'll show the text
  lines.push(`
    <div style="position: absolute; top: ${yPos}px; left: ${marginPx}px; right: ${marginPx}px;
         text-align: center; font-family: monospace; font-size: ${parseInt(fontSize) + 2}px; font-weight: bold; margin: 4px 0;">
      ${escapeHtml(barcodeValue)}
    </div>
  `);
  yPos += parseInt(fontSize) * 2.5;

  // Price section
  if (showMRP && item.mrp && item.mrp > item.sellingPrice) {
    lines.push(`
      <div style="position: absolute; top: ${yPos}px; left: ${marginPx}px; right: ${marginPx}px;
           text-align: center; font-size: ${parseInt(fontSize) + 2}px; font-weight: bold; color: #e53e3e;">
        ₹${item.sellingPrice.toFixed(2)}
      </div>
    `);
    yPos += parseInt(fontSize) * 2;
    lines.push(`
      <div style="position: absolute; top: ${yPos}px; left: ${marginPx}px; right: ${marginPx}px;
           text-align: center; font-size: ${parseInt(fontSize) - 2}px; text-decoration: line-through; color: #718096;">
        MRP: ₹${item.mrp.toFixed(2)}
      </div>
    `);
  } else if (showOfferPrice && item.offerPrice && item.offerPrice < item.sellingPrice) {
    lines.push(`
      <div style="position: absolute; top: ${yPos}px; left: ${marginPx}px; right: ${marginPx}px;
           text-align: center; font-size: ${parseInt(fontSize) + 2}px; font-weight: bold; color: #38a169;">
        Offer: ₹${item.offerPrice.toFixed(2)}
      </div>
    `);
    yPos += parseInt(fontSize) * 2;
    lines.push(`
      <div style="position: absolute; top: ${yPos}px; left: ${marginPx}px; right: ${marginPx}px;
           text-align: center; font-size: ${parseInt(fontSize) - 2}px; text-decoration: line-through; color: #718096;">
        ₹${item.sellingPrice.toFixed(2)}
      </div>
    `);
  } else {
    lines.push(`
      <div style="position: absolute; top: ${yPos}px; left: ${marginPx}px; right: ${marginPx}px;
           text-align: center; font-size: ${parseInt(fontSize) + 4}px; font-weight: bold; color: #2d3748;">
        ₹${item.sellingPrice.toFixed(2)}
      </div>
    `);
  }
  yPos += parseInt(fontSize) * 2.5;

  // Optional fields
  if (showSKU && item.sku) {
    lines.push(`
      <div style="position: absolute; top: ${yPos}px; left: ${marginPx}px; right: ${marginPx}px;
           text-align: center; font-size: ${parseInt(fontSize) - 2}px; color: #4a5568;">
        SKU: ${escapeHtml(item.sku)}
      </div>
    `);
    yPos += parseInt(fontSize) * 1.3;
  }

  if (showBatchNumber && item.batchNumber) {
    lines.push(`
      <div style="position: absolute; top: ${yPos}px; left: ${marginPx}px; right: ${marginPx}px;
           text-align: center; font-size: ${parseInt(fontSize) - 2}px; color: #4a5568;">
        Batch: ${escapeHtml(item.batchNumber)}
      </div>
    `);
    yPos += parseInt(fontSize) * 1.3;
  }

  if (showExpiryDate && item.expiryDate) {
    const expDate = new Date(item.expiryDate).toLocaleDateString("en-IN", { day: "2-digit", month: "2-digit", year: "numeric" });
    lines.push(`
      <div style="position: absolute; top: ${yPos}px; left: ${marginPx}px; right: ${marginPx}px;
           text-align: center; font-size: ${parseInt(fontSize) - 2}px; color: #4a5568;">
        Exp: ${expDate}
      </div>
    `);
  }

  // Store address
  if (showStoreAddress && storeAddress) {
    lines.push(`
      <div style="position: absolute; bottom: ${marginPx}px; left: ${marginPx}px; right: ${marginPx}px;
           text-align: center; font-size: ${parseInt(fontSize) - 3}px; color: #718096;">
        ${escapeHtml(storeAddress)}
      </div>
    `);
  }

  return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <title>Label Preview</title>
      <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #f5f5f5; padding: 20px; }
        .label-container {
          width: ${widthPx}px;
          height: ${heightPx}px;
          border: 1px solid #ccc;
          background: white;
          position: relative;
          margin: 0 auto;
          box-shadow: 0 2px 8px rgba(0,0,0,0.1);
        }
        @media print {
          body { background: white; padding: 0; }
          .label-container { border: 1px solid #000; box-shadow: none; }
        }
      </style>
    </head>
    <body>
      <div class="label-container">
        ${lines.join("\n")}
      </div>
    </body>
    </html>
  `;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&")
    .replace(/</g, "<")
    .replace(/>/g, ">")
    .replace(/"/g, "\"")
    .replace(/'/g, "'");
}

// Generate multi-label preview HTML
export function generateBatchLabelPreview(
  items: LabelItem[],
  template: LabelTemplateOptions,
  storeName: string,
  storeAddress?: string
): string {
  const labels = items.flatMap(item =>
    Array(item.quantity).fill(item).map(i => generateLabelPreview(i, template, storeName, storeAddress))
  );

  return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <title>Batch Label Preview</title>
      <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #f5f5f5; padding: 20px; }
        .label-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(320px, 1fr)); gap: 16px; }
        .label-container {
          border: 1px solid #ccc;
          background: white;
          position: relative;
          box-shadow: 0 2px 8px rgba(0,0,0,0.1);
        }
        @media print {
          body { background: white; padding: 0; }
          .label-grid { gap: 8px; }
          .label-container { border: 1px solid #000; box-shadow: none; page-break-inside: avoid; }
        }
      </style>
    </head>
    <body>
      <div class="label-grid">
        ${labels.join("\n")}
      </div>
    </body>
    </html>
  `;
}

// Open preview window
export function openLabelPreview(
  items: LabelItem[],
  template: LabelTemplateOptions,
  storeName: string,
  storeAddress?: string
): Window | null {
  const html = generateBatchLabelPreview(items, template, storeName, storeAddress);
  const win = window.open("", "_blank", "width=900,height=700");
  if (!win) return null;

  win.document.write(html);
  win.document.close();
  return win;
}

// Mock printers for development
function getMockPrinters(): PrinterInfo[] {
  return [
    {
      id: "seznik-ld0801-bt",
      name: "SEZNIK JOSH LD0801 (Bluetooth)",
      type: "windows",
      status: "connected",
      labelWidth: 40,
      labelHeight: 30,
      capabilities: ["windows", "cut", "label"],
      isDefault: true,
    },
    {
      id: "generic-thermal-80mm",
      name: "Generic Thermal Printer (80mm)",
      type: "usb",
      status: "disconnected",
      paperWidth: "80mm",
      capabilities: ["escpos", "cut", "cash-drawer"],
    },
    {
      id: "generic-thermal-58mm",
      name: "Generic Thermal Printer (58mm)",
      type: "usb",
      status: "disconnected",
      paperWidth: "58mm",
      capabilities: ["escpos", "cut"],
    },
  ];
}