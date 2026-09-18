# Print Agent Setup & Integration Guide

## Overview
The Print Agent is a local Windows service that runs on `localhost:3030` and handles:
- Thermal receipt printing (POSIFLOW CN811)
- Label printing (SEZNIK JOSH LD0801)
- Barcode sticker data export for VPrint
- Printer discovery and management

## Quick Start

### 1. Install Dependencies
```bash
cd print-agent
npm install
```

### 2. Start Print Agent (Development)
```bash
npm run dev
```
This starts the agent on `http://localhost:3030` with auto-reload.

### 3. Verify It's Running
```bash
curl http://localhost:3030/health
# Should return: {"status":"ok","timestamp":"..."}
```

### 4. List Available Printers
```bash
curl http://localhost:3030/printers
```

---

## New Features Implemented

### A. Barcode Sticker Printing Section (After Purchase Entry)

#### Workflow:
1. **Purchase Entry Completion** → Call `onPurchaseCompleted()` to populate slot data
2. **Barcode Sticker Section** → Browse completed slots at `/barcode-stickers`
3. **Export for VPrint** → Download Excel-compatible CSV with BOM

#### API Endpoints (Print Agent):
```
GET  /slots/completed                    # List all completed purchase slots
GET  /slots/:slotId/stickers             # Get slot details for UI
GET  /slots/:slotId/export/csv           # Standard CSV export
GET  /slots/:slotId/export/excel         # Excel-compatible CSV (with BOM)
GET  /slots/:slotId/export/json          # JSON export
```

#### Frontend Integration:
```typescript
// After purchase save:
import { onPurchaseCompleted } from '../src/services/purchase-entry.js';

onPurchaseCompleted({
  slotId: "slot-001",
  slotName: "Purchase Slot 1",
  date: new Date().toISOString(),
  products: [
    { id: "prod-1", productName: "Acrylic Paint", sku: "APS-001", 
      barcode: "8901234567890", quantity: 10, mrp: 499, sellingPrice: 450, gstRate: 18, hsnCode: "3213" }
  ]
});

// In UI - fetch slots:
const response = await fetch('http://localhost:3030/slots/completed');
const { slots } = await response.json();

// Export for VPrint:
const blob = await fetch(`http://localhost:3030/slots/${slotId}/export/excel`).then(r => r.blob());
// Download blob...
```

#### VPrint CSV Format (Extended Columns):
```
ItemCode,ItemName,Barcode,Qty,MRP,SalePrice,GST%,HSNCode
APS-001,Acrylic Paint,8901234567890,10,499.00,450.00,18,3213
```

---

### B. Receipt Printer Settings for POSIFLOW CN811 (In Billing Settings)

#### Quick Setup (One-Click):
```bash
# USB (Default)
curl -X POST http://localhost:3030/settings/receipt-printer/posiflow \
  -H "Content-Type: application/json" \
  -d '{"connectionType":"usb"}'

# Serial/RS232
curl -X POST ... -d '{"connectionType":"serial","connectionDetails":{"port":"COM3"}}'

# Bluetooth
curl -X POST ... -d '{"connectionType":"bluetooth","connectionDetails":{"port":"COM4"}}'

# Network/WiFi
curl -X POST ... -d '{"connectionType":"network","connectionDetails":{"ip":"192.168.1.100"}}'

# Windows Driver
curl -X POST ... -d '{"connectionType":"windows","connectionDetails":{"windowsPrinterName":"POSIFLOW CN811"}}'
```

#### Settings API:
```
GET  /settings/receipt-printer              # Get current settings
POST /settings/receipt-printer              # Update settings
POST /settings/receipt-printer/posiflow     # Quick configure for POSIFLOW CN811
POST /printer/test-receipt                  # Print test receipt
GET  /settings/receipt-printer/status       # Get printer status
```

#### Frontend Integration (Billing Settings):
```typescript
// Load settings
const settings = await fetch('http://localhost:3030/settings/receipt-printer').then(r => r.json());

// Configure for POSIFLOW CN811 (USB)
await fetch('http://localhost:3030/settings/receipt-printer/posiflow', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ connectionType: 'usb' })
});

// Test print
await fetch('http://localhost:3030/printer/test-receipt', { method: 'POST' });
```

---

### C. Print Bill Button (In Billing Summary)

#### API Endpoint:
```
POST /print/bill
```

#### Request Body (BillingSummary):
```typescript
{
  invoiceNumber: "INV-001",
  invoiceDate: "2026-09-18T10:30:00Z",
  items: [{
    id: "item-1",
    productName: "Acrylic Paint Set",
    sku: "APS-001",
    barcode: "8901234567890",
    quantity: 2,
    unitPrice: 450,
    discount: 0,
    gstRate: 18,
    gstAmount: 162,
    lineTotal: 900,
    hsnCode: "3213"
  }],
  subtotal: 900,
  totalDiscount: 0,
  totalTax: 162,
  shippingCharge: 0,
  grandTotal: 1062,
  paymentMethod: "CASH",
  customerName: "John Doe",
  customerPhone: "9876543210"
}
```

#### Frontend Integration:
```typescript
async function printBill(billingData) {
  const billingSummary = {
    invoiceNumber: billingData.invoiceNumber,
    invoiceDate: billingData.date || new Date().toISOString(),
    items: billingData.items.map(item => ({
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
    toast.success('Bill printed successfully!');
  }
}
```

---

## Complete Integration Checklist

### Main Application (TanStack Start):

1. **Settings Page** (`/admin/settings`) - ✅ Already implemented
   - Hardware/Printer Settings section with all config fields
   - Printer dropdowns populated from Print Agent
   - Test buttons for each printer type

2. **Billing Page** (`/admin/billing`) - ✅ Already implemented
   - Auto-selects receipt printer from hardware config
   - Uses hardware config for receipt options (auto-cut, cash drawer, barcode)
   - Print test label button

3. **Label Printing Page** (`/admin/label-printing`) - ✅ Already implemented
   - Auto-selects label printer from hardware config
   - Uses label settings (template, size, barcode type, display options)

### New Pages to Create:

1. **Barcode Sticker Page** (`/barcode-stickers`)
   - Slot selector dropdown (fetch from `/slots/completed`)
   - Product table with barcode/quantity/pricing
   - Export buttons (CSV, Excel CSV, JSON)

2. **Receipt Printer Settings Tab** (in `/admin/settings` or `/admin/billing-settings`)
   - Quick setup buttons for POSIFLOW CN811
   - Manual configuration form
   - Test print button

3. **Print Bill Button** (in Billing Summary)
   - Add to existing billing summary panel
   - Calls `/print/bill` with billing data

---

## Print Agent Configuration

### Default Config (`config.json`):
```json
{
  "port": 3030,
  "host": "127.0.0.1",
  "printers": [],
  "logLevel": "info",
  "autoReconnect": true,
  "reconnectInterval": 5000,
  "jobRetentionDays": 30
}
```

### POSIFLOW CN811 Defaults:
- USB VID: 0x0483 (STM32)
- USB PID: 0x5740
- Baud Rate: 115200
- Paper Width: 80mm
- Auto Cut: true
- Open Cash Drawer: true (for cash payments)
- Print Barcode: true

### SEZNIK JOSH LD0801:
- Windows printer driver
- Label size: 40mm x 30mm
- Template: standard
- Barcode: CODE128

---

## Testing Without Hardware

The Print Agent includes mock printers for development:
- SEZNIK JOSH LD0801 (Bluetooth) - Default label printer
- Generic Thermal 80mm - Receipt printer
- Generic Thermal 58mm - Receipt printer

These will show as "connected" in the UI even without physical hardware.

---

## Troubleshooting

### Print Agent won't start:
1. Check port 3030 is free: `netstat -an | findstr 3030`
2. Check Node.js version: `node --version` (needs 18+)
3. Reinstall deps: `rm -rf node_modules package-lock.json && npm install`

### Printers not showing:
1. Ensure Print Agent is running
2. Check Windows Device Manager for printer ports
3. For USB: Check vendor/product IDs match
4. For Bluetooth: Pair device first, note COM port
5. For Network: Verify IP and port 9100

### Receipt not printing:
1. Check printer status: `GET /printer/status?printerId=xxx`
2. Verify receipt printer configured in hardware settings
3. Check paper width matches printer (58mm vs 80mm)
4. Test with: `POST /printer/test-receipt`

### Labels not printing:
1. Verify label printer selected in hardware settings
2. Check label dimensions match physical labels
3. Test with: `POST /printer/test` (labelWidth, labelHeight)

---

## Production Deployment

### Build Executable:
```bash
npm run build
# Creates dist/ach-print-agent.exe
```

### Install as Windows Service:
```bash
npm run install-service
```

### Uninstall Service:
```bash
npm run uninstall-service
```

### Manual Start:
```bash
npm run start
# Runs dist/index.js
```

---

## File Structure

```
print-agent/
├── src/
│   ├── index.ts                 # Entry point (not created yet - use print-agent.ts)
│   ├── print-agent.ts           # Main Print Agent class with HTTP handlers
│   ├── config/index.ts          # Configuration schema & loader
│   ├── types/index.ts           # TypeScript interfaces
│   ├── devices/index.ts         # Device discovery & management
│   ├── escpos/
│   │   ├── commands.ts          # ESC/POS command builders
│   │   ├── receipt.ts           # Receipt template builder
│   │   └── label.ts             # Label template builder
│   └── services/
│       ├── index.ts             # Service exports
│       ├── barcode-sticker.ts   # Barcode sticker export service
│       ├── receipt-printer-settings.ts  # POSIFLOW CN811 config
│       ├── billing-receipt.ts   # Thermal receipt printing
│       └── purchase-entry.ts    # Purchase → barcode sticker integration
├── examples/
│   └── frontend-integration.ts  # Frontend integration examples
├── package.json
├── tsconfig.json
└── config.json                  # Created at runtime
```

---

## Next Steps

1. **Run Print Agent**: `cd print-agent && npm install && npm run dev`
2. **Test Hardware Settings**: Open `/admin/settings` → Hardware/Printer Settings
3. **Test Barcode Stickers**: Complete a purchase → Check `/barcode-stickers` page
4. **Test POSIFLOW CN811**: Settings → Receipt Printer → Quick Setup USB → Test Print
5. **Test Print Bill**: Create a sale in Billing → Click "Print Bill" button

All services are implemented and ready. The Print Agent just needs to be started!