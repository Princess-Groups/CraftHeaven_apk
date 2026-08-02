import { Link } from "@tanstack/react-router";
import { Home, LayoutGrid, Heart, ShoppingBag, Package, User } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";

type Tab = { to: string; label: string; icon: typeof Home; exact?: boolean; badge?: "cart" };
const tabs: Tab[] = [
  { to: "/", label: "Home", icon: Home, exact: true },
  { to: "/categories", label: "Categories", icon: LayoutGrid },
  { to: "/wishlist", label: "Wishlist", icon: Heart },
  { to: "/cart", label: "Cart", icon: ShoppingBag, badge: "cart" },
  { to: "/orders", label: "Orders", icon: Package },
  { to: "/profile", label: "Profile", icon: User },
];

export function BottomNav() {
  const { data: session } = useQuery({
    queryKey: ["session"],
    queryFn: async () => (await supabase.auth.getSession()).data.session,
  });
  const { data: cartCount } = useQuery({
    queryKey: ["cart-count", session?.user.id],
    queryFn: async () => {
      if (!session) return 0;
      const { count } = await supabase.from("carts").select("*", { count: "exact", head: true }).eq("user_id", session.user.id);
      return count ?? 0;
    },
    enabled: !!session,
  });

  return (
    <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-border/60 bg-background/90 backdrop-blur-xl pb-[env(safe-area-inset-bottom)]">
      <ul className="mx-auto grid max-w-md grid-cols-6">
        {tabs.map((t) => {
          const Icon = t.icon;
          return (
            <li key={t.to}>
              <Link
                to={t.to}
                activeOptions={{ exact: t.exact ?? false }}
                className="group relative flex flex-col items-center gap-0.5 py-2 text-[10px] font-medium text-muted-foreground transition"
                activeProps={{ className: "flex flex-col items-center gap-0.5 py-2 text-[10px] font-medium text-primary" }}
              >
                <span className={cn(
                  "relative grid h-8 w-8 place-items-center rounded-full transition",
                  "group-[.text-primary]:bg-primary-soft"
                )}>
                  <Icon className="h-[18px] w-[18px]" />
                  {t.badge === "cart" && cartCount ? (
                    <span className="absolute -right-1 -top-1 grid h-4 min-w-4 place-items-center rounded-full bg-secondary px-1 text-[9px] font-bold text-secondary-foreground">
                      {cartCount}
                    </span>
                  ) : null}
                </span>
                <span>{t.label}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
