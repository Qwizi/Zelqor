"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Coins, Store } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
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
import ItemIcon from "@/components/ui/ItemIcon";
import {
  type MarketListingOut,
} from "@/lib/api";
import {
  useMarketListings,
  useMyInventory,
  useMyWallet,
  useMarketConfig,
  useBuyFromListing,
  useCreateListing,
} from "@/hooks/queries";

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
  const { user, loading: authLoading } = useAuth();
  const router = useRouter();
  const params = useParams<{ slug: string }>();
  const slug = params.slug;

  const listingsQuery = useMarketListings(slug);
  const inventoryQuery = useMyInventory();
  const walletQuery = useMyWallet();
  const configQuery = useMarketConfig();

  const buyMutation = useBuyFromListing();
  const sellMutation = useCreateListing();

  const loading =
    listingsQuery.isLoading ||
    inventoryQuery.isLoading ||
    walletQuery.isLoading ||
    configQuery.isLoading;

  const listings = listingsQuery.data?.items ?? [];
  const inventory = inventoryQuery.data?.items ?? [];
  const wallet = walletQuery.data ?? null;
  const config = configQuery.data ?? null;

  // Buy form state
  const [buyQty, setBuyQty] = useState(1);

  // Sell form state
  const [sellQty, setSellQty] = useState(1);
  const [sellPrice, setSellPrice] = useState(1);

  useEffect(() => {
    if (!authLoading && !user) router.replace("/login");
  }, [user, authLoading, router]);

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
  const cheapestAvailable = user
    ? sellListings.find((l) => l.seller_username !== user.username)
    : undefined;

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

  // Pre-fill sell price from cheapest listing when listings load
  useEffect(() => {
    const cheapest = sellListings[0];
    if (cheapest) setSellPrice(cheapest.price_per_unit);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listingsQuery.data]);

  const handleBuyDirect = async (listing: MarketListingOut, qty = 1) => {
    try {
      const result = await buyMutation.mutateAsync({ listingId: listing.id, quantity: qty });
      toast.success(result.message);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Błąd zakupu";
      toast.error(msg);
    }
  };

  const handleBuyCheapest = async () => {
    if (!cheapestAvailable) return;
    await handleBuyDirect(cheapestAvailable, buyQty);
  };

  const handleSell = async () => {
    if (!representativeItem?.is_tradeable) return;
    try {
      await sellMutation.mutateAsync({
        item_slug: slug,
        listing_type: "sell",
        quantity: sellQty,
        price_per_unit: sellPrice,
      });
      toast.success("Oferta wystawiona!");
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Błąd wystawiania";
      toast.error(msg);
    }
  };

  if (authLoading || !user) return null;

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="h-8 w-24 animate-pulse rounded-lg bg-muted/20" />
        <div className="h-32 animate-pulse rounded-2xl border border-border/30 bg-muted/10" />
        <div className="grid gap-4 md:grid-cols-2">
          <div className="h-56 animate-pulse rounded-xl border border-border/30 bg-muted/10" />
          <div className="h-56 animate-pulse rounded-xl border border-border/30 bg-muted/10" />
        </div>
      </div>
    );
  }

  const buying = buyMutation.isPending;
  const selling = sellMutation.isPending;

  return (
    <div className="space-y-6">
      {/* Back link */}
      <Link
        href="/marketplace"
        className="inline-flex items-center gap-2 rounded-lg px-3 py-1.5 text-base text-muted-foreground transition-all hover:text-foreground hover:bg-muted"
      >
        <ArrowLeft className="h-4 w-4" />
        Powrót do rynku
      </Link>

      {/* Item header */}
      {representativeItem ? (
        <Card className="rounded-2xl">
          <CardContent className="flex flex-col gap-4 p-4 sm:flex-row sm:gap-5 sm:p-6">
            <div className="flex h-20 w-20 shrink-0 items-center justify-center rounded-xl border border-border/60 bg-muted/30">
              <ItemIcon slug={representativeItem.slug} icon={representativeItem.icon} size={48} />
            </div>
            <div className="min-w-0">
              <h1 className="font-display text-3xl text-foreground">
                {representativeItem.name}
              </h1>
              <p className="mt-1 text-base text-muted-foreground">
                {TYPE_LABELS[representativeItem.item_type] ??
                  representativeItem.item_type}
              </p>
              <div className="mt-2 flex items-center gap-2">
                <span
                  className={`rounded-full px-2.5 py-0.5 text-sm font-medium ${RARITY_BADGE[representativeItem.rarity] ?? "bg-slate-500/20 text-slate-300"}`}
                >
                  {RARITY_LABELS[representativeItem.rarity] ??
                    representativeItem.rarity}
                </span>
              </div>
              {representativeItem.description && (
                <p className="mt-3 text-base text-muted-foreground">
                  {representativeItem.description}
                </p>
              )}
            </div>
          </CardContent>
        </Card>
      ) : (
        <Card className="rounded-2xl">
          <CardContent className="flex items-center gap-4 p-6">
            <Store className="h-10 w-10 text-muted-foreground" />
            <div>
              <p className="text-lg font-medium text-foreground">{slug}</p>
              <p className="text-base text-muted-foreground">Brak aktywnych ofert</p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Wallet strip */}
      <Card className="rounded-xl">
        <CardContent className="flex flex-wrap items-center gap-2 sm:gap-3 px-4 sm:px-5 py-3.5">
          <Coins className="h-5 w-5 text-accent" />
          <span className="font-mono tabular-nums text-lg font-semibold text-accent">
            {wallet?.gold ?? "—"}
          </span>
          <span className="text-base text-muted-foreground">złota</span>
          {ownedQty > 0 && (
            <>
              <span className="mx-2 text-border">·</span>
              <span className="text-base text-muted-foreground">
                Posiadasz:{" "}
                <span className="font-semibold text-foreground">{ownedQty}</span>
              </span>
            </>
          )}
          <span className="sm:ml-auto mt-1 sm:mt-0 w-full sm:w-auto text-left sm:text-right text-base text-muted-foreground">
            Prowizja: {feePercent}%
          </span>
        </CardContent>
      </Card>

      {/* Order books */}
      <div className="grid gap-4 md:grid-cols-2">
        {/* Sell listings */}
        <div>
          <h2 className="mb-3 text-base font-semibold text-foreground">
            Oferty sprzedaży
          </h2>
          {sellListings.length === 0 ? (
            <p className="rounded-xl border border-border py-10 text-center text-base text-muted-foreground">
              Brak ofert sprzedaży
            </p>
          ) : (
            <div className="overflow-hidden rounded-xl border border-border/40">
              <Table className="text-base">
                <TableHeader>
                  <TableRow className="bg-muted/30">
                    <TableHead className="h-12 pl-4 text-sm font-semibold text-muted-foreground">
                      Sprzedawca
                    </TableHead>
                    <TableHead className="h-12 text-sm font-semibold text-right text-muted-foreground">
                      Cena
                    </TableHead>
                    <TableHead className="h-12 text-sm font-semibold text-right text-muted-foreground">
                      Ilość
                    </TableHead>
                    <TableHead className="h-12 pr-4 text-right text-muted-foreground" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {sellListings.map((listing) => (
                    <TableRow
                      key={listing.id}
                      className="transition-colors hover:bg-muted/30"
                    >
                      <TableCell className="pl-4 py-4 text-base text-foreground">
                        <span className="flex items-center gap-2">
                          {listing.seller_username}
                          {listing.is_bot_listing && (
                            <span className="rounded bg-primary/15 px-1.5 py-0.5 text-xs text-primary">
                              Bot
                            </span>
                          )}
                        </span>
                      </TableCell>
                      <TableCell className="py-4 text-right font-mono tabular-nums text-base text-accent">
                        {listing.price_per_unit}g
                      </TableCell>
                      <TableCell className="py-4 text-right text-base text-foreground/80">
                        x{listing.quantity_remaining}
                      </TableCell>
                      <TableCell className="py-4 pr-4 text-right">
                        {listing.seller_username !== user.username && (
                          <Button
                            size="sm"
                            onClick={() => handleBuyDirect(listing, 1)}
                            disabled={buying}
                            className="h-9 rounded-md bg-primary text-primary-foreground px-4 text-sm hover:bg-primary/90 disabled:opacity-50"
                          >
                            Kup
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </div>

        {/* Buy listings */}
        <div>
          <h2 className="mb-3 text-base font-semibold text-foreground">
            Oferty kupna
          </h2>
          {buyListings.length === 0 ? (
            <p className="rounded-xl border border-border py-10 text-center text-base text-muted-foreground">
              Brak ofert kupna
            </p>
          ) : (
            <div className="overflow-hidden rounded-xl border border-border/40">
              <Table className="text-base">
                <TableHeader>
                  <TableRow className="bg-muted/30">
                    <TableHead className="h-12 pl-4 text-sm font-semibold text-muted-foreground">
                      Kupujący
                    </TableHead>
                    <TableHead className="h-12 text-sm font-semibold text-right text-muted-foreground">
                      Cena
                    </TableHead>
                    <TableHead className="h-12 pr-4 text-sm font-semibold text-right text-muted-foreground">
                      Ilość
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {buyListings.map((listing) => (
                    <TableRow
                      key={listing.id}
                      className="transition-colors hover:bg-muted/30"
                    >
                      <TableCell className="pl-4 py-4 text-base text-foreground">
                        <span className="flex items-center gap-2">
                          {listing.seller_username}
                          {listing.is_bot_listing && (
                            <span className="rounded bg-primary/15 px-1.5 py-0.5 text-xs text-primary">
                              Bot
                            </span>
                          )}
                        </span>
                      </TableCell>
                      <TableCell className="py-4 text-right font-mono tabular-nums text-base text-green-400">
                        {listing.price_per_unit}g
                      </TableCell>
                      <TableCell className="py-4 pr-4 text-right text-base text-foreground/80">
                        x{listing.quantity_remaining}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </div>
      </div>

      {/* Action forms */}
      <div className="grid gap-4 sm:grid-cols-2">
        {/* Quick buy */}
        {cheapestAvailable && (
          <Card className="rounded-xl">
            <CardContent className="p-5 space-y-4">
              <h3 className="text-base font-semibold text-foreground">Kup najszybciej</h3>
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                <Input
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
                  className="h-12 w-full text-base sm:w-24 text-center"
                />
                <Button
                  onClick={handleBuyCheapest}
                  disabled={buying}
                  className="h-12 w-full rounded-lg bg-primary text-primary-foreground text-base hover:bg-primary/90 sm:flex-1"
                >
                  <Coins className="mr-2 h-4 w-4" />
                  Kup za{" "}
                  <span className="ml-1 font-mono tabular-nums">
                    {buyCost}g
                  </span>
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Sell form */}
        {representativeItem?.is_tradeable && (
          <Card className="rounded-xl">
            <CardContent className="p-5 space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-base font-semibold text-foreground">
                  Wystaw na sprzedaż
                </h3>
                <span className="text-base text-muted-foreground">
                  Posiadasz:{" "}
                  <span className="font-semibold text-foreground">{ownedQty}</span>
                </span>
              </div>
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="mb-1.5 block text-sm font-medium text-muted-foreground">
                      Ilość
                    </label>
                    <Input
                      type="number"
                      min={1}
                      max={ownedQty || undefined}
                      value={sellQty}
                      onChange={(e) =>
                        setSellQty(Math.max(1, parseInt(e.target.value) || 1))
                      }
                      className="h-12 text-base"
                    />
                  </div>
                  <div>
                    <label className="mb-1.5 block text-sm font-medium text-muted-foreground">
                      Cena / szt.
                    </label>
                    <Input
                      type="number"
                      min={1}
                      value={sellPrice}
                      onChange={(e) =>
                        setSellPrice(Math.max(1, parseInt(e.target.value) || 1))
                      }
                      className="h-12 text-base"
                    />
                  </div>
                </div>
                <div className="rounded-lg bg-muted/50 px-4 py-3 text-base text-muted-foreground">
                  Prowizja: {feePercent}% ={" "}
                  <span className="text-accent font-medium">{feeCost}g</span>
                  <span className="mx-2 text-border">·</span>
                  Otrzymasz:{" "}
                  <span className="text-green-400 font-medium">{netReceive}g</span>
                </div>
                <Button
                  onClick={handleSell}
                  disabled={selling || ownedQty < 1}
                  className="h-12 w-full rounded-lg bg-accent text-accent-foreground text-base hover:bg-accent/90 disabled:opacity-50"
                >
                  Wystaw na sprzedaż
                </Button>
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
