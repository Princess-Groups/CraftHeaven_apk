import "./lib/error-capture";

import { consumeLastCapturedError } from "./lib/error-capture";
import { renderErrorPage } from "./lib/error-page";

type ServerEntry = {
  fetch: (request: Request, env: unknown, ctx: unknown) => Promise<Response> | Response;
};

let serverEntryPromise: Promise<ServerEntry> | undefined;

async function getServerEntry(): Promise<ServerEntry> {
  if (!serverEntryPromise) {
    serverEntryPromise = import("@tanstack/react-start/server-entry").then(
      (m) => (m.default ?? m) as ServerEntry,
    );
  }
  return serverEntryPromise;
}

// h3 swallows in-handler throws into a normal 500 Response with body
// {"unhandled":true,"message":"HTTPError"} — try/catch alone never fires for those.
async function normalizeCatastrophicSsrResponse(response: Response): Promise<Response> {
  if (response.status < 500) return response;
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) return response;

  const body = await response.clone().text();
  if (!isH3SwallowedErrorBody(body)) return response;

  console.error(consumeLastCapturedError() ?? new Error(`h3 swallowed SSR error: ${body}`));
  return new Response(renderErrorPage(), {
    status: 500,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

function isH3SwallowedErrorBody(body: string): boolean {
  try {
    const payload = JSON.parse(body) as { unhandled?: unknown; message?: unknown };
    return payload.unhandled === true && payload.message === "HTTPError";
  } catch {
    return false;
  }
}

// Stable webhook endpoint for the IndusInd payment gateway. A createServerFn
// can't serve this — the gateway has no Supabase session and can't satisfy the
// CSRF middleware. Intercept the request here, before TanStack routing.
const PAYMENT_CALLBACK_PATH = "/api/payment/callback";

async function handlePaymentCallback(request: Request): Promise<Response> {
  try {
    const contentType = request.headers.get("content-type") ?? "";
    let body: Record<string, unknown>;
    if (contentType.includes("application/json")) {
      body = (await request.json().catch(() => null)) ?? {};
    } else {
      const form = await request.formData().catch(() => null);
      body = form ? Object.fromEntries(form.entries()) : {};
    }
    const { processGatewayCallback } = await import("./lib/payment.functions");
    const result = await processGatewayCallback(body);
    return Response.json(result);
  } catch (error) {
    console.error("[payment] webhook error", error);
    return Response.json({ ok: false, error: error instanceof Error ? error.message : "error" }, { status: 400 });
  }
}

export default {
  async fetch(request: Request, env: unknown, ctx: unknown) {
    try {
      // Payment gateway webhook — handled before TanStack routing (see above).
      if (new URL(request.url).pathname === PAYMENT_CALLBACK_PATH) {
        return await handlePaymentCallback(request);
      }
      const handler = await getServerEntry();
      const response = await handler.fetch(request, env, ctx);
      return await normalizeCatastrophicSsrResponse(response);
    } catch (error) {
      console.error(error);
      return new Response(renderErrorPage(), {
        status: 500,
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    }
  },
};
