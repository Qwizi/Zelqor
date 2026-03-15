"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import {
  ArrowLeft,
  Check,
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
import { Separator } from "@/components/ui/separator";
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
  blueprint_ref: string;
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
      className={`group relative aspect-square rounded-lg border border-l-2 ${RARITY_LEFT_BORDER[rarity]} ${RARITY_BG[rarity]} border-border bg-muted/40 flex flex-col items-center justify-center cursor-pointer transition-all duration-150 hover:border-border/60 hover:bg-muted hover:scale-[1.03]`}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onClick={onRemove}
      title={`${item.item_name} — kliknij aby usunąć`}
    >
      {hovered && (
        <div className="absolute right-1 top-1 flex h-5 w-5 items-center justify-center rounded-full bg-destructive/80 text-destructive-foreground z-10">
          <X className="h-3 w-3" />
        </div>
      )}
      <div
        className={`absolute left-1 top-1 text-xs font-bold leading-none ${levelBadgeClass(item.level)}`}
      >
        {item.level}
      </div>
      <span className="text-2xl leading-none select-none">
        {item.icon || "📦"}
      </span>
      <p className="mt-1 max-w-full truncate px-1 text-center text-xs leading-none text-foreground">
        {item.item_name}
      </p>
    </div>
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
              blueprint_ref: di.item.blueprint_ref || "",
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
      // Non-consumable items can only appear once per deck
      if (!invItem.item.is_consumable && current.some((s) => s.item_slug === invItem.item.slug)) {
        return prev;
      }
      // Only one level per blueprint_ref (e.g. barracks lvl 1 OR lvl 2, not both)
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
        <div className="h-8 w-24 animate-pulse rounded-lg bg-muted/40" />
        <div className="h-16 animate-pulse rounded-2xl border border-border bg-muted/20" />
        <div className="h-64 animate-pulse rounded-2xl border border-border bg-muted/20" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Back */}
      <Link
        href="/decks"
        className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-base text-muted-foreground transition-all hover:text-foreground hover:bg-muted"
      >
        <ArrowLeft className="h-4 w-4" />
        Powrót do talii
      </Link>

      {/* Editor top bar */}
      <Card className="rounded-2xl backdrop-blur-xl">
        <CardContent className="flex flex-wrap items-center gap-3 px-5 py-4">
          <span className="text-xs font-semibold uppercase tracking-[0.24em] text-muted-foreground">
            Talia:
          </span>
          <Input
            type="text"
            value={editName}
            onChange={(e) => setEditName(e.target.value)}
            className="min-w-0 flex-1 h-11"
          />

          <button
            onClick={() => setIsDefault((v) => !v)}
            className={`flex h-11 items-center gap-1.5 rounded-lg border px-4 text-sm font-medium transition-colors ${
              isDefault
                ? "border-accent/25 bg-accent/10 text-accent"
                : "border-border bg-muted/40 text-muted-foreground hover:border-accent/20 hover:text-accent"
            }`}
          >
            {isDefault ? (
              <Star className="h-4 w-4" />
            ) : (
              <StarOff className="h-4 w-4" />
            )}
            {isDefault ? "Domyślna" : "Ustaw domyślną"}
          </button>

          <Button
            size="sm"
            onClick={handleSave}
            disabled={saving}
            className="h-11 gap-1.5 rounded-xl bg-primary/20 text-primary hover:bg-primary/30 border border-primary/20 px-5 text-base"
          >
            <Check className="h-4 w-4" />
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

      {/* Two-column layout: deck slots (left) + available items (right) */}
      <div className="flex gap-6" style={{ minHeight: "calc(100vh - 16rem)" }}>
        {/* ── Left: Deck slots ── */}
        <Card className="rounded-2xl flex-1 min-w-0 overflow-y-auto">
          <CardContent className="p-6 space-y-6">
            {SECTION_CONFIG.map((section) => {
              const slots = draftSlots[section.type];
              const filled = slots.length;

              return (
                <div key={section.type}>
                  <div className="mb-3 flex items-center gap-2">
                    <span className="text-xl leading-none">{section.icon}</span>
                    <span className={`text-sm font-semibold uppercase tracking-[0.2em] ${section.colorClass}`}>
                      {section.label}
                    </span>
                    <span className="text-sm text-muted-foreground">
                      ({filled}/{section.slots})
                    </span>
                    <div className="h-px flex-1 bg-border/40" />
                  </div>

                  {filled === 0 ? (
                    <p className="text-base text-muted-foreground/50 py-3">Brak — dodaj z prawej strony</p>
                  ) : (
                    <div className="space-y-1.5">
                      {slots.map((slot, i) => (
                        <div
                          key={`${slot.item_slug}-${i}`}
                          className="flex items-center gap-3 rounded-xl border border-border bg-secondary/50 px-4 py-3 transition-all hover:border-destructive/30 hover:bg-destructive/5 cursor-pointer group"
                          onClick={() => removeSlotItem(section.type, i)}
                          title="Kliknij aby usunąć"
                        >
                          <span className="text-2xl">{slot.icon || "📦"}</span>
                          <div className="flex-1 min-w-0">
                            <p className="text-base font-medium text-foreground truncate">{slot.item_name}</p>
                          </div>
                          <span className={`text-sm font-bold ${levelBadgeClass(slot.level)}`}>
                            Lvl {slot.level}
                          </span>
                          <X className="h-4 w-4 text-muted-foreground opacity-0 group-hover:opacity-100 group-hover:text-destructive transition-opacity" />
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </CardContent>
        </Card>

        {/* ── Right: Available items ── */}
        <Card className="rounded-2xl w-80 lg:w-96 shrink-0 overflow-y-auto">
          <CardContent className="p-5">
            <p className="mb-4 text-sm font-semibold uppercase tracking-[0.2em] text-muted-foreground">
              Dodaj do talii
            </p>

            {/* Tab pills */}
            <div className="mb-4 flex flex-wrap gap-1.5">
              {SECTION_CONFIG.map((s) => (
                <button
                  key={s.type}
                  onClick={() => setAvailableTab(s.type)}
                  className={`flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm font-medium transition-colors ${
                    availableTab === s.type
                      ? "border-primary/40 bg-primary/15 text-primary"
                      : "border-border text-muted-foreground hover:border-border/50 hover:bg-muted hover:text-foreground"
                  }`}
                >
                  <span className="text-sm leading-none">{s.icon}</span>
                  {s.label}
                  <span className={`text-xs font-bold ${availableTab === s.type ? "text-primary/70" : "text-muted-foreground/50"}`}>
                    {inventory.filter((i) => i.item.item_type === s.type).length}
                  </span>
                </button>
              ))}
            </div>

            <Separator className="mb-4" />

            {/* Items list */}
            {availableItems.length === 0 ? (
              <p className="py-8 text-center text-base text-muted-foreground">
                Brak przedmiotów
              </p>
            ) : (
              <div className="space-y-1.5">
                {availableItems.map((inv) => {
                  const currentSection = sectionForType(availableTab);
                  const inDraftCount = countInDraft(inv.item.slug, availableTab);
                  const owned = ownedQty(inv.item.slug);
                  const sectionFull = draftSlots[availableTab].length >= (currentSection?.slots ?? 0);
                  const alreadyInDeck = !inv.item.is_consumable && inDraftCount >= 1;
                  const refTaken = !!(inv.item.blueprint_ref && draftSlots[availableTab].some(
                    (s) => s.blueprint_ref === inv.item.blueprint_ref
                  ));
                  const exhausted = inv.item.is_consumable && inDraftCount >= owned;
                  const disabled = sectionFull || alreadyInDeck || refTaken || exhausted;

                  return (
                    <button
                      key={inv.id}
                      onClick={() => !disabled && addItemToSection(inv)}
                      disabled={disabled}
                      className={`w-full flex items-center gap-3 rounded-xl border px-3 py-2.5 text-left transition-all ${
                        disabled
                          ? "border-border/20 opacity-30 cursor-not-allowed"
                          : "border-border hover:border-primary/30 hover:bg-primary/5 cursor-pointer"
                      }`}
                    >
                      <span className="text-xl shrink-0">{inv.item.icon || "📦"}</span>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-foreground truncate">{inv.item.name}</p>
                        <p className="text-xs text-muted-foreground">
                          Lvl {inv.item.level ?? 1} · {owned - inDraftCount} szt.
                        </p>
                      </div>
                      {!disabled && <Plus className="h-4 w-4 text-primary shrink-0" />}
                    </button>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
