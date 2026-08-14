import { Link, useNavigate } from "@tanstack/react-router";
import { Search, Bell } from "lucide-react";
import { useState } from "react";
const logoUrl = "/ach-logo.png";

export function SiteHeader() {
  const [q, setQ] = useState("");
  const navigate = useNavigate();
  return (
    <header className="sticky top-0 z-30 border-b border-border/50 bg-background/85 backdrop-blur-xl">
      <div className="mx-auto flex max-w-md items-center gap-2 px-4 py-3">
        <Link to="/" className="flex items-center gap-2">
          <img
            src={logoUrl}
            alt="Athira's Creative Haven logo"
            className="h-11 w-11 rounded-full object-cover shadow-soft ring-1 ring-primary/20"
          />
          <div className="leading-tight">
            <div className="font-display text-[13px] font-semibold tracking-wide text-primary">ATHIRA'S</div>
            <div className="-mt-0.5 text-[10px] uppercase tracking-[0.18em] text-secondary">Creative Haven</div>
          </div>
        </Link>
        <button
          onClick={() => navigate({ to: "/categories" })}
          className="ml-auto grid h-10 w-10 place-items-center rounded-full bg-primary-soft text-foreground"
          aria-label="Notifications"
        >
          <Bell className="h-[18px] w-[18px]" />
        </button>
      </div>
      <div className="mx-auto max-w-md px-4 pb-3">
        <form
          onSubmit={(e) => { e.preventDefault(); if (q.trim()) navigate({ to: "/search", search: { q: q.trim() } as never }); }}
          className="flex items-center gap-2 rounded-full border border-border/70 bg-card px-4 py-2.5 shadow-card"
        >
          <Search className="h-4 w-4 text-muted-foreground" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search resin, yarn, brushes…"
            className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          />
        </form>
      </div>
    </header>
  );
}
