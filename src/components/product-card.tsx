import { Link } from "@tanstack/react-router";
import { Heart } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

type Product = {
  id: string;
  name: string;
  slug: string;
  price: number;
  discount_price: number | null;
  image_urls: string[];
  stock: number;
  unit?: string;
  is_available: boolean;
  low_stock_threshold: number;
  rating?: number | null;
};

export function ProductCard({ product }: { product: Product }) {
  const qc = useQueryClient();
  const price = product.discount_price ?? product.price;
  const hasDiscount = product.discount_price != null && product.discount_price < product.price;
  const lowStock = product.stock > 0 && product.stock <= product.low_stock_threshold;
  const outOfStock = product.stock <= 0 || !product.is_available;

  const { data: session } = useQuery({
    queryKey: ["session"],
    queryFn: async () => (await supabase.auth.getSession()).data.session,
  });

  const { data: isWished } = useQuery({
    queryKey: ["wishlist-has", product.id, session?.user.id],
    queryFn: async () => {
      if (!session) return false;
      const { count } = await supabase
        .from("wishlists")
        .select("*", { count: "exact", head: true })
        .eq("user_id", session.user.id)
        .eq("product_id", product.id);
      return (count ?? 0) > 0;
    },
    enabled: !!session,
  });

  const toggleWish = useMutation({
    mutationFn: async () => {
      if (!session) throw new Error("Sign in to save favourites");
      if (isWished) {
        await supabase
          .from("wishlists")
          .delete()
          .eq("user_id", session.user.id)
          .eq("product_id", product.id);
      } else {
        await supabase
          .from("wishlists")
          .insert({ user_id: session.user.id, product_id: product.id });
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["wishlist-has", product.id] });
      qc.invalidateQueries({ queryKey: ["wishlist"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="group relative flex flex-col overflow-hidden rounded-2xl border border-border/60 bg-card shadow-card transition hover:shadow-soft">
      <Link to="/product/$slug" params={{ slug: product.slug }} className="relative block">
        <div className="aspect-square overflow-hidden bg-primary-soft">
          <img
            src={product.image_urls[0]}
            alt={product.name}
            className="h-full w-full object-cover transition group-hover:scale-105"
            loading="lazy"
          />
        </div>
        {hasDiscount ? (
          <span className="absolute left-2 top-2 rounded-full bg-warning px-2 py-0.5 text-[10px] font-semibold text-warning-foreground">
            {Math.round(((product.price - price) / product.price) * 100)}% off
          </span>
        ) : null}
        {outOfStock ? (
          <span className="absolute left-2 top-2 rounded-full bg-destructive px-2 py-0.5 text-[10px] font-semibold text-destructive-foreground">
            Out of stock
          </span>
        ) : lowStock ? (
          <span className="absolute left-2 top-2 rounded-full bg-secondary px-2 py-0.5 text-[10px] font-semibold text-secondary-foreground">
            Only {Number(product.stock)} {product.unit ?? ""} left
          </span>
        ) : null}
      </Link>
      <button
        aria-label="Wishlist"
        onClick={(e) => {
          e.preventDefault();
          toggleWish.mutate();
        }}
        className="absolute right-2 top-2 grid h-8 w-8 place-items-center rounded-full bg-background/90 shadow-card backdrop-blur transition hover:scale-105"
      >
        <Heart
          className={cn(
            "h-4 w-4",
            isWished ? "fill-destructive text-destructive" : "text-muted-foreground",
          )}
        />
      </button>
      <div className="flex flex-1 flex-col gap-1 p-3">
        <Link
          to="/product/$slug"
          params={{ slug: product.slug }}
          className="line-clamp-2 text-sm font-medium"
        >
          {product.name}
        </Link>
        <div className="mt-auto flex items-baseline gap-2">
          <span className="font-display text-base font-semibold">₹{Number(price).toFixed(0)}</span>
          {hasDiscount ? (
            <span className="text-xs text-muted-foreground line-through">
              ₹{Number(product.price).toFixed(0)}
            </span>
          ) : null}
        </div>
      </div>
    </div>
  );
}
