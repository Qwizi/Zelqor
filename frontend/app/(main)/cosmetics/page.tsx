"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Shirt, X } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { useAuth } from "@/hooks/useAuth";
import {
  getMyInventory,
  getEquippedCosmetics,
  equipCosmetic,
  unequipCosmetic,
  type InventoryItemOut,
  type EquippedCosmeticOut,
} from "@/lib/api";

// ─── Rarity config ─────────────────────────────────────────────────────────────

const RARITY_LEFT_BORDER: Record<string, string> = {
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

const RARITY_BADGE_CLASS: Record<string, string> = {
  common: "bg-slate-500/15 text-slate-300 border-slate-500/20",
  uncommon: "bg-green-500/15 text-green-300 border-green-500/20",
  rare: "bg-blue-500/15 text-blue-300 border-blue-500/20",
  epic: "bg-purple-500/15 text-purple-300 border-purple-500/20",
  legendary: "bg-amber-500/15 text-amber-300 border-amber-500/20",
};

const RARITY_LABELS: Record<string, string> = {
  common: "Zwykły",
  uncommon: "Niepospolity",
  rare: "Rzadki",
  epic: "Epicki",
  legendary: "Legendarny",
};

// ─── Equipped slot component ───────────────────────────────────────────────────

interface EquippedSlotProps {
  equipped: EquippedCosmeticOut;
  onUnequip: (slot: string) => void;
  loading: boolean;
}

function EquippedSlot({ equipped, onUnequip, loading }: EquippedSlotProps) {
  return (
    <div className="group relative flex flex-col items-center gap-2 rounded-xl border border-border bg-muted/40 p-3 backdrop-blur-sm transition-all hover:border-border/60 hover:bg-muted">
      {/* Unequip button */}
      <button
        onClick={() => onUnequip(equipped.slot)}
        disabled={loading}
        aria-label={`Zdejmij ${equipped.item_name}`}
        className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full border border-border bg-card text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 hover:text-destructive disabled:cursor-not-allowed"
      >
        <X size={11} />
      </button>

      {/* Slot label */}
      <Badge variant="outline" className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground border-border/50 hover:bg-transparent">
        {equipped.slot}
      </Badge>

      {/* Icon / asset */}
      <div className="flex h-14 w-14 items-center justify-center rounded-lg border border-border bg-muted/30 text-3xl">
        {equipped.asset_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={equipped.asset_url}
            alt={equipped.item_name}
            className="h-10 w-10 object-contain"
          />
        ) : (
          "🎨"
        )}
      </div>

      {/* Item name */}
      <p className="max-w-full truncate text-center text-[11px] font-medium text-foreground">
        {equipped.item_name}
      </p>
    </div>
  );
}

function EmptyEquippedSlot({ slot }: { slot: string }) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-border/40 bg-muted/10 p-3">
      <span className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground/60 font-medium">
        {slot}
      </span>
      <div className="flex h-14 w-14 items-center justify-center rounded-lg border border-dashed border-border/30 text-muted-foreground/40">
        <Shirt size={22} />
      </div>
      <p className="text-[11px] text-muted-foreground/40">Brak</p>
    </div>
  );
}

// ─── Available cosmetic card ───────────────────────────────────────────────────

interface CosmeticCardProps {
  entry: InventoryItemOut;
  isEquipped: boolean;
  onEquip: (slug: string) => void;
  loading: boolean;
}

function CosmeticCard({ entry, isEquipped, onEquip, loading }: CosmeticCardProps) {
  const { item } = entry;
  const rarity = item.rarity;

  return (
    <button
      onClick={() => !isEquipped && onEquip(item.slug)}
      disabled={loading || isEquipped}
      className={[
        "group relative aspect-square rounded-lg border border-l-2 flex flex-col items-center justify-center transition-all duration-150",
        RARITY_LEFT_BORDER[rarity] ?? "border-l-slate-500/50",
        RARITY_SLOT_BG[rarity] ?? "bg-slate-500/[0.07]",
        "border-border",
        isEquipped
          ? "ring-2 ring-accent/40 border-accent/20 opacity-75 cursor-default"
          : "hover:border-border/60 hover:bg-muted hover:scale-[1.03] cursor-pointer",
        loading ? "cursor-not-allowed" : "",
      ].join(" ")}
      title={isEquipped ? `${item.name} (założony)` : `Załóż ${item.name}`}
    >
      {/* Equipped indicator */}
      {isEquipped && (
        <div className="absolute -top-1 -right-1 flex h-4 w-4 items-center justify-center rounded-full bg-accent/20 border border-accent/40">
          <span className="text-[8px] text-accent">✓</span>
        </div>
      )}

      {/* Icon */}
      <span className="text-2xl leading-none select-none">{item.icon || "🎨"}</span>

      {/* Name */}
      <p className="mt-1 max-w-full truncate px-1 text-center text-[9px] leading-none text-muted-foreground">
        {item.name}
      </p>
    </button>
  );
}

// ─── Page ──────────────────────────────────────────────────────────────────────

// Known cosmetic slots — if the backend returns others they'll appear dynamically
const KNOWN_SLOTS = ["banner", "avatar_frame", "chat_badge", "flag"];

export default function CosmeticsPage() {
  const { user, loading: authLoading, token } = useAuth();
  const router = useRouter();

  const [cosmetics, setCosmetics] = useState<InventoryItemOut[]>([]);
  const [equipped, setEquipped] = useState<EquippedCosmeticOut[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);

  useEffect(() => {
    if (!authLoading && !user) router.replace("/login");
  }, [user, authLoading, router]);

  const loadData = useCallback(async () => {
    if (!token) return;
    try {
      const [invRes, equippedRes] = await Promise.all([
        getMyInventory(token, 200),
        getEquippedCosmetics(token),
      ]);
      setCosmetics(invRes.items.filter((i) => i.item.item_type === "cosmetic"));
      setEquipped(equippedRes);
    } catch {
      toast.error("Nie udało się załadować kosmetyków");
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleEquip = async (itemSlug: string) => {
    if (!token || actionLoading) return;
    setActionLoading(true);
    try {
      const result = await equipCosmetic(token, itemSlug);
      toast.success(`Założono: ${result.item_name}`);
      await loadData();
    } catch {
      toast.error("Nie udało się założyć kosmetyku");
    } finally {
      setActionLoading(false);
    }
  };

  const handleUnequip = async (slot: string) => {
    if (!token || actionLoading) return;
    setActionLoading(true);
    try {
      await unequipCosmetic(token, slot);
      toast.success("Zdjęto kosmetyk");
      await loadData();
    } catch {
      toast.error("Nie udało się zdjąć kosmetyku");
    } finally {
      setActionLoading(false);
    }
  };

  if (authLoading || !user) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const equippedSlugs = new Set(equipped.map((e) => e.item_slug));

  // Build displayed slots: union of known slots and any currently equipped slot
  const allSlots = Array.from(
    new Set([...KNOWN_SLOTS, ...equipped.map((e) => e.slot)])
  );

  return (
    <div className="space-y-6">

      {/* ── Page header ───────────────────────────────────────────────────────── */}
      <div className="space-y-1">
        <p className="text-[11px] uppercase tracking-[0.24em] text-muted-foreground">Konto</p>
        <h1 className="font-display text-3xl text-foreground">Kosmetyki</h1>
      </div>

      {/* ── Equipped slots ────────────────────────────────────────────────────── */}
      <Card className="rounded-2xl backdrop-blur-xl">
        <CardContent className="p-5">
          <p className="mb-4 text-[11px] uppercase tracking-[0.24em] text-muted-foreground font-medium">
            Założone
          </p>

          {loading ? (
            <div className="flex h-24 items-center justify-center text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin mr-2" />
              Ładowanie...
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
              {allSlots.map((slot) => {
                const equippedItem = equipped.find((e) => e.slot === slot);
                return equippedItem ? (
                  <EquippedSlot
                    key={slot}
                    equipped={equippedItem}
                    onUnequip={handleUnequip}
                    loading={actionLoading}
                  />
                ) : (
                  <EmptyEquippedSlot key={slot} slot={slot} />
                );
              })}
            </div>
          )}

          {!loading && equipped.length === 0 && (
            <p className="mt-2 text-center text-sm text-muted-foreground">
              Nie masz założonych żadnych kosmetyków.
            </p>
          )}
        </CardContent>
      </Card>

      {/* ── Available cosmetics ───────────────────────────────────────────────── */}
      <Card className="rounded-2xl backdrop-blur-xl">
        <div className="flex items-center gap-2 border-b border-border px-5 py-4">
          <Shirt className="h-4 w-4 text-primary" />
          <span className="text-sm font-medium text-foreground">Dostępne kosmetyki</span>
          <span className="ml-auto text-[11px] text-muted-foreground tabular-nums">
            {cosmetics.length} szt.
          </span>
        </div>

        <CardContent className="p-5">
          {loading ? (
            <div className="flex h-40 items-center justify-center text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin mr-2" />
              Ładowanie ekwipunku...
            </div>
          ) : cosmetics.length === 0 ? (
            <div className="flex flex-col items-center gap-3 py-12 text-center">
              <Shirt className="h-10 w-10 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">
                Nie masz żadnych kosmetyków w ekwipunku.
              </p>
              <p className="text-xs text-muted-foreground/60">
                Zdobywaj kosmetyki przez grę lub kup je na rynku.
              </p>
            </div>
          ) : (
            <>
              <p className="mb-3 text-xs text-muted-foreground">
                Kliknij na kosmetyk, aby go założyć.
              </p>
              <div className="grid grid-cols-4 gap-1.5 sm:grid-cols-5 md:grid-cols-7 lg:grid-cols-9 xl:grid-cols-11">
                {cosmetics.map((entry) => (
                  <CosmeticCard
                    key={entry.id}
                    entry={entry}
                    isEquipped={equippedSlugs.has(entry.item.slug)}
                    onEquip={handleEquip}
                    loading={actionLoading}
                  />
                ))}
              </div>

              {/* Currently equipped summary */}
              <Separator className="mt-4 mb-3" />
              <div className="flex flex-wrap gap-2 min-h-6">
                {cosmetics
                  .filter((e) => equippedSlugs.has(e.item.slug))
                  .map((entry) => {
                    const rarity = entry.item.rarity;
                    return (
                      <div key={entry.id} className="flex items-center gap-2">
                        <span className="text-base">{entry.item.icon || "🎨"}</span>
                        <div>
                          <span className="text-xs font-medium text-foreground">
                            {entry.item.name}
                          </span>
                          <span
                            className={[
                              "ml-2 rounded-full border px-1.5 py-px text-[9px] font-medium uppercase tracking-wide",
                              RARITY_BADGE_CLASS[rarity] ?? "",
                            ].join(" ")}
                          >
                            {RARITY_LABELS[rarity] ?? rarity}
                          </span>
                        </div>
                      </div>
                    );
                  })}
                {equippedSlugs.size === 0 && (
                  <p className="text-xs text-muted-foreground/60">Brak aktywnych kosmetyków.</p>
                )}
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
