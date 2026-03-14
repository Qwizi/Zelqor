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

const RARITY_COLORS: Record<string, string> = {
  common: "border-slate-500/30 text-slate-300",
  uncommon: "border-green-500/30 text-green-300",
  rare: "border-blue-500/30 text-blue-300",
  epic: "border-purple-500/30 text-purple-300",
  legendary: "border-amber-500/30 text-amber-300",
};

const RARITY_BG: Record<string, string> = {
  common: "bg-slate-500/10",
  uncommon: "bg-green-500/10",
  rare: "bg-blue-500/10",
  epic: "bg-purple-500/10",
  legendary: "bg-amber-500/10",
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

type Tab = "inventory" | "drops";

export default function InventoryPage() {
  const { user, loading: authLoading, token } = useAuth();
  const router = useRouter();
  const [inventory, setInventory] = useState<InventoryItemOut[]>([]);
  const [wallet, setWallet] = useState<WalletOut | null>(null);
  const [drops, setDrops] = useState<ItemDropOut[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<Tab>("inventory");
  const [filter, setFilter] = useState<string>("all");

  useEffect(() => {
    if (!authLoading && !user) router.replace("/login");
  }, [user, authLoading, router]);

  const loadData = useCallback(async () => {
    if (!token) return;
    try {
      const [inv, wal, dr] = await Promise.all([
        getMyInventory(token),
        getMyWallet(token),
        getMyDrops(token),
      ]);
      setInventory(inv);
      setWallet(wal);
      setDrops(dr);
    } catch {
      toast.error("Nie udało się załadować ekwipunku");
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const crates = inventory.filter((i) => i.item.item_type === "crate");
  const keys = inventory.filter((i) => i.item.item_type === "key");

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
        `Otwarto skrzynkę! Otrzymano: ${result.drops.map((d) => `${d.item_name} x${d.quantity}`).join(", ")}`
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

  const itemTypes = [
    { value: "all", label: "Wszystko" },
    { value: "material", label: "Materiały" },
    { value: "blueprint_building", label: "Blueprinty budynków" },
    { value: "blueprint_unit", label: "Blueprinty jednostek" },
    { value: "ability_scroll", label: "Scrolle" },
    { value: "boost", label: "Boosty" },
    { value: "crate", label: "Skrzynki" },
    { value: "key", label: "Klucze" },
    { value: "cosmetic", label: "Kosmetyki" },
  ];

  if (authLoading || !user) return null;

  return (
    <div className="space-y-6">
      {/* Wallet */}
      <div className="rounded-[24px] border border-white/10 bg-slate-950/55 p-6 backdrop-blur-xl">
        <div className="mb-4 flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-white/10 bg-white/[0.04]">
            <Coins className="h-5 w-5 text-amber-300" />
          </div>
          <div>
            <h3 className="font-display text-xl text-zinc-50">Portfel</h3>
            <p className="text-sm text-slate-400">Twoje złoto i statystyki</p>
          </div>
        </div>
        {wallet && (
          <div className="grid grid-cols-3 gap-4">
            <div className="rounded-2xl border border-amber-500/20 bg-amber-500/5 p-4 text-center">
              <p className="font-display text-3xl text-amber-300">{wallet.gold}</p>
              <p className="text-xs text-slate-400">Złoto</p>
            </div>
            <div className="rounded-2xl border border-green-500/20 bg-green-500/5 p-4 text-center">
              <div className="flex items-center justify-center gap-1">
                <TrendingUp className="h-4 w-4 text-green-400" />
                <p className="font-display text-xl text-green-300">{wallet.total_earned}</p>
              </div>
              <p className="text-xs text-slate-400">Zarobione</p>
            </div>
            <div className="rounded-2xl border border-red-500/20 bg-red-500/5 p-4 text-center">
              <div className="flex items-center justify-center gap-1">
                <TrendingDown className="h-4 w-4 text-red-400" />
                <p className="font-display text-xl text-red-300">{wallet.total_spent}</p>
              </div>
              <p className="text-xs text-slate-400">Wydane</p>
            </div>
          </div>
        )}
      </div>

      {/* Tabs */}
      <div className="flex gap-2">
        <Button
          variant={tab === "inventory" ? "default" : "ghost"}
          onClick={() => setTab("inventory")}
          className="rounded-full"
        >
          <Backpack className="mr-1.5 h-4 w-4" />
          Ekwipunek ({inventory.length})
        </Button>
        <Button
          variant={tab === "drops" ? "default" : "ghost"}
          onClick={() => setTab("drops")}
          className="rounded-full"
        >
          <Gift className="mr-1.5 h-4 w-4" />
          Ostatnie dropy
        </Button>
      </div>

      {tab === "inventory" && (
        <div className="rounded-[24px] border border-white/10 bg-slate-950/55 p-6 backdrop-blur-xl">
          <div className="mb-4 flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-white/10 bg-white/[0.04]">
              <Backpack className="h-5 w-5 text-cyan-300" />
            </div>
            <h3 className="font-display text-xl text-zinc-50">Ekwipunek</h3>
          </div>

          {/* Filter */}
          <div className="mb-4 flex flex-wrap gap-1.5">
            {itemTypes.map((t) => (
              <button
                key={t.value}
                onClick={() => setFilter(t.value)}
                className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                  filter === t.value
                    ? "border border-cyan-300/25 bg-cyan-400/10 text-cyan-100"
                    : "border border-white/10 text-slate-400 hover:bg-white/[0.06]"
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>

          {loading ? (
            <p className="text-center text-slate-400">Ładowanie...</p>
          ) : filteredInventory.length === 0 ? (
            <p className="text-center text-slate-400">Brak przedmiotów</p>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {filteredInventory.map((entry) => (
                <div
                  key={entry.id}
                  className={`rounded-2xl border p-4 transition-colors hover:bg-white/[0.05] ${RARITY_COLORS[entry.item.rarity]} ${RARITY_BG[entry.item.rarity]}`}
                >
                  <div className="mb-2 flex items-start justify-between">
                    <div>
                      <h4 className="font-medium text-zinc-100">{entry.item.name}</h4>
                      <p className="text-xs text-slate-400">
                        {TYPE_LABELS[entry.item.item_type] || entry.item.item_type}
                      </p>
                    </div>
                    <span className="rounded-full bg-white/10 px-2 py-0.5 text-xs font-bold">
                      x{entry.quantity}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-xs">
                      {RARITY_LABELS[entry.item.rarity]}
                    </span>
                    {entry.item.item_type === "crate" && (
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 gap-1 rounded-full text-xs"
                        onClick={() => handleOpenCrate(entry.item.slug)}
                      >
                        {keys.some((k) =>
                          k.item.slug.replace("key-", "") === entry.item.slug.replace("crate-", "")
                        ) ? (
                          <>
                            <KeyRound className="h-3 w-3" />
                            Otwórz
                          </>
                        ) : (
                          <>
                            <Lock className="h-3 w-3" />
                            Brak klucza
                          </>
                        )}
                      </Button>
                    )}
                    {entry.item.base_value > 0 && entry.item.item_type !== "crate" && (
                      <span className="flex items-center gap-1 text-xs text-amber-300/60">
                        <Coins className="h-3 w-3" />
                        {entry.item.base_value}
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {tab === "drops" && (
        <div className="rounded-[24px] border border-white/10 bg-slate-950/55 p-6 backdrop-blur-xl">
          <div className="mb-4 flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-white/10 bg-white/[0.04]">
              <Package className="h-5 w-5 text-green-300" />
            </div>
            <h3 className="font-display text-xl text-zinc-50">Ostatnie dropy</h3>
          </div>

          {drops.length === 0 ? (
            <p className="text-center text-slate-400">Brak dropów — graj mecze!</p>
          ) : (
            <div className="space-y-2">
              {drops.map((drop) => (
                <div
                  key={drop.id}
                  className={`flex items-center justify-between rounded-xl border p-3 ${RARITY_COLORS[drop.item.rarity]} ${RARITY_BG[drop.item.rarity]}`}
                >
                  <div>
                    <span className="font-medium text-zinc-100">{drop.item.name}</span>
                    <span className="ml-2 text-xs text-slate-400">x{drop.quantity}</span>
                  </div>
                  <div className="flex items-center gap-2 text-xs text-slate-400">
                    <span>{drop.source === "match_reward" ? "Mecz" : drop.source === "crate_open" ? "Skrzynka" : "Crafting"}</span>
                    <span>{new Date(drop.created_at).toLocaleDateString("pl-PL")}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
