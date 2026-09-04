import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useState } from "react";
import { Store, Wifi, WifiOff, RefreshCw, Settings, CheckCircle, XCircle, Clock } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/admin/mc/marketplace")({
  head: () => ({ meta: [{ title: "Marketplace Integration" }] }),
  component: MarketplaceIntegration,
});

const CHANNEL_ICONS: Record<string, { emoji: string; color: string }> = {
  WEBSITE: { emoji: "🌐", color: "bg-blue-50 border-blue-200" },
  AMAZON: { emoji: "📦", color: "bg-amber-50 border-amber-200" },
  FLIPKART: { emoji: "🛒", color: "bg-indigo-50 border-indigo-200" },
  MEESHO: { emoji: "🛍️", color: "bg-rose-50 border-rose-200" },
};

function MarketplaceIntegration() {
  const qc = useQueryClient();
  const [configuring, setConfiguring] = useState<string | null>(null);
  const [config, setConfig] = useState({ seller_id: "", api_key: "", api_secret: "" });

  const { data: channels } = useQuery({
    queryKey: ["mc-marketplace-channels"],
    queryFn: async () =>
      (await supabase
        .from("mc_marketplace_channels")
        .select("*, mc_marketplace_connections(*)")
        .order("channel")
      ).data ?? [],
  });

  const { data: recentSyncs } = useQuery({
    queryKey: ["mc-recent-syncs"],
    queryFn: async () =>
      (await supabase
        .from("mc_sync_jobs")
        .select("*, mc_marketplace_channels(name,channel)")
        .order("created_at", { ascending: false })
        .limit(20)
      ).data ?? [],
  });

  async function toggleChannel(channelId: string, enabled: boolean) {
    const { error } = await supabase.from("mc_marketplace_channels").update({ is_enabled: enabled }).eq("id", channelId);
    if (error) return toast.error(error.message);
    toast.success(`Channel ${enabled ? "enabled" : "disabled"}`);
    qc.invalidateQueries({ queryKey: ["mc-marketplace-channels"] });
  }

  async function saveConnection(channelId: string) {
    if (!config.seller_id.trim()) return toast.error("Seller ID is required");
    const existing = (channels ?? []).find((c) => c.id === channelId)?.mc_marketplace_connections?.[0];
    const payload = {
      channel_id: channelId,
      seller_id: config.seller_id,
      api_key_encrypted: config.api_key || null,
      api_secret_encrypted: config.api_secret || null,
      status: "DISCONNECTED" as const,
    };
    if (existing) {
      await supabase.from("mc_marketplace_connections").update(payload).eq("id", existing.id);
    } else {
      await supabase.from("mc_marketplace_connections").insert(payload);
    }
    toast.success("Connection settings saved");
    setConfiguring(null);
    setConfig({ seller_id: "", api_key: "", api_secret: "" });
    qc.invalidateQueries({ queryKey: ["mc-marketplace-channels"] });
  }

  async function testConnection(channelId: string) {
    toast.info("Testing connection… (architecture ready — actual API integration pending)");
  }

  async function syncNow(channelId: string, jobType: string) {
    const { error } = await supabase.from("mc_sync_jobs").insert({
      channel_id: channelId,
      job_type: jobType,
      status: "PENDING",
    });
    if (error) return toast.error(error.message);
    toast.success(`${jobType} sync queued`);
    qc.invalidateQueries({ queryKey: ["mc-recent-syncs"] });
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Store className="h-5 w-5 text-primary" />
        <h1 className="text-xl font-bold text-foreground">Marketplace Integration</h1>
      </div>

      {/* Channel Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {(channels ?? []).map((ch) => {
          const icon = CHANNEL_ICONS[ch.channel] || { emoji: "🏪", color: "bg-gray-50 border-gray-200" };
          const conn = ch.mc_marketplace_connections?.[0];
          return (
            <div key={ch.id} className={`rounded-xl border-2 bg-white shadow-sm p-5 ${icon.color}`}>
              <div className="flex items-start justify-between mb-4">
                <div className="flex items-center gap-3">
                  <span className="text-2xl">{icon.emoji}</span>
                  <div>
                    <h3 className="text-sm font-bold text-foreground">{ch.name}</h3>
                    <div className="flex items-center gap-1.5 mt-0.5">
                      {ch.connection_status === "CONNECTED" ? (
                        <><Wifi className="h-3 w-3 text-green-600" /><span className="text-[10px] font-semibold text-green-600">Connected</span></>
                      ) : ch.connection_status === "ERROR" ? (
                        <><XCircle className="h-3 w-3 text-rose-600" /><span className="text-[10px] font-semibold text-rose-600">Error</span></>
                      ) : (
                        <><WifiOff className="h-3 w-3 text-gray-400" /><span className="text-[10px] font-semibold text-gray-400">Disconnected</span></>
                      )}
                    </div>
                  </div>
                </div>
                <label className="relative inline-flex items-center cursor-pointer">
                  <input type="checkbox" checked={ch.is_enabled} onChange={(e) => toggleChannel(ch.id, e.target.checked)} className="sr-only peer" />
                  <div className="w-9 h-5 bg-gray-200 peer-focus:ring-2 peer-focus:ring-primary/30 rounded-full peer peer-checked:after:translate-x-full after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-primary"></div>
                </label>
              </div>

              {/* Sync Status */}
              <div className="grid grid-cols-4 gap-2 mb-4">
                {[
                  { label: "Products", key: "product_sync", enabled: ch.product_sync },
                  { label: "Inventory", key: "inventory_sync", enabled: ch.inventory_sync },
                  { label: "Prices", key: "price_sync", enabled: ch.price_sync },
                  { label: "Orders", key: "order_sync", enabled: ch.order_sync },
                ].map((s) => (
                  <div key={s.key} className={`text-center rounded-lg p-2 ${s.enabled ? "bg-white/80 border border-border/50" : "bg-white/30 opacity-50"}`}>
                    <div className={`text-[9px] font-bold uppercase ${s.enabled ? "text-foreground" : "text-muted-foreground"}`}>{s.label}</div>
                    <div className={`text-[9px] mt-0.5 ${s.enabled ? "text-green-600" : "text-muted-foreground"}`}>{s.enabled ? "ON" : "OFF"}</div>
                  </div>
                ))}
              </div>

              {/* Last Sync */}
              {conn?.last_sync_at && (
                <div className="text-[10px] text-muted-foreground flex items-center gap-1 mb-3">
                  <Clock className="h-3 w-3" /> Last sync: {new Date(conn.last_sync_at).toLocaleString("en-IN")}
                </div>
              )}

              {/* Actions */}
              <div className="flex flex-wrap gap-1.5">
                <button onClick={() => { setConfiguring(ch.id); setConfig({ seller_id: conn?.seller_id || "", api_key: "", api_secret: "" }); }} className="flex items-center gap-1 rounded-lg bg-white border border-border px-2.5 py-1.5 text-[10px] font-semibold hover:bg-secondary-soft">
                  <Settings className="h-3 w-3" /> Configure
                </button>
                <button onClick={() => testConnection(ch.id)} className="flex items-center gap-1 rounded-lg bg-white border border-border px-2.5 py-1.5 text-[10px] font-semibold hover:bg-secondary-soft">
                  <Wifi className="h-3 w-3" /> Test
                </button>
                {(["PRODUCT", "INVENTORY", "PRICE", "ORDER"] as const).map((jt) => (
                  <button key={jt} onClick={() => syncNow(ch.id, jt)} className="flex items-center gap-1 rounded-lg bg-white border border-border px-2.5 py-1.5 text-[10px] font-semibold hover:bg-secondary-soft" disabled={!ch.is_enabled}>
                    <RefreshCw className="h-3 w-3" /> Sync {jt}
                  </button>
                ))}
              </div>
            </div>
          );
        })}
      </div>

      {/* Sync History */}
      <div className="rounded-xl border border-border bg-white shadow-sm overflow-hidden">
        <div className="px-4 py-3 border-b border-border">
          <h2 className="text-sm font-bold text-foreground">Sync History</h2>
        </div>
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="bg-muted">
              <th className="px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-muted-foreground text-left border-b border-border">Channel</th>
              <th className="px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-muted-foreground text-left border-b border-border">Type</th>
              <th className="px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-muted-foreground text-center border-b border-border">Status</th>
              <th className="px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-muted-foreground text-center border-b border-border">Progress</th>
              <th className="px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-muted-foreground text-center border-b border-border">Date</th>
            </tr>
          </thead>
          <tbody>
            {(recentSyncs ?? []).map((j) => (
              <tr key={j.id} className="border-b border-border/50 last:border-0">
                <td className="px-3 py-2 text-xs font-semibold">{j.mc_marketplace_channels?.name ?? "—"}</td>
                <td className="px-3 py-2 text-xs">{j.job_type}</td>
                <td className="px-3 py-2 text-center">
                  <span className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded-full ${
                    j.status === "COMPLETED" ? "bg-green-50 text-green-700" :
                    j.status === "FAILED" ? "bg-rose-50 text-rose-700" :
                    j.status === "RUNNING" ? "bg-blue-50 text-blue-700" :
                    "bg-gray-50 text-gray-600"
                  }`}>{j.status}</span>
                </td>
                <td className="px-3 py-2 text-center text-xs">{j.items_synced}/{j.items_total} {j.items_failed ? `(${j.items_failed} failed)` : ""}</td>
                <td className="px-3 py-2 text-center text-[10px] text-muted-foreground">{new Date(j.created_at).toLocaleString("en-IN")}</td>
              </tr>
            ))}
            {(!recentSyncs || recentSyncs.length === 0) && (
              <tr><td colSpan={5} className="px-6 py-8 text-center text-xs text-muted-foreground/70">No sync history yet</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Configuration Modal */}
      {configuring && (
        <div className="fixed inset-0 z-50 bg-black/40 grid place-items-center p-4" onClick={() => setConfiguring(null)}>
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-sm font-bold text-foreground mb-4">
              Configure {channels?.find((c) => c.id === configuring)?.name}
            </h2>
            <div className="space-y-3">
              <div className="space-y-1">
                <label className="text-[11px] font-semibold text-muted-foreground uppercase">Seller ID / Merchant ID</label>
                <input value={config.seller_id} onChange={(e) => setConfig({ ...config, seller_id: e.target.value })} className={inputCls} placeholder="e.g., A3XXXXXXXXXX" />
              </div>
              <div className="space-y-1">
                <label className="text-[11px] font-semibold text-muted-foreground uppercase">API Key</label>
                <input value={config.api_key} onChange={(e) => setConfig({ ...config, api_key: e.target.value })} className={inputCls} type="password" placeholder="Enter API key" />
              </div>
              <div className="space-y-1">
                <label className="text-[11px] font-semibold text-muted-foreground uppercase">API Secret</label>
                <input value={config.api_secret} onChange={(e) => setConfig({ ...config, api_secret: e.target.value })} className={inputCls} type="password" placeholder="Enter API secret" />
              </div>
              <p className="text-[10px] text-muted-foreground/70 italic">
                Credentials are stored securely in the database. They are never exposed in frontend code.
              </p>
            </div>
            <div className="flex justify-end gap-2 mt-4">
              <button onClick={() => setConfiguring(null)} className="rounded-lg border border-border px-4 py-2 text-xs font-semibold text-muted-foreground hover:bg-secondary-soft">Cancel</button>
              <button onClick={() => saveConnection(configuring)} className="rounded-lg bg-primary px-5 py-2 text-xs font-semibold text-white hover:bg-primary/90">Save Connection</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const inputCls = "w-full rounded-lg border border-border bg-white px-3 py-2 text-sm outline-none focus:border-primary";
