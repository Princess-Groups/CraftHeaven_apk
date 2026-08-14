import { createFileRoute, Outlet, redirect, Link, useRouterState, useNavigate } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  LayoutDashboard, ScanBarcode, ShoppingCart, PackageOpen, Boxes, Tags, Layers,
  Truck, Users, ClipboardList, Warehouse, BarChart3, LineChart, UserCog, Settings,
  Bell, LogOut, Menu, X,
} from "lucide-react";
import { useState } from "react";
const logoUrl = "/ach-logo.png";

export const Route = createFileRoute("/admin")({
  ssr: false,
  beforeLoad: async ({ location }) => {
    if (location.pathname === "/admin/login") return {};
    const { data: userRes } = await supabase.auth.getUser();
    if (!userRes.user) throw redirect({ to: "/admin/login" });
    const { data: roles } = await supabase.from("user_roles").select("role").eq("user_id", userRes.user.id);
    const allowed = roles?.some((r) => r.role === "admin" || r.role === "staff");
    if (!allowed) throw redirect({ to: "/admin/login" });
    return { user: userRes.user, isAdmin: roles?.some((r) => r.role === "admin") ?? false };
  },
  component: AdminLayout,
});

const NAV: { to: string; label: string; icon: React.ElementType; exact?: boolean }[] = [
  { to: "/admin", label: "Dashboard", icon: LayoutDashboard, exact: true },
  { to: "/admin/pos", label: "Billing (POS)", icon: ScanBarcode },
  { to: "/admin/purchases", label: "Purchase Entry", icon: ShoppingCart },
  { to: "/admin/products", label: "Products", icon: PackageOpen },
  { to: "/admin/categories", label: "Categories", icon: Tags },
  { to: "/admin/brands", label: "Brands", icon: Layers },
  { to: "/admin/suppliers", label: "Suppliers", icon: Truck },
  { to: "/admin/customers", label: "Customers", icon: Users },
  { to: "/admin/orders", label: "Orders", icon: ClipboardList },
  { to: "/admin/inventory", label: "Inventory", icon: Warehouse },
  { to: "/admin/reports", label: "Reports", icon: BarChart3 },
  { to: "/admin/analytics", label: "Analytics", icon: LineChart },
  { to: "/admin/users", label: "Users & Staff", icon: UserCog },
  { to: "/admin/settings", label: "Settings", icon: Settings },
];


function AdminLayout() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);

  if (pathname === "/admin/login") return <Outlet />;

  const { data: notifCount } = useQuery({
    queryKey: ["admin-notif-count"],
    queryFn: async () => {
      const { count } = await supabase.from("admin_notifications").select("*", { count: "exact", head: true }).eq("is_read", false);
      return count ?? 0;
    },
    refetchInterval: 30000,
  });

  async function signOut() {
    await supabase.auth.signOut();
    toast.success("Signed out");
    navigate({ to: "/admin/login" });
  }

  return (
    <div className="min-h-screen bg-slate-50 text-slate-800">
      <aside className={`fixed inset-y-0 left-0 z-40 w-64 border-r border-slate-200 bg-white transition-transform lg:translate-x-0 ${open ? "translate-x-0" : "-translate-x-full"}`}>
        <div className="flex items-center gap-3 border-b border-slate-100 px-5 py-4">
          <img src={logoUrl} alt="ACH" className="h-9 w-9 rounded-full ring-1 ring-slate-200" />
          <div className="leading-tight">
            <div className="text-[13px] font-bold text-slate-900">ACH Admin</div>
            <div className="text-[10px] uppercase tracking-wider text-slate-500">Billing Software</div>
          </div>
          <button onClick={() => setOpen(false)} className="ml-auto lg:hidden text-slate-400"><X className="h-5 w-5" /></button>
        </div>
        <nav className="p-2 overflow-y-auto h-[calc(100vh-64px)]">
          {NAV.map((n) => {
            const Icon = n.icon;
            const active = n.exact ? pathname === n.to : pathname === n.to || pathname.startsWith(n.to + "/");
            return (
              <Link key={n.to} to={n.to} onClick={() => setOpen(false)}
                className={`flex items-center gap-3 rounded-lg px-3 py-2 text-[13px] font-medium mb-0.5 transition ${
                  active ? "bg-secondary/15 text-secondary-foreground border-l-2 border-secondary" : "text-slate-600 hover:bg-slate-100"
                }`}>
                <Icon className={`h-4 w-4 ${active ? "text-secondary" : "text-slate-400"}`} />
                {n.label}
              </Link>
            );
          })}
        </nav>
      </aside>

      <div className="lg:pl-64">
        <header className="sticky top-0 z-30 flex items-center gap-3 border-b border-slate-200 bg-white/90 px-4 py-3 backdrop-blur">
          <button onClick={() => setOpen(true)} className="lg:hidden text-slate-500"><Menu className="h-5 w-5" /></button>
          <div className="flex-1">
            <div className="text-xs text-slate-500">Athira's Creative Haven</div>
            <div className="text-sm font-semibold text-slate-900">Billing & Inventory Management</div>
          </div>
          <button className="relative grid h-9 w-9 place-items-center rounded-full bg-slate-100 hover:bg-slate-200">
            <Bell className="h-4 w-4 text-slate-600" />
            {notifCount ? (
              <span className="absolute -top-1 -right-1 h-4 min-w-4 rounded-full bg-primary px-1 text-[9px] font-bold text-white grid place-items-center">{notifCount}</span>
            ) : null}
          </button>
          <button onClick={signOut} className="flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50">
            <LogOut className="h-3.5 w-3.5" /> Logout
          </button>
        </header>
        <main className="p-4 lg:p-6"><Outlet /></main>
      </div>

      {open && <div className="fixed inset-0 z-30 bg-slate-900/40 lg:hidden" onClick={() => setOpen(false)} />}
    </div>
  );
}
