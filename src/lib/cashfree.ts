// Cashfree Payment Gateway — hosted checkout integration.
//
// This module only holds configuration + signature verification helpers. The
// actual HTTP calls live in server functions (src/lib/payment.functions.ts) so
// the client id, secret and endpoints never reach the browser bundle.
//
// API auth: every request carries the merchant keys in headers:
//   x-client-id / x-client-secret / x-api-version
// The order-create call is POST /orders and returns a payment_session_id the
// Cashfree JS SDK uses to open the hosted checkout on the client.

export const CASHFREE = {
  // Sandbox vs production. NOTE: both bases include the /pg prefix — the
  // order-create endpoint is POST {apiBase}/orders, i.e. sandbox.cashfree.com/pg/orders.
  apiBase: () =>
    process.env.CASHFREE_API_BASE ||
    (process.env.CASHFREE_ENV === "production"
      ? "https://api.cashfree.com/pg"
      : "https://sandbox.cashfree.com/pg"),
  clientId: () => process.env.CASHFREE_CLIENT_ID || "",
  clientSecret: () => process.env.CASHFREE_CLIENT_SECRET || "",
  // Pin the API version the order-create payload is built against. Bump when
  // Cashfree deprecates the current one (they announce it on their changelog).
  apiVersion: () => process.env.CASHFREE_API_VERSION || "2025-07-08",
  // Base public origin used to build the return / notify URLs.
  siteUrl: () => process.env.APP_URL || "http://localhost:3000",
  // Where the customer's browser lands after the hosted checkout finishes.
  returnUrl: () => process.env.CASHFREE_RETURN_URL || `${CASHFREE.siteUrl()}/checkout`,
  // URL Cashfree POSTs webhook events to (payment.orders → PAID etc.).
  notifyUrl: () =>
    process.env.CASHFREE_NOTIFY_URL || `${CASHFREE.siteUrl()}/api/payment/cashfree-webhook`,
  // Optional HMAC secret for verifying webhook signatures. If set, webhooks
  // that fail verification are rejected.
  webhookSecret: () => process.env.CASHFREE_WEBHOOK_SECRET || "",
};

/** Common headers for every Cashfree API call. */
export function cashfreeHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "x-api-version": CASHFREE.apiVersion(),
  };
  if (CASHFREE.clientId()) headers["x-client-id"] = CASHFREE.clientId();
  if (CASHFREE.clientSecret()) headers["x-client-secret"] = CASHFREE.clientSecret();
  return headers;
}

/** SHA-256 hex digest (uppercase) of a UTF-8 string. */
export async function sha256Hex(text: string): Promise<string> {
  const bytes = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Verify a Cashfree webhook signature (HMAC-SHA256).
 *
 * Cashfree signs webhooks with the header:
 *   x-webhook-signature: <timestamp>.<hex-hmac>
 * computed as HMAC_SHA256( secret, "<timestamp>.<raw_json_body>" ).
 *
 * Pass the raw body string (not a parsed object) so the hash covers the exact
 * bytes Cashfree signed.
 */
export async function verifyWebhookSignature(
  signature: string,
  timestamp: string,
  body: string,
): Promise<boolean> {
  const secret = CASHFREE.webhookSecret();
  if (!secret) return false; // no secret configured → reject (config error, not "verified")
  if (!signature || !timestamp) return false;

  const [sentTs, sentHmac] = signature.split(".");
  if (sentTs !== timestamp) return false;

  const bytes = new TextEncoder().encode(`${timestamp}.${body}`);
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = await crypto.subtle.sign("HMAC", key, bytes);
  const expected = Array.from(new Uint8Array(mac))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return expected === sentHmac;
}
