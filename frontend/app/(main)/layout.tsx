"use client";

import { type ReactNode, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
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
  Search,
  Settings,
  Shirt,
  Store,
  Trophy,
  UserCircle,
  Users,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { useAuth } from "@/hooks/useAuth";
import { MatchmakingProvider, useMatchmaking } from "@/hooks/useMatchmaking";
import { getMyWallet, type WalletOut } from "@/lib/api";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
// ---------------------------------------------------------------------------
// Nav item definitions
// ---------------------------------------------------------------------------

interface NavItem {
  href: string;
  label: string;
  icon: ReactNode;
  matchExact?: boolean;
}

const PLAY_ITEMS: NavItem[] = [
  { href: "/dashboard", label: "Graj", icon: <LayoutDashboard size={20} />, matchExact: true },
  { href: "/leaderboard", label: "Ranking", icon: <Medal size={20} />, matchExact: true },
];

const LOADOUT_ITEMS: NavItem[] = [
  { href: "/inventory", label: "Ekwipunek", icon: <Backpack size={20} /> },
  { href: "/decks", label: "Talie", icon: <Layers size={20} /> },
  { href: "/cosmetics", label: "Skórki", icon: <Shirt size={20} /> },
];

const ECONOMY_ITEMS: NavItem[] = [
  { href: "/marketplace", label: "Rynek", icon: <Store size={20} /> },
  { href: "/crafting", label: "Kuźnia", icon: <Hammer size={20} /> },
];

const OTHER_ITEMS: NavItem[] = [
  { href: "/developers", label: "API", icon: <Code size={20} /> },
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
          collapsed ? "justify-center py-2.5" : "px-3 py-2.5",
          open ? "bg-muted" : "hover:bg-muted"
        )}
      >
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/15 text-xs font-bold uppercase text-primary">
          {initial}
        </div>
        {!collapsed && (
          <>
            <span className="flex-1 truncate text-left text-sm font-medium text-foreground">{user.username}</span>
            <ChevronRight size={14} className={cn("shrink-0 text-muted-foreground/50 transition-transform duration-200", open && "rotate-90")} />
          </>
        )}
      </button>

      {/* Submenu */}
      {open && !collapsed && (
        <div className="mt-1 mx-2 rounded-lg border border-border bg-secondary/80 overflow-hidden">
          <Link
            href="/profile"
            onClick={() => setOpen(false)}
            className="flex items-center gap-2.5 px-3 py-2 text-sm text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
          >
            <UserCircle size={18} />
            Profil
          </Link>
          <Link
            href="/settings"
            onClick={() => setOpen(false)}
            className="flex items-center gap-2.5 px-3 py-2 text-sm text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
          >
            <Settings size={18} />
            Ustawienia
          </Link>
          <button
            onClick={() => { setOpen(false); onLogout(); }}
            className="flex w-full items-center gap-2.5 px-3 py-2 text-sm text-destructive hover:bg-destructive/10 transition-colors border-t border-border"
          >
            <LogOut size={18} />
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
  lobby: "Lobby",
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
          "flex items-center justify-center py-2.5 mx-1 rounded-lg transition-colors",
          active
            ? "bg-primary/10 text-primary"
            : "text-muted-foreground hover:text-foreground hover:bg-muted"
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
        "flex items-center gap-3 px-3 py-2.5 text-sm font-medium transition-colors rounded-lg mx-2",
        active
          ? "bg-primary/10 text-primary"
          : "text-muted-foreground hover:text-foreground hover:bg-muted"
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
    <div className="px-5 pb-1.5 pt-5 text-[10px] font-semibold uppercase tracking-[0.2em] text-muted-foreground/60 select-none">
      {label}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Collapsed section separator
// ---------------------------------------------------------------------------

function CollapsedSeparator() {
  return <div className="mx-3 my-1.5 border-t border-border" />;
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
  const groups = [
    { label: "GRA", items: PLAY_ITEMS },
    { label: "WYPOSAŻENIE", items: LOADOUT_ITEMS },
    { label: "HANDEL", items: ECONOMY_ITEMS },
    { label: "WIĘCEJ", items: OTHER_ITEMS },
  ];

  if (collapsed) {
    return (
      <nav className="flex flex-col py-2">
        {groups.map((g, i) => (
          <div key={g.label}>
            {i > 0 && <CollapsedSeparator />}
            {g.items.map((item) => (
              <SidebarItem key={item.href} item={item} pathname={pathname} collapsed={true} />
            ))}
          </div>
        ))}
      </nav>
    );
  }

  return (
    <nav className="flex flex-col py-1">
      {groups.map((g) => (
        <div key={g.label}>
          <SectionHeader label={g.label} />
          {g.items.map((item) => (
            <SidebarItem key={item.href} item={item} pathname={pathname} collapsed={false} />
          ))}
        </div>
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
  const groups = [
    { label: "GRA", items: PLAY_ITEMS },
    { label: "WYPOSAŻENIE", items: LOADOUT_ITEMS },
    { label: "HANDEL", items: ECONOMY_ITEMS },
    { label: "WIĘCEJ", items: OTHER_ITEMS },
    { label: "KONTO", items: [
      { href: "/profile", label: "Profil", icon: <UserCircle size={20} /> },
      { href: "/settings", label: "Ustawienia", icon: <Settings size={20} /> },
    ] as NavItem[] },
  ];

  return (
    <nav className="flex flex-col py-1">
      {groups.map((g) => (
        <div key={g.label}>
          <SectionHeader label={g.label} />
          {g.items.map((item) => (
            <SidebarItem key={item.href} item={item} pathname={pathname} collapsed={false} onClick={onNavigate} />
          ))}
        </div>
      ))}
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
        "flex flex-1 flex-col items-center gap-0.5 px-2 py-2 text-xs font-medium transition-colors",
        active ? "text-accent" : "text-muted-foreground hover:text-foreground"
      )}
    >
      <span className={cn("transition-colors", active && "text-accent")}>
        {item.icon}
      </span>
      <span>{item.label}</span>
    </Link>
  );
}

// ---------------------------------------------------------------------------
// Queue banner — shows when in matchmaking queue on any page
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Blocked pages during queue
// ---------------------------------------------------------------------------

const BLOCKED_DURING_QUEUE = ["/decks", "/cosmetics"];

function QueueGuard({ children, pathname }: { children: ReactNode; pathname: string }) {
  const { inQueue } = useMatchmaking();

  const isBlocked = inQueue && BLOCKED_DURING_QUEUE.some(
    (p) => pathname === p || pathname.startsWith(p + "/")
  );

  if (!isBlocked) return <>{children}</>;

  return (
    <div className="flex flex-col items-center justify-center gap-4 py-20 md:py-32 text-center px-4">
      <div className="flex h-14 w-14 md:h-16 md:w-16 items-center justify-center rounded-2xl bg-primary/10 border border-primary/20">
        <Search className="h-6 w-6 md:h-7 md:w-7 text-primary" />
      </div>
      <h2 className="font-display text-xl md:text-2xl text-foreground">Szukanie meczu</h2>
      <p className="text-sm md:text-base text-muted-foreground max-w-xs">
        Nie możesz edytować talii ani kosmetyków podczas szukania meczu.
      </p>
      <Link
        href="/dashboard"
        className="inline-flex items-center gap-2 rounded-full bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground hover:bg-primary/90 active:scale-[0.97] transition-all"
      >
        Wróć do dashboardu
      </Link>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Queue banner inline in header
// ---------------------------------------------------------------------------

function QueueBannerInline() {
  const { inQueue, lobbyId, lobbyPlayers, lobbyFull, allReady, queueSeconds, leaveQueue, matchId, setReady, readyCountdown } = useMatchmaking();
  const { user } = useAuth();
  const router = useRouter();
  const myReady = lobbyPlayers.some(p => p.user_id === user?.id && p.is_ready);
  const lobbyToastRef = useRef<string | number | null>(null);

  useEffect(() => {
    if (matchId) router.push(`/game/${matchId}`);
  }, [matchId, router]);

  // Toast when lobby full
  useEffect(() => {
    if (lobbyFull && !lobbyToastRef.current) {
      try { const a = new Audio("/assets/audio/gui/int_message_alert.ogg"); a.volume = 0.7; a.play().catch(() => {}); } catch {}
      lobbyToastRef.current = toast.success("Mecz znaleziony!", {
        description: "Kliknij Gotowy aby potwierdzić (2:00)",
        duration: 120000,
        action: {
          label: "Gotowy!",
          onClick: () => setReady(),
        },
        classNames: {
          actionButton: "!bg-green-500 !text-white !font-bold !rounded-lg !px-4 !py-2 !text-sm hover:!bg-green-400 !border-0",
        },
      });
    }
    if (!lobbyFull && lobbyToastRef.current) {
      toast.dismiss(lobbyToastRef.current);
      lobbyToastRef.current = null;
    }
  }, [lobbyFull, setReady]);

  // Update toast with countdown
  useEffect(() => {
    if (lobbyToastRef.current && readyCountdown !== null && lobbyFull && !allReady) {
      const m = Math.floor(readyCountdown / 60);
      const s = String(readyCountdown % 60).padStart(2, "0");
      toast.success("Mecz znaleziony!", {
        id: lobbyToastRef.current,
        description: `Kliknij Gotowy aby potwierdzić (${m}:${s})`,
        duration: 120000,
        action: {
          label: "Gotowy!",
          onClick: () => setReady(),
        },
        classNames: {
          actionButton: "!bg-green-500 !text-white !font-bold !rounded-lg !px-4 !py-2 !text-sm hover:!bg-green-400 !border-0",
        },
      });
    }
  }, [readyCountdown, lobbyFull, allReady, setReady]);

  // Dismiss toast when user is ready or leaves
  useEffect(() => {
    if (lobbyToastRef.current && (myReady || !inQueue)) {
      toast.dismiss(lobbyToastRef.current);
      lobbyToastRef.current = null;
    }
  }, [myReady, inQueue]);

  if (!inQueue) return null;

  const mins = Math.floor(queueSeconds / 60);
  const secs = String(queueSeconds % 60).padStart(2, "0");
  const countdownStr = readyCountdown !== null
    ? `${Math.floor(readyCountdown / 60)}:${String(readyCountdown % 60).padStart(2, "0")}`
    : null;

  return (
    <>
      {/* ── Desktop: inline in header ── */}
      <div className="hidden md:flex items-center gap-2.5 ml-auto">
        {lobbyPlayers.length > 0 && (
          <Link
            href={lobbyId ? `/lobby/${lobbyId}` : "#"}
            className="flex -space-x-2 transition-opacity hover:opacity-80"
          >
            {lobbyPlayers.map((player) => (
              <div
                key={player.user_id}
                title={player.username}
                className={cn(
                  "flex h-7 w-7 items-center justify-center rounded-full border-2 text-[10px] font-bold uppercase",
                  player.is_ready
                    ? "border-green-500 bg-green-500/20 text-green-400"
                    : "border-border bg-secondary text-muted-foreground",
                  player.is_bot && "opacity-70"
                )}
              >
                {player.username.charAt(0)}
              </div>
            ))}
          </Link>
        )}

        <div className="flex items-center gap-1.5 rounded-full bg-primary/10 border border-primary/20 pl-3 pr-1.5 py-1">
          <div className="h-1.5 w-1.5 rounded-full bg-primary animate-pulse" />
          <span className="text-sm font-semibold text-primary tabular-nums">{mins}:{secs}</span>
          <span className="text-xs text-primary/70">· {lobbyPlayers.length} graczy</span>

          {lobbyFull && !allReady && !myReady && (
            <Button
              size="xs"
              onClick={setReady}
              className="ml-1 rounded-full bg-green-500 text-white hover:bg-green-400 active:scale-[0.95] font-bold"
            >
              Gotowy! {countdownStr && <span className="tabular-nums">({countdownStr})</span>}
            </Button>
          )}
          {lobbyFull && !allReady && myReady && (
            <span className="ml-1 text-[10px] text-green-400 font-semibold tabular-nums">
              {countdownStr ?? "Oczekiwanie..."}
            </span>
          )}

          {lobbyId && (
            <Link
              href={`/lobby/${lobbyId}`}
              className="flex items-center justify-center h-6 w-6 rounded-full bg-primary/20 text-primary hover:bg-primary/30 transition-colors ml-0.5 active:scale-[0.9]"
              title="Lobby"
            >
              <Users className="h-3 w-3" />
            </Link>
          )}

          <button
            onClick={leaveQueue}
            className="flex items-center justify-center h-6 w-6 rounded-full bg-primary/20 text-primary hover:bg-destructive/20 hover:text-destructive transition-colors ml-0.5 active:scale-[0.9]"
          >
            <X className="h-3 w-3" />
          </button>
        </div>
      </div>

      {/* ── Mobile: subheader bar below main header ── */}
      <div className="fixed inset-x-0 top-12 z-39 flex items-center gap-2 px-3 py-1.5 border-b border-border bg-card/90 backdrop-blur-xl md:hidden">
        {/* Avatars */}
        {lobbyPlayers.length > 0 && (
          <Link
            href={lobbyId ? `/lobby/${lobbyId}` : "#"}
            className="flex -space-x-1.5 shrink-0"
          >
            {lobbyPlayers.map((player) => (
              <div
                key={player.user_id}
                className={cn(
                  "flex h-6 w-6 items-center justify-center rounded-full border-[1.5px] text-[9px] font-bold uppercase",
                  player.is_ready
                    ? "border-green-500 bg-green-500/20 text-green-400"
                    : "border-border bg-secondary text-muted-foreground",
                  player.is_bot && "opacity-70"
                )}
              >
                {player.username.charAt(0)}
              </div>
            ))}
          </Link>
        )}

        {/* Timer */}
        <div className="flex items-center gap-1">
          <div className="h-1.5 w-1.5 rounded-full bg-primary animate-pulse" />
          <span className="text-xs font-semibold text-primary tabular-nums">{mins}:{secs}</span>
        </div>

        <div className="flex-1" />

        {/* Ready / countdown */}
        {lobbyFull && !allReady && !myReady && (
          <Button
            size="xs"
            onClick={setReady}
            className="rounded-full bg-green-500 text-white hover:bg-green-400 active:scale-[0.95] font-bold text-[11px] h-6 px-2.5"
          >
            Gotowy! {countdownStr && <span className="tabular-nums">({countdownStr})</span>}
          </Button>
        )}
        {lobbyFull && !allReady && myReady && countdownStr && (
          <span className="text-[10px] text-green-400 font-semibold tabular-nums">{countdownStr}</span>
        )}

        {/* Lobby link */}
        {lobbyId && (
          <Link
            href={`/lobby/${lobbyId}`}
            className="flex items-center justify-center h-5 w-5 rounded-full bg-primary/20 text-primary active:scale-[0.9]"
          >
            <Users className="h-2.5 w-2.5" />
          </Link>
        )}

        {/* Cancel */}
        <button
          onClick={leaveQueue}
          className="flex items-center justify-center h-5 w-5 rounded-full bg-primary/20 text-primary hover:bg-destructive/20 hover:text-destructive transition-colors active:scale-[0.9]"
        >
          <X className="h-2.5 w-2.5" />
        </button>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// Main layout
// ---------------------------------------------------------------------------

export default function MainLayout({ children }: { children: ReactNode }) {
  return (
    <MatchmakingProvider>
      <MainLayoutInner>{children}</MainLayoutInner>
    </MatchmakingProvider>
  );
}

function MainLayoutInner({ children }: { children: ReactNode }) {
  const { user, logout, token } = useAuth();
  const { inQueue: showQueueSubheader } = useMatchmaking();
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
      {/* ------------------------------------------------------------------ */}
      {/* Top bar                                                             */}
      {/* ------------------------------------------------------------------ */}
      <header className="fixed inset-x-0 top-0 z-40 h-12 border-b border-border bg-card/80 backdrop-blur-xl">
        <div className="flex h-full items-center gap-3 px-4">

          {/* Logo */}
          <Link
            href="/dashboard"
            className="flex shrink-0 items-center gap-2.5 mr-2"
          >
            <div className="flex h-8 w-8 items-center justify-center rounded-lg border border-border bg-secondary">
              <Globe size={16} className="text-primary" />
            </div>
            <span className="font-display text-sm font-bold uppercase tracking-[0.18em] text-foreground">
              MAPLORD
            </span>
          </Link>

          <div className="flex-1" />

          {/* Queue indicator — inline in header */}
          <QueueBannerInline />
        </div>
      </header>

      {/* ------------------------------------------------------------------ */}
      {/* Body (below top bar)                                                */}
      {/* ------------------------------------------------------------------ */}
      <div className={cn("flex pt-12", showQueueSubheader && "max-md:pt-[calc(3rem+2.25rem)]")}>

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
            <div className="border-b border-border">
              {/* Avatar + name */}
              <div className={cn(collapsed ? "px-1 pt-2.5 pb-1.5" : "px-2 pt-3 pb-1.5")}>
                <ProfilePopover user={user} wallet={wallet} collapsed={collapsed} onLogout={logout} />
              </div>
              {/* Stats */}
              {!collapsed && (
                <div className="px-3 pb-3 pt-1 flex gap-2">
                  <div className="flex-1 flex items-center gap-2 rounded-lg bg-secondary/80 px-2.5 py-2">
                    <Trophy size={14} className="text-accent shrink-0" />
                    <span className="text-sm font-bold tabular-nums text-foreground">{user.elo_rating}</span>
                  </div>
                  {wallet && (
                    <div className="flex-1 flex items-center gap-2 rounded-lg bg-accent/[0.06] px-2.5 py-2">
                      <Coins size={14} className="text-accent shrink-0" />
                      <span className="text-sm font-bold tabular-nums text-accent">{wallet.gold > 9999 ? `${Math.floor(wallet.gold / 1000)}k` : wallet.gold.toLocaleString("pl-PL")}</span>
                    </div>
                  )}
                </div>
              )}
              {collapsed && (
                <div className="flex flex-col items-center gap-1 px-1 pb-2">
                  <div title={`ELO: ${user.elo_rating}`} className="flex h-7 w-full items-center justify-center rounded-md bg-secondary text-[10px] font-bold tabular-nums text-foreground">
                    {user.elo_rating}
                  </div>
                  {wallet && (
                    <div title={`${wallet.gold} złota`} className="flex h-7 w-full items-center justify-center rounded-md bg-accent/10 text-[10px] font-bold tabular-nums text-accent">
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
          <div className="border-t border-border">
            <button
              onClick={toggleCollapsed}
              className={cn(
                "flex w-full items-center py-3 text-muted-foreground hover:text-foreground hover:bg-muted transition-colors",
                collapsed ? "justify-center" : "gap-2.5 px-3"
              )}
              aria-label={collapsed ? "Rozwiń" : "Zwiń"}
              title={collapsed ? "Rozwiń" : "Zwiń"}
            >
              {collapsed ? <ChevronRight size={22} /> : <><ChevronLeft size={22} /><span className="text-base">Zwiń</span></>}
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
          <div className="px-4 py-4 pb-20 md:py-6 sm:px-6 lg:px-8 md:pb-6">
            <Breadcrumbs pathname={pathname} />
            <QueueGuard pathname={pathname}>
              {children}
            </QueueGuard>
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
