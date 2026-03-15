"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Check,
  Coins,
  Hammer,
  Lock,
  Search,
  Sparkles,
} from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { useAuth } from "@/hooks/useAuth";
import {
  craftItem,
  getMyInventory,
  getMyWallet,
  getRecipes,
  type CraftResult,
  type InventoryItemOut,
  type RecipeOut,
  type WalletOut,
} from "@/lib/api";

// ─── Wear / Rarity constants ────────────────────────────────────────────────

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
const WEAR_FULL: Record<string, string> = {
  factory_new: "Factory New",
  minimal_wear: "Minimal Wear",
  field_tested: "Field-Tested",
  well_worn: "Well-Worn",
  battle_scarred: "Battle-Scarred",
};

const RARITY_BORDER: Record<string, string> = {
  common: "border-slate-500/30",
  uncommon: "border-green-500/30",
  rare: "border-blue-500/30",
  epic: "border-purple-500/30",
  legendary: "border-amber-500/30",
};
const RARITY_BG: Record<string, string> = {
  common: "bg-slate-500/[0.06]",
  uncommon: "bg-green-500/[0.06]",
  rare: "bg-blue-500/[0.06]",
  epic: "bg-purple-500/[0.06]",
  legendary: "bg-amber-500/[0.06]",
};
const RARITY_TEXT: Record<string, string> = {
  common: "text-slate-300",
  uncommon: "text-green-300",
  rare: "text-blue-300",
  epic: "text-purple-300",
  legendary: "text-amber-300",
};
const RARITY_GLOW: Record<string, string> = {
  common: "",
  uncommon: "",
  rare: "shadow-[0_0_12px_rgba(59,130,246,0.1)]",
  epic: "shadow-[0_0_16px_rgba(168,85,247,0.15)]",
  legendary: "shadow-[0_0_20px_rgba(251,191,36,0.18)]",
};
const RARITY_LABEL: Record<string, string> = {
  common: "Zwykły",
  uncommon: "Niezwykły",
  rare: "Rzadki",
  epic: "Epicki",
  legendary: "Legendarny",
};

const CATEGORIES = [
  { value: "all", label: "Wszystko", icon: "🔥" },
  { value: "material", label: "Materiały", icon: "⚙️" },
  { value: "blueprint_building", label: "Budynki", icon: "🏗️" },
  { value: "blueprint_unit", label: "Jednostki", icon: "🚀" },
  { value: "tactical_package", label: "Pakiety", icon: "🛡️" },
  { value: "boost", label: "Boosty", icon: "⚡" },
  { value: "cosmetic", label: "Kosmetyki", icon: "🎨" },
  { value: "key", label: "Klucze", icon: "🔑" },
];

// ─── Page ────────────────────────────────────────────────────────────────────

export default function CraftingPage() {
  const { user, loading: authLoading, token } = useAuth();
  const router = useRouter();
  const [recipes, setRecipes] = useState<RecipeOut[]>([]);
  const [inventory, setInventory] = useState<InventoryItemOut[]>([]);
  const [wallet, setWallet] = useState<WalletOut | null>(null);
  const [loading, setLoading] = useState(true);
  const [category, setCategory] = useState("all");
  const [search, setSearch] = useState("");
  const [crafting, setCrafting] = useState<string | null>(null);
  const [lastResult, setLastResult] = useState<CraftResult | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [showOnlyCraftable, setShowOnlyCraftable] = useState(false);

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

  // ─── Helpers ──────────────────────────────────────────────

  const ownedMap = useMemo(() => {
    const m: Record<string, number> = {};
    for (const e of inventory) {
      m[e.item.slug] = (m[e.item.slug] ?? 0) + e.quantity;
    }
    return m;
  }, [inventory]);

  const owned = (slug: string) => ownedMap[slug] ?? 0;

  const canCraft = useCallback(
    (r: RecipeOut) => {
      if (wallet && wallet.gold < r.gold_cost) return false;
      return r.ingredients.every((ing) => owned(ing.item.slug) >= ing.quantity);
    },
    [wallet, ownedMap]
  );

  const handleCraft = async (recipe: RecipeOut) => {
    if (!token) return;
    setCrafting(recipe.slug);
    setLastResult(null);
    try {
      const result = await craftItem(token, recipe.slug);
      toast.success(result.message);
      setLastResult(result);
      setSelected(recipe.slug);
      loadData();
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Błąd craftingu");
    } finally {
      setCrafting(null);
    }
  };

  // ─── Filtering ────────────────────────────────────────────

  const filtered = useMemo(() => {
    let list = recipes;
    if (category !== "all") list = list.filter((r) => r.result_item.item_type === category);
    if (search) {
      const q = search.toLowerCase();
      list = list.filter(
        (r) =>
          r.result_item.name.toLowerCase().includes(q) ||
          r.ingredients.some((i) => i.item.name.toLowerCase().includes(q))
      );
    }
    if (showOnlyCraftable) list = list.filter(canCraft);
    return list;
  }, [recipes, category, search, showOnlyCraftable, canCraft]);

  const selectedRecipe = selected ? recipes.find((r) => r.slug === selected) : null;

  // ─── Counts per category ──────────────────────────────────

  const categoryCounts = useMemo(() => {
    const counts: Record<string, number> = { all: recipes.length };
    for (const r of recipes) {
      const t = r.result_item.item_type;
      counts[t] = (counts[t] ?? 0) + 1;
    }
    return counts;
  }, [recipes]);

  if (authLoading || !user) return null;

  return (
    <div className="space-y-8">
      {/* ── Header ── */}
      <div className="space-y-2">
        <p className="text-xs uppercase tracking-[0.24em] text-muted-foreground">Warsztat</p>
        <h1 className="font-display text-4xl sm:text-5xl text-foreground">Kuźnia</h1>
      </div>

      {/* ── Wallet bar ── */}
      {wallet && (
        <Card className="flex-row items-center gap-3 rounded-2xl px-6 py-4 backdrop-blur-xl">
          <Coins className="h-6 w-6 text-accent" />
          <span className="font-display text-2xl text-accent">{wallet.gold}</span>
          <span className="text-base text-muted-foreground">złota</span>
        </Card>
      )}

      {/* ── Last craft result ── */}
      {lastResult?.instance && (
        <Card className="rounded-2xl border-amber-500/25 p-4 backdrop-blur-xl">
          <CardContent className="px-0">
            <div className="flex flex-wrap items-center gap-3">
              <Sparkles className="h-5 w-5 text-amber-400" />
              <span className="font-display text-xl text-amber-200">{lastResult.item_name}</span>
              <Badge
                className={`border px-2 py-0.5 text-xs font-bold ${WEAR_COLORS[lastResult.instance.wear_condition] ?? "text-muted-foreground bg-muted border-border"}`}
              >
                {WEAR_FULL[lastResult.instance.wear_condition] ?? lastResult.instance.wear_condition}
              </Badge>
              <span className="font-mono text-sm text-muted-foreground tabular-nums">
                {lastResult.instance.wear.toFixed(6)}
              </span>
              {lastResult.instance.stattrak && (
                <Badge className="border border-orange-500/40 bg-orange-500/15 px-2 py-0.5 text-xs font-bold text-orange-300">
                  StatTrak™
                </Badge>
              )}
              {lastResult.instance.is_rare_pattern && (
                <span className="text-base text-accent">⭐ Rzadki wzór #{lastResult.instance.pattern_seed}</span>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* ── Main layout: sidebar categories + recipe list + detail panel ── */}
      <Card
        className="flex-row gap-4 rounded-2xl p-5 backdrop-blur-xl"
        style={{ maxHeight: "calc(100vh - 12rem)" }}
      >
        {/* ── Left: categories ── */}
        <div className="hidden w-52 shrink-0 space-y-1 overflow-y-auto lg:block">
          {CATEGORIES.map((c) => {
            const count = categoryCounts[c.value] ?? 0;
            const active = category === c.value;
            return (
              <button
                key={c.value}
                onClick={() => { setCategory(c.value); setSelected(null); }}
                className={`flex w-full items-center gap-2.5 rounded-xl px-3 py-3 text-left transition-all ${
                  active
                    ? "bg-secondary text-foreground font-semibold border border-border"
                    : "text-foreground/70 hover:bg-muted hover:text-foreground border border-transparent"
                }`}
              >
                <span className="text-xl">{c.icon}</span>
                <span className="flex-1 truncate text-base">{c.label}</span>
                <span className={`text-sm font-bold tabular-nums ${active ? "text-primary" : "text-muted-foreground"}`}>
                  {count}
                </span>
              </button>
            );
          })}
        </div>

        {/* ── Center: recipe list ── */}
        <div className="min-w-0 flex-1 space-y-4 overflow-y-auto">
          {/* Mobile categories */}
          <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-none lg:hidden">
            {CATEGORIES.map((c) => (
              <button
                key={c.value}
                onClick={() => { setCategory(c.value); setSelected(null); }}
                className={`flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm font-medium transition-colors ${
                  category === c.value
                    ? "border-primary/25 bg-primary/10 text-primary"
                    : "border-border text-muted-foreground hover:border-border/60"
                }`}
              >
                <span>{c.icon}</span>
                {c.label}
              </button>
            ))}
          </div>

          {/* Search + filter bar */}
          <div className="flex gap-2">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Szukaj receptury lub składnika..."
                className="pl-9 rounded-xl h-11"
              />
            </div>
            <Button
              variant={showOnlyCraftable ? "secondary" : "outline"}
              onClick={() => setShowOnlyCraftable((v) => !v)}
              className={`shrink-0 rounded-xl gap-1.5 px-4 h-11 text-base font-medium ${
                showOnlyCraftable
                  ? "border-green-500/30 bg-green-500/10 text-green-300 hover:bg-green-500/15"
                  : ""
              }`}
            >
              <Check className="h-4 w-4" />
              Dostępne
            </Button>
          </div>

          {/* Recipe grid */}
          {loading ? (
            <div className="space-y-3">
              {[1, 2, 3, 4].map((i) => (
                <div key={i} className="h-20 animate-pulse rounded-xl border border-border bg-muted/20" />
              ))}
            </div>
          ) : filtered.length === 0 ? (
            <div className="py-12 text-center">
              <Hammer className="mx-auto mb-3 h-8 w-8 text-muted-foreground/40" />
              <p className="text-base text-muted-foreground">
                Brak receptur{showOnlyCraftable ? " do wycraftowania" : ""}
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              {filtered.map((recipe) => {
                const craftable = canCraft(recipe);
                const active = selected === recipe.slug;
                const rarity = recipe.result_item.rarity;
                return (
                  <button
                    key={recipe.slug}
                    onClick={() => setSelected(active ? null : recipe.slug)}
                    className={`group w-full rounded-xl border-b border-border/30 p-3 text-left transition-colors last:border-b-0 ${
                      active ? "bg-secondary/50" : "hover:bg-muted/30"
                    } ${!craftable ? "opacity-40" : ""}`}
                  >
                    <div className="flex items-center gap-3">
                      {/* Icon */}
                      <div className={`flex h-14 w-14 shrink-0 items-center justify-center rounded-xl border ${RARITY_BORDER[rarity]} bg-secondary text-2xl`}>
                        {recipe.result_item.icon || "📦"}
                      </div>

                      {/* Name + ingredients preview */}
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="text-lg font-semibold text-foreground">
                            {recipe.result_item.name}
                          </span>
                          <Badge
                            className={`border px-1.5 py-0.5 text-xs font-bold uppercase ${RARITY_BORDER[rarity]} ${RARITY_BG[rarity]} ${RARITY_TEXT[rarity]}`}
                          >
                            {RARITY_LABEL[rarity]}
                          </Badge>
                          {recipe.result_item.level > 1 && (
                            <span className="text-sm font-medium text-muted-foreground">
                              Lvl {recipe.result_item.level}
                            </span>
                          )}
                        </div>
                        <div className="mt-1.5 flex items-center gap-3 text-base">
                          {recipe.ingredients.slice(0, 4).map((ing) => (
                            <span key={ing.item.slug} className="flex items-center gap-1">
                              <span className="text-base">{ing.item.icon || "?"}</span>
                              <span
                                className={`font-medium ${
                                  owned(ing.item.slug) >= ing.quantity
                                    ? "text-foreground/80"
                                    : "text-red-400"
                                }`}
                              >
                                {ing.quantity}
                              </span>
                            </span>
                          ))}
                          {recipe.ingredients.length > 4 && (
                            <span className="text-muted-foreground">
                              +{recipe.ingredients.length - 4}
                            </span>
                          )}
                          {recipe.gold_cost > 0 && (
                            <span className="flex items-center gap-1 font-medium text-accent">
                              <Coins className="h-3.5 w-3.5" />
                              {recipe.gold_cost}
                            </span>
                          )}
                        </div>
                      </div>

                      {/* Status */}
                      <div className="shrink-0">
                        {craftable ? (
                          <div className="flex h-9 w-9 items-center justify-center rounded-full bg-green-500/15 text-green-400">
                            <Check className="h-4 w-4" />
                          </div>
                        ) : (
                          <div className="flex h-9 w-9 items-center justify-center rounded-full bg-muted text-muted-foreground/40">
                            <Lock className="h-4 w-4" />
                          </div>
                        )}
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* ── Right: detail panel ── */}
        <div className="hidden w-80 shrink-0 overflow-y-auto xl:block">
          {selectedRecipe ? (
            <RecipeDetail
              recipe={selectedRecipe}
              owned={owned}
              wallet={wallet}
              craftable={canCraft(selectedRecipe)}
              isCrafting={crafting === selectedRecipe.slug}
              onCraft={() => handleCraft(selectedRecipe)}
              lastResult={selected === lastResult?.item_slug ? lastResult : null}
            />
          ) : (
            <div className="flex h-64 items-center justify-center rounded-2xl border border-dashed border-border text-base text-muted-foreground">
              Wybierz recepturę
            </div>
          )}
        </div>
      </Card>

      {/* ── Mobile detail: expands below selected recipe ── */}
      {selectedRecipe && (
        <div className="xl:hidden">
          <RecipeDetail
            recipe={selectedRecipe}
            owned={owned}
            wallet={wallet}
            craftable={canCraft(selectedRecipe)}
            isCrafting={crafting === selectedRecipe.slug}
            onCraft={() => handleCraft(selectedRecipe)}
            lastResult={selected === lastResult?.item_slug ? lastResult : null}
          />
        </div>
      )}
    </div>
  );
}

// ─── Recipe Detail Panel ─────────────────────────────────────────────────────

function RecipeDetail({
  recipe,
  owned,
  wallet,
  craftable,
  isCrafting,
  onCraft,
  lastResult,
}: {
  recipe: RecipeOut;
  owned: (slug: string) => number;
  wallet: WalletOut | null;
  craftable: boolean;
  isCrafting: boolean;
  onCraft: () => void;
  lastResult: CraftResult | null;
}) {
  const rarity = recipe.result_item.rarity;
  const isUnique = !recipe.result_item.is_stackable;

  return (
    <Card
      className={`rounded-2xl border space-y-0 ${RARITY_BORDER[rarity]} bg-card ${RARITY_GLOW[rarity]}`}
    >
      <CardHeader className="pb-0">
        {/* Result item */}
        <div className="flex items-start gap-3">
          <div
            className={`flex h-16 w-16 shrink-0 items-center justify-center rounded-xl border text-3xl ${RARITY_BORDER[rarity]} bg-secondary`}
          >
            {recipe.result_item.icon || "📦"}
          </div>
          <div>
            <CardTitle className={`font-display text-2xl ${RARITY_TEXT[rarity]}`}>
              {recipe.result_item.name}
            </CardTitle>
            <div className="mt-0.5 flex items-center gap-2">
              <Badge
                className={`border px-1.5 py-0.5 text-xs font-bold uppercase tracking-wider ${RARITY_BORDER[rarity]} ${RARITY_BG[rarity]} ${RARITY_TEXT[rarity]}`}
              >
                {RARITY_LABEL[rarity]}
              </Badge>
              {recipe.result_item.level > 1 && (
                <span className="text-sm text-muted-foreground">Lvl {recipe.result_item.level}</span>
              )}
            </div>
            {recipe.result_item.description && (
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                {recipe.result_item.description}
              </p>
            )}
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* Wear preview for unique items */}
        {isUnique && (
          <>
            <Separator />
            <div className="rounded-lg border border-border bg-muted/20 p-3">
              <p className="mb-2 text-xs uppercase tracking-[0.16em] text-muted-foreground">
                Losowy wear
              </p>
              <div className="flex gap-1">
                {Object.entries(WEAR_LABELS).map(([key, label]) => (
                  <span
                    key={key}
                    className={`flex-1 rounded border py-1 text-center text-xs font-bold ${WEAR_COLORS[key]}`}
                  >
                    {label}
                  </span>
                ))}
              </div>
            </div>
          </>
        )}

        <Separator />

        {/* Ingredients */}
        <div>
          <p className="mb-3 text-xs uppercase tracking-[0.16em] text-muted-foreground">
            Składniki
          </p>
          <div className="space-y-2">
            {recipe.ingredients.map((ing) => {
              const have = owned(ing.item.slug);
              const enough = have >= ing.quantity;
              return (
                <div
                  key={ing.item.slug}
                  className={`flex items-center gap-2.5 rounded-xl border px-3 py-2.5 ${
                    enough
                      ? "border-green-500/20 bg-green-500/[0.05]"
                      : "border-red-500/20 bg-red-500/[0.05]"
                  }`}
                >
                  <span className="text-xl">{ing.item.icon || "?"}</span>
                  <span className="flex-1 text-base text-foreground/80">{ing.item.name}</span>
                  <span
                    className={`font-mono text-base font-bold tabular-nums ${
                      enough ? "text-green-400" : "text-red-400"
                    }`}
                  >
                    {have}
                    <span className="text-muted-foreground/50">/{ing.quantity}</span>
                  </span>
                </div>
              );
            })}
            {recipe.gold_cost > 0 && (
              <div
                className={`flex items-center gap-2.5 rounded-lg border px-3 py-2.5 ${
                  wallet && wallet.gold >= recipe.gold_cost
                    ? "border-amber-500/20 bg-amber-500/[0.04]"
                    : "border-red-500/20 bg-red-500/[0.04]"
                }`}
              >
                <Coins className="h-5 w-5 text-amber-400" />
                <span className="flex-1 text-base text-foreground/80">Złoto</span>
                <span
                  className={`font-mono text-base font-bold tabular-nums ${
                    wallet && wallet.gold >= recipe.gold_cost ? "text-amber-400" : "text-red-400"
                  }`}
                >
                  {wallet?.gold ?? 0}
                  <span className="text-muted-foreground/50">/{recipe.gold_cost}</span>
                </span>
              </div>
            )}
          </div>
        </div>

        <Separator />

        {/* Craft button */}
        <Button
          className={`w-full gap-2 rounded-xl h-12 text-lg font-bold transition-all ${
            craftable
              ? "bg-primary/20 text-primary hover:bg-primary/30 border border-primary/20"
              : "bg-muted text-muted-foreground border border-border"
          }`}
          disabled={!craftable || isCrafting}
          onClick={onCraft}
        >
          {isCrafting ? (
            <>
              <div className="h-5 w-5 animate-spin rounded-full border-2 border-current border-t-transparent" />
              Tworzenie...
            </>
          ) : craftable ? (
            <>
              <Hammer className="h-5 w-5" />
              Craftuj
            </>
          ) : (
            <>
              <Lock className="h-5 w-5" />
              Brak składników
            </>
          )}
        </Button>

        {/* Last craft result */}
        {lastResult?.instance && (
          <div className="rounded-xl border border-amber-500/25 bg-amber-500/[0.06] p-4 space-y-2">
            <div className="flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-amber-400" />
              <span className="text-base font-semibold text-amber-200">Stworzono!</span>
            </div>
            <div className="flex flex-wrap gap-1.5">
              <Badge
                className={`border px-2 py-0.5 text-xs font-bold ${WEAR_COLORS[lastResult.instance.wear_condition] ?? ""}`}
              >
                {WEAR_FULL[lastResult.instance.wear_condition] ?? lastResult.instance.wear_condition}
              </Badge>
              <Badge className="border border-border bg-muted px-2 py-0.5 font-mono text-xs text-muted-foreground tabular-nums">
                {lastResult.instance.wear.toFixed(6)}
              </Badge>
              {lastResult.instance.stattrak && (
                <Badge className="border border-orange-500/40 bg-orange-500/15 px-2 py-0.5 text-xs font-bold text-orange-300">
                  StatTrak™
                </Badge>
              )}
            </div>
            {lastResult.instance.is_rare_pattern && (
              <p className="text-sm text-accent">⭐ Rzadki wzór #{lastResult.instance.pattern_seed}</p>
            )}
            <p className="text-xs text-muted-foreground">
              Wzór: #{lastResult.instance.pattern_seed}
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
