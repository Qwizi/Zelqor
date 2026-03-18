"use client";

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import {
  ChevronRight,
  Coins,
  Search,
  ShoppingCart,
  Store,
} from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useAuth } from "@/hooks/useAuth";
import { useModuleConfig } from "@/hooks/useSystemModules";
import { ModuleDisabledPage } from "@/components/ModuleGate";
import {
  cancelListing,
  getItemCategories,
  getMarketListings,
  getMyListings,
  getMyTradeHistory,
  getMyWallet,
  type ItemCategoryOut,
  type ItemOut,
  type MarketListingOut,
  type MarketTransactionOut,
  type WalletOut,
} from "@/lib/api";

// ─── Rarity styling maps ────────────────────────────────────────────────────

const RARITY_BORDER_LEFT: Record<string, string> = {
  common: "border-l-slate-500",
  uncommon: "border-l-green-500",
  rare: "border-l-blue-500",
  epic: "border-l-purple-500",
  legendary: "border-l-amber-500",
};

const RARITY_BADGE_CLASS: Record<string, string> = {
  common: "bg-slate-500/20 text-slate-300",
  uncommon: "bg-green-500/20 text-green-300",
  rare: "bg-blue-500/20 text-blue-300",
  epic: "bg-purple-500/20 text-purple-300",
  legendary: "bg-amber-500/20 text-amber-300",
};

const RARITY_TEXT: Record<string, string> = {
  common: "text-slate-300",
  uncommon: "text-green-300",
  rare: "text-blue-300",
  epic: "text-purple-300",
  legendary: "text-amber-300",
};

const RARITY_LABELS: Record<string, string> = {
  common: "Zwykły",
  uncommon: "Niepospolity",
  rare: "Rzadki",
  epic: "Epicki",
  legendary: "Legendarny",
};

const TYPE_LABELS: Record<string, string> = {
  material: "Materiał",
  blueprint_building: "Blueprint: Budynek",
  blueprint_unit: "Blueprint: Jednostka",
  tactical_package: "Pakiet taktyczny",
  boost: "Bonus",
  crate: "Skrzynka",
  key: "Klucz",
  cosmetic: "Kosmetyk",
};

const STATUS_LABELS: Record<string, string> = {
  active: "Aktywny",
  cancelled: "Anulowany",
  fulfilled: "Zrealizowany",
};

// ─── Types ────────────────────────────────────────────────────────────────────

type MainTab = "browse" | "my-listings" | "history";

const RARITY_LEFT_BORDER_SLOT: Record<string, string> = {
  common: "border-l-slate-500/50",
  uncommon: "border-l-green-500/50",
  rare: "border-l-blue-500/50",
  epic: "border-l-purple-500/50",
  legendary: "border-l-amber-500/50",
};
const RARITY_SLOT_BG: Record<string, string> = {
  common: "bg-slate-500/[0.07]",
  uncommon: "bg-green-500/[0.07]",
  rare: "bg-blue-500/[0.07]",
  epic: "bg-purple-500/[0.07]",
  legendary: "bg-amber-500/[0.07]",
};

interface AggregatedItem {
  item: ItemOut;
  cheapestPrice: number;
  listingCount: number;
}

// ─── Category filter config ────────────────────────────────────────────────

const CATEGORY_PILLS = [
  { value: "all", label: "Wszystko" },
  { value: "blueprint_building", label: "Blueprinty" },
  { value: "tactical_package", label: "Pakiety" },
  { value: "boost", label: "Bonusy" },
  { value: "material", label: "Materiały" },
  { value: "cosmetic", label: "Kosmetyki" },
];

// ─── Browse List ──────────────────────────────────────────────────────────

interface BrowseListProps {
  aggregated: AggregatedItem[];
  loading: boolean;
  search: string;
  onSearchChange: (v: string) => void;
  filterCategory: string;
  onFilterCategory: (v: string) => void;
  categories: ItemCategoryOut[];
}

function BrowseList({
  aggregated,
  loading,
  search,
  onSearchChange,
  filterCategory,
  onFilterCategory,
}: BrowseListProps) {
  const filtered = useMemo(() => {
    let items = aggregated;
    if (filterCategory !== "all") {
      items = items.filter((a) => a.item.item_type === filterCategory);
    }
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      items = items.filter((a) => a.item.name.toLowerCase().includes(q));
    }
    return items;
  }, [aggregated, filterCategory, search]);

  return (
    <div className="flex flex-col gap-5 lg:flex-row">
      <div className="flex-1 min-w-0">
        {/* Search */}
        <div className="relative mb-3 md:mb-4">
          <Search className="absolute left-3 top-1/2 h-4 w-4 md:h-5 md:w-5 -translate-y-1/2 text-muted-foreground" />
          <Input
            type="text"
            placeholder="Szukaj..."
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            className="pl-9 md:pl-10 h-10 md:h-12 text-sm md:text-base rounded-full md:rounded-lg"
          />
        </div>

        {/* Category pills (hidden on lg where sidebar shows) */}
        <div className="mb-3 md:mb-4 flex gap-1.5 md:gap-2 overflow-x-auto pb-0.5 scrollbar-none [-ms-overflow-style:none] [scrollbar-width:none] lg:hidden">
          {CATEGORY_PILLS.map((pill) => (
            <button
              key={pill.value}
              onClick={() => onFilterCategory(pill.value)}
              className={`shrink-0 rounded-full px-3 md:px-4 py-1.5 md:py-2 text-xs md:text-base font-medium transition-colors ${
                filterCategory === pill.value
                  ? "border border-primary/25 bg-primary/10 text-primary"
                  : "border border-border text-muted-foreground hover:bg-muted hover:border-border/50 hover:text-foreground"
              }`}
            >
              {pill.label}
            </button>
          ))}
        </div>

        {loading ? (
          <div className="space-y-2">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="h-16 md:h-20 animate-pulse rounded-xl border border-border/30 bg-muted/20" />
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div className="py-12 md:py-16 text-center">
            <Store className="mx-auto mb-3 h-8 w-8 md:h-10 md:w-10 text-muted-foreground" />
            <p className="text-sm md:text-lg text-muted-foreground">Brak ofert</p>
          </div>
        ) : (
          <div className="space-y-1 md:space-y-2">
            {filtered.map((agg) => {
              const rarity = agg.item.rarity ?? "common";
              return (
                <HoverCard key={agg.item.slug}>
                <HoverCardTrigger render={<div />}>
                <Link
                  href={`/marketplace/${agg.item.slug}`}
                  className="group flex items-center gap-3 md:gap-4 rounded-xl md:border md:border-border px-1 md:px-4 py-2.5 md:py-3.5 transition-all hover:bg-muted active:bg-muted/50"
                >
                  {/* Item icon */}
                  <div className={`flex h-10 w-10 md:h-14 md:w-14 shrink-0 items-center justify-center rounded-lg border border-l-2 border-border/60 text-lg md:text-2xl ${RARITY_LEFT_BORDER_SLOT[rarity]} ${RARITY_SLOT_BG[rarity]}`}>
                    {agg.item.icon || "📦"}
                  </div>

                  {/* Name + badges */}
                  <div className="flex-1 min-w-0">
                    <p className="truncate text-sm md:text-lg font-medium text-foreground">{agg.item.name}</p>
                    <div className="mt-0.5 flex items-center gap-1">
                      <span className={`rounded px-1 md:px-1.5 py-px text-[10px] md:text-sm font-medium ${RARITY_BADGE_CLASS[rarity]}`}>
                        {RARITY_LABELS[rarity]}
                      </span>
                      <span className="hidden md:inline text-sm text-muted-foreground">{TYPE_LABELS[agg.item.item_type] ?? agg.item.item_type}</span>
                    </div>
                  </div>

                  {/* Price */}
                  <div className="shrink-0 text-right">
                    {agg.cheapestPrice > 0 ? (
                      <>
                        <p className="text-sm md:text-lg font-mono tabular-nums text-accent">{agg.cheapestPrice}g</p>
                        <p className="text-[10px] md:text-sm text-muted-foreground">{agg.listingCount} ofert</p>
                      </>
                    ) : (
                      <p className="text-xs md:text-base text-muted-foreground">Brak</p>
                    )}
                  </div>

                  <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground/50 md:text-muted-foreground" />
                </Link>
                </HoverCardTrigger>
                <HoverCardContent side="right" sideOffset={8} className="hidden md:block w-80 p-5">
                  <div className="flex items-center gap-3 mb-3">
                    <span className="text-3xl">{agg.item.icon || "📦"}</span>
                    <div>
                      <p className={`text-lg font-semibold ${RARITY_TEXT[rarity]}`}>{agg.item.name}</p>
                      <div className="flex gap-1.5 mt-0.5">
                        <Badge className={`text-xs ${RARITY_BADGE_CLASS[rarity]}`} variant="outline">{RARITY_LABELS[rarity]}</Badge>
                        <Badge variant="outline" className="text-xs">{TYPE_LABELS[agg.item.item_type] ?? agg.item.item_type}</Badge>
                      </div>
                    </div>
                  </div>
                  {agg.item.description && (
                    <p className="text-sm text-muted-foreground mb-3">{agg.item.description}</p>
                  )}
                  <div className="flex gap-4 text-sm text-muted-foreground">
                    {agg.cheapestPrice > 0 && (
                      <span>Od: <span className="text-accent font-semibold">{agg.cheapestPrice}g</span></span>
                    )}
                    <span>Ofert: <span className="text-foreground font-semibold">{agg.listingCount}</span></span>
                  </div>
                </HoverCardContent>
                </HoverCard>
              );
            })}
          </div>
        )}
      </div>

      {/* Desktop sidebar filters */}
      <div className="hidden lg:block w-56 shrink-0">
        <p className="mb-3 text-xs uppercase tracking-[0.24em] text-muted-foreground font-medium">Kategoria</p>
        <div className="space-y-1">
          {CATEGORY_PILLS.map((pill) => (
            <button
              key={pill.value}
              onClick={() => onFilterCategory(pill.value)}
              className={`flex w-full items-center rounded-lg px-3 py-3 text-base transition-all text-left ${
                filterCategory === pill.value
                  ? "bg-primary/10 text-primary border border-primary/25"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground border border-transparent"
              }`}
            >
              {pill.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── My Listings Tab ─────────────────────────────────────────────────────

interface MyListingsTabProps {
  listings: MarketListingOut[];
  currentUsername: string;
  token: string;
  onRefresh: () => void;
}

function MyListingsTab({
  listings,
  token,
  onRefresh,
}: MyListingsTabProps) {
  const [cancelling, setCancelling] = useState<string | null>(null);

  const handleCancel = async (listingId: string) => {
    setCancelling(listingId);
    try {
      await cancelListing(token, listingId);
      toast.success("Oferta anulowana");
      onRefresh();
    } catch {
      toast.error("Nie udało się anulować");
    } finally {
      setCancelling(null);
    }
  };

  if (listings.length === 0) {
    return (
      <div className="py-12 md:py-16 text-center">
        <ShoppingCart className="mx-auto mb-3 h-8 w-8 md:h-10 md:w-10 text-muted-foreground" />
        <p className="text-sm md:text-lg text-muted-foreground">Brak aktywnych ofert</p>
      </div>
    );
  }

  return (
    <>
      {/* Mobile: clean list */}
      <div className="md:hidden space-y-1">
        {listings.map((listing) => (
          <div key={listing.id} className="flex items-center gap-3 py-3 px-1">
            <div
              className={`h-2 w-2 shrink-0 rounded-full ${
                listing.item.rarity === "legendary" ? "bg-amber-500"
                  : listing.item.rarity === "epic" ? "bg-purple-500"
                  : listing.item.rarity === "rare" ? "bg-blue-500"
                  : listing.item.rarity === "uncommon" ? "bg-green-500"
                  : "bg-slate-500"
              }`}
            />
            <div className="flex-1 min-w-0">
              <span className="text-sm font-medium text-foreground truncate block">{listing.item.name}</span>
              <span className="text-xs text-muted-foreground">
                {listing.quantity_remaining}/{listing.quantity} szt.
              </span>
            </div>
            <span className="font-mono text-sm tabular-nums text-accent shrink-0">{listing.price_per_unit}g</span>
            <Badge
              variant="outline"
              className={`shrink-0 rounded-full px-2 py-px text-[10px] border-0 ${
                listing.status === "active" ? "bg-green-500/15 text-green-400"
                  : listing.status === "cancelled" ? "bg-destructive/15 text-destructive"
                  : "bg-muted text-muted-foreground"
              }`}
            >
              {STATUS_LABELS[listing.status] ?? listing.status}
            </Badge>
            {listing.status === "active" && (
              <button
                onClick={() => handleCancel(listing.id)}
                disabled={cancelling === listing.id}
                className="text-xs text-destructive font-medium shrink-0 active:opacity-50"
              >
                {cancelling === listing.id ? "..." : "Anuluj"}
              </button>
            )}
          </div>
        ))}
      </div>

      {/* Desktop: table */}
      <div className="hidden md:block overflow-hidden rounded-xl border border-border/40">
        <Table className="text-base">
          <TableHeader>
            <TableRow className="bg-muted/30">
              <TableHead className="h-14 pl-6 text-base font-semibold text-muted-foreground">Przedmiot</TableHead>
              <TableHead className="h-14 text-base font-semibold text-muted-foreground">Typ</TableHead>
              <TableHead className="h-14 text-base font-semibold text-right text-muted-foreground">Cena</TableHead>
              <TableHead className="h-14 text-base font-semibold text-right text-muted-foreground">Pozostało</TableHead>
              <TableHead className="h-14 text-base font-semibold text-center text-muted-foreground">Status</TableHead>
              <TableHead className="h-14 pr-6 text-right text-muted-foreground" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {listings.map((listing) => (
              <TableRow key={listing.id} className="transition-colors hover:bg-muted/30">
                <TableCell className="pl-6 py-5">
                  <div className="flex items-center gap-3">
                    <div className={`h-2.5 w-2.5 rounded-full ${
                      listing.item.rarity === "legendary" ? "bg-amber-500"
                        : listing.item.rarity === "epic" ? "bg-purple-500"
                        : listing.item.rarity === "rare" ? "bg-blue-500"
                        : listing.item.rarity === "uncommon" ? "bg-green-500"
                        : "bg-slate-500"
                    }`} />
                    <span className="text-base font-medium text-foreground">{listing.item.name}</span>
                  </div>
                </TableCell>
                <TableCell className="py-5 text-base text-muted-foreground">
                  {listing.listing_type === "sell" ? "Sprzedaż" : "Kupno"}
                </TableCell>
                <TableCell className="py-5 text-right font-mono tabular-nums text-base text-accent">{listing.price_per_unit}g</TableCell>
                <TableCell className="py-5 text-right text-base text-foreground/80">{listing.quantity_remaining}/{listing.quantity}</TableCell>
                <TableCell className="py-5 text-center">
                  <Badge variant="outline" className={`rounded-full px-3 py-1 text-sm border-0 ${
                    listing.status === "active" ? "bg-green-500/15 text-green-400 hover:bg-green-500/15"
                      : listing.status === "cancelled" ? "bg-destructive/15 text-destructive hover:bg-destructive/15"
                      : "bg-muted text-muted-foreground hover:bg-muted"
                  }`}>
                    {STATUS_LABELS[listing.status] ?? listing.status}
                  </Badge>
                </TableCell>
                <TableCell className="py-5 pr-6 text-right">
                  {listing.status === "active" && (
                    <Button size="sm" variant="ghost" onClick={() => handleCancel(listing.id)} disabled={cancelling === listing.id}
                      className="h-11 rounded-md bg-destructive/10 px-4 text-base text-destructive transition-colors hover:bg-destructive/20 disabled:opacity-50">
                      {cancelling === listing.id ? "..." : "Anuluj"}
                    </Button>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </>
  );
}

// ─── History Tab ─────────────────────────────────────────────────────────

interface HistoryTabProps {
  history: MarketTransactionOut[];
  currentUsername: string;
}

function HistoryTab({ history, currentUsername }: HistoryTabProps) {
  if (history.length === 0) {
    return (
      <div className="py-12 md:py-16 text-center">
        <Coins className="mx-auto mb-3 h-8 w-8 md:h-10 md:w-10 text-muted-foreground" />
        <p className="text-sm md:text-lg text-muted-foreground">Brak transakcji</p>
      </div>
    );
  }

  return (
    <>
      {/* Mobile: clean list */}
      <div className="md:hidden space-y-1">
        {history.map((tx) => {
          const isBuyer = tx.buyer_username === currentUsername;
          return (
            <div key={tx.id} className="flex items-center gap-3 py-3 px-1">
              <div className="flex-1 min-w-0">
                <span className="text-sm font-medium text-foreground truncate block">{tx.item.name}</span>
                <span className="text-xs text-muted-foreground">
                  {new Date(tx.created_at).toLocaleDateString("pl-PL", { day: "numeric", month: "short" })}
                  {tx.quantity > 1 && <span className="ml-1">x{tx.quantity}</span>}
                </span>
              </div>
              <span className={`font-mono text-sm tabular-nums shrink-0 ${isBuyer ? "text-destructive" : "text-green-400"}`}>
                {isBuyer ? "-" : "+"}{isBuyer ? tx.total_price : tx.total_price - tx.fee}g
              </span>
              <Badge variant="outline" className={`shrink-0 rounded-full px-2 py-px text-[10px] border-0 ${
                isBuyer ? "bg-destructive/15 text-destructive" : "bg-green-500/15 text-green-400"
              }`}>
                {isBuyer ? "Kupno" : "Sprzedaż"}
              </Badge>
            </div>
          );
        })}
      </div>

      {/* Desktop: table */}
      <div className="hidden md:block overflow-hidden rounded-xl border border-border/40">
        <Table className="text-base">
          <TableHeader>
            <TableRow className="bg-muted/30">
              <TableHead className="h-14 pl-6 text-base font-semibold text-muted-foreground">Data</TableHead>
              <TableHead className="h-14 text-base font-semibold text-muted-foreground">Przedmiot</TableHead>
              <TableHead className="h-14 text-base font-semibold text-center text-muted-foreground">Typ</TableHead>
              <TableHead className="h-14 text-base font-semibold text-right text-muted-foreground">Ilość</TableHead>
              <TableHead className="h-14 text-base font-semibold text-right text-muted-foreground">Cena</TableHead>
              <TableHead className="h-14 pr-6 text-base font-semibold text-right text-muted-foreground">Prowizja</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {history.map((tx) => {
              const isBuyer = tx.buyer_username === currentUsername;
              return (
                <TableRow key={tx.id} className="transition-colors hover:bg-muted/30">
                  <TableCell className="pl-6 py-5 text-base text-muted-foreground">
                    {new Date(tx.created_at).toLocaleDateString("pl-PL")}
                  </TableCell>
                  <TableCell className="py-5 text-base font-medium text-foreground">{tx.item.name}</TableCell>
                  <TableCell className="py-5 text-center">
                    <Badge variant="outline" className={`rounded-full border-0 px-3 py-1 text-sm ${
                      isBuyer ? "bg-destructive/15 text-destructive hover:bg-destructive/15" : "bg-green-500/15 text-green-400 hover:bg-green-500/15"
                    }`}>
                      {isBuyer ? "Kupno" : "Sprzedaż"}
                    </Badge>
                  </TableCell>
                  <TableCell className="py-5 text-right text-base text-foreground/80">x{tx.quantity}</TableCell>
                  <TableCell className={`py-5 text-right font-mono tabular-nums text-base ${isBuyer ? "text-destructive" : "text-green-400"}`}>
                    {isBuyer ? "-" : "+"}{isBuyer ? tx.total_price : tx.total_price - tx.fee}g
                  </TableCell>
                  <TableCell className="py-5 pr-6 text-right font-mono tabular-nums text-base text-muted-foreground">
                    {tx.fee > 0 ? `${tx.fee}g` : "—"}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
    </>
  );
}

// ─── Main Page ─────────────────────────────────────────────────────────────

export default function MarketplacePage() {
  const { enabled } = useModuleConfig("marketplace");
  if (!enabled) return <ModuleDisabledPage slug="marketplace" />;

  return (
    <Suspense>
      <MarketplaceContent />
    </Suspense>
  );
}

function MarketplaceContent() {
  const { user, loading: authLoading, token } = useAuth();
  const router = useRouter();

  const [listings, setListings] = useState<MarketListingOut[]>([]);
  const [myListings, setMyListings] = useState<MarketListingOut[]>([]);
  const [history, setHistory] = useState<MarketTransactionOut[]>([]);
  const [wallet, setWallet] = useState<WalletOut | null>(null);
  const [categories, setCategories] = useState<ItemCategoryOut[]>([]);
  const [loading, setLoading] = useState(true);

  const searchParams = useSearchParams();
  const tabParam = searchParams.get("tab") as MainTab | null;
  const tab: MainTab = tabParam === "my-listings" || tabParam === "history" ? tabParam : "browse";
  const [search, setSearch] = useState("");
  const [filterCategory, setFilterCategory] = useState("all");

  useEffect(() => {
    if (!authLoading && !user) router.replace("/login");
  }, [user, authLoading, router]);

  const loadData = useCallback(async () => {
    if (!token) return;
    try {
      const [lsRes, mlRes, histRes, wal, cats] = await Promise.all([
        getMarketListings(),
        getMyListings(token),
        getMyTradeHistory(token),
        getMyWallet(token),
        getItemCategories(),
      ]);
      setListings(lsRes.items);
      setMyListings(mlRes.items);
      setHistory(histRes.items);
      setWallet(wal);
      setCategories(cats);
    } catch {
      toast.error("Nie udało się załadować rynku");
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const aggregatedItems = useMemo<AggregatedItem[]>(() => {
    const map = new Map<string, AggregatedItem>();
    for (const listing of listings) {
      const slug = listing.item.slug;
      if (!map.has(slug)) {
        map.set(slug, { item: listing.item, cheapestPrice: Infinity, listingCount: 0 });
      }
      const agg = map.get(slug)!;
      agg.listingCount += 1;
      if ((listing.listing_type === "sell" || !listing.listing_type) && listing.price_per_unit < agg.cheapestPrice) {
        agg.cheapestPrice = listing.price_per_unit;
      }
    }
    for (const agg of map.values()) {
      if (agg.cheapestPrice === Infinity) agg.cheapestPrice = 0;
    }
    return Array.from(map.values()).sort((a, b) => a.cheapestPrice - b.cheapestPrice);
  }, [listings]);

  if (authLoading || !user) return null;

  return (
    <div className="space-y-3 md:space-y-8 -mx-4 md:mx-0 -mt-2 md:mt-0">
      {/* Header */}
      <div className="px-4 md:px-0">
        <p className="hidden md:block text-xs uppercase tracking-[0.24em] text-muted-foreground">Rynek</p>
        <h1 className="font-display text-2xl md:text-5xl text-foreground">Rynek</h1>
      </div>

      {/* Wallet */}
      <div className="px-4 md:px-0">
        {/* Mobile: compact inline */}
        <div className="flex items-center gap-2.5 md:hidden">
          <Coins className="h-5 w-5 text-accent" />
          <span className="font-display text-xl tabular-nums text-accent">{wallet?.gold ?? "—"}</span>
          <span className="text-xs text-muted-foreground">złota</span>
          <span className="ml-auto text-[10px] text-muted-foreground">Prowizja 5%</span>
        </div>

        {/* Desktop: card */}
        <Card className="hidden md:block rounded-2xl backdrop-blur-xl">
          <CardContent className="flex items-center justify-between px-6 py-4">
            <div className="flex items-center gap-3">
              <Coins className="h-6 w-6 text-accent" />
              <span className="font-mono tabular-nums text-2xl font-semibold text-accent">{wallet?.gold ?? "—"}</span>
              <span className="text-base text-muted-foreground">złota</span>
            </div>
            <span className="text-base text-muted-foreground">Prowizja rynkowa: 5%</span>
          </CardContent>
        </Card>
      </div>

      {/* Tab bar */}
      <div className="flex gap-1 md:gap-1.5 overflow-x-auto px-4 md:px-0 scrollbar-none [-ms-overflow-style:none] [scrollbar-width:none]">
        {[
          { href: "/marketplace", label: "Przeglądaj", mobileLabel: "Oferty", key: "browse" as const },
          { href: "/marketplace?tab=my-listings", label: "Moje oferty", mobileLabel: "Moje", key: "my-listings" as const },
          { href: "/marketplace?tab=history", label: "Historia", mobileLabel: "Historia", key: "history" as const },
        ].map((t) => (
          <Link
            key={t.key}
            href={t.href}
            className={`shrink-0 rounded-full md:rounded-lg px-4 md:px-5 py-2 md:py-2.5 text-sm md:text-lg font-medium transition-colors ${
              tab === t.key
                ? "border border-primary/40 bg-primary/15 text-primary"
                : "border border-transparent text-muted-foreground hover:text-foreground hover:bg-muted"
            }`}
          >
            <span className="md:hidden">{t.mobileLabel}</span>
            <span className="hidden md:inline">{t.label}</span>
            {t.key === "my-listings" && myListings.length > 0 && (
              <span className="ml-1 md:ml-1.5 rounded-full bg-primary/20 px-1.5 py-0.5 text-[10px] md:text-sm text-primary">
                {myListings.filter((l) => l.status === "active").length}
              </span>
            )}
          </Link>
        ))}
      </div>

      {/* Content */}
      <div className="px-4 md:px-0">
        <div className="md:rounded-2xl md:border md:border-border md:bg-card md:backdrop-blur-xl md:p-6">
          {tab === "browse" && (
            <BrowseList
              aggregated={aggregatedItems}
              loading={loading}
              search={search}
              onSearchChange={setSearch}
              filterCategory={filterCategory}
              onFilterCategory={setFilterCategory}
              categories={categories}
            />
          )}

          {tab === "my-listings" && (
            <MyListingsTab
              listings={myListings}
              currentUsername={user.username}
              token={token!}
              onRefresh={loadData}
            />
          )}

          {tab === "history" && (
            <HistoryTab history={history} currentUsername={user.username} />
          )}
        </div>
      </div>
    </div>
  );
}
