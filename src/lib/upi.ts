// UPI deep-link payments (GPay / PhonePe / Paytm) — no third-party gateway.
// The app opens the customer's UPI app with a pre-filled intent; the customer
// approves the payment there, then comes back and confirms with their UTR.

export type UpiApp = {
  id: string;
  name: string;
  color: string;          // tailwind bg class used for the app chip
  badgeBg: string;        // soft badge background
  scheme: (params: UpiParams) => string;
};

export type UpiParams = {
  vpa: string;            // merchant UPI ID, e.g. athira.shop@okhdfcbank
  name: string;           // payee display name
  amount: number;         // in rupees
  note: string;           // e.g. "Order #AB12CD34"
};

export const UPIS_APPS: UpiApp[] = [
  {
    id: "gpay",
    name: "Google Pay",
    color: "bg-[#1a73e8]",
    badgeBg: "bg-[#e8f0fe] text-[#1a73e8]",
    scheme: (p) =>
      `upi://pay?pa=${encodeURIComponent(p.vpa)}&pn=${encodeURIComponent(p.name)}&am=${p.amount}&tn=${encodeURIComponent(p.note)}&cu=INR`,
  },
  {
    id: "phonepe",
    name: "PhonePe",
    color: "bg-[#5f259f]",
    badgeBg: "bg-[#efe6fb] text-[#5f259f]",
    scheme: (p) =>
      `phonepe://pay?pa=${encodeURIComponent(p.vpa)}&pn=${encodeURIComponent(p.name)}&am=${p.amount}&tn=${encodeURIComponent(p.note)}&cu=INR`,
  },
  {
    id: "paytm",
    name: "Paytm",
    color: "bg-[#00baf2]",
    badgeBg: "bg-[#e0f7fe] text-[#0091bd]",
    scheme: (p) =>
      `paytmmp://pay?pa=${encodeURIComponent(p.vpa)}&pn=${encodeURIComponent(p.name)}&am=${p.amount}&tn=${encodeURIComponent(p.note)}&cu=INR`,
  },
  {
    id: "upi",
    name: "Other UPI",
    color: "bg-secondary",
    badgeBg: "bg-secondary-soft text-secondary-foreground",
    scheme: (p) =>
      `upi://pay?pa=${encodeURIComponent(p.vpa)}&pn=${encodeURIComponent(p.name)}&am=${p.amount}&tn=${encodeURIComponent(p.note)}&cu=INR`,
  },
];

/** Build the payment reference shown to the customer (readable order id). */
export function orderRef(orderId: string): string {
  return `ACH${orderId.replace(/-/g, "").slice(0, 8).toUpperCase()}`;
}

/** Try to open a UPI app via its deep link. Returns true if navigation started. */
export function launchUpiApp(app: UpiApp, params: UpiParams): boolean {
  const url = app.scheme(params);
  try {
    window.location.href = url;
    return true;
  } catch {
    return false;
  }
}
