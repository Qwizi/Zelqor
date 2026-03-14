"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Coins,
  Plus,
  ShoppingCart,
  Store,
  Tag,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/useAuth";
import {
  buyFromListing,
  cancelListing,
  createListing,
  getItemCategories,
  getMarketListings,
  getMyInventory,
  getMyListings,
  getMyTradeHistory,
  getMyWallet,
  type InventoryItemOut,
  type ItemCategoryOut,
  type MarketListingOut,
  type MarketTransactionOut,
  type WalletOut,
} from "@/lib/api";

const RARITY_COLORS: Record<string, string> = {
  common: "border-slate-500/30 text-slate-300",
  uncommon: "border-green-500/30 text-green-300",
  rare: "border-blue-500/30 text-blue-300",
  epic: "border-purple-500/30 text-purple-300",
  legendary: "border-amber-500/30 text-amber-300",
};

const RARITY_BG: Record<string, string> = {
  common: "bg-slate-500/10",
  uncommon: "bg-green-500/10",
  rare: "bg-blue-500/10",
  epic: "bg-purple-500/10",
  legendary: "bg-amber-500/10",
};

type Tab = "browse" | "my-listings" | "history" | "sell";

export default function MarketplacePage() {
  const { user, loading: authLoading, token } = useAuth();
  const router = useRouter();
  const [listings, setListings] = useState<MarketListingOut[]>([]);
  const [myListings, setMyListings] = useState<MarketListingOut[]>([]);
  const [history, setHistory] = useState<MarketTransactionOut[]>([]);
  const [wallet, setWallet] = useState<WalletOut | null>(null);
  const [inventory, setInventory] = useState<InventoryItemOut[]>([]);
  const [categories, setCategories] = useState<ItemCategoryOut[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<Tab>("browse");
  const [filterCategory, setFilterCategory] = useState<string>("all");

  // Sell form
  const [sellItemSlug, setSellItemSlug] = useState("");
  const [sellQty, setSellQty] = useState(1);
  const [sellPrice, setSellPrice] = useState(1);

  useEffect(() => {
    if (!authLoading && !user) router.replace("/login");
  }, [user, authLoading, router]);

  const loadData = useCallback(async () => {
    if (!token) return;
    try {
      const [ls, ml, hist, wal, inv, cats] = await Promise.all([
        getMarketListings(),
        getMyListings(token),
        getMyTradeHistory(token),
        getMyWallet(token),
        getMyInventory(token),
        getItemCategories(),
      ]);
      setListings(ls);
      setMyListings(ml);
      setHistory(hist);
      setWallet(wal);
      setInventory(inv);
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

  const handleBuy = async (listing: MarketListingOut) => {
    if (!token) return;
    try {
      const result = await buyFromListing(token, listing.id, 1);
      toast.success(result.message);
      loadData();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Błąd zakupu";
      toast.error(msg);
    }
  };

  const handleCancel = async (listingId: string) => {
    if (!token) return;
    try {
      await cancelListing(token, listingId);
      toast.success("Oferta anulowana");
      loadData();
    } catch {
      toast.error("Nie udało się anulować");
    }
  };

  const handleSell = async () => {
    if (!token || !sellItemSlug) return;
    try {
      await createListing(token, {
        item_slug: sellItemSlug,
        listing_type: "sell",
        quantity: sellQty,
        price_per_unit: sellPrice,
      });
      toast.success("Oferta wystawiona!");
      setSellItemSlug("");
      setSellQty(1);
      setSellPrice(1);
      setTab("my-listings");
      loadData();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Błąd wystawiania";
      toast.error(msg);
    }
  };

  const filteredListings =
    filterCategory === "all"
      ? listings
      : listings.filter((l) => {
          const cat = categories.find((c) =>
            c.items.some((i) => i.slug === l.item.slug)
          );
          return cat?.slug === filterCategory;
        });

  const tradeableInventory = inventory.filter((i) => i.item.is_tradeable);

  if (authLoading || !user) return null;

  return (
    <div className="space-y-6">
      {/* Wallet bar */}
      {wallet && (
        <div className="flex items-center justify-between rounded-2xl border border-white/10 bg-slate-950/55 px-6 py-3 backdrop-blur-xl">
          <div className="flex items-center gap-2">
            <Coins className="h-5 w-5 text-amber-300" />
            <span className="font-display text-xl text-amber-300">{wallet.gold}</span>
            <span className="text-sm text-slate-400">złota</span>
          </div>
          <div className="text-xs text-slate-500">
            Prowizja: 5%
          </div>
        </div>
      )}

      {/* Tabs */}
      <div className="flex flex-wrap gap-2">
        {([
          { key: "browse", label: "Przeglądaj", icon: Store },
          { key: "sell", label: "Sprzedaj", icon: Tag },
          { key: "my-listings", label: "Moje oferty", icon: ShoppingCart },
          { key: "history", label: "Historia", icon: Coins },
        ] as const).map((t) => (
          <Button
            key={t.key}
            variant={tab === t.key ? "default" : "ghost"}
            onClick={() => setTab(t.key)}
            className="rounded-full"
          >
            <t.icon className="mr-1.5 h-4 w-4" />
            {t.label}
          </Button>
        ))}
      </div>

      {/* Browse */}
      {tab === "browse" && (
        <div className="rounded-[24px] border border-white/10 bg-slate-950/55 p-6 backdrop-blur-xl">
          <div className="mb-4 flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-white/10 bg-white/[0.04]">
              <Store className="h-5 w-5 text-cyan-300" />
            </div>
            <div>
              <h3 className="font-display text-xl text-zinc-50">Rynek</h3>
              <p className="text-sm text-slate-400">{filteredListings.length} aktywnych ofert</p>
            </div>
          </div>

          {/* Category filter */}
          <div className="mb-4 flex flex-wrap gap-1.5">
            <button
              onClick={() => setFilterCategory("all")}
              className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                filterCategory === "all"
                  ? "border border-cyan-300/25 bg-cyan-400/10 text-cyan-100"
                  : "border border-white/10 text-slate-400 hover:bg-white/[0.06]"
              }`}
            >
              Wszystko
            </button>
            {categories.map((cat) => (
              <button
                key={cat.slug}
                onClick={() => setFilterCategory(cat.slug)}
                className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                  filterCategory === cat.slug
                    ? "border border-cyan-300/25 bg-cyan-400/10 text-cyan-100"
                    : "border border-white/10 text-slate-400 hover:bg-white/[0.06]"
                }`}
              >
                {cat.name}
              </button>
            ))}
          </div>

          {loading ? (
            <p className="text-center text-slate-400">Ładowanie...</p>
          ) : filteredListings.length === 0 ? (
            <p className="text-center text-slate-400">Brak ofert</p>
          ) : (
            <div className="space-y-2">
              {filteredListings.map((listing) => (
                <div
                  key={listing.id}
                  className={`flex items-center justify-between rounded-xl border p-3 ${RARITY_COLORS[listing.item.rarity]} ${RARITY_BG[listing.item.rarity]}`}
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-zinc-100 truncate">{listing.item.name}</span>
                      <span className="shrink-0 rounded-full bg-white/10 px-2 py-0.5 text-xs">
                        x{listing.quantity_remaining}
                      </span>
                    </div>
                    <div className="flex items-center gap-2 text-xs text-slate-400">
                      <span>{listing.seller_username}</span>
                      {listing.is_bot_listing && (
                        <span className="rounded bg-cyan-500/20 px-1.5 py-0.5 text-cyan-300">Bot</span>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="text-right">
                      <div className="flex items-center gap-1 text-amber-300">
                        <Coins className="h-3.5 w-3.5" />
                        <span className="font-display text-lg">{listing.price_per_unit}</span>
                      </div>
                      <p className="text-xs text-slate-500">za szt.</p>
                    </div>
                    {listing.seller_username !== user.username && (
                      <Button
                        size="sm"
                        className="rounded-full"
                        onClick={() => handleBuy(listing)}
                      >
                        Kup
                      </Button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Sell */}
      {tab === "sell" && (
        <div className="rounded-[24px] border border-white/10 bg-slate-950/55 p-6 backdrop-blur-xl">
          <div className="mb-4 flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-white/10 bg-white/[0.04]">
              <Plus className="h-5 w-5 text-green-300" />
            </div>
            <h3 className="font-display text-xl text-zinc-50">Wystaw na sprzedaż</h3>
          </div>

          <div className="space-y-4">
            <div>
              <label className="mb-1.5 block text-sm text-slate-300">Przedmiot</label>
              <select
                value={sellItemSlug}
                onChange={(e) => setSellItemSlug(e.target.value)}
                className="w-full rounded-xl border border-white/10 bg-white/[0.04] px-4 py-2.5 text-sm text-zinc-100 outline-none focus:border-cyan-400/50"
              >
                <option value="">Wybierz przedmiot...</option>
                {tradeableInventory.map((entry) => (
                  <option key={entry.id} value={entry.item.slug}>
                    {entry.item.name} (masz: {entry.quantity})
                  </option>
                ))}
              </select>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="mb-1.5 block text-sm text-slate-300">Ilość</label>
                <input
                  type="number"
                  min={1}
                  value={sellQty}
                  onChange={(e) => setSellQty(Math.max(1, +e.target.value))}
                  className="w-full rounded-xl border border-white/10 bg-white/[0.04] px-4 py-2.5 text-sm text-zinc-100 outline-none focus:border-cyan-400/50"
                />
              </div>
              <div>
                <label className="mb-1.5 block text-sm text-slate-300">Cena za szt. (złoto)</label>
                <input
                  type="number"
                  min={1}
                  value={sellPrice}
                  onChange={(e) => setSellPrice(Math.max(1, +e.target.value))}
                  className="w-full rounded-xl border border-white/10 bg-white/[0.04] px-4 py-2.5 text-sm text-zinc-100 outline-none focus:border-cyan-400/50"
                />
              </div>
            </div>
            {sellItemSlug && (
              <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3 text-sm text-slate-300">
                Suma: <span className="font-display text-amber-300">{sellQty * sellPrice}</span> złota
                <span className="ml-2 text-xs text-slate-500">
                  (otrzymasz {Math.floor(sellQty * sellPrice * 0.95)} po prowizji)
                </span>
              </div>
            )}
            <Button
              onClick={handleSell}
              disabled={!sellItemSlug}
              className="w-full rounded-full"
            >
              <Tag className="mr-1.5 h-4 w-4" />
              Wystaw ofertę
            </Button>
          </div>
        </div>
      )}

      {/* My Listings */}
      {tab === "my-listings" && (
        <div className="rounded-[24px] border border-white/10 bg-slate-950/55 p-6 backdrop-blur-xl">
          <div className="mb-4 flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-white/10 bg-white/[0.04]">
              <ShoppingCart className="h-5 w-5 text-cyan-300" />
            </div>
            <h3 className="font-display text-xl text-zinc-50">Moje oferty</h3>
          </div>

          {myListings.length === 0 ? (
            <p className="text-center text-slate-400">Brak aktywnych ofert</p>
          ) : (
            <div className="space-y-2">
              {myListings.map((listing) => (
                <div
                  key={listing.id}
                  className={`flex items-center justify-between rounded-xl border p-3 ${RARITY_COLORS[listing.item.rarity]} ${RARITY_BG[listing.item.rarity]}`}
                >
                  <div>
                    <span className="font-medium text-zinc-100">{listing.item.name}</span>
                    <span className="ml-2 text-xs text-slate-400">
                      {listing.quantity_remaining}/{listing.quantity} szt. @ {listing.price_per_unit}g
                    </span>
                    <span className={`ml-2 text-xs ${listing.status === "active" ? "text-green-300" : "text-slate-500"}`}>
                      {listing.status}
                    </span>
                  </div>
                  {listing.status === "active" && (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="rounded-full text-red-300 hover:bg-red-500/10"
                      onClick={() => handleCancel(listing.id)}
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* History */}
      {tab === "history" && (
        <div className="rounded-[24px] border border-white/10 bg-slate-950/55 p-6 backdrop-blur-xl">
          <div className="mb-4 flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-white/10 bg-white/[0.04]">
              <Coins className="h-5 w-5 text-amber-300" />
            </div>
            <h3 className="font-display text-xl text-zinc-50">Historia transakcji</h3>
          </div>

          {history.length === 0 ? (
            <p className="text-center text-slate-400">Brak transakcji</p>
          ) : (
            <div className="space-y-2">
              {history.map((tx) => {
                const isBuyer = tx.buyer_username === user.username;
                return (
                  <div
                    key={tx.id}
                    className="flex items-center justify-between rounded-xl border border-white/10 bg-white/[0.03] p-3"
                  >
                    <div>
                      <span className="font-medium text-zinc-100">{tx.item.name}</span>
                      <span className="ml-2 text-xs text-slate-400">x{tx.quantity}</span>
                      <p className="text-xs text-slate-500">
                        {isBuyer ? `Kupiono od ${tx.seller_username}` : `Sprzedano do ${tx.buyer_username}`}
                      </p>
                    </div>
                    <div className="text-right">
                      <div className={`flex items-center gap-1 ${isBuyer ? "text-red-300" : "text-green-300"}`}>
                        <Coins className="h-3 w-3" />
                        <span className="font-display">{isBuyer ? `-${tx.total_price}` : `+${tx.total_price - tx.fee}`}</span>
                      </div>
                      {tx.fee > 0 && !isBuyer && (
                        <p className="text-xs text-slate-500">prowizja: {tx.fee}</p>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
