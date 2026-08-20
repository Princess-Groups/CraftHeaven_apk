// =============================================================
// COMPANY & BILLING CONFIGURATION — edit this file to change what
// appears on every bill / receipt / invoice.
//
// The POS bill in /admin/pos reads all of this. Once you fill in
// your real details, they appear on every printed receipt.
// =============================================================

export const COMPANY = {
  // --- Basic identity -----------------------------------------
  name: "ATHIRA'S CREATIVE HAVEN",
  tagline: "Craft Supplies & Creative Classes",
  logo: "/ach-logo.png",

  // --- GST / tax identity -------------------------------------
  gstin: "33XXXXX0000X1Z5", // ← replace with your real GSTIN (placeholder)
  businessState: "Tamil Nadu",
  stateCode: "33", // GST state code (33 = Tamil Nadu)
  // CIN / LLPN for private companies / LLPs (optional)
  cin: "",

  // --- Contact -------------------------------------------------
  phone: "+91 98765 43210", // ← replace with your phone
  email: "hello@athirascreativehaven.in", // ← replace with your email
  website: "",

  // --- Registered office address -------------------------------
  addressLine1: "No. 12, Craft Street, Teynampet",
  addressLine2: "Chennai, Tamil Nadu — 600018",
  addressLine3: "", // optional third line
};

// When to show "INVOICE" vs "TAX INVOICE" heading on the bill.
export const TAX_INVOICE = true; // set false to show plain "INVOICE"

// Auto-print: when a sale completes at the counter, pop the print
// dialog automatically so it goes straight to the receipt printer.
export const AUTO_PRINT_POS = true; // set false to only print via the button

// =============================================================
// PRINT STYLES
// These ship the bill / receipt to the OS printer:
//   - a thermal 58/80mm receipt uses the narrow <2.9in> layout
//   - an 80mm / A4 page uses the wider layout
// .print-area  → the element that actually prints (everything else hides)
// Only the <div class="print-area"> content prints. .no-print hides.
// =============================================================

export const PRINT_CSS = `
  /* Screen preview: keep the receipt a narrow column (looks like a 58/80mm
     receipt) centred in the page. Nothing is hidden on screen. */
  .print-area { display:block !important; background:#fff !important; }
  .ind { font-family:'Poppins','Quicksand',system-ui,sans-serif !important; background:#fff !important; color:#111 !important; width:100%; max-width:3.1in; margin:0 auto; font-size:11px; line-height:1.35; }
  .ind * { background:#fff !important; color:#111 !important; }
  .ind .hdr { text-align:center; padding:2px 0; }
  .ind .hdr .nm { font-size:15px; font-weight:700; letter-spacing:.3px; }
  .ind .hdr .tg { font-size:9px; }
  .ind .hdr .gst { font-size:10px; font-weight:600; margin-top:2px; }
  .ind .addr { font-size:9px; color:#333 !important; margin-top:2px; }
  .ind .addr * { color:#333 !important; }
  .ind .row { display:flex; justify-content:space-between; gap:6px; }
  .ind .sep { border-top:1px dashed #999; margin:4px 0; }
  .ind .b { font-weight:700; }
  .ind .itm { font-size:10px; }
  .ind .g { font-size:9px; color:#333 !important; }
  .ind .g * { color:#333 !important; }
  .ind .tt { font-size:13px; font-weight:800; }
  .ind .words { font-size:9px; color:#111 !important; margin-top:2px; }
  .ind .foot { text-align:center; font-size:9px; margin-top:6px; }
  .ind table { width:100%; border-collapse:collapse; }
  .ind th { text-align:left; font-size:9px; border-bottom:1px solid #333; padding:2px 0; }
  .ind td { padding:2px 0; border-bottom:1px dotted #bbb; vertical-align:top; }
  .ind td.right, .ind th.right { text-align:right !important; }

  @media print {
    @page { size: auto; margin: 4mm; }
    .no-print { display:none !important; }
    body * { visibility: hidden; }
    .print-area, .print-area * { visibility: visible; }
    .print-area { position:absolute; left:0; top:0; width:100% !important; max-width:none !important; margin:0; padding:0; }
    .ind { max-width:none !important; margin:0 !important; }
  }
`;
