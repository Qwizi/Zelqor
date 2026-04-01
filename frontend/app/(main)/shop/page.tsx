"use client";

import { Diamond, Flame, KeyRound, Shirt, ShoppingBag, Sparkles, Star, Tag } from "lucide-react";
import { Suspense, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useBuyShopItem, useCreateCheckout, useGemPackages, useGemWallet, useShopItems } from "@/hooks/queries";
import type { GemPackageOut, ShopItemOut } from "@/lib/api";
import { cn } from "@/lib/utils";

// ─── Rarity config ─────────────────────────────────────────────────────────────

const RARITY_BADGE_CLASS: Record<string, string> = {
  common: "bg-slate-500/20 text-slate-300 border-slate-500/30",
  uncommon: "bg-green-500/20 text-green-300 border-green-500/30",
  rare: "bg-blue-500/20 text-blue-300 border-blue-500/30",
  epic: "bg-purple-500/20 text-purple-300 border-purple-500/30",
  legendary: "bg-amber-500/20 text-amber-300 border-amber-500/30",
};

const RARITY_GLOW: Record<string, string> = {
  common: "",
  uncommon: "shadow-[0_0_12px_oklch(0.7_0.15_140/0.15)]",
  rare: "shadow-[0_0_12px_oklch(0.6_0.2_240/0.2)]",
  epic: "shadow-[0_0_12px_oklch(0.6_0.2_290/0.25)]",
  legendary: "shadow-[0_0_16px_oklch(0.8_0.18_75/0.3)]",
};

const RARITY_LABELS: Record<string, string> = {
  common: "Zwykły",
  uncommon: "Niepospolity",
  rare: "Rzadki",
  epic: "Epicki",
  legendary: "Legendarny",
};

// ─── Category config ─────────────────────────────────────────────────────────

const CATEGORY_TABS = [
  { value: "featured", label: "Polecane", icon: <Star size={13} /> },
  { value: "keys", label: "Klucze", icon: <KeyRound size={13} /> },
  { value: "cosmetics", label: "Kosmetyki", icon: <Shirt size={13} /> },
  { value: "daily", label: "Oferty dnia", icon: <Flame size={13} /> },
] as const;

// ─── GemBalanceChip ─────────────────────────────────────────────────────────

function GemBalanceChip() {
  const { data: wallet, isLoading } = useGemWallet();

  if (isLoading) {
    return <Skeleton className="h-8 w-24 rounded-full" />;
  }

  return (
    <div className="flex items-center gap-2 rounded-full border border-cyan-500/30 bg-cyan-500/10 px-3 py-1.5">
      <Diamond size={14} className="text-cyan-400 shrink-0" />
      <span className="text-sm font-bold tabular-nums text-cyan-300">
        {wallet ? wallet.gems.toLocaleString("pl-PL") : "0"}
      </span>
    </div>
  );
}

// ─── GemPackageCard ─────────────────────────────────────────────────────────

function GemPackageCard({ pkg }: { pkg: GemPackageOut }) {
  const { mutate: createCheckout, isPending } = useCreateCheckout();

  function handleBuy() {
    const idempotencyKey = `${pkg.slug}-${Date.now()}`;
    createCheckout(
      { packageSlug: pkg.slug, idempotencyKey },
      {
        onError: () => {
          toast.error("Nie udało się rozpocząć płatności");
        },
      },
    );
  }

  return (
    <Card
      className={cn(
        "relative flex flex-col gap-0 overflow-hidden border-border bg-card transition-all duration-200 hover:border-cyan-500/30 hover:bg-card/80",
        pkg.is_featured && "border-amber-500/40 bg-amber-500/[0.04] shadow-[0_0_20px_oklch(0.8_0.18_75/0.1)]",
      )}
    >
      {pkg.is_featured && (
        <div className="absolute right-0 top-0">
          <div className="flex items-center gap-1 rounded-bl-lg bg-amber-500/20 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-amber-400">
            <Sparkles size={10} />
            Polecany
          </div>
        </div>
      )}

      <CardContent className="flex flex-col items-center gap-3 p-5">
        <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-cyan-500/10 border border-cyan-500/20">
          <Diamond size={28} className="text-cyan-400" />
        </div>

        <div className="flex flex-col items-center gap-1 text-center">
          <span className="text-sm font-semibold text-foreground">{pkg.name}</span>
          <div className="flex items-baseline gap-1">
            <span className="text-2xl font-bold tabular-nums text-cyan-300">{pkg.gems.toLocaleString("pl-PL")}</span>
            <span className="text-xs text-muted-foreground">klejnotów</span>
          </div>
          {pkg.bonus_gems > 0 && (
            <span className="text-[11px] font-medium text-emerald-400">+{pkg.bonus_gems} bonus</span>
          )}
        </div>

        <Button
          onClick={handleBuy}
          disabled={isPending}
          size="sm"
          className={cn(
            "w-full font-semibold",
            pkg.is_featured
              ? "bg-amber-500 text-black hover:bg-amber-400"
              : "bg-cyan-500/20 text-cyan-300 hover:bg-cyan-500/30 border border-cyan-500/30",
          )}
        >
          {isPending ? "Przekierowanie..." : `$${(pkg.price_cents / 100).toFixed(2)}`}
        </Button>
      </CardContent>
    </Card>
  );
}

// ─── GemPackagesSection ──────────────────────────────────────────────────────

function GemPackagesSection() {
  const { data: packages, isLoading } = useGemPackages();

  return (
    <section className="space-y-4">
      <div className="flex items-center gap-2">
        <Diamond size={16} className="text-cyan-400 shrink-0" />
        <h2 className="text-base font-semibold text-foreground">Kup klejnoty</h2>
      </div>

      {isLoading ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-48 rounded-xl" />
          ))}
        </div>
      ) : !packages || packages.length === 0 ? (
        <p className="text-sm text-muted-foreground">Brak dostępnych pakietów.</p>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
          {packages
            .slice()
            .sort((a, b) => a.order - b.order)
            .map((pkg) => (
              <GemPackageCard key={pkg.id} pkg={pkg} />
            ))}
        </div>
      )}
    </section>
  );
}

// ─── BuyConfirmDialog ────────────────────────────────────────────────────────

function BuyConfirmDialog({ item, open, onClose }: { item: ShopItemOut | null; open: boolean; onClose: () => void }) {
  const { mutate: buyItem, isPending } = useBuyShopItem();
  const { data: wallet } = useGemWallet();

  if (!item) return null;

  const canAfford = wallet ? wallet.gems >= item.gem_price : false;

  function handleConfirm() {
    if (!item) return;
    buyItem(item.id, {
      onSuccess: () => {
        toast.success("Zakup zakończony pomyślnie!");
        onClose();
      },
      onError: () => {
        toast.error("Nie udało się dokonać zakupu");
      },
    });
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Potwierdź zakup</DialogTitle>
          <DialogDescription>
            Czy na pewno chcesz kupić <span className="font-semibold text-foreground">{item.item.name}</span>?
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3 py-2">
          <div className="flex items-center justify-between rounded-lg border border-border bg-secondary/60 px-4 py-3">
            <span className="text-sm text-muted-foreground">Cena</span>
            <div className="flex items-center gap-1.5">
              <Diamond size={14} className="text-cyan-400" />
              <span className="text-sm font-bold tabular-nums text-cyan-300">
                {item.gem_price.toLocaleString("pl-PL")}
              </span>
            </div>
          </div>

          {wallet && (
            <div className="flex items-center justify-between rounded-lg border border-border bg-secondary/60 px-4 py-3">
              <span className="text-sm text-muted-foreground">Twoje saldo</span>
              <div className="flex items-center gap-1.5">
                <Diamond size={14} className={canAfford ? "text-cyan-400" : "text-destructive"} />
                <span
                  className={cn("text-sm font-bold tabular-nums", canAfford ? "text-cyan-300" : "text-destructive")}
                >
                  {wallet.gems.toLocaleString("pl-PL")}
                </span>
              </div>
            </div>
          )}

          {!canAfford && <p className="text-xs text-destructive text-center">Niewystarczające saldo klejnotów</p>}
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onClose} disabled={isPending}>
            Anuluj
          </Button>
          <Button
            onClick={handleConfirm}
            disabled={isPending || !canAfford}
            className="bg-cyan-500 text-black hover:bg-cyan-400 font-semibold"
          >
            {isPending ? "Kupowanie..." : "Kup"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── ShopItemCard ────────────────────────────────────────────────────────────

function ShopItemCard({ item, onBuy }: { item: ShopItemOut; onBuy: (item: ShopItemOut) => void }) {
  const isFeatured = item.shop_category === "featured";
  const hasDiscount = item.original_gem_price !== null && item.original_gem_price > item.gem_price;

  return (
    <Card
      className={cn(
        "relative flex flex-col overflow-hidden border-border bg-card transition-all duration-200 hover:border-border/80 hover:bg-card/80",
        RARITY_GLOW[item.item.rarity] ?? "",
        isFeatured && "border-amber-500/30",
      )}
    >
      {isFeatured && (
        <div className="absolute right-0 top-0">
          <div className="flex items-center gap-1 rounded-bl-lg bg-amber-500/15 px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-amber-400">
            <Star size={9} />
          </div>
        </div>
      )}

      <CardContent className="flex flex-col gap-3 p-4">
        <div className="flex items-start gap-3">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-secondary/80 text-xl">
            {item.item.icon || <ShoppingBag size={20} className="text-muted-foreground" />}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-foreground truncate">{item.item.name}</p>
            <Badge
              variant="outline"
              className={cn("mt-1 text-[10px] border", RARITY_BADGE_CLASS[item.item.rarity] ?? "")}
            >
              {RARITY_LABELS[item.item.rarity] ?? item.item.rarity}
            </Badge>
          </div>
        </div>

        {item.quantity > 1 && <span className="text-[11px] text-muted-foreground">Ilość: ×{item.quantity}</span>}

        <div className="flex items-center justify-between gap-2 mt-auto">
          <div className="flex flex-col items-start">
            <div className="flex items-center gap-1">
              <Diamond size={13} className="text-cyan-400 shrink-0" />
              <span className="text-sm font-bold tabular-nums text-cyan-300">
                {item.gem_price.toLocaleString("pl-PL")}
              </span>
            </div>
            {hasDiscount && (
              <span className="text-[10px] text-muted-foreground line-through tabular-nums">
                {item.original_gem_price?.toLocaleString("pl-PL")}
              </span>
            )}
          </div>

          {hasDiscount && (
            <Badge className="bg-emerald-500/20 text-emerald-300 border-emerald-500/30 text-[10px]">
              <Tag size={9} className="mr-0.5" />-
              {Math.round(((item.original_gem_price! - item.gem_price) / item.original_gem_price!) * 100)}%
            </Badge>
          )}
        </div>

        <Button
          size="sm"
          onClick={() => onBuy(item)}
          className="w-full bg-cyan-500/15 text-cyan-300 hover:bg-cyan-500/25 border border-cyan-500/25 font-semibold"
        >
          Kup
        </Button>
      </CardContent>
    </Card>
  );
}

// ─── ShopItemsSection ────────────────────────────────────────────────────────

function ShopItemsSection() {
  const [activeCategory, setActiveCategory] = useState<string>("featured");
  const [confirmItem, setConfirmItem] = useState<ShopItemOut | null>(null);

  const { data: items, isLoading } = useShopItems(activeCategory === "daily" ? "daily_deal" : activeCategory);

  const filteredItems = items ?? [];

  return (
    <section className="space-y-4">
      <div className="flex items-center gap-2">
        <ShoppingBag size={16} className="text-primary shrink-0" />
        <h2 className="text-base font-semibold text-foreground">Przedmioty</h2>
      </div>

      <Tabs value={activeCategory} onValueChange={setActiveCategory}>
        <TabsList className="h-9 gap-0.5 bg-secondary/60">
          {CATEGORY_TABS.map((tab) => (
            <TabsTrigger key={tab.value} value={tab.value} className="flex items-center gap-1.5 text-xs">
              {tab.icon}
              {tab.label}
            </TabsTrigger>
          ))}
        </TabsList>

        {CATEGORY_TABS.map((tab) => (
          <TabsContent key={tab.value} value={tab.value} className="mt-4">
            {isLoading ? (
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
                {Array.from({ length: 10 }).map((_, i) => (
                  <Skeleton key={i} className="h-44 rounded-xl" />
                ))}
              </div>
            ) : filteredItems.length === 0 ? (
              <div className="flex flex-col items-center justify-center gap-3 py-16 text-muted-foreground">
                <ShoppingBag size={32} className="opacity-20" />
                <p className="text-sm">Brak przedmiotów w tej kategorii</p>
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
                {filteredItems
                  .slice()
                  .sort((a, b) => a.order - b.order)
                  .map((item) => (
                    <ShopItemCard key={item.id} item={item} onBuy={setConfirmItem} />
                  ))}
              </div>
            )}
          </TabsContent>
        ))}
      </Tabs>

      <BuyConfirmDialog item={confirmItem} open={confirmItem !== null} onClose={() => setConfirmItem(null)} />
    </section>
  );
}

// ─── ShopPage ────────────────────────────────────────────────────────────────

function ShopPageInner() {
  const handledRef = useRef(false);

  useEffect(() => {
    if (handledRef.current) return;
    const params = new URLSearchParams(window.location.search);
    const status = params.get("status");
    if (status === "success") {
      handledRef.current = true;
      toast.success("Płatność zakończona pomyślnie! Klejnoty zostały dodane do Twojego konta.");
    } else if (status === "cancel") {
      handledRef.current = true;
      toast("Płatność anulowana.");
    }
  }, []);

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-border bg-secondary">
            <ShoppingBag size={20} className="text-primary" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-foreground">Sklep</h1>
            <p className="text-xs text-muted-foreground">Kup klejnoty i przedmioty do gry</p>
          </div>
        </div>

        <GemBalanceChip />
      </div>

      {/* Gem packages */}
      <GemPackagesSection />

      {/* Divider */}
      <div className="border-t border-border" />

      {/* Shop items */}
      <ShopItemsSection />
    </div>
  );
}

export default function ShopPage() {
  return (
    <Suspense>
      <ShopPageInner />
    </Suspense>
  );
}
