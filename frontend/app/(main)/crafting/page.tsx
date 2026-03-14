"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowRight,
  Check,
  Coins,
  Hammer,
  Package,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/useAuth";
import {
  craftItem,
  getMyInventory,
  getMyWallet,
  getRecipes,
  type InventoryItemOut,
  type RecipeOut,
  type WalletOut,
} from "@/lib/api";

const RARITY_COLORS: Record<string, string> = {
  common: "border-slate-500/30",
  uncommon: "border-green-500/30",
  rare: "border-blue-500/30",
  epic: "border-purple-500/30",
  legendary: "border-amber-500/30",
};

const RARITY_BG: Record<string, string> = {
  common: "bg-slate-500/10",
  uncommon: "bg-green-500/10",
  rare: "bg-blue-500/10",
  epic: "bg-purple-500/10",
  legendary: "bg-amber-500/10",
};

const RARITY_TEXT: Record<string, string> = {
  common: "text-slate-300",
  uncommon: "text-green-300",
  rare: "text-blue-300",
  epic: "text-purple-300",
  legendary: "text-amber-300",
};

const TYPE_FILTERS = [
  { value: "all", label: "Wszystko" },
  { value: "blueprint_building", label: "Blueprinty budynków" },
  { value: "blueprint_unit", label: "Blueprinty jednostek" },
  { value: "ability_scroll", label: "Scrolle" },
  { value: "boost", label: "Boosty" },
  { value: "cosmetic", label: "Kosmetyki" },
];

export default function CraftingPage() {
  const { user, loading: authLoading, token } = useAuth();
  const router = useRouter();
  const [recipes, setRecipes] = useState<RecipeOut[]>([]);
  const [inventory, setInventory] = useState<InventoryItemOut[]>([]);
  const [wallet, setWallet] = useState<WalletOut | null>(null);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("all");
  const [crafting, setCrafting] = useState<string | null>(null);

  useEffect(() => {
    if (!authLoading && !user) router.replace("/login");
  }, [user, authLoading, router]);

  const loadData = useCallback(async () => {
    if (!token) return;
    try {
      const [rec, invRes, wal] = await Promise.all([
        getRecipes(),
        getMyInventory(token),
        getMyWallet(token),
      ]);
      setRecipes(rec);
      setInventory(invRes.items);
      setWallet(wal);
    } catch {
      toast.error("Nie udało się załadować receptur");
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const getOwnedQty = (itemSlug: string) => {
    const entry = inventory.find((i) => i.item.slug === itemSlug);
    return entry?.quantity || 0;
  };

  const canCraft = (recipe: RecipeOut) => {
    if (wallet && wallet.gold < recipe.gold_cost) return false;
    return recipe.ingredients.every(
      (ing) => getOwnedQty(ing.item.slug) >= ing.quantity
    );
  };

  const handleCraft = async (recipe: RecipeOut) => {
    if (!token) return;
    setCrafting(recipe.slug);
    try {
      const result = await craftItem(token, recipe.slug);
      toast.success(result.message);
      loadData();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Błąd craftingu";
      toast.error(msg);
    } finally {
      setCrafting(null);
    }
  };

  const filteredRecipes =
    filter === "all"
      ? recipes
      : recipes.filter((r) => r.result_item.item_type === filter);

  if (authLoading || !user) return null;

  return (
    <div className="space-y-6">
      {/* ── Page header ─────────────────────────────────────────────────────── */}
      <div className="space-y-1">
        <p className="text-[11px] uppercase tracking-[0.24em] text-slate-400">Kuźnia</p>
        <h1 className="font-display text-3xl text-zinc-50">Warsztat rzemieślniczy</h1>
      </div>

      {/* Wallet bar */}
      {wallet && (
        <div className="flex items-center gap-2 rounded-2xl border border-white/10 bg-slate-950/55 px-6 py-3 backdrop-blur-xl">
          <Coins className="h-5 w-5 text-amber-300" />
          <span className="font-display text-xl text-amber-300">{wallet.gold}</span>
          <span className="text-sm text-slate-400">złota</span>
        </div>
      )}

      <div className="rounded-2xl border border-white/10 bg-slate-950/55 p-6 backdrop-blur-xl">
        <div className="mb-4 flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-white/10 bg-white/[0.04]">
            <Hammer className="h-5 w-5 text-cyan-300" />
          </div>
          <div>
            <h3 className="font-display text-xl text-zinc-50">Crafting</h3>
            <p className="text-sm text-slate-400">Łącz materiały w potężne przedmioty</p>
          </div>
        </div>

        {/* Filter */}
        <div className="mb-5 flex flex-wrap gap-1.5">
          {TYPE_FILTERS.map((t) => (
            <button
              key={t.value}
              onClick={() => setFilter(t.value)}
              className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                filter === t.value
                  ? "border border-cyan-300/25 bg-cyan-400/10 text-cyan-100"
                  : "border border-white/10 text-slate-400 hover:bg-white/[0.10] hover:border-white/20 hover:text-slate-100"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {loading ? (
          <p className="text-center text-slate-400">Ładowanie...</p>
        ) : filteredRecipes.length === 0 ? (
          <p className="text-center text-slate-400">Brak receptur</p>
        ) : (
          <div className="space-y-4">
            {filteredRecipes.map((recipe) => {
              const craftable = canCraft(recipe);
              return (
                <div
                  key={recipe.id}
                  className={`rounded-2xl border p-4 transition-colors ${RARITY_COLORS[recipe.result_item.rarity]} ${RARITY_BG[recipe.result_item.rarity]}`}
                >
                  {/* Result */}
                  <div className="mb-3 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className={`flex h-10 w-10 items-center justify-center rounded-xl border ${RARITY_COLORS[recipe.result_item.rarity]} bg-white/[0.04]`}>
                        <Package className={`h-5 w-5 ${RARITY_TEXT[recipe.result_item.rarity]}`} />
                      </div>
                      <div>
                        <h4 className={`font-display text-lg ${RARITY_TEXT[recipe.result_item.rarity]}`}>
                          {recipe.result_item.name}
                        </h4>
                        {recipe.result_item.description && (
                          <p className="text-xs text-slate-400 max-w-md">{recipe.result_item.description}</p>
                        )}
                      </div>
                    </div>
                    <Button
                      size="sm"
                      disabled={!craftable || crafting === recipe.slug}
                      onClick={() => handleCraft(recipe)}
                      className="rounded-full gap-1.5"
                    >
                      <Hammer className="h-4 w-4" />
                      {crafting === recipe.slug ? "Crafting..." : "Craftuj"}
                    </Button>
                  </div>

                  {/* Ingredients */}
                  <div className="flex flex-wrap items-center gap-2">
                    {recipe.ingredients.map((ing, idx) => {
                      const owned = getOwnedQty(ing.item.slug);
                      const enough = owned >= ing.quantity;
                      return (
                        <div key={ing.item.slug} className="flex items-center gap-1.5">
                          {idx > 0 && <span className="text-slate-500">+</span>}
                          <div
                            className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs ${
                              enough
                                ? "border-green-500/30 bg-green-500/10 text-green-200"
                                : "border-red-500/30 bg-red-500/10 text-red-200"
                            }`}
                          >
                            {enough ? (
                              <Check className="h-3 w-3 text-green-400" />
                            ) : (
                              <X className="h-3 w-3 text-red-400" />
                            )}
                            <span>{ing.item.name}</span>
                            <span className="font-bold">
                              {owned}/{ing.quantity}
                            </span>
                          </div>
                        </div>
                      );
                    })}

                    {recipe.gold_cost > 0 && (
                      <>
                        <span className="text-slate-500">+</span>
                        <div
                          className={`flex items-center gap-1 rounded-lg border px-2.5 py-1.5 text-xs ${
                            wallet && wallet.gold >= recipe.gold_cost
                              ? "border-amber-500/30 bg-amber-500/10 text-amber-200"
                              : "border-red-500/30 bg-red-500/10 text-red-200"
                          }`}
                        >
                          <Coins className="h-3 w-3" />
                          <span className="font-bold">{recipe.gold_cost}</span>
                        </div>
                      </>
                    )}

                    <ArrowRight className="mx-1 h-4 w-4 text-slate-400" />
                    <div className={`rounded-lg border px-2.5 py-1.5 text-xs font-bold ${RARITY_COLORS[recipe.result_item.rarity]} ${RARITY_TEXT[recipe.result_item.rarity]}`}>
                      {recipe.result_item.name}
                      {recipe.result_quantity > 1 && ` x${recipe.result_quantity}`}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
