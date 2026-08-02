import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { ProductCard } from "@/components/product-card";

export const Route = createFileRoute("/category/$slug")({
  component: CategoryPage,
});

function CategoryPage() {
  const { slug } = Route.useParams();
  const { data: category } = useQuery({
    queryKey: ["category", slug],
    queryFn: async () => (await supabase.from("categories").select("*").eq("slug", slug).maybeSingle()).data,
  });
  const { data: products } = useQuery({
    queryKey: ["category-products", slug],
    queryFn: async () => {
      if (!category) return [];
      return (await supabase.from("products").select("*").eq("category_id", category.id)).data ?? [];
    },
    enabled: !!category,
  });

  return (
    <div className="mx-auto max-w-6xl px-4 py-8">
      <h1 className="font-display text-3xl">{category?.name ?? "Category"}</h1>
      <div className="mt-6 grid grid-cols-2 gap-4 md:grid-cols-4">
        {products?.map((p) => <ProductCard key={p.id} product={p} />)}
      </div>
    </div>
  );
}
