import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Package } from "lucide-react";

export const Route = createFileRoute("/_authenticated/orders")({
  component: OrdersPage,
});

const statusVariant: Record<string, string> = {
  NEW: "bg-secondary-soft text-secondary-foreground",
  PROCESSING: "bg-primary-soft text-foreground",
  PACKED: "bg-primary/30 text-foreground",
  OUT_FOR_DELIVERY: "bg-secondary text-secondary-foreground",
  DELIVERED: "bg-success/15 text-success",
  CANCELLED: "bg-destructive/15 text-destructive",
};

function paymentLabel(o: any): string | null {
  if (o.payment_method === "COD" && o.payment_status === "PENDING") return "Pay on delivery";
  if (o.payment_method === "ONLINE" && o.payment_status === "PENDING") return "Payment pending";
  if (o.payment_status === "PAID") return "Paid";
  return o.payment_status;
}

function OrdersPage() {
  const { user } = Route.useRouteContext();
  const { data: orders } = useQuery({
    queryKey: ["orders", user.id],
    queryFn: async () => (await supabase.from("orders").select("*, order_items(quantity, product_name)").eq("user_id", user.id).order("created_at", { ascending: false })).data ?? [],
  });

  if (!orders?.length) {
    return (
      <div className="mx-auto max-w-lg px-4 py-16 text-center">
        <div className="mx-auto mb-4 grid h-16 w-16 place-items-center rounded-full bg-primary-soft"><Package className="h-7 w-7" /></div>
        <h1 className="font-display text-2xl">No orders yet</h1>
        <p className="mt-2 text-muted-foreground">Your orders will appear here.</p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl px-4 py-8">
      <h1 className="mb-6 font-display text-2xl">My orders</h1>
      <div className="space-y-3">
        {orders.map((o: any) => (
          <Link key={o.id} to="/orders/$id" params={{ id: o.id }} className="block rounded-2xl border border-border/60 bg-card p-4 shadow-card transition hover:shadow-soft">
            <div className="flex items-start justify-between gap-2">
              <div>
                <div className="text-xs text-muted-foreground">Order #{o.id.slice(0, 8).toUpperCase()}</div>
                <div className="mt-1 text-sm">{o.order_items?.map((i: any) => `${i.product_name} × ${i.quantity}`).join(", ")}</div>
                <div className="mt-1 text-xs text-muted-foreground">{new Date(o.created_at).toLocaleString()}</div>
              </div>
              <div className="text-right">
                <div className="font-display font-semibold">₹{Number(o.total).toFixed(0)}</div>
                <Badge className={`mt-1 rounded-full border-transparent ${statusVariant[o.status] ?? ""}`}>{o.status.replace(/_/g, " ")}</Badge>
                {paymentLabel(o) ? (
                  <div className="mt-1 text-[11px] font-medium text-muted-foreground">{paymentLabel(o)}</div>
                ) : null}
              </div>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
