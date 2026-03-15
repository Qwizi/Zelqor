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
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { useAuth } from "@/hooks/useAuth";
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
      {/* ── Lista przedmiotów (lewa strona) ── */}
      <div className="flex-1 min-w-0">
        {/* Search */}
        <div className="relative mb-4">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            type="text"
            placeholder="Szukaj przedmiotów..."
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            className="pl-9"
          />
        </div>

        {/* Mobile-only category pills (hidden on lg where sidebar shows) */}
        <div className="mb-4 flex gap-1.5 overflow-x-auto pb-0.5 scrollbar-none [-ms-overflow-style:none] [scrollbar-width:none] lg:hidden">
          {CATEGORY_PILLS.map((pill) => (
            <button
              key={pill.value}
              onClick={() => onFilterCategory(pill.value)}
              className={`shrink-0 rounded-full px-3 py-1 text-xs font-medium transition-colors ${
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
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="h-16 animate-pulse rounded-xl border border-border/30 bg-muted/20" />
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div className="py-16 text-center">
            <Store className="mx-auto mb-3 h-10 w-10 text-muted-foreground" />
            <p className="text-muted-foreground">Brak ofert spełniających kryteria</p>
          </div>
        ) : (
          <div className="space-y-1.5">
            {filtered.map((agg) => {
              const rarity = agg.item.rarity ?? "common";
              return (
                <Link
                  key={agg.item.slug}
                  href={`/marketplace/${agg.item.slug}`}
                  className="group flex items-center gap-3 rounded-xl border border-border px-3 py-2.5 transition-all hover:border-border/60 hover:bg-muted"
                >
                  {/* Item icon — inventory slot style */}
                  <div className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border border-l-2 border-border/60 text-xl ${RARITY_LEFT_BORDER_SLOT[rarity]} ${RARITY_SLOT_BG[rarity]}`}>
                    {agg.item.icon || "📦"}
                  </div>

                  {/* Name + badges */}
                  <div className="flex-1 min-w-0">
                    <p className="truncate text-sm font-medium text-foreground group-hover:text-foreground/90">{agg.item.name}</p>
                    <div className="mt-0.5 flex items-center gap-1.5">
                      <span className={`rounded px-1.5 py-px text-[9px] font-medium ${RARITY_BADGE_CLASS[rarity]}`}>
                        {RARITY_LABELS[rarity]}
                      </span>
                      <span className="text-[10px] text-muted-foreground">{TYPE_LABELS[agg.item.item_type] ?? agg.item.item_type}</span>
                    </div>
                  </div>

                  {/* Price */}
                  <div className="shrink-0 text-right">
                    {agg.cheapestPrice > 0 ? (
                      <>
                        <p className="text-sm font-mono tabular-nums text-accent">od {agg.cheapestPrice}g</p>
                        <p className="text-[10px] text-muted-foreground">{agg.listingCount} {agg.listingCount === 1 ? "oferta" : "ofert"}</p>
                      </>
                    ) : (
                      <p className="text-xs text-muted-foreground">Brak ofert</p>
                    )}
                  </div>

                  <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground group-hover:text-foreground transition-colors" />
                </Link>
              );
            })}
          </div>
        )}
      </div>

      {/* ── Filtry (prawa strona, desktop only) ── */}
      <div className="hidden lg:block w-48 shrink-0">
        <p className="mb-3 text-[11px] uppercase tracking-[0.24em] text-muted-foreground font-medium">Kategoria</p>
        <div className="space-y-1">
          {CATEGORY_PILLS.map((pill) => (
            <button
              key={pill.value}
              onClick={() => onFilterCategory(pill.value)}
              className={`flex w-full items-center rounded-lg px-3 py-2 text-sm transition-all text-left ${
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
      <div className="py-16 text-center">
        <ShoppingCart className="mx-auto mb-3 h-10 w-10 text-muted-foreground" />
        <p className="text-muted-foreground">Brak aktywnych ofert</p>
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-xl border border-border/40">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border bg-muted/30">
            <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground">
              Przedmiot
            </th>
            <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground">
              Typ
            </th>
            <th className="px-4 py-3 text-right text-xs font-medium text-muted-foreground">
              Cena
            </th>
            <th className="px-4 py-3 text-right text-xs font-medium text-muted-foreground">
              Pozostało
            </th>
            <th className="px-4 py-3 text-center text-xs font-medium text-muted-foreground">
              Status
            </th>
            <th className="px-4 py-3 text-right text-xs font-medium text-muted-foreground" />
          </tr>
        </thead>
        <tbody>
          {listings.map((listing, idx) => (
            <tr
              key={listing.id}
              className={`border-b border-border/30 transition-colors hover:bg-muted/30 ${
                idx % 2 === 0 ? "" : "bg-muted/10"
              }`}
            >
              <td className="px-4 py-3">
                <div className="flex items-center gap-2">
                  <div
                    className={`h-1.5 w-1.5 rounded-full ${
                      listing.item.rarity === "legendary"
                        ? "bg-amber-500"
                        : listing.item.rarity === "epic"
                          ? "bg-purple-500"
                          : listing.item.rarity === "rare"
                            ? "bg-blue-500"
                            : listing.item.rarity === "uncommon"
                              ? "bg-green-500"
                              : "bg-slate-500"
                    }`}
                  />
                  <span className="font-medium text-foreground">
                    {listing.item.name}
                  </span>
                </div>
              </td>
              <td className="px-4 py-3 text-muted-foreground">
                {listing.listing_type === "sell" ? "Sprzedaż" : "Kupno"}
              </td>
              <td className="px-4 py-3 text-right font-mono tabular-nums text-accent">
                {listing.price_per_unit}g
              </td>
              <td className="px-4 py-3 text-right text-foreground/80">
                {listing.quantity_remaining}/{listing.quantity}
              </td>
              <td className="px-4 py-3 text-center">
                <Badge
                  variant="outline"
                  className={`rounded-full px-2 py-0.5 text-xs border-0 ${
                    listing.status === "active"
                      ? "bg-green-500/15 text-green-400 hover:bg-green-500/15"
                      : "bg-muted text-muted-foreground hover:bg-muted"
                  }`}
                >
                  {listing.status === "active" ? "Aktywna" : listing.status}
                </Badge>
              </td>
              <td className="px-4 py-3 text-right">
                {listing.status === "active" && (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => handleCancel(listing.id)}
                    disabled={cancelling === listing.id}
                    className="rounded-md bg-destructive/10 px-2 py-1 text-xs text-destructive transition-colors hover:bg-destructive/20 disabled:opacity-50 h-auto"
                  >
                    {cancelling === listing.id ? "..." : "Anuluj"}
                  </Button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
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
      <div className="py-16 text-center">
        <Coins className="mx-auto mb-3 h-10 w-10 text-muted-foreground" />
        <p className="text-muted-foreground">Brak transakcji</p>
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-xl border border-border/40">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border bg-muted/30">
            <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground">
              Data
            </th>
            <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground">
              Przedmiot
            </th>
            <th className="px-4 py-3 text-center text-xs font-medium text-muted-foreground">
              Typ
            </th>
            <th className="px-4 py-3 text-right text-xs font-medium text-muted-foreground">
              Ilość
            </th>
            <th className="px-4 py-3 text-right text-xs font-medium text-muted-foreground">
              Cena
            </th>
            <th className="px-4 py-3 text-right text-xs font-medium text-muted-foreground">
              Prowizja
            </th>
          </tr>
        </thead>
        <tbody>
          {history.map((tx, idx) => {
            const isBuyer = tx.buyer_username === currentUsername;
            return (
              <tr
                key={tx.id}
                className={`border-b border-border/20 transition-colors hover:bg-muted/30 ${
                  idx % 2 === 0 ? "" : "bg-muted/10"
                }`}
              >
                <td className="px-4 py-3 text-muted-foreground">
                  {new Date(tx.created_at).toLocaleDateString("pl-PL")}
                </td>
                <td className="px-4 py-3 font-medium text-foreground">
                  {tx.item.name}
                </td>
                <td className="px-4 py-3 text-center">
                  <Badge
                    variant="outline"
                    className={`rounded-full border-0 px-2 py-0.5 text-xs ${
                      isBuyer
                        ? "bg-destructive/15 text-destructive hover:bg-destructive/15"
                        : "bg-green-500/15 text-green-400 hover:bg-green-500/15"
                    }`}
                  >
                    {isBuyer ? "Kupno" : "Sprzedaż"}
                  </Badge>
                </td>
                <td className="px-4 py-3 text-right text-foreground/80">
                  x{tx.quantity}
                </td>
                <td
                  className={`px-4 py-3 text-right font-mono tabular-nums ${
                    isBuyer ? "text-destructive" : "text-green-400"
                  }`}
                >
                  {isBuyer ? "-" : "+"}
                  {isBuyer ? tx.total_price : tx.total_price - tx.fee}g
                </td>
                <td className="px-4 py-3 text-right font-mono tabular-nums text-muted-foreground">
                  {tx.fee > 0 ? `${tx.fee}g` : "—"}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ─── Main Page ─────────────────────────────────────────────────────────────

export default function MarketplacePage() {
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

  // Aggregate all listings by unique item slug
  const aggregatedItems = useMemo<AggregatedItem[]>(() => {
    const map = new Map<string, AggregatedItem>();
    for (const listing of listings) {
      const slug = listing.item.slug;
      if (!map.has(slug)) {
        map.set(slug, {
          item: listing.item,
          cheapestPrice: Infinity,
          listingCount: 0,
        });
      }
      const agg = map.get(slug)!;
      agg.listingCount += 1;
      if (
        (listing.listing_type === "sell" || !listing.listing_type) &&
        listing.price_per_unit < agg.cheapestPrice
      ) {
        agg.cheapestPrice = listing.price_per_unit;
      }
    }
    for (const agg of map.values()) {
      if (agg.cheapestPrice === Infinity) agg.cheapestPrice = 0;
    }
    return Array.from(map.values()).sort(
      (a, b) => a.cheapestPrice - b.cheapestPrice
    );
  }, [listings]);

  if (authLoading || !user) return null;

  return (
    <div className="space-y-6">
      {/* Page header */}
      <div className="space-y-1">
        <p className="text-[11px] uppercase tracking-[0.24em] text-muted-foreground">Rynek</p>
        <h1 className="font-display text-3xl text-foreground">Rynek handlowy</h1>
      </div>

      {/* Wallet bar */}
      <Card className="rounded-2xl backdrop-blur-xl">
        <CardContent className="flex items-center justify-between px-5 py-2.5">
          <div className="flex items-center gap-2">
            <Coins className="h-4 w-4 text-accent" />
            <span className="font-mono tabular-nums text-lg font-semibold text-accent">
              {wallet?.gold ?? "—"}
            </span>
            <span className="text-sm text-muted-foreground">złota</span>
          </div>
          <span className="text-xs text-muted-foreground">Prowizja rynkowa: 5%</span>
        </CardContent>
      </Card>

      {/* Tab bar — URL-based via ?tab= */}
      <div className="flex gap-1 overflow-x-auto scrollbar-none [-ms-overflow-style:none] [scrollbar-width:none]">
        {[
          { href: "/marketplace", label: "Przeglądaj", key: "browse" as const },
          { href: "/marketplace?tab=my-listings", label: "Moje oferty", key: "my-listings" as const },
          { href: "/marketplace?tab=history", label: "Historia", key: "history" as const },
        ].map((t) => (
          <Link
            key={t.key}
            href={t.href}
            className={`rounded-lg px-3 py-1.5 text-sm transition-colors ${
              tab === t.key
                ? "border border-primary/40 bg-primary/15 text-primary"
                : "border border-transparent text-muted-foreground hover:text-foreground hover:bg-muted"
            }`}
          >
            {t.label}
            {t.key === "my-listings" && myListings.length > 0 && (
              <span className="ml-1.5 rounded-full bg-primary/20 px-1.5 py-0.5 text-[10px] text-primary">
                {myListings.filter((l) => l.status === "active").length}
              </span>
            )}
          </Link>
        ))}
      </div>

      {/* Main content panel */}
      <Card className="rounded-2xl backdrop-blur-xl">
        <CardContent className="p-6">
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
        </CardContent>
      </Card>
    </div>
  );
}
