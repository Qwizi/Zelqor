"use client";

import { Loader2 } from "lucide-react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { ModuleDisabledPage } from "@/components/ModuleGate";
import { CosmeticsSkeleton } from "@/components/skeletons/CosmeticsSkeleton";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import ItemIcon from "@/components/ui/ItemIcon";
import { Separator } from "@/components/ui/separator";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { useEquipCosmetic, useEquippedCosmetics, useMyInventory, useUnequipCosmetic } from "@/hooks/queries";
import { useAuth } from "@/hooks/useAuth";
import { useModuleConfig } from "@/hooks/useSystemModules";
import type { EquippedCosmeticOut, InventoryItemOut } from "@/lib/api";

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

const RARITY_BORDER_COLOR: Record<string, string> = {
  common: "border-slate-500/50",
  uncommon: "border-green-500/60",
  rare: "border-blue-500/60",
  epic: "border-purple-500/60",
  legendary: "border-amber-500/60",
};

const RARITY_LABELS: Record<string, string> = {
  common: "Zwykły",
  uncommon: "Niepospolity",
  rare: "Rzadki",
  epic: "Epicki",
  legendary: "Legendarny",
};

const WEAR_LABELS: Record<string, string> = {
  factory_new: "Fabryczna nowość",
  minimal_wear: "Minimalne zużycie",
  field_tested: "Testowane w terenie",
  well_worn: "Mocno noszone",
  battle_scarred: "Zniszczone",
};

// ─── Slot sections ────────────────────────────────────────────────────────────

interface SlotDef {
  key: string;
  label: string;
  icon: string;
}

interface SlotSection {
  title: string;
  icon: string;
  slots: SlotDef[];
}

const SLOT_SECTIONS: SlotSection[] = [
  {
    title: "Jednostki",
    icon: "⚔️",
    slots: [
      { key: "unit_infantry", label: "Piechota", icon: "🚶" },
      { key: "unit_tank", label: "Czołg", icon: "🛡️" },
      { key: "unit_ship", label: "Okręt", icon: "🚢" },
      { key: "unit_fighter", label: "Myśliwiec", icon: "✈️" },
    ],
  },
  {
    title: "Budynki",
    icon: "🏗️",
    slots: [
      { key: "building_barracks", label: "Koszary", icon: "🏠" },
      { key: "building_factory", label: "Fabryka", icon: "🏭" },
      { key: "building_tower", label: "Wieża", icon: "🗼" },
      { key: "building_port", label: "Port", icon: "⚓" },
      { key: "building_carrier", label: "Lotniskowiec", icon: "✈️" },
      { key: "building_radar", label: "Elektrownia", icon: "📡" },
    ],
  },
  {
    title: "Efekty akcji",
    icon: "✨",
    slots: [
      { key: "vfx_attack", label: "Atak", icon: "💥" },
      { key: "vfx_move", label: "Ruch", icon: "💨" },
      { key: "vfx_nuke", label: "Nuke", icon: "☢️" },
      { key: "vfx_capture", label: "Zdobycie", icon: "🏴" },
      { key: "vfx_defend", label: "Obrona", icon: "🛡️" },
    ],
  },
  {
    title: "Efekty specjalne",
    icon: "🎆",
    slots: [
      { key: "vfx_elimination", label: "Eliminacja", icon: "💀" },
      { key: "vfx_victory", label: "Zwycięstwo", icon: "🏆" },
    ],
  },
  {
    title: "Umiejętności",
    icon: "🔮",
    slots: [
      { key: "ability_conscription", label: "Pobór", icon: "📯" },
      { key: "ability_recon", label: "Wywiad", icon: "🔭" },
      { key: "ability_shield", label: "Tarcza", icon: "🛡️" },
      { key: "ability_virus", label: "Wirus", icon: "🧬" },
      { key: "ability_nuke", label: "Nuke", icon: "☢️" },
    ],
  },
  {
    title: "Profil",
    icon: "👤",
    slots: [
      { key: "emblem", label: "Emblemat", icon: "🏅" },
      { key: "profile_frame", label: "Ramka", icon: "🖼️" },
      { key: "player_title", label: "Tytuł", icon: "📜" },
      { key: "flag", label: "Flaga", icon: "🚩" },
    ],
  },
  {
    title: "Audio",
    icon: "🔊",
    slots: [
      { key: "sound_attack", label: "Dźwięk ataku", icon: "🔫" },
      { key: "music_theme", label: "Motyw", icon: "🎵" },
    ],
  },
];

// ─── Slot card ────────────────────────────────────────────────────────────────

function SlotCard({
  slotDef,
  equipped,
  onClick,
}: {
  slotDef: SlotDef;
  equipped: EquippedCosmeticOut | undefined;
  onClick: () => void;
}) {
  if (equipped) {
    const rarity = "common"; // EquippedCosmeticOut doesn't carry rarity — use neutral default
    return (
      <button
        onClick={onClick}
        className={[
          "group relative flex flex-col items-center gap-1.5 rounded-xl border-2 p-2 text-left transition-all duration-150",
          "hover:brightness-110 active:scale-[0.97] cursor-pointer",
          RARITY_BORDER_COLOR[rarity] ?? "border-slate-500/50",
          RARITY_SLOT_BG[rarity] ?? "bg-slate-500/[0.07]",
        ].join(" ")}
        title={`${equipped.item_name} — kliknij aby zmienić`}
      >
        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-background/40">
          {equipped.asset_url ? (
            <Image
              src={equipped.asset_url}
              alt={equipped.item_name}
              width={28}
              height={28}
              className="h-7 w-7 object-contain"
              unoptimized
            />
          ) : (
            <span className="text-xl leading-none select-none">{slotDef.icon}</span>
          )}
        </div>
        <p className="w-full truncate text-center text-[10px] font-medium text-foreground leading-tight">
          {equipped.item_name}
        </p>
        <div className="absolute -top-1 -right-1 flex h-4 w-4 items-center justify-center rounded-full bg-emerald-500/20 border border-emerald-500/40">
          <span className="text-[8px] text-emerald-400 font-bold">✓</span>
        </div>
      </button>
    );
  }

  return (
    <button
      onClick={onClick}
      className="group flex flex-col items-center gap-1.5 rounded-xl border-2 border-dashed border-border/50 p-2 text-left transition-all duration-150 hover:border-border hover:bg-muted/30 active:scale-[0.97] cursor-pointer"
      title={`Slot: ${slotDef.label} — kliknij aby założyć`}
    >
      <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-muted/30">
        <span className="text-xl leading-none select-none text-muted-foreground/60 group-hover:text-muted-foreground transition-colors">
          {slotDef.icon}
        </span>
      </div>
      <p className="w-full truncate text-center text-[10px] text-muted-foreground/70 leading-tight">{slotDef.label}</p>
    </button>
  );
}

// ─── Picker item row ──────────────────────────────────────────────────────────

function PickerItem({
  entry,
  isEquipped,
  onEquip,
  loading,
}: {
  entry: InventoryItemOut;
  isEquipped: boolean;
  onEquip: (slug: string, instanceId?: string) => void;
  loading: boolean;
}) {
  const { item, instance, is_instance } = entry;
  const rarity = item.rarity;

  const handleClick = () => {
    if (loading) return;
    const instanceId = is_instance && instance ? instance.id : undefined;
    onEquip(item.slug, instanceId);
  };

  return (
    <button
      onClick={handleClick}
      disabled={loading || isEquipped}
      className={[
        "w-full flex items-center gap-3 rounded-xl border border-l-2 px-3 py-2.5 text-left transition-all duration-150",
        RARITY_LEFT_BORDER[rarity] ?? "border-l-slate-500/50",
        RARITY_SLOT_BG[rarity] ?? "bg-slate-500/[0.07]",
        isEquipped
          ? "ring-1 ring-emerald-500/30 opacity-75 cursor-default"
          : "hover:bg-muted/50 hover:border-border/60 active:scale-[0.99] cursor-pointer",
        loading ? "cursor-not-allowed" : "",
      ].join(" ")}
    >
      <ItemIcon slug={item.slug} icon={item.icon} size={28} className="shrink-0" />

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 flex-wrap">
          <span className={`text-sm font-medium truncate ${RARITY_TEXT[rarity] ?? "text-foreground"}`}>
            {item.name}
          </span>
          <Badge className={`text-[10px] px-1.5 py-0 shrink-0 ${RARITY_BADGE_CLASS[rarity] ?? ""}`} variant="outline">
            {RARITY_LABELS[rarity] ?? rarity}
          </Badge>
          {is_instance && instance?.stattrak && (
            <Badge
              className="text-[10px] px-1.5 py-0 shrink-0 bg-amber-500/15 text-amber-300 border-amber-500/20"
              variant="outline"
            >
              StatTrak
            </Badge>
          )}
        </div>
        {is_instance && instance && (
          <div className="flex items-center gap-2 mt-0.5 text-[10px] text-muted-foreground">
            <span>{WEAR_LABELS[instance.wear_condition] ?? instance.wear_condition}</span>
            {instance.is_rare_pattern && <span className="text-amber-400">Rzadki wzór</span>}
            {instance.pattern_seed > 0 && <span>Wzór #{instance.pattern_seed}</span>}
          </div>
        )}
      </div>

      {isEquipped ? (
        <span className="shrink-0 text-[10px] font-medium text-emerald-400">Założony</span>
      ) : (
        <span className="shrink-0 text-[10px] text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity">
          Załóż
        </span>
      )}
    </button>
  );
}

// ─── Slot picker sheet ────────────────────────────────────────────────────────

interface SlotPickerSheetProps {
  open: boolean;
  onClose: () => void;
  slotDef: SlotDef | null;
  equipped: EquippedCosmeticOut | undefined;
  available: InventoryItemOut[];
  equippedSlugs: Set<string>;
  onEquip: (slug: string, instanceId?: string) => void;
  onUnequip: (slot: string) => void;
  loading: boolean;
}

function SlotPickerSheet({
  open,
  onClose,
  slotDef,
  equipped,
  available,
  equippedSlugs,
  onEquip,
  onUnequip,
  loading,
}: SlotPickerSheetProps) {
  return (
    <Sheet
      open={open}
      onOpenChange={(v) => {
        if (!v) onClose();
      }}
    >
      <SheetContent side="right" className="w-full sm:max-w-md flex flex-col gap-0 p-0">
        <SheetHeader className="px-4 pt-4 pb-3 border-b border-border">
          <SheetTitle className="flex items-center gap-2 text-base">
            <span className="text-xl">{slotDef?.icon}</span>
            {slotDef?.label}
          </SheetTitle>
          <SheetDescription className="text-xs">
            {available.length > 0
              ? `${available.length} kosmetyk${available.length === 1 ? "" : available.length < 5 ? "i" : "ów"} dostępnych`
              : "Brak dostępnych kosmetyków dla tego slotu"}
          </SheetDescription>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto px-4 py-3 space-y-2">
          {/* Unequip button */}
          {equipped && (
            <div className="pb-2 mb-1">
              <Button
                variant="outline"
                size="sm"
                className="w-full border-destructive/30 text-destructive hover:bg-destructive/10 hover:text-destructive"
                disabled={loading}
                onClick={() => {
                  onUnequip(equipped.slot);
                  onClose();
                }}
              >
                {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> : null}
                Zdejmij: {equipped.item_name}
              </Button>
              <Separator className="mt-3" />
            </div>
          )}

          {available.length === 0 ? (
            <div className="flex flex-col items-center gap-3 py-12 text-center">
              <span className="text-4xl opacity-30">{slotDef?.icon}</span>
              <p className="text-sm text-muted-foreground">Brak kosmetyków dla tego slotu.</p>
              <p className="text-xs text-muted-foreground/60">Zdobywaj je przez grę lub kup na rynku.</p>
            </div>
          ) : (
            <div className="space-y-1.5">
              {available.map((entry) => (
                <PickerItem
                  key={entry.id}
                  entry={entry}
                  isEquipped={equippedSlugs.has(entry.item.slug)}
                  onEquip={(slug, instanceId) => {
                    onEquip(slug, instanceId);
                    onClose();
                  }}
                  loading={loading}
                />
              ))}
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

// ─── Section card ─────────────────────────────────────────────────────────────

function SectionCard({
  section,
  equippedBySlot,
  onSlotClick,
}: {
  section: SlotSection;
  equippedBySlot: Map<string, EquippedCosmeticOut>;
  onSlotClick: (slotDef: SlotDef) => void;
}) {
  const equippedCount = section.slots.filter((s) => equippedBySlot.has(s.key)).length;

  return (
    <div className="hover-lift rounded-2xl border border-border bg-card overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 border-b border-border/60 bg-muted/20">
        <div className="flex items-center gap-2">
          <span className="text-lg leading-none">{section.icon}</span>
          <span className="text-sm font-semibold text-foreground">{section.title}</span>
        </div>
        <span className="text-xs text-muted-foreground tabular-nums">
          {equippedCount}/{section.slots.length}
        </span>
      </div>
      <div className="p-3">
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6">
          {section.slots.map((slotDef) => (
            <SlotCard
              key={slotDef.key}
              slotDef={slotDef}
              equipped={equippedBySlot.get(slotDef.key)}
              onClick={() => onSlotClick(slotDef)}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── Page guard ───────────────────────────────────────────────────────────────

export default function CosmeticsPage() {
  const { enabled } = useModuleConfig("cosmetics");
  if (!enabled) return <ModuleDisabledPage slug="cosmetics" />;
  return <CosmeticsContent />;
}

// ─── Main content ─────────────────────────────────────────────────────────────

function CosmeticsContent() {
  const { user, loading: authLoading } = useAuth();
  const router = useRouter();

  // Sheet state
  const [activeSlot, setActiveSlot] = useState<SlotDef | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);

  useEffect(() => {
    if (!authLoading && !user) router.replace("/login");
  }, [user, authLoading, router]);

  const { data: inventoryData, isLoading: inventoryLoading } = useMyInventory(200);
  const { data: equipped = [], isLoading: equippedLoading } = useEquippedCosmetics();
  const equipMutation = useEquipCosmetic();
  const unequipMutation = useUnequipCosmetic();

  const cosmetics = useMemo(
    () => (inventoryData?.items ?? []).filter((i) => i.item.item_type === "cosmetic"),
    [inventoryData],
  );

  const loading = inventoryLoading || equippedLoading;
  const actionLoading = equipMutation.isPending || unequipMutation.isPending;

  const handleEquip = async (itemSlug: string, instanceId?: string) => {
    if (actionLoading) return;
    try {
      const payload = instanceId ? { item_slug: itemSlug, instance_id: instanceId } : { item_slug: itemSlug };
      const result = await equipMutation.mutateAsync(payload);
      toast.success(`Założono: ${result.item_name}`, { id: "cosmetics-equip-success" });
    } catch {
      toast.error("Nie udało się założyć kosmetyku", { id: "cosmetics-equip-error" });
    }
  };

  const handleUnequip = async (slot: string) => {
    if (actionLoading) return;
    try {
      await unequipMutation.mutateAsync(slot);
      toast.success("Zdjęto kosmetyk", { id: "cosmetics-unequip-success" });
    } catch {
      toast.error("Nie udało się zdjąć kosmetyku", { id: "cosmetics-unequip-error" });
    }
  };

  if (authLoading || !user) return <CosmeticsSkeleton />;

  // Build lookup maps
  const equippedBySlot = new Map<string, EquippedCosmeticOut>(equipped.map((e) => [e.slot, e]));
  const inventoryBySlot = new Map<string, InventoryItemOut[]>();
  for (const entry of cosmetics) {
    const slot = entry.item.cosmetic_slot;
    if (!slot) continue;
    const existing = inventoryBySlot.get(slot) ?? [];
    existing.push(entry);
    inventoryBySlot.set(slot, existing);
  }
  const equippedSlugs = new Set(equipped.map((e) => e.item_slug));

  const totalSlots = SLOT_SECTIONS.reduce((acc, s) => acc + s.slots.length, 0);
  const totalEquipped = equipped.length;

  return (
    <div className="animate-page-in space-y-4 md:space-y-6 -mx-4 md:mx-0 -mt-2 md:mt-0">
      {/* Header */}
      <div className="px-4 md:px-0">
        <p className="hidden md:block text-xs uppercase tracking-[0.24em] text-muted-foreground font-medium">Konto</p>
        <h1 className="font-display text-2xl md:text-5xl text-foreground">Kosmetyki</h1>
        {!loading && (
          <p className="mt-1 text-xs md:text-sm text-muted-foreground">
            {totalEquipped} z {totalSlots} slotów założonych
          </p>
        )}
      </div>

      {/* Loading state */}
      {loading ? (
        <CosmeticsSkeleton />
      ) : (
        /* Section grid */
        <div className="px-4 md:px-0 grid grid-cols-1 gap-3 md:gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {SLOT_SECTIONS.map((section) => (
            <SectionCard
              key={section.title}
              section={section}
              equippedBySlot={equippedBySlot}
              onSlotClick={(slotDef) => {
                setActiveSlot(slotDef);
                setSheetOpen(true);
              }}
            />
          ))}
        </div>
      )}

      {/* Slot picker sheet */}
      <SlotPickerSheet
        open={sheetOpen}
        onClose={() => setSheetOpen(false)}
        slotDef={activeSlot}
        equipped={activeSlot ? equippedBySlot.get(activeSlot.key) : undefined}
        available={activeSlot ? (inventoryBySlot.get(activeSlot.key) ?? []) : []}
        equippedSlugs={equippedSlugs}
        onEquip={handleEquip}
        onUnequip={handleUnequip}
        loading={actionLoading}
      />
    </div>
  );
}
