import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Check, Package, Truck, Home, Clock, XCircle, CalendarDays } from "lucide-react";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/orders/$id")({
  component: OrderDetail,
});

const pipeline = [
  { key: "NEW", label: "New order", icon: Clock },
  { key: "PROCESSING", label: "Processing", icon: Package },
  { key: "PACKED", label: "Packed", icon: Package },
  { key: "OUT_FOR_DELIVERY", label: "Out for delivery", icon: Truck },
  { key: "DELIVERED", label: "Delivered", icon: Home },
];

function estimatedDelivery(order: { delivery_type?: string | null; status: string; created_at: string }): string | null {
  if (order.status === "DELIVERED" || order.status === "CANCELLED") return null;
  if (order.delivery_type === "PICKUP") return "Ready for pickup 1–2 days after ordering";
  const eta = new Date(new Date(order.created_at).getTime() + 4 * 864e5);
  return `Estimated delivery by ${eta.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })}`;
}

function OrderDetail() {
  const { id } = Route.useParams();
  const { data: order } = useQuery({
    queryKey: ["order", id],
    queryFn: async () => (await supabase.from("orders").select("*, order_items(*), order_status_events(*)").eq("id", id).maybeSingle()).data,
  });

  if (!order) return <div className="p-8 text-center text-muted-foreground">Loading order…</div>;
  const currentIdx = pipeline.findIndex((s) => s.key === order.status);
  const cancelled = order.status === "CANCELLED";
  const events = [...(order.order_status_events ?? [])].sort((a: any, b: any) => a.created_at.localeCompare(b.created_at));
  const eta = estimatedDelivery(order as any);

  return (
    <div className="mx-auto max-w-3xl px-4 py-8">
      <Link to="/orders" className="text-sm text-muted-foreground hover:underline">← All orders</Link>
      <h1 className="mt-2 font-display text-2xl">Order #{order.id.slice(0, 8).toUpperCase()}</h1>
      <p className="text-sm text-muted-foreground">Placed {new Date(order.created_at).toLocaleString()}</p>

      {/* Estimated delivery */}
      {eta && !cancelled ? (
        <div className="mt-6 flex items-center gap-3 rounded-2xl bg-secondary-soft p-4">
          <CalendarDays className="h-5 w-5 text-secondary-foreground" />
          <div className="text-sm">
            <div className="font-medium">Arriving by</div>
            <div className="text-muted-foreground">{eta}</div>
          </div>
        </div>
      ) : null}

      {/* Pipeline */}
      <div className="mt-6 rounded-3xl bg-gradient-to-br from-primary-soft to-secondary-soft p-6">
        {cancelled ? (
          <div className="flex items-center gap-3 text-destructive">
            <XCircle className="h-6 w-6" /> <span className="font-medium">This order was cancelled</span>
          </div>
        ) : (
          <div className="flex items-center justify-between">
            {pipeline.map((s, i) => {
              const done = i <= currentIdx;
              const Icon = s.icon;
              return (
                <div key={s.key} className="flex flex-1 flex-col items-center text-center">
                  <div className={cn("grid h-10 w-10 place-items-center rounded-full", done ? "bg-secondary text-secondary-foreground" : "bg-background text-muted-foreground")}>
                    {done ? <Check className="h-5 w-5" /> : <Icon className="h-5 w-5" />}
                  </div>
                  <span className={cn("mt-2 text-[11px]", done ? "font-medium" : "text-muted-foreground")}>{s.label}</span>
                  {i < pipeline.length - 1 ? <div className={cn("mt-[-24px] h-0.5 w-full", i < currentIdx ? "bg-secondary" : "bg-border")} /> : null}
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div className="mt-6 grid gap-6 md:grid-cols-2">
        <div className="rounded-2xl border border-border/60 bg-card p-5 shadow-card">
          <h2 className="font-display text-lg">Items</h2>
          <div className="mt-3 space-y-2">
            {order.order_items?.map((it: any) => (
              <div key={it.id} className="flex justify-between text-sm">
                <span>{it.product_name} × {it.quantity}</span>
                <span>₹{Number(it.line_total).toFixed(0)}</span>
              </div>
            ))}
            <div className="mt-2 flex justify-between border-t border-border pt-2 text-sm"><span>Subtotal</span><span>₹{Number(order.subtotal).toFixed(0)}</span></div>
            {Number(order.discount) > 0 ? (
              <div className="flex justify-between text-sm text-success"><span>Coupon discount</span><span>–₹{Number(order.discount).toFixed(0)}</span></div>
            ) : null}
            <div className="flex justify-between text-sm"><span>Delivery</span><span>₹{Number(order.delivery_fee).toFixed(0)}</span></div>
            <div className="mt-1 flex justify-between font-display text-lg font-semibold"><span>Total</span><span>₹{Number(order.total).toFixed(0)}</span></div>
          </div>
        </div>
        <div className="rounded-2xl border border-border/60 bg-card p-5 shadow-card">
          <h2 className="font-display text-lg">Timeline</h2>
          <div className="mt-3 space-y-3">
            {events.map((e: any) => (
              <div key={e.id} className="flex gap-3">
                <div className="mt-1 h-2 w-2 rounded-full bg-secondary" />
                <div className="text-sm">
                  <div className="font-medium">{e.status.replace(/_/g, " ")}</div>
                  <div className="text-xs text-muted-foreground">{new Date(e.created_at).toLocaleString()}{e.note ? ` — ${e.note}` : ""}</div>
                </div>
              </div>
            ))}
          </div>
          <div className="mt-4 rounded-xl bg-secondary-soft p-3 text-sm">
            <div className="font-medium">{order.delivery_type === "PICKUP" ? "Store pickup" : "Home delivery"}</div>
            {order.address_snapshot ? (() => {
              const a: any = order.address_snapshot;
              return (
                <div className="mt-1 text-xs text-muted-foreground">
                  {a.full_name}, {a.line1}, {a.city} {a.pincode}
                </div>
              );
            })() : null}
            <div className="mt-1 text-xs text-muted-foreground">
              Payment: {order.payment_method} · {order.payment_status}
              {order.notes && /UTR/.test(String(order.notes)) ? <span className="ml-2 rounded-full bg-secondary-soft px-2 py-0.5 font-medium">{order.notes}</span> : null}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
