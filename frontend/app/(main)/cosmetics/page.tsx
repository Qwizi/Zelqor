"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Shirt } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
import { useAuth } from "@/hooks/useAuth";
import {
  getMyInventory,
  getEquippedCosmetics,
  equipCosmetic,
  unequipCosmetic,
  type InventoryItemOut,
  type EquippedCosmeticOut,
} from "@/lib/api";

// ─── Rarity config ───────────────────────────────────────────────────────────

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

// ─── Equipped slot ───────────────────────────────────────────────────────────

function EquippedSlot({
  equipped,
  onUnequip,
  loading,
}: {
  equipped: EquippedCosmeticOut;
  onUnequip: (slot: string) => void;
  loading: boolean;
}) {
  return (
    <HoverCard>
      <HoverCardTrigger
        render={
          <div
            onClick={() => !loading && onUnequip(equipped.slot)}
            className="group relative flex flex-col items-center gap-3 rounded-2xl border border-border bg-muted/40 p-5 transition-all hover:border-destructive/40 hover:bg-destructive/5 cursor-pointer"
          >
            <Badge variant="outline" className="text-sm uppercase tracking-[0.18em] text-muted-foreground border-border/50 hover:bg-transparent">
              {equipped.slot}
            </Badge>

            <div className="flex h-20 w-20 items-center justify-center rounded-xl border border-border bg-muted/30 text-4xl">
              {equipped.asset_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={equipped.asset_url} alt={equipped.item_name} className="h-14 w-14 object-contain" />
              ) : (
                "🎨"
              )}
            </div>

            <p className="max-w-full truncate text-center text-base font-medium text-foreground">
              {equipped.item_name}
            </p>
          </div>
        }
      />
      <HoverCardContent side="bottom" sideOffset={8} className="w-72 p-4">
        <p className="text-base font-semibold text-foreground mb-1">{equipped.item_name}</p>
        <p className="text-sm text-muted-foreground mb-2">Slot: {equipped.slot}</p>
        <p className="text-sm text-destructive font-medium">Kliknij aby zdjąć</p>
      </HoverCardContent>
    </HoverCard>
  );
}


// ─── Cosmetic card with hover ────────────────────────────────────────────────

function CosmeticCard({
  entry,
  isEquipped,
  onEquip,
  loading,
}: {
  entry: InventoryItemOut;
  isEquipped: boolean;
  onEquip: (slug: string) => void;
  loading: boolean;
}) {
  const { item } = entry;
  const rarity = item.rarity;

  return (
    <HoverCard>
      <HoverCardTrigger
        render={
          <div
            onClick={() => !isEquipped && !loading && onEquip(item.slug)}
            className={[
              "group relative aspect-square rounded-xl border border-l-2 flex flex-col items-center justify-center transition-all duration-150 cursor-pointer",
              RARITY_LEFT_BORDER[rarity] ?? "border-l-slate-500/50",
              RARITY_SLOT_BG[rarity] ?? "bg-slate-500/[0.07]",
              "border-border",
              isEquipped
                ? "ring-2 ring-accent/40 border-accent/20 opacity-75 cursor-default"
                : "hover:border-border/60 hover:bg-muted hover:scale-[1.03]",
              loading ? "cursor-not-allowed" : "",
            ].join(" ")}
            title={isEquipped ? `${item.name} (założony)` : `Załóż ${item.name}`}
          >
            {isEquipped && (
              <div className="absolute -top-1.5 -right-1.5 flex h-6 w-6 items-center justify-center rounded-full bg-accent/20 border border-accent/40">
                <span className="text-xs text-accent font-bold">✓</span>
              </div>
            )}
            <span className="text-3xl leading-none select-none">{item.icon || "🎨"}</span>
            <p className="mt-1.5 max-w-full truncate px-1 text-center text-xs leading-none text-muted-foreground">
              {item.name}
            </p>
          </div>
        }
      />
      <HoverCardContent side="right" sideOffset={8} className="w-80 p-5">
        <div className="flex items-center gap-3 mb-3">
          <span className="text-3xl">{item.icon || "🎨"}</span>
          <div>
            <p className={`text-lg font-semibold ${RARITY_TEXT[rarity]}`}>{item.name}</p>
            <Badge className={`text-xs ${RARITY_BADGE_CLASS[rarity]}`} variant="outline">
              {RARITY_LABELS[rarity]}
            </Badge>
          </div>
        </div>
        {item.description && (
          <p className="text-sm text-muted-foreground mb-3">{item.description}</p>
        )}
        <div className="flex gap-3 text-sm text-muted-foreground">
          {item.asset_key && <span>Slot: <span className="text-foreground font-medium">{item.asset_key}</span></span>}
        </div>
        {isEquipped && (
          <p className="mt-2 text-sm text-accent font-medium">✓ Aktualnie założony</p>
        )}
      </HoverCardContent>
    </HoverCard>
  );
}

// ─── Page ────────────────────────────────────────────────────────────────────


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

  return (
    <div className="space-y-8">
      <div className="space-y-2">
        <p className="text-xs uppercase tracking-[0.24em] text-muted-foreground font-medium">Konto</p>
        <h1 className="font-display text-4xl sm:text-5xl text-foreground">Kosmetyki</h1>
      </div>

      {/* ── Założone ── */}
      <Card className="rounded-2xl">
        <CardContent className="p-6">
          <p className="mb-5 text-sm uppercase tracking-[0.2em] text-muted-foreground font-medium">Założone</p>

          {loading ? (
            <div className="flex h-24 items-center justify-center text-base text-muted-foreground">
              <Loader2 className="h-6 w-6 animate-spin mr-2" />
              Ładowanie...
            </div>
          ) : equipped.length > 0 ? (
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4">
              {equipped.map((eq) => (
                <EquippedSlot key={eq.slot} equipped={eq} onUnequip={handleUnequip} loading={actionLoading} />
              ))}
            </div>
          ) : (
            <p className="text-center text-base text-muted-foreground py-4">
              Nie masz założonych żadnych kosmetyków. Kliknij na kosmetyk poniżej aby go założyć.
            </p>
          )}
        </CardContent>
      </Card>

      {/* ── Dostępne ── */}
      <Card className="rounded-2xl">
        <div className="flex items-center gap-3 border-b border-border px-6 py-5">
          <Shirt className="h-6 w-6 text-primary" />
          <span className="text-lg font-semibold text-foreground">Dostępne kosmetyki</span>
          <span className="ml-auto text-sm text-muted-foreground tabular-nums">{cosmetics.length} szt.</span>
        </div>

        <CardContent className="p-6">
          {loading ? (
            <div className="flex h-40 items-center justify-center text-base text-muted-foreground">
              <Loader2 className="h-6 w-6 animate-spin mr-2" />
              Ładowanie...
            </div>
          ) : cosmetics.length === 0 ? (
            <div className="flex flex-col items-center gap-4 py-16 text-center">
              <Shirt className="h-16 w-16 text-muted-foreground/30" />
              <p className="text-lg text-muted-foreground">Nie masz żadnych kosmetyków.</p>
              <p className="text-base text-muted-foreground/60">Zdobywaj je przez grę lub kup na rynku.</p>
            </div>
          ) : (
            <>
              <p className="mb-5 text-base text-muted-foreground">Najedź na kosmetyk aby zobaczyć szczegóły. Kliknij aby założyć.</p>
              <div className="grid grid-cols-3 gap-3 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-7 xl:grid-cols-9">
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

              <Separator className="mt-6 mb-4" />
              <div className="flex flex-wrap gap-4">
                {cosmetics
                  .filter((e) => equippedSlugs.has(e.item.slug))
                  .map((entry) => (
                    <div key={entry.id} className="flex items-center gap-2.5">
                      <span className="text-2xl">{entry.item.icon || "🎨"}</span>
                      <div>
                        <span className="text-base font-medium text-foreground">{entry.item.name}</span>
                        <Badge className={`ml-2 text-xs ${RARITY_BADGE_CLASS[entry.item.rarity]}`} variant="outline">
                          {RARITY_LABELS[entry.item.rarity]}
                        </Badge>
                      </div>
                    </div>
                  ))}
                {equippedSlugs.size === 0 && (
                  <p className="text-base text-muted-foreground/60">Brak aktywnych kosmetyków.</p>
                )}
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
