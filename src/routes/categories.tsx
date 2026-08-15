import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Search, TrendingUp, Clock } from "lucide-react";
import { useEffect, useState } from "react";

export const Route = createFileRoute("/categories")({
  head: () => ({
    meta: [
      { title: "All Categories · Athira's Creative Haven" },
      { name: "description", content: "Explore resin, crochet, yarn, painting, DIY kits and more craft categories at Athira's Creative Haven." },
      { property: "og:title", content: "Shop by Category" },
      { property: "og:description", content: "Every craft category, in one place." },
    ],
  }),
  component: CategoriesPage,
});

const TRENDING = ["Resin coasters", "Crochet flowers", "Acrylic pour", "Air-dry clay", "Alcohol ink", "Beginner kits"];

function CategoriesPage() {
  const [q, setQ] = useState("");
  const [recent, setRecent] = useState<string[]>([]);
  useEffect(() => {
    try { setRecent(JSON.parse(localStorage.getItem("ach_recent") || "[]")); } catch { /* ignore */ }
  }, []);
  const saveSearch = (term: string) => {
    const next = [term, ...recent.filter((r) => r !== term)].slice(0, 6);
    setRecent(next);
    try { localStorage.setItem("ach_recent", JSON.stringify(next)); } catch { /* ignore */ }
  };

  const { data: categories } = useQuery({
    queryKey: ["categories-all"],
    queryFn: async () => (await supabase.from("categories").select("*").order("name")).data ?? [],
  });
  const { data: products } = useQuery({
    queryKey: ["search-products", q],
    queryFn: async () => {
      if (!q.trim()) return [];
      const { data } = await supabase.from("products").select("*").ilike("name", `%${q}%`).limit(20);
      return data ?? [];
    },
    enabled: q.trim().length > 0,
  });

  return (
    <div className="mx-auto max-w-md px-4 pt-2">
      <h1 className="font-display text-2xl font-semibold">Categories</h1>
      <p className="text-xs text-muted-foreground">Discover crafts by vibe</p>

      <form
        onSubmit={(e) => { e.preventDefault(); if (q.trim()) saveSearch(q.trim()); }}
        className="mt-3 flex items-center gap-2 rounded-full border border-border bg-card px-4 py-2.5 shadow-card"
      >
        <Search className="h-4 w-4 text-muted-foreground" />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search craft supplies"
          className="flex-1 bg-transparent text-sm outline-none"
        />
      </form>

      {q.trim().length === 0 ? (
        <>
          {recent.length > 0 && (
            <section className="mt-5">
              <div className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
                <Clock className="h-3.5 w-3.5" /> Recent searches
              </div>
              <div className="flex flex-wrap gap-2">
                {recent.map((r) => (
                  <button key={r} onClick={() => setQ(r)} className="rounded-full border border-border bg-card px-3 py-1 text-xs">{r}</button>
                ))}
              </div>
            </section>
          )}
          <section className="mt-5">
            <div className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
              <TrendingUp className="h-3.5 w-3.5" /> Trending
            </div>
            <div className="flex flex-wrap gap-2">
              {TRENDING.map((t) => (
                <button key={t} onClick={() => setQ(t)} className="rounded-full bg-primary-soft px-3 py-1 text-xs text-foreground">{t}</button>
              ))}
            </div>
          </section>

          <section className="mt-6 pb-6">
            <h2 className="mb-3 font-display text-lg font-semibold">All Categories</h2>
            <div className="grid grid-cols-2 gap-3">
              {categories?.map((c) => (
                <Link
                  key={c.id}
                  to="/category/$slug"
                  params={{ slug: c.slug }}
                  className="group relative overflow-hidden rounded-2xl shadow-card"
                >
                  <img src={c.image_url ?? ""} alt={c.name} className="aspect-[4/5] w-full object-cover transition duration-500 group-hover:scale-105" />
                  <div className="absolute inset-0 bg-gradient-to-t from-[#8FAF94]/70 via-[#DCE8DA]/30 to-transparent" />
                  <div className="absolute inset-x-2 bottom-2 rounded-xl bg-[#DCE8DA] px-3 py-1.5">
                    <div className="text-sm font-semibold text-foreground">{c.name}</div>
                  </div>
                </Link>
              ))}
            </div>
          </section>
        </>
      ) : (
        <section className="mt-5 pb-6">
          <h2 className="mb-3 text-sm font-semibold text-muted-foreground">Results for "{q}"</h2>
          {products && products.length > 0 ? (
            <div className="grid grid-cols-2 gap-3">
              {products.map((p) => (
                <Link key={p.id} to="/product/$slug" params={{ slug: p.slug }} className="overflow-hidden rounded-2xl bg-card shadow-card">
                  <div className="aspect-square overflow-hidden bg-primary-soft">
                    <img src={p.image_urls[0]} alt={p.name} className="h-full w-full object-cover" />
                  </div>
                  <div className="p-2.5">
                    <div className="line-clamp-2 text-xs font-medium">{p.name}</div>
                    <div className="mt-1 font-display font-semibold">₹{Number(p.discount_price ?? p.price).toFixed(0)}</div>
                  </div>
                </Link>
              ))}
            </div>
          ) : (
            <p className="py-10 text-center text-sm text-muted-foreground">No products found. Try another search.</p>
          )}
        </section>
      )}
    </div>
  );
}
