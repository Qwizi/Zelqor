"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Coins, Store } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/useAuth";
import {
  buyFromListing,
  createListing,
  getMarketConfig,
  getMarketListings,
  getMyInventory,
  getMyWallet,
  type InventoryItemOut,
  type MarketConfigOut,
  type MarketListingOut,
  type WalletOut,
} from "@/lib/api";

// ─── Rarity / type maps ───────────────────────────────────────────────────

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

// ─── Main Page ────────────────────────────────────────────────────────────

export default function MarketplaceItemPage() {
  const { user, loading: authLoading, token } = useAuth();
  const router = useRouter();
  const params = useParams<{ slug: string }>();
  const slug = params.slug;

  const [listings, setListings] = useState<MarketListingOut[]>([]);
  const [inventory, setInventory] = useState<InventoryItemOut[]>([]);
  const [wallet, setWallet] = useState<WalletOut | null>(null);
  const [config, setConfig] = useState<MarketConfigOut | null>(null);
  const [loading, setLoading] = useState(true);

  // Buy form state
  const [buyQty, setBuyQty] = useState(1);
  const [buying, setBuying] = useState(false);

  // Sell form state
  const [sellQty, setSellQty] = useState(1);
  const [sellPrice, setSellPrice] = useState(1);
  const [selling, setSelling] = useState(false);

  useEffect(() => {
    if (!authLoading && !user) router.replace("/login");
  }, [user, authLoading, router]);

  const loadData = useCallback(async () => {
    if (!token || !slug) return;
    try {
      const [lsRes, invRes, wal, cfg] = await Promise.all([
        getMarketListings(slug),
        getMyInventory(token),
        getMyWallet(token),
        getMarketConfig(),
      ]);
      setListings(lsRes.items);
      setInventory(invRes.items);
      setWallet(wal);
      setConfig(cfg);

      // Pre-fill sell price from cheapest listing
      const cheapest = lsRes.items
        .filter((l) => l.listing_type === "sell" || !l.listing_type)
        .sort((a, b) => a.price_per_unit - b.price_per_unit)[0];
      if (cheapest) setSellPrice(cheapest.price_per_unit);
    } catch {
      toast.error("Nie udało się załadować ofert");
    } finally {
      setLoading(false);
    }
  }, [token, slug]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  if (authLoading || !user) return null;

  // Derived data
  const sellListings = [...listings]
    .filter((l) => l.listing_type === "sell" || !l.listing_type)
    .sort((a, b) => a.price_per_unit - b.price_per_unit);

  const buyListings = [...listings]
    .filter((l) => l.listing_type === "buy")
    .sort((a, b) => b.price_per_unit - a.price_per_unit);

  // Representative item from any listing (or first sell listing)
  const representativeItem =
    sellListings[0]?.item ?? buyListings[0]?.item ?? null;

  // Cheapest sell listing available to current user
  const cheapestAvailable = sellListings.find(
    (l) => l.seller_username !== user.username
  );

  const ownedEntry = representativeItem
    ? inventory.find(
        (i) => i.item.slug === representativeItem.slug && i.item.is_tradeable
      )
    : null;
  const ownedQty = ownedEntry?.quantity ?? 0;

  const feePercent = config?.transaction_fee_percent ?? 5;
  const feeCost = Math.ceil(sellQty * sellPrice * (feePercent / 100));
  const netReceive = sellQty * sellPrice - feeCost;
  const buyCost = cheapestAvailable
    ? buyQty * cheapestAvailable.price_per_unit
    : 0;

  const handleBuyDirect = async (listing: MarketListingOut, qty = 1) => {
    if (!token) return;
    setBuying(true);
    try {
      const result = await buyFromListing(token, listing.id, qty);
      toast.success(result.message);
      await loadData();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Błąd zakupu";
      toast.error(msg);
    } finally {
      setBuying(false);
    }
  };

  const handleBuyCheapest = async () => {
    if (!cheapestAvailable) return;
    await handleBuyDirect(cheapestAvailable, buyQty);
  };

  const handleSell = async () => {
    if (!token || !representativeItem?.is_tradeable) return;
    setSelling(true);
    try {
      await createListing(token, {
        item_slug: slug,
        listing_type: "sell",
        quantity: sellQty,
        price_per_unit: sellPrice,
      });
      toast.success("Oferta wystawiona!");
      await loadData();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Błąd wystawiania";
      toast.error(msg);
    } finally {
      setSelling(false);
    }
  };

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="h-8 w-24 animate-pulse rounded-lg bg-white/[0.04]" />
        <div className="h-28 animate-pulse rounded-2xl border border-white/10 bg-white/[0.05]" />
        <div className="grid gap-4 md:grid-cols-2">
          <div className="h-48 animate-pulse rounded-xl border border-white/10 bg-white/[0.05]" />
          <div className="h-48 animate-pulse rounded-xl border border-white/10 bg-white/[0.05]" />
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Back link */}
      <Link
        href="/marketplace"
        className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-sm text-slate-400 transition-all hover:text-zinc-100 hover:bg-white/[0.08]"
      >
        <ArrowLeft className="h-4 w-4" />
        Powrót do rynku
      </Link>

      {/* Item header */}
      {representativeItem ? (
        <div className="flex gap-4 rounded-2xl border border-white/10 bg-slate-950/55 p-5 backdrop-blur-xl">
          <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-xl border border-white/10 bg-white/[0.05] text-3xl">
            {representativeItem.icon || "📦"}
          </div>
          <div className="min-w-0">
            <h1 className="font-display text-2xl text-zinc-50">
              {representativeItem.name}
            </h1>
            <p className="text-sm text-slate-400">
              {TYPE_LABELS[representativeItem.item_type] ??
                representativeItem.item_type}
            </p>
            <div className="mt-1 flex items-center gap-2">
              <span
                className={`rounded-full px-2 py-0.5 text-xs font-medium ${RARITY_BADGE[representativeItem.rarity] ?? "bg-slate-500/20 text-slate-300"}`}
              >
                {RARITY_LABELS[representativeItem.rarity] ??
                  representativeItem.rarity}
              </span>
            </div>
            {representativeItem.description && (
              <p className="mt-2 text-sm text-slate-400">
                {representativeItem.description}
              </p>
            )}
          </div>
        </div>
      ) : (
        <div className="flex items-center gap-3 rounded-2xl border border-white/[0.08] bg-slate-950/55 p-5 backdrop-blur-xl">
          <Store className="h-8 w-8 text-slate-500" />
          <div>
            <p className="font-medium text-slate-200">{slug}</p>
            <p className="text-sm text-slate-400">Brak aktywnych ofert</p>
          </div>
        </div>
      )}

      {/* Wallet strip */}
      <div className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/[0.05] px-4 py-2.5">
        <Coins className="h-4 w-4 text-amber-400" />
        <span className="font-mono tabular-nums text-amber-300">
          {wallet?.gold ?? "—"}
        </span>
        <span className="text-sm text-slate-400">złota</span>
        {ownedQty > 0 && (
          <>
            <span className="mx-2 text-slate-700">·</span>
            <span className="text-sm text-slate-300">
              Posiadasz:{" "}
              <span className="font-medium text-zinc-100">{ownedQty}</span>
            </span>
          </>
        )}
        <span className="ml-auto text-xs text-slate-400">
          Prowizja: {feePercent}%
        </span>
      </div>

      {/* Order books */}
      <div className="grid gap-4 md:grid-cols-2">
        {/* Sell listings */}
        <div>
          <h2 className="mb-2 text-sm font-medium text-slate-300">
            Oferty sprzedaży
          </h2>
          {sellListings.length === 0 ? (
            <p className="rounded-xl border border-white/10 py-8 text-center text-sm text-slate-400">
              Brak ofert sprzedaży
            </p>
          ) : (
            <div className="overflow-hidden rounded-xl border border-white/[0.08]">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-white/10 bg-white/[0.05]">
                    <th className="px-3 py-2 text-left text-xs font-medium text-slate-400">
                      Sprzedawca
                    </th>
                    <th className="px-3 py-2 text-right text-xs font-medium text-slate-400">
                      Cena
                    </th>
                    <th className="px-3 py-2 text-right text-xs font-medium text-slate-400">
                      Ilość
                    </th>
                    <th className="px-3 py-2 text-right text-xs font-medium text-slate-500" />
                  </tr>
                </thead>
                <tbody>
                  {sellListings.map((listing, idx) => (
                    <tr
                      key={listing.id}
                      className={`border-b border-white/[0.04] transition-colors hover:bg-white/[0.08] ${
                        idx % 2 === 0 ? "" : "bg-white/[0.03]"
                      }`}
                    >
                      <td className="px-3 py-2 text-zinc-300">
                        <span className="flex items-center gap-1.5">
                          {listing.seller_username}
                          {listing.is_bot_listing && (
                            <span className="rounded bg-cyan-500/15 px-1 py-0.5 text-[10px] text-cyan-400">
                              Bot
                            </span>
                          )}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-right font-mono tabular-nums text-amber-300">
                        {listing.price_per_unit}g
                      </td>
                      <td className="px-3 py-2 text-right text-slate-300">
                        x{listing.quantity_remaining}
                      </td>
                      <td className="px-3 py-2 text-right">
                        {listing.seller_username !== user.username && (
                          <button
                            onClick={() => handleBuyDirect(listing, 1)}
                            disabled={buying}
                            className="rounded-md bg-cyan-500/15 px-2 py-1 text-xs text-cyan-300 transition-colors hover:bg-cyan-500/25 disabled:opacity-50"
                          >
                            Kup
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Buy listings */}
        <div>
          <h2 className="mb-2 text-sm font-medium text-slate-300">
            Oferty kupna
          </h2>
          {buyListings.length === 0 ? (
            <p className="rounded-xl border border-white/10 py-8 text-center text-sm text-slate-400">
              Brak ofert kupna
            </p>
          ) : (
            <div className="overflow-hidden rounded-xl border border-white/[0.08]">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-white/10 bg-white/[0.05]">
                    <th className="px-3 py-2 text-left text-xs font-medium text-slate-400">
                      Kupujący
                    </th>
                    <th className="px-3 py-2 text-right text-xs font-medium text-slate-400">
                      Cena
                    </th>
                    <th className="px-3 py-2 text-right text-xs font-medium text-slate-400">
                      Ilość
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {buyListings.map((listing, idx) => (
                    <tr
                      key={listing.id}
                      className={`border-b border-white/[0.04] transition-colors hover:bg-white/[0.08] ${
                        idx % 2 === 0 ? "" : "bg-white/[0.03]"
                      }`}
                    >
                      <td className="px-3 py-2 text-zinc-300">
                        <span className="flex items-center gap-1.5">
                          {listing.seller_username}
                          {listing.is_bot_listing && (
                            <span className="rounded bg-cyan-500/15 px-1 py-0.5 text-[10px] text-cyan-400">
                              Bot
                            </span>
                          )}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-right font-mono tabular-nums text-green-300">
                        {listing.price_per_unit}g
                      </td>
                      <td className="px-3 py-2 text-right text-slate-300">
                        x{listing.quantity_remaining}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* Action forms */}
      <div className="grid gap-4 sm:grid-cols-2">
        {/* Quick buy */}
        {cheapestAvailable && (
          <div className="rounded-xl border border-white/10 bg-white/[0.05] p-4">
            <h3 className="mb-3 text-sm font-medium text-slate-300">Kup</h3>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <input
                type="number"
                min={1}
                max={cheapestAvailable.quantity_remaining}
                value={buyQty}
                onChange={(e) =>
                  setBuyQty(
                    Math.max(
                      1,
                      Math.min(
                        cheapestAvailable.quantity_remaining,
                        parseInt(e.target.value) || 1
                      )
                    )
                  )
                }
                className="w-full rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2 text-center text-sm text-zinc-100 outline-none focus:border-cyan-400/50 sm:w-20"
              />
              <Button
                onClick={handleBuyCheapest}
                disabled={buying}
                className="w-full rounded-lg sm:flex-1"
              >
                <Coins className="mr-1.5 h-4 w-4 text-amber-300" />
                Kup za{" "}
                <span className="ml-1 font-mono tabular-nums text-amber-300">
                  {buyCost}
                </span>{" "}
                gold
              </Button>
            </div>
          </div>
        )}

        {/* Sell form */}
        {representativeItem?.is_tradeable && (
          <div className="rounded-xl border border-white/10 bg-white/[0.05] p-4">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-sm font-medium text-slate-300">
                Wystaw na sprzedaż
              </h3>
              <span className="text-xs text-slate-400">
                Posiadasz:{" "}
                <span className="text-zinc-200">{ownedQty}</span>
              </span>
            </div>
            <div className="space-y-2">
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="mb-1 block text-[11px] text-slate-400 font-medium">
                    Ilość
                  </label>
                  <input
                    type="number"
                    min={1}
                    max={ownedQty || undefined}
                    value={sellQty}
                    onChange={(e) =>
                      setSellQty(Math.max(1, parseInt(e.target.value) || 1))
                    }
                    className="w-full rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2 text-sm text-zinc-100 outline-none focus:border-cyan-400/50"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-[11px] text-slate-400 font-medium">
                    Cena/szt.
                  </label>
                  <input
                    type="number"
                    min={1}
                    value={sellPrice}
                    onChange={(e) =>
                      setSellPrice(Math.max(1, parseInt(e.target.value) || 1))
                    }
                    className="w-full rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2 text-sm text-zinc-100 outline-none focus:border-cyan-400/50"
                  />
                </div>
              </div>
              <div className="rounded-lg bg-white/[0.05] px-3 py-2 text-xs text-slate-400">
                Prowizja: {feePercent}% ={" "}
                <span className="text-amber-300/80">{feeCost}g</span>
                <span className="mx-2 text-slate-500">·</span>
                Otrzymasz:{" "}
                <span className="text-green-300">{netReceive}g</span>
              </div>
              <Button
                onClick={handleSell}
                disabled={selling || ownedQty < 1}
                variant="outline"
                className="w-full rounded-lg"
              >
                Wystaw
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
