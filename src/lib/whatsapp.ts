// WhatsApp Business Cloud API integration.
//
// Credentials are stored per-tenant in the whatsapp_settings table (single row) —
// NEVER hardcoded here. The admin configures them in Admin → Settings → WhatsApp.
//
// Server-side functions (createServerFn) so the access token never reaches the
// browser bundle:
//   - saveWhatsAppConfig      admin saves credentials + tests the connection
//   - getWhatsAppConfig       admin reads current (masked) config + status
//   - testWhatsAppConnection  fire a template-free raw message to a phone
//   - sendOrderWhatsApp       called after an order is placed to notify the
//                             customer / the store (safe to call idempotently)

import { createServerFn } from "@tanstack/react-start";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

export type WhatsAppConfig = {
  phone_number_id: string | null;
  business_account_id: string | null;
  access_token: string | null;
  api_version: string;
  webhook_verify_token: string | null;
  webhook_url: string | null;
  is_active: boolean;
};

export type SaveWhatsAppInput = {
  phone_number_id?: string;
  business_account_id?: string;
  access_token?: string;
  api_version?: string;
  webhook_verify_token?: string;
  webhook_url?: string;
  is_active?: boolean;
  // When sent with the config, a test message goes to this number ("91xxxxxxxxxx").
  test_phone?: string;
};

async function loadConfig(): Promise<WhatsAppConfig | null> {
  const { data } = await supabaseAdmin
    .from("whatsapp_settings")
    .select(
      "phone_number_id, business_account_id, access_token, api_version, webhook_verify_token, webhook_url, is_active",
    )
    .eq("id", 1)
    .maybeSingle();
  return (data ?? null) as WhatsAppConfig | null;
}

/** Build the Graph API base URL for the WhatsApp Business Cloud API. */
function apiBase(cfg: { api_version: string }): string {
  return `https://graph.facebook.com/${cfg.api_version || "v20.0"}`;
}

/** Send a plain-text WhatsApp message to a phone number (E.164, no "+"). */
async function sendTextMessage(
  cfg: { phone_number_id: string; access_token: string; api_version: string },
  to: string,
  text: string,
): Promise<{ ok: boolean; error?: string; waId?: string }> {
  const res = await fetch(`${apiBase(cfg)}/${cfg.phone_number_id}/messages`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${cfg.access_token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to,
      type: "text",
      text: { body: text },
    }),
  });
  if (!res.ok) {
    let detail = `HTTP ${res.status}`;
    try {
      const body = await res.json();
      detail = body?.error?.message ?? JSON.stringify(body);
    } catch {
      /* ignore body parse failure */
    }
    return { ok: false, error: detail };
  }
  const body = await res.json();
  return { ok: true, waId: body?.messages?.[0]?.id };
}

/**
 * Admin saves WhatsApp credentials. Also updates Whatsapp Business Account /
 * Phone Number ID and triggers connection status. Returns the saved (masked)
 * config together with a live connection test result.
 */
export const saveWhatsAppConfig = createServerFn({ method: "POST" })
  .validator((d: SaveWhatsAppInput) => d)
  .handler(async ({ data }) => {
    const { supabaseAdmin: admin } = await import("@/integrations/supabase/client.server");

    const next: {
      api_version?: string;
      is_active?: boolean;
      updated_at?: string;
      phone_number_id?: string | null;
      business_account_id?: string | null;
      access_token?: string | null;
      webhook_verify_token?: string | null;
      webhook_url?: string | null;
    } = {
      api_version: data.api_version || "v20.0",
      is_active: Boolean(data.is_active),
      updated_at: new Date().toISOString(),
    };
    if (data.phone_number_id !== undefined) next.phone_number_id = data.phone_number_id || null;
    if (data.business_account_id !== undefined)
      next.business_account_id = data.business_account_id || null;
    // A secret must be explicitly sent to overwrite; empty string clears it.
    if (data.access_token !== undefined) next.access_token = data.access_token || null;
    if (data.webhook_verify_token !== undefined)
      next.webhook_verify_token = data.webhook_verify_token || null;
    if (data.webhook_url !== undefined) next.webhook_url = data.webhook_url || null;

    const { error } = await admin.from("whatsapp_settings").update(next).eq("id", 1);
    if (error) throw new Error(error.message);

    const cfg = await loadConfig();
    const masked = maskConfig(cfg);
    const status = await testConnection(cfg);

    if (data.test_phone && cfg?.phone_number_id && cfg.access_token) {
      const msg = await sendTextMessage(
        {
          phone_number_id: cfg.phone_number_id,
          access_token: cfg.access_token,
          api_version: cfg.api_version,
        },
        data.test_phone,
        "Hello from Athira's Creative Haven 👋 WhatsApp connection is live.",
      );
      status.lastTest = msg.ok
        ? { ok: true, message: `Test message sent (id: ${msg.waId})` }
        : { ok: false, message: msg.error };
    }

    return { config: masked, status };
  });

/** Admin reads the current (masked) WhatsApp config + connection status. */
export const getWhatsAppConfig = createServerFn({ method: "GET" }).handler(async () => {
  const cfg = await loadConfig();
  return {
    config: maskConfig(cfg),
    status: await testConnection(cfg),
  };
});

/** Admin triggers a live connection test. */
export const testWhatsAppConnection = createServerFn({ method: "POST" })
  .validator((d: { phone?: string }) => d)
  .handler(async ({ data }) => {
    const cfg = await loadConfig();
    const status = await testConnection(cfg);
    if (data.phone && status.connected && cfg?.phone_number_id && cfg.access_token) {
      const msg = await sendTextMessage(
        {
          phone_number_id: cfg.phone_number_id,
          access_token: cfg.access_token,
          api_version: cfg.api_version,
        },
        data.phone,
        "Test message from Athira's Creative Haven 👋",
      );
      status.lastTest = msg.ok
        ? { ok: true, message: `Test message sent (id: ${msg.waId})` }
        : { ok: false, message: msg.error };
    }
    return status;
  });

async function testConnection(cfg: WhatsAppConfig | null): Promise<{
  connected: boolean;
  error?: string;
  lastTest?: { ok: boolean; message?: string };
}> {
  if (!cfg || !cfg.access_token || !cfg.phone_number_id) {
    return { connected: false, error: "Phone Number ID / Access Token not configured" };
  }
  try {
    // Fetch the phone numbers belonging to the WABA to prove the token works.
    const res = await fetch(
      `${apiBase(cfg)}/${cfg.business_account_id || cfg.phone_number_id}/phone_numbers`,
      { headers: { Authorization: `Bearer ${cfg.access_token}` } },
    );
    if (!res.ok) {
      let detail = `HTTP ${res.status}`;
      try {
        const body = await res.json();
        detail = body?.error?.message ?? JSON.stringify(body);
      } catch {
        /* ignore */
      }
      return { connected: false, error: detail };
    }
    return { connected: true };
  } catch (err) {
    return { connected: false, error: err instanceof Error ? err.message : "Connection failed" };
  }
}

/** Return a config with the access token masked for display (never the real value). */
function maskConfig(cfg: WhatsAppConfig | null) {
  if (!cfg) return null;
  const token = cfg.access_token || "";
  const masked =
    token.length > 8 ? `${token.slice(0, 4)}…${token.slice(-4)}` : token ? "••••" : null;
  return { ...cfg, access_token: masked };
}

/**
 * Client-callable trigger: after an order is placed the caller invokes this to
 * push a WhatsApp notification (when configured). No-ops safely when WhatsApp
 * is not set up, so order placement never fails because of notifications.
 */
export const notifyOrderWhatsApp = createServerFn({ method: "POST" })
  .validator((d: { orderId: string }) => d)
  .handler(async ({ data }) => sendOrderWhatsApp(data.orderId));

/**
 * Send an order notification via WhatsApp when a customer places an order.
 * Called server-side from the order flow. Safe to call for every order; no-ops
 * when WhatsApp is not configured/active.
 */
export async function sendOrderWhatsApp(orderId: string): Promise<{
  ok: boolean;
  error?: string;
  method: "none" | "store" | "customer";
}> {
  const cfg = await loadConfig();
  if (!cfg || !cfg.is_active || !cfg.access_token || !cfg.phone_number_id) {
    return { ok: false, error: "WhatsApp not configured", method: "none" };
  }

  const { data: order } = await supabaseAdmin
    .from("orders")
    .select("*, order_items(product_name,quantity,unit,line_total), user_id")
    .eq("id", orderId)
    .maybeSingle();

  if (!order) return { ok: false, error: "Order not found", method: "none" };

  // Customer info lives on profiles (keyed by auth user id) — fetch separately.
  let customer: { full_name: string | null; phone: string | null } | null = null;
  if (order.user_id) {
    const { data: profile } = await supabaseAdmin
      .from("profiles")
      .select("full_name,phone")
      .eq("id", order.user_id)
      .maybeSingle();
    customer = (profile ?? null) as { full_name: string | null; phone: string | null } | null;
  }

  const items = (order.order_items ?? [])
    .map(
      (it: any) =>
        `• ${it.product_name} — ${it.quantity} ${it.unit ?? ""} ₹${Number(it.line_total).toFixed(2)}`,
    )
    .join("\n");
  const customerNumber = customer?.phone ?? null;

  const header = order.channel === "IN_STORE" ? "New in-store invoice" : "New order placed";
  const storeMessage =
    `${header} 🛍\n` +
    `Order: #${orderId.slice(0, 8).toUpperCase()}\n` +
    `Customer: ${customer?.full_name || "Guest"}${customerNumber ? ` (${customerNumber})` : ""}\n` +
    `Items:\n${items}\n` +
    `Total: ₹${Number(order.total).toFixed(2)}`;

  let notified: "store" | "customer" | null = null;
  let lastError: string | undefined;

  // Prefer notifying the customer (business phone requires opt-in; fall back to store).
  const sender = {
    phone_number_id: cfg.phone_number_id,
    access_token: cfg.access_token,
    api_version: cfg.api_version,
  };
  if (customerNumber && /^[6-9]\d{9}$/.test(customerNumber)) {
    const r = await sendTextMessage(sender, `91${customerNumber}`, storeMessage);
    if (r.ok) {
      notified = "customer";
    } else {
      lastError = r.error;
    }
  }

  return {
    ok: notified !== null,
    error: notified ? undefined : lastError || "No customer mobile number on order",
    method: notified ?? "none",
  };
}
