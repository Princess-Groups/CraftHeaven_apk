import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { ProductCard } from "@/components/product-card";
import { Sparkles, Flame, Gift, Palette, Wand2, ChevronRight, Timer } from "lucide-react";
import logoAsset from "@/assets/ach-logo.png.asset.json";
import { useEffect, useState } from "react";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Athira's Creative Haven — Craft Supplies & Creative Classes" },
      { name: "description", content: "Shop resin art, crochet, yarn, painting, DIY kits, jewellery making and creative classes at Athira's Creative Haven." },
      { property: "og:title", content: "Athira's Creative Haven" },
      { property: "og:description", content: "Craft Supplies & Creative Classes." },
    ],
  }),
  component: Home,
});

const HERO_SLIDES = [
  {
    tag: "New Season",
    title: "Bloom into\nresin artistry",
    sub: "Kits, moulds & shimmer pigments",
    cta: "Shop Resin Art",
    to: "/category/$slug",
    slug: "resin-art",
    grad: "from-primary via-blush to-secondary",
  },
  {
    tag: "Learn with us",
    title: "Weekend\ncrochet classes",
    sub: "Beginner batches now open",
    cta: "Join a class",
    to: "/category/$slug",
    slug: "creative-classes",
    grad: "from-secondary via-blush to-primary",
  },
  {
    tag: "Handpicked",
    title: "Gifts made\nby real hands",
    sub: "Wrapped with love from Athira",
    cta: "Shop Gifts",
    to: "/category/$slug",
    slug: "handmade-gifts",
    grad: "from-blush via-primary to-secondary",
  },
];

function HeroSlider() {
  const [i, setI] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setI((v) => (v + 1) % HERO_SLIDES.length), 4200);
    return () => clearInterval(t);
  }, []);
  return (
    <section className="px-4 pt-3">
      <div className="relative overflow-hidden rounded-3xl">
        <div className="flex transition-transform duration-700" style={{ transform: `translateX(-${i * 100}%)` }}>
          {HERO_SLIDES.map((s) => (
            <div key={s.slug} className={`min-w-full bg-gradient-to-br ${s.grad} p-6`}>
              <div className="relative flex min-h-[190px] flex-col">
                <span className="inline-flex w-fit items-center gap-1 rounded-full glass-panel px-3 py-1 text-[10px] font-semibold uppercase tracking-wider text-foreground">
                  <Sparkles className="h-3 w-3" /> {s.tag}
                </span>
                <h2 className="mt-3 whitespace-pre-line font-display text-3xl font-semibold leading-[1.05] text-foreground">
                  {s.title}
                </h2>
                <p className="mt-2 text-sm text-foreground/80">{s.sub}</p>
                <Link
                  to={s.to}
                  params={{ slug: s.slug }}
                  className="mt-auto inline-flex w-fit items-center gap-1 rounded-full bg-foreground px-4 py-2 text-xs font-semibold text-background shadow-soft"
                >
                  {s.cta} <ChevronRight className="h-3.5 w-3.5" />
                </Link>
                <div className="pointer-events-none absolute -right-6 -top-6 h-28 w-28 rounded-full bg-background/25 blur-2xl" />
                <div className="pointer-events-none absolute -bottom-8 right-6 h-24 w-24 rounded-full bg-background/20 blur-2xl" />
              </div>
            </div>
          ))}
        </div>
        <div className="absolute inset-x-0 bottom-2 flex justify-center gap-1.5">
          {HERO_SLIDES.map((_, idx) => (
            <span key={idx} className={`h-1.5 rounded-full transition-all ${idx === i ? "w-6 bg-foreground" : "w-1.5 bg-foreground/40"}`} />
          ))}
        </div>
      </div>
    </section>
  );
}

function SectionHeader({ icon: Icon, title, hint, to, slug }: { icon: any; title: string; hint?: string; to?: string; slug?: string }) {
  return (
    <div className="mb-3 flex items-end justify-between px-4">
      <div className="flex items-center gap-2">
        <div className="grid h-8 w-8 place-items-center rounded-full bg-primary-soft"><Icon className="h-4 w-4 text-primary" /></div>
        <div>
          <h3 className="font-display text-[17px] font-semibold leading-tight">{title}</h3>
          {hint ? <p className="text-[11px] text-muted-foreground">{hint}</p> : null}
        </div>
      </div>
      {to && slug ? (
        <Link to="/category/$slug" params={{ slug }} className="text-xs font-medium text-secondary">See all</Link>
      ) : (
        <Link to="/categories" className="text-xs font-medium text-secondary">See all</Link>
      )}
    </div>
  );
}

function Rail({ children }: { children: React.ReactNode }) {
  return (
    <div className="no-scrollbar flex gap-3 overflow-x-auto px-4 pb-1">
      {children}
    </div>
  );
}

function FlashSale({ products }: { products: any[] }) {
  const [t, setT] = useState({ h: 5, m: 42, s: 18 });
  useEffect(() => {
    const id = setInterval(() => {
      setT(({ h, m, s }) => {
        let ns = s - 1, nm = m, nh = h;
        if (ns < 0) { ns = 59; nm -= 1; }
        if (nm < 0) { nm = 59; nh -= 1; }
        if (nh < 0) { nh = 0; nm = 0; ns = 0; }
        return { h: nh, m: nm, s: ns };
      });
    }, 1000);
    return () => clearInterval(id);
  }, []);
  const pad = (n: number) => String(n).padStart(2, "0");
  if (!products?.length) return null;
  return (
    <section className="mt-6">
      <div className="mx-4 rounded-3xl bg-gradient-to-br from-primary via-blush to-secondary-soft p-4 shadow-soft">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Flame className="h-5 w-5 text-foreground" />
            <h3 className="font-display text-lg font-semibold">Flash Sale</h3>
          </div>
          <div className="flex items-center gap-1 rounded-full bg-foreground px-3 py-1 text-[11px] font-semibold text-background">
            <Timer className="h-3 w-3" /> {pad(t.h)}:{pad(t.m)}:{pad(t.s)}
          </div>
        </div>
        <div className="no-scrollbar mt-3 flex gap-3 overflow-x-auto">
          {products.slice(0, 6).map((p) => (
            <div key={p.id} className="w-[135px] shrink-0">
              <ProductCard product={p} />
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function Home() {
  const { data: categories } = useQuery({
    queryKey: ["categories"],
    queryFn: async () => (await supabase.from("categories").select("*").order("name")).data ?? [],
  });
  const { data: trending } = useQuery({
    queryKey: ["products-trending"],
    queryFn: async () => (await supabase.from("products").select("*").eq("is_trending", true).limit(10)).data ?? [],
  });
  const { data: newArrivals } = useQuery({
    queryKey: ["products-new"],
    queryFn: async () => (await supabase.from("products").select("*").eq("is_new", true).order("created_at", { ascending: false }).limit(10)).data ?? [],
  });
  const { data: allProducts } = useQuery({
    queryKey: ["products-all"],
    queryFn: async () => (await supabase.from("products").select("*").limit(20)).data ?? [],
  });

  const featured = (categories ?? []).slice(0, 4);
  const scrollCats = categories ?? [];

  return (
    <div className="mx-auto max-w-md">
      <HeroSlider />

      {/* Featured Categories */}
      {featured.length > 0 && (
        <section className="mt-6">
          <SectionHeader icon={Palette} title="Featured Categories" hint="Curated for you" />
          <div className="grid grid-cols-2 gap-3 px-4">
            {featured.map((c, idx) => (
              <Link
                key={c.id}
                to="/category/$slug"
                params={{ slug: c.slug }}
                className="group relative overflow-hidden rounded-2xl shadow-card"
              >
                <img src={c.image_url ?? ""} alt={c.name} className="aspect-[5/4] w-full object-cover transition duration-500 group-hover:scale-105" />
                <div className={`absolute inset-0 bg-gradient-to-t ${idx % 2 === 0 ? "from-primary/70" : "from-secondary/70"} via-transparent to-transparent`} />
                <div className="absolute inset-x-2 bottom-2 rounded-xl glass-panel px-3 py-1.5">
                  <div className="text-[13px] font-semibold">{c.name}</div>
                </div>
              </Link>
            ))}
          </div>
        </section>
      )}

      {/* Shop by Category — horizontal chips */}
      <section className="mt-6">
        <SectionHeader icon={Wand2} title="Shop by Category" />
        <div className="no-scrollbar flex gap-3 overflow-x-auto px-4 pb-1">
          {scrollCats.map((c) => (
            <Link
              key={c.id}
              to="/category/$slug"
              params={{ slug: c.slug }}
              className="flex w-[80px] shrink-0 flex-col items-center gap-1.5"
            >
              <div className="grid h-[74px] w-[74px] place-items-center rounded-2xl bg-gradient-to-br from-primary-soft to-secondary-soft p-1 shadow-card">
                <div className="h-full w-full overflow-hidden rounded-xl bg-card">
                  {c.image_url ? <img src={c.image_url} alt={c.name} className="h-full w-full object-cover" /> : null}
                </div>
              </div>
              <span className="line-clamp-2 text-center text-[11px] font-medium leading-tight">{c.name}</span>
            </Link>
          ))}
        </div>
      </section>

      {/* Exclusive Offers banner */}
      <section className="mt-6 px-4">
        <div className="relative overflow-hidden rounded-3xl bg-gradient-to-r from-secondary to-secondary-soft p-5 shadow-card">
          <div className="relative z-10 max-w-[65%]">
            <span className="inline-flex items-center gap-1 rounded-full bg-background/70 px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-secondary">
              <Gift className="h-3 w-3" /> Exclusive
            </span>
            <h3 className="mt-2 font-display text-lg font-semibold leading-tight text-secondary-foreground">
              Flat 20% off on your first creative kit
            </h3>
            <p className="mt-1 text-[11px] text-secondary-foreground/85">Use code BLOOM20 at checkout</p>
          </div>
          <div className="pointer-events-none absolute -right-4 -top-4 h-28 w-28 rounded-full bg-blush/70 blur-xl" />
        </div>
      </section>

      {/* New Arrivals */}
      {newArrivals && newArrivals.length > 0 && (
        <section className="mt-6">
          <SectionHeader icon={Sparkles} title="New Arrivals" hint="Fresh from the studio" />
          <Rail>
            {newArrivals.map((p) => (
              <div key={p.id} className="w-[150px] shrink-0"><ProductCard product={p} /></div>
            ))}
          </Rail>
        </section>
      )}

      {/* Flash Sale */}
      <FlashSale products={trending ?? []} />

      {/* Best Sellers */}
      {trending && trending.length > 0 && (
        <section className="mt-6">
          <SectionHeader icon={Flame} title="Best Sellers" hint="Loved by makers" />
          <Rail>
            {trending.map((p) => (
              <div key={p.id} className="w-[150px] shrink-0"><ProductCard product={p} /></div>
            ))}
          </Rail>
        </section>
      )}

      {/* Creative Kits */}
      <section className="mt-6">
        <SectionHeader icon={Gift} title="Creative Kits" to="/category/$slug" slug="diy-kits" />
        <Rail>
          {(allProducts ?? []).slice(0, 8).map((p) => (
            <div key={p.id} className="w-[150px] shrink-0"><ProductCard product={p} /></div>
          ))}
        </Rail>
      </section>

      {/* Handmade Products */}
      <section className="mt-6">
        <SectionHeader icon={Palette} title="Handmade Products" to="/category/$slug" slug="handmade-gifts" />
        <div className="grid grid-cols-2 gap-3 px-4">
          {(allProducts ?? []).slice(0, 4).map((p) => (
            <ProductCard key={p.id} product={p} />
          ))}
        </div>
      </section>

      {/* DIY Supplies */}
      <section className="mt-6">
        <SectionHeader icon={Wand2} title="DIY Supplies" to="/category/$slug" slug="diy-kits" />
        <Rail>
          {(allProducts ?? []).slice(4, 12).map((p) => (
            <div key={p.id} className="w-[150px] shrink-0"><ProductCard product={p} /></div>
          ))}
        </Rail>
      </section>

      {/* Art Materials */}
      <section className="mt-6">
        <SectionHeader icon={Palette} title="Art Materials" to="/category/$slug" slug="painting" />
        <Rail>
          {(allProducts ?? []).slice(8, 16).map((p) => (
            <div key={p.id} className="w-[150px] shrink-0"><ProductCard product={p} /></div>
          ))}
        </Rail>
      </section>

      {/* Recommended */}
      <section className="mt-6">
        <SectionHeader icon={Sparkles} title="Recommended For You" hint="Based on your vibe" />
        <div className="grid grid-cols-2 gap-3 px-4">
          {(allProducts ?? []).slice(0, 6).map((p) => (
            <ProductCard key={p.id} product={p} />
          ))}
        </div>
      </section>

      <footer className="mt-10 px-6 pb-4 text-center text-[11px] leading-relaxed text-muted-foreground">
        <img src={logoAsset.url} alt="Athira's Creative Haven" className="mx-auto mb-3 h-16 w-16 rounded-full object-cover shadow-soft ring-1 ring-primary/20" />
        <div className="mb-1 font-display text-sm text-foreground">Athira's Creative Haven</div>
        Craft Supplies & Creative Classes · Made with love
      </footer>
    </div>
  );
}
