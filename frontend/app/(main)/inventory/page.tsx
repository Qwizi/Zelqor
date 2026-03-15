"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Backpack,
  Calendar,
  Coins,
  Gift,
  KeyRound,
  Lock,
  Package,
  ShoppingCart,
  TrendingDown,
  TrendingUp,
  User,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Separator } from "@/components/ui/separator";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
import { useAuth } from "@/hooks/useAuth";
import {
  getMyInventory,
  getMyWallet,
  getMyDrops,
  openCrate,
  type InventoryItemOut,
  type ItemInstanceOut,
  type WalletOut,
  type ItemDropOut,
} from "@/lib/api";

// ─── Wear condition config ────────────────────────────────────────────────────

const WEAR_LABELS: Record<string, string> = {
  factory_new: "FN",
  minimal_wear: "MW",
  field_tested: "FT",
  well_worn: "WW",
  battle_scarred: "BS",
};

const WEAR_COLORS: Record<string, string> = {
  factory_new: "text-emerald-400 bg-emerald-500/15 border-emerald-500/30",
  minimal_wear: "text-lime-400 bg-lime-500/15 border-lime-500/30",
  field_tested: "text-yellow-400 bg-yellow-500/15 border-yellow-500/30",
  well_worn: "text-orange-400 bg-orange-500/15 border-orange-500/30",
  battle_scarred: "text-red-400 bg-red-500/15 border-red-500/30",
};

const WEAR_FULL_LABELS: Record<string, string> = {
  factory_new: "Factory New",
  minimal_wear: "Minimal Wear",
  field_tested: "Field-Tested",
  well_worn: "Well-Worn",
  battle_scarred: "Battle-Scarred",
};

// ─── Rarity config ────────────────────────────────────────────────────────────

const RARITY_BORDER: Record<string, string> = {
  common: "border-l-slate-400",
  uncommon: "border-l-green-400",
  rare: "border-l-blue-400",
  epic: "border-l-purple-400",
  legendary: "border-l-amber-400",
};

const RARITY_GLOW: Record<string, string> = {
  common: "hover:shadow-slate-500/20",
  uncommon: "hover:shadow-green-500/25",
  rare: "hover:shadow-blue-500/25",
  epic: "hover:shadow-purple-500/30",
  legendary: "hover:shadow-amber-500/30",
};

const RARITY_TEXT: Record<string, string> = {
  common: "text-slate-300",
  uncommon: "text-green-300",
  rare: "text-blue-300",
  epic: "text-purple-300",
  legendary: "text-amber-300",
};

const RARITY_BG_BADGE: Record<string, string> = {
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

const TYPE_LABELS: Record<string, string> = {
  material: "Materiał",
  blueprint_building: "Blueprint: Budynek",
  blueprint_unit: "Blueprint: Jednostka",
  ability_scroll: "Scroll",
  boost: "Boost",
  crate: "Skrzynka",
  key: "Klucz",
  cosmetic: "Kosmetyk",
};

// Icon letter derived from item type
const TYPE_LETTER: Record<string, string> = {
  material: "M",
  blueprint_building: "B",
  blueprint_unit: "U",
  ability_scroll: "S",
  boost: "X",
  crate: "C",
  key: "K",
  cosmetic: "T",
};

// ─── Filter definitions ────────────────────────────────────────────────────────

const FILTERS = [
  { value: "all", label: "Wszystko" },
  { value: "material", label: "Materiały" },
  { value: "blueprint_building", label: "Blueprinty budynków" },
  { value: "blueprint_unit", label: "Blueprinty jednostek" },
  { value: "ability_scroll", label: "Scrolle" },
  { value: "boost", label: "Boosty" },
  { value: "crate", label: "Skrzynie" },
  { value: "key", label: "Klucze" },
  { value: "cosmetic", label: "Kosmetyki" },
];

const MIN_SLOTS = 40;

// ─── Rarity slot styles (matching deck builder) ─────────────────────────────

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

function levelBadgeClass(level: number): string {
  if (level >= 3) return "text-amber-300";
  if (level === 2) return "text-primary";
  return "text-muted-foreground";
}

// ─── Slot component ────────────────────────────────────────────────────────────

interface SlotProps {
  entry: InventoryItemOut;
  isSelected: boolean;
  onClick: () => void;
}

function FilledSlot({ entry, isSelected, onClick }: SlotProps) {
  const rarity = entry.item.rarity;
  const inst = entry.instance;

  return (
    <div
      onClick={onClick}
      className={[
        "group relative aspect-square rounded-lg border border-l-2 flex flex-col items-center justify-center transition-all duration-150 cursor-pointer",
        RARITY_LEFT_BORDER[rarity] ?? "border-l-slate-500/50",
        RARITY_SLOT_BG[rarity] ?? "bg-slate-500/[0.07]",
        "border-border",
        "hover:border-border/50 hover:bg-muted/40 hover:scale-[1.03]",
        isSelected ? "ring-1 ring-foreground/25 bg-muted/50 scale-[1.02]" : "",
      ].join(" ")}
      title={inst?.nametag ? `"${inst.nametag}" — ${entry.item.name}` : entry.item.name}
    >
      {/* Level badge — top left */}
      <div className={`absolute left-1 top-1 text-xs font-bold leading-none ${levelBadgeClass(entry.item.level)}`}>
        {entry.item.level}
      </div>

      {/* Quantity badge (stackable) OR wear badge (instance) — top right */}
      {entry.is_instance && inst ? (
        <span
          className={[
            "absolute right-1 top-1 rounded border px-[3px] py-px text-[10px] font-bold leading-none",
            WEAR_COLORS[inst.wear_condition] ?? "text-muted-foreground bg-muted border-border",
          ].join(" ")}
        >
          {WEAR_LABELS[inst.wear_condition] ?? inst.wear_condition.toUpperCase()}
        </span>
      ) : entry.quantity > 1 ? (
        <span className="absolute right-1 top-1 rounded bg-card px-1 py-px text-xs font-semibold leading-none text-foreground border border-border">
          x{entry.quantity}
        </span>
      ) : null}

      {/* StatTrak chip — bottom left */}
      {inst?.stattrak && (
        <span className="absolute bottom-1 left-1 rounded border border-orange-500/40 bg-orange-500/15 px-[3px] py-px text-[10px] font-bold leading-none text-orange-300">
          ST
        </span>
      )}

      {/* Rare pattern star — bottom right */}
      {inst?.is_rare_pattern && (
        <span className="absolute bottom-1 right-1 text-xs leading-none">
          ⭐
        </span>
      )}

      {/* Icon */}
      <span className="text-3xl leading-none select-none">{entry.item.icon || "📦"}</span>

      {/* Name / nametag */}
      <p className="mt-1 max-w-full truncate px-1 text-center text-xs leading-none text-muted-foreground">
        {inst?.nametag
          ? `"${inst.nametag}"`
          : entry.item.name.replace(/^(Pakiet|Blueprint|Bonus): ?/, "")}
      </p>
    </div>
  );
}

function EmptySlot() {
  return (
    <div className="aspect-square rounded-lg border border-dashed border-border/30 bg-muted/10" />
  );
}

// ─── Detail panel ──────────────────────────────────────────────────────────────

interface DetailPanelProps {
  entry: InventoryItemOut;
  hasMatchingKey: boolean;
  onOpenCrate: (slug: string) => void;
  onClose: () => void;
}

function InstanceDetail({ inst }: { inst: ItemInstanceOut }) {
  const wearPct = Math.round(inst.wear * 1000) / 10; // 0.0001 → 0.01%
  return (
    <div className="mt-3 space-y-3">
      {/* Nametag */}
      {inst.nametag && (
        <p className="text-lg text-accent italic">
          &ldquo;{inst.nametag}&rdquo;
        </p>
      )}

      {/* Wear row */}
      <div className="flex flex-wrap items-center gap-2">
        <Badge
          className={[
            "rounded border px-2 py-px text-sm font-bold h-auto",
            WEAR_COLORS[inst.wear_condition] ?? "text-muted-foreground bg-muted border-border",
          ].join(" ")}
          variant="outline"
        >
          {WEAR_FULL_LABELS[inst.wear_condition] ?? inst.wear_condition}
        </Badge>
        <span className="font-mono text-base text-muted-foreground tabular-nums">
          {inst.wear.toFixed(6)}
        </span>
        <span className="text-base text-muted-foreground/70">({wearPct.toFixed(1)}%)</span>
        {inst.stattrak && (
          <Badge className="rounded border border-orange-500/40 bg-orange-500/15 px-2 py-px text-sm font-bold text-orange-300 h-auto" variant="outline">
            StatTrak
          </Badge>
        )}
        {inst.is_rare_pattern && (
          <span className="text-sm text-accent">⭐ Rzadki wzór</span>
        )}
      </div>

      {/* StatTrak stats */}
      {inst.stattrak && (
        <div className="grid grid-cols-3 gap-2 rounded-lg border border-orange-500/20 bg-orange-500/[0.06] p-3 text-base">
          <div className="text-center">
            <div className="font-mono text-lg font-bold text-orange-300">{inst.stattrak_matches}</div>
            <div className="text-muted-foreground">meczy</div>
          </div>
          <div className="text-center">
            <div className="font-mono text-lg font-bold text-orange-300">{inst.stattrak_kills}</div>
            <div className="text-muted-foreground">eliminacji</div>
          </div>
          <div className="text-center">
            <div className="font-mono text-lg font-bold text-orange-300">{inst.stattrak_units_produced}</div>
            <div className="text-muted-foreground">jednostek</div>
          </div>
        </div>
      )}

      {/* Pattern seed */}
      <div className="flex flex-wrap gap-4 text-base text-muted-foreground">
        <span>
          Wzór:{" "}
          <span className="font-mono text-foreground">{inst.pattern_seed}</span>
        </span>
        {inst.first_owner_username && (
          <span className="flex items-center gap-1">
            <User className="h-3.5 w-3.5" />
            Pierwszy właściciel:{" "}
            <span className="text-foreground">{inst.first_owner_username}</span>
          </span>
        )}
        {inst.crafted_by_username && (
          <span className="flex items-center gap-1">
            <User className="h-3.5 w-3.5" />
            Craftowane przez:{" "}
            <span className="text-foreground">{inst.crafted_by_username}</span>
          </span>
        )}
        <span className="flex items-center gap-1">
          <Calendar className="h-3.5 w-3.5" />
          <span>{new Date(inst.created_at).toLocaleDateString("pl-PL")}</span>
        </span>
      </div>
    </div>
  );
}

function DetailPanel({ entry, hasMatchingKey, onOpenCrate, onClose }: DetailPanelProps) {
  const { item } = entry;
  const rarity = item.rarity;
  const inst = entry.instance;

  const displayIcon = item.icon || TYPE_LETTER[item.item_type] || "?";

  return (
    <div className="rounded-xl p-5 sm:p-6">
      <div className="flex items-start justify-between gap-3 sm:gap-4">
        {/* Left: icon */}
        <div
          className={[
            "flex h-20 w-20 shrink-0 items-center justify-center rounded-xl border border-l-[3px] text-4xl",
            "border-border",
            RARITY_BORDER[rarity] ?? "border-l-slate-400",
            "bg-muted/30",
          ].join(" ")}
        >
          {displayIcon}
        </div>

        {/* Center: info */}
        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-center gap-2 mb-1">
            <h3 className="font-display text-2xl font-semibold text-foreground leading-tight truncate">
              {inst?.nametag ? (
                <span>
                  <span className="italic text-accent">&ldquo;{inst.nametag}&rdquo;</span>
                  <span className="ml-1.5 text-muted-foreground text-base font-normal">({item.name})</span>
                </span>
              ) : item.name}
            </h3>
            <Badge
              className={[
                "shrink-0 rounded-full border px-2 py-px text-sm font-medium uppercase tracking-wide h-auto",
                RARITY_BG_BADGE[rarity] ?? "",
              ].join(" ")}
              variant="outline"
            >
              {RARITY_LABELS[rarity] ?? rarity}
            </Badge>
            <Badge
              variant="outline"
              className="shrink-0 rounded-full px-2 py-px text-sm uppercase tracking-wide h-auto"
            >
              {TYPE_LABELS[item.item_type] ?? item.item_type}
            </Badge>
            {item.level > 1 && (
              <Badge
                className="shrink-0 rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-px text-sm text-amber-300 h-auto"
                variant="outline"
              >
                Lvl {item.level}
              </Badge>
            )}
          </div>

          {item.description && (
            <p className="text-base text-muted-foreground leading-relaxed mb-2">
              {item.description}
            </p>
          )}

          {/* Stack quantity or instance details */}
          {entry.is_instance && inst ? (
            <InstanceDetail inst={inst} />
          ) : (
            <div className="flex flex-wrap items-center gap-4 text-base">
              <span className="text-muted-foreground">
                Posiadasz:{" "}
                <span className="font-mono font-semibold text-foreground">
                  {entry.quantity}
                </span>
              </span>
              {item.base_value > 0 && (
                <span className="flex items-center gap-1 text-accent/70">
                  <Coins className="h-3.5 w-3.5" />
                  <span className="font-mono tabular-nums">{item.base_value}</span>
                  <span className="text-muted-foreground">bazowa wartość</span>
                </span>
              )}
            </div>
          )}
        </div>

      </div>

      {/* Actions */}
      <Separator className="mt-4 mb-4" />
      <div className="flex flex-wrap gap-2">
        {item.item_type === "crate" && (
          <Button
            size="sm"
            variant="outline"
            className="h-11 gap-1.5 rounded-full text-base"
            onClick={() => onOpenCrate(item.slug)}
          >
            {hasMatchingKey ? (
              <>
                <KeyRound className="h-3.5 w-3.5" />
                Otwórz skrzynię
              </>
            ) : (
              <>
                <Lock className="h-3.5 w-3.5" />
                Brak klucza
              </>
            )}
          </Button>
        )}
        {item.is_tradeable && item.item_type !== "crate" && (
          <Button
            size="sm"
            variant="outline"
            className="h-11 gap-1.5 rounded-full text-base border-primary/30 text-primary hover:bg-primary/10"
          >
            <ShoppingCart className="h-3.5 w-3.5" />
            Sprzedaj na rynku
          </Button>
        )}
      </div>
    </div>
  );
}

// ─── Drops list ────────────────────────────────────────────────────────────────

const SOURCE_LABEL: Record<string, string> = {
  match_reward: "Mecz",
  crate_open: "Skrzynka",
  crafting: "Crafting",
};

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "teraz";
  if (mins < 60) return `${mins} min temu`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs} godz. temu`;
  const days = Math.floor(hrs / 24);
  return `${days} dni temu`;
}

// ─── Page ──────────────────────────────────────────────────────────────────────

export default function InventoryPage() {
  const { user, loading: authLoading, token } = useAuth();
  const router = useRouter();

  const [inventory, setInventory] = useState<InventoryItemOut[]>([]);
  const [wallet, setWallet] = useState<WalletOut | null>(null);
  const [drops, setDrops] = useState<ItemDropOut[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<string>("all");

  useEffect(() => {
    if (!authLoading && !user) router.replace("/login");
  }, [user, authLoading, router]);

  const loadData = useCallback(async () => {
    if (!token) return;
    try {
      const [invRes, wal, drRes] = await Promise.all([
        getMyInventory(token, 200),
        getMyWallet(token),
        getMyDrops(token, 10),
      ]);
      setInventory(invRes.items);
      setWallet(wal);
      setDrops(drRes.items);
    } catch {
      toast.error("Nie udało się załadować ekwipunku");
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const keys = inventory.filter((i) => i.item.item_type === "key");

  const hasMatchingKey = (crateSlug: string) =>
    keys.some(
      (k) =>
        k.item.slug.replace("key-", "") === crateSlug.replace("crate-", "")
    );

  const handleOpenCrate = async (crateSlug: string) => {
    if (!token) return;
    const matchingKey = keys.find((k) => {
      const keySuffix = k.item.slug.replace("key-", "");
      const crateSuffix = crateSlug.replace("crate-", "");
      return keySuffix === crateSuffix;
    });
    if (!matchingKey) {
      toast.error("Nie masz odpowiedniego klucza!");
      return;
    }
    try {
      const result = await openCrate(token, crateSlug, matchingKey.item.slug);
      toast.success(
        `Otwarto skrzynię! Otrzymano: ${result.drops
          .map((d) => `${d.item_name} x${d.quantity}`)
          .join(", ")}`
      );
      loadData();
    } catch {
      toast.error("Nie udało się otworzyć skrzynki");
    }
  };

  const filteredInventory =
    filter === "all"
      ? inventory
      : inventory.filter((i) => i.item.item_type === filter);

  // Total slots to render — always at least MIN_SLOTS
  const totalSlots = Math.max(MIN_SLOTS, filteredInventory.length);
  const emptyCount = totalSlots - filteredInventory.length;

  if (authLoading || !user) return null;

  return (
    <div className="space-y-8">

      {/* ── Page header ─────────────────────────────────────────────────────── */}
      <div className="space-y-2">
        <p className="text-xs uppercase tracking-[0.24em] text-muted-foreground">Ekwipunek</p>
        <h1 className="font-display text-4xl sm:text-5xl text-foreground">Twój ekwipunek</h1>
      </div>

      {/* ── Wallet bar ──────────────────────────────────────────────────────── */}
      <Card className="rounded-2xl backdrop-blur-xl">
        <CardContent className="flex flex-wrap items-center gap-4 py-5">
          <span className="mr-auto text-base font-semibold uppercase tracking-[0.24em] text-muted-foreground">
            Portfel
          </span>

          {wallet ? (
            <>
              <span className="flex items-center gap-1.5 font-mono tabular-nums text-xl font-medium text-amber-300">
                <Coins className="h-5 w-5" />
                {wallet.gold.toLocaleString("pl-PL")}
                <span className="text-muted-foreground font-normal">złoto</span>
              </span>
              <Separator orientation="vertical" className="hidden sm:block h-4 w-px" />
              <span className="flex items-center gap-1.5 font-mono tabular-nums text-lg text-green-300">
                <TrendingUp className="h-5 w-5" />
                {wallet.total_earned.toLocaleString("pl-PL")}
                <span className="text-muted-foreground text-base font-normal">zarobione</span>
              </span>
              <Separator orientation="vertical" className="hidden sm:block h-4 w-px" />
              <span className="flex items-center gap-1.5 font-mono tabular-nums text-lg text-red-400">
                <TrendingDown className="h-5 w-5" />
                {wallet.total_spent.toLocaleString("pl-PL")}
                <span className="text-muted-foreground text-base font-normal">wydane</span>
              </span>
            </>
          ) : (
            <span className="text-base text-muted-foreground">Ładowanie...</span>
          )}
        </CardContent>
      </Card>

      {/* ── Tabs ────────────────────────────────────────────────────────────── */}
      <Tabs defaultValue="inventory">
        <TabsList variant="line" className="h-auto p-0 gap-1">
          <TabsTrigger value="inventory" className="flex items-center gap-2 px-4 py-2 text-base">
            <Backpack className="h-4 w-4" />
            Ekwipunek
            <span className="ml-0.5 text-xs text-muted-foreground">
              {inventory.length}
            </span>
          </TabsTrigger>
          <TabsTrigger value="drops" className="flex items-center gap-2 px-4 py-2 text-base">
            <Gift className="h-4 w-4" />
            Ostatnie dropy
          </TabsTrigger>
        </TabsList>

        {/* ── Inventory tab ─────────────────────────────────────────────────── */}
        <TabsContent value="inventory">
          <Card className="rounded-2xl backdrop-blur-xl">

            {/* Filter pills */}
            <CardHeader className="border-b border-border pb-4">
              <div className="flex gap-2 overflow-x-auto scrollbar-none [-ms-overflow-style:none] [scrollbar-width:none]">
                {FILTERS.map((f) => {
                  const count =
                    f.value === "all"
                      ? inventory.length
                      : inventory.filter((i) => i.item.item_type === f.value).length;
                  if (f.value !== "all" && count === 0) return null;
                  const isActive = filter === f.value;
                  return (
                    <button
                      key={f.value}
                      onClick={() => setFilter(f.value)}
                      className={[
                        "flex items-center gap-1.5 rounded-full px-4 py-2 text-base font-medium transition-colors",
                        isActive
                          ? "bg-primary/15 border border-primary/25 text-primary"
                          : "border border-border/50 text-muted-foreground hover:bg-muted/40 hover:border-border hover:text-foreground",
                      ].join(" ")}
                    >
                      {f.label}
                      <span
                        className={[
                          "rounded-full px-1 text-sm font-semibold tabular-nums",
                          isActive ? "text-primary/70" : "text-muted-foreground/60",
                        ].join(" ")}
                      >
                        {count}
                      </span>
                    </button>
                  );
                })}
              </div>
            </CardHeader>

            {/* Slot grid */}
            <CardContent className="pt-5">
              {loading ? (
                <div className="flex h-40 items-center justify-center text-base text-muted-foreground">
                  Ładowanie ekwipunku...
                </div>
              ) : (
                <>
                  <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-7 xl:grid-cols-9">
                    {filteredInventory.map((entry) => (
                      <HoverCard key={entry.id}>
                        <HoverCardTrigger
                          render={
                            <div>
                              <FilledSlot
                                entry={entry}
                                isSelected={false}
                                onClick={() => {}}
                              />
                            </div>
                          }
                        />
                        <HoverCardContent side="right" sideOffset={8} className="w-96 p-0">
                          <DetailPanel
                            entry={entry}
                            hasMatchingKey={hasMatchingKey(entry.item.slug)}
                            onOpenCrate={handleOpenCrate}
                            onClose={() => {}}
                          />
                        </HoverCardContent>
                      </HoverCard>
                    ))}
                    {Array.from({ length: emptyCount }).map((_, i) => (
                      <EmptySlot key={`empty-${i}`} />
                    ))}
                  </div>

                  {filteredInventory.length === 0 && (
                    <p className="mt-6 text-center text-base text-muted-foreground">
                      Brak przedmiotów w tej kategorii.
                    </p>
                  )}
                </>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── Drops tab ─────────────────────────────────────────────────────── */}
        <TabsContent value="drops">
          <Card className="rounded-2xl backdrop-blur-xl">
            <CardHeader className="flex-row items-center gap-2 border-b border-border pb-4">
              <Package className="h-5 w-5 text-green-400" />
              <span className="text-base font-medium text-foreground">Ostatnie dropy</span>
            </CardHeader>

            <CardContent className="pt-5">
              {drops.length === 0 ? (
                <p className="py-8 text-center text-base text-muted-foreground">
                  Brak dropów — graj mecze!
                </p>
              ) : (
                <div className="space-y-1">
                  {drops.map((drop) => {
                    const rarity = drop.item.rarity;
                    return (
                      <HoverCard key={drop.id}>
                        <HoverCardTrigger
                          render={
                            <div className="flex items-center gap-3 rounded-lg px-3 py-4 hover:bg-muted/30 hover:border-border/30 transition-colors border border-transparent cursor-pointer">
                              {/* Icon */}
                              <div
                                className={[
                                  "flex h-11 w-11 shrink-0 items-center justify-center rounded-md border border-l-[2px] text-lg",
                                  "border-border bg-muted/20",
                                  RARITY_BORDER[rarity] ?? "border-l-slate-400",
                                ].join(" ")}
                              >
                                {drop.item.icon || TYPE_LETTER[drop.item.item_type] || "?"}
                              </div>

                              {/* Name + qty */}
                              <div className="flex-1 min-w-0">
                                <span className="text-base text-foreground truncate">
                                  {drop.item.name}
                                </span>
                                {drop.quantity > 1 && (
                                  <span className="ml-1.5 font-mono text-sm text-muted-foreground">
                                    x{drop.quantity}
                                  </span>
                                )}
                              </div>

                              {/* Source badge */}
                              <Badge variant="outline" className="shrink-0 rounded-full px-2 py-px text-sm h-auto">
                                {SOURCE_LABEL[drop.source] ?? drop.source}
                              </Badge>

                              {/* Time */}
                              <span className="shrink-0 text-sm text-muted-foreground tabular-nums">
                                {timeAgo(drop.created_at)}
                              </span>
                            </div>
                          }
                        />
                        <HoverCardContent side="left" sideOffset={8} className="w-80 p-4">
                          <div className="flex items-center gap-3 mb-2">
                            <span className="text-2xl">{drop.item.icon || "📦"}</span>
                            <div>
                              <p className={`text-base font-semibold ${RARITY_TEXT[rarity]}`}>{drop.item.name}</p>
                              <Badge className={`text-xs ${RARITY_BG_BADGE[rarity]}`} variant="outline">
                                {RARITY_LABELS[rarity]}
                              </Badge>
                            </div>
                          </div>
                          {drop.item.description && (
                            <p className="text-sm text-muted-foreground mb-2">{drop.item.description}</p>
                          )}
                          <div className="flex gap-3 text-sm text-muted-foreground">
                            <span>Ilość: <span className="text-foreground font-semibold">{drop.quantity}</span></span>
                            <span>Źródło: <span className="text-foreground">{SOURCE_LABEL[drop.source]}</span></span>
                          </div>
                          {drop.instance && (
                            <div className="mt-2 flex flex-wrap gap-1.5">
                              <Badge className={`text-xs ${WEAR_COLORS[drop.instance.wear_condition]}`} variant="outline">
                                {WEAR_FULL_LABELS[drop.instance.wear_condition]}
                              </Badge>
                              {drop.instance.stattrak && (
                                <Badge className="text-xs border-orange-500/40 bg-orange-500/15 text-orange-300" variant="outline">StatTrak</Badge>
                              )}
                              {drop.instance.is_rare_pattern && (
                                <span className="text-xs text-accent">⭐ Rzadki wzór</span>
                              )}
                            </div>
                          )}
                        </HoverCardContent>
                      </HoverCard>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
