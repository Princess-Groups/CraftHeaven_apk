import { AgentConfig, PrinterConfig, DEFAULT_CONFIG, loadConfig, saveConfig } from './config/index.js';
import { DeviceManager } from './devices/index.js';
import { buildReceipt, ReceiptData } from './escpos/receipt.js';
import { buildTestLabel, buildBatchLabels } from './escpos/label.js';
import { barcodeStickerService } from './services/barcode-sticker.js';
import { receiptPrinterSettingsService } from './services/receipt-printer-settings.js';
import { billingReceiptService } from './services/billing-receipt.js';
import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import express from 'express';

export class PrintAgent {
  private config: AgentConfig;
  private deviceManager!: DeviceManager;
  private app: express.Express;
  private server: any;
  private wsServer!: WebSocketServer;
  private isRunning = false;

  constructor() {
    this.config = DEFAULT_CONFIG;
    this.app = express();
    this.app.use(express.json());
  }

  async start(): Promise<void> {
    // Load configuration from file if exists
    const loadedConfig = loadConfig();
    this.config = loadedConfig || DEFAULT_CONFIG;

    // Initialize device manager
    this.deviceManager = new DeviceManager(this.config);

    // Discover printers on startup
    await this.deviceManager.discover();

    // Setup web server
    this.setupHTTPHandlers();
    this.startHTTPServer();
    this.startWebSocketServer();

    this.isRunning = true;
    console.log('Print Agent started successfully on http://localhost:' + this.config.port);
  }

  private setupHTTPHandlers(): void {
    // Print receipt job
    this.app.post('/print/receipt', async (req, res) => {
      try {
        const job = this.validatePrintJob(req.body);
        if (!job) {
          return res.status(400).json({ error: 'Invalid print job' });
        }

        const jobId = await this.enqueuePrintJob(job);
        res.json({ jobId, status: 'completed' });
      } catch (error) {
        console.error('Print receipt error:', error);
        res.status(500).json({ error: 'Server error' });
      }
    });

    // Print label job - THE MAIN ENDPOINT FOR LABEL PRINTING
    this.app.post('/print/label', async (req, res) => {
      try {
        const job = this.validateLabelJob(req.body);
        if (!job) {
          return res.status(400).json({ error: 'Invalid label job' });
        }

        const jobId = await this.enqueueAndExecuteLabelJob(job);
        res.json({ jobId, status: 'completed' });
      } catch (error) {
        console.error('Print label error:', error);
        res.status(500).json({ error: error instanceof Error ? error.message : 'Server error' });
      }
    });

    // Printer status
    this.app.get('/printer/status', (req, res) => {
      const { printerId } = req.query;
      if (!printerId) {
        return res.status(400).json({ error: 'printerId required' });
      }

      const printer = this.deviceManager.getPrinterStatus(printerId as string);
      if (!printer) {
        return res.status(404).json({ error: 'Printer not found' });
      }

      res.json({
        status: printer.status,
        connected: printer.status === 'connected',
        type: printer.type,
        paperWidth: printer.paperWidth,
        labelWidth: printer.labelWidth,
        labelHeight: printer.labelHeight,
        capabilities: printer.capabilities
      });
    });

    // Test print
    this.app.post('/printer/test', async (req, res) => {
      const { printerId, labelWidth, labelHeight } = req.body;
      if (!printerId) {
        return res.status(400).json({ error: 'printerId required' });
      }

      const printer = this.deviceManager.getPrinterStatus(printerId);
      if (!printer || printer.status !== 'connected') {
        return res.status(404).json({ error: 'Printer not found or offline' });
      }

      try {
        // Build test label
        const testLabel = buildTestLabel();

        // Send to printer
        const result = await this.deviceManager.print(printerId, testLabel);

        if (result.success) {
          res.json({
            success: true,
            message: 'Test label sent successfully',
            printerId
          });
        } else {
          res.status(500).json({
            success: false,
            error: result.error || 'Test print failed'
          });
        }
      } catch (error) {
        console.error('Test print error:', error);
        res.status(500).json({
          success: false,
          error: error instanceof Error ? error.message : 'Test print failed'
        });
      }
    });

    // List all printers
    this.app.get('/printers', (req, res) => {
      const printers = this.deviceManager.getAllPrinters();
      res.json({ printers });
    });

    // Health check
    this.app.get('/health', (req, res) => {
      res.json({ status: 'ok', timestamp: new Date().toISOString() });
    });

    // ===== BARCODE STICKER EXPORT ENDPOINTS =====

    // Get completed purchase slots
    this.app.get('/slots/completed', (req, res) => {
      const slots = barcodeStickerService.getCompletedSlots();
      res.json({
        slots: slots.map(s => ({
          id: s.id,
          name: s.name,
          date: s.date,
          totalProducts: s.products.length,
          totalQuantity: s.totalQuantity,
          totalValue: s.totalValue
        }))
      });
    });

    // Get slot details for barcode sticker section
    this.app.get('/slots/:slotId/stickers', (req, res) => {
      const { slotId } = req.params;
      const summary = barcodeStickerService.getSlotSummary(slotId);
      if (!summary) {
        return res.status(404).json({ error: 'Slot not found' });
      }
      res.json(summary);
    });

    // Export barcode data for VPrint (CSV)
    this.app.get('/slots/:slotId/export/csv', (req, res) => {
      const { slotId } = req.params;
      try {
        const csv = barcodeStickerService.exportForVPrint(slotId);
        const slot = barcodeStickerService.getSlot(slotId);
        const filename = `Barcode_Stickers_${slot?.name.replace(/[^a-zA-Z0-9]/g, '_')}_${new Date().toISOString().split('T')[0]}.csv`;

        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        res.send(csv);
      } catch (error) {
        res.status(404).json({ error: error instanceof Error ? error.message : 'Export failed' });
      }
    });

    // Export barcode data (Excel-compatible CSV with BOM)
    this.app.get('/slots/:slotId/export/excel', (req, res) => {
      const { slotId } = req.params;
      try {
        const content = barcodeStickerService.exportToExcelCSV(slotId);
        const slot = barcodeStickerService.getSlot(slotId);
        const filename = `Barcode_Stickers_${slot?.name.replace(/[^a-zA-Z0-9]/g, '_')}_${new Date().toISOString().split('T')[0]}.csv`;

        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        res.send(Buffer.from(content));
      } catch (error) {
        res.status(404).json({ error: error instanceof Error ? error.message : 'Export failed' });
      }
    });

    // Export barcode data (JSON)
    this.app.get('/slots/:slotId/export/json', (req, res) => {
      const { slotId } = req.params;
      try {
        const json = barcodeStickerService.exportToJSON(slotId);
        const slot = barcodeStickerService.getSlot(slotId);
        const filename = `Barcode_Stickers_${slot?.name.replace(/[^a-zA-Z0-9]/g, '_')}_${new Date().toISOString().split('T')[0]}.json`;

        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        res.send(json);
      } catch (error) {
        res.status(404).json({ error: error instanceof Error ? error.message : 'Export failed' });
      }
    });

    // ===== RECEIPT PRINTER SETTINGS ENDPOINTS =====

    // Get receipt printer settings
    this.app.get('/settings/receipt-printer', (req, res) => {
      const settings = receiptPrinterSettingsService.getSettings();
      res.json(settings);
    });

    // Update receipt printer settings
    this.app.post('/settings/receipt-printer', (req, res) => {
      const settings = receiptPrinterSettingsService.updateSettings(req.body);
      res.json(settings);
    });

    // Configure for POSIFLOW CN811
    this.app.post('/settings/receipt-printer/posiflow', (req, res) => {
      const { connectionType, connectionDetails } = req.body;
      try {
        const settings = receiptPrinterSettingsService.configureForPOSIFLOW(
          connectionType || 'usb',
          connectionDetails || {}
        );
        res.json(settings);
      } catch (error) {
        res.status(400).json({ error: error instanceof Error ? error.message : 'Configuration failed' });
      }
    });

    // Test receipt print
    this.app.post('/printer/test-receipt', async (req, res) => {
      try {
        const result = await receiptPrinterSettingsService.testPrint(this.deviceManager);
        if (result.success) {
          res.json({ success: true, message: 'Test receipt sent successfully' });
        } else {
          res.status(500).json({ success: false, error: result.error || 'Test print failed' });
        }
      } catch (error) {
        res.status(500).json({ success: false, error: error instanceof Error ? error.message : 'Test print failed' });
      }
    });

    // ===== BILLING RECEIPT PRINTING ENDPOINT =====

    // Print billing summary (bill)
    this.app.post('/print/bill', async (req, res) => {
      try {
        const billingSummary = req.body;
        if (!billingSummary || !billingSummary.invoiceNumber) {
          return res.status(400).json({ error: 'Invalid billing summary' });
        }

        const result = await billingReceiptService.printBill(billingSummary, this.deviceManager);
        if (result.success) {
          res.json({ success: true, jobId: result.jobId, message: 'Bill printed successfully' });
        } else {
          res.status(500).json({ success: false, error: result.error || 'Print failed' });
        }
      } catch (error) {
        console.error('Print bill error:', error);
        res.status(500).json({ error: error instanceof Error ? error.message : 'Server error' });
      }
    });

    // Get billing printer status
    this.app.get('/settings/receipt-printer/status', (req, res) => {
      const status = billingReceiptService.getPrinterStatus();
      res.json(status);
    });
  }

  private validatePrintJob(data: any): {
    printerType: 'escpos' | 'windows';
    printerId: string;
    invoiceNumber: string;
    storeInfo: any;
    customerInfo?: any;
    items: any[];
    totals: any;
    paymentMethod: string;
  } | null {
    const required = [
      'printerId', 'invoiceNumber', 'storeInfo',
      'items', 'totals', 'paymentMethod'
    ];

    for (const field of required) {
      if (!data[field]) return null;
    }

    const printerConfig = this.config.printers.find(p => p.id === data.printerId) ||
      this.deviceManager.getAllPrinters().find(p => p.id === data.printerId);
    if (!printerConfig) return null;

    const isWindows = (printerConfig as any).profile === 'windows' || (printerConfig as any).type === 'windows';

    return {
      printerType: isWindows ? 'windows' : 'escpos',
      printerId: data.printerId,
      invoiceNumber: data.invoiceNumber,
      storeInfo: data.storeInfo,
      customerInfo: data.customerInfo,
      items: data.items,
      totals: data.totals,
      paymentMethod: data.paymentMethod,
    };
  }

  private validateLabelJob(data: any): {
    printerType: 'escpos' | 'windows';
    printerId: string;
    items: any[];
    storeName: string;
    storeAddress?: string;
    labelWidth: number;
    labelHeight: number;
    margin?: number;
    copies?: number;
    template?: string;
  } | null {
    const required = ["printerId", "items", "storeName", "labelWidth", "labelHeight"];
    for (const field of required) {
      if (!data[field]) return null;
    }

    const printerConfig = this.config.printers.find(p => p.id === data.printerId);
    if (!printerConfig) return null;

    return {
      printerType: printerConfig.profile === 'windows' ? 'windows' : 'escpos',
      printerId: data.printerId,
      items: data.items,
      storeName: data.storeName,
      storeAddress: data.storeAddress,
      labelWidth: data.labelWidth,
      labelHeight: data.labelHeight,
      margin: data.margin || 2,
      copies: data.copies || 1,
      template: data.template || 'standard',
    };
  }

  // Execute label print job immediately
  private async enqueueAndExecuteLabelJob(job: any): Promise<string> {
    const jobId = `label-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

    // Build label data for ESC/POS
    const labelData = buildBatchLabels(
      job.items.map((item: any) => ({
        productName: item.productName,
        barcode: item.barcode,
        price: item.sellingPrice,
        mrp: item.mrp,
        sku: item.sku,
        quantity: item.quantity,
      })),
      job.storeName,
      job.storeAddress || '',
      job.labelWidth,
      job.labelHeight
    );

    // Send to printer
    const result = await this.deviceManager.print(job.printerId, labelData);

    if (!result.success) {
      throw new Error(result.error || 'Failed to send to printer');
    }

    return jobId;
  }

  // Execute receipt print job immediately
  private async enqueuePrintJob(job: any): Promise<string> {
    const jobId = `receipt-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

    const printerConfig =
      this.config.printers.find(p => p.id === job.printerId) ||
      this.deviceManager.getAllPrinters().find(p => p.id === job.printerId);

    const candPaper = (printerConfig as any)?.paperWidth;
    const paperWidth: "58mm" | "80mm" = candPaper === "58mm" || candPaper === "80mm" ? candPaper : "80mm";
    const isWindows =
      (printerConfig as any)?.profile === 'windows' || (printerConfig as any)?.type === 'windows';

    const num = (v: any): number => {
      const n = Number(v ?? 0);
      return isFinite(n) ? n : 0;
    };

    const totals = {
      subtotal: num(job.totals?.subtotal ?? job.subtotal),
      discount: num(job.totals?.discount ?? job.discount),
      tax: num(job.totals?.tax ?? job.tax),
      shippingCharge: num(job.totals?.shippingCharge ?? job.shippingCharge),
      grandTotal: num(job.totals?.grandTotal ?? job.grandTotal),
    };

    const paymentMethods: Array<"CASH" | "UPI" | "CARD" | "COD"> = ["CASH", "UPI", "CARD", "COD"];
    const paymentMethod: "CASH" | "UPI" | "CARD" | "COD" = paymentMethods.includes(job.paymentMethod)
      ? job.paymentMethod
      : "CASH";

    const receiptData: ReceiptData = {
      printerType: isWindows ? "windows" : "escpos",
      paperWidth,
      invoiceNumber: job.invoiceNumber,
      invoiceDate: job.invoiceDate || new Date().toISOString(),
      storeName: job.storeInfo?.name || "",
      storeTagline: job.storeInfo?.tagline,
      storeGSTIN: job.storeInfo?.gstin,
      storeAddress: Array.isArray(job.storeInfo?.address) ? job.storeInfo.address.map(String) : [],
      storePhone: job.storeInfo?.phone,
      storeEmail: job.storeInfo?.email,
      storeWebsite: job.storeInfo?.website,
      storeCIN: job.storeInfo?.cin,
      customerName: job.customerInfo?.name,
      customerPhone: job.customerInfo?.phone,
      customerAddress: job.customerInfo?.address,
      items: (job.items || []).map((item: any) => ({
        name: item.productName || item.name || "Item",
        variation: item.variation,
        quantity: num(item.quantity) || 1,
        unit: item.unit || "Nos",
        unitPrice: num(item.unitPrice),
        lineTotal: num(item.lineTotal),
        gstRate: num(item.gstRate),
        hsnCode: item.hsnCode,
      })),
      subtotal: totals.subtotal,
      discount: totals.discount,
      tax: totals.tax,
      shippingCharge: totals.shippingCharge,
      grandTotal: totals.grandTotal,
      paymentMethod,
      footerLines: job.footerLines,
      cutPaper: job.options?.cutPaper ?? true,
      openCashDrawer: job.options?.openCashDrawer ?? false,
      printBarcode: job.options?.printBarcode ?? false,
      barcodeData: job.options?.barcodeData,
    };

    const receiptBytes = buildReceipt(receiptData);
    const result = await this.deviceManager.print(job.printerId, receiptBytes);

    if (!result.success) {
      throw new Error(result.error || 'Failed to send to printer');
    }

    return jobId;
  }

  private startWebSocketServer(): void {
    // For future real-time status updates
    this.server.on('upgrade', (request: any, socket: any, head: any) => {
      if (request.url === '/ws') {
        this.wsServer.handleUpgrade(request, socket, head, (ws: any) => {
          this.wsServer.emit('connection', ws, request);
        });
      }
    });

    this.wsServer.on('connection', (ws: any) => {
      console.log('WebSocket client connected');

      ws.on('message', (message: any) => {
        try {
          const data = JSON.parse(message.toString());
          // Handle real-time commands
        } catch (e) {
          console.error('Invalid WS message:', e);
        }
      });

      ws.on('close', () => {
        console.log('WebSocket client disconnected');
      });
    });
  }

  private startHTTPServer(): void {
    this.server = createServer(this.app);
    this.wsServer = new WebSocketServer({ noServer: true });

    this.server.listen(this.config.port, this.config.host, () => {
      console.log(`Print Agent HTTP server listening on ${this.config.host}:${this.config.port}`);
    });
  }
}