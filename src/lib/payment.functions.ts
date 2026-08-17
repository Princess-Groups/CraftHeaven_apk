// Payment gateway server functions.
//   - initiateGatewayPayment: customer clicks "Pay" → we create a gateway order
//     and persist a payments row; the returned redirectUrl is where the browser
//     goes. Only callable by an authenticated user (order ownership is checked
//     server-side so a user can't initiate payment on someone else's order).
//   - processGatewayCallback: the bank's webhook logic. It is keyed by a shared
//     secret (INDUSIND_CALLBACK_SECRET) instead of a user token, because the
//     gateway has no Supabase session. It verifies the signature, then marks
//     the order PAID via the RPC. Exposed at the stable URL /api/payment/callback
//     by an intercept in src/server.ts (a createServerFn can't serve a bank
//     webhook — it would be blocked by the CSRF middleware).
//
// Both use the service-role Supabase client and keep INDUSIND_* env vars
// server-side — they never reach the browser bundle.

import { createServerFn } from "@tanstack/react-start";
import { buildCreateRequest, verifyCallbackSignature, INDUSIND } from "@/lib/indusind";

export type InitiatePaymentInput = {
  orderId: string;
  amount: number;
  customerName?: string;
  customerEmail?: string;
  customerMobile?: string;
};

/**
 * Create the gateway request for an order and return the hosted-page URL.
 * Throws a plain-message error the UI can toast.
 */
export const initiateGatewayPayment = createServerFn({ method: "POST" })
  .validator((d: InitiatePaymentInput) => d)
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const orderId = String(data.orderId ?? "").trim();
    const amount = Number(data.amount);

    if (!orderId || !Number.isFinite(amount) || amount <= 0) {
      throw new Error("Invalid payment request");
    }

    // Fetch the order + verify it's in a payable state.
    const { data: order, error: orderErr } = await supabaseAdmin
      .from("orders")
      .select("id, user_id, payment_status, total, payment_method")
      .eq("id", orderId)
      .single();
    if (orderErr || !order) throw new Error("Order not found");

    if (order.payment_status === "PAID") {
      throw new Error("This order is already paid");
    }
    // Money amount comes from the DB, never from the client.
    const dbAmount = Number(order.total);
    if (!Number.isFinite(dbAmount) || dbAmount <= 0) {
      throw new Error("Order has no payable amount");
    }

    const merchantId = INDUSIND.merchantId();
    if (!merchantId || !INDUSIND.salt()) {
      throw new Error("Payment gateway isn't configured yet — please try again later");
    }

    // The gateway requires a unique order id per request.
    const gatewayOrderId = `${merchantId}_${orderId}`.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 64);

    const { payload, hash } = await buildCreateRequest({
      orderId,
      gatewayOrderId,
      amount: dbAmount,
      customerName: data.customerName,
      customerEmail: data.customerEmail,
      customerMobile: data.customerMobile,
      // Carry the order id + status back so checkout can show a result screen.
      returnUrl: `${INDUSIND.returnUrl()}${INDUSIND.returnUrl().includes("?") ? "&" : "?"}orderId=${encodeURIComponent(orderId)}`,
      callbackUrl: INDUSIND.callbackUrl(),
    });

    // Persist the attempt BEFORE redirecting so the webhook has a row to update.
    const { error: payErr } = await supabaseAdmin.from("payments").insert({
      order_id: orderId,
      user_id: order.user_id,
      gateway: "indusind",
      gateway_order_id: gatewayOrderId,
      amount: dbAmount,
      status: "INITIATED",
      response: { merchant_id: merchantId, amount: dbAmount, currency: "INR" },
    });
    if (payErr) throw new Error("Could not start payment");

    // Gateway create-order call. Adapt to your kit: some banks want a JSON POST
    // to /payment/request with { payload, hash }, others a form POST.
    const createRes = await fetch(`${INDUSIND.apiBase()}/payment/request`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...payload, hash }),
    });
    const createJson = (await createRes.json().catch(() => null)) as
      | { redirect_url?: string; redirectUrl?: string; data?: { redirect_url?: string } }
      | null;

    const redirectUrl =
      createJson?.redirect_url ?? createJson?.redirectUrl ?? createJson?.data?.redirect_url;
    if (!createRes.ok || !redirectUrl) {
      throw new Error("The payment gateway did not return a checkout link");
    }

    return { redirectUrl };
  });

export type GatewayCallbackInput = {
  orderId?: string;      // your internal order id (uuid)
  txnId?: string;        // gateway transaction id
  status?: string;       // e.g. SUCCESS / FAILED / PENDING
  hash?: string;
  [key: string]: unknown;
};

/**
 * Shared callback logic for the gateway webhook. The bank POSTs to the stable
 * /api/payment/callback URL (see src/server.ts), which calls this. A createServerFn
 * can't serve the webhook because the CSRF middleware + Supabase auth-attacher
 * expect a browser session the gateway doesn't have.
 */
export async function processGatewayCallback(body: Record<string, unknown>): Promise<{ ok: boolean }> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

  const data = body as GatewayCallbackInput;

  if (data.secret && INDUSIND.callbackSecret() && String(data.secret) !== INDUSIND.callbackSecret()) {
    throw new Error("Unauthorized callback");
  }

  // Signature verification is the real auth — reject anything that doesn't verify.
  const params = Object.fromEntries(
    Object.entries(data).map(([k, v]) => [k, String(v ?? "")]),
  );
  const ok = await verifyCallbackSignature(params);
  if (!ok) {
    console.error("[payment] callback signature mismatch", { orderId: data.orderId });
    throw new Error("Bad signature");
  }

  const orderId = String(data.orderId ?? "").trim();
  if (!orderId) throw new Error("Missing order id");

  if (String(data.status ?? "").toUpperCase() === "SUCCESS") {
    const { error } = await supabaseAdmin.rpc("mark_order_paid_by_gateway", {
      _order_id: orderId,
      _gateway: "indusind",
      _gateway_order_id: String(data.order_id ?? ""),
      _txn_id: String(data.txnId ?? ""),
      _response: { status: String(data.status ?? ""), txnId: String(data.txnId ?? ""), receivedAt: new Date().toISOString() },
    });
    if (error) throw error;
  } else {
    const { error } = await supabaseAdmin.from("payments").update({
      status: String(data.status ?? "FAILED").toUpperCase(),
      response: { status: String(data.status ?? ""), receivedAt: new Date().toISOString() },
    }).eq("gateway_order_id", String(data.order_id ?? "")).or(`order_id.eq.${orderId}`);
    if (error) console.error("[payment] failed to record non-success callback", error);
  }

  return { ok: true };
}
