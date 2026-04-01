"use client";

import { ArrowRight, Download, Package, Search, Star } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  getFeaturedPlugins,
  getPluginCategories,
  getPublicPlugins,
  type PluginCategory,
  type PluginListItem,
} from "@/lib/api";

// ── Constants ──────────────────────────────────────────────────

const SORT_OPTIONS = [
  { value: "popular", label: "Popularne" },
  { value: "newest", label: "Najnowsze" },
  { value: "rating", label: "Ocena" },
  { value: "downloads", label: "Pobrania" },
];

// ── Helpers ────────────────────────────────────────────────────

function formatCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

function RatingStars({ rating, max = 5 }: { rating: number; max?: number }) {
  return (
    <span className="font-mono text-xs text-amber-300" aria-label={`Ocena ${rating} na ${max}`}>
      {Array.from({ length: max })
        .map((_, i) => (i < Math.round(rating) ? "●" : "○"))
        .join("")}
    </span>
  );
}

// ── Category badge ─────────────────────────────────────────────

const CATEGORY_COLORS: Record<string, string> = {
  gameplay: "bg-violet-500/15 text-violet-300 hover:bg-violet-500/15",
  ui: "bg-sky-500/15 text-sky-300 hover:bg-sky-500/15",
  economy: "bg-amber-500/15 text-amber-300 hover:bg-amber-500/15",
  combat: "bg-rose-500/15 text-rose-300 hover:bg-rose-500/15",
  social: "bg-emerald-500/15 text-emerald-300 hover:bg-emerald-500/15",
  utility: "bg-slate-500/20 text-slate-300 hover:bg-slate-500/20",
};

function CategoryBadge({ category }: { category: string }) {
  const cls = CATEGORY_COLORS[category] ?? "bg-slate-500/20 text-slate-300 hover:bg-slate-500/20";
  return <Badge className={`border-0 text-[10px] uppercase tracking-[0.14em] ${cls}`}>{category}</Badge>;
}

// ── Plugin card ────────────────────────────────────────────────

function PluginCard({ plugin }: { plugin: PluginListItem }) {
  return (
    <Link
      href={`/plugins/${plugin.slug}`}
      className="hover-lift group relative flex flex-col gap-4 rounded-2xl border border-white/10 bg-white/[0.05] p-5 backdrop-blur-xl transition-all hover:border-white/25 hover:bg-white/[0.10]"
    >
      {/* Featured indicator */}
      {plugin.is_featured && (
        <div className="absolute right-4 top-4">
          <Badge className="border-0 bg-amber-500/15 text-[10px] uppercase tracking-[0.18em] text-amber-300 hover:bg-amber-500/15">
            Wyrozniony
          </Badge>
        </div>
      )}

      {/* Icon + name */}
      <div className="flex items-start gap-3 pr-24">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-white/10 bg-[linear-gradient(135deg,rgba(139,92,246,0.12),rgba(34,211,238,0.06))]">
          <Package className="h-5 w-5 text-violet-300" />
        </div>
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="truncate font-display text-base text-zinc-50 transition-colors group-hover:text-violet-100">
              {plugin.name}
            </h3>
          </div>
          <div className="mt-0.5 flex items-center gap-2">
            <span className="font-mono text-[10px] text-slate-500">v{plugin.version}</span>
            <span className="text-[10px] text-slate-600">·</span>
            <span className="text-[10px] text-slate-500">{plugin.author_name}</span>
          </div>
        </div>
      </div>

      {/* Description */}
      {plugin.description ? (
        <p className="line-clamp-2 text-xs leading-5 text-slate-400">{plugin.description}</p>
      ) : (
        <p className="text-xs italic text-slate-500">Brak opisu</p>
      )}

      {/* Stats row */}
      <div className="grid grid-cols-2 gap-2">
        <div className="rounded-xl border border-white/10 bg-black/20 px-3 py-2">
          <div className="text-[10px] uppercase tracking-[0.18em] text-slate-500">Ocena</div>
          <div className="mt-0.5 flex items-center gap-1.5">
            <RatingStars rating={plugin.average_rating} />
            <span className="text-[10px] text-slate-500">({plugin.rating_count})</span>
          </div>
        </div>
        <div className="rounded-xl border border-white/10 bg-black/20 px-3 py-2">
          <div className="flex items-center gap-1">
            <Download className="h-2.5 w-2.5 text-slate-500" />
            <div className="text-[10px] uppercase tracking-[0.18em] text-slate-500">Instalacje</div>
          </div>
          <div className="mt-0.5 font-mono text-xs font-medium text-slate-300">{formatCount(plugin.install_count)}</div>
        </div>
      </div>

      {/* Tags + footer */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 flex-1 flex-wrap gap-1">
          <CategoryBadge category={plugin.category} />
          {plugin.tags.slice(0, 2).map((tag) => (
            <span
              key={tag}
              className="rounded-md border border-white/10 bg-white/[0.05] px-1.5 py-0.5 text-[10px] text-slate-400"
            >
              {tag}
            </span>
          ))}
        </div>
        <ArrowRight className="h-4 w-4 shrink-0 text-slate-500 transition-colors group-hover:text-violet-300" />
      </div>
    </Link>
  );
}

// ── Featured plugin card (horizontal scroll) ───────────────────

function FeaturedPluginCard({ plugin }: { plugin: PluginListItem }) {
  return (
    <Link
      href={`/plugins/${plugin.slug}`}
      className="hover-lift group flex w-64 shrink-0 flex-col gap-3 rounded-2xl border border-amber-300/15 bg-[linear-gradient(135deg,rgba(251,191,36,0.06),rgba(139,92,246,0.04))] p-4 backdrop-blur-xl transition-all hover:border-amber-300/30 hover:bg-[linear-gradient(135deg,rgba(251,191,36,0.10),rgba(139,92,246,0.07))]"
    >
      <div className="flex items-center gap-2">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-amber-300/15 bg-amber-500/10">
          <Package className="h-4.5 w-4.5 text-amber-300" />
        </div>
        <div className="min-w-0">
          <div className="truncate text-sm font-display text-zinc-100 transition-colors group-hover:text-amber-100">
            {plugin.name}
          </div>
          <div className="text-[10px] text-slate-500">{plugin.author_name}</div>
        </div>
      </div>
      <p className="line-clamp-2 text-xs leading-5 text-slate-400">{plugin.description}</p>
      <div className="flex items-center justify-between">
        <RatingStars rating={plugin.average_rating} />
        <span className="font-mono text-[10px] text-slate-500">{formatCount(plugin.install_count)} inst.</span>
      </div>
    </Link>
  );
}

// ── Skeleton cards ─────────────────────────────────────────────

function PluginCardSkeleton() {
  return (
    <div className="flex flex-col gap-4 rounded-2xl border border-white/10 bg-white/[0.05] p-5">
      <div className="flex items-start gap-3 pr-16">
        <Skeleton className="h-10 w-10 shrink-0 rounded-xl" />
        <div className="flex-1 space-y-2">
          <Skeleton className="h-4 w-36" />
          <Skeleton className="h-3 w-24" />
        </div>
      </div>
      <div className="space-y-1.5">
        <Skeleton className="h-3 w-full" />
        <Skeleton className="h-3 w-4/5" />
      </div>
      <div className="grid grid-cols-2 gap-2">
        {Array.from({ length: 2 }).map((_, i) => (
          <div key={i} className="rounded-xl border border-white/10 bg-black/20 px-3 py-2 space-y-1.5">
            <Skeleton className="h-2.5 w-12" />
            <Skeleton className="h-3 w-16" />
          </div>
        ))}
      </div>
      <div className="flex items-center justify-between gap-2">
        <div className="flex gap-1">
          <Skeleton className="h-4 w-16 rounded-md" />
          <Skeleton className="h-4 w-10 rounded-md" />
        </div>
        <Skeleton className="h-4 w-4 rounded" />
      </div>
    </div>
  );
}

function FeaturedCardSkeleton() {
  return (
    <div className="w-64 shrink-0 rounded-2xl border border-white/10 bg-white/[0.05] p-4 space-y-3">
      <div className="flex items-center gap-2">
        <Skeleton className="h-9 w-9 shrink-0 rounded-xl" />
        <div className="flex-1 space-y-1.5">
          <Skeleton className="h-3.5 w-28" />
          <Skeleton className="h-3 w-20" />
        </div>
      </div>
      <div className="space-y-1">
        <Skeleton className="h-3 w-full" />
        <Skeleton className="h-3 w-4/5" />
      </div>
      <div className="flex items-center justify-between">
        <Skeleton className="h-3 w-20" />
        <Skeleton className="h-3 w-16" />
      </div>
    </div>
  );
}

// ── Empty state ────────────────────────────────────────────────

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-white/10 bg-white/[0.02] py-16 text-center">
      <div className="flex h-16 w-16 items-center justify-center rounded-2xl border border-white/10 bg-[linear-gradient(135deg,rgba(139,92,246,0.08),rgba(34,211,238,0.04))]">
        <Package className="h-7 w-7 text-slate-500" />
      </div>
      <h3 className="mt-4 font-display text-lg text-zinc-300">Brak pluginow</h3>
      <p className="mt-2 max-w-xs text-sm text-slate-400">
        Nie znaleziono zadnych pluginow dla wybranych filtrow. Sprobuj zmienic kryteria wyszukiwania.
      </p>
    </div>
  );
}

// ── Page ───────────────────────────────────────────────────────

export default function PluginsPage() {
  const [plugins, setPlugins] = useState<PluginListItem[]>([]);
  const [featured, setFeatured] = useState<PluginListItem[]>([]);
  const [categories, setCategories] = useState<PluginCategory[]>([]);
  const [loading, setLoading] = useState(true);
  const [featuredLoading, setFeaturedLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("");
  const [sort, setSort] = useState("popular");

  useEffect(() => {
    setFeaturedLoading(true);
    getFeaturedPlugins()
      .then(setFeatured)
      .catch(() => setFeatured([]))
      .finally(() => setFeaturedLoading(false));
    getPluginCategories()
      .then(setCategories)
      .catch(() => setCategories([]));
  }, []);

  useEffect(() => {
    setLoading(true);
    getPublicPlugins({ category: category || undefined, search: search || undefined, sort })
      .then(setPlugins)
      .catch(() => setPlugins([]))
      .finally(() => setLoading(false));
  }, [category, sort, search]);

  // Client-side search filter (debounced effect would be ideal for prod but keeping it simple here)
  const filtered = plugins.filter(
    (p) =>
      !search ||
      p.name.toLowerCase().includes(search.toLowerCase()) ||
      p.description.toLowerCase().includes(search.toLowerCase()) ||
      p.author_name.toLowerCase().includes(search.toLowerCase()),
  );

  const totalDownloads = plugins.reduce((acc, p) => acc + p.download_count, 0);
  const featuredCount = plugins.filter((p) => p.is_featured).length;

  return (
    <div className="animate-page-in space-y-6">
      {/* ── Header ───────────────────────────────────────────── */}
      <div className="space-y-1">
        <p className="text-[11px] uppercase tracking-[0.24em] text-slate-400">Spolecznosc</p>
        <h1 className="font-display text-3xl text-zinc-50">Pluginy</h1>
        <p className="mt-2 max-w-lg text-sm text-slate-400">
          Przegladaj i instaluj pluginy spolecznosci rozszerzajace funkcjonalnosc serwerow Zelqor.
        </p>
      </div>

      {/* ── Stats strip ──────────────────────────────────────── */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <div className="rounded-2xl border border-white/10 bg-white/[0.05] px-4 py-3 backdrop-blur-xl">
          <div className="text-[11px] uppercase tracking-[0.24em] text-slate-400 font-medium">Wszystkie</div>
          <div className="mt-1 font-display text-2xl text-zinc-50">
            {loading ? <Skeleton className="h-7 w-10" /> : plugins.length}
          </div>
        </div>
        <div className="rounded-2xl border border-white/10 bg-white/[0.05] px-4 py-3 backdrop-blur-xl">
          <div className="text-[11px] uppercase tracking-[0.24em] text-slate-400 font-medium">Wyroznionych</div>
          <div className="mt-1 font-display text-2xl text-amber-300">
            {loading ? <Skeleton className="h-7 w-10" /> : featuredCount}
          </div>
        </div>
        <div className="col-span-2 rounded-2xl border border-white/10 bg-white/[0.05] px-4 py-3 backdrop-blur-xl sm:col-span-1">
          <div className="text-[11px] uppercase tracking-[0.24em] text-slate-400 font-medium">Pobrania</div>
          <div className="mt-1 font-display text-2xl text-violet-300">
            {loading ? <Skeleton className="h-7 w-16" /> : formatCount(totalDownloads)}
          </div>
        </div>
      </div>

      {/* ── Featured plugins ─────────────────────────────────── */}
      {(featuredLoading || featured.length > 0) && (
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <Star className="h-4 w-4 text-amber-400" />
            <div className="text-[11px] uppercase tracking-[0.24em] text-slate-400">Wyrozniowe pluginy</div>
          </div>
          <div className="flex gap-3 overflow-x-auto pb-2 scrollbar-none">
            {featuredLoading
              ? Array.from({ length: 4 }).map((_, i) => <FeaturedCardSkeleton key={i} />)
              : featured.map((plugin) => <FeaturedPluginCard key={plugin.id} plugin={plugin} />)}
          </div>
        </div>
      )}

      {/* ── Filters ──────────────────────────────────────────── */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
          <Input
            placeholder="Szukaj po nazwie lub autorze..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="border-white/10 bg-white/[0.04] pl-9 text-zinc-50 placeholder:text-slate-600 focus-visible:border-violet-400/40 focus-visible:ring-violet-400/20"
          />
        </div>
        <div className="flex gap-2 flex-wrap">
          {SORT_OPTIONS.map((opt) => (
            <Button
              key={opt.value}
              variant="outline"
              onClick={() => setSort(opt.value)}
              className={`h-9 rounded-full px-4 text-xs font-display uppercase tracking-[0.15em] transition-all ${
                sort === opt.value
                  ? "border-violet-300/40 bg-violet-500/10 text-violet-200 hover:bg-violet-500/15"
                  : "border-white/10 bg-white/[0.04] text-slate-400 hover:bg-white/[0.10] hover:border-white/25 hover:text-zinc-100"
              }`}
            >
              {opt.label}
            </Button>
          ))}
        </div>
      </div>

      {/* ── Category chips ────────────────────────────────────── */}
      {categories.length > 0 && (
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            onClick={() => setCategory("")}
            className={`h-8 rounded-full px-3 text-xs transition-all ${
              category === ""
                ? "border-violet-300/40 bg-violet-500/10 text-violet-200 hover:bg-violet-500/15"
                : "border-white/10 bg-white/[0.04] text-slate-400 hover:bg-white/[0.10] hover:border-white/25 hover:text-zinc-100"
            }`}
          >
            Wszystkie
          </Button>
          {categories.map((cat) => (
            <Button
              key={cat.value}
              variant="outline"
              onClick={() => setCategory(cat.value)}
              className={`h-8 rounded-full px-3 text-xs transition-all ${
                category === cat.value
                  ? "border-violet-300/40 bg-violet-500/10 text-violet-200 hover:bg-violet-500/15"
                  : "border-white/10 bg-white/[0.04] text-slate-400 hover:bg-white/[0.10] hover:border-white/25 hover:text-zinc-100"
              }`}
            >
              {cat.label}
              <span className="ml-1.5 font-mono text-[10px] opacity-60">{cat.count}</span>
            </Button>
          ))}
        </div>
      )}

      {/* ── Plugin grid ──────────────────────────────────────── */}
      {loading ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <PluginCardSkeleton key={i} />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <EmptyState />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((plugin) => (
            <PluginCard key={plugin.id} plugin={plugin} />
          ))}
        </div>
      )}
    </div>
  );
}
