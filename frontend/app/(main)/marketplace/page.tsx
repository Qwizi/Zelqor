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

const RARITY_BADGE: Record<string, string> = {
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
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
          <input
            type="text"
            placeholder="Szukaj przedmiotów..."
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            className="w-full rounded-xl border border-white/10 bg-white/[0.04] py-2.5 pl-9 pr-4 text-sm text-zinc-100 placeholder:text-slate-500 outline-none focus:border-cyan-400/50 transition-colors"
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
                  ? "border border-cyan-300/25 bg-cyan-400/10 text-cyan-100"
                  : "border border-white/10 text-slate-400 hover:bg-white/[0.10] hover:border-white/20 hover:text-slate-100"
              }`}
            >
              {pill.label}
            </button>
          ))}
        </div>

        {loading ? (
          <div className="space-y-2">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="h-16 animate-pulse rounded-xl border border-white/5 bg-white/[0.03]" />
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div className="py-16 text-center">
            <Store className="mx-auto mb-3 h-10 w-10 text-slate-500" />
            <p className="text-slate-400">Brak ofert spełniających kryteria</p>
          </div>
        ) : (
          <div className="space-y-1.5">
            {filtered.map((agg) => {
              const rarity = agg.item.rarity ?? "common";
              return (
                <Link
                  key={agg.item.slug}
                  href={`/marketplace/${agg.item.slug}`}
                  className="group flex items-center gap-3 rounded-xl border border-white/10 px-3 py-2.5 transition-all hover:border-white/20 hover:bg-white/[0.06]"
                >
                  {/* Item icon — inventory slot style */}
                  <div className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border border-l-2 border-white/10 text-xl ${RARITY_LEFT_BORDER_SLOT[rarity]} ${RARITY_SLOT_BG[rarity]}`}>
                    {agg.item.icon || "📦"}
                  </div>

                  {/* Name + badges */}
                  <div className="flex-1 min-w-0">
                    <p className="truncate text-sm font-medium text-zinc-200 group-hover:text-zinc-50">{agg.item.name}</p>
                    <div className="mt-0.5 flex items-center gap-1.5">
                      <span className={`rounded px-1.5 py-px text-[9px] font-medium ${RARITY_BADGE[rarity]}`}>
                        {RARITY_LABELS[rarity]}
                      </span>
                      <span className="text-[10px] text-slate-400">{TYPE_LABELS[agg.item.item_type] ?? agg.item.item_type}</span>
                    </div>
                  </div>

                  {/* Price */}
                  <div className="shrink-0 text-right">
                    {agg.cheapestPrice > 0 ? (
                      <>
                        <p className="text-sm font-mono tabular-nums text-amber-300">od {agg.cheapestPrice}g</p>
                        <p className="text-[10px] text-slate-400">{agg.listingCount} {agg.listingCount === 1 ? "oferta" : "ofert"}</p>
                      </>
                    ) : (
                      <p className="text-xs text-slate-400">Brak ofert</p>
                    )}
                  </div>

                  <ChevronRight className="h-4 w-4 shrink-0 text-slate-500 group-hover:text-slate-300 transition-colors" />
                </Link>
              );
            })}
          </div>
        )}
      </div>

      {/* ── Filtry (prawa strona, desktop only) ── */}
      <div className="hidden lg:block w-48 shrink-0">
        <p className="mb-3 text-[11px] uppercase tracking-[0.24em] text-slate-400 font-medium">Kategoria</p>
        <div className="space-y-1">
          {CATEGORY_PILLS.map((pill) => (
            <button
              key={pill.value}
              onClick={() => onFilterCategory(pill.value)}
              className={`flex w-full items-center rounded-lg px-3 py-2 text-sm transition-all text-left ${
                filterCategory === pill.value
                  ? "bg-cyan-500/10 text-cyan-200 border border-cyan-400/25"
                  : "text-slate-400 hover:bg-white/[0.08] hover:text-zinc-100 border border-transparent"
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
        <ShoppingCart className="mx-auto mb-3 h-10 w-10 text-slate-500" />
        <p className="text-slate-400">Brak aktywnych ofert</p>
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-xl border border-white/[0.08]">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-white/10 bg-white/[0.05]">
            <th className="px-4 py-3 text-left text-xs font-medium text-slate-400">
              Przedmiot
            </th>
            <th className="px-4 py-3 text-left text-xs font-medium text-slate-400">
              Typ
            </th>
            <th className="px-4 py-3 text-right text-xs font-medium text-slate-400">
              Cena
            </th>
            <th className="px-4 py-3 text-right text-xs font-medium text-slate-400">
              Pozostało
            </th>
            <th className="px-4 py-3 text-center text-xs font-medium text-slate-400">
              Status
            </th>
            <th className="px-4 py-3 text-right text-xs font-medium text-slate-500" />
          </tr>
        </thead>
        <tbody>
          {listings.map((listing, idx) => (
            <tr
              key={listing.id}
              className={`border-b border-white/[0.08] transition-colors hover:bg-white/[0.08] ${
                idx % 2 === 0 ? "" : "bg-white/[0.03]"
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
                  <span className="font-medium text-zinc-200">
                    {listing.item.name}
                  </span>
                </div>
              </td>
              <td className="px-4 py-3 text-slate-400">
                {listing.listing_type === "sell" ? "Sprzedaż" : "Kupno"}
              </td>
              <td className="px-4 py-3 text-right font-mono tabular-nums text-amber-300">
                {listing.price_per_unit}g
              </td>
              <td className="px-4 py-3 text-right text-slate-300">
                {listing.quantity_remaining}/{listing.quantity}
              </td>
              <td className="px-4 py-3 text-center">
                <span
                  className={`rounded-full px-2 py-0.5 text-xs ${
                    listing.status === "active"
                      ? "bg-green-500/15 text-green-400"
                      : "bg-slate-500/15 text-slate-400"
                  }`}
                >
                  {listing.status === "active" ? "Aktywna" : listing.status}
                </span>
              </td>
              <td className="px-4 py-3 text-right">
                {listing.status === "active" && (
                  <button
                    onClick={() => handleCancel(listing.id)}
                    disabled={cancelling === listing.id}
                    className="rounded-md bg-red-500/10 px-2 py-1 text-xs text-red-400 transition-colors hover:bg-red-500/20 disabled:opacity-50"
                  >
                    {cancelling === listing.id ? "..." : "Anuluj"}
                  </button>
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
        <Coins className="mx-auto mb-3 h-10 w-10 text-slate-500" />
        <p className="text-slate-400">Brak transakcji</p>
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-xl border border-white/[0.08]">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-white/10 bg-white/[0.05]">
            <th className="px-4 py-3 text-left text-xs font-medium text-slate-400">
              Data
            </th>
            <th className="px-4 py-3 text-left text-xs font-medium text-slate-400">
              Przedmiot
            </th>
            <th className="px-4 py-3 text-center text-xs font-medium text-slate-400">
              Typ
            </th>
            <th className="px-4 py-3 text-right text-xs font-medium text-slate-400">
              Ilość
            </th>
            <th className="px-4 py-3 text-right text-xs font-medium text-slate-400">
              Cena
            </th>
            <th className="px-4 py-3 text-right text-xs font-medium text-slate-400">
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
                className={`border-b border-white/[0.04] transition-colors hover:bg-white/[0.08] ${
                  idx % 2 === 0 ? "" : "bg-white/[0.02]"
                }`}
              >
                <td className="px-4 py-3 text-slate-400">
                  {new Date(tx.created_at).toLocaleDateString("pl-PL")}
                </td>
                <td className="px-4 py-3 font-medium text-zinc-200">
                  {tx.item.name}
                </td>
                <td className="px-4 py-3 text-center">
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs ${
                      isBuyer
                        ? "bg-red-500/15 text-red-400"
                        : "bg-green-500/15 text-green-400"
                    }`}
                  >
                    {isBuyer ? "Kupno" : "Sprzedaż"}
                  </span>
                </td>
                <td className="px-4 py-3 text-right text-slate-300">
                  x{tx.quantity}
                </td>
                <td
                  className={`px-4 py-3 text-right font-mono tabular-nums ${
                    isBuyer ? "text-red-300" : "text-green-300"
                  }`}
                >
                  {isBuyer ? "-" : "+"}
                  {isBuyer ? tx.total_price : tx.total_price - tx.fee}g
                </td>
                <td className="px-4 py-3 text-right font-mono tabular-nums text-slate-400">
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
        <p className="text-[11px] uppercase tracking-[0.24em] text-slate-400">Rynek</p>
        <h1 className="font-display text-3xl text-zinc-50">Rynek handlowy</h1>
      </div>

      {/* Wallet bar */}
      <div className="flex items-center justify-between rounded-2xl border border-white/10 bg-slate-950/55 px-5 py-2.5 backdrop-blur-xl">
        <div className="flex items-center gap-2">
          <Coins className="h-4 w-4 text-amber-400" />
          <span className="font-mono tabular-nums text-lg font-semibold text-amber-300">
            {wallet?.gold ?? "—"}
          </span>
          <span className="text-sm text-slate-400">złota</span>
        </div>
        <span className="text-xs text-slate-400">Prowizja rynkowa: 5%</span>
      </div>

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
                ? "bg-white/10 text-zinc-100"
                : "text-slate-400 hover:text-zinc-100 hover:bg-white/[0.10]"
            }`}
          >
            {t.label}
            {t.key === "my-listings" && myListings.length > 0 && (
              <span className="ml-1.5 rounded-full bg-cyan-500/20 px-1.5 py-0.5 text-[10px] text-cyan-400">
                {myListings.filter((l) => l.status === "active").length}
              </span>
            )}
          </Link>
        ))}
      </div>

      {/* Main content panel */}
      <div className="rounded-2xl border border-white/10 bg-slate-950/55 p-6 backdrop-blur-xl">
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
  );
}
