"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Backpack,
  Coins,
  Gift,
  KeyRound,
  Lock,
  Package,
  ShoppingCart,
  TrendingDown,
  TrendingUp,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/useAuth";
import {
  getMyInventory,
  getMyWallet,
  getMyDrops,
  openCrate,
  type InventoryItemOut,
  type WalletOut,
  type ItemDropOut,
} from "@/lib/api";

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

type Tab = "inventory" | "drops";

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
  if (level === 2) return "text-cyan-300";
  return "text-zinc-500";
}

// ─── Slot component ────────────────────────────────────────────────────────────

interface SlotProps {
  entry: InventoryItemOut;
  isSelected: boolean;
  onClick: () => void;
}

function FilledSlot({ entry, isSelected, onClick }: SlotProps) {
  const rarity = entry.item.rarity;

  return (
    <button
      onClick={onClick}
      className={[
        "group relative aspect-square rounded-lg border border-l-2 flex flex-col items-center justify-center transition-all duration-150",
        RARITY_LEFT_BORDER[rarity] ?? "border-l-slate-500/50",
        RARITY_SLOT_BG[rarity] ?? "bg-slate-500/[0.07]",
        "border-white/10",
        "hover:border-white/30 hover:bg-white/[0.08] hover:scale-[1.03]",
        isSelected ? "ring-1 ring-white/25 bg-white/[0.10] scale-[1.02]" : "",
      ].join(" ")}
      title={entry.item.name}
    >
      {/* Level badge — top left */}
      <div className={`absolute left-1 top-1 text-[9px] font-bold leading-none ${levelBadgeClass(entry.item.level)}`}>
        {entry.item.level}
      </div>

      {/* Quantity badge — top right */}
      {entry.quantity > 1 && (
        <span className="absolute right-1 top-1 rounded bg-slate-900/80 px-1 py-px text-[9px] font-semibold leading-none text-zinc-200 border border-white/10">
          x{entry.quantity}
        </span>
      )}

      {/* Icon */}
      <span className="text-2xl leading-none select-none">{entry.item.icon || "📦"}</span>

      {/* Name */}
      <p className="mt-1 max-w-full truncate px-1 text-center text-[9px] leading-none text-zinc-400">
        {entry.item.name.replace(/^(Pakiet|Blueprint|Bonus): ?/, "")}
      </p>
    </button>
  );
}

function EmptySlot() {
  return (
    <div className="aspect-square rounded-lg border border-dashed border-white/[0.08] bg-white/[0.02]" />
  );
}

// ─── Detail panel ──────────────────────────────────────────────────────────────

interface DetailPanelProps {
  entry: InventoryItemOut;
  hasMatchingKey: boolean;
  onOpenCrate: (slug: string) => void;
  onClose: () => void;
}

function DetailPanel({ entry, hasMatchingKey, onOpenCrate, onClose }: DetailPanelProps) {
  const { item } = entry;
  const rarity = item.rarity;

  const displayIcon = item.icon || TYPE_LETTER[item.item_type] || "?";

  return (
    <div className="mt-4 rounded-xl border border-white/10 bg-white/[0.05] p-4 sm:p-5">
      <div className="flex items-start justify-between gap-3 sm:gap-4">
        {/* Left: icon */}
        <div
          className={[
            "flex h-14 w-14 shrink-0 items-center justify-center rounded-xl border border-l-[3px] text-3xl",
            "border-white/10",
            RARITY_BORDER[rarity] ?? "border-l-slate-400",
            "bg-white/[0.05]",
          ].join(" ")}
        >
          {displayIcon}
        </div>

        {/* Center: info */}
        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-center gap-2 mb-1">
            <h3 className="font-display text-base font-semibold text-zinc-50 leading-tight truncate">
              {item.name}
            </h3>
            <span
              className={[
                "shrink-0 rounded-full border px-2 py-px text-[10px] font-medium uppercase tracking-wide",
                RARITY_BG_BADGE[rarity] ?? "",
              ].join(" ")}
            >
              {RARITY_LABELS[rarity] ?? rarity}
            </span>
            <span className="shrink-0 rounded-full border border-white/10 bg-white/[0.05] px-2 py-px text-[10px] text-slate-400 uppercase tracking-wide">
              {TYPE_LABELS[item.item_type] ?? item.item_type}
            </span>
            {item.level > 1 && (
              <span className="shrink-0 rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-px text-[10px] text-amber-300">
                Lvl {item.level}
              </span>
            )}
          </div>

          {item.description && (
            <p className="text-xs text-slate-400 leading-relaxed mb-3">
              {item.description}
            </p>
          )}

          <div className="flex flex-wrap items-center gap-4 text-xs">
            <span className="text-slate-400">
              Posiadasz:{" "}
              <span className="font-mono font-semibold text-zinc-200">
                {entry.quantity}
              </span>
            </span>
            {item.base_value > 0 && (
              <span className="flex items-center gap-1 text-amber-300/70">
                <Coins className="h-3 w-3" />
                <span className="font-mono tabular-nums">{item.base_value}</span>
                <span className="text-slate-400">bazowa wartość</span>
              </span>
            )}
          </div>
        </div>

        {/* Close */}
        <button
          onClick={onClose}
          className="shrink-0 text-slate-500 hover:text-slate-300 text-lg leading-none"
          aria-label="Zamknij"
        >
          ×
        </button>
      </div>

      {/* Actions */}
      <div className="mt-4 flex flex-wrap gap-2 border-t border-white/10 pt-4">
        {item.item_type === "crate" && (
          <Button
            size="sm"
            variant="outline"
            className="h-8 gap-1.5 rounded-full text-xs"
            onClick={() => onOpenCrate(item.slug)}
          >
            {hasMatchingKey ? (
              <>
                <KeyRound className="h-3 w-3" />
                Otwórz skrzynię
              </>
            ) : (
              <>
                <Lock className="h-3 w-3" />
                Brak klucza
              </>
            )}
          </Button>
        )}
        {item.is_tradeable && item.item_type !== "crate" && (
          <Button
            size="sm"
            variant="outline"
            className="h-8 gap-1.5 rounded-full text-xs border-cyan-500/30 text-cyan-300 hover:bg-cyan-500/10"
          >
            <ShoppingCart className="h-3 w-3" />
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
  const [tab, setTab] = useState<Tab>("inventory");
  const [filter, setFilter] = useState<string>("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  useEffect(() => {
    if (!authLoading && !user) router.replace("/login");
  }, [user, authLoading, router]);

  const loadData = useCallback(async () => {
    if (!token) return;
    try {
      const [invRes, wal, drRes] = await Promise.all([
        getMyInventory(token, 200),
        getMyWallet(token),
        getMyDrops(token, 50),
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
      setSelectedId(null);
      loadData();
    } catch {
      toast.error("Nie udało się otworzyć skrzynki");
    }
  };

  const filteredInventory =
    filter === "all"
      ? inventory
      : inventory.filter((i) => i.item.item_type === filter);

  const selectedEntry = selectedId
    ? filteredInventory.find((e) => e.id === selectedId) ?? null
    : null;

  // Total slots to render — always at least MIN_SLOTS
  const totalSlots = Math.max(MIN_SLOTS, filteredInventory.length);
  const emptyCount = totalSlots - filteredInventory.length;

  if (authLoading || !user) return null;

  return (
    <div className="space-y-6">

      {/* ── Page header ─────────────────────────────────────────────────────── */}
      <div className="space-y-1">
        <p className="text-[11px] uppercase tracking-[0.24em] text-slate-400">Ekwipunek</p>
        <h1 className="font-display text-3xl text-zinc-50">Twój ekwipunek</h1>
      </div>

      {/* ── Wallet bar ──────────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-white/10 bg-slate-950/55 px-4 py-3 backdrop-blur-xl">
        <span className="mr-auto text-xs font-semibold uppercase tracking-[0.24em] text-slate-400">
          Portfel
        </span>

        {wallet ? (
          <>
            <span className="flex items-center gap-1.5 font-mono tabular-nums text-sm font-medium text-amber-300">
              <Coins className="h-3.5 w-3.5" />
              {wallet.gold.toLocaleString("pl-PL")}
              <span className="text-slate-400 font-normal">złoto</span>
            </span>
            <span className="h-3 w-px bg-white/10 hidden sm:block" />
            <span className="flex items-center gap-1 font-mono tabular-nums text-sm text-green-300">
              <TrendingUp className="h-3.5 w-3.5" />
              {wallet.total_earned.toLocaleString("pl-PL")}
              <span className="text-slate-400 text-xs font-normal">zarobione</span>
            </span>
            <span className="h-3 w-px bg-white/10 hidden sm:block" />
            <span className="flex items-center gap-1 font-mono tabular-nums text-sm text-red-400">
              <TrendingDown className="h-3.5 w-3.5" />
              {wallet.total_spent.toLocaleString("pl-PL")}
              <span className="text-slate-400 text-xs font-normal">wydane</span>
            </span>
          </>
        ) : (
          <span className="text-xs text-slate-400">Ładowanie...</span>
        )}
      </div>

      {/* ── Tab nav ─────────────────────────────────────────────────────────── */}
      <div className="flex gap-1">
        <button
          onClick={() => setTab("inventory")}
          className={[
            "flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm transition-colors",
            tab === "inventory"
              ? "bg-white/10 text-zinc-100"
              : "text-slate-400 hover:text-zinc-100 hover:bg-white/[0.08]",
          ].join(" ")}
        >
          <Backpack className="h-3.5 w-3.5" />
          Ekwipunek
          <span className="ml-0.5 text-[10px] text-slate-500">
            {inventory.length}
          </span>
        </button>
        <button
          onClick={() => setTab("drops")}
          className={[
            "flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm transition-colors",
            tab === "drops"
              ? "bg-white/10 text-zinc-100"
              : "text-slate-400 hover:text-zinc-100 hover:bg-white/[0.08]",
          ].join(" ")}
        >
          <Gift className="h-3.5 w-3.5" />
          Ostatnie dropy
        </button>
      </div>

      {/* ── Inventory tab ───────────────────────────────────────────────────── */}
      {tab === "inventory" && (
        <div className="rounded-2xl border border-white/10 bg-slate-950/55 backdrop-blur-xl">

          {/* Filter pills */}
          <div className="flex gap-1.5 overflow-x-auto border-b border-white/10 px-4 py-3 scrollbar-none [-ms-overflow-style:none] [scrollbar-width:none]">
            {FILTERS.map((f) => {
              const count =
                f.value === "all"
                  ? inventory.length
                  : inventory.filter((i) => i.item.item_type === f.value).length;
              if (f.value !== "all" && count === 0) return null;
              return (
                <button
                  key={f.value}
                  onClick={() => {
                    setFilter(f.value);
                    setSelectedId(null);
                  }}
                  className={[
                    "flex items-center gap-1 rounded-full px-3 py-1 text-xs font-medium transition-colors",
                    filter === f.value
                      ? "bg-cyan-500/15 border border-cyan-400/25 text-cyan-100"
                      : "border border-white/[0.08] text-slate-400 hover:bg-white/[0.10] hover:border-white/20 hover:text-slate-100",
                  ].join(" ")}
                >
                  {f.label}
                  <span
                    className={[
                      "rounded-full px-1 text-[10px] font-semibold tabular-nums",
                      filter === f.value ? "text-cyan-300/70" : "text-slate-500",
                    ].join(" ")}
                  >
                    {count}
                  </span>
                </button>
              );
            })}
          </div>

          {/* Slot grid */}
          <div className="p-4">
            {loading ? (
              <div className="flex h-40 items-center justify-center text-sm text-slate-500">
                Ładowanie ekwipunku...
              </div>
            ) : (
              <>
                <div className="grid grid-cols-4 gap-1.5 sm:grid-cols-5 md:grid-cols-7 lg:grid-cols-9 xl:grid-cols-11">
                  {filteredInventory.map((entry) => (
                    <FilledSlot
                      key={entry.id}
                      entry={entry}
                      isSelected={selectedId === entry.id}
                      onClick={() =>
                        setSelectedId(
                          selectedId === entry.id ? null : entry.id
                        )
                      }
                    />
                  ))}
                  {Array.from({ length: emptyCount }).map((_, i) => (
                    <EmptySlot key={`empty-${i}`} />
                  ))}
                </div>

                {/* Detail panel */}
                {selectedEntry && (
                  <DetailPanel
                    entry={selectedEntry}
                    hasMatchingKey={hasMatchingKey(selectedEntry.item.slug)}
                    onOpenCrate={handleOpenCrate}
                    onClose={() => setSelectedId(null)}
                  />
                )}

                {filteredInventory.length === 0 && (
                  <p className="mt-6 text-center text-sm text-slate-500">
                    Brak przedmiotów w tej kategorii.
                  </p>
                )}
              </>
            )}
          </div>
        </div>
      )}

      {/* ── Drops tab ───────────────────────────────────────────────────────── */}
      {tab === "drops" && (
        <div className="rounded-2xl border border-white/10 bg-slate-950/55 backdrop-blur-xl">
          <div className="flex items-center gap-2 border-b border-white/10 px-4 py-3">
            <Package className="h-4 w-4 text-green-400" />
            <span className="text-sm font-medium text-zinc-200">Ostatnie dropy</span>
          </div>

          <div className="p-4">
            {drops.length === 0 ? (
              <p className="py-8 text-center text-sm text-slate-500">
                Brak dropów — graj mecze!
              </p>
            ) : (
              <div className="space-y-1">
                {drops.map((drop) => {
                  const rarity = drop.item.rarity;
                  return (
                    <div
                      key={drop.id}
                      className="flex items-center gap-3 rounded-lg px-3 py-2.5 hover:bg-white/[0.08] hover:border-white/10 transition-colors border border-transparent"
                    >
                      {/* Icon */}
                      <div
                        className={[
                          "flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-l-[2px] text-base",
                          "border-white/10 bg-white/[0.05]",
                          RARITY_BORDER[rarity] ?? "border-l-slate-400",
                        ].join(" ")}
                      >
                        {drop.item.icon || TYPE_LETTER[drop.item.item_type] || "?"}
                      </div>

                      {/* Name + qty */}
                      <div className="flex-1 min-w-0">
                        <span className="text-sm text-zinc-200 truncate">
                          {drop.item.name}
                        </span>
                        {drop.quantity > 1 && (
                          <span className="ml-1.5 font-mono text-xs text-slate-400">
                            x{drop.quantity}
                          </span>
                        )}
                      </div>

                      {/* Source badge */}
                      <span className="shrink-0 rounded-full border border-white/10 bg-white/[0.05] px-2 py-px text-[10px] text-slate-300">
                        {SOURCE_LABEL[drop.source] ?? drop.source}
                      </span>

                      {/* Time */}
                      <span className="shrink-0 text-[11px] text-slate-400 tabular-nums">
                        {timeAgo(drop.created_at)}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
