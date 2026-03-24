"use client";

import {
  Backpack,
  Calendar,
  Coins,
  Gift,
  KeyRound,
  Lock,
  ShoppingCart,
  TrendingDown,
  TrendingUp,
  User,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { CrateOpenModal } from "@/components/inventory/CrateOpenModal";
import { ModuleDisabledPage } from "@/components/ModuleGate";
import { InventorySkeleton } from "@/components/skeletons/InventorySkeleton";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
import ItemIcon from "@/components/ui/ItemIcon";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useItemCategories, useMyDrops, useMyInventory, useMyWallet, useOpenCrate } from "@/hooks/queries";
import { useAuth } from "@/hooks/useAuth";
import { useModuleConfig } from "@/hooks/useSystemModules";
import type { InventoryItemOut, ItemInstanceOut, ItemOut } from "@/lib/api";

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

const _RARITY_GLOW: Record<string, string> = {
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
const _TYPE_LETTER: Record<string, string> = {
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
        "hover-lift group relative aspect-square rounded-lg border border-l-2 flex flex-col items-center justify-center transition-all duration-150 cursor-pointer",
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
      {inst?.is_rare_pattern && <span className="absolute bottom-1 right-1 text-xs leading-none">⭐</span>}

      {/* Icon */}
      <ItemIcon slug={entry.item.slug} icon={entry.item.icon} size={32} />

      {/* Name / nametag */}
      <p className="mt-1 max-w-full truncate px-1 text-center text-xs leading-none text-muted-foreground">
        {inst?.nametag ? `"${inst.nametag}"` : entry.item.name.replace(/^(Pakiet|Blueprint|Bonus): ?/, "")}
      </p>
    </div>
  );
}

function EmptySlot() {
  return <div className="aspect-square rounded-lg border border-dashed border-border/30 bg-muted/10" />;
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
      {inst.nametag && <p className="text-lg text-accent italic">&ldquo;{inst.nametag}&rdquo;</p>}

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
        <span className="font-mono text-base text-muted-foreground tabular-nums">{inst.wear.toFixed(6)}</span>
        <span className="text-base text-muted-foreground/70">({wearPct.toFixed(1)}%)</span>
        {inst.stattrak && (
          <Badge
            className="rounded border border-orange-500/40 bg-orange-500/15 px-2 py-px text-sm font-bold text-orange-300 h-auto"
            variant="outline"
          >
            StatTrak
          </Badge>
        )}
        {inst.is_rare_pattern && <span className="text-sm text-accent">⭐ Rzadki wzór</span>}
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
          Wzór: <span className="font-mono text-foreground">{inst.pattern_seed}</span>
        </span>
        {inst.first_owner_username && (
          <span className="flex items-center gap-1">
            <User className="h-3.5 w-3.5" />
            Pierwszy właściciel: <span className="text-foreground">{inst.first_owner_username}</span>
          </span>
        )}
        {inst.crafted_by_username && (
          <span className="flex items-center gap-1">
            <User className="h-3.5 w-3.5" />
            Craftowane przez: <span className="text-foreground">{inst.crafted_by_username}</span>
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

  return (
    <div className="rounded-xl p-5 sm:p-6">
      <div className="flex items-start justify-between gap-3 sm:gap-4">
        {/* Left: icon */}
        <div
          className={[
            "flex h-20 w-20 shrink-0 items-center justify-center rounded-xl border border-l-[3px]",
            "border-border",
            RARITY_BORDER[rarity] ?? "border-l-slate-400",
            "bg-muted/30",
          ].join(" ")}
        >
          <ItemIcon slug={item.slug} icon={item.icon} size={48} />
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
              ) : (
                item.name
              )}
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
            <p className="text-base text-muted-foreground leading-relaxed mb-2">{item.description}</p>
          )}

          {/* Stack quantity or instance details */}
          {entry.is_instance && inst ? (
            <InstanceDetail inst={inst} />
          ) : (
            <div className="flex flex-wrap items-center gap-4 text-base">
              <span className="text-muted-foreground">
                Posiadasz: <span className="font-mono font-semibold text-foreground">{entry.quantity}</span>
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
  const { enabled } = useModuleConfig("inventory");
  if (!enabled) return <ModuleDisabledPage slug="inventory" />;
  return <InventoryContent />;
}

function InventoryContent() {
  const { user, loading: authLoading } = useAuth();
  const router = useRouter();

  const [filter, setFilter] = useState<string>("all");

  // Crate opening modal state
  const [crateModalOpen, setCrateModalOpen] = useState(false);
  const [openingCrateItem, setOpeningCrateItem] = useState<ItemOut | null>(null);
  const [crateDrops, setCrateDrops] = useState<Array<{
    item_name: string;
    item_slug: string;
    rarity: string;
    quantity: number;
  }> | null>(null);

  const { data: inventoryData, isLoading: inventoryLoading } = useMyInventory(200);
  const { data: wallet, isLoading: walletLoading } = useMyWallet();
  const { data: dropsData, isLoading: dropsLoading } = useMyDrops(10);
  const { data: categories, isLoading: categoriesLoading } = useItemCategories();
  const openCrateMutation = useOpenCrate();

  const inventory = inventoryData?.items ?? [];
  const drops = dropsData?.items ?? [];
  const allItemCatalog = useMemo(() => (categories ?? []).flatMap((c) => c.items), [categories]);
  const loading = inventoryLoading || walletLoading || dropsLoading || categoriesLoading;

  useEffect(() => {
    if (!authLoading && !user) router.replace("/login");
  }, [user, authLoading, router]);

  const keys = inventory.filter((i) => i.item.item_type === "key");

  const hasMatchingKey = (crateSlug: string) =>
    keys.some((k) => k.item.slug.replace("key-", "") === crateSlug.replace("crate-", ""));

  const handleOpenCrate = async (crateSlug: string) => {
    const matchingKey = keys.find((k) => {
      const keySuffix = k.item.slug.replace("key-", "");
      const crateSuffix = crateSlug.replace("crate-", "");
      return keySuffix === crateSuffix;
    });
    if (!matchingKey) {
      toast.error("Nie masz odpowiedniego klucza!", { id: "inventory-no-key" });
      return;
    }
    const crateEntry = inventory.find((i) => i.item.slug === crateSlug);
    try {
      const result = await openCrateMutation.mutateAsync({ crateSlug, keySlug: matchingKey.item.slug });
      setOpeningCrateItem(crateEntry?.item ?? null);
      setCrateDrops(result.drops);
      setCrateModalOpen(true);
    } catch {
      toast.error("Nie udało się otworzyć skrzynki", { id: "inventory-crate-error" });
    }
  };

  const handleCrateModalClose = () => {
    setCrateModalOpen(false);
    setOpeningCrateItem(null);
    setCrateDrops(null);
  };

  const filteredInventory = filter === "all" ? inventory : inventory.filter((i) => i.item.item_type === filter);

  // Total slots to render — always at least MIN_SLOTS
  const totalSlots = Math.max(MIN_SLOTS, filteredInventory.length);
  const emptyCount = totalSlots - filteredInventory.length;

  if (authLoading || !user) return <InventorySkeleton />;

  return (
    <div className="animate-page-in space-y-3 md:space-y-8 -mx-4 md:mx-0 -mt-2 md:mt-0">
      <CrateOpenModal
        isOpen={crateModalOpen}
        onClose={handleCrateModalClose}
        crateItem={openingCrateItem}
        drops={crateDrops}
        allItems={allItemCatalog}
      />

      {/* ── Page header ─────────────────────────────────────────────────────── */}
      <div className="px-4 md:px-0">
        <p className="hidden md:block text-xs uppercase tracking-[0.24em] text-muted-foreground">Ekwipunek</p>
        <h1 className="font-display text-2xl md:text-5xl text-foreground">Ekwipunek</h1>
      </div>

      {/* ── Wallet bar ──────────────────────────────────────────────────────── */}
      {wallet && (
        <div className="px-4 md:px-0">
          {/* Mobile: compact balance */}
          <div className="flex items-center gap-3 md:hidden">
            <Coins className="h-5 w-5 text-amber-300" />
            <span className="font-display text-2xl tabular-nums text-amber-300">
              {wallet.gold.toLocaleString("pl-PL")}
            </span>
            <span className="text-sm text-muted-foreground">złota</span>
            <div className="flex-1" />
            <span className="text-xs text-muted-foreground tabular-nums">
              <span className="text-green-400">+{wallet.total_earned.toLocaleString("pl-PL")}</span>
              {" / "}
              <span className="text-red-400">-{wallet.total_spent.toLocaleString("pl-PL")}</span>
            </span>
          </div>

          {/* Desktop: card with full details */}
          <Card className="hidden md:block rounded-2xl backdrop-blur-xl">
            <CardContent className="flex flex-wrap items-center gap-4 py-5">
              <span className="mr-auto text-base font-semibold uppercase tracking-[0.24em] text-muted-foreground">
                Portfel
              </span>
              <span className="flex items-center gap-1.5 font-mono tabular-nums text-xl font-medium text-amber-300">
                <Coins className="h-5 w-5" />
                {wallet.gold.toLocaleString("pl-PL")}
                <span className="text-muted-foreground font-normal">złoto</span>
              </span>
              <Separator orientation="vertical" className="h-4 w-px" />
              <span className="flex items-center gap-1.5 font-mono tabular-nums text-lg text-green-300">
                <TrendingUp className="h-5 w-5" />
                {wallet.total_earned.toLocaleString("pl-PL")}
                <span className="text-muted-foreground text-base font-normal">zarobione</span>
              </span>
              <Separator orientation="vertical" className="h-4 w-px" />
              <span className="flex items-center gap-1.5 font-mono tabular-nums text-lg text-red-400">
                <TrendingDown className="h-5 w-5" />
                {wallet.total_spent.toLocaleString("pl-PL")}
                <span className="text-muted-foreground text-base font-normal">wydane</span>
              </span>
            </CardContent>
          </Card>
        </div>
      )}

      {/* ── Tabs ────────────────────────────────────────────────────────────── */}
      <div className="px-4 md:px-0">
        <Tabs defaultValue="inventory">
          <TabsList variant="line" className="h-auto p-0 gap-1">
            <TabsTrigger
              value="inventory"
              className="flex items-center gap-1.5 md:gap-2 px-3 md:px-4 py-2 text-sm md:text-base"
            >
              <Backpack className="h-4 w-4" />
              <span className="hidden md:inline">Ekwipunek</span>
              <span className="md:hidden">Przedmioty</span>
              <span className="ml-0.5 text-xs text-muted-foreground">{inventory.length}</span>
            </TabsTrigger>
            <TabsTrigger
              value="drops"
              className="flex items-center gap-1.5 md:gap-2 px-3 md:px-4 py-2 text-sm md:text-base"
            >
              <Gift className="h-4 w-4" />
              Dropy
            </TabsTrigger>
          </TabsList>

          {/* ── Inventory tab ─────────────────────────────────────────────────── */}
          <TabsContent value="inventory">
            {/* Filter pills — flat on mobile, card on desktop */}
            <div className="mb-3 md:mb-0">
              <div className="flex gap-1.5 md:gap-2 overflow-x-auto pb-0.5 scrollbar-none [-ms-overflow-style:none] [scrollbar-width:none]">
                {FILTERS.map((f) => {
                  const count =
                    f.value === "all" ? inventory.length : inventory.filter((i) => i.item.item_type === f.value).length;
                  if (f.value !== "all" && count === 0) return null;
                  const isActive = filter === f.value;
                  return (
                    <button
                      key={f.value}
                      onClick={() => setFilter(f.value)}
                      className={[
                        "flex shrink-0 items-center gap-1 md:gap-1.5 rounded-full px-3 md:px-4 py-1.5 md:py-2 text-xs md:text-base font-medium transition-colors",
                        isActive
                          ? "bg-primary/15 border border-primary/25 text-primary"
                          : "border border-border/50 text-muted-foreground hover:bg-muted/40 hover:border-border hover:text-foreground",
                      ].join(" ")}
                    >
                      {f.label}
                      <span
                        className={[
                          "text-[10px] md:text-sm font-semibold tabular-nums",
                          isActive ? "text-primary/70" : "text-muted-foreground/60",
                        ].join(" ")}
                      >
                        {count}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Slot grid — no card wrapper on mobile */}
            <div className="md:rounded-2xl md:border md:border-border md:bg-card md:backdrop-blur-xl md:p-5">
              {loading ? (
                <div className="flex h-40 items-center justify-center text-sm md:text-base text-muted-foreground">
                  Ładowanie ekwipunku...
                </div>
              ) : (
                <>
                  <div className="grid grid-cols-4 gap-1.5 md:grid-cols-6 lg:grid-cols-7 xl:grid-cols-9 md:gap-2">
                    {filteredInventory.map((entry) => (
                      <HoverCard key={entry.id}>
                        <HoverCardTrigger
                          render={
                            <div>
                              <FilledSlot entry={entry} isSelected={false} onClick={() => {}} />
                            </div>
                          }
                        />
                        <HoverCardContent side="right" sideOffset={8} className="w-[min(384px,calc(100vw-2rem))] p-0">
                          <DetailPanel
                            entry={entry}
                            hasMatchingKey={hasMatchingKey(entry.item.slug)}
                            onOpenCrate={handleOpenCrate}
                            onClose={() => {}}
                          />
                        </HoverCardContent>
                      </HoverCard>
                    ))}
                    {/* Empty slots only on desktop */}
                    <div className="hidden md:contents">
                      {Array.from({ length: emptyCount }).map((_, i) => (
                        <EmptySlot key={`empty-${i}`} />
                      ))}
                    </div>
                  </div>

                  {filteredInventory.length === 0 && (
                    <p className="mt-6 text-center text-sm md:text-base text-muted-foreground">
                      Brak przedmiotów w tej kategorii.
                    </p>
                  )}
                </>
              )}
            </div>
          </TabsContent>

          {/* ── Drops tab ─────────────────────────────────────────────────────── */}
          <TabsContent value="drops">
            <div className="md:rounded-2xl md:border md:border-border md:bg-card md:backdrop-blur-xl">
              {drops.length === 0 ? (
                <p className="py-8 text-center text-sm md:text-base text-muted-foreground">Brak dropów — graj mecze!</p>
              ) : (
                <div className="md:p-5">
                  {drops.map((drop) => {
                    const rarity = drop.item.rarity;
                    return (
                      <HoverCard key={drop.id}>
                        <HoverCardTrigger
                          render={
                            <div className="flex items-center gap-2.5 md:gap-3 rounded-xl px-1 md:px-3 py-3 md:py-4 hover:bg-muted/30 transition-colors cursor-pointer active:bg-muted/40">
                              {/* Icon */}
                              <div
                                className={[
                                  "flex h-9 w-9 md:h-11 md:w-11 shrink-0 items-center justify-center rounded-lg md:rounded-md border border-l-[2px]",
                                  "border-border bg-muted/20",
                                  RARITY_BORDER[rarity] ?? "border-l-slate-400",
                                ].join(" ")}
                              >
                                <ItemIcon slug={drop.item.slug} icon={drop.item.icon} size={28} />
                              </div>

                              {/* Name + qty */}
                              <div className="flex-1 min-w-0">
                                <span className="text-sm md:text-base text-foreground truncate block">
                                  {drop.item.name}
                                </span>
                                <span className="text-xs text-muted-foreground">
                                  {SOURCE_LABEL[drop.source] ?? drop.source}
                                  {drop.quantity > 1 && <span className="font-mono ml-1">x{drop.quantity}</span>}
                                </span>
                              </div>

                              {/* Source badge — desktop only */}
                              <Badge
                                variant="outline"
                                className="hidden md:inline-flex shrink-0 rounded-full px-2 py-px text-sm h-auto"
                              >
                                {SOURCE_LABEL[drop.source] ?? drop.source}
                              </Badge>

                              {/* Time */}
                              <span className="shrink-0 text-xs md:text-sm text-muted-foreground tabular-nums">
                                {timeAgo(drop.created_at)}
                              </span>
                            </div>
                          }
                        />
                        <HoverCardContent side="left" sideOffset={8} className="w-[min(320px,calc(100vw-2rem))] p-4">
                          <div className="flex items-center gap-3 mb-2">
                            <ItemIcon slug={drop.item.slug} icon={drop.item.icon} size={32} />
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
                            <span>
                              Ilość: <span className="text-foreground font-semibold">{drop.quantity}</span>
                            </span>
                            <span>
                              Źródło: <span className="text-foreground">{SOURCE_LABEL[drop.source]}</span>
                            </span>
                          </div>
                          {drop.instance && (
                            <div className="mt-2 flex flex-wrap gap-1.5">
                              <Badge
                                className={`text-xs ${WEAR_COLORS[drop.instance.wear_condition]}`}
                                variant="outline"
                              >
                                {WEAR_FULL_LABELS[drop.instance.wear_condition]}
                              </Badge>
                              {drop.instance.stattrak && (
                                <Badge
                                  className="text-xs border-orange-500/40 bg-orange-500/15 text-orange-300"
                                  variant="outline"
                                >
                                  StatTrak
                                </Badge>
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
            </div>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
