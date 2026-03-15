"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Check,
  Coins,
  Hammer,
  Lock,
  Search,
  Sparkles,
} from "lucide-react";
import { gsap } from "gsap";
import { useGSAP } from "@gsap/react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent } from "@/components/ui/dialog";
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

function RecipeRow({ recipe, craftable, active, rarity, owned, onSelect }: {
  recipe: RecipeOut;
  craftable: boolean;
  active: boolean;
  rarity: string;
  owned: (slug: string) => number;
  onSelect: () => void;
}) {
  return (
    <button
      data-animate="recipe"
      onClick={onSelect}
      className={`group w-full rounded-xl border p-3 md:p-4 text-left transition-colors active:scale-[0.98] ${
        active ? "bg-secondary/50 border-primary/30" : "border-border/30 hover:bg-muted/30"
      } ${!craftable ? "opacity-50" : ""}`}
    >
      <div className="flex items-center gap-3 md:gap-4">
        <div className={`flex h-10 w-10 md:h-14 md:w-14 shrink-0 items-center justify-center rounded-xl border ${RARITY_BORDER[rarity]} bg-secondary text-2xl md:text-3xl`}>
          {recipe.result_item.icon || "📦"}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 md:gap-2">
            <span className="text-sm md:text-lg font-semibold text-foreground truncate">{recipe.result_item.name}</span>
            <Badge className={`shrink-0 border px-1 md:px-1.5 py-0.5 text-[10px] md:text-xs font-bold uppercase ${RARITY_BORDER[rarity]} ${RARITY_BG[rarity]} ${RARITY_TEXT[rarity]}`}>
              {RARITY_LABEL[rarity]}
            </Badge>
            {recipe.result_item.level > 1 && (
              <span className="hidden md:inline text-sm font-medium text-muted-foreground">Lvl {recipe.result_item.level}</span>
            )}
          </div>
          <div className="mt-1 md:mt-2 flex items-center gap-2 md:gap-3">
            {recipe.ingredients.slice(0, 3).map((ing) => (
              <span key={ing.item.slug} className="flex items-center gap-0.5 md:gap-1">
                <span className="text-sm md:text-lg">{ing.item.icon || "?"}</span>
                <span className={`text-xs md:text-base font-semibold tabular-nums ${owned(ing.item.slug) >= ing.quantity ? "text-foreground" : "text-red-400"}`}>
                  {owned(ing.item.slug)}/{ing.quantity}
                </span>
              </span>
            ))}
            {recipe.ingredients.length > 3 && (
              <span className="text-xs md:text-base text-muted-foreground">+{recipe.ingredients.length - 3}</span>
            )}
            {recipe.gold_cost > 0 && (
              <span className="flex items-center gap-0.5 text-xs md:text-base font-semibold text-accent">
                <Coins className="h-3 w-3 md:h-4 md:w-4" />{recipe.gold_cost}
              </span>
            )}
          </div>
        </div>
        <div className="shrink-0">
          {craftable ? (
            <div className="flex h-8 w-8 md:h-11 md:w-11 items-center justify-center rounded-full bg-green-500/15 text-green-400">
              <Check className="h-4 w-4 md:h-5 md:w-5" />
            </div>
          ) : (
            <div className="flex h-8 w-8 md:h-11 md:w-11 items-center justify-center rounded-full bg-muted text-muted-foreground/40">
              <Lock className="h-4 w-4 md:h-5 md:w-5" />
            </div>
          )}
        </div>
      </div>
    </button>
  );
}

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
  const pageRef = useRef<HTMLDivElement>(null);

  useGSAP(() => {
    if (!pageRef.current || loading) return;
    gsap.fromTo("[data-animate='recipe']", { y: 12, opacity: 0 }, { y: 0, opacity: 1, duration: 0.3, stagger: 0.04, ease: "power2.out" });
  }, { scope: pageRef, dependencies: [loading, category, showOnlyCraftable] });

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

  // Crafting modal state
  const [craftingModal, setCraftingModal] = useState<{
    phase: "forging" | "result";
    recipe: RecipeOut;
    result?: CraftResult;
  } | null>(null);
  const modalIconRef = useRef<HTMLDivElement>(null);
  const modalSparkRef = useRef<HTMLDivElement>(null);

  const handleCraft = async (recipe: RecipeOut) => {
    if (!token) return;
    setCrafting(recipe.slug);
    setCraftingModal({ phase: "forging", recipe });

    try {
      // Wait minimum 1.5s for animation even if API is faster
      const [result] = await Promise.all([
        craftItem(token, recipe.slug),
        new Promise((r) => setTimeout(r, 1500)),
      ]);
      setCraftingModal({ phase: "result", recipe, result });
      setLastResult(result);
      setSelected(recipe.slug);
      loadData();
      // Auto-close after 3s
      setTimeout(() => setCraftingModal(null), 3000);
    } catch (e: unknown) {
      setCraftingModal(null);
      toast.error(e instanceof Error ? e.message : "Błąd craftingu");
    } finally {
      setCrafting(null);
    }
  };

  // Animate modal phases
  useEffect(() => {
    if (!craftingModal) return;
    if (craftingModal.phase === "forging" && modalIconRef.current) {
      gsap.to(modalIconRef.current, {
        rotation: 360,
        duration: 1.5,
        ease: "power2.inOut",
        repeat: -1,
      });
      if (modalSparkRef.current) {
        gsap.to(modalSparkRef.current, {
          scale: 1.3,
          opacity: 0.5,
          duration: 0.6,
          ease: "power1.inOut",
          repeat: -1,
          yoyo: true,
        });
      }
    }
    if (craftingModal.phase === "result" && modalIconRef.current) {
      gsap.killTweensOf(modalIconRef.current);
      gsap.to(modalIconRef.current, { rotation: 0, scale: 1.2, duration: 0.3, ease: "back.out(2)" });
      gsap.to(modalIconRef.current, { scale: 1, duration: 0.3, delay: 0.3 });
      if (modalSparkRef.current) {
        gsap.killTweensOf(modalSparkRef.current);
        gsap.to(modalSparkRef.current, { scale: 2, opacity: 0, duration: 0.5 });
      }
    }
  }, [craftingModal?.phase]);

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
    <div ref={pageRef} className="space-y-3 md:space-y-8 -mx-4 md:mx-0 -mt-2 md:mt-0">
      {/* ── Header ── */}
      <div className="px-4 md:px-0">
        <p className="hidden md:block text-xs uppercase tracking-[0.24em] text-muted-foreground">Warsztat</p>
        <h1 className="font-display text-2xl md:text-5xl text-foreground">Kuźnia</h1>
      </div>

      {/* ── Wallet bar ── */}
      {wallet && (
        <div className="px-4 md:px-0">
          {/* Mobile: inline */}
          <div className="flex items-center gap-2.5 md:hidden">
            <Coins className="h-5 w-5 text-accent" />
            <span className="font-display text-xl tabular-nums text-accent">{wallet.gold}</span>
            <span className="text-xs text-muted-foreground">złota</span>
          </div>
          {/* Desktop: card */}
          <Card className="hidden md:flex flex-row items-center gap-3 rounded-2xl px-6 py-4 backdrop-blur-xl">
            <Coins className="h-6 w-6 text-accent" />
            <span className="font-display text-2xl text-accent">{wallet.gold}</span>
            <span className="text-base text-muted-foreground">złota</span>
          </Card>
        </div>
      )}

      {/* ── Last craft result ── */}
      {lastResult?.instance && (
        <div className="px-4 md:px-0">
          <div className="flex flex-wrap items-center gap-2 md:gap-3 rounded-2xl border border-amber-500/25 bg-amber-500/[0.04] p-3 md:p-4">
            <Sparkles className="h-4 w-4 md:h-5 md:w-5 text-amber-400" />
            <span className="font-display text-base md:text-xl text-amber-200">{lastResult.item_name}</span>
            <Badge
              className={`border px-1.5 md:px-2 py-0.5 text-[10px] md:text-xs font-bold ${WEAR_COLORS[lastResult.instance.wear_condition] ?? "text-muted-foreground bg-muted border-border"}`}
            >
              {WEAR_FULL[lastResult.instance.wear_condition] ?? lastResult.instance.wear_condition}
            </Badge>
            <span className="hidden md:inline font-mono text-sm text-muted-foreground tabular-nums">
              {lastResult.instance.wear.toFixed(6)}
            </span>
            {lastResult.instance.stattrak && (
              <Badge className="border border-orange-500/40 bg-orange-500/15 px-1.5 py-0.5 text-[10px] md:text-xs font-bold text-orange-300">
                ST
              </Badge>
            )}
            {lastResult.instance.is_rare_pattern && (
              <span className="text-xs md:text-base text-accent">⭐</span>
            )}
          </div>
        </div>
      )}

      {/* ── Main layout: sidebar categories + recipe list + detail panel ── */}
      <div
        className="md:flex md:flex-row md:gap-4 md:rounded-2xl md:border md:border-border md:bg-card md:p-5 md:backdrop-blur-xl px-4 md:px-5"
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
        <div className="min-w-0 flex-1 space-y-3 md:space-y-4 overflow-y-auto">
          {/* Mobile categories */}
          <div className="flex gap-1.5 md:gap-2 overflow-x-auto pb-0.5 scrollbar-none [-ms-overflow-style:none] [scrollbar-width:none] lg:hidden">
            {CATEGORIES.map((c) => (
              <button
                key={c.value}
                onClick={() => { setCategory(c.value); setSelected(null); }}
                className={`flex shrink-0 items-center gap-1 md:gap-1.5 rounded-full border px-2.5 md:px-3 py-1.5 text-xs md:text-sm font-medium transition-colors ${
                  category === c.value
                    ? "border-primary/25 bg-primary/10 text-primary"
                    : "border-border text-muted-foreground hover:border-border/60"
                }`}
              >
                <span className="text-xs md:text-base">{c.icon}</span>
                <span className="hidden md:inline">{c.label}</span>
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
                placeholder="Szukaj..."
                className="pl-9 rounded-full md:rounded-xl h-10 md:h-11 text-sm md:text-base"
              />
            </div>
            <button
              onClick={() => setShowOnlyCraftable((v) => !v)}
              className={`flex shrink-0 items-center gap-1 md:gap-1.5 rounded-full md:rounded-xl border px-3 md:px-4 h-10 md:h-11 text-xs md:text-base font-medium transition-colors ${
                showOnlyCraftable
                  ? "border-green-500/30 bg-green-500/10 text-green-300"
                  : "border-border text-muted-foreground"
              }`}
            >
              <Check className="h-3.5 w-3.5 md:h-4 md:w-4" />
              <span className="hidden md:inline">Dostępne</span>
              <span className="md:hidden">Mam</span>
            </button>
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
            <div className="space-y-1.5 md:space-y-2">
              {/* Available recipes */}
              {filtered.filter((r) => canCraft(r)).length > 0 && (
                <div className="flex items-center gap-1.5 md:gap-2 px-1 pt-1 pb-1.5 md:pb-2">
                  <Check className="h-3.5 w-3.5 md:h-4 md:w-4 text-green-400" />
                  <span className="text-[11px] md:text-sm font-semibold uppercase tracking-[0.15em] md:tracking-[0.2em] text-green-400">
                    Dostępne ({filtered.filter((r) => canCraft(r)).length})
                  </span>
                  <div className="h-px flex-1 bg-green-500/20" />
                </div>
              )}
              {filtered.filter((r) => canCraft(r)).map((recipe) => {
                const active = selected === recipe.slug;
                const rarity = recipe.result_item.rarity;
                return (
                  <RecipeRow key={recipe.slug} recipe={recipe} craftable active={active} rarity={rarity} owned={owned} onSelect={() => setSelected(active ? null : recipe.slug)} />
                );
              })}

              {/* Unavailable recipes */}
              {!showOnlyCraftable && filtered.filter((r) => !canCraft(r)).length > 0 && (
                <div className="flex items-center gap-1.5 md:gap-2 px-1 pt-3 md:pt-4 pb-1.5 md:pb-2">
                  <Lock className="h-3.5 w-3.5 md:h-4 md:w-4 text-muted-foreground/50" />
                  <span className="text-[11px] md:text-sm font-semibold uppercase tracking-[0.15em] md:tracking-[0.2em] text-muted-foreground/50">
                    Brak składników ({filtered.filter((r) => !canCraft(r)).length})
                  </span>
                  <div className="h-px flex-1 bg-border/30" />
                </div>
              )}
              {!showOnlyCraftable && filtered.filter((r) => !canCraft(r)).map((recipe) => {
                const active = selected === recipe.slug;
                const rarity = recipe.result_item.rarity;
                return (
                  <RecipeRow key={recipe.slug} recipe={recipe} craftable={false} active={active} rarity={rarity} owned={owned} onSelect={() => setSelected(active ? null : recipe.slug)} />
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
            <div className="flex h-64 flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-border">
              <Hammer className="h-10 w-10 text-muted-foreground/30" />
              <p className="text-lg text-muted-foreground">Wybierz recepturę z listy</p>
            </div>
          )}
        </div>
      </div>

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

      {/* ── Crafting Modal ── */}
      <Dialog open={!!craftingModal} onOpenChange={(open) => !open && setCraftingModal(null)}>
        <DialogContent showCloseButton={craftingModal?.phase === "result"} className="sm:max-w-sm text-center">
          {craftingModal?.phase === "forging" && (
            <div className="flex flex-col items-center gap-6 py-6">
              <div ref={modalSparkRef} className="absolute inset-0 flex items-center justify-center pointer-events-none">
                <div className="h-32 w-32 rounded-full bg-primary/10" />
              </div>
              <div ref={modalIconRef} className="relative z-10 flex h-24 w-24 items-center justify-center rounded-2xl border border-primary/30 bg-primary/10 text-5xl">
                {craftingModal.recipe.result_item.icon || "📦"}
              </div>
              <div>
                <p className="font-display text-2xl text-foreground">Tworzenie...</p>
                <p className="mt-1 text-base text-muted-foreground">{craftingModal.recipe.result_item.name}</p>
              </div>
              <div className="flex gap-1">
                <div className="h-2 w-2 rounded-full bg-primary animate-bounce" style={{ animationDelay: "0ms" }} />
                <div className="h-2 w-2 rounded-full bg-primary animate-bounce" style={{ animationDelay: "150ms" }} />
                <div className="h-2 w-2 rounded-full bg-primary animate-bounce" style={{ animationDelay: "300ms" }} />
              </div>
            </div>
          )}
          {craftingModal?.phase === "result" && craftingModal.result && (
            <div className="flex flex-col items-center gap-5 py-6">
              <div className="flex h-24 w-24 items-center justify-center rounded-2xl border border-accent/30 bg-accent/10 text-5xl">
                {craftingModal.recipe.result_item.icon || "📦"}
              </div>
              <div>
                <div className="flex items-center justify-center gap-2 mb-2">
                  <Sparkles className="h-5 w-5 text-accent" />
                  <p className="font-display text-2xl text-accent">Stworzono!</p>
                </div>
                <p className="text-lg font-semibold text-foreground">{craftingModal.result.item_name}</p>
              </div>
              {craftingModal.result.instance && (
                <div className="flex flex-wrap justify-center gap-2">
                  <Badge className={`text-sm ${WEAR_COLORS[craftingModal.result.instance.wear_condition] ?? ""}`} variant="outline">
                    {WEAR_FULL[craftingModal.result.instance.wear_condition] ?? craftingModal.result.instance.wear_condition}
                  </Badge>
                  <Badge variant="outline" className="text-sm font-mono text-muted-foreground">
                    {craftingModal.result.instance.wear.toFixed(4)}
                  </Badge>
                  {craftingModal.result.instance.stattrak && (
                    <Badge className="text-sm border-orange-500/40 bg-orange-500/15 text-orange-300" variant="outline">
                      StatTrak™
                    </Badge>
                  )}
                  {craftingModal.result.instance.is_rare_pattern && (
                    <Badge className="text-sm text-accent border-accent/30 bg-accent/10" variant="outline">
                      ⭐ Rzadki wzór #{craftingModal.result.instance.pattern_seed}
                    </Badge>
                  )}
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
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
      <CardHeader className="pb-0 px-4 md:px-6 pt-4 md:pt-6">
        {/* Result item */}
        <div className="flex items-start gap-3">
          <div
            className={`flex h-12 w-12 md:h-16 md:w-16 shrink-0 items-center justify-center rounded-xl border text-2xl md:text-3xl ${RARITY_BORDER[rarity]} bg-secondary`}
          >
            {recipe.result_item.icon || "📦"}
          </div>
          <div>
            <CardTitle className={`font-display text-lg md:text-2xl ${RARITY_TEXT[rarity]}`}>
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

      <CardContent className="space-y-3 md:space-y-4 px-4 md:px-6">
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
          <div className="space-y-1.5 md:space-y-2">
            {recipe.ingredients.map((ing) => {
              const have = owned(ing.item.slug);
              const enough = have >= ing.quantity;
              return (
                <div
                  key={ing.item.slug}
                  className={`flex items-center gap-2 md:gap-2.5 rounded-xl border px-2.5 py-2 md:px-3 md:py-2.5 ${
                    enough
                      ? "border-green-500/20 bg-green-500/[0.05]"
                      : "border-red-500/20 bg-red-500/[0.05]"
                  }`}
                >
                  <span className="text-lg md:text-xl">{ing.item.icon || "?"}</span>
                  <span className="flex-1 text-sm md:text-base text-foreground/80 truncate">{ing.item.name}</span>
                  <span
                    className={`font-mono text-sm md:text-base font-bold tabular-nums ${
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
                className={`flex items-center gap-2 md:gap-2.5 rounded-lg border px-2.5 py-2 md:px-3 md:py-2.5 ${
                  wallet && wallet.gold >= recipe.gold_cost
                    ? "border-amber-500/20 bg-amber-500/[0.04]"
                    : "border-red-500/20 bg-red-500/[0.04]"
                }`}
              >
                <Coins className="h-4 w-4 md:h-5 md:w-5 text-amber-400" />
                <span className="flex-1 text-sm md:text-base text-foreground/80">Złoto</span>
                <span
                  className={`font-mono text-sm md:text-base font-bold tabular-nums ${
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
          className={`w-full gap-2 rounded-full md:rounded-xl h-12 md:h-14 text-base md:text-lg font-bold transition-all active:scale-[0.97] ${
            craftable
              ? "bg-primary text-primary-foreground hover:bg-primary/90"
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
