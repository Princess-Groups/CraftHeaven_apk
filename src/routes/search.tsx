import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { ProductCard } from "@/components/product-card";
import { Search, SlidersHorizontal } from "lucide-react";
import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/search")({
  head: () => ({
    meta: [
      { title: "Search · Athira's Creative Haven" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: SearchPage,
});

const SORT_OPTIONS = [
  { key: "", label: "Relevance" },
  { key: "price_asc", label: "Price: Low to High" },
  { key: "price_desc", label: "Price: High to Low" },
  { key: "newest", label: "Newest first" },
] as const;

type SortKey = (typeof SORT_OPTIONS)[number]["key"];

function SearchPage() {
  const navigate = useNavigate();
  const urlQ = (Route.useSearch() as { q?: string }).q ?? "";
  const [q, setQ] = useState(urlQ);
  const [sort, setSort] = useState<SortKey>("");
  const [activeQ, setActiveQ] = useState(urlQ);

  // Keep local state in sync when the URL ?q= changes (header search navigates here).
  useEffect(() => { setQ(urlQ); setActiveQ(urlQ); }, [urlQ]);

  const { data: products, isLoading } = useQuery({
    queryKey: ["search", activeQ, sort],
    queryFn: async () => {
      if (!activeQ.trim()) return [];
      let query = supabase
        .from("products")
        .select("*, categories(name, slug)")
        .or(`name.ilike.%${activeQ}%,categories.name.ilike.%${activeQ}%`)
        .limit(40);
      if (sort === "price_asc") query = query.order("discount_price", { ascending: true, nullsFirst: false });
      else if (sort === "price_desc") query = query.order("discount_price", { ascending: false, nullsFirst: false });
      else if (sort === "newest") query = query.order("created_at", { ascending: false });
      const { data } = await query;
      return data ?? [];
    },
    enabled: activeQ.trim().length > 0,
  });

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const term = q.trim();
    navigate({ to: "/search", search: { q: term } as never, replace: true });
    setActiveQ(term);
    if (term) {
      try {
        const recent = JSON.parse(localStorage.getItem("ach_recent") || "[]");
        localStorage.setItem("ach_recent", JSON.stringify([term, ...recent.filter((r: string) => r !== term)].slice(0, 6)));
      } catch { /* ignore */ }
    }
  };

  return (
    <div className="mx-auto max-w-md px-4 pt-2">
      <form onSubmit={submit} className="mt-1 flex items-center gap-2 rounded-full border border-border bg-card px-4 py-2.5 shadow-card">
        <Search className="h-4 w-4 text-muted-foreground" />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          autoFocus
          placeholder="Search resin, yarn, brushes…"
          className="flex-1 bg-transparent text-sm outline-none"
        />
        {q && (
          <button type="button" onClick={() => setQ("")} className="text-xs text-muted-foreground hover:underline">Clear</button>
        )}
      </form>

      {activeQ && products && products.length > 0 && (
        <div className="mt-3 flex items-center justify-between px-1">
          <span className="text-xs text-muted-foreground">{products.length} results for “{activeQ}”</span>
          <div className="flex items-center gap-1">
            <SlidersHorizontal className="h-3.5 w-3.5 text-muted-foreground" />
            <select
              value={sort}
              onChange={(e) => setSort(e.target.value as SortKey)}
              className="rounded-full border border-border bg-card px-2 py-1 text-xs outline-none"
            >
              {SORT_OPTIONS.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
            </select>
          </div>
        </div>
      )}

      {activeQ && !isLoading && products && products.length === 0 && (
        <div className="py-16 text-center">
          <div className="mx-auto mb-4 grid h-16 w-16 place-items-center rounded-full bg-primary-soft">
            <Search className="h-7 w-7 text-primary-foreground" />
          </div>
          <h2 className="font-display text-lg">No results for “{activeQ}”</h2>
          <p className="mt-1 text-sm text-muted-foreground">Try a different keyword or browse categories.</p>
          <ButtonLink to="/categories" label="Browse categories" />
        </div>
      )}

      {!activeQ && (
        <div className="py-16 text-center">
          <h2 className="font-display text-lg">Search craft supplies</h2>
          <p className="mt-1 text-sm text-muted-foreground">Resin, yarn, paints, kits and more.</p>
        </div>
      )}

      {activeQ && products && products.length > 0 && (
        <div className="mt-4 grid grid-cols-2 gap-3 pb-6">
          {products.map((p) => <ProductCard key={p.id} product={p} />)}
        </div>
      )}
    </div>
  );
}

function ButtonLink({ to, label }: { to: "/categories" | "/"; label: string }) {
  return (
    <Link to={to} className={cn("mt-4 inline-block rounded-full bg-primary px-6 py-2.5 text-sm font-medium text-primary-foreground shadow-soft transition hover:opacity-90")}>
      {label}
    </Link>
  );
}
