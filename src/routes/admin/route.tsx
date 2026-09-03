import {
  createFileRoute,
  Outlet,
  redirect,
  Link,
  useRouterState,
  useNavigate,
} from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  ShoppingCart,
  ScanBarcode,
  ClipboardList,
  Tags,
  Warehouse,
  BarChart3,
  UserCog,
  Settings,
  Bell,
  LogOut,
  Menu,
  X,
} from "lucide-react";
import { useState } from "react";
const logoUrl = "/ach-logo.png";

export const Route = createFileRoute("/admin")({
  ssr: false,
  beforeLoad: async ({ location }) => {
    if (location.pathname === "/admin/login") return {};
    const { data: userRes } = await supabase.auth.getUser();
    if (!userRes.user) throw redirect({ to: "/admin/login" });
    const { data: roles } = await supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", userRes.user.id);
    const allowed = roles?.some((r) => r.role === "admin" || r.role === "staff");
    if (!allowed) throw redirect({ to: "/admin/login" });
    const isAdmin = roles?.some((r) => r.role === "admin") ?? false;
    const isStaff = roles?.some((r) => r.role === "staff") ?? false;
    // Staff can only access billing
    if (isStaff && !isAdmin && location.pathname !== "/admin/billing" && location.pathname !== "/admin/login") {
      throw redirect({ to: "/admin/billing" });
    }
    return { user: userRes.user, isAdmin, isStaff };
  },
  component: AdminLayout,
});

const NAV: { to: string; label: string; icon: React.ElementType; exact?: boolean }[] = [
  { to: "/admin/purchases", label: "Purchase Entry", icon: ShoppingCart, exact: true },
  { to: "/admin/billing", label: "Billing", icon: ScanBarcode },
  { to: "/admin/orders", label: "Orders", icon: ClipboardList },
  { to: "/admin/categories", label: "Categories", icon: Tags },
  { to: "/admin/inventory", label: "Inventory", icon: Warehouse },
  { to: "/admin/reports", label: "Reports & Analytics", icon: BarChart3 },
  { to: "/admin/users", label: "Users / Staff", icon: UserCog },
  { to: "/admin/settings", label: "Settings", icon: Settings },
];

function AdminLayout() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const { isAdmin } = Route.useRouteContext();

  // Staff only sees Billing; admin sees everything
  const visibleNav = isAdmin ? NAV : NAV.filter((n) => n.to === "/admin/billing");

  // Always call the hook - just disable it on login page
  const { data: notifCount } = useQuery({
    queryKey: ["admin-notif-count"],
    queryFn: async () => {
      const { count } = await supabase
        .from("admin_notifications")
        .select("*", { count: "exact", head: true })
        .eq("is_read", false);
      return count ?? 0;
    },
    refetchInterval: 30000,
    enabled: pathname !== "/admin/login",
  });

  if (pathname === "/admin/login") return <Outlet />;

  async function signOut() {
    await supabase.auth.signOut();
    toast.success("Signed out");
    navigate({ to: "/admin/login" });
  }

  return (
    <div className="min-h-screen bg-muted text-foreground">
      <aside
        className={`fixed inset-y-0 left-0 z-40 w-64 border-r border-border bg-card transition-transform lg:translate-x-0 ${open ? "translate-x-0" : "-translate-x-full"}`}
      >
        <div className="flex items-center gap-3 border-b border-border px-5 py-4">
          <img src={logoUrl} alt="ACH" className="h-9 w-9 rounded-full ring-1 ring-secondary" />
          <div className="leading-tight">
            <div className="text-[13px] font-bold text-foreground">ACH Admin</div>
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
              Billing Software
            </div>
          </div>
          <button
            onClick={() => setOpen(false)}
            className="ml-auto lg:hidden text-muted-foreground"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        <nav className="p-2 overflow-y-auto h-[calc(100vh-64px)]">
          {visibleNav.map((n) => {
            const Icon = n.icon;
            const active = n.exact
              ? pathname === n.to
              : pathname === n.to || pathname.startsWith(n.to + "/");
            return (
              <Link
                key={n.to}
                to={n.to}
                onClick={() => setOpen(false)}
                className={`flex items-center gap-3 rounded-lg px-3 py-2 text-[13px] font-medium mb-0.5 transition ${
                  active
                    ? "bg-secondary/15 text-secondary-foreground border-l-2 border-secondary"
                    : "text-muted-foreground hover:bg-secondary-soft hover:text-foreground"
                }`}
              >
                <Icon
                  className={`h-4 w-4 ${active ? "text-secondary" : "text-muted-foreground"}`}
                />
                {n.label}
              </Link>
            );
          })}
        </nav>
      </aside>

      <div className="lg:pl-64">
        <header className="sticky top-0 z-30 flex items-center gap-3 border-b border-border bg-card/90 px-4 py-3 backdrop-blur">
          <button onClick={() => setOpen(true)} className="lg:hidden text-muted-foreground">
            <Menu className="h-5 w-5" />
          </button>
          <div className="flex-1">
            <div className="text-xs text-muted-foreground">Athira's Creative Haven</div>
            <div className="text-sm font-semibold text-foreground">
              Billing & Inventory Management
            </div>
          </div>
          <Link
            to="/admin/inventory"
            className="relative grid h-9 w-9 place-items-center rounded-full bg-primary-soft hover:bg-secondary-soft"
          >
            <Bell className="h-4 w-4 text-foreground" />
            {notifCount ? (
              <span className="absolute -top-1 -right-1 h-4 min-w-4 rounded-full bg-primary px-1 text-[9px] font-bold text-white grid place-items-center">
                {notifCount}
              </span>
            ) : null}
          </Link>
          <button
            onClick={signOut}
            className="flex items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-1.5 text-xs font-semibold text-foreground hover:bg-secondary-soft"
          >
            <LogOut className="h-3.5 w-3.5 text-secondary" /> Logout
          </button>
        </header>
        <main className="p-4 lg:p-6">
          <Outlet />
        </main>
      </div>

      {open && (
        <div
          className="fixed inset-0 z-30 bg-primary/40 lg:hidden"
          onClick={() => setOpen(false)}
        />
      )}
    </div>
  );
}
