"use client";

import { type ReactNode, useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Backpack,
  ChevronLeft,
  ChevronRight,
  ChevronRightIcon,
  Code,
  Coins,
  Globe,
  Hammer,
  Home,
  Layers,
  LayoutDashboard,
  LogOut,
  Medal,
  MoreHorizontal,
  Settings,
  Shirt,
  Store,
  Trophy,
  UserCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { useAuth } from "@/hooks/useAuth";
import { getMyWallet, type WalletOut } from "@/lib/api";
import { cn } from "@/lib/utils";
import dynamic from "next/dynamic";

const TargetCursor = dynamic(() => import("@/components/TargetCursor"), { ssr: false });

// ---------------------------------------------------------------------------
// Nav item definitions
// ---------------------------------------------------------------------------

interface NavItem {
  href: string;
  label: string;
  icon: ReactNode;
  matchExact?: boolean;
}

const ACTION_ITEMS: NavItem[] = [
  {
    href: "/dashboard",
    label: "Panel",
    icon: <LayoutDashboard size={18} />,
    matchExact: true,
  },
  {
    href: "/leaderboard",
    label: "Ranking",
    icon: <Medal size={18} />,
    matchExact: true,
  },
];

const ECONOMY_ITEMS: NavItem[] = [
  { href: "/inventory", label: "Ekwipunek", icon: <Backpack size={18} /> },
  { href: "/cosmetics", label: "Kosmetyki", icon: <Shirt size={18} /> },
  { href: "/decks", label: "Talia", icon: <Layers size={18} /> },
  { href: "/marketplace", label: "Rynek", icon: <Store size={18} /> },
  { href: "/crafting", label: "Kuźnia", icon: <Hammer size={18} /> },
];

const OTHER_ITEMS: NavItem[] = [
  { href: "/developers", label: "Deweloperzy", icon: <Code size={18} /> },
];

// ---------------------------------------------------------------------------
// Profile popover (click on avatar → submenu with profile/settings/logout)
// ---------------------------------------------------------------------------

function ProfilePopover({
  user,
  wallet,
  collapsed,
  onLogout,
}: {
  user: { username: string; elo_rating: number; email: string };
  wallet: WalletOut | null;
  collapsed: boolean;
  onLogout: () => void;
}) {
  const [open, setOpen] = useState(false);
  const initial = user.username.charAt(0).toUpperCase();

  return (
    <div>
      {/* Trigger — avatar + name */}
      <button
        onClick={() => setOpen(!open)}
        className={cn(
          "flex w-full items-center gap-2.5 rounded-lg transition-colors",
          collapsed ? "justify-center py-2" : "px-2 py-2",
          open ? "bg-white/[0.08]" : "hover:bg-white/[0.10]"
        )}
      >
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-amber-500/40 to-amber-700/25 text-xs font-bold uppercase text-amber-100 ring-2 ring-amber-400/30">
          {initial}
        </div>
        {!collapsed && (
          <span className="flex-1 truncate text-left text-sm font-medium text-zinc-200">{user.username}</span>
        )}
      </button>

      {/* Submenu — opens inline below, pushes content down */}
      {open && !collapsed && (
        <div className="mt-1 rounded-lg border border-white/10 bg-white/[0.05] overflow-hidden">
          <Link
            href="/profile"
            onClick={() => setOpen(false)}
            className="flex items-center gap-3 px-3 py-2 text-sm text-slate-300 hover:bg-white/10 hover:text-zinc-100 transition-colors"
          >
            <UserCircle size={15} />
            Profil
          </Link>
          <Link
            href="/settings"
            onClick={() => setOpen(false)}
            className="flex items-center gap-3 px-3 py-2 text-sm text-slate-300 hover:bg-white/10 hover:text-zinc-100 transition-colors"
          >
            <Settings size={15} />
            Ustawienia
          </Link>
          <button
            onClick={() => { setOpen(false); onLogout(); }}
            className="flex w-full items-center gap-3 px-3 py-2 text-sm text-red-400 hover:bg-red-500/10 hover:text-red-300 transition-colors border-t border-white/[0.08]"
          >
            <LogOut size={15} />
            Wyloguj
          </button>
        </div>
      )}

      {/* Collapsed: tooltip-only, clicking goes to profile */}
      {open && collapsed && (
        <div className="mt-1 flex flex-col items-center gap-0.5">
          <Link href="/profile" onClick={() => setOpen(false)} title="Profil"
            className="flex h-8 w-10 items-center justify-center rounded text-slate-400 hover:bg-white/10 hover:text-zinc-100 transition-colors">
            <UserCircle size={16} />
          </Link>
          <Link href="/settings" onClick={() => setOpen(false)} title="Ustawienia"
            className="flex h-8 w-10 items-center justify-center rounded text-slate-400 hover:bg-white/10 hover:text-zinc-100 transition-colors">
            <Settings size={16} />
          </Link>
          <button onClick={() => { setOpen(false); onLogout(); }} title="Wyloguj"
            className="flex h-8 w-10 items-center justify-center rounded text-red-400 hover:bg-red-500/10 transition-colors">
            <LogOut size={16} />
          </button>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Breadcrumb labels
// ---------------------------------------------------------------------------

const BREADCRUMB_LABELS: Record<string, string> = {
  dashboard: "Panel",
  leaderboard: "Ranking",
  inventory: "Ekwipunek",
  cosmetics: "Kosmetyki",
  decks: "Talia",
  marketplace: "Rynek",
  crafting: "Kuźnia",
  developers: "Deweloperzy",
  profile: "Profil",
  settings: "Ustawienia",
  match: "Mecz",
  replay: "Powtórka",
  docs: "Dokumentacja",
};

// For dynamic segments (e.g. item slugs, deck IDs) we show a human-readable
// fallback derived from the segment itself. The label map is checked first.
function formatSegmentLabel(seg: string): string {
  if (BREADCRUMB_LABELS[seg]) return BREADCRUMB_LABELS[seg];
  // UUID-like IDs → "Edytor"
  if (/^[0-9a-f-]{8,}$/i.test(seg)) return "Edytor";
  // Slugs: replace hyphens with spaces and capitalise first letter
  return seg.replace(/-/g, " ").replace(/^\w/, (c) => c.toUpperCase());
}

function Breadcrumbs({ pathname }: { pathname: string }) {
  const segments = pathname.split("/").filter(Boolean);
  if (segments.length === 0) return null;

  const crumbs = segments.map((seg, i) => {
    const href = "/" + segments.slice(0, i + 1).join("/");
    const label = formatSegmentLabel(seg);
    const isLast = i === segments.length - 1;
    return { href, label, isLast };
  });

  return (
    <nav aria-label="Breadcrumb" className="mb-4 flex items-center gap-1 text-sm">
      <Link href="/dashboard" className="text-slate-400 hover:text-slate-300 transition-colors">
        <Home size={14} />
      </Link>
      {crumbs.map((c) => (
        <span key={c.href} className="flex items-center gap-1">
          <ChevronRightIcon size={12} className="text-slate-500" />
          {c.isLast ? (
            <span className="text-zinc-300 font-medium">{c.label}</span>
          ) : (
            <Link href={c.href} className="text-slate-400 hover:text-slate-300 transition-colors">
              {c.label}
            </Link>
          )}
        </span>
      ))}
    </nav>
  );
}

// Bottom bar items shown on mobile (primary 4 + "więcej" trigger)
const BOTTOM_PRIMARY: NavItem[] = [
  {
    href: "/dashboard",
    label: "Panel",
    icon: <LayoutDashboard size={20} />,
    matchExact: true,
  },
  { href: "/inventory", label: "Ekwipunek", icon: <Backpack size={20} /> },
  { href: "/marketplace", label: "Rynek", icon: <Store size={20} /> },
  { href: "/decks", label: "Talia", icon: <Layers size={20} /> },
];

// ---------------------------------------------------------------------------
// Sidebar nav item (desktop — supports collapsed mode)
// ---------------------------------------------------------------------------

function SidebarItem({
  item,
  pathname,
  collapsed,
  onClick,
}: {
  item: NavItem;
  pathname: string;
  collapsed: boolean;
  onClick?: () => void;
}) {
  const active = item.matchExact
    ? pathname === item.href
    : pathname.startsWith(item.href);

  if (collapsed) {
    return (
      <Link
        href={item.href}
        onClick={onClick}
        aria-current={active ? "page" : undefined}
        title={item.label}
        className={cn(
          "cursor-target flex items-center justify-center py-2 mx-1 rounded-sm transition-colors",
          "border-l-2",
          active
            ? "border-amber-400 bg-white/[0.04] text-zinc-50"
            : "border-transparent text-slate-400 hover:text-zinc-100 hover:bg-white/[0.08]"
        )}
      >
        <span className="shrink-0">{item.icon}</span>
      </Link>
    );
  }

  return (
    <Link
      href={item.href}
      onClick={onClick}
      aria-current={active ? "page" : undefined}
      className={cn(
        "cursor-target flex items-center gap-3 px-3 py-2 text-sm font-medium transition-colors rounded-sm",
        active
          ? "border-l-2 border-amber-400 bg-white/[0.04] text-zinc-50 pl-[10px]"
          : "border-l-2 border-transparent text-slate-400 hover:text-zinc-100 hover:bg-white/[0.08] pl-[10px]"
      )}
    >
      <span className="shrink-0">{item.icon}</span>
      <span>{item.label}</span>
    </Link>
  );
}

// ---------------------------------------------------------------------------
// Section header (desktop sidebar only)
// ---------------------------------------------------------------------------

function SectionHeader({ label }: { label: string }) {
  return (
    <div className="px-3 pb-1 pt-4 text-[11px] font-medium uppercase tracking-[0.2em] text-slate-500 select-none">
      {label}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Collapsed section separator
// ---------------------------------------------------------------------------

function CollapsedSeparator() {
  return <div className="mx-3 my-2 border-t border-white/10" />;
}

// ---------------------------------------------------------------------------
// Desktop sidebar content
// ---------------------------------------------------------------------------

function DesktopSidebarContent({
  pathname,
  collapsed,
}: {
  pathname: string;
  collapsed: boolean;
}) {
  if (collapsed) {
    return (
      <nav className="flex flex-col py-2">
        {ACTION_ITEMS.map((item) => (
          <SidebarItem
            key={item.href}
            item={item}
            pathname={pathname}
            collapsed={true}
          />
        ))}
        <CollapsedSeparator />
        {ECONOMY_ITEMS.map((item) => (
          <SidebarItem
            key={item.href}
            item={item}
            pathname={pathname}
            collapsed={true}
          />
        ))}
        <CollapsedSeparator />
        {OTHER_ITEMS.map((item) => (
          <SidebarItem
            key={item.href}
            item={item}
            pathname={pathname}
            collapsed={true}
          />
        ))}
      </nav>
    );
  }

  return (
    <nav className="flex flex-col py-2">
      <SectionHeader label="AKCJA" />
      {ACTION_ITEMS.map((item) => (
        <SidebarItem
          key={item.href}
          item={item}
          pathname={pathname}
          collapsed={false}
        />
      ))}

      <SectionHeader label="EKONOMIA" />
      {ECONOMY_ITEMS.map((item) => (
        <SidebarItem
          key={item.href}
          item={item}
          pathname={pathname}
          collapsed={false}
        />
      ))}

      <SectionHeader label="INNE" />
      {OTHER_ITEMS.map((item) => (
        <SidebarItem
          key={item.href}
          item={item}
          pathname={pathname}
          collapsed={false}
        />
      ))}
    </nav>
  );
}

// ---------------------------------------------------------------------------
// Mobile sheet sidebar content (always expanded)
// ---------------------------------------------------------------------------

function MobileSidebarContent({
  pathname,
  onNavigate,
}: {
  pathname: string;
  onNavigate?: () => void;
}) {
  return (
    <nav className="flex flex-col py-2">
      <SectionHeader label="AKCJA" />
      {ACTION_ITEMS.map((item) => (
        <SidebarItem
          key={item.href}
          item={item}
          pathname={pathname}
          collapsed={false}
          onClick={onNavigate}
        />
      ))}

      <SectionHeader label="EKONOMIA" />
      {ECONOMY_ITEMS.map((item) => (
        <SidebarItem
          key={item.href}
          item={item}
          pathname={pathname}
          collapsed={false}
          onClick={onNavigate}
        />
      ))}

      <SectionHeader label="INNE" />
      {OTHER_ITEMS.map((item) => (
        <SidebarItem
          key={item.href}
          item={item}
          pathname={pathname}
          collapsed={false}
          onClick={onNavigate}
        />
      ))}

      <SectionHeader label="KONTO" />
      <SidebarItem
        item={{ href: "/profile", label: "Profil", icon: <UserCircle size={18} /> }}
        pathname={pathname}
        collapsed={false}
        onClick={onNavigate}
      />
      <SidebarItem
        item={{ href: "/settings", label: "Ustawienia", icon: <Settings size={18} /> }}
        pathname={pathname}
        collapsed={false}
        onClick={onNavigate}
      />
    </nav>
  );
}

// ---------------------------------------------------------------------------
// Bottom bar item (mobile)
// ---------------------------------------------------------------------------

function BottomBarItem({ item, pathname }: { item: NavItem; pathname: string }) {
  const active = item.matchExact
    ? pathname === item.href
    : pathname.startsWith(item.href);

  return (
    <Link
      href={item.href}
      aria-current={active ? "page" : undefined}
      className={cn(
        "flex flex-1 flex-col items-center gap-0.5 px-2 py-2 text-[10px] font-medium transition-colors",
        active ? "text-amber-300" : "text-slate-400 hover:text-slate-300"
      )}
    >
      <span className={cn("transition-colors", active && "text-amber-400")}>
        {item.icon}
      </span>
      <span>{item.label}</span>
    </Link>
  );
}

// ---------------------------------------------------------------------------
// Main layout
// ---------------------------------------------------------------------------

export default function MainLayout({ children }: { children: ReactNode }) {
  const { user, logout, token } = useAuth();
  const pathname = usePathname();
  const [wallet, setWallet] = useState<WalletOut | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(() => {
    if (typeof window === "undefined") return false;
    return localStorage.getItem("sidebar-collapsed") === "true";
  });

  const toggleCollapsed = () => {
    setCollapsed((prev) => {
      const next = !prev;
      localStorage.setItem("sidebar-collapsed", String(next));
      return next;
    });
  };

  useEffect(() => {
    if (!token) return;
    getMyWallet(token)
      .then(setWallet)
      .catch(() => {
        // Wallet not available — silently ignore
      });
  }, [token]);

  const sidebarWidth = collapsed ? "w-14" : "w-56";
  const contentPadding = collapsed ? "md:pl-14" : "md:pl-56";

  return (
    <div className="min-h-screen bg-background text-foreground">
      <TargetCursor />

      {/* ------------------------------------------------------------------ */}
      {/* Top bar                                                             */}
      {/* ------------------------------------------------------------------ */}
      <header className="fixed inset-x-0 top-0 z-40 h-12 border-b border-border bg-card/80 backdrop-blur-xl">
        <div className="flex h-full items-center gap-3 px-4">

          {/* Logo */}
          <Link
            href="/dashboard"
            className="flex shrink-0 items-center gap-2 mr-2"
          >
            <div className="flex h-7 w-7 items-center justify-center rounded-md border border-white/10 bg-white/[0.04]">
              <Globe size={15} className="text-slate-300" />
            </div>
            <span className="font-display text-sm font-semibold uppercase tracking-[0.18em] text-zinc-100">
              MAPLORD
            </span>
          </Link>

          <div className="flex-1" />
        </div>
      </header>

      {/* ------------------------------------------------------------------ */}
      {/* Body (below top bar)                                                */}
      {/* ------------------------------------------------------------------ */}
      <div className="flex pt-12">

        {/* ---------------------------------------------------------------- */}
        {/* Desktop sidebar                                                   */}
        {/* ---------------------------------------------------------------- */}
        <aside
          className={cn(
            "fixed left-0 top-12 hidden h-[calc(100vh-3rem)] flex-col border-r border-border bg-card md:flex",
            // sidebar uses bg-card which is slate-900 (#0f172a)
            "transition-all duration-200",
            sidebarWidth
          )}
        >
          {/* Avatar popover first, then stats below */}
          {user && (
            <div className="border-b border-white/10">
              {/* Avatar + name — clickable popover */}
              <div className={cn(collapsed ? "px-1 pt-2 pb-1" : "px-2 pt-3 pb-1")}>
                <ProfilePopover user={user} wallet={wallet} collapsed={collapsed} onLogout={logout} />
              </div>
              {/* Stats — always visible BELOW avatar */}
              {!collapsed && (
                <div className="px-3 pb-3 pt-1 space-y-1.5">
                  <div className="flex items-center gap-2 rounded-lg bg-white/[0.06] border border-white/10 px-2.5 py-1.5">
                    <Trophy size={14} className="text-amber-400 shrink-0" />
                    <span className="text-sm font-bold tabular-nums text-zinc-100">{user.elo_rating}</span>
                    <span className="text-[11px] text-slate-400 ml-auto font-medium">ELO</span>
                  </div>
                  {wallet && (
                    <div className="flex items-center gap-2 rounded-lg bg-amber-500/[0.07] border border-amber-400/15 px-2.5 py-1.5">
                      <Coins size={14} className="text-amber-400 shrink-0" />
                      <span className="text-sm font-bold tabular-nums text-amber-200">{wallet.gold.toLocaleString("pl-PL")}</span>
                      <span className="text-[11px] text-amber-300/70 ml-auto font-medium">złota</span>
                    </div>
                  )}
                </div>
              )}
              {collapsed && (
                <div className="flex flex-col items-center gap-1 px-1 pb-2">
                  <div title={`ELO: ${user.elo_rating}`} className="flex h-7 w-full items-center justify-center rounded bg-white/[0.04] text-[10px] font-bold tabular-nums text-zinc-200">
                    {user.elo_rating}
                  </div>
                  {wallet && (
                    <div title={`${wallet.gold} złota`} className="flex h-7 w-full items-center justify-center rounded bg-amber-500/[0.07] text-[10px] font-bold tabular-nums text-amber-300">
                      {wallet.gold > 9999 ? `${Math.floor(wallet.gold / 1000)}k` : wallet.gold}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Nav items */}
          <div className="flex-1 overflow-y-auto">
            <DesktopSidebarContent pathname={pathname} collapsed={collapsed} />
          </div>

          {/* Collapse toggle */}
          <div className="border-t border-white/10">
            <button
              onClick={toggleCollapsed}
              className={cn(
                "flex w-full items-center py-2.5 text-slate-400 hover:text-zinc-100 hover:bg-white/[0.08] transition-colors",
                collapsed ? "justify-center" : "gap-2 px-3"
              )}
              aria-label={collapsed ? "Rozwiń" : "Zwiń"}
              title={collapsed ? "Rozwiń" : "Zwiń"}
            >
              {collapsed ? <ChevronRight size={16} /> : <><ChevronLeft size={16} /><span className="text-sm">Zwiń</span></>}
            </button>
          </div>
        </aside>

        {/* ---------------------------------------------------------------- */}
        {/* Main content                                                      */}
        {/* ---------------------------------------------------------------- */}
        <main
          className={cn(
            "flex-1 min-w-0 transition-all duration-200",
            contentPadding
          )}
        >
          <div className="px-4 py-6 pb-20 sm:px-6 lg:px-8 md:pb-6">
            <Breadcrumbs pathname={pathname} />
            {children}
          </div>
        </main>
      </div>

      {/* ------------------------------------------------------------------ */}
      {/* Mobile bottom bar                                                   */}
      {/* ------------------------------------------------------------------ */}
      <nav className="fixed inset-x-0 bottom-0 z-40 flex h-14 items-stretch border-t border-border bg-card/90 backdrop-blur-xl md:hidden">
        {BOTTOM_PRIMARY.map((item) => (
          <BottomBarItem key={item.href} item={item} pathname={pathname} />
        ))}

        {/* "Więcej" sheet trigger */}
        <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
          <SheetTrigger
            render={
              <button
                className={cn(
                  "flex flex-1 flex-col items-center gap-0.5 px-3 py-2 text-[10px] font-medium transition-colors",
                  "text-slate-400 hover:text-slate-300"
                )}
                aria-label="Więcej opcji"
              />
            }
          >
            <MoreHorizontal size={20} />
            <span>Więcej</span>
          </SheetTrigger>
          <SheetContent
            side="bottom"
            className="rounded-t-2xl border-t border-border bg-card px-0 pb-8 pt-4"
          >
            <div className="mb-2 px-4 text-[11px] font-medium uppercase tracking-[0.2em] text-slate-400">
              NAWIGACJA
            </div>
            <MobileSidebarContent
              pathname={pathname}
              onNavigate={() => setSheetOpen(false)}
            />
          </SheetContent>
        </Sheet>
      </nav>
    </div>
  );
}
