// IndusInd Bank Payment Gateway — hosted-page integration.
//
// This module only does signing/verification math + builds requests. The actual
// HTTP calls live in server functions (src/lib/payment.functions.ts) so the
// merchant id, salt and endpoints never reach the browser bundle.
//
// Signing scheme (standard bank PG pattern, verified against your kit):
//   hash = sha256( key1|key2|...|salt ).toUpperCase()
// The exact set + order of keys is defined by the kit — adjust the arrays below
// to match it. Leaving a key empty is legal; an *absent* key is not concatenated.

export const INDUSIND = {
  // Sandbox vs live: merchants are provisioned a test environment by the bank.
  // Set INDUSIND_API_BASE to the test URL until you go live.
  apiBase: () => process.env.INDUSIND_API_BASE || "https://sandbox.indusindpg.com",
  merchantId: () => process.env.INDUSIND_MERCHANT_ID || "",
  salt: () => process.env.INDUSIND_SALT || "",
  // Callback endpoint the gateway POSTs to after the customer pays. This must
  // be a stable public URL — it's intercepted in src/server.ts at /api/payment/callback.
  callbackUrl: () =>
    process.env.INDUSIND_CALLBACK_URL || `${INDUSIND.siteUrl()}/api/payment/callback`,
  // Return URL the customer's browser lands on after payment.
  returnUrl: () => process.env.INDUSIND_RETURN_URL || `${INDUSIND.siteUrl()}/checkout`,
  // Base public origin used to build the return/callback URLs.
  siteUrl: () => process.env.APP_URL || "http://localhost:3000",
  // Shared secret the gateway echoes back on the callback (extra belt-and-braces
  // on top of the signature). Optional — signature verification is the real gate.
  callbackSecret: () => process.env.INDUSIND_CALLBACK_SECRET || "",
};

/** SHA-256 hex of a UTF-8 string, uppercase (as bank PGs expect). */
export async function sha256Hex(text: string): Promise<string> {
  const bytes = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
    .toUpperCase();
}

/**
 * Build the gateway create-order request payload + hash for a hosted redirect.
 * `extraKeys` lets you include any kit-specific fields; the hash is computed
 * over the exact same key set you pass, in order.
 */
export async function buildCreateRequest(input: {
  orderId: string;        // your internal order id (uuid)
  gatewayOrderId: string; // id you tell the gateway (must be unique)
  amount: number;         // rupees
  currency?: string;
  customerName?: string;
  customerEmail?: string;
  customerMobile?: string;
  returnUrl: string;
  callbackUrl: string;
  extraKeys?: Record<string, string | number>;
}): Promise<{ payload: Record<string, string>; hash: string }> {
  const payload: Record<string, string> = {
    merchant_id: INDUSIND.merchantId(),
    order_id: input.gatewayOrderId,
    amount: input.amount.toFixed(2),
    currency: input.currency ?? "INR",
    customer_name: input.customerName ?? "",
    customer_email: input.customerEmail ?? "",
    customer_mobile: input.customerMobile ?? "",
    return_url: input.returnUrl,
    callback_url: input.callbackUrl,
  };
  for (const [k, v] of Object.entries(input.extraKeys ?? {})) {
    payload[k] = String(v);
  }
  // Hash over the exact same key set, in the same order, then the salt.
  const raw = [...Object.keys(payload).map((k) => payload[k]), INDUSIND.salt()].join("|");
  const hash = await sha256Hex(raw);
  return { payload, hash };
}

/**
 * Verify the signature on a gateway callback (webhook) POST. The gateway signs
 * its response params with the same scheme. Order of keys must match the kit.
 */
export async function verifyCallbackSignature(
  params: Record<string, string>,
  signatureKey = "hash",
  order: string[] = [],
): Promise<boolean> {
  const sent = params[signatureKey];
  if (!sent) return false;
  const keys = order.length ? order : Object.keys(params).filter((k) => k !== signatureKey);
  const raw = [...keys.map((k) => params[k] ?? ""), INDUSIND.salt()].join("|");
  const expected = await sha256Hex(raw);
  return sent.toUpperCase() === expected;
}
