"use client";

import { useQueryClient } from "@tanstack/react-query";
import {
  Backpack,
  Bell,
  Check,
  CheckCheck,
  ChevronLeft,
  ChevronRight,
  ChevronRightIcon,
  Code,
  Coins,
  Diamond,
  ExternalLink,
  Hammer,
  Home,
  Layers,
  LayoutDashboard,
  LogOut,
  Medal,
  MessageSquare,
  MoreHorizontal,
  Search,
  Settings,
  Shield,
  Shirt,
  ShoppingBag,
  Store,
  Swords,
  Trophy,
  UserCircle,
  UserPlus,
  Users,
  Volume2,
  VolumeX,
  X,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { ClanTag } from "@/components/ClanTag";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { useFriends, useGemWallet, useMyWallet, useOnlineStats } from "@/hooks/queries";
import { SocialSocketContext } from "@/hooks/SocialSocketContext";
import { useAudio } from "@/hooks/useAudio";
import { useAuth } from "@/hooks/useAuth";
import { useChat } from "@/hooks/useChat";
import { MatchmakingProvider, useMatchmaking } from "@/hooks/useMatchmaking";
import { useNotifications } from "@/hooks/useNotifications";
import { useSocialSocket } from "@/hooks/useSocialSocket";
import { useSystemModules } from "@/hooks/useSystemModules";
import type { FriendshipOut, FriendUser, NotificationOut, WalletOut } from "@/lib/api";
import { queryKeys } from "@/lib/queryKeys";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Nav item definitions
// ---------------------------------------------------------------------------

interface NavItem {
  href: string;
  label: string;
  icon: ReactNode;
  matchExact?: boolean;
}

/** Maps nav href prefixes to system module slugs. */
const NAV_MODULE_MAP: Record<string, string> = {
  "/leaderboard": "leaderboard",
  "/inventory": "inventory",
  "/decks": "cosmetics",
  "/cosmetics": "cosmetics",
  "/marketplace": "marketplace",
  "/crafting": "crafting",
  "/developers": "developers",
};

const ALL_PLAY_ITEMS: NavItem[] = [
  { href: "/dashboard", label: "Graj", icon: <LayoutDashboard size={20} />, matchExact: true },
  { href: "/leaderboard", label: "Ranking", icon: <Medal size={20} />, matchExact: true },
  { href: "/clans", label: "Klany", icon: <Swords size={20} /> },
  { href: "/friends", label: "Znajomi", icon: <Users size={20} /> },
  { href: "/messages", label: "Wiadomości", icon: <MessageSquare size={20} /> },
];

const ALL_LOADOUT_ITEMS: NavItem[] = [
  { href: "/inventory", label: "Ekwipunek", icon: <Backpack size={20} /> },
  { href: "/decks", label: "Talie", icon: <Layers size={20} /> },
  { href: "/cosmetics", label: "Skórki", icon: <Shirt size={20} /> },
];

const ALL_ECONOMY_ITEMS: NavItem[] = [
  { href: "/shop", label: "Sklep", icon: <ShoppingBag size={20} /> },
  { href: "/marketplace", label: "Rynek", icon: <Store size={20} /> },
  { href: "/crafting", label: "Kuźnia", icon: <Hammer size={20} /> },
];

const ALL_OTHER_ITEMS: NavItem[] = [{ href: "/developers", label: "API", icon: <Code size={20} /> }];

/** Filter nav items based on system module state. */
function useFilteredNavItems() {
  const { isEnabled } = useSystemModules();

  const filterItems = (items: NavItem[]) =>
    items.filter((item) => {
      const slug = NAV_MODULE_MAP[item.href];
      return !slug || isEnabled(slug);
    });

  return {
    PLAY_ITEMS: filterItems(ALL_PLAY_ITEMS),
    LOADOUT_ITEMS: filterItems(ALL_LOADOUT_ITEMS),
    ECONOMY_ITEMS: filterItems(ALL_ECONOMY_ITEMS),
    OTHER_ITEMS: filterItems(ALL_OTHER_ITEMS),
  };
}

// ---------------------------------------------------------------------------
// Profile popover (click on avatar → submenu with profile/settings/logout)
// ---------------------------------------------------------------------------

function ProfilePopover({
  user,
  wallet,
  collapsed,
  onLogout,
}: {
  user: { username: string; elo_rating: number; email: string; clan_tag?: string | null };
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
          open ? "bg-muted" : "hover:bg-muted",
        )}
      >
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/15 text-xs font-bold uppercase text-primary">
          {initial}
        </div>
        {!collapsed && (
          <>
            <span className="flex-1 truncate text-left text-sm font-medium text-foreground">
              {user.clan_tag && <ClanTag tag={user.clan_tag} className="text-xs mr-1" />}
              {user.username}
            </span>
            <ChevronRight
              size={14}
              className={cn("shrink-0 text-muted-foreground/50 transition-transform duration-200", open && "rotate-90")}
            />
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
            onClick={() => {
              setOpen(false);
              onLogout();
            }}
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
          <Link
            href="/profile"
            onClick={() => setOpen(false)}
            title="Profil"
            className="flex h-8 w-10 items-center justify-center rounded text-slate-400 hover:bg-white/10 hover:text-zinc-100 transition-colors"
          >
            <UserCircle size={16} />
          </Link>
          <Link
            href="/settings"
            onClick={() => setOpen(false)}
            title="Ustawienia"
            className="flex h-8 w-10 items-center justify-center rounded text-slate-400 hover:bg-white/10 hover:text-zinc-100 transition-colors"
          >
            <Settings size={16} />
          </Link>
          <button
            onClick={() => {
              setOpen(false);
              onLogout();
            }}
            title="Wyloguj"
            className="flex h-8 w-10 items-center justify-center rounded text-red-400 hover:bg-red-500/10 transition-colors"
          >
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
  shop: "Sklep",
  marketplace: "Rynek",
  crafting: "Kuźnia",
  developers: "Deweloperzy",
  friends: "Znajomi",
  messages: "Wiadomości",
  profile: "Profil",
  settings: "Ustawienia",
  lobby: "Lobby",
  match: "Mecz",
  replay: "Powtórka",
  docs: "Dokumentacja",
  notifications: "Powiadomienia",
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
    const href = `/${segments.slice(0, i + 1).join("/")}`;
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
const ALL_BOTTOM_PRIMARY: NavItem[] = [
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
  const active = item.matchExact ? pathname === item.href : pathname.startsWith(item.href);

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
            ? "bg-primary/10 text-primary shadow-[0_0_8px_oklch(0.8_0.15_85/0.15)]"
            : "text-muted-foreground hover:text-foreground hover:bg-muted",
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
          ? "bg-primary/10 text-primary shadow-[inset_2px_0_0_var(--primary),0_0_8px_oklch(0.8_0.15_85/0.15)]"
          : "text-muted-foreground hover:text-foreground hover:bg-muted",
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

function DesktopSidebarContent({ pathname, collapsed }: { pathname: string; collapsed: boolean }) {
  const { PLAY_ITEMS, LOADOUT_ITEMS, ECONOMY_ITEMS, OTHER_ITEMS } = useFilteredNavItems();
  const groups = [
    { label: "GRA", items: PLAY_ITEMS },
    { label: "WYPOSAŻENIE", items: LOADOUT_ITEMS },
    { label: "HANDEL", items: ECONOMY_ITEMS },
    { label: "WIĘCEJ", items: OTHER_ITEMS },
  ].filter((g) => g.items.length > 0);

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

function MobileSidebarContent({ pathname, onNavigate }: { pathname: string; onNavigate?: () => void }) {
  const { PLAY_ITEMS, LOADOUT_ITEMS, ECONOMY_ITEMS, OTHER_ITEMS } = useFilteredNavItems();
  const groups = [
    { label: "GRA", items: PLAY_ITEMS },
    { label: "WYPOSAŻENIE", items: LOADOUT_ITEMS },
    { label: "HANDEL", items: ECONOMY_ITEMS },
    { label: "WIĘCEJ", items: OTHER_ITEMS },
    {
      label: "KONTO",
      items: [
        { href: "/profile", label: "Profil", icon: <UserCircle size={20} /> },
        { href: "/settings", label: "Ustawienia", icon: <Settings size={20} /> },
      ] as NavItem[],
    },
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
  const active = item.matchExact ? pathname === item.href : pathname.startsWith(item.href);

  return (
    <Link
      href={item.href}
      aria-current={active ? "page" : undefined}
      className={cn(
        "flex flex-1 flex-col items-center gap-0.5 px-2 py-2 text-xs font-medium transition-colors",
        active ? "text-accent" : "text-muted-foreground hover:text-foreground",
      )}
    >
      <span className={cn("transition-colors", active && "text-accent")}>{item.icon}</span>
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

  const isBlocked = inQueue && BLOCKED_DURING_QUEUE.some((p) => pathname === p || pathname.startsWith(`${p}/`));

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
  const {
    inQueue,
    lobbyId,
    lobbyPlayers,
    lobbyFull,
    allReady,
    queueSeconds,
    leaveQueue,
    matchId,
    setReady,
    readyCountdown,
  } = useMatchmaking();
  const { user } = useAuth();
  const router = useRouter();
  const myReady = lobbyPlayers.some((p) => p.user_id === user?.id && p.is_ready);
  const lobbyToastRef = useRef<string | number | null>(null);

  useEffect(() => {
    if (matchId) router.push(`/game/${matchId}`);
  }, [matchId, router]);

  // Toast when lobby full
  useEffect(() => {
    if (lobbyFull && !lobbyToastRef.current && !myReady) {
      try {
        const a = new Audio("/assets/audio/gui/int_message_alert.ogg");
        a.volume = 0.7;
        a.play().catch(() => {});
      } catch {}
      lobbyToastRef.current = toast.success("Mecz znaleziony!", {
        id: "matchmaking-lobby-found",
        description: "Kliknij Gotowy aby potwierdzić",
        duration: Infinity,
        action: {
          label: "Gotowy!",
          onClick: () => setReady(),
        },
        classNames: {
          actionButton:
            "!bg-green-500 !text-white !font-bold !rounded-lg !px-4 !py-2 !text-sm hover:!bg-green-400 !border-0",
        },
      });
    }
    if (!lobbyFull && lobbyToastRef.current) {
      toast.dismiss(lobbyToastRef.current);
      lobbyToastRef.current = null;
    }
  }, [lobbyFull, myReady, setReady]);

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
  const countdownStr =
    readyCountdown !== null
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
                  player.is_bot && "opacity-70",
                )}
              >
                {player.username.charAt(0)}
              </div>
            ))}
          </Link>
        )}

        <div className="flex items-center gap-1.5 rounded-full bg-primary/10 border border-primary/20 pl-3 pr-1.5 py-1">
          <div className="h-1.5 w-1.5 rounded-full bg-primary animate-pulse" />
          <span className="text-sm font-semibold text-primary tabular-nums">
            {mins}:{secs}
          </span>
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
          <Link href={lobbyId ? `/lobby/${lobbyId}` : "#"} className="flex -space-x-1.5 shrink-0">
            {lobbyPlayers.map((player) => (
              <div
                key={player.user_id}
                className={cn(
                  "flex h-6 w-6 items-center justify-center rounded-full border-[1.5px] text-[9px] font-bold uppercase",
                  player.is_ready
                    ? "border-green-500 bg-green-500/20 text-green-400"
                    : "border-border bg-secondary text-muted-foreground",
                  player.is_bot && "opacity-70",
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
          <span className="text-xs font-semibold text-primary tabular-nums">
            {mins}:{secs}
          </span>
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
// Sidebar friends panel
// ---------------------------------------------------------------------------

const FRIENDS_MAX_VISIBLE = 5;
const FRIENDS_REFRESH_INTERVAL = 15_000;

function SidebarFriendsPanel({ collapsed, currentUserId }: { collapsed: boolean; currentUserId: string | undefined }) {
  const { openDMTab: sidebarOpenDM } = useChat();
  const { data: friendsData } = useFriends(100, undefined, { refetchInterval: FRIENDS_REFRESH_INTERVAL });

  const friends = useMemo<FriendUser[]>(() => {
    if (!friendsData) return [];
    const resolved = friendsData.items.map((f: FriendshipOut) =>
      f.from_user.id === currentUserId ? f.to_user : f.from_user,
    );
    // Online friends first
    resolved.sort((a, b) => {
      const order = { in_game: 0, in_queue: 1, online: 2, offline: 3 };
      return (
        (order[a.activity_status as keyof typeof order] ?? 3) - (order[b.activity_status as keyof typeof order] ?? 3)
      );
    });
    return resolved;
  }, [friendsData, currentUserId]);

  const count = friends.length;
  const _visible = friends.slice(0, FRIENDS_MAX_VISIBLE);
  const _hasMore = count > FRIENDS_MAX_VISIBLE;

  // Collapsed state: just the Users icon with an optional count badge
  if (collapsed) {
    return (
      <div className="border-t border-border">
        <Link
          href="/friends"
          title={`Znajomi (${count})`}
          className="relative flex items-center justify-center py-3 text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
        >
          <Users size={20} />
          {count > 0 && (
            <span className="absolute top-2 right-2 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-primary text-[9px] font-bold text-primary-foreground leading-none">
              {count > 9 ? "9+" : count}
            </span>
          )}
        </Link>
      </div>
    );
  }

  // Expanded state
  return (
    <div className="border-t border-border">
      {/* Header row */}
      <div className="flex items-center gap-2 px-3 pt-3 pb-2">
        <span className="flex-1 text-[10px] font-semibold uppercase tracking-[0.2em] text-muted-foreground/60 select-none">
          Znajomi
        </span>
        {count > 0 && (
          <span className="flex h-4 min-w-4 items-center justify-center rounded-full bg-secondary px-1 text-[10px] font-bold tabular-nums text-muted-foreground">
            {count}
          </span>
        )}
        <Link
          href="/friends"
          title="Przejdź do znajomych"
          className="flex h-5 w-5 items-center justify-center rounded text-muted-foreground/50 hover:text-foreground hover:bg-muted transition-colors"
        >
          <ExternalLink size={12} />
        </Link>
      </div>

      {/* Friend rows */}
      {count === 0 ? (
        <p className="px-3 pb-3 text-[11px] text-muted-foreground/50 select-none">Brak znajomych</p>
      ) : (
        <div className="flex flex-col px-2 pb-2 gap-0.5 overflow-y-auto max-h-[280px] scrollbar-thin scrollbar-thumb-border">
          {friends.map((friend) => (
            <div
              key={friend.id}
              className="flex h-8 items-center gap-2 rounded-md px-2 hover:bg-muted transition-colors group shrink-0"
            >
              {/* Avatar initial with activity dot — click → profile */}
              <Link href={`/profile/${friend.id}`} className="relative shrink-0">
                <div className="flex h-6 w-6 items-center justify-center rounded-full bg-primary/15 text-[10px] font-bold uppercase text-primary">
                  {friend.username.charAt(0)}
                </div>
                <div
                  className={cn(
                    "absolute -bottom-0.5 -right-0.5 h-2 w-2 rounded-full border-2 border-card",
                    activityDot(friend.activity_status),
                  )}
                />
              </Link>
              {/* Username — click → profile */}
              <Link
                href={`/profile/${friend.id}`}
                className="flex-1 truncate text-[12px] font-medium text-foreground hover:text-primary transition-colors"
              >
                {friend.clan_tag && <ClanTag tag={friend.clan_tag} className="text-[10px] mr-0.5" />}
                {friend.username}
              </Link>
              {/* Chat */}
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  sidebarOpenDM(friend.id, friend.username);
                }}
                className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-muted-foreground/40 opacity-0 group-hover:opacity-100 hover:text-primary hover:bg-primary/10 transition-all"
                title={`Czat z ${friend.username}`}
              >
                <MessageSquare size={11} />
              </button>
              {/* ELO */}
              <span className="text-[10px] tabular-nums text-muted-foreground shrink-0">{friend.elo_rating}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Notification bell helpers
// ---------------------------------------------------------------------------

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "teraz";
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  const days = Math.floor(hrs / 24);
  return `${days}d`;
}

function activityDot(status: string): string {
  switch (status) {
    case "in_game":
      return "bg-accent";
    case "in_queue":
      return "bg-yellow-500";
    case "online":
      return "bg-green-500";
    default:
      return "bg-muted-foreground/30";
  }
}

function notifIcon(type: string) {
  switch (type) {
    case "friend_request_received":
      return <UserPlus size={15} className="text-primary shrink-0" />;
    case "friend_request_accepted":
      return <Check size={15} className="text-green-400 shrink-0" />;
    case "match_won":
      return <Trophy size={15} className="text-accent shrink-0" />;
    case "match_lost":
      return <X size={15} className="text-destructive shrink-0" />;
    case "player_eliminated":
      return <Shield size={15} className="text-destructive shrink-0" />;
    case "game_invite":
      return <Swords size={15} className="text-primary shrink-0" />;
    default:
      return <Bell size={15} className="text-muted-foreground shrink-0" />;
  }
}

function notifHref(n: { type: string; data: Record<string, unknown> }): string | null {
  switch (n.type) {
    case "friend_request_received":
      return "/friends";
    case "friend_request_accepted":
      return "/friends";
    case "game_invite":
      return n.data.lobby_id ? `/lobby/${n.data.lobby_id}` : "/dashboard";
    case "match_won":
    case "match_lost":
      return n.data.match_id ? `/match/${n.data.match_id}` : null;
    case "player_eliminated":
      return n.data.match_id ? `/match/${n.data.match_id}` : null;
    default:
      return null;
  }
}

function NotificationBell({
  token,
  onNotification,
  onGameInvite,
}: {
  token: string | null;
  onGameInvite?: (gameMode: string) => void;
  onNotification: (handler: (n: NotificationOut) => void) => () => void;
}) {
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const router = useRouter();
  const { unreadCount, notifications, loading, refreshList, markRead, markAllRead, handleIncoming } =
    useNotifications(token);

  // Register real-time notification handler from social socket
  useEffect(() => {
    return onNotification((notif) => {
      handleIncoming(notif);
    });
  }, [onNotification, handleIncoming]);

  useEffect(() => {
    setMounted(true);
  }, []);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  function handleToggle() {
    const next = !open;
    setOpen(next);
    if (next) refreshList();
  }

  if (!mounted) return null;

  return (
    <div ref={dropdownRef} className="relative">
      <button
        onClick={handleToggle}
        className="relative flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
        title="Powiadomienia"
        aria-label="Powiadomienia"
      >
        <Bell size={16} />
        {unreadCount > 0 && (
          <span className="absolute -top-0.5 -right-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-0.5 text-[9px] font-bold text-white leading-none">
            {unreadCount > 9 ? "9+" : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-2 w-[320px] sm:w-[380px] bg-card border border-border rounded-2xl shadow-xl z-50 overflow-hidden">
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-border">
            <span className="text-sm font-semibold text-foreground">Powiadomienia</span>
            {unreadCount > 0 && (
              <button
                onClick={markAllRead}
                className="flex items-center gap-1.5 text-xs text-primary hover:text-primary/80 transition-colors"
              >
                <CheckCheck size={13} />
                Oznacz wszystkie
              </button>
            )}
          </div>

          {/* List — only unread notifications */}
          <div className="max-h-[360px] overflow-y-auto">
            {loading ? (
              <div className="flex items-center justify-center py-8 text-muted-foreground text-sm">Ładowanie...</div>
            ) : (
              (() => {
                const unreadNotifs = notifications.filter((n) => !n.is_read);
                return unreadNotifs.length === 0 ? (
                  <div className="flex flex-col items-center justify-center gap-2 py-10 text-muted-foreground">
                    <Bell size={28} className="opacity-20" />
                    <span className="text-sm">Brak nowych powiadomień</span>
                  </div>
                ) : (
                  <div className="divide-y divide-border">
                    {unreadNotifs.map((n) => {
                      const isGameInvite = n.type === "game_invite" && !!n.data.lobby_id;

                      return (
                        <div
                          key={n.id}
                          onClick={() => {
                            if (isGameInvite) return; // handled by buttons
                            if (!n.is_read) markRead(n.id);
                            const href = notifHref(n);
                            if (href) {
                              setOpen(false);
                              router.push(href);
                            }
                          }}
                          className={cn(
                            "w-full flex flex-col gap-2 px-4 py-3 text-left transition-colors",
                            !isGameInvite && "hover:bg-muted/60 cursor-pointer",
                            !n.is_read && "bg-primary/5",
                          )}
                        >
                          <div className="flex items-start gap-3">
                            <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-secondary">
                              {notifIcon(n.type)}
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-semibold text-foreground truncate">{n.title}</p>
                              <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{n.body}</p>
                            </div>
                            <div className="flex flex-col items-end gap-1 shrink-0 ml-1">
                              <span className="text-[10px] text-muted-foreground/60 tabular-nums">
                                {timeAgo(n.created_at)}
                              </span>
                              {!n.is_read && !isGameInvite && <span className="h-1.5 w-1.5 rounded-full bg-primary" />}
                            </div>
                          </div>
                          {isGameInvite && (
                            <div className="flex items-center gap-2 pl-10">
                              <button
                                onClick={async (e) => {
                                  e.stopPropagation();
                                  try {
                                    const { acceptGameInvite } = await import("@/lib/api");
                                    const result = await acceptGameInvite(token!, n.id);
                                    markRead(n.id);
                                    setOpen(false);
                                    if (onGameInvite && result.game_mode) {
                                      onGameInvite(result.game_mode);
                                    }
                                    toast.success("Dołączono do lobby!", { id: "layout-lobby-join" });
                                  } catch {
                                    toast.error("Nie udało się dołączyć", { id: "layout-lobby-join-error" });
                                  }
                                }}
                                className="flex items-center gap-1.5 rounded-lg bg-green-500/15 px-3 py-1.5 text-xs font-semibold text-green-400 hover:bg-green-500/25 transition-colors"
                              >
                                <Check size={13} />
                                Dołącz
                              </button>
                              <button
                                onClick={async (e) => {
                                  e.stopPropagation();
                                  try {
                                    const { rejectGameInvite } = await import("@/lib/api");
                                    await rejectGameInvite(token!, n.id);
                                    markRead(n.id);
                                    toast("Zaproszenie odrzucone");
                                  } catch {
                                    toast.error("Błąd", { id: "layout-invite-reject-error" });
                                  }
                                }}
                                className="flex items-center gap-1.5 rounded-lg bg-destructive/10 px-3 py-1.5 text-xs font-semibold text-destructive hover:bg-destructive/20 transition-colors"
                              >
                                <X size={13} />
                                Odrzuć
                              </button>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                );
              })()
            )}
          </div>

          {/* Footer */}
          <div className="border-t border-border px-4 py-2.5">
            <Link
              href="/notifications"
              onClick={() => setOpen(false)}
              className="flex items-center justify-center gap-1.5 text-xs text-primary hover:text-primary/80 transition-colors py-1"
            >
              Zobacz wszystkie
              <ChevronRight size={13} />
            </Link>
          </div>
        </div>
      )}
    </div>
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
  const queryClient = useQueryClient();
  const { inQueue: showQueueSubheader, joinQueue } = useMatchmaking();
  const router = useRouter();
  const pathname = usePathname();
  const { data: wallet } = useMyWallet();
  const { data: gemWallet } = useGemWallet();
  const [sheetOpen, setSheetOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(() => {
    if (typeof window === "undefined") return false;
    return localStorage.getItem("sidebar-collapsed") === "true";
  });

  // Social WebSocket — real-time notifications and direct messages
  const social = useSocialSocket(token);

  // Show a toast whenever a new notification arrives (deduplicate by id)
  const seenNotifIdsRef = useRef(new Set<string>());
  useEffect(() => {
    return social.onNotification((notif) => {
      if (seenNotifIdsRef.current.has(notif.id)) return;
      seenNotifIdsRef.current.add(notif.id);
      // Keep set small
      if (seenNotifIdsRef.current.size > 50) {
        const arr = [...seenNotifIdsRef.current];
        seenNotifIdsRef.current = new Set(arr.slice(-25));
      }
      // Invalidate notification cache on any new notification
      queryClient.invalidateQueries({ queryKey: queryKeys.notifications.all });
      // Invalidate friend-related queries on friend events
      if (notif.type === "friend_request_received" || notif.type === "friend_request_accepted") {
        queryClient.invalidateQueries({ queryKey: queryKeys.friends.all });
      }
      // Invalidate match queries on match outcome notifications
      if (["match_won", "match_lost", "player_eliminated"].includes(notif.type)) {
        queryClient.invalidateQueries({ queryKey: queryKeys.matches.all });
        queryClient.invalidateQueries({ queryKey: queryKeys.auth.me() });
      }
      if (notif.type === "game_invite" && notif.data.lobby_id) {
        toast(notif.title, {
          description: notif.body || undefined,
          duration: 30000,
          action: {
            label: "Dołącz",
            onClick: async () => {
              try {
                const { acceptGameInvite } = await import("@/lib/api");
                const result = await acceptGameInvite(token!, notif.id);
                if (result.game_mode) joinQueue(result.game_mode);
                toast.success("Dołączono do lobby!", { id: "layout-notif-lobby-join" });
              } catch {
                toast.error("Nie udało się dołączyć", { id: "layout-notif-lobby-join-error" });
              }
            },
          },
          classNames: {
            actionButton: "!bg-green-500 !text-white !font-bold",
          },
        });
      } else {
        toast(notif.title, { description: notif.body || undefined });
      }
    });
  }, [
    social.onNotification,
    token,
    joinQueue, // Invalidate notification cache on any new notification
    queryClient.invalidateQueries,
  ]);

  // Add DM tab silently when receiving a direct message (don't open chat)
  const { addDMTabSilent } = useChat();
  useEffect(() => {
    return social.onDirectMessage((msg) => {
      addDMTabSilent(msg.sender.id, msg.sender.username);
      queryClient.invalidateQueries({ queryKey: queryKeys.messages.conversations() });
      queryClient.invalidateQueries({ queryKey: queryKeys.messages.thread(msg.sender.id) });
      queryClient.invalidateQueries({ queryKey: queryKeys.messages.unreadCount() });
    });
  }, [social.onDirectMessage, addDMTabSilent, queryClient]);

  // Clan war started — show toast with redirect to game
  useEffect(() => {
    return social.onClanWarStarted((data) => {
      toast(`Wojna klanowa: ${data.challenger_tag} vs ${data.defender_tag}`, {
        id: "clan-war-started",
        description: "Mecz się rozpoczyna! Kliknij aby dołączyć.",
        duration: 30000,
        action: {
          label: "Do gry!",
          onClick: () => router.push(`/game/${data.match_id}`),
        },
        classNames: {
          actionButton: "!bg-red-500 !text-white !font-bold",
        },
      });
    });
  }, [social.onClanWarStarted, router]);

  // ── Menu background music ──────────────────────────────────
  const { startMenuMusic, stopMenuMusic, toggleMute, muted } = useAudio();
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    // Try autoplay immediately (works if user already interacted with the page)
    startMenuMusic();

    // Fallback: if browser blocked autoplay, start on next interaction
    const handleInteraction = () => {
      startMenuMusic();
    };
    window.addEventListener("click", handleInteraction);
    window.addEventListener("keydown", handleInteraction);
    return () => {
      window.removeEventListener("click", handleInteraction);
      window.removeEventListener("keydown", handleInteraction);
      stopMenuMusic();
    };
  }, [startMenuMusic, stopMenuMusic]);

  // ── Online stats ──────────────────────────────────────────
  const { data: onlineStats } = useOnlineStats({ refetchInterval: 15_000 });
  const stats = onlineStats ?? { online: 0, in_queue: 0, in_game: 0 };

  const toggleCollapsed = () => {
    setCollapsed((prev) => {
      const next = !prev;
      localStorage.setItem("sidebar-collapsed", String(next));
      return next;
    });
  };

  const sidebarWidth = collapsed ? "w-14" : "w-56";
  const contentPadding = collapsed ? "md:pl-14" : "md:pl-56";

  return (
    <SocialSocketContext.Provider value={social}>
      <div className="min-h-screen bg-background text-foreground">
        {/* ------------------------------------------------------------------ */}
        {/* Top bar                                                             */}
        {/* ------------------------------------------------------------------ */}
        <header className="fixed inset-x-0 top-0 z-40 h-12 border-b border-border bg-card/80 backdrop-blur-xl">
          <div className="flex h-full items-center gap-3 px-4">
            {/* Logo */}
            <Link href="/dashboard" className="flex shrink-0 items-center gap-2.5 mr-2">
              <img src="/zelqor-z.svg" alt="" width={28} height={28} className="h-7 w-7" />
              <span className="font-display text-sm font-bold uppercase tracking-[0.18em] text-foreground">ZELQOR</span>
            </Link>

            {/* Online stats */}
            <div className="hidden md:flex items-center gap-3 text-[11px] tabular-nums text-muted-foreground">
              <span className="flex items-center gap-1.5">
                <span className="h-1.5 w-1.5 rounded-full bg-green-500" />
                <span className="font-medium">{stats.online}</span>
                <span className="text-muted-foreground/60">online</span>
              </span>
              {stats.in_game > 0 && (
                <span className="flex items-center gap-1.5">
                  <span className="h-1.5 w-1.5 rounded-full bg-accent" />
                  <span className="font-medium">{stats.in_game}</span>
                  <span className="text-muted-foreground/60">w grze</span>
                </span>
              )}
              {stats.in_queue > 0 && (
                <span className="flex items-center gap-1.5">
                  <span className="h-1.5 w-1.5 rounded-full bg-yellow-500" />
                  <span className="font-medium">{stats.in_queue}</span>
                  <span className="text-muted-foreground/60">szuka</span>
                </span>
              )}
            </div>

            <div className="flex-1" />

            {/* Music mute toggle */}
            {mounted && (
              <button
                onClick={toggleMute}
                className="flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                title={muted ? "Włącz dźwięk" : "Wycisz"}
              >
                {muted ? <VolumeX size={16} /> : <Volume2 size={16} />}
              </button>
            )}

            {/* Notification bell */}
            <NotificationBell
              token={token}
              onNotification={social.onNotification}
              onGameInvite={(mode) => joinQueue(mode)}
            />

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
              sidebarWidth,
            )}
          >
            {/* Avatar popover first, then stats below */}
            {user && (
              <div className="border-b border-border">
                {/* Avatar + name */}
                <div className={cn(collapsed ? "px-1 pt-2.5 pb-1.5" : "px-2 pt-3 pb-1.5")}>
                  <ProfilePopover user={user} wallet={wallet ?? null} collapsed={collapsed} onLogout={logout} />
                </div>
                {/* Stats */}
                {!collapsed && (
                  <div className="px-3 pb-3 pt-1 flex flex-col gap-1.5">
                    <div className="flex gap-2">
                      <div className="flex-1 flex items-center gap-2 rounded-lg bg-secondary/80 px-2.5 py-2">
                        <Trophy size={14} className="text-accent shrink-0" />
                        <span className="text-sm font-bold tabular-nums text-foreground">{user.elo_rating}</span>
                      </div>
                      {wallet && (
                        <div className="flex-1 flex items-center gap-2 rounded-lg bg-accent/[0.06] px-2.5 py-2">
                          <Coins size={14} className="text-accent shrink-0" />
                          <span className="text-sm font-bold tabular-nums text-accent">
                            {wallet.gold > 9999
                              ? `${Math.floor(wallet.gold / 1000)}k`
                              : wallet.gold.toLocaleString("pl-PL")}
                          </span>
                        </div>
                      )}
                    </div>
                    {gemWallet && (
                      <div className="flex items-center gap-2 rounded-lg bg-cyan-500/[0.06] px-2.5 py-2">
                        <Diamond size={14} className="text-cyan-400 shrink-0" />
                        <span className="text-sm font-bold tabular-nums text-cyan-300">
                          {gemWallet.gems > 9999
                            ? `${Math.floor(gemWallet.gems / 1000)}k`
                            : gemWallet.gems.toLocaleString("pl-PL")}
                        </span>
                        <span className="text-[11px] text-muted-foreground ml-auto">klejnotów</span>
                      </div>
                    )}
                  </div>
                )}
                {collapsed && (
                  <div className="flex flex-col items-center gap-1 px-1 pb-2">
                    <div
                      title={`ELO: ${user.elo_rating}`}
                      className="flex h-7 w-full items-center justify-center rounded-md bg-secondary text-[10px] font-bold tabular-nums text-foreground"
                    >
                      {user.elo_rating}
                    </div>
                    {wallet && (
                      <div
                        title={`${wallet.gold} złota`}
                        className="flex h-7 w-full items-center justify-center rounded-md bg-accent/10 text-[10px] font-bold tabular-nums text-accent"
                      >
                        {wallet.gold > 9999 ? `${Math.floor(wallet.gold / 1000)}k` : wallet.gold}
                      </div>
                    )}
                    {gemWallet && (
                      <div
                        title={`${gemWallet.gems} klejnotów`}
                        className="flex h-7 w-full items-center justify-center rounded-md bg-cyan-500/10 text-[10px] font-bold tabular-nums text-cyan-300"
                      >
                        <Diamond size={10} className="mr-1 shrink-0" />
                        {gemWallet.gems > 9999 ? `${Math.floor(gemWallet.gems / 1000)}k` : gemWallet.gems}
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

            {/* Friends panel */}
            <SidebarFriendsPanel collapsed={collapsed} currentUserId={user?.id} />

            {/* Collapse toggle */}
            <div className="border-t border-border">
              <button
                onClick={toggleCollapsed}
                className={cn(
                  "flex w-full items-center py-3 text-muted-foreground hover:text-foreground hover:bg-muted transition-colors",
                  collapsed ? "justify-center" : "gap-2.5 px-3",
                )}
                aria-label={collapsed ? "Rozwiń" : "Zwiń"}
                title={collapsed ? "Rozwiń" : "Zwiń"}
              >
                {collapsed ? (
                  <ChevronRight size={22} />
                ) : (
                  <>
                    <ChevronLeft size={22} />
                    <span className="text-base">Zwiń</span>
                  </>
                )}
              </button>
            </div>
          </aside>

          {/* ---------------------------------------------------------------- */}
          {/* Main content                                                      */}
          {/* ---------------------------------------------------------------- */}
          <main className={cn("flex-1 min-w-0 transition-all duration-200", contentPadding)}>
            <div className="px-4 py-4 pb-20 md:py-6 sm:px-6 lg:px-8 md:pb-6">
              <Breadcrumbs pathname={pathname} />
              <QueueGuard pathname={pathname}>{children}</QueueGuard>
            </div>
          </main>
        </div>

        {/* ------------------------------------------------------------------ */}
        {/* Mobile bottom bar                                                   */}
        {/* ------------------------------------------------------------------ */}
        <MobileBottomBar pathname={pathname} sheetOpen={sheetOpen} setSheetOpen={setSheetOpen} />
        <footer className="hidden border-t border-border px-6 py-3 text-center text-xs text-muted-foreground md:block">
          <span>&copy; {new Date().getFullYear()} Zelqor. Wszelkie prawa zastrzezone.</span>
        </footer>
      </div>
    </SocialSocketContext.Provider>
  );
}

function MobileBottomBar({
  pathname,
  sheetOpen,
  setSheetOpen,
}: {
  pathname: string;
  sheetOpen: boolean;
  setSheetOpen: (open: boolean) => void;
}) {
  const { isEnabled } = useSystemModules();
  const bottomItems = ALL_BOTTOM_PRIMARY.filter((item) => {
    const slug = NAV_MODULE_MAP[item.href];
    return !slug || isEnabled(slug);
  });

  return (
    <nav className="fixed inset-x-0 bottom-0 z-40 flex h-14 items-stretch border-t border-border bg-card/90 backdrop-blur-xl md:hidden">
      {bottomItems.map((item) => (
        <BottomBarItem key={item.href} item={item} pathname={pathname} />
      ))}

      {/* "Więcej" sheet trigger */}
      <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
        <SheetTrigger
          render={
            <button
              id="mobile-more-trigger"
              className={cn(
                "flex flex-1 flex-col items-center gap-0.5 px-3 py-2 text-[10px] font-medium transition-colors",
                "text-slate-400 hover:text-slate-300",
              )}
              aria-label="Więcej opcji"
            />
          }
        >
          <MoreHorizontal size={20} />
          <span>Więcej</span>
        </SheetTrigger>
        <SheetContent side="bottom" className="rounded-t-2xl border-t border-border bg-card px-0 pb-8 pt-4">
          <div className="mb-2 px-4 text-[11px] font-medium uppercase tracking-[0.2em] text-slate-400">NAWIGACJA</div>
          <MobileSidebarContent pathname={pathname} onNavigate={() => setSheetOpen(false)} />
        </SheetContent>
      </Sheet>
    </nav>
  );
}
