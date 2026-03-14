"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import {
  ArrowLeft,
  Check,
  Star,
  StarOff,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/useAuth";
import {
  getDeck,
  getMyInventory,
  setDefaultDeck,
  updateDeck,
  type DeckOut,
  type InventoryItemOut,
} from "@/lib/api";

// ─── Constants ────────────────────────────────────────────────────────────────

const SECTION_CONFIG = [
  {
    type: "tactical_package",
    label: "Pakiety Taktyczne",
    icon: "⚡",
    color: "text-cyan-300",
    accentBg: "bg-cyan-500/10",
    accentBorder: "border-cyan-500/20",
    slots: 5,
  },
  {
    type: "blueprint_building",
    label: "Budynki",
    icon: "🏗️",
    color: "text-amber-300",
    accentBg: "bg-amber-500/10",
    accentBorder: "border-amber-500/20",
    slots: 6,
  },
  {
    type: "boost",
    label: "Bonusy",
    icon: "🚀",
    color: "text-emerald-300",
    accentBg: "bg-emerald-500/10",
    accentBorder: "border-emerald-500/20",
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

const RARITY_BG: Record<string, string> = {
  common: "bg-slate-500/[0.07]",
  uncommon: "bg-green-500/[0.07]",
  rare: "bg-blue-500/[0.07]",
  epic: "bg-purple-500/[0.07]",
  legendary: "bg-amber-500/[0.07]",
};

// ─── Types ────────────────────────────────────────────────────────────────────

interface SlotItem {
  item_slug: string;
  item_name: string;
  item_type: string;
  rarity: string;
  level: number;
  icon: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function levelBadgeClass(level: number): string {
  if (level >= 3) return "text-amber-300";
  if (level === 2) return "text-cyan-300";
  return "text-zinc-500";
}

function sectionForType(type: string) {
  return SECTION_CONFIG.find((s) => s.type === type);
}

// ─── Sub-components ───────────────────────────────────────────────────────────

interface FilledSlotProps {
  item: SlotItem;
  onRemove: () => void;
}

function FilledSlot({ item, onRemove }: FilledSlotProps) {
  const [hovered, setHovered] = useState(false);
  const rarity = item.rarity || "common";

  return (
    <div
      className={`group relative aspect-square rounded-lg border border-l-2 ${RARITY_LEFT_BORDER[rarity]} ${RARITY_BG[rarity]} border-white/10 bg-white/[0.04] flex flex-col items-center justify-center cursor-pointer transition-all duration-150 hover:border-white/30 hover:bg-white/[0.08] hover:scale-[1.03]`}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onClick={onRemove}
      title={`${item.item_name} — kliknij aby usunąć`}
    >
      {hovered && (
        <div className="absolute right-1 top-1 flex h-4 w-4 items-center justify-center rounded-full bg-red-500/80 text-white z-10">
          <X className="h-2.5 w-2.5" />
        </div>
      )}
      <div
        className={`absolute left-1 top-1 text-[10px] font-bold leading-none ${levelBadgeClass(item.level)}`}
      >
        {item.level}
      </div>
      <span className="text-2xl leading-none select-none">
        {item.icon || "📦"}
      </span>
      <p className="mt-1 max-w-full truncate px-1 text-center text-[10px] leading-none text-zinc-300">
        {item.item_name}
      </p>
    </div>
  );
}

function EmptySlot() {
  return (
    <div className="aspect-square rounded-lg border border-dashed border-white/[0.08] bg-white/[0.02] transition-colors hover:border-white/[0.15]" />
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function DeckEditorPage() {
  const { user, loading: authLoading, token } = useAuth();
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const deckId = params.id;

  const [deck, setDeck] = useState<DeckOut | null>(null);
  const [inventory, setInventory] = useState<InventoryItemOut[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // Editor state
  const [editName, setEditName] = useState("");
  const [isDefault, setIsDefault] = useState(false);
  const [draftSlots, setDraftSlots] = useState<Record<SectionType, SlotItem[]>>(
    {
      tactical_package: [],
      blueprint_building: [],
      boost: [],
    }
  );
  const [availableTab, setAvailableTab] =
    useState<SectionType>("tactical_package");

  useEffect(() => {
    if (!authLoading && !user) router.replace("/login");
  }, [user, authLoading, router]);

  const loadData = useCallback(async () => {
    if (!token || !deckId) return;
    try {
      const [deckRes, invRes] = await Promise.all([
        getDeck(token, deckId),
        getMyInventory(token),
      ]);

      setDeck(deckRes);
      setInventory(
        invRes.items.filter((i) => DECK_ITEM_TYPES.includes(i.item.item_type))
      );

      // Populate editor state
      setEditName(deckRes.name);
      setIsDefault(deckRes.is_default);

      const slots: Record<SectionType, SlotItem[]> = {
        tactical_package: [],
        blueprint_building: [],
        boost: [],
      };
      for (const di of deckRes.items) {
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
            });
          }
        }
      }
      setDraftSlots(slots);
    } catch {
      toast.error("Nie udało się załadować talii");
      router.replace("/decks");
    } finally {
      setLoading(false);
    }
  }, [token, deckId, router]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // ─── Slot interactions ───────────────────────────────────────────────────────

  const addItemToSection = (invItem: InventoryItemOut) => {
    const type = invItem.item.item_type as SectionType;
    const section = sectionForType(type);
    if (!section) return;

    setDraftSlots((prev) => {
      const current = prev[type];
      if (current.length >= section.slots) return prev;
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
          },
        ],
      };
    });
  };

  const removeSlotItem = (type: SectionType, index: number) => {
    setDraftSlots((prev) => {
      const updated = [...prev[type]];
      updated.splice(index, 1);
      return { ...prev, [type]: updated };
    });
  };

  // ─── Save ────────────────────────────────────────────────────────────────────

  const handleSave = async () => {
    if (!token || !deckId) return;
    setSaving(true);
    try {
      const allSlotItems = [
        ...draftSlots.tactical_package,
        ...draftSlots.blueprint_building,
        ...draftSlots.boost,
      ];
      const countMap = new Map<string, number>();
      for (const s of allSlotItems) {
        countMap.set(s.item_slug, (countMap.get(s.item_slug) ?? 0) + 1);
      }
      const items = Array.from(countMap.entries()).map(
        ([item_slug, quantity]) => ({ item_slug, quantity })
      );

      await updateDeck(token, deckId, {
        name: editName.trim() || undefined,
        items,
      });

      // Handle default toggle
      if (isDefault && !deck?.is_default) {
        await setDefaultDeck(token, deckId);
      }

      toast.success("Talia zaktualizowana");
      router.push("/decks");
    } catch {
      toast.error("Nie udało się zapisać talii");
    } finally {
      setSaving(false);
    }
  };

  // ─── Available items helpers ──────────────────────────────────────────────────

  const countInDraft = (slug: string, type: SectionType): number =>
    draftSlots[type].filter((s) => s.item_slug === slug).length;

  const ownedQty = (slug: string): number =>
    inventory.find((i) => i.item.slug === slug)?.quantity ?? 0;

  const availableItems = inventory.filter(
    (i) => i.item.item_type === availableTab
  );

  const totalDraftItems = Object.values(draftSlots).reduce(
    (acc, arr) => acc + arr.length,
    0
  );

  if (authLoading || !user) return null;

  if (loading) {
    return (
      <div className="space-y-5">
        <div className="h-8 w-24 animate-pulse rounded-lg bg-white/[0.04]" />
        <div className="h-16 animate-pulse rounded-2xl border border-white/10 bg-white/[0.05]" />
        <div className="h-64 animate-pulse rounded-2xl border border-white/10 bg-white/[0.05]" />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* Back */}
      <Link
        href="/decks"
        className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-sm text-slate-400 transition-all hover:text-zinc-100 hover:bg-white/[0.08]"
      >
        <ArrowLeft className="h-4 w-4" />
        Powrót do talii
      </Link>

      {/* Editor top bar */}
      <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-white/10 bg-slate-950/55 px-4 py-3 backdrop-blur-xl sm:gap-3">
        <span className="text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-400">
          Talia:
        </span>
        <input
          type="text"
          value={editName}
          onChange={(e) => setEditName(e.target.value)}
          className="min-w-0 flex-1 rounded-xl border border-white/10 bg-white/[0.04] px-3 py-1.5 text-sm font-medium text-zinc-100 placeholder:text-slate-500 focus:border-cyan-400/40 focus:outline-none"
        />

        <button
          onClick={() => setIsDefault((v) => !v)}
          className={`flex h-8 items-center gap-1.5 rounded-lg border px-3 text-xs font-medium transition-colors ${
            isDefault
              ? "border-amber-400/25 bg-amber-400/10 text-amber-300"
              : "border-white/10 bg-white/[0.04] text-slate-400 hover:border-amber-400/20 hover:text-amber-300"
          }`}
        >
          {isDefault ? (
            <Star className="h-3.5 w-3.5" />
          ) : (
            <StarOff className="h-3.5 w-3.5" />
          )}
          {isDefault ? "Domyślna" : "Ustaw domyślną"}
        </button>

        <Button
          size="sm"
          onClick={handleSave}
          disabled={saving}
          className="gap-1.5 rounded-xl bg-cyan-500/20 text-cyan-200 hover:bg-cyan-500/30 border border-cyan-400/20"
        >
          <Check className="h-4 w-4" />
          Zapisz
        </Button>
        <Link href="/decks">
          <Button
            size="sm"
            variant="ghost"
            className="rounded-xl text-slate-400 hover:text-zinc-200"
          >
            <X className="mr-1 h-4 w-4" />
            Anuluj
          </Button>
        </Link>

        <span className="ml-auto text-xs text-slate-400">
          {totalDraftItems} przedmiot
          {totalDraftItems === 1 ? "" : totalDraftItems < 5 ? "y" : "ów"}
        </span>
      </div>

      {/* Slot sections */}
      <div className="rounded-2xl border border-white/10 bg-slate-950/55 p-6 backdrop-blur-xl space-y-6">
        {SECTION_CONFIG.map((section) => {
          const slots = draftSlots[section.type];
          const filled = slots.length;
          const empty = section.slots - filled;

          return (
            <div key={section.type}>
              <div className="mb-3 flex items-center gap-2">
                <span className="text-base leading-none">{section.icon}</span>
                <span
                  className={`text-[11px] font-semibold uppercase tracking-[0.24em] ${section.color}`}
                >
                  {section.label}
                </span>
                <span className="text-[11px] text-slate-400">
                  ({filled}/{section.slots})
                </span>
                <div className="h-px flex-1 bg-white/[0.04]" />
              </div>

              <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-7 xl:grid-cols-9">
                {slots.map((slot, i) => (
                  <FilledSlot
                    key={`${slot.item_slug}-${i}`}
                    item={slot}
                    onRemove={() => removeSlotItem(section.type, i)}
                  />
                ))}
                {Array.from({ length: empty }).map((_, i) => (
                  <EmptySlot key={`empty-${i}`} />
                ))}
              </div>
            </div>
          );
        })}
      </div>

      {/* Available items */}
      <div className="rounded-2xl border border-white/10 bg-slate-950/55 p-6 backdrop-blur-xl">
        <p className="mb-3 text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-400">
          Dostępne przedmioty
        </p>

        {/* Tab pills */}
        <div className="mb-4 flex gap-1.5 overflow-x-auto pb-0.5 scrollbar-none [-ms-overflow-style:none] [scrollbar-width:none]">
          {SECTION_CONFIG.map((s) => (
            <button
              key={s.type}
              onClick={() => setAvailableTab(s.type)}
              className={`flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                availableTab === s.type
                  ? `${s.accentBg} ${s.accentBorder} ${s.color}`
                  : "border-white/10 text-slate-400 hover:border-white/25 hover:bg-white/[0.08] hover:text-slate-200"
              }`}
            >
              <span className="text-sm leading-none">{s.icon}</span>
              {s.label}
              <span
                className={`rounded-full px-1.5 py-0.5 text-[10px] font-bold ${availableTab === s.type ? "bg-white/20" : "bg-white/[0.06]"}`}
              >
                {inventory.filter((i) => i.item.item_type === s.type).length}
              </span>
            </button>
          ))}
        </div>

        {/* Items grid */}
        {availableItems.length === 0 ? (
          <p className="py-4 text-center text-sm text-slate-400">
            Brak przedmiotów tego typu w ekwipunku
          </p>
        ) : (
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-7">
            {availableItems.map((inv) => {
              const currentSection = sectionForType(availableTab);
              const inDraftCount = countInDraft(inv.item.slug, availableTab);
              const owned = ownedQty(inv.item.slug);
              const sectionFull =
                draftSlots[availableTab].length >= (currentSection?.slots ?? 0);
              const exhausted = inDraftCount >= owned;
              const disabled = sectionFull || exhausted;

              return (
                <button
                  key={inv.id}
                  onClick={() => !disabled && addItemToSection(inv)}
                  disabled={disabled}
                  title={
                    disabled
                      ? sectionFull
                        ? "Sekcja pełna"
                        : "Brak sztuk"
                      : `Dodaj ${inv.item.name}`
                  }
                  className={`group relative flex flex-col items-center gap-1 rounded-lg border p-2 transition-all ${
                    disabled
                      ? "border-white/[0.04] bg-white/[0.01] opacity-35 cursor-not-allowed"
                      : `border-white/10 bg-white/[0.04] cursor-pointer hover:border-white/30 hover:bg-white/[0.10] hover:scale-[1.02] ${RARITY_BG[inv.item.rarity]}`
                  }`}
                >
                  <span className="text-xl leading-none select-none">
                    {inv.item.icon || "📦"}
                  </span>
                  <p className="line-clamp-2 text-center text-[10px] leading-tight text-zinc-300 group-hover:text-zinc-200">
                    {inv.item.name}
                  </p>
                  <span
                    className={`text-[10px] font-bold ${levelBadgeClass(inv.item.level ?? 1)}`}
                  >
                    Lvl {inv.item.level ?? 1}
                  </span>
                  <span className="text-[10px] text-slate-400">
                    Posiadasz: {owned - inDraftCount}
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
