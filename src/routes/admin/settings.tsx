import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { MessageCircle, Plug, RefreshCw, Send, Loader2, CheckCircle2, XCircle, Printer, Barcode, Wifi, Settings as SettingsIcon, Copy, Eye, RotateCcw } from "lucide-react";
import {
  getWhatsAppConfig,
  saveWhatsAppConfig,
  testWhatsAppConnection,
  type SaveWhatsAppInput,
} from "@/lib/whatsapp";
import {
  getHardwareConfig,
  saveHardwareConfig,
  testHardwareConnection,
  testBarcodeScanner,
  testReceiptPrinter,
  testLabelPrinter,
  type HardwareConfig,
  type SaveHardwareInput,
} from "@/lib/hardware";
import type { PrinterInfo } from "@/lib/print-service";

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

  const [hardwareForm, setHardwareForm] = useState<SaveHardwareInput>({});
  const [hwSaving, setHwSaving] = useState(false);
  const { data: hwData, refetch: refetchHardware } = useQuery({
    queryKey: ["hardware-config"],
    queryFn: () => getHardwareConfig(),
    refetchOnWindowFocus: false,
  });

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

      {/* ================= Hardware / Printer Settings ================= */}
      <div className="rounded-xl border border-border bg-white p-6 shadow-sm space-y-4 mt-6">
        <div className="flex items-center gap-2">
          <div className="grid h-9 w-9 place-items-center rounded-lg bg-primary-soft">
            <SettingsIcon className="h-5 w-5 text-primary" />
          </div>
          <div className="flex-1">
            <h2 className="text-sm font-bold text-foreground">Hardware / Printer Settings</h2>
            <p className="text-[11px] text-muted-foreground">
              Configure barcode scanners, receipt printers and label printers. Test connections directly from here.
            </p>
          </div>
          <button
            onClick={() => refetchHardware()}
            className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-semibold text-muted-foreground hover:bg-secondary-soft"
          >
            <RefreshCw className="h-3.5 w-3.5" /> Refresh
          </button>
        </div>

        {/* Hardware config status */}
        <div className={`flex items-center gap-2 rounded-lg px-3 py-2 text-xs font-semibold ${hwData?.config ? "bg-emerald-50 text-emerald-700" : "bg-rose-50 text-rose-700"}`}
        >
          {hwData?.config ? <CheckCircle2 className="h-4 w-4" /> : <XCircle className="h-4 w-4" />}
          {hwData?.config ? "Hardware configured" : "Hardware not configured"}
        </div>

        {/* Test Connection Button */}
        <div className="flex items-center gap-2">
          <button
            onClick={async () => {
              setTesting(true);
              try {
                const res = await testHardwareConnection({ data: {} });
                if (res.connected) toast.success("Print Agent connected — printers available");
                else toast.error(`Connection failed — ${res.error}`);
              } catch (e) {
                toast.error(e instanceof Error ? e.message : "Connection test failed");
              } finally {
                setTesting(false);
              }
            }}
            disabled={testing}
            className="flex items-center gap-1.5 rounded-lg bg-secondary px-3 py-1.5 text-xs font-semibold text-white hover:bg-secondary/80 disabled:opacity-60"
          >
            {testing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Wifi className="h-3.5 w-3.5" />}
            Test Print Agent Connection
          </button>
        </div>

        {/* Barcode Scanner Section */}
        <div className="mt-6 p-4 rounded-lg border border-border bg-muted/30 space-y-3">
          <div className="flex items-center gap-2">
            <Barcode className="h-4 w-4 text-primary" />
            <h3 className="text-sm font-semibold text-foreground">Barcode Scanner</h3>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <WField label="Scanner Prefix">
              <input
                value={hardwareForm?.scanner_prefix ?? hwData?.config?.scanner_prefix ?? ""}
                onChange={e => setHardwareForm({ ...hardwareForm, scanner_prefix: e.target.value })}
                className={inp}
                placeholder="e.g. SCN"
              />
            </WField>
            <WField label="Scanner Timeout (ms)">
              <input
                type="number"
                value={hardwareForm?.scanner_timeout_ms ?? hwData?.config?.scanner_timeout_ms ?? 50}
                onChange={e => setHardwareForm({ ...hardwareForm, scanner_timeout_ms: Number(e.target.value) })}
                className={inp}
              />
            </WField>
            <label className="flex items-center gap-2 text-sm col-span-full">
              <input
                type="checkbox"
                checked={hardwareForm?.scanner_auto_submit ?? hwData?.config?.scanner_auto_submit ?? true}
                onChange={e => setHardwareForm({ ...hardwareForm, scanner_auto_submit: e.target.checked })}
                className="h-4 w-4 rounded border-border"
              />
              <span className="text-xs font-semibold text-muted-foreground">Auto‑submit scanner input</span>
            </label>
            <button
              onClick={async () => {
                setTesting(true);
                try {
                  const res = await testBarcodeScanner({ data: hardwareForm || {} });
                  toast.success(res.message || "Scanner settings validated");
                } catch (e) {
                  toast.error(e instanceof Error ? e.message : "Scanner test failed");
                } finally {
                  setTesting(false);
                }
              }}
              disabled={testing}
              className="flex items-center gap-1.5 rounded-lg bg-secondary px-4 py-2 text-xs font-semibold text-white hover:bg-secondary/90 disabled:opacity-60"
            >
              {testing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Barcode className="h-3.5 w-3.5" />}
              Test Scanner Settings
            </button>
          </div>
        </div>

        {/* Receipt Printer Section */}
        <div className="mt-6 p-4 rounded-lg border border-border bg-muted/30 space-y-3">
          <div className="flex items-center gap-2">
            <Printer className="h-4 w-4 text-primary" />
            <h3 className="text-sm font-semibold text-foreground">Receipt Printer</h3>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <WField label="Receipt Printer">
              <select
                value={hardwareForm?.receipt_printer_id ?? hwData?.config?.receipt_printer_id ?? ""}
                onChange={e => setHardwareForm({ ...hardwareForm, receipt_printer_id: e.target.value })}
                className={inp}
              >
                <option value="">Select printer</option>
                {hwData?.printers?.map(p => (
                  <option key={p.id} value={p.id}>{p.name} ({p.type})</option>
                ))}
              </select>
            </WField>
            <WField label="Paper Width">
              <select
                value={hardwareForm?.receipt_paper_width ?? hwData?.config?.receipt_paper_width ?? "80mm"}
                onChange={e => setHardwareForm({ ...hardwareForm, receipt_paper_width: e.target.value as any })}
                className={inp}
              >
                <option value="58mm">58mm</option>
                <option value="80mm">80mm</option>
              </select>
            </WField>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={hardwareForm?.receipt_auto_cut ?? hwData?.config?.receipt_auto_cut ?? true}
                onChange={e => setHardwareForm({ ...hardwareForm, receipt_auto_cut: e.target.checked })}
                className="h-4 w-4 rounded border-border"
              />
              <span className="text-xs font-semibold text-muted-foreground">Auto cut paper</span>
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={hardwareForm?.receipt_open_cash_drawer ?? hwData?.config?.receipt_open_cash_drawer ?? true}
                onChange={e => setHardwareForm({ ...hardwareForm, receipt_open_cash_drawer: e.target.checked })}
                className="h-4 w-4 rounded border-border"
              />
              <span className="text-xs font-semibold text-muted-foreground">Open cash drawer</span>
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={hardwareForm?.receipt_print_barcode ?? hwData?.config?.receipt_print_barcode ?? false}
                onChange={e => setHardwareForm({ ...hardwareForm, receipt_print_barcode: e.target.checked })}
                className="h-4 w-4 rounded border-border"
              />
              <span className="text-xs font-semibold text-muted-foreground">Print barcode on receipt</span>
            </label>
            <button
              onClick={async () => {
                const printerId = hardwareForm?.receipt_printer_id ?? hwData?.config?.receipt_printer_id;
                if (!printerId) return toast.error("Select a receipt printer first");
                setTesting(true);
                try {
                  const res = await testReceiptPrinter({ data: { printerId } });
                  if (res.success) toast.success(res.message || "Test receipt printed");
                  else toast.error(res.error || "Test receipt failed");
                } catch (e) {
                  toast.error(e instanceof Error ? e.message : "Test receipt failed");
                } finally {
                  setTesting(false);
                }
              }}
              disabled={testing}
              className="flex items-center gap-1.5 rounded-lg bg-secondary px-4 py-2 text-xs font-semibold text-white hover:bg-secondary/90 disabled:opacity-60"
            >
              {testing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Printer className="h-3.5 w-3.5" />}
              Test Receipt Printer
            </button>
          </div>
        </div>

        {/* Label Printer Section */}
        <div className="mt-6 p-4 rounded-lg border border-border bg-muted/30 space-y-3">
          <div className="flex items-center gap-2">
            <Barcode className="h-4 w-4 text-primary" />
            <h3 className="text-sm font-semibold text-foreground">Label Printer</h3>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <WField label="Label Printer">
              <select
                value={hardwareForm?.label_printer_id ?? hwData?.config?.label_printer_id ?? ""}
                onChange={e => setHardwareForm({ ...hardwareForm, label_printer_id: e.target.value })}
                className={inp}
              >
                <option value="">Select printer</option>
                {hwData?.printers?.map(p => (
                  <option key={p.id} value={p.id}>{p.name} ({p.type})</option>
                ))}
              </select>
            </WField>
            <WField label="Label Size (mm)">
              <div className="flex gap-2">
                <input
                  type="number"
                  value={hardwareForm?.label_width_mm ?? hwData?.config?.label_width_mm ?? 40}
                  onChange={e => setHardwareForm({ ...hardwareForm, label_width_mm: Number(e.target.value) })}
                  className={inp}
                  placeholder="Width"
                />
                <input
                  type="number"
                  value={hardwareForm?.label_height_mm ?? hwData?.config?.label_height_mm ?? 30}
                  onChange={e => setHardwareForm({ ...hardwareForm, label_height_mm: Number(e.target.value) })}
                  className={inp}
                  placeholder="Height"
                />
              </div>
            </WField>
            <WField label="Label Margin (mm)">
              <input
                type="number"
                value={hardwareForm?.label_margin_mm ?? hwData?.config?.label_margin_mm ?? 2}
                onChange={e => setHardwareForm({ ...hardwareForm, label_margin_mm: Number(e.target.value) })}
                className={inp}
              />
            </WField>
            <WField label="Template">
              <select
                value={hardwareForm?.label_template ?? hwData?.config?.label_template ?? "standard"}
                onChange={e => setHardwareForm({ ...hardwareForm, label_template: e.target.value as any })}
                className={inp}
              >
                <option value="standard">Standard</option>
                <option value="compact">Compact</option>
                <option value="detailed">Detailed</option>
              </select>
            </WField>
            <WField label="Barcode Type">
              <select
                value={hardwareForm?.label_barcode_type ?? hwData?.config?.label_barcode_type ?? "CODE128"}
                onChange={e => setHardwareForm({ ...hardwareForm, label_barcode_type: e.target.value as any })}
                className={inp}
              >
                <option value="CODE128">CODE128</option>
                <option value="EAN13">EAN13</option>
                <option value="QR">QR Code</option>
              </select>
            </WField>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={hardwareForm?.label_show_mrp ?? hwData?.config?.label_show_mrp ?? true}
                onChange={e => setHardwareForm({ ...hardwareForm, label_show_mrp: e.target.checked })}
                className="h-4 w-4 rounded border-border"
              />
              <span className="text-xs font-semibold text-muted-foreground">Show MRP</span>
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={hardwareForm?.label_show_offer_price ?? hwData?.config?.label_show_offer_price ?? true}
                onChange={e => setHardwareForm({ ...hardwareForm, label_show_offer_price: e.target.checked })}
                className="h-4 w-4 rounded border-border"
              />
              <span className="text-xs font-semibold text-muted-foreground">Show Offer Price</span>
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={hardwareForm?.label_show_batch_number ?? hwData?.config?.label_show_batch_number ?? true}
                onChange={e => setHardwareForm({ ...hardwareForm, label_show_batch_number: e.target.checked })}
                className="h-4 w-4 rounded border-border"
              />
              <span className="text-xs font-semibold text-muted-foreground">Show Batch Number</span>
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={hardwareForm?.label_show_expiry_date ?? hwData?.config?.label_show_expiry_date ?? true}
                onChange={e => setHardwareForm({ ...hardwareForm, label_show_expiry_date: e.target.checked })}
                className="h-4 w-4 rounded border-border"
              />
              <span className="text-xs font-semibold text-muted-foreground">Show Expiry Date</span>
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={hardwareForm?.label_show_sku ?? hwData?.config?.label_show_sku ?? true}
                onChange={e => setHardwareForm({ ...hardwareForm, label_show_sku: e.target.checked })}
                className="h-4 w-4 rounded border-border"
              />
              <span className="text-xs font-semibold text-muted-foreground">Show SKU</span>
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={hardwareForm?.label_show_store_name ?? hwData?.config?.label_show_store_name ?? true}
                onChange={e => setHardwareForm({ ...hardwareForm, label_show_store_name: e.target.checked })}
                className="h-4 w-4 rounded border-border"
              />
              <span className="text-xs font-semibold text-muted-foreground">Show Store Name</span>
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={hardwareForm?.label_show_store_address ?? hwData?.config?.label_show_store_address ?? true}
                onChange={e => setHardwareForm({ ...hardwareForm, label_show_store_address: e.target.checked })}
                className="h-4 w-4 rounded border-border"
              />
              <span className="text-xs font-semibold text-muted-foreground">Show Store Address</span>
            </label>
            <button
              onClick={async () => {
                const printerId = hardwareForm?.label_printer_id ?? hwData?.config?.label_printer_id;
                if (!printerId) return toast.error("Select a label printer first");
                setTesting(true);
                try {
                  const res = await testLabelPrinter({ data: {
                    printerId,
                    labelWidth: hardwareForm?.label_width_mm ?? hwData?.config?.label_width_mm,
                    labelHeight: hardwareForm?.label_height_mm ?? hwData?.config?.label_height_mm,
                  } });
                  if (res.success) toast.success(res.message || "Test label printed");
                  else toast.error(res.error || "Test label failed");
                } catch (e) {
                  toast.error(e instanceof Error ? e.message : "Test label failed");
                } finally {
                  setTesting(false);
                }
              }}
              disabled={testing}
              className="flex items-center gap-1.5 rounded-lg bg-secondary px-4 py-2 text-xs font-semibold text-white hover:bg-secondary/90 disabled:opacity-60"
            >
              {testing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Barcode className="h-3.5 w-3.5" />}
              Test Label Printer
            </button>
          </div>
        </div>

        {/* Printing Preferences Section */}
        <div className="mt-6 p-4 rounded-lg border border-border bg-muted/30 space-y-3">
          <div className="flex items-center gap-2">
            <SettingsIcon className="h-4 w-4 text-primary" />
            <h3 className="text-sm font-semibold text-foreground">Printing Preferences</h3>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <WField label="Default Label Copies">
              <input
                type="number"
                min="1"
                value={hardwareForm?.default_label_copies ?? hwData?.config?.default_label_copies ?? 1}
                onChange={e => setHardwareForm({ ...hardwareForm, default_label_copies: Number(e.target.value) })}
                className={inp}
              />
            </WField>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={hardwareForm?.preview_before_print ?? hwData?.config?.preview_before_print ?? false}
                onChange={e => setHardwareForm({ ...hardwareForm, preview_before_print: e.target.checked })}
                className="h-4 w-4 rounded border-border"
              />
              <span className="text-xs font-semibold text-muted-foreground">Preview before print</span>
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={hardwareForm?.batch_printing ?? hwData?.config?.batch_printing ?? false}
                onChange={e => setHardwareForm({ ...hardwareForm, batch_printing: e.target.checked })}
                className="h-4 w-4 rounded border-border"
              />
              <span className="text-xs font-semibold text-muted-foreground">Batch printing (queue multiple labels)</span>
            </label>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 border-t border-border pt-4 mt-6">
          <button
            onClick={async () => {
              setHwSaving(true);
              try {
                await saveHardwareConfig({ data: hardwareForm as any });
                toast.success("Hardware configuration saved");
                qc.invalidateQueries({ queryKey: ["hardware-config"] });
              } catch (e) {
                toast.error(e instanceof Error ? e.message : "Failed to save hardware config");
              } finally {
                setHwSaving(false);
              }
            }}
            disabled={hwSaving}
            className="flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-xs font-semibold text-white hover:bg-primary/90 disabled:opacity-60"
          >
            {hwSaving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <SettingsIcon className="h-3.5 w-3.5" />}
            Save Hardware Settings
          </button>
        </div>
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
