/**
 * Frontend Integration Examples
 * Shows how to integrate the new features into your billing application
 */

// ============================================================================
// 1. BARCODE STICKER PRINTING SECTION (After Purchase Entry)
// ============================================================================

/**
 * In your Purchase Entry completion handler:
 */

// Example: After purchase is saved to database
async function handlePurchaseComplete(purchaseData: any) {
  // Your existing purchase save logic...
  // await savePurchaseToDatabase(purchaseData);

  // THEN: Add to barcode sticker service
  const { onPurchaseCompleted } = await import('../src/services/purchase-entry.js');

  onPurchaseCompleted({
    slotId: purchaseData.slotId,
    slotName: purchaseData.slotName,
    date: new Date().toISOString(),
    products: purchaseData.items.map((item: any) => ({
      id: item.productId,
      productName: item.productName,
      sku: item.sku,
      barcode: item.barcode,
      quantity: item.quantity,
      mrp: item.mrp,
      sellingPrice: item.sellingPrice,
      gstRate: item.gstRate,
      hsnCode: item.hsnCode,
    }))
  });

  // Show success message with barcode sticker option
  showToast(`Purchase completed! ${purchaseData.items.length} products added to Barcode Sticker Printing section.`);
}

/**
 * In your UI - Barcode Sticker Section Component:
 */

// React/Vue/Svelte component example
async function BarcodeStickerSection() {
  // Fetch completed slots
  const response = await fetch('http://localhost:3030/slots/completed');
  const { slots } = await response.json();

  // Render slot selector
  return (
    <div className="barcode-sticker-section">
      <h2>Barcode Sticker Printing</h2>
      <p>Select a purchase slot to view products and export barcode data for VPrint</p>

      <select onChange={handleSlotSelect}>
        <option value="">Select a slot...</option>
        {slots.map((slot: any) => (
          <option key={slot.id} value={slot.id}>
            {slot.name} - {slot.totalProducts} products, {slot.totalQuantity} units
          </option>
        ))}
      </select>

      {selectedSlot && (
        <SlotDetailView slotId={selectedSlot} />
      )}
    </div>
  );
}

async function SlotDetailView({ slotId }: { slotId: string }) {
  // Fetch slot details
  const response = await fetch(`http://localhost:3030/slots/${slotId}/stickers`);
  const slotData = await response.json();

  return (
    <div className="slot-detail">
      <h3>{slotData.slotName}</h3>
      <p>Total Products: {slotData.totalProducts} | Total Quantity: {slotData.totalQuantity}</p>

      <table>
        <thead>
          <tr>
            <th>Product Name</th>
            <th>SKU / Item Code</th>
            <th>Barcode Number</th>
            <th>Quantity</th>
            <th>MRP</th>
            <th>Selling Price</th>
          </tr>
        </thead>
        <tbody>
          {slotData.products.map((product: any) => (
            <tr key={product.sku}>
              <td>{product.name}</td>
              <td>{product.sku}</td>
              <td><code>{product.barcode}</code></td>
              <td>{product.qty}</td>
              <td>₹{product.mrp.toFixed(2)}</td>
              <td>₹{product.price.toFixed(2)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="export-buttons">
        <button onClick={() => downloadExport(slotId, 'excel')}>
          📥 Export for VPrint (Excel CSV)
        </button>
        <button onClick={() => downloadExport(slotId, 'csv')}>
          📄 Export CSV
        </button>
        <button onClick={() => downloadExport(slotId, 'json')}>
          📋 Export JSON
        </button>
      </div>
    </div>
  );
}

async function downloadExport(slotId: string, format: 'csv' | 'excel' | 'json') {
  const endpoint = format === 'excel' ? 'excel' : format;
  const response = await fetch(`http://localhost:3030/slots/${slotId}/export/${endpoint}`);

  if (response.ok) {
    const blob = await response.blob();
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = response.headers.get('Content-Disposition')?.split('filename=')[1]?.replace(/"/g, '') || `export.${format}`;
    a.click();
    window.URL.revokeObjectURL(url);
  } else {
    showToast('Export failed');
  }
}

// ============================================================================
// 2. RECEIPT PRINTER SETTINGS (In Billing Settings)
// ============================================================================

/**
 * Billing Settings Component - Receipt Printer Tab
 */

async function ReceiptPrinterSettings() {
  const [settings, setSettings] = useState(null);
  const [printers, setPrinters] = useState([]);
  const [testing, setTesting] = useState(false);

  // Load settings on mount
  useEffect(() => {
    loadSettings();
    loadPrinters();
  }, []);

  async function loadSettings() {
    const response = await fetch('http://localhost:3030/settings/receipt-printer');
    const data = await response.json();
    setSettings(data);
  }

  async function loadPrinters() {
    const response = await fetch('http://localhost:3030/printers');
    const { printers: printerList } = await response.json();
    setPrinters(printerList);
  }

  async function handleConfigurePOSIFLOW(connectionType: string, details: any) {
    const response = await fetch('http://localhost:3030/settings/receipt-printer/posiflow', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ connectionType, connectionDetails: details })
    });
    const data = await response.json();
    setSettings(data);
    showToast('POSIFLOW CN811 configured successfully!');
  }

  async function handleTestPrint() {
    setTesting(true);
    try {
      const response = await fetch('http://localhost:3030/printer/test-receipt', {
        method: 'POST'
      });
      const result = await response.json();
      if (result.success) {
        showToast('Test receipt printed successfully!');
      } else {
        showToast(`Test print failed: ${result.error}`);
      }
    } finally {
      setTesting(false);
    }
  }

  return (
    <div className="receipt-printer-settings">
      <h3>Receipt Printer Settings (POSIFLOW CN811)</h3>

      <div className="settings-section">
        <h4>Quick Setup - POSIFLOW CN811</h4>
        <div className="connection-types">
          <button onClick={() => handleConfigurePOSIFLOW('usb', {})}>
            🔌 USB (Default)
          </button>
          <button onClick={() => handleConfigurePOSIFLOW('serial', { port: 'COM3' })}>
            📟 Serial/RS232
          </button>
          <button onClick={() => handleConfigurePOSIFLOW('bluetooth', { port: 'COM4' })}>
            📱 Bluetooth
          </button>
          <button onClick={() => handleConfigurePOSIFLOW('network', { ip: '192.168.1.100' })}>
            🌐 Network/WiFi
          </button>
          <button onClick={() => handleConfigurePOSIFLOW('windows', { windowsPrinterName: 'POSIFLOW CN811' })}>
            🖨️ Windows Driver
          </button>
        </div>
      </div>

      <div className="settings-section">
        <h4>Manual Configuration</h4>
        <label>
          Enable Receipt Printing
          <input
            type="checkbox"
            checked={settings?.enabled}
            onChange={(e) => updateSetting('enabled', e.target.checked)}
          />
        </label>

        <label>
          Printer:
          <select
            value={settings?.printerId || ''}
            onChange={(e) => updateSetting('printerId', e.target.value)}
          >
            <option value="">Select printer...</option>
            {printers.map((p: any) => (
              <option key={p.id} value={p.id}>
                {p.name} ({p.type}) - {p.status}
              </option>
            ))}
          </select>
        </label>

        <label>
          Paper Width:
          <select
            value={settings?.paperWidth || '80mm'}
            onChange={(e) => updateSetting('paperWidth', e.target.value)}
          >
            <option value="58mm">58mm (2 inch)</option>
            <option value="80mm">80mm (3 inch)</option>
          </select>
        </label>

        <label>
          <input
            type="checkbox"
            checked={settings?.autoCut}
            onChange={(e) => updateSetting('autoCut', e.target.checked)}
          />
          Auto Cut Paper
        </label>

        <label>
          <input
            type="checkbox"
            checked={settings?.openCashDrawer}
            onChange={(e) => updateSetting('openCashDrawer', e.target.checked)}
          />
          Open Cash Drawer (Cash payments)
        </label>

        <label>
          <input
            type="checkbox"
            checked={settings?.printBarcode}
            onChange={(e) => updateSetting('printBarcode', e.target.checked)}
          />
          Print Barcode on Receipt
        </label>

        <button onClick={handleTestPrint} disabled={testing}>
          {testing ? 'Printing...' : '🖨️ Print Test Receipt'}
        </button>
      </div>
    </div>
  );
}

async function updateSetting(key: string, value: any) {
  const response = await fetch('http://localhost:3030/settings/receipt-printer', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ [key]: value })
  });
  const data = await response.json();
  setSettings(data);
}

// ============================================================================
// 3. PRINT BILL BUTTON (In Billing Summary)
// ============================================================================

/**
 * Billing Summary Component - Add Print Bill Button
 */

function BillingSummary({ billingData }: { billingData: any }) {
  const [printing, setPrinting] = useState(false);

  const handlePrintBill = async () => {
    setPrinting(true);
    try {
      // Prepare billing summary in the required format
      const billingSummary = {
        invoiceNumber: billingData.invoiceNumber,
        invoiceDate: billingData.date || new Date().toISOString(),
        items: billingData.items.map((item: any) => ({
          id: item.id,
          productName: item.productName,
          sku: item.sku,
          barcode: item.barcode,
          quantity: item.quantity,
          unitPrice: item.unitPrice,
          discount: item.discount || 0,
          gstRate: item.gstRate,
          gstAmount: item.gstAmount,
          lineTotal: item.lineTotal,
          hsnCode: item.hsnCode,
        })),
        subtotal: billingData.subtotal,
        totalDiscount: billingData.totalDiscount || 0,
        totalTax: billingData.totalTax,
        shippingCharge: billingData.shippingCharge || 0,
        grandTotal: billingData.grandTotal,
        paymentMethod: billingData.paymentMethod,
        customerName: billingData.customerName,
        customerPhone: billingData.customerPhone,
        customerAddress: billingData.customerAddress,
      };

      const response = await fetch('http://localhost:3030/print/bill', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(billingSummary)
      });

      const result = await response.json();
      if (result.success) {
        showToast('Bill printed successfully!');
      } else {
        showToast(`Print failed: ${result.error}`);
      }
    } catch (error) {
      showToast('Print error: ' + error.message);
    } finally {
      setPrinting(false);
    }
  };

  return (
    <div className="billing-summary">
      {/* Existing billing summary UI */}

      <div className="billing-actions">
        <button
          className="print-bill-btn"
          onClick={handlePrintBill}
          disabled={printing}
        >
          {printing ? '🖨️ Printing...' : '🖨️ Print Bill'}
        </button>
        {/* Other buttons like Save, Email, WhatsApp, etc. */}
      </div>
    </div>
  );
}

// ============================================================================
// 4. COMPLETE WORKFLOW INTEGRATION
// ============================================================================

/**
 * Complete workflow integration in your main App component
 */

function App() {
  return (
    <div className="app">
      {/* Existing navigation */}
      <nav>
        <Link to="/purchase-entry">Purchase Entry</Link>
        <Link to="/barcode-stickers">Barcode Stickers</Link>
        <Link to="/billing">Billing</Link>
        <Link to="/settings">Settings</Link>
      </nav>

      <Routes>
        {/* Existing routes */}
        <Route path="/purchase-entry" element={<PurchaseEntryPage />} />

        {/* NEW: Barcode Sticker Printing Section */}
        <Route path="/barcode-stickers" element={<BarcodeStickerPage />} />

        {/* Existing billing with new Print Bill button */}
        <Route path="/billing" element={<BillingPage />} />

        {/* Settings with Receipt Printer tab */}
        <Route path="/settings" element={<SettingsPage />} />
      </Routes>
    </div>
  );
}

// ============================================================================
// 5. API SERVICE LAYER (For clean frontend integration)
// ============================================================================

/**
 * Create an API service file for your frontend
 */

const API_BASE = 'http://localhost:3030';

export const printAgentAPI = {
  // Barcode Stickers
  async getCompletedSlots() {
    const res = await fetch(`${API_BASE}/slots/completed`);
    return res.json();
  },

  async getSlotStickers(slotId: string) {
    const res = await fetch(`${API_BASE}/slots/${slotId}/stickers`);
    return res.json();
  },

  async exportSlot(slotId: string, format: 'csv' | 'excel' | 'json') {
    const res = await fetch(`${API_BASE}/slots/${slotId}/export/${format}`);
    return res.blob();
  },

  // Receipt Printer Settings
  async getReceiptSettings() {
    const res = await fetch(`${API_BASE}/settings/receipt-printer`);
    return res.json();
  },

  async updateReceiptSettings(settings: any) {
    const res = await fetch(`${API_BASE}/settings/receipt-printer`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(settings)
    });
    return res.json();
  },

  async configurePOSIFLOW(connectionType: string, details: any) {
    const res = await fetch(`${API_BASE}/settings/receipt-printer/posiflow`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ connectionType, connectionDetails: details })
    });
    return res.json();
  },

  async testReceiptPrint() {
    const res = await fetch(`${API_BASE}/printer/test-receipt`, { method: 'POST' });
    return res.json();
  },

  // Billing Receipt
  async printBill(billingSummary: any) {
    const res = await fetch(`${API_BASE}/print/bill`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(billingSummary)
    });
    return res.json();
  },

  // Printers
  async getPrinters() {
    const res = await fetch(`${API_BASE}/printers`);
    return res.json();
  },

  async getPrinterStatus(printerId: string) {
    const res = await fetch(`${API_BASE}/printer/status?printerId=${printerId}`);
    return res.json();
  }
};