import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { MessageCircle, Plug, RefreshCw, Send, Loader2, CheckCircle2, XCircle } from "lucide-react";
import {
  getWhatsAppConfig,
  saveWhatsAppConfig,
  testWhatsAppConnection,
  type SaveWhatsAppInput,
} from "@/lib/whatsapp";

export const Route = createFileRoute("/admin/settings")({
  head: () => ({ meta: [{ title: "Settings — ACH Admin" }] }),
  component: Settings,
});

function Settings() {
  const qc = useQueryClient();

  const { data, refetch } = useQuery({
    queryKey: ["whatsapp-config"],
    queryFn: () => getWhatsAppConfig(),
    refetchOnWindowFocus: false,
  });
  const cfg = data?.config;
  const status = data?.status as
    | { connected: boolean; error?: string; lastTest?: { ok: boolean; message?: string } }
    | undefined;

  const [form, setForm] = useState<SaveWhatsAppInput>({});
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testPhone, setTestPhone] = useState("");

  const connected = status?.connected ?? false;

  return (
    <div className="max-w-3xl space-y-4">
      <h1 className="text-xl font-bold text-foreground">Settings</h1>

      <div className="rounded-xl border border-border bg-white p-6 shadow-sm space-y-4">
        <Row label="Store Name" value="Athira's Creative Haven" />
        <Row label="Tagline" value="Craft Supplies & Creative Classes" />
        <Row label="Currency" value="INR (₹)" />
        <Row label="Timezone" value="Asia/Kolkata" />
        <Row label="Default GST Rate" value="Set per product (CGST + SGST / IGST)" />
        <Row label="Inventory Sync" value="Real-time (online + POS share one stock)" />
      </div>

      {/* ================= WhatsApp API Integration ================= */}
      <div className="rounded-xl border border-border bg-white p-6 shadow-sm space-y-4">
        <div className="flex items-center gap-2">
          <div className="grid h-9 w-9 place-items-center rounded-lg bg-primary-soft">
            <MessageCircle className="h-5 w-5 text-primary" />
          </div>
          <div className="flex-1">
            <h2 className="text-sm font-bold text-foreground">WhatsApp API Integration</h2>
            <p className="text-[11px] text-muted-foreground">
              Connect your WhatsApp Business account to send order notifications automatically.
              Credentials are stored securely and never hard-coded.
            </p>
          </div>
          <button
            onClick={() => refetch()}
            className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-semibold text-muted-foreground hover:bg-secondary-soft"
          >
            <RefreshCw className="h-3.5 w-3.5" /> Refresh
          </button>
        </div>

        {/* Connection status */}
        <div
          className={`flex items-center gap-2 rounded-lg px-3 py-2 text-xs font-semibold ${connected ? "bg-emerald-50 text-emerald-700" : "bg-rose-50 text-rose-700"}`}
        >
          {connected ? <CheckCircle2 className="h-4 w-4" /> : <XCircle className="h-4 w-4" />}
          {connected
            ? "Connected — your WhatsApp Business API is live."
            : `Not connected — ${status?.error ?? "configure your credentials below."}`}
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <WField label="Phone Number ID">
            <input
              value={form.phone_number_id ?? cfg?.phone_number_id ?? ""}
              onChange={(e) => setForm({ ...form, phone_number_id: e.target.value })}
              className={inp}
              placeholder="e.g. 112233445566778"
            />
          </WField>
          <WField label="Business Account ID (WABA)">
            <input
              value={form.business_account_id ?? cfg?.business_account_id ?? ""}
              onChange={(e) => setForm({ ...form, business_account_id: e.target.value })}
              className={inp}
              placeholder="e.g. 112233445566778"
            />
          </WField>
          <WField label="Access Token (Bearer)">
            <input
              type="password"
              value={form.access_token ?? ""}
              onChange={(e) => setForm({ ...form, access_token: e.target.value })}
              className={inp}
              placeholder={
                cfg?.access_token
                  ? `Current token ending ${cfg.access_token}`
                  : "Paste your permanent / long-lived access token"
              }
            />
          </WField>
          <WField label="API Version">
            <select
              value={form.api_version ?? cfg?.api_version ?? "v20.0"}
              onChange={(e) => setForm({ ...form, api_version: e.target.value })}
              className={inp}
            >
              {["v19.0", "v20.0", "v21.0", "v22.0"].map((v) => (
                <option key={v} value={v}>
                  {v}
                </option>
              ))}
            </select>
          </WField>
          <WField label="Webhook Verify Token">
            <input
              value={form.webhook_verify_token ?? cfg?.webhook_verify_token ?? ""}
              onChange={(e) => setForm({ ...form, webhook_verify_token: e.target.value })}
              className={inp}
              placeholder="Any secret string for webhook verification"
            />
          </WField>
          <WField label="Webhook URL">
            <input
              value={form.webhook_url ?? cfg?.webhook_url ?? ""}
              onChange={(e) => setForm({ ...form, webhook_url: e.target.value })}
              className={inp}
              placeholder="https://your-domain.com/api/whatsapp/webhook"
            />
          </WField>
        </div>

        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={form.is_active ?? cfg?.is_active ?? false}
            onChange={(e) => setForm({ ...form, is_active: e.target.checked })}
            className="h-4 w-4 rounded border-border"
          />
          <span className="text-xs font-semibold text-muted-foreground">
            Enable WhatsApp notifications (send order alerts)
          </span>
        </label>

        <div className="flex flex-wrap items-center gap-2 border-t border-border pt-4">
          <button
            onClick={async () => {
              setSaving(true);
              try {
                await saveWhatsAppConfig({ data: form });
                setForm({});
                toast.success("WhatsApp configuration saved");
                qc.invalidateQueries({ queryKey: ["whatsapp-config"] });
              } catch (err) {
                toast.error(err instanceof Error ? err.message : "Failed to save configuration");
              } finally {
                setSaving(false);
              }
            }}
            disabled={saving}
            className="flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-xs font-semibold text-white hover:bg-primary/90 disabled:opacity-60"
          >
            {saving ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Plug className="h-3.5 w-3.5" />
            )}
            {saving ? "Saving…" : "Save & Connect"}
          </button>

          <div className="flex items-center gap-2 rounded-lg border border-border bg-muted px-2 py-1">
            <input
              value={testPhone}
              onChange={(e) => setTestPhone(e.target.value)}
              placeholder="Test to 91xxxxxxxxxx"
              className="w-40 bg-transparent text-xs outline-none placeholder:text-muted-foreground/60"
            />
            <button
              onClick={async () => {
                if (!testPhone.trim()) return toast.error("Enter a phone number to test with");
                setTesting(true);
                try {
                  const res = await testWhatsAppConnection({ data: { phone: testPhone.trim() } });
                  if (res.connected)
                    toast.success(
                      `Connection OK${res.lastTest?.ok ? ` — test message sent (${res.lastTest.message})` : ""}`,
                    );
                  else toast.error(`Connection failed — ${res.error}`);
                  qc.invalidateQueries({ queryKey: ["whatsapp-config"] });
                } catch (err) {
                  toast.error(err instanceof Error ? err.message : "Test failed");
                } finally {
                  setTesting(false);
                }
              }}
              disabled={testing}
              className="flex items-center gap-1 rounded-lg bg-secondary px-3 py-1.5 text-xs font-semibold text-white hover:bg-secondary/80 disabled:opacity-60"
            >
              {testing ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Send className="h-3.5 w-3.5" />
              )}
              Test Connection
            </button>
          </div>
        </div>

        {status?.lastTest ? (
          <div
            className={`text-xs font-semibold ${status.lastTest.ok ? "text-emerald-700" : "text-rose-700"}`}
          >
            {status.lastTest.ok ? "✓ " : "✗ "}
            {status.lastTest.message}
          </div>
        ) : null}
      </div>

      <p className="text-xs text-muted-foreground">
        Operational settings work out of the box. WhatsApp notifications fire automatically when a
        customer places an order, if the connection is active.
      </p>
    </div>
  );
}

const inp =
  "w-full rounded-lg border border-border bg-white px-3 py-2 text-sm text-foreground outline-none focus:border-secondary placeholder:text-muted-foreground/60";
function WField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[11px] font-semibold text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between border-b border-border pb-3 last:border-0 last:pb-0">
      <span className="text-xs font-semibold text-muted-foreground">{label}</span>
      <span className="text-sm font-medium text-foreground">{value}</span>
    </div>
  );
}
