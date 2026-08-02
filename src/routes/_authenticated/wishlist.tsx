import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { ProductCard } from "@/components/product-card";
import { Heart } from "lucide-react";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/_authenticated/wishlist")({
  component: WishlistPage,
});

function WishlistPage() {
  const { user } = Route.useRouteContext();
  const { data: items } = useQuery({
    queryKey: ["wishlist", user.id],
    queryFn: async () => (await supabase.from("wishlists").select("product:products(*)").eq("user_id", user.id)).data ?? [],
  });

  if (!items?.length) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-16 text-center">
        <div className="mx-auto mb-4 grid h-16 w-16 place-items-center rounded-full bg-primary-soft"><Heart className="h-7 w-7 text-destructive" /></div>
        <h1 className="font-display text-2xl">No favourites yet</h1>
        <p className="mt-2 text-muted-foreground">Tap the heart on any product to save it.</p>
        <Button asChild className="mt-6 rounded-full"><Link to="/">Browse products</Link></Button>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl px-4 py-8">
      <h1 className="mb-6 font-display text-2xl">Your wishlist</h1>
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        {items.map((it: any) => it.product && <ProductCard key={it.product.id} product={it.product} />)}
      </div>
    </div>
  );
}
