import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { ProductCard } from "@/components/product-card";
import { Heart, Minus, Plus, ShieldCheck, Truck, Sparkles } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/product/$slug")({
  head: ({ params }) => ({
    meta: [
      { title: `${params.slug.replace(/-/g, " ")} — Petal & Thread` },
      { name: "description", content: "Handmade craft product from Petal & Thread." },
    ],
  }),
  component: ProductPage,
});

function ProductPage() {
  const { slug } = Route.useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [qty, setQty] = useState(1);
  const [imgIdx, setImgIdx] = useState(0);
  const [variationIdx, setVariationIdx] = useState(-1); // -1 = no colour variation selected

  const { data: product, isLoading } = useQuery({
    queryKey: ["product", slug],
    queryFn: async () =>
      (
        await supabase
          .from("products")
          .select("*, categories(name, slug)")
          .eq("slug", slug)
          .maybeSingle()
      ).data,
  });

  const { data: similar } = useQuery({
    queryKey: ["similar", product?.category_id],
    queryFn: async () => {
      if (!product?.category_id) return [];
      const { data } = await supabase
        .from("products")
        .select("*")
        .eq("category_id", product.category_id)
        .neq("id", product.id)
        .order("is_trending", { ascending: false })
        .limit(8);
      return data ?? [];
    },
    enabled: !!product?.category_id,
  });

  const { data: session } = useQuery({
    queryKey: ["session"],
    queryFn: async () => (await supabase.auth.getSession()).data.session,
  });

  const addToCart = useMutation({
    mutationFn: async ({ buyNow }: { buyNow: boolean }) => {
      if (!session) {
        navigate({ to: "/auth" });
        throw new Error("Please sign in");
      }
      if (!product) throw new Error("No product");
      const { error } = await supabase.from("carts").upsert(
        {
          user_id: session.user.id,
          product_id: product.id,
          quantity: qty,
          unit: product.unit || "Nos",
        },
        { onConflict: "user_id,product_id" },
      );
      if (error) throw error;
      return { buyNow };
    },
    onSuccess: ({ buyNow }) => {
      qc.invalidateQueries({ queryKey: ["cart-count"] });
      qc.invalidateQueries({ queryKey: ["cart"] });
      if (buyNow) navigate({ to: "/checkout" });
      else toast.success("Added to cart");
    },
    onError: (e: Error) => e.message !== "Please sign in" && toast.error(e.message),
  });

  if (isLoading) return <div className="p-8 text-center text-muted-foreground">Loading…</div>;
  if (!product) return <div className="p-8 text-center">Product not found.</div>;

  const price = product.discount_price ?? product.price;
  const hasDiscount = product.discount_price != null && product.discount_price < product.price;
  const outOfStock = product.stock <= 0 || !product.is_available;
  const lowStock = product.stock > 0 && product.stock <= product.low_stock_threshold;

  // Colour variations — each colour carries its own photo.
  const variations: { color: string; image_url: string }[] = Array.isArray(product.color_variations)
    ? (product.color_variations as any[]).filter(
        (v) => v && typeof v === "object" && String(v.color ?? ""),
      )
    : [];

  return (
    <div className="mx-auto max-w-6xl px-4 py-8">
      <div className="grid gap-8 md:grid-cols-2">
        <div>
          <div className="overflow-hidden rounded-3xl bg-primary-soft">
            <img
              src={product.image_urls[imgIdx]}
              alt={product.name}
              className="aspect-square w-full object-cover"
            />
          </div>
          {product.image_urls.length > 1 ? (
            <div className="mt-3 flex gap-2">
              {product.image_urls.map((u, i) => (
                <button
                  key={u}
                  onClick={() => setImgIdx(i)}
                  className={cn(
                    "h-16 w-16 overflow-hidden rounded-xl border-2",
                    i === imgIdx ? "border-primary" : "border-transparent",
                  )}
                >
                  <img src={u} alt="" className="h-full w-full object-cover" />
                </button>
              ))}
            </div>
          ) : null}
        </div>
        <div>
          <p className="text-xs uppercase tracking-wide text-muted-foreground">
            {product.categories?.name}
          </p>
          <h1 className="mt-1 font-display text-3xl">{product.name}</h1>
          <div className="mt-3 flex items-baseline gap-3">
            <span className="font-display text-3xl font-semibold">₹{Number(price).toFixed(0)}</span>
            {hasDiscount ? (
              <>
                <span className="text-muted-foreground line-through">
                  ₹{Number(product.price).toFixed(0)}
                </span>
                <span className="rounded-full bg-warning/15 px-2 py-0.5 text-xs font-semibold text-warning">
                  {Math.round(((product.price - price) / product.price) * 100)}% off
                </span>
              </>
            ) : null}
          </div>
          <div className="mt-2 text-sm">
            {outOfStock ? (
              <span className="text-destructive font-medium">Out of stock</span>
            ) : lowStock ? (
              <span className="text-warning font-medium">
                Only {Number(product.stock)} {product.unit ?? ""} left
              </span>
            ) : (
              <span className="text-success font-medium">In stock</span>
            )}
          </div>
          <p className="mt-4 text-muted-foreground">{product.description}</p>

          {/* Colour variations — each colour with its own photo */}
          {variations.length > 0 ? (
            <div className="mt-5">
              <div className="text-xs font-medium text-muted-foreground">
                Colour:{" "}
                <span className="font-semibold text-foreground">
                  {variationIdx >= 0 ? variations[variationIdx].color : (product.color ?? "Select")}
                </span>
              </div>
              <div className="mt-2 flex flex-wrap gap-2">
                {variations.map((v, i) => (
                  <button
                    key={v.color}
                    onClick={() => {
                      setVariationIdx(i);
                      if (v.image_url) setImgIdx(0);
                    }}
                    className={`flex items-center gap-2 rounded-full border-2 p-1 pl-2 text-xs font-medium transition ${variationIdx === i ? "border-primary bg-primary-soft" : "border-border bg-card hover:border-primary/40"}`}
                  >
                    {v.image_url ? (
                      <img
                        src={v.image_url}
                        alt={v.color}
                        className="h-7 w-7 rounded-full object-cover"
                      />
                    ) : (
                      <span className="grid h-7 w-7 place-items-center rounded-full bg-primary-soft">
                        {v.color[0]?.toUpperCase()}
                      </span>
                    )}
                    {v.color}
                  </button>
                ))}
              </div>
              {variationIdx >= 0 && variations[variationIdx].image_url ? (
                <div className="mt-3 flex gap-2">
                  {variations.map((v, i) => (
                    <button
                      key={v.color}
                      onClick={() => {
                        setVariationIdx(i);
                        setImgIdx(0);
                      }}
                      className={`h-12 w-12 overflow-hidden rounded-xl border-2 ${variationIdx === i ? "border-primary" : "border-transparent"}`}
                    >
                      <img src={v.image_url} alt="" className="h-full w-full object-cover" />
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
          ) : null}

          <div className="mt-6 flex items-center gap-3">
            <div className="inline-flex items-center rounded-full border border-border bg-card">
              <button
                onClick={() => setQty((q) => Math.max(0, Number((q - 0.5).toFixed(3))))}
                className="grid h-10 w-10 place-items-center"
              >
                <Minus className="h-4 w-4" />
              </button>
              <input
                type="number"
                step="0.001"
                min={0}
                max={product.stock}
                value={qty}
                onChange={(e) =>
                  setQty(Math.min(product.stock, Math.max(0, Number(e.target.value) || 0)))
                }
                className="w-14 text-center font-medium outline-none"
              />
              <button
                onClick={() => setQty((q) => Math.min(product.stock, Number((q + 0.5).toFixed(3))))}
                className="grid h-10 w-10 place-items-center"
              >
                <Plus className="h-4 w-4" />
              </button>
            </div>
            <span className="text-sm font-semibold text-muted-foreground">
              {product.unit ?? "Nos"}
            </span>
          </div>

          <div className="mt-4 flex flex-wrap gap-2">
            <Button
              size="lg"
              className="rounded-full"
              disabled={outOfStock}
              onClick={() => addToCart.mutate({ buyNow: false })}
            >
              <Heart className="mr-2 h-4 w-4" /> Add to cart
            </Button>
            <Button
              size="lg"
              variant="secondary"
              className="rounded-full"
              disabled={outOfStock}
              onClick={() => addToCart.mutate({ buyNow: true })}
            >
              Buy now
            </Button>
          </div>

          <div className="mt-6 grid gap-2 rounded-2xl bg-secondary-soft p-4 text-sm">
            <div className="flex items-center gap-2">
              <Truck className="h-4 w-4 text-secondary-foreground" /> Home delivery or store pickup
            </div>
            <div className="flex items-center gap-2">
              <ShieldCheck className="h-4 w-4 text-secondary-foreground" /> Handmade in small
              batches
            </div>
          </div>
        </div>
      </div>

      {similar && similar.length > 0 ? (
        <section className="mt-12">
          <div className="mb-3 flex items-center gap-2">
            <div className="grid h-8 w-8 place-items-center rounded-full bg-primary-soft">
              <Sparkles className="h-4 w-4 text-primary" />
            </div>
            <h2 className="font-display text-[17px] font-semibold">You may also like</h2>
            {product.categories?.slug ? (
              <Link
                to="/category/$slug"
                params={{ slug: product.categories.slug }}
                className="ml-auto text-xs font-medium text-secondary"
              >
                See all
              </Link>
            ) : null}
          </div>
          <div className="no-scrollbar flex gap-3 overflow-x-auto pb-2">
            {similar.map((p) => (
              <div key={p.id} className="w-[150px] shrink-0">
                <ProductCard product={p} />
              </div>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}
