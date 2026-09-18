/**
 * Receipt Printer Settings Service
 * Manages POSIFLOW CN811 and other receipt printer configurations
 */

import { ReceiptPrinterSettings, POSIFLOW_CN811_DEFAULTS } from "../types/index.js";
import { loadConfig, saveConfig, AgentConfig, PrinterConfig } from "../config/index.js";

export class ReceiptPrinterSettingsService {
  private settings: ReceiptPrinterSettings;
  private config: AgentConfig;

  constructor() {
    this.config = loadConfig();
    this.settings = this.loadSettings();
  }

  private loadSettings(): ReceiptPrinterSettings {
    // Try to load from config file
    const fs = require("fs");
    const path = require("path");
    const settingsPath = path.join(process.cwd(), "receipt-printer-settings.json");

    if (fs.existsSync(settingsPath)) {
      try {
        const content = fs.readFileSync(settingsPath, "utf-8");
        return JSON.parse(content);
      } catch (e) {
        console.error("Failed to load receipt printer settings:", e);
      }
    }

    // Return defaults
    return {
      enabled: false,
      printerId: "",
      printerType: "usb",
      paperWidth: "80mm",
      autoCut: true,
      openCashDrawer: true,
      printBarcode: true,
      printLogo: false,
      footerLines: POSIFLOW_CN811_DEFAULTS.footerLines || [],
      ...POSIFLOW_CN811_DEFAULTS
    } as ReceiptPrinterSettings;
  }

  private saveSettings(): void {
    const fs = require("fs");
    const path = require("path");
    const settingsPath = path.join(process.cwd(), "receipt-printer-settings.json");
    fs.writeFileSync(settingsPath, JSON.stringify(this.settings, null, 2));
  }

  // Get current settings
  getSettings(): ReceiptPrinterSettings {
    return { ...this.settings };
  }

  // Update settings
  updateSettings(updates: Partial<ReceiptPrinterSettings>): ReceiptPrinterSettings {
    this.settings = { ...this.settings, ...updates };
    this.saveSettings();
    return this.getSettings();
  }

  // Enable/disable receipt printing
  setEnabled(enabled: boolean): void {
    this.settings.enabled = enabled;
    this.saveSettings();
  }

  // Configure for POSIFLOW CN811
  configureForPOSIFLOW(connectionType: "usb" | "serial" | "network" | "windows" | "bluetooth" = "usb",
    connectionDetails: {
      vendorId?: number;
      productId?: number;
      port?: string;
      baudRate?: number;
      ip?: string;
      portNumber?: number;
      windowsPrinterName?: string;
    } = {}): ReceiptPrinterSettings {

    const updates: Partial<ReceiptPrinterSettings> = {
      enabled: true,
      printerType: connectionType,
      printerId: `posiflow-${connectionType}-${Date.now()}`,
      paperWidth: "80mm",
      autoCut: true,
      openCashDrawer: true,
      printBarcode: true,
      printLogo: false,
      footerLines: POSIFLOW_CN811_DEFAULTS.footerLines || [],
    };

    // Set connection-specific details
    switch (connectionType) {
      case "usb":
        updates.vendorId = connectionDetails.vendorId || POSIFLOW_CN811_DEFAULTS.vendorId;
        updates.productId = connectionDetails.productId || POSIFLOW_CN811_DEFAULTS.productId;
        break;
      case "serial":
      case "bluetooth":
        updates.port = connectionDetails.port;
        updates.baudRate = connectionDetails.baudRate || 115200;
        break;
      case "network":
        updates.ip = connectionDetails.ip;
        updates.portNumber = connectionDetails.portNumber || 9100;
        break;
      case "windows":
        updates.windowsPrinterName = connectionDetails.windowsPrinterName;
        updates.printerType = "windows";
        break;
    }

    // Also add to printer config for the print agent
    const printerConfig: PrinterConfig = {
      id: updates.printerId!,
      name: `POSIFLOW CN811 (${connectionType.toUpperCase()})`,
      type: connectionType === "bluetooth" ? "serial" : connectionType,
      paperWidth: "80mm",
      profile: connectionType === "windows" ? "windows" : "escpos",
      isDefault: true,
      vendorId: updates.vendorId,
      productId: updates.productId,
      port: updates.port,
      baudRate: updates.baudRate,
      ip: updates.ip,
      portNumber: updates.portNumber,
      windowsPrinterName: updates.windowsPrinterName,
    };

    this.config.printers = this.config.printers.filter(p => p.id !== printerConfig.id);
    this.config.printers.push(printerConfig);
    saveConfig(this.config);

    return this.updateSettings(updates);
  }

  // Test print
  async testPrint(deviceManager: any): Promise<{ success: boolean; error?: string }> {
    if (!this.settings.enabled || !this.settings.printerId) {
      return { success: false, error: "Receipt printing not enabled or printer not selected" };
    }

    // Build test receipt
    const { buildTestReceipt } = await import("../escpos/receipt.js");
    const testReceipt = buildTestReceipt(this.settings.paperWidth);

    return await deviceManager.print(this.settings.printerId, testReceipt);
  }

  // Get printer config for print agent
  getPrinterConfig(): PrinterConfig | undefined {
    return this.config.printers.find(p => p.id === this.settings.printerId);
  }

  // Check if configured
  isConfigured(): boolean {
    return this.settings.enabled && !!this.settings.printerId;
  }

  // Get available connection types
  getConnectionTypes(): Array<{ value: string; label: string; description: string }> {
    return [
      { value: "usb", label: "USB", description: "Direct USB connection (POSIFLOW CN811 default)" },
      { value: "serial", label: "Serial/RS232", description: "Serial port or USB-to-Serial adapter" },
      { value: "bluetooth", label: "Bluetooth", description: "Bluetooth SPP connection" },
      { value: "network", label: "Network (Ethernet/WiFi)", description: "TCP/IP connection (port 9100)" },
      { value: "windows", label: "Windows Printer", description: "Use Windows installed printer driver" }
    ];
  }
}

// Singleton instance
export const receiptPrinterSettingsService = new ReceiptPrinterSettingsService();