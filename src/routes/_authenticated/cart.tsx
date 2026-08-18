import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Minus, Plus, Trash2, ShoppingBag } from "lucide-react";

export const Route = createFileRoute("/_authenticated/cart")({
  component: CartPage,
});

function CartPage() {
  const qc = useQueryClient();
  const { user } = Route.useRouteContext();
  const { data: items } = useQuery({
    queryKey: ["cart", user.id],
    queryFn: async () =>
      (
        await supabase
          .from("carts")
          .select("id, quantity, product:products(*)")
          .eq("user_id", user.id)
      ).data ?? [],
  });

  const updateQty = useMutation({
    mutationFn: async ({ id, quantity }: { id: string; quantity: number }) => {
      if (quantity <= 0) await supabase.from("carts").delete().eq("id", id);
      else await supabase.from("carts").update({ quantity }).eq("id", id);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["cart"] });
      qc.invalidateQueries({ queryKey: ["cart-count"] });
    },
  });

  const subtotal = (items ?? []).reduce(
    (s, it: any) => s + Number(it.product?.discount_price ?? it.product?.price) * it.quantity,
    0,
  );

  if (!items?.length) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-16 text-center">
        <div className="mx-auto mb-4 grid h-16 w-16 place-items-center rounded-full bg-primary-soft">
          <ShoppingBag className="h-7 w-7 text-primary-foreground" />
        </div>
        <h1 className="font-display text-2xl">Your cart is empty</h1>
        <p className="mt-2 text-muted-foreground">Start browsing handmade treasures.</p>
        <Button asChild className="mt-6 rounded-full">
          <Link to="/">Shop now</Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="mx-auto grid max-w-5xl gap-8 px-4 py-8 md:grid-cols-[1fr_320px]">
      <div>
        <h1 className="mb-4 font-display text-2xl">Your cart</h1>
        <div className="space-y-3">
          {items.map((it: any) => {
            const price = Number(it.product?.discount_price ?? it.product?.price);
            return (
              <div
                key={it.id}
                className="flex gap-3 rounded-2xl border border-border/60 bg-card p-3 shadow-card"
              >
                <img
                  src={it.product?.image_urls?.[0]}
                  alt=""
                  className="h-20 w-20 rounded-xl object-cover"
                />
                <div className="flex flex-1 flex-col">
                  <Link
                    to="/product/$slug"
                    params={{ slug: it.product.slug }}
                    className="text-sm font-medium"
                  >
                    {it.product?.name}
                  </Link>
                  <span className="mt-1 font-display font-semibold">
                    ₹{(price * Number(it.quantity)).toFixed(0)}
                  </span>
                  <div className="mt-auto flex items-center gap-2">
                    <div className="inline-flex items-center rounded-full border border-border bg-background">
                      <button
                        onClick={() =>
                          updateQty.mutate({
                            id: it.id,
                            quantity: Math.max(0, Number((it.quantity - 0.5).toFixed(3))),
                          })
                        }
                        className="grid h-8 w-8 place-items-center"
                      >
                        <Minus className="h-3.5 w-3.5" />
                      </button>
                      <span className="w-14 text-center text-sm">
                        {Number(it.quantity)} {it.product?.unit ?? it.unit ?? ""}
                      </span>
                      <button
                        onClick={() =>
                          updateQty.mutate({
                            id: it.id,
                            quantity: Math.min(
                              it.product?.stock ?? 999,
                              Number((it.quantity + 0.5).toFixed(3)),
                            ),
                          })
                        }
                        className="grid h-8 w-8 place-items-center"
                      >
                        <Plus className="h-3.5 w-3.5" />
                      </button>
                    </div>
                    <button
                      onClick={() => updateQty.mutate({ id: it.id, quantity: 0 })}
                      className="ml-2 text-muted-foreground hover:text-destructive"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
      <aside className="h-fit rounded-2xl border border-border/60 bg-card p-5 shadow-card">
        <h2 className="font-display text-lg">Order summary</h2>
        <div className="mt-3 space-y-2 text-sm">
          <div className="flex justify-between">
            <span>Subtotal</span>
            <span>₹{subtotal.toFixed(0)}</span>
          </div>
          <div className="flex justify-between text-muted-foreground">
            <span>Delivery</span>
            <span>Calculated at checkout</span>
          </div>
          <div className="mt-3 flex justify-between border-t border-border pt-3 font-display font-semibold">
            <span>Total</span>
            <span>₹{subtotal.toFixed(0)}</span>
          </div>
        </div>
        <Button asChild className="mt-4 w-full rounded-full">
          <Link to="/checkout">Checkout</Link>
        </Button>
      </aside>
    </div>
  );
}
