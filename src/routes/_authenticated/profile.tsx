import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { User, MapPin, Heart, Package, Bell, HelpCircle, Info, Shield, LogOut, ChevronRight, Gift, Sparkles } from "lucide-react";

export const Route = createFileRoute("/_authenticated/profile")({
  component: ProfilePage,
});

function ProfilePage() {
  const { user } = Route.useRouteContext();
  const router = useRouter();
  const { data: profile } = useQuery({
    queryKey: ["profile", user.id],
    queryFn: async () => (await supabase.from("profiles").select("*").eq("id", user.id).maybeSingle()).data,
  });

  const items: { label: string; icon: any; to?: string; onClick?: () => void; tone?: "danger" }[] = [
    { label: "Edit Profile", icon: User, to: "/profile" },
    { label: "Saved Addresses", icon: MapPin, to: "/addresses" },
    { label: "Wishlist", icon: Heart, to: "/wishlist" },
    { label: "My Orders", icon: Package, to: "/orders" },
    { label: "Notifications", icon: Bell },
    { label: "Refer & Earn", icon: Gift },
    { label: "Help & Support", icon: HelpCircle },
    { label: "About Us", icon: Info },
    { label: "Privacy Policy", icon: Shield },
  ];

  return (
    <div className="mx-auto max-w-md">
      <section className="relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-[#9DB8A0] via-[#C8D8C5] to-[#E8EFE5]" />
        <div className="pointer-events-none absolute -right-6 -top-8 h-32 w-32 rounded-full bg-background/25 blur-2xl" />
        <div className="relative flex items-center gap-4 px-5 pb-8 pt-6">
          <div className="grid h-16 w-16 place-items-center rounded-full bg-background text-2xl font-display font-semibold text-primary shadow-soft">
            {(profile?.full_name || user.email || "A").charAt(0).toUpperCase()}
          </div>
          <div className="min-w-0 flex-1">
            <div className="font-display text-lg font-semibold leading-tight">
              {profile?.full_name || "Craft Lover"}
            </div>
            <div className="truncate text-xs text-foreground/80">{user.email}</div>
            <div className="mt-1 inline-flex items-center gap-1 rounded-full glass-panel px-2 py-0.5 text-[10px] font-semibold">
              <Sparkles className="h-3 w-3 text-primary" /> Haven Member
            </div>
          </div>
        </div>
      </section>

      <section className="mt-4 px-4">
        <div className="grid grid-cols-3 gap-2 rounded-2xl bg-card p-3 shadow-card">
          <Link to="/orders" className="flex flex-col items-center gap-1 py-1">
            <Package className="h-5 w-5 text-primary" />
            <span className="text-[11px] font-medium">Orders</span>
          </Link>
          <Link to="/wishlist" className="flex flex-col items-center gap-1 py-1">
            <Heart className="h-5 w-5 text-primary" />
            <span className="text-[11px] font-medium">Wishlist</span>
          </Link>
          <Link to="/addresses" className="flex flex-col items-center gap-1 py-1">
            <MapPin className="h-5 w-5 text-primary" />
            <span className="text-[11px] font-medium">Addresses</span>
          </Link>
        </div>
      </section>

      <section className="mt-4 px-4">
        <div className="overflow-hidden rounded-2xl bg-card shadow-card">
          {items.map((it, idx) => {
            const Icon = it.icon;
            const inner = (
              <div className={`flex items-center gap-3 px-4 py-3 ${idx !== items.length - 1 ? "border-b border-border/60" : ""}`}>
                <div className="grid h-9 w-9 place-items-center rounded-full bg-primary-soft">
                  <Icon className="h-4 w-4 text-primary" />
                </div>
                <span className="flex-1 text-sm font-medium">{it.label}</span>
                <ChevronRight className="h-4 w-4 text-muted-foreground" />
              </div>
            );
            return it.to ? (
              <Link key={it.label} to={it.to as never}>{inner}</Link>
            ) : (
              <button key={it.label} type="button" className="block w-full text-left">{inner}</button>
            );
          })}
        </div>
      </section>

      <section className="mt-4 px-4">
        <Link to="/admin/login" className="flex items-center justify-between rounded-2xl bg-gradient-to-r from-secondary/15 to-primary/10 border border-secondary/30 px-4 py-3 shadow-card">
          <div className="flex items-center gap-3">
            <div className="grid h-9 w-9 place-items-center rounded-full bg-secondary text-white"><Shield className="h-4 w-4" /></div>
            <div>
              <div className="text-sm font-semibold">Admin & Billing Login</div>
              <div className="text-[10px] text-muted-foreground">Staff-only POS & inventory portal</div>
            </div>
          </div>
          <ChevronRight className="h-4 w-4 text-muted-foreground" />
        </Link>
      </section>

      <section className="mt-4 px-4 pb-6">
        <button
          onClick={async () => { await supabase.auth.signOut(); router.navigate({ to: "/", replace: true }); }}
          className="flex w-full items-center justify-center gap-2 rounded-2xl border border-destructive/40 bg-card px-4 py-3 text-sm font-semibold text-destructive shadow-card"
        >
          <LogOut className="h-4 w-4" /> Logout
        </button>
        <p className="mt-4 text-center text-[10px] text-muted-foreground">Athira's Creative Haven · v1.0</p>
      </section>

    </div>
  );
}
