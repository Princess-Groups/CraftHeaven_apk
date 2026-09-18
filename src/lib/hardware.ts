// Hardware / Printer Settings integration.
//
// Settings are stored per-tenant in the hardware_settings table (single row) —
// NEVER hardcoded here. The admin configures them in Admin → Settings → Hardware / Printers.
//
// Server-side functions (createServerFn) so the config stays server-side:
//   - getHardwareConfig       admin/staff reads current config + printer status
//   - saveHardwareConfig      admin saves configuration
//   - testHardwareConnection  tests printer connection via Print Agent
//   - testBarcodeScanner      tests barcode scanner input handling
//   - testReceiptPrinter      sends test receipt to receipt printer
//   - testLabelPrinter        sends test label to label printer

import { createServerFn } from "@tanstack/react-start";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import type { PrinterInfo } from "@/lib/print-service";

export type HardwareConfig = {
  // Barcode Scanner
  scanner_prefix: string | null;
  scanner_timeout_ms: number;
  scanner_auto_submit: boolean;

  // Receipt Printer
  receipt_printer_id: string | null;
  receipt_paper_width: "58mm" | "80mm";
  receipt_auto_cut: boolean;
  receipt_open_cash_drawer: boolean;
  receipt_print_barcode: boolean;

  // Label Printer
  label_printer_id: string | null;
  label_width_mm: number;
  label_height_mm: number;
  label_margin_mm: number;
  label_template: "standard" | "compact" | "detailed";
  label_barcode_type: "CODE128" | "EAN13" | "QR";
  label_show_mrp: boolean;
  label_show_offer_price: boolean;
  label_show_batch_number: boolean;
  label_show_expiry_date: boolean;
  label_show_sku: boolean;
  label_show_store_name: boolean;
  label_show_store_address: boolean;

  // Printing Preferences
  default_label_copies: number;
  preview_before_print: boolean;
  batch_printing: boolean;

  updated_at: string;
};

export type SaveHardwareInput = Partial<HardwareConfig> & {
  test_printer?: "receipt" | "label";
  test_printer_id?: string;
  test_label_width?: number;
  test_label_height?: number;
};

async function loadConfig(): Promise<HardwareConfig | null> {
  const { data } = await supabaseAdmin
    .from("hardware_settings")
    .select("*")
    .eq("id", 1)
    .maybeSingle();
  return (data ?? null) as HardwareConfig | null;
}

/**
 * Admin/staff reads the current hardware config.
 * Also fetches available printers from Print Agent for dropdowns.
 */
export const getHardwareConfig = createServerFn({ method: "GET" }).handler(async () => {
  const cfg = await loadConfig();

  // Fetch available printers from Print Agent
  let printers: PrinterInfo[] = [];
  try {
    const PRINT_AGENT_BASE = process.env.PRINT_AGENT_URL || "http://localhost:3030";
    const response = await fetch(`${PRINT_AGENT_BASE}/printers`, {
      method: "GET",
      headers: { "Content-Type": "application/json" },
    });
    if (response.ok) {
      const data = await response.json();
      printers = data.printers || [];
    }
  } catch {
    // Print Agent not running - will use empty array
  }

  return {
    config: cfg,
    printers,
  };
});

/**
 * Admin saves hardware configuration.
 * Returns the saved config together with updated printer list.
 */
export const saveHardwareConfig = createServerFn({ method: "POST" })
  .validator((d: SaveHardwareInput) => d)
  .handler(async ({ data }) => {
    const { test_printer, test_printer_id, test_label_width, test_label_height, ...updateData } = data;

    const { supabaseAdmin: admin } = await import("@/integrations/supabase/client.server");

    // Build update object - only include keys that are provided
    const updateObj: Record<string, any> = {
      updated_at: new Date().toISOString(),
    };

    // Map each field from updateData to database columns
    const fieldMap: Record<string, string> = {
      scanner_prefix: "scanner_prefix",
      scanner_timeout_ms: "scanner_timeout_ms",
      scanner_auto_submit: "scanner_auto_submit",
      receipt_printer_id: "receipt_printer_id",
      receipt_paper_width: "receipt_paper_width",
      receipt_auto_cut: "receipt_auto_cut",
      receipt_open_cash_drawer: "receipt_open_cash_drawer",
      receipt_print_barcode: "receipt_print_barcode",
      label_printer_id: "label_printer_id",
      label_width_mm: "label_width_mm",
      label_height_mm: "label_height_mm",
      label_margin_mm: "label_margin_mm",
      label_template: "label_template",
      label_barcode_type: "label_barcode_type",
      label_show_mrp: "label_show_mrp",
      label_show_offer_price: "label_show_offer_price",
      label_show_batch_number: "label_show_batch_number",
      label_show_expiry_date: "label_show_expiry_date",
      label_show_sku: "label_show_sku",
      label_show_store_name: "label_show_store_name",
      label_show_store_address: "label_show_store_address",
      default_label_copies: "default_label_copies",
      preview_before_print: "preview_before_print",
      batch_printing: "batch_printing",
    };

    for (const [key, dbCol] of Object.entries(fieldMap)) {
      const value = (updateData as any)[key];
      if (value !== undefined) {
        if (typeof value === "string" && value === "") {
          updateObj[dbCol] = null;
        } else {
          updateObj[dbCol] = value;
        }
      }
    }

    const { error } = await admin.from("hardware_settings").update(updateObj).eq("id", 1);
    if (error) throw new Error(error.message);

    const cfg = await loadConfig();

    // Fetch updated printer list
    let printers: PrinterInfo[] = [];
    try {
      const PRINT_AGENT_BASE = process.env.PRINT_AGENT_URL || "http://localhost:3030";
      const response = await fetch(`${PRINT_AGENT_BASE}/printers`, {
        method: "GET",
        headers: { "Content-Type": "application/json" },
      });
      if (response.ok) {
        const resData = await response.json();
        printers = resData.printers || [];
      }
    } catch {
      // Print Agent not running
    }

    // Handle test print requests
    let testResult: { success: boolean; message?: string; error?: string } | null = null;
    if (test_printer && test_printer_id) {
      try {
        const PRINT_AGENT_BASE = process.env.PRINT_AGENT_URL || "http://localhost:3030";
        const response = await fetch(`${PRINT_AGENT_BASE}/printer/test`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            printerId: test_printer_id,
            labelWidth: test_label_width || 40,
            labelHeight: test_label_height || 30,
          }),
        });
        const result = await response.json();
        testResult = {
          success: result.success,
          message: result.message,
          error: result.error,
        };
      } catch (err) {
        testResult = {
          success: false,
          error: err instanceof Error ? err.message : "Test print failed",
        };
      }
    }

    return { config: cfg, printers, testResult };
  });

/**
 * Tests the connection to Print Agent and fetches printer status.
 */
export const testHardwareConnection = createServerFn({ method: "POST" })
  .validator((d: { printerId?: string }) => d)
  .handler(async ({ data }) => {
    const PRINT_AGENT_BASE = process.env.PRINT_AGENT_URL || "http://localhost:3030";

    // Test Print Agent health
    try {
      const healthResponse = await fetch(`${PRINT_AGENT_BASE}/health`, {
        method: "GET",
        headers: { "Content-Type": "application/json" },
      });

      if (!healthResponse.ok) {
        return {
          connected: false,
          error: `Print Agent responded with ${healthResponse.status}`,
          printers: [],
        };
      }

      const health = await healthResponse.json();
      if (health.status !== "ok") {
        return {
          connected: false,
          error: "Print Agent health check failed",
          printers: [],
        };
      }
    } catch (err) {
      return {
        connected: false,
        error: `Cannot reach Print Agent at ${PRINT_AGENT_BASE}: ${err instanceof Error ? err.message : "Connection refused"}`,
        printers: [],
      };
    }

    // If specific printerId provided, test that printer
    if (data.printerId) {
      try {
        const statusResponse = await fetch(`${PRINT_AGENT_BASE}/printer/status?printerId=${encodeURIComponent(data.printerId)}`, {
          method: "GET",
          headers: { "Content-Type": "application/json" },
        });

        if (statusResponse.ok) {
          const status = await statusResponse.json();
          return {
            connected: status.connected,
            error: status.connected ? undefined : `Printer status: ${status.status}`,
            printers: [status],
          };
        }
      } catch {
        return {
          connected: false,
          error: "Failed to get printer status",
          printers: [],
        };
      }
    }

    // Get all printers
    let printers: PrinterInfo[] = [];
    try {
      const response = await fetch(`${PRINT_AGENT_BASE}/printers`, {
        method: "GET",
        headers: { "Content-Type": "application/json" },
      });
      if (response.ok) {
        const resData = await response.json();
        printers = resData.printers || [];
      }
    } catch {
      // Ignore
    }

    return {
      connected: true,
      printers,
    };
  });

/**
 * Tests barcode scanner configuration by validating the settings.
 * This is a server-side validation - actual scanner testing happens client-side.
 */
export const testBarcodeScanner = createServerFn({ method: "POST" })
  .validator((d: { prefix?: string; timeout_ms?: number; auto_submit?: boolean }) => d)
  .handler(async ({ data }) => {
    const cfg = await loadConfig();

    const prefix = data.prefix ?? cfg?.scanner_prefix ?? "";
    const timeout = data.timeout_ms ?? cfg?.scanner_timeout_ms ?? 50;
    const autoSubmit = data.auto_submit ?? cfg?.scanner_auto_submit ?? true;

    // Validate settings
    const warnings: string[] = [];

    if (!prefix) {
      warnings.push("No scanner prefix configured - scanner input may not be distinguished from keyboard");
    }

    if (timeout < 10) {
      warnings.push("Scanner timeout very low (< 10ms) - may cause false positives");
    } else if (timeout > 500) {
      warnings.push("Scanner timeout very high (> 500ms) - may delay manual input");
    }

    return {
      success: true,
      config: { prefix, timeout_ms: timeout, auto_submit: autoSubmit },
      warnings,
      message: "Barcode scanner settings validated. Test by scanning a barcode in any input field.",
    };
  });

/**
 * Sends a test receipt to the receipt printer.
 */
export const testReceiptPrinter = createServerFn({ method: "POST" })
  .validator((d: { printerId: string }) => d)
  .handler(async ({ data }) => {
    if (!data.printerId) {
      throw new Error("Printer ID required");
    }

    const PRINT_AGENT_BASE = process.env.PRINT_AGENT_URL || "http://localhost:3030";

    // Build a test receipt job
    const testJob = {
      printerId: data.printerId,
      invoiceNumber: "TEST-" + Date.now().toString(36).toUpperCase(),
      invoiceDate: new Date().toISOString(),
      storeInfo: {
        name: "Athira's Creative Haven",
        tagline: "Craft Supplies & Creative Classes",
        gstin: "29ABCDE1234F1Z5",
        address: ["123 Creative Street", "Art District", "Bangalore - 560001", "Karnataka, India"],
        phone: "+91 98765 43210",
        email: "hello@athirashaven.com",
        website: "https://athirashaven.com",
      },
      customerInfo: {
        name: "Test Customer",
        phone: "9876543210",
      },
      items: [
        {
          name: "Test Product A",
          variation: "Red / Large",
          quantity: 2,
          unit: "Nos",
          unitPrice: 150.00,
          lineTotal: 300.00,
          gstRate: 18,
          hsnCode: "4901",
        },
        {
          name: "Test Product B",
          quantity: 1,
          unit: "Nos",
          unitPrice: 299.00,
          lineTotal: 299.00,
          gstRate: 18,
        },
      ],
      totals: {
        subtotal: 599.00,
        discount: 0,
        tax: 107.82,
        shippingCharge: 0,
        grandTotal: 706.82,
      },
      paymentMethod: "CASH",
      footerLines: ["Thank you for shopping with us!", "Visit again :)"],
      options: {
        cutPaper: true,
        openCashDrawer: true,
        printBarcode: false,
      },
    };

    try {
      const response = await fetch(`${PRINT_AGENT_BASE}/print/receipt`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(testJob),
      });

      if (!response.ok) {
        const error = await response.json().catch(() => ({ error: "Print failed" }));
        throw new Error(error.error || `Print failed: ${response.status}`);
      }

      const result = await response.json();
      return {
        success: true,
        message: "Test receipt sent successfully",
        jobId: result.jobId,
      };
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : "Test receipt failed",
      };
    }
  });

/**
 * Sends a test label to the label printer.
 */
export const testLabelPrinter = createServerFn({ method: "POST" })
  .validator((d: { printerId: string; labelWidth?: number; labelHeight?: number }) => d)
  .handler(async ({ data }) => {
    if (!data.printerId) {
      throw new Error("Printer ID required");
    }

    const cfg = await loadConfig();

    const PRINT_AGENT_BASE = process.env.PRINT_AGENT_URL || "http://localhost:3030";

    // Build a test label job
    const testJob = {
      printerId: data.printerId,
      items: [
        {
          productName: "Test Label Product",
          sku: "TEST-001",
          barcode: "1234567890123",
          mrp: 299.00,
          sellingPrice: 249.00,
          offerPrice: 229.00,
          batchNumber: "BATCH001",
          expiryDate: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString(),
          quantity: 1,
        },
      ],
      storeName: "Athira's Creative Haven",
      storeAddress: "123 Creative Street, Bangalore - 560001",
      labelWidth: data.labelWidth ?? cfg?.label_width_mm ?? 40,
      labelHeight: data.labelHeight ?? cfg?.label_height_mm ?? 30,
      margin: cfg?.label_margin_mm ?? 2,
      copies: 1,
      template: cfg?.label_template ?? "standard",
    };

    try {
      const response = await fetch(`${PRINT_AGENT_BASE}/print/label`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(testJob),
      });

      if (!response.ok) {
        const error = await response.json().catch(() => ({ error: "Label print failed" }));
        throw new Error(error.error || `Label print failed: ${response.status}`);
      }

      const result = await response.json();
      return {
        success: true,
        message: "Test label sent successfully",
        jobId: result.jobId,
      };
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : "Test label failed",
      };
    }
  });