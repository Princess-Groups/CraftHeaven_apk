import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { BellRing, Check, CheckCheck, Trash2 } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/admin/mc/notifications")({
  head: () => ({ meta: [{ title: "Notifications — Multi-Channel" }] }),
  component: MCNotifications,
});

const KIND_ICONS: Record<string, { emoji: string; bg: string }> = {
  info: { emoji: "ℹ️", bg: "bg-blue-50" },
  warning: { emoji: "⚠️", bg: "bg-amber-50" },
  error: { emoji: "🔴", bg: "bg-rose-50" },
  success: { emoji: "✅", bg: "bg-green-50" },
};

function MCNotifications() {
  const qc = useQueryClient();

  const { data: notifications } = useQuery({
    queryKey: ["mc-notifications"],
    queryFn: async () =>
      (await supabase.from("mc_notifications").select("*").order("created_at", { ascending: false }).limit(100)).data ?? [],
  });

  const unreadCount = notifications?.filter((n) => !n.is_read).length ?? 0;

  async function markRead(id: string) {
    await supabase.from("mc_notifications").update({ is_read: true }).eq("id", id);
    qc.invalidateQueries({ queryKey: ["mc-notifications"] });
  }

  async function markAllRead() {
    await supabase.from("mc_notifications").update({ is_read: true }).eq("is_read", false);
    toast.success("All notifications marked as read");
    qc.invalidateQueries({ queryKey: ["mc-notifications"] });
  }

  async function clearAll() {
    if (!confirm("Clear all notifications?")) return;
    await supabase.from("mc_notifications").delete().neq("id", "00000000-0000-0000-0000-000000000000");
    toast.success("All notifications cleared");
    qc.invalidateQueries({ queryKey: ["mc-notifications"] });
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <BellRing className="h-5 w-5 text-primary" />
        <h1 className="text-xl font-bold text-foreground flex-1">
          Notifications
          {unreadCount > 0 && <span className="ml-2 text-sm font-normal text-primary">({unreadCount} unread)</span>}
        </h1>
        {unreadCount > 0 && (
          <button onClick={markAllRead} className="flex items-center gap-1.5 rounded-lg border border-border bg-white px-3 py-2 text-xs font-semibold text-muted-foreground hover:bg-secondary-soft">
            <CheckCheck className="h-3.5 w-3.5" /> Mark all read
          </button>
        )}
        <button onClick={clearAll} className="flex items-center gap-1.5 rounded-lg border border-border bg-white px-3 py-2 text-xs font-semibold text-muted-foreground hover:bg-secondary-soft">
          <Trash2 className="h-3.5 w-3.5" /> Clear all
        </button>
      </div>

      <div className="space-y-2">
        {(notifications ?? []).map((n) => {
          const icon = KIND_ICONS[n.kind] || KIND_ICONS.info;
          return (
            <div key={n.id} className={`rounded-xl border bg-white shadow-sm p-4 transition ${n.is_read ? "border-border/50 opacity-70" : "border-border"}`}>
              <div className="flex items-start gap-3">
                <span className={`text-lg h-8 w-8 grid place-items-center rounded-lg ${icon.bg}`}>{icon.emoji}</span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <h3 className="text-sm font-bold text-foreground">{n.title}</h3>
                    {n.channel && (
                      <span className="text-[9px] font-bold uppercase px-1.5 py-0.5 rounded bg-muted text-muted-foreground">{n.channel}</span>
                    )}
                  </div>
                  {n.body && <p className="text-xs text-muted-foreground mt-0.5">{n.body}</p>}
                  <div className="text-[10px] text-muted-foreground/70 mt-1">{new Date(n.created_at).toLocaleString("en-IN")}</div>
                </div>
                {!n.is_read && (
                  <button onClick={() => markRead(n.id)} className="rounded-lg p-1.5 hover:bg-secondary-soft text-primary" title="Mark as read">
                    <Check className="h-4 w-4" />
                  </button>
                )}
              </div>
            </div>
          );
        })}
        {(!notifications || notifications.length === 0) && (
          <div className="rounded-xl border border-dashed border-border bg-white/50 py-12 text-center">
            <BellRing className="h-8 w-8 text-muted-foreground/30 mx-auto mb-2" />
            <p className="text-sm text-muted-foreground">No notifications</p>
            <p className="text-xs text-muted-foreground/70 mt-1">You're all caught up!</p>
          </div>
        )}
      </div>
    </div>
  );
}
