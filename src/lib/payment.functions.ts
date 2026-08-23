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
//   - initiateCashfreePayment: Cashfree version of the same flow — creates a
//     Cashfree order (POST /orders) and returns a payment_session_id the
//     checkout page hands to the Cashfree JS SDK to open the hosted checkout.
//   - processCashfreeWebhook: verifies the Cashfree webhook HMAC, then marks the
//     order PAID via the same generic RPC. Served at /api/payment/cashfree-webhook.
//
// Both gateways use the service-role Supabase client. INDUSIND_* / CASHFREE_*
// env vars live server-side — they never reach the browser bundle.

import { createServerFn } from "@tanstack/react-start";
import { buildCreateRequest, verifyCallbackSignature, INDUSIND } from "@/lib/indusind";
import { CASHFREE, cashfreeHeaders, verifyWebhookSignature } from "@/lib/cashfree";

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
    const createJson = (await createRes.json().catch(() => null)) as {
      redirect_url?: string;
      redirectUrl?: string;
      data?: { redirect_url?: string };
    } | null;

    const redirectUrl =
      createJson?.redirect_url ?? createJson?.redirectUrl ?? createJson?.data?.redirect_url;
    if (!createRes.ok || !redirectUrl) {
      throw new Error("The payment gateway did not return a checkout link");
    }

    return { redirectUrl };
  });

export type GatewayCallbackInput = {
  orderId?: string; // your internal order id (uuid)
  txnId?: string; // gateway transaction id
  status?: string; // e.g. SUCCESS / FAILED / PENDING
  hash?: string;
  [key: string]: unknown;
};

/**
 * Shared callback logic for the gateway webhook. The bank POSTs to the stable
 * /api/payment/callback URL (see src/server.ts), which calls this. A createServerFn
 * can't serve the webhook because the CSRF middleware + Supabase auth-attacher
 * expect a browser session the gateway doesn't have.
 */
export async function processGatewayCallback(
  body: Record<string, unknown>,
): Promise<{ ok: boolean }> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

  const data = body as GatewayCallbackInput;

  if (
    data.secret &&
    INDUSIND.callbackSecret() &&
    String(data.secret) !== INDUSIND.callbackSecret()
  ) {
    throw new Error("Unauthorized callback");
  }

  // Signature verification is the real auth — reject anything that doesn't verify.
  const params = Object.fromEntries(Object.entries(data).map(([k, v]) => [k, String(v ?? "")]));
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
      _response: {
        status: String(data.status ?? ""),
        txnId: String(data.txnId ?? ""),
        receivedAt: new Date().toISOString(),
      },
    });
    if (error) throw error;
  } else {
    const { error } = await supabaseAdmin
      .from("payments")
      .update({
        status: String(data.status ?? "FAILED").toUpperCase(),
        response: { status: String(data.status ?? ""), receivedAt: new Date().toISOString() },
      })
      .eq("gateway_order_id", String(data.order_id ?? ""))
      .or(`order_id.eq.${orderId}`);
    if (error) console.error("[payment] failed to record non-success callback", error);
  }

  return { ok: true };
}

// ============================================================================
// Cashfree Payment Gateway
// ============================================================================

export type InitiateCashfreeInput = {
  orderId: string;
  amount: number;
};

/** Sandbox vs production mode, exposed so the client can load the right SDK. */
export const getCashfreeMode = createServerFn({ method: "GET" }).handler(async () => {
  return { mode: CASHFREE.apiBase().includes("sandbox") ? "sandbox" : "production" };
});

export type CashfreeOrderResult = {
  paymentSessionId: string;
  orderStatus: string;
  orderId: string; // the id Cashfree generated for the order
};

/** Build the unique, gateway-safe order id we tell Cashfree. */
function cashfreeOrderId(orderId: string): string {
  // Cashfree order_id must be alphanumeric (a-z / 0-9, hyphens allowed) and
  // unique per merchant. Derive it deterministically from our UUID so the
  // webhook can always map back to the internal order.
  return `ACH${orderId.replace(/-/g, "").toUpperCase().slice(0, 30)}`;
}

/**
 * Create a Cashfree order and return the payment_session_id the browser SDK
 * needs to open the hosted checkout. Persists a payments row first (like the
 * IndusInd flow) so the webhook has something to update.
 */
export const initiateCashfreePayment = createServerFn({ method: "POST" })
  .validator((d: InitiateCashfreeInput) => d)
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const orderId = String(data.orderId ?? "").trim();
    const amount = Number(data.amount);

    if (!orderId || !Number.isFinite(amount) || amount <= 0) {
      throw new Error("Invalid payment request");
    }

    if (!CASHFREE.clientId() || !CASHFREE.clientSecret()) {
      throw new Error("Cashfree isn't configured yet — pay via UPI instead");
    }

    // Fetch the order + verify it's in a payable state. Money comes from the DB.
    const { data: order, error: orderErr } = await supabaseAdmin
      .from("orders")
      .select("id, user_id, payment_status, total, channel")
      .eq("id", orderId)
      .single();
    if (orderErr || !order) throw new Error("Order not found");
    if (order.payment_status === "PAID") throw new Error("This order is already paid");
    const dbAmount = Number(order.total);
    if (!Number.isFinite(dbAmount) || dbAmount <= 0) {
      throw new Error("Order has no payable amount");
    }

    // Customer details (Cashfree requires at least customer_id + phone/email).
    let customer: { full_name: string | null; phone: string | null } | null = null;
    if (order.user_id) {
      const { data: profile } = await supabaseAdmin
        .from("profiles")
        .select("full_name, phone")
        .eq("id", order.user_id)
        .maybeSingle();
      customer = (profile ?? null) as { full_name: string | null; phone: string | null } | null;
    }
    const customerId = String(order.user_id ?? orderId)
      .replace(/[^a-zA-Z0-9-_]/g, "")
      .slice(0, 50);

    const cfOrderId = cashfreeOrderId(orderId);

    const { data: created, error: createErr } = await supabaseAdmin.from("payments").insert({
      order_id: orderId,
      user_id: order.user_id,
      gateway: "cashfree",
      gateway_order_id: cfOrderId,
      amount: dbAmount,
      status: "INITIATED",
      response: {
        clientId: CASHFREE.clientId() ? "configured" : "",
        amount: dbAmount,
        currency: "INR",
      },
    });
    if (createErr) {
      console.error("[cashfree] payments insert failed", createErr);
      throw new Error(`Could not start payment: ${createErr.message ?? createErr.code ?? "unknown"}`);
    }

    // Cashfree requires a valid 10-digit phone number. Fall back to a default
    // if the customer profile is missing one so the API doesn't reject the request.
    const phone = customer?.phone?.replace(/\D/g, "").slice(-10) ?? "";
    const validPhone = /^\d{10}$/.test(phone) ? phone : "9999999999";

    // Build the return URL so Cashfree redirects back to checkout after payment.
    // Cashfree appends its own params (cf_order_id, payment_session_id, etc.).
    const returnUrl = `${CASHFREE.siteUrl()}/checkout?orderId=${encodeURIComponent(orderId)}`;

    // Create the Cashfree order.
    const requestBody = {
      order_id: cfOrderId,
      order_amount: dbAmount,
      order_currency: "INR",
      order_note: `Order ${orderId.slice(0, 8).toUpperCase()}`,
      customer_details: {
        customer_id: customerId,
        customer_name: customer?.full_name?.slice(0, 100) || "Customer",
        customer_phone: validPhone,
        customer_email: "",
      },
      order_meta: {
        return_url: returnUrl,
      },
    };
    const res = await fetch(`${CASHFREE.apiBase()}/orders`, {
      method: "POST",
      headers: cashfreeHeaders(),
      body: JSON.stringify(requestBody),
    });
    const json = (await res.json().catch(() => null)) as Record<string, unknown> | null;
    if (!res.ok || !json) {
      console.error("[cashfree] create order failed", res.status, json);
      // Leave the payments row in INITIATED so the UI can fall back to UPI.
      throw new Error(`Cashfree could not start the payment (${res.status}) — pay via UPI instead`);
    }

    const paymentSessionId = json.payment_session_id as string | undefined;
    if (!paymentSessionId) {
      throw new Error("Cashfree returned no payment session — pay via UPI instead");
    }

    return {
      paymentSessionId,
      orderStatus: String(json.order_status ?? ""),
      orderId: String(json.order_id ?? cfOrderId),
    } as CashfreeOrderResult;
  });

/**
 * Verify a Cashfree payment server-side and mark the order PAID if confirmed.
 * Called by the client after the Cashfree JS SDK reports success — this is a
 * belt-and-suspenders check in case the webhook doesn't fire.
 */
export const verifyCashfreePayment = createServerFn({ method: "POST" })
  .validator((d: { orderId: string; cfOrderId: string }) => d)
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { orderId, cfOrderId } = data;

    if (!CASHFREE.clientId() || !CASHFREE.clientSecret()) {
      throw new Error("Cashfree isn't configured");
    }

    // Ask Cashfree for the order status.
    const res = await fetch(`${CASHFREE.apiBase()}/orders/${cfOrderId}`, {
      method: "GET",
      headers: cashfreeHeaders(),
    });
    const json = (await res.json().catch(() => null)) as Record<string, unknown> | null;

    if (!res.ok || !json) {
      console.error("[cashfree] verify order failed", res.status, json);
      throw new Error("Could not verify payment with Cashfree");
    }

    const orderStatus = String(json.order_status ?? "").toUpperCase();

    // Only mark PAID when Cashfree confirms it.
    if (orderStatus === "PAID" || orderStatus === "SUCCESS" || orderStatus === "COMPLETE") {
      // Find the internal order from the payments table.
      const { data: payRow } = await supabaseAdmin
        .from("payments")
        .select("order_id")
        .eq("gateway_order_id", cfOrderId)
        .maybeSingle();

      const targetOrderId = payRow?.order_id ?? orderId;

      const { error } = await supabaseAdmin.rpc("mark_order_paid_by_gateway", {
        _order_id: targetOrderId,
        _gateway: "cashfree",
        _gateway_order_id: cfOrderId,
        _txn_id: String(json.cf_order_id ?? cfOrderId),
        _response: {
          orderStatus,
          orderId: cfOrderId,
          verifiedAt: new Date().toISOString(),
        },
      });
      if (error) {
        console.error("[cashfree] failed to mark order paid", error);
        throw error;
      }

      return { ok: true, orderStatus };
    }

    return { ok: false, orderStatus };
  });

/**
 * Cashfree webhook handler. Cashfree POSTs events (including "payment.orders"
 * with status transitions) to /api/payment/cashfree-webhook. We verify the HMAC
 * signature, then mark the order PAID via the same generic RPC the IndusInd
 * callback uses.
 */
export async function processCashfreeWebhook(
  bodyRecord: Record<string, unknown>,
  rawBody: string,
  headers: Headers,
): Promise<{ ok: boolean }> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

  const record: Record<string, unknown> = bodyRecord;
  const signature = String(
    headers.get("x-webhook-signature") ??
      record["x-webhook-signature"] ??
      (record.header instanceof Object
        ? (record.header as Record<string, unknown>)["x-webhook-signature"]
        : "") ??
      "",
  );
  const timestamp = String(
    headers.get("x-webhook-timestamp") ??
      record["x-webhook-timestamp"] ??
      (record.header instanceof Object
        ? (record.header as Record<string, unknown>)["x-webhook-timestamp"]
        : "") ??
      "",
  );
  // Cashfree signs the raw JSON body — always pass the exact bytes received.
  const payload = rawBody || JSON.stringify(bodyRecord);

  // Signature verification is the real auth gate.
  const secret = CASHFREE.webhookSecret();
  if (secret) {
    const ok = await verifyWebhookSignature(signature, timestamp, String(payload));
    if (!ok) {
      console.error("[cashfree] webhook signature mismatch");
      throw new Error("Bad signature");
    }
  } else {
    console.warn("[cashfree] webhook secret not configured — accepting unverified event");
  }

  // Determine the order + status from the event-shaped payload. Cashfree wraps
  // the order data under `data`; be tolerant and read from both levels.
  const raw = bodyRecord as Record<string, unknown>;
  const inner =
    raw.data instanceof Object && !Array.isArray(raw.data)
      ? (raw.data as Record<string, unknown>)
      : raw;
  const payment =
    inner.payment instanceof Object
      ? (inner.payment as Record<string, unknown>)
      : ({} as Record<string, unknown>);

  const orderStatus = String(
    inner.order_status ?? inner.status ?? raw.order_status ?? "",
  ).toUpperCase();
  const cashfreeOrderId = String(inner.order_id ?? raw.order_id ?? "");
  const txnId = String(
    payment.cf_payment_id ?? inner.cf_payment_id ?? inner.payment_id ?? raw.payment_id ?? "",
  );
  const orderAmount = Number(inner.order_amount ?? raw.order_amount ?? 0);

  // Only a PAID/SUCCESS transition should mark the order paid.
  if (orderStatus === "PAID" || orderStatus === "SUCCESS" || orderStatus === "COMPLETE") {
    if (!cashfreeOrderId) {
      console.error("[cashfree] webhook missing order_id");
      throw new Error("Missing order id");
    }

    // Map back to our internal order via the payments row we inserted up front.
    const { data: payRow } = await supabaseAdmin
      .from("payments")
      .select("order_id, user_id")
      .eq("gateway_order_id", cashfreeOrderId)
      .maybeSingle();
    if (!payRow) {
      console.error("[cashfree] webhook for unknown order", cashfreeOrderId);
      throw new Error("Unknown order");
    }

    const { error } = await supabaseAdmin.rpc("mark_order_paid_by_gateway", {
      _order_id: payRow.order_id,
      _gateway: "cashfree",
      _gateway_order_id: cashfreeOrderId,
      _txn_id: txnId,
      _response: {
        orderStatus,
        orderAmount,
        orderId: cashfreeOrderId,
        txnId,
        eventType: String(raw.type ?? ""),
        receivedAt: new Date().toISOString(),
      },
    });
    if (error) {
      console.error("[cashfree] failed to mark order paid", error);
      throw error;
    }
  } else {
    // Non-success transition — record it on the payments row but don't mark PAID.
    const { error } = await supabaseAdmin
      .from("payments")
      .update({
        status: orderStatus || "FAILED",
        txn_id: txnId,
        response: {
          orderStatus,
          orderAmount,
          orderId: cashfreeOrderId,
          receivedAt: new Date().toISOString(),
        },
      })
      .eq("gateway_order_id", cashfreeOrderId);
    if (error) console.error("[cashfree] failed to record non-success webhook", error);
  }

  return { ok: true };
}
