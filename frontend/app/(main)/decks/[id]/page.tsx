"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import {
  ArrowLeft,
  Check,
  Loader2,
  Plus,
  Star,
  StarOff,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import ItemIcon from "@/components/ui/ItemIcon";
import { useAuth } from "@/hooks/useAuth";
import {
  useDeck,
  useMyInventory,
  useUpdateDeck,
  useSetDefaultDeck,
} from "@/hooks/queries";
import { DeckEditorSkeleton } from "@/components/skeletons/DeckEditorSkeleton";
import { type DeckOut, type InventoryItemOut } from "@/lib/api";

// ─── Constants ────────────────────────────────────────────────────────────────

const SECTION_CONFIG = [
  {
    type: "tactical_package",
    label: "Pakiety Taktyczne",
    icon: "⚡",
    colorClass: "text-primary",
    slots: 5,
  },
  {
    type: "blueprint_building",
    label: "Budynki",
    icon: "🏗️",
    colorClass: "text-accent",
    slots: 6,
  },
  {
    type: "blueprint_unit",
    label: "Jednostki",
    icon: "⚔️",
    colorClass: "text-orange-300",
    slots: 9,
  },
  {
    type: "boost",
    label: "Bonusy",
    icon: "🚀",
    colorClass: "text-emerald-300",
    slots: 4,
  },
] as const;

type SectionType = (typeof SECTION_CONFIG)[number]["type"];
const DECK_ITEM_TYPES: string[] = SECTION_CONFIG.map((s) => s.type);

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

const RARITY_BORDER_COLOR: Record<string, string> = {
  common: "border-slate-500/50",
  uncommon: "border-green-500/60",
  rare: "border-blue-500/60",
  epic: "border-purple-500/60",
  legendary: "border-amber-500/60",
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

// ─── Types ────────────────────────────────────────────────────────────────────

interface SlotItem {
  item_slug: string;
  item_name: string;
  item_type: string;
  rarity: string;
  level: number;
  icon: string;
  blueprint_ref: string;
  instance_id?: string;
  is_stattrak?: boolean;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function levelBadgeClass(level: number): string {
  if (level >= 3) return "text-accent";
  if (level === 2) return "text-primary";
  return "text-muted-foreground";
}

function sectionForType(type: string) {
  return SECTION_CONFIG.find((s) => s.type === type);
}

function buildDraftSlotsFromDeck(deck: DeckOut): Record<SectionType, SlotItem[]> {
  const slots: Record<SectionType, SlotItem[]> = {
    tactical_package: [],
    blueprint_building: [],
    blueprint_unit: [],
    boost: [],
  };
  for (const di of deck.items) {
    const type = di.item.item_type as SectionType;
    if (!(type in slots)) continue;
    const section = sectionForType(type);
    for (let i = 0; i < di.quantity; i++) {
      if (slots[type].length < (section?.slots ?? 99)) {
        slots[type].push({
          item_slug: di.item.slug,
          item_name: di.item.name,
          item_type: di.item.item_type,
          rarity: di.item.rarity,
          level: di.item.level ?? 1,
          icon: di.item.icon || "",
          blueprint_ref: di.item.blueprint_ref || "",
        });
      }
    }
  }
  return slots;
}

// ─── Filled slot card ─────────────────────────────────────────────────────────

function FilledSlotCard({
  item,
  index,
  onRemove,
  isLocked,
}: {
  item: SlotItem;
  index: number;
  onRemove: () => void;
  isLocked: boolean;
}) {
  const [hovered, setHovered] = useState(false);
  const rarity = item.rarity || "common";

  return (
    <button
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onClick={isLocked ? undefined : onRemove}
      className={[
        "group relative flex flex-col items-center gap-1.5 rounded-xl border-2 p-2 text-left transition-all duration-150",
        isLocked
          ? "cursor-default opacity-70"
          : "hover:brightness-110 active:scale-[0.97] cursor-pointer",
        RARITY_BORDER_COLOR[rarity] ?? "border-slate-500/50",
        RARITY_SLOT_BG[rarity] ?? "bg-slate-500/[0.07]",
      ].join(" ")}
      title={isLocked ? item.item_name : `${item.item_name} — kliknij aby usunąć`}
    >
      {/* Remove overlay on hover */}
      {!isLocked && hovered && (
        <div className="absolute inset-0 flex items-center justify-center rounded-xl bg-destructive/20 z-10">
          <div className="flex h-6 w-6 items-center justify-center rounded-full bg-destructive/80 text-destructive-foreground">
            <X className="h-3.5 w-3.5" />
          </div>
        </div>
      )}

      {/* Slot number badge */}
      <div className="absolute -top-1 -left-1 flex h-4 w-4 items-center justify-center rounded-full bg-background/80 border border-border/60">
        <span className="text-[8px] text-muted-foreground font-bold leading-none">{index + 1}</span>
      </div>

      {/* Level badge */}
      <div className={`absolute top-1 right-1.5 text-[9px] font-bold leading-none ${levelBadgeClass(item.level)}`}>
        {item.level}
      </div>

      <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-background/40 mt-1">
        <ItemIcon slug={item.item_slug} icon={item.icon} size={28} />
      </div>
      <p className="w-full truncate text-center text-[10px] font-medium text-foreground leading-tight">
        {item.item_name}
      </p>
      <span className={`text-[9px] font-semibold ${levelBadgeClass(item.level)}`}>
        Lvl {item.level}
      </span>
      {item.is_stattrak && (
        <span className="text-[8px] font-bold text-amber-400">ST</span>
      )}
    </button>
  );
}

// ─── Empty slot card ──────────────────────────────────────────────────────────

function EmptySlotCard({
  index,
  sectionIcon,
  onClick,
  isLocked,
}: {
  index: number;
  sectionIcon: string;
  onClick: () => void;
  isLocked: boolean;
}) {
  return (
    <button
      onClick={isLocked ? undefined : onClick}
      className={[
        "group flex flex-col items-center gap-1.5 rounded-xl border-2 border-dashed p-2 text-left transition-all duration-150",
        isLocked
          ? "border-border/20 cursor-default opacity-40"
          : "border-border/50 hover:border-border hover:bg-muted/30 active:scale-[0.97] cursor-pointer",
      ].join(" ")}
      title={isLocked ? `Slot ${index + 1}` : `Slot ${index + 1} — kliknij aby dodać`}
    >
      <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-muted/30">
        <span className={`text-xl leading-none select-none transition-colors ${isLocked ? "text-muted-foreground/30" : "text-muted-foreground/40 group-hover:text-muted-foreground"}`}>
          {sectionIcon}
        </span>
      </div>
      <p className="w-full truncate text-center text-[10px] text-muted-foreground/50 leading-tight">
        Slot {index + 1}
      </p>
      {!isLocked && (
        <span className="text-[9px] text-muted-foreground/30 group-hover:text-muted-foreground/60 transition-colors">
          <Plus className="h-2.5 w-2.5 inline" />
        </span>
      )}
    </button>
  );
}

// ─── Section card ─────────────────────────────────────────────────────────────

function DeckSectionCard({
  section,
  slots,
  onSlotClick,
  onRemoveItem,
  isLocked,
}: {
  section: (typeof SECTION_CONFIG)[number];
  slots: SlotItem[];
  onSlotClick: () => void;
  onRemoveItem: (index: number) => void;
  isLocked: boolean;
}) {
  const totalSlots = section.slots;
  const filledCount = slots.length;

  // Build display: filled slots first, then empty placeholders
  const displaySlots: Array<{ filled: true; item: SlotItem; index: number } | { filled: false; index: number }> = [
    ...slots.map((item, i) => ({ filled: true as const, item, index: i })),
    ...Array.from({ length: totalSlots - filledCount }, (_, i) => ({
      filled: false as const,
      index: filledCount + i,
    })),
  ];

  return (
    <div className="hover-lift rounded-2xl border border-border bg-card overflow-hidden">
      {/* Section header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border/60 bg-muted/20">
        <div className="flex items-center gap-2">
          <span className="text-lg leading-none">{section.icon}</span>
          <span className={`text-sm font-semibold ${section.colorClass}`}>{section.label}</span>
        </div>
        <span className="text-xs text-muted-foreground tabular-nums">
          {filledCount}/{totalSlots}
        </span>
      </div>

      {/* Slot grid */}
      <div className="p-3">
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6">
          {displaySlots.map((slot) =>
            slot.filled ? (
              <FilledSlotCard
                key={`filled-${slot.index}`}
                item={slot.item}
                index={slot.index}
                onRemove={() => onRemoveItem(slot.index)}
                isLocked={isLocked}
              />
            ) : (
              <EmptySlotCard
                key={`empty-${slot.index}`}
                index={slot.index}
                sectionIcon={section.icon}
                onClick={onSlotClick}
                isLocked={isLocked}
              />
            )
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Picker item row ──────────────────────────────────────────────────────────

function PickerItem({
  inv,
  disabled,
  disabledReason,
  onAdd,
}: {
  inv: InventoryItemOut;
  disabled: boolean;
  disabledReason: string;
  onAdd: () => void;
}) {
  const rarity = inv.item.rarity || "common";

  return (
    <button
      onClick={disabled ? undefined : onAdd}
      disabled={disabled}
      className={[
        "w-full flex items-center gap-3 rounded-xl border border-l-2 px-3 py-2.5 text-left transition-all duration-150",
        RARITY_LEFT_BORDER[rarity] ?? "border-l-slate-500/50",
        RARITY_SLOT_BG[rarity] ?? "bg-slate-500/[0.07]",
        disabled
          ? "opacity-30 cursor-not-allowed"
          : "hover:bg-muted/50 hover:border-border/60 active:scale-[0.99] cursor-pointer",
      ].join(" ")}
    >
      <ItemIcon slug={inv.item.slug} icon={inv.item.icon} size={28} className="shrink-0" />

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 flex-wrap">
          <span className={`text-sm font-medium truncate ${RARITY_TEXT[rarity] ?? "text-foreground"}`}>
            {inv.item.name}
          </span>
          <Badge
            className={`text-[10px] px-1.5 py-0 shrink-0 ${RARITY_BADGE_CLASS[rarity] ?? ""}`}
            variant="outline"
          >
            Lvl {inv.item.level ?? 1}
          </Badge>
        </div>
        <div className="flex items-center gap-2 mt-0.5 text-[10px] text-muted-foreground flex-wrap">
          {inv.is_instance && inv.instance?.stattrak && (
            <Badge className="text-[9px] px-1 py-0 bg-amber-500/15 text-amber-300 border-amber-500/20" variant="outline">
              StatTrak
            </Badge>
          )}
          {inv.is_instance && inv.instance?.wear_condition && (
            <span>{inv.instance.wear_condition === "factory_new" ? "FN" : inv.instance.wear_condition === "minimal_wear" ? "MW" : inv.instance.wear_condition === "field_tested" ? "FT" : inv.instance.wear_condition === "well_worn" ? "WW" : "BS"}</span>
          )}
          {inv.is_instance && inv.instance?.is_rare_pattern && (
            <span className="text-amber-400">Rzadki wzór</span>
          )}
          {!inv.is_instance && <span>x{inv.quantity}</span>}
          {disabled && disabledReason && (
            <span className="text-amber-400/70">{disabledReason}</span>
          )}
        </div>
      </div>

      {!disabled && (
        <Plus className="h-4 w-4 text-primary shrink-0 opacity-60 group-hover:opacity-100 transition-opacity" />
      )}
    </button>
  );
}

// ─── Section picker sheet ─────────────────────────────────────────────────────

interface SectionPickerSheetProps {
  open: boolean;
  onClose: () => void;
  section: (typeof SECTION_CONFIG)[number] | null;
  inventory: InventoryItemOut[];
  draftSlots: Record<SectionType, SlotItem[]>;
  onAdd: (inv: InventoryItemOut) => void;
}

function SectionPickerSheet({
  open,
  onClose,
  section,
  inventory,
  draftSlots,
  onAdd,
}: SectionPickerSheetProps) {
  if (!section) return null;

  const sectionType = section.type;
  const availableItems = inventory.filter((i) => i.item.item_type === sectionType);
  const currentSlots = draftSlots[sectionType];
  const sectionFull = currentSlots.length >= section.slots;

  return (
    <Sheet open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <SheetContent side="right" className="w-full sm:max-w-md flex flex-col gap-0 p-0">
        <SheetHeader className="px-4 pt-4 pb-3 border-b border-border">
          <SheetTitle className="flex items-center gap-2 text-base">
            <span className="text-xl">{section.icon}</span>
            {section.label}
          </SheetTitle>
          <SheetDescription className="text-xs">
            {sectionFull
              ? `Sekcja pełna (${section.slots}/${section.slots})`
              : availableItems.length > 0
                ? `${availableItems.length} przedmiot${availableItems.length === 1 ? "" : availableItems.length < 5 ? "y" : "ów"} dostępnych — ${currentSlots.length}/${section.slots} slotów zajętych`
                : "Brak przedmiotów w ekwipunku dla tej sekcji"}
          </SheetDescription>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto px-4 py-3 space-y-2">
          {availableItems.length === 0 ? (
            <div className="flex flex-col items-center gap-3 py-12 text-center">
              <span className="text-4xl opacity-30">{section.icon}</span>
              <p className="text-sm text-muted-foreground">Brak przedmiotów dla tej sekcji.</p>
              <p className="text-xs text-muted-foreground/60">Zdobywaj je przez grę lub kup na rynku.</p>
            </div>
          ) : (
            <div className="space-y-1.5">
              {availableItems.map((inv) => {
                const instanceId = inv.is_instance && inv.instance ? inv.instance.id : undefined;
                // For instances, check if THIS specific instance is already in deck
                const instanceAlreadyUsed = instanceId
                  ? currentSlots.some((s) => s.instance_id === instanceId)
                  : false;
                // For stackable/consumable, count by slug
                const inDraftCount = currentSlots.filter((s) => s.item_slug === inv.item.slug).length;
                const ownedQty = inv.quantity ?? 0;
                // Non-consumable non-instance items: one per slug
                const alreadyInDeck = !inv.item.is_consumable && !instanceId && inDraftCount >= 1;
                const refTaken = !!(inv.item.blueprint_ref && currentSlots.some(
                  (s) => s.blueprint_ref === inv.item.blueprint_ref
                ));
                const exhausted = inv.item.is_consumable && inDraftCount >= ownedQty;
                const disabled = sectionFull || instanceAlreadyUsed || alreadyInDeck || refTaken || exhausted;

                let disabledReason = "";
                if (sectionFull) disabledReason = "Sekcja pełna";
                else if (instanceAlreadyUsed) disabledReason = "Ta instancja już w talii";
                else if (alreadyInDeck) disabledReason = "Już w talii";
                else if (refTaken) disabledReason = "Inny poziom już dodany";
                else if (exhausted) disabledReason = "Wyczerpano ilość";

                return (
                  <PickerItem
                    key={inv.id}
                    inv={inv}
                    disabled={disabled}
                    disabledReason={disabledReason}
                    onAdd={() => {
                      onAdd(inv);
                      // Close sheet only if section is now full after adding
                      // (leave open so user can keep adding)
                    }}
                  />
                );
              })}
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function DeckEditorPage() {
  const { user, loading: authLoading } = useAuth();
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const deckId = params.id;

  // Editor state
  const [editName, setEditName] = useState("");
  const [isDefault, setIsDefault] = useState(false);
  const [draftSlots, setDraftSlots] = useState<Record<SectionType, SlotItem[]>>({
    tactical_package: [],
    blueprint_building: [],
    blueprint_unit: [],
    boost: [],
  });
  const [initialized, setInitialized] = useState(false);

  // Sheet state
  const [activeSection, setActiveSection] = useState<(typeof SECTION_CONFIG)[number] | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);

  // Queries
  const { data: deck, isLoading: deckLoading, isError: deckError } = useDeck(deckId);
  const { data: inventoryData, isLoading: inventoryLoading } = useMyInventory(500);

  // Mutations
  const updateDeckMutation = useUpdateDeck();
  const setDefaultDeckMutation = useSetDefaultDeck();

  const loading = deckLoading || inventoryLoading;
  const saving = updateDeckMutation.isPending || setDefaultDeckMutation.isPending;

  // Derived inventory list filtered to deck item types
  const inventory = (inventoryData?.items ?? []).filter((i) =>
    DECK_ITEM_TYPES.includes(i.item.item_type)
  );

  useEffect(() => {
    if (!authLoading && !user) router.replace("/login");
  }, [user, authLoading, router]);

  // Initialize form state from deck data (once)
  useEffect(() => {
    if (!deck || initialized) return;
    setEditName(deck.name);
    setIsDefault(deck.is_default);
    setDraftSlots(buildDraftSlotsFromDeck(deck));
    setInitialized(true);
  }, [deck, initialized]);

  // Redirect on error loading deck
  useEffect(() => {
    if (deckError) {
      toast.error("Nie udało się załadować talii");
      router.replace("/decks");
    }
  }, [deckError, router]);

  // ─── Slot interactions ───────────────────────────────────────────────────────

  const isLocked = deck?.is_editable === false;

  const addItemToSection = (invItem: InventoryItemOut) => {
    if (isLocked) return;
    const type = invItem.item.item_type as SectionType;
    const section = sectionForType(type);
    if (!section) return;

    setDraftSlots((prev) => {
      const current = prev[type];
      if (current.length >= section.slots) return prev;
      if (!invItem.item.is_consumable && current.some((s) => s.item_slug === invItem.item.slug)) {
        return prev;
      }
      const ref = invItem.item.blueprint_ref;
      if (ref && current.some((s) => s.blueprint_ref === ref)) {
        return prev;
      }
      return {
        ...prev,
        [type]: [
          ...current,
          {
            item_slug: invItem.item.slug,
            item_name: invItem.item.name,
            item_type: invItem.item.item_type,
            rarity: invItem.item.rarity,
            level: invItem.item.level ?? 1,
            icon: invItem.item.icon || "",
            blueprint_ref: ref || "",
            instance_id: invItem.is_instance && invItem.instance ? invItem.instance.id : undefined,
            is_stattrak: invItem.is_instance && invItem.instance?.stattrak || false,
          },
        ],
      };
    });
  };

  const removeSlotItem = (type: SectionType, index: number) => {
    if (isLocked) return;
    setDraftSlots((prev) => {
      const updated = [...prev[type]];
      updated.splice(index, 1);
      return { ...prev, [type]: updated };
    });
  };

  // ─── Save ────────────────────────────────────────────────────────────────────

  const handleSave = async () => {
    if (!deckId) return;

    const allSlotItems = [
      ...draftSlots.tactical_package,
      ...draftSlots.blueprint_building,
      ...draftSlots.blueprint_unit,
      ...draftSlots.boost,
    ];
    const countMap = new Map<string, number>();
    for (const s of allSlotItems) {
      countMap.set(s.item_slug, (countMap.get(s.item_slug) ?? 0) + 1);
    }
    const items = Array.from(countMap.entries()).map(
      ([item_slug, quantity]) => ({ item_slug, quantity })
    );

    try {
      await updateDeckMutation.mutateAsync({
        deckId,
        data: { name: editName.trim() || undefined, items },
      });

      if (isDefault && !deck?.is_default) {
        await setDefaultDeckMutation.mutateAsync(deckId);
      }

      toast.success("Talia zaktualizowana");
      router.push("/decks");
    } catch {
      toast.error("Nie udało się zapisać talii");
    }
  };

  const totalDraftItems = Object.values(draftSlots).reduce(
    (acc, arr) => acc + arr.length,
    0
  );

  if (authLoading || !user || loading) return <DeckEditorSkeleton />;

  return (
    <div className="animate-page-in space-y-4 md:space-y-6 -mx-4 md:mx-0 -mt-2 md:mt-0">
      {/* Locked deck banner */}
      {isLocked && (
        <div className="mx-4 md:mx-0 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-300">
          Ta talia jest domyślna i nie może być edytowana. Utwórz nową talię aby dostosować.
        </div>
      )}

      {/* Header */}
      <div className="px-4 md:px-0 flex items-center gap-3">
        <Link
          href="/decks"
          className="inline-flex items-center justify-center h-9 w-9 md:h-auto md:w-auto md:gap-1.5 rounded-full md:rounded-lg md:px-2 md:py-1.5 text-muted-foreground transition-all hover:text-foreground hover:bg-muted active:scale-[0.95] shrink-0"
        >
          <ArrowLeft className="h-4 w-4" />
          <span className="hidden md:inline text-sm">Powrót</span>
        </Link>
        <div className="min-w-0 flex-1">
          <p className="hidden md:block text-xs uppercase tracking-[0.24em] text-muted-foreground font-medium">
            Edytor talii
          </p>
          <h1 className="font-display text-xl md:text-3xl text-foreground truncate">
            {editName || "Edytor talii"}
          </h1>
        </div>
        {!loading && (
          <span className="text-xs text-muted-foreground tabular-nums shrink-0">
            {totalDraftItems} szt.
          </span>
        )}
      </div>

      {/* Controls bar */}
      <div className="px-4 md:px-0">
        {/* Mobile controls */}
        <div className="flex items-center gap-2 md:hidden">
          <Input
            type="text"
            value={editName}
            onChange={(e) => setEditName(e.target.value)}
            className="min-w-0 flex-1 h-10 text-sm"
            placeholder="Nazwa talii..."
            disabled={isLocked}
          />
          <button
            onClick={() => setIsDefault((v) => !v)}
            disabled={isLocked}
            className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full transition-colors disabled:opacity-40 ${
              isDefault ? "bg-accent/15 text-accent" : "bg-muted text-muted-foreground"
            }`}
          >
            {isDefault ? <Star className="h-4 w-4" /> : <StarOff className="h-4 w-4" />}
          </button>
          <button
            onClick={handleSave}
            disabled={saving || isLocked}
            className="flex h-10 items-center gap-1.5 rounded-full bg-primary px-4 text-sm font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-40 active:scale-[0.95] transition-all"
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
            Zapisz
          </button>
        </div>

        {/* Desktop controls */}
        <Card className="hidden md:block rounded-2xl backdrop-blur-xl">
          <CardContent className="flex flex-wrap items-center gap-3 px-5 py-4">
            <span className="text-xs font-semibold uppercase tracking-[0.24em] text-muted-foreground">
              Talia:
            </span>
            <Input
              type="text"
              value={editName}
              onChange={(e) => setEditName(e.target.value)}
              className="min-w-0 flex-1 h-11"
              disabled={isLocked}
            />
            <button
              onClick={() => setIsDefault((v) => !v)}
              disabled={isLocked}
              className={`flex h-11 items-center gap-1.5 rounded-lg border px-4 text-sm font-medium transition-colors disabled:opacity-40 ${
                isDefault
                  ? "border-accent/25 bg-accent/10 text-accent"
                  : "border-border bg-muted/40 text-muted-foreground hover:border-accent/20 hover:text-accent"
              }`}
            >
              {isDefault ? <Star className="h-4 w-4" /> : <StarOff className="h-4 w-4" />}
              {isDefault ? "Domyślna" : "Ustaw domyślną"}
            </button>
            <Button
              size="sm"
              onClick={handleSave}
              disabled={saving || isLocked}
              className="h-11 gap-1.5 rounded-xl bg-primary/20 text-primary hover:bg-primary/30 border border-primary/20 px-5 text-base"
            >
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
              Zapisz
            </Button>
            <Link href="/decks">
              <Button
                size="sm"
                variant="ghost"
                className="h-11 rounded-xl text-muted-foreground hover:text-foreground px-4 text-base"
              >
                <X className="mr-1 h-4 w-4" />
                Anuluj
              </Button>
            </Link>
            <span className="ml-auto text-sm text-muted-foreground">
              {totalDraftItems} przedmiot
              {totalDraftItems === 1 ? "" : totalDraftItems < 5 ? "y" : "ów"}
            </span>
          </CardContent>
        </Card>
      </div>

      {/* Section grid */}
      <div className="px-4 md:px-0 grid grid-cols-1 gap-3 md:gap-4 sm:grid-cols-2">
        {SECTION_CONFIG.map((section) => (
          <DeckSectionCard
            key={section.type}
            section={section}
            slots={draftSlots[section.type]}
            onSlotClick={() => {
              setActiveSection(section);
              setSheetOpen(true);
            }}
            onRemoveItem={(index) => removeSlotItem(section.type, index)}
            isLocked={isLocked}
          />
        ))}
      </div>

      {/* Section picker sheet */}
      <SectionPickerSheet
        open={sheetOpen}
        onClose={() => setSheetOpen(false)}
        section={activeSection}
        inventory={inventory}
        draftSlots={draftSlots}
        onAdd={(inv) => {
          addItemToSection(inv);
        }}
      />
    </div>
  );
}
