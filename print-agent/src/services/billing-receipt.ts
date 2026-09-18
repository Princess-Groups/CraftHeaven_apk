/**
 * Billing Receipt Service
 * Handles billing summary printing on thermal receipt printers (POSIFLOW CN811)
 */

import { BillingSummary, StoreInfo } from "../types/index.js";
import { buildReceipt, ReceiptData } from "../escpos/receipt.js";
import { receiptPrinterSettingsService } from "./receipt-printer-settings.js";

export class BillingReceiptService {
  private storeInfo: StoreInfo;

  constructor(storeInfo: StoreInfo) {
    this.storeInfo = storeInfo;
  }

  // Update store info
  setStoreInfo(info: StoreInfo): void {
    this.storeInfo = info;
  }

  // Print billing summary
  async printBill(billingSummary: BillingSummary, deviceManager: any): Promise<{ success: boolean; error?: string; jobId?: string }> {
    const settings = receiptPrinterSettingsService.getSettings();

    if (!settings.enabled) {
      return { success: false, error: "Receipt printing is not enabled" };
    }

    if (!settings.printerId) {
      return { success: false, error: "No receipt printer configured" };
    }

    try {
      // Convert billing summary to receipt data
      const receiptData = this.convertToReceiptData(billingSummary, settings);

      // Build ESC/POS receipt
      const receiptBytes = buildReceipt(receiptData);

      // Print via device manager
      const result = await deviceManager.print(settings.printerId, receiptBytes);

      if (result.success) {
        return { success: true, jobId: `bill-${Date.now()}` };
      } else {
        return { success: false, error: result.error || "Print failed" };
      }
    } catch (error) {
      console.error("Print bill error:", error);
      return { success: false, error: error instanceof Error ? error.message : "Print failed" };
    }
  }

  // Test print
  async testPrint(deviceManager: any): Promise<{ success: boolean; error?: string }> {
    return await receiptPrinterSettingsService.testPrint(deviceManager);
  }

  // Convert billing summary to receipt format
  private convertToReceiptData(billing: BillingSummary, settings: ReceiptPrinterSettings): ReceiptData {
    return {
      printerType: settings.printerType === "windows" ? "windows" : "escpos",
      paperWidth: settings.paperWidth,
      invoiceNumber: billing.invoiceNumber,
      invoiceDate: billing.invoiceDate,
      storeName: this.storeInfo.name,
      storeTagline: this.storeInfo.tagline,
      storeGSTIN: this.storeInfo.gstin,
      storeAddress: this.storeInfo.address,
      storePhone: this.storeInfo.phone,
      storeEmail: this.storeInfo.email,
      storeWebsite: this.storeInfo.website,
      storeCIN: this.storeInfo.cin,
      customerName: billing.customerName,
      customerPhone: billing.customerPhone,
      customerAddress: billing.customerAddress,
      items: billing.items.map(item => ({
        name: item.productName,
        variation: undefined,
        quantity: item.quantity,
        unit: "Nos",
        unitPrice: item.unitPrice,
        lineTotal: item.lineTotal,
        gstRate: item.gstRate,
        hsnCode: item.hsnCode,
      })),
      totals: {
        subtotal: billing.subtotal,
        discount: billing.totalDiscount,
        tax: billing.totalTax,
        shippingCharge: billing.shippingCharge,
        grandTotal: billing.grandTotal,
      },
      paymentMethod: billing.paymentMethod,
      footerLines: settings.footerLines,
      cutPaper: settings.autoCut,
      openCashDrawer: settings.openCashDrawer && billing.paymentMethod === "CASH",
      printBarcode: settings.printBarcode,
      barcodeData: billing.invoiceNumber,
    };
  }

  // Get printer status
  getPrinterStatus(): { configured: boolean; printerId: string; enabled: boolean } {
    const settings = receiptPrinterSettingsService.getSettings();
    return {
      configured: settings.enabled && !!settings.printerId,
      printerId: settings.printerId,
      enabled: settings.enabled
    };
  }
}

// Default store info for ATHIRA'S CREATIVE HAVEN
export const DEFAULT_STORE_INFO: StoreInfo = {
  name: "ATHIRA'S CREATIVE HAVEN",
  tagline: "Craft Supplies & Creative Classes",
  gstin: "33XXXXX0000X1Z5",
  address: [
    "No. 12, Craft Street, Teynampet",
    "Chennai, Tamil Nadu - 600018"
  ],
  phone: "+91 98765 43210",
  email: "hello@athirascreativehaven.in",
  website: "www.athirascreativehaven.in",
};

// Singleton instance
export const billingReceiptService = new BillingReceiptService(DEFAULT_STORE_INFO);