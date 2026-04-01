"use client";

import {
  ArrowLeft,
  Calendar,
  CheckCircle,
  Code2,
  Copy,
  Download,
  ExternalLink,
  Globe,
  Package,
  Scale,
  Star,
  Tag,
  Terminal,
  User,
} from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { getPlugin, getPluginReviews, type PluginDetail, type PluginReview } from "@/lib/api";

// ── Helpers ────────────────────────────────────────────────────

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("pl-PL", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

function formatCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

function RatingStars({ rating, max = 5 }: { rating: number; max?: number }) {
  return (
    <span className="font-mono text-sm text-amber-300" aria-label={`Ocena ${rating} na ${max}`}>
      {Array.from({ length: max })
        .map((_, i) => (i < Math.round(rating) ? "●" : "○"))
        .join("")}
    </span>
  );
}

// ── Category badge ─────────────────────────────────────────────

const CATEGORY_COLORS: Record<string, string> = {
  gameplay: "bg-violet-500/15 text-violet-300 hover:bg-violet-500/15",
  economy: "bg-amber-500/15 text-amber-300 hover:bg-amber-500/15",
  combat: "bg-rose-500/15 text-rose-300 hover:bg-rose-500/15",
  admin: "bg-indigo-500/15 text-indigo-300 hover:bg-indigo-500/15",
  chat: "bg-emerald-500/15 text-emerald-300 hover:bg-emerald-500/15",
  anticheat: "bg-red-500/15 text-red-300 hover:bg-red-500/15",
  cosmetic: "bg-pink-500/15 text-pink-300 hover:bg-pink-500/15",
  stats: "bg-sky-500/15 text-sky-300 hover:bg-sky-500/15",
  moderation: "bg-orange-500/15 text-orange-300 hover:bg-orange-500/15",
  other: "bg-slate-500/20 text-slate-300 hover:bg-slate-500/20",
};

function CategoryBadge({ category }: { category: string }) {
  const cls = CATEGORY_COLORS[category] ?? "bg-slate-500/20 text-slate-300 hover:bg-slate-500/20";
  return <Badge className={`border-0 text-[10px] uppercase tracking-[0.14em] ${cls}`}>{category}</Badge>;
}

// ── Detail row ─────────────────────────────────────────────────

function DetailRow({ icon, label, value }: { icon: React.ReactNode; label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-white/10 bg-black/20 px-4 py-3">
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-white/10 bg-white/[0.04] text-slate-400">
        {icon}
      </div>
      <div className="min-w-0">
        <div className="text-[10px] uppercase tracking-[0.18em] text-slate-500">{label}</div>
        <div className="mt-0.5 text-sm text-zinc-200">{value}</div>
      </div>
    </div>
  );
}

// ── Review card ────────────────────────────────────────────────

function ReviewCard({ review }: { review: PluginReview }) {
  return (
    <div className="rounded-xl border border-white/10 bg-black/20 px-4 py-4 space-y-2">
      <div className="flex items-start justify-between gap-3">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-zinc-200">{review.username}</span>
            <RatingStars rating={review.rating} />
          </div>
          {review.title && <p className="text-sm font-medium text-zinc-100">{review.title}</p>}
        </div>
        <span className="shrink-0 text-[10px] text-slate-500">{formatDate(review.created_at)}</span>
      </div>
      {review.body && <p className="text-sm leading-relaxed text-slate-400">{review.body}</p>}
    </div>
  );
}

// ── Skeleton ───────────────────────────────────────────────────

function PluginDetailSkeleton() {
  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        <Skeleton className="h-4 w-4 rounded" />
        <Skeleton className="h-4 w-28" />
      </div>
      <div className="space-y-3">
        <Skeleton className="h-3 w-20" />
        <Skeleton className="h-9 w-64" />
        <div className="flex items-center gap-2">
          <Skeleton className="h-5 w-20 rounded-full" />
          <Skeleton className="h-5 w-24 rounded-full" />
        </div>
        <Skeleton className="h-4 w-80" />
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="flex items-center gap-3 rounded-xl border border-white/10 bg-black/20 px-4 py-3">
            <Skeleton className="h-8 w-8 shrink-0 rounded-lg" />
            <div className="space-y-1.5">
              <Skeleton className="h-2.5 w-16" />
              <Skeleton className="h-4 w-24" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Page ───────────────────────────────────────────────────────

export default function PluginDetailPage() {
  const { slug } = useParams<{ slug: string }>();
  const [plugin, setPlugin] = useState<PluginDetail | null>(null);
  const [reviews, setReviews] = useState<PluginReview[]>([]);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!slug) return;
    setLoading(true);
    getPlugin(slug)
      .then((p) => {
        setPlugin(p);
        getPluginReviews(slug)
          .then(setReviews)
          .catch(() => {});
      })
      .catch(() => setNotFound(true))
      .finally(() => setLoading(false));
  }, [slug]);

  function handleCopyInstall() {
    if (!plugin) return;
    navigator.clipboard.writeText(`zelqor plugin install ${plugin.slug}`).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  if (loading) {
    return (
      <div className="animate-page-in">
        <PluginDetailSkeleton />
      </div>
    );
  }

  if (notFound || !plugin) {
    return (
      <div className="animate-page-in space-y-6">
        <Link
          href="/plugins"
          className="inline-flex items-center gap-1.5 text-sm text-slate-400 transition-colors hover:text-zinc-100"
        >
          <ArrowLeft className="h-4 w-4" />
          Powrot do listy pluginow
        </Link>
        <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-white/10 bg-white/[0.02] py-16 text-center">
          <div className="flex h-16 w-16 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.04]">
            <Package className="h-7 w-7 text-slate-500" />
          </div>
          <h3 className="mt-4 font-display text-lg text-zinc-300">Plugin nie znaleziony</h3>
          <p className="mt-2 max-w-xs text-sm text-slate-400">
            Plugin o podanym identyfikatorze nie istnieje lub zostal usuniety.
          </p>
          <Link href="/plugins">
            <Button className="mt-6 rounded-full border border-violet-300/30 bg-[linear-gradient(135deg,#7c3aed,#4c1d95)] font-display uppercase tracking-[0.2em] text-zinc-100 hover:opacity-90">
              Przegladaj pluginy
            </Button>
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="animate-page-in space-y-6">
      {/* ── Back link ────────────────────────────────────────── */}
      <Link
        href="/plugins"
        className="inline-flex items-center gap-1.5 text-sm text-slate-400 transition-colors hover:text-zinc-100"
      >
        <ArrowLeft className="h-4 w-4" />
        Powrot do listy pluginow
      </Link>

      {/* ── Header ───────────────────────────────────────────── */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-2">
          <p className="text-[11px] uppercase tracking-[0.24em] text-slate-400">Plugin</p>
          <div className="flex items-center gap-3">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border border-violet-300/15 bg-[linear-gradient(135deg,rgba(139,92,246,0.15),rgba(34,211,238,0.06))]">
              <Package className="h-6 w-6 text-violet-300" />
            </div>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h1 className="font-display text-3xl text-zinc-50">{plugin.name}</h1>
                <span className="font-mono text-sm text-slate-500">v{plugin.version}</span>
              </div>
              <div className="mt-0.5 text-sm text-slate-400">
                przez <span className="text-zinc-300">{plugin.author_name}</span>
              </div>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <CategoryBadge category={plugin.category} />
            {plugin.is_approved && (
              <div className="flex items-center gap-1.5 rounded-full border border-emerald-300/20 bg-emerald-500/10 px-2.5 py-1">
                <CheckCircle className="h-3 w-3 text-emerald-400" />
                <span className="text-[10px] uppercase tracking-[0.18em] text-emerald-300">Zatwierdzony</span>
              </div>
            )}
            {plugin.is_featured && (
              <div className="flex items-center gap-1.5 rounded-full border border-amber-300/20 bg-amber-500/10 px-2.5 py-1">
                <Star className="h-3 w-3 text-amber-400" />
                <span className="text-[10px] uppercase tracking-[0.18em] text-amber-300">Wyrozniony</span>
              </div>
            )}
            {plugin.is_deprecated && (
              <Badge className="border-0 bg-rose-500/15 text-[10px] uppercase tracking-[0.18em] text-rose-300 hover:bg-rose-500/15">
                Przestarzaly
              </Badge>
            )}
          </div>
          {plugin.description && <p className="max-w-lg text-sm text-slate-400">{plugin.description}</p>}
        </div>
      </div>

      {/* ── Deprecation warning ──────────────────────────────── */}
      {plugin.is_deprecated && plugin.deprecation_message && (
        <div className="rounded-xl border border-rose-400/20 bg-rose-500/[0.07] px-4 py-3">
          <p className="text-sm text-rose-300">{plugin.deprecation_message}</p>
        </div>
      )}

      {/* ── Stats ────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="rounded-2xl border border-white/10 bg-white/[0.05] px-4 py-3 backdrop-blur-xl">
          <div className="text-[11px] uppercase tracking-[0.24em] text-slate-400 font-medium">Instalacje</div>
          <div className="mt-1 font-display text-2xl text-violet-300">{formatCount(plugin.install_count)}</div>
        </div>
        <div className="rounded-2xl border border-white/10 bg-white/[0.05] px-4 py-3 backdrop-blur-xl">
          <div className="text-[11px] uppercase tracking-[0.24em] text-slate-400 font-medium">Pobrania</div>
          <div className="mt-1 font-display text-2xl text-zinc-50">{formatCount(plugin.download_count)}</div>
        </div>
        <div className="rounded-2xl border border-white/10 bg-white/[0.05] px-4 py-3 backdrop-blur-xl">
          <div className="text-[11px] uppercase tracking-[0.24em] text-slate-400 font-medium">Ocena</div>
          <div className="mt-1 flex items-center gap-1.5">
            <span className="font-display text-2xl text-amber-300">{plugin.average_rating.toFixed(1)}</span>
            <span className="text-xs text-slate-500">/ 5</span>
          </div>
        </div>
        <div className="rounded-2xl border border-white/10 bg-white/[0.05] px-4 py-3 backdrop-blur-xl">
          <div className="text-[11px] uppercase tracking-[0.24em] text-slate-400 font-medium">Recenzje</div>
          <div className="mt-1 font-display text-2xl text-zinc-50">{plugin.rating_count}</div>
        </div>
      </div>

      {/* ── Long description ─────────────────────────────────── */}
      {plugin.long_description && (
        <div className="space-y-2">
          <div className="text-[11px] uppercase tracking-[0.24em] text-slate-400">Opis</div>
          <div className="rounded-xl border border-white/10 bg-black/20 px-5 py-4">
            <p className="whitespace-pre-wrap text-sm leading-relaxed text-slate-300">{plugin.long_description}</p>
          </div>
        </div>
      )}

      {/* ── Install instructions ─────────────────────────────── */}
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <Terminal className="h-4 w-4 text-slate-400" />
          <div className="text-[11px] uppercase tracking-[0.24em] text-slate-400">Instalacja</div>
        </div>
        <div className="flex items-center gap-3 rounded-xl border border-white/10 bg-black/30 px-4 py-3">
          <code className="flex-1 font-mono text-sm text-violet-300">zelqor plugin install {plugin.slug}</code>
          <button
            onClick={handleCopyInstall}
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-white/10 bg-white/[0.05] text-slate-400 transition-all hover:border-white/20 hover:bg-white/[0.10] hover:text-zinc-100"
            aria-label="Kopiuj komende instalacji"
          >
            {copied ? <CheckCircle className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}
          </button>
        </div>
        {plugin.min_engine_version && (
          <p className="text-xs text-slate-500">Wymaga silnika Zelqor w wersji &gt;= {plugin.min_engine_version}</p>
        )}
      </div>

      {/* ── Detail grid ──────────────────────────────────────── */}
      <div className="grid gap-3 sm:grid-cols-2">
        <DetailRow icon={<User className="h-4 w-4" />} label="Autor" value={plugin.author_name} />
        <DetailRow
          icon={<Calendar className="h-4 w-4" />}
          label="Data publikacji"
          value={formatDate(plugin.created_at)}
        />
        <DetailRow icon={<Scale className="h-4 w-4" />} label="Licencja" value={plugin.license || "—"} />
        <DetailRow
          icon={<Download className="h-4 w-4" />}
          label="Min. wersja silnika"
          value={<span className="font-mono text-xs">{plugin.min_engine_version || "—"}</span>}
        />
      </div>

      {/* ── Links ────────────────────────────────────────────── */}
      {(plugin.homepage_url || plugin.source_url) && (
        <div className="space-y-2">
          <div className="text-[11px] uppercase tracking-[0.24em] text-slate-400">Linki</div>
          <div className="flex flex-wrap gap-2">
            {plugin.homepage_url && (
              <a
                href={plugin.homepage_url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.05] px-3 py-1.5 text-xs text-slate-300 transition-all hover:border-white/20 hover:bg-white/[0.10] hover:text-zinc-100"
              >
                <Globe className="h-3.5 w-3.5" />
                Strona domowa
                <ExternalLink className="h-3 w-3 opacity-60" />
              </a>
            )}
            {plugin.source_url && (
              <a
                href={plugin.source_url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.05] px-3 py-1.5 text-xs text-slate-300 transition-all hover:border-white/20 hover:bg-white/[0.10] hover:text-zinc-100"
              >
                <Code2 className="h-3.5 w-3.5" />
                Kod zrodlowy
                <ExternalLink className="h-3 w-3 opacity-60" />
              </a>
            )}
          </div>
        </div>
      )}

      {/* ── Hooks ────────────────────────────────────────────── */}
      {plugin.hooks.length > 0 && (
        <div className="space-y-2">
          <div className="text-[11px] uppercase tracking-[0.24em] text-slate-400">Hooki silnika</div>
          <div className="flex flex-wrap gap-1.5">
            {plugin.hooks.map((hook) => (
              <span
                key={hook}
                className="rounded-lg border border-violet-300/10 bg-violet-500/[0.07] px-2.5 py-1 font-mono text-xs text-violet-300"
              >
                {hook}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* ── Required permissions ─────────────────────────────── */}
      {plugin.required_permissions.length > 0 && (
        <div className="space-y-2">
          <div className="text-[11px] uppercase tracking-[0.24em] text-slate-400">Wymagane uprawnienia</div>
          <div className="flex flex-wrap gap-1.5">
            {plugin.required_permissions.map((perm) => (
              <span
                key={perm}
                className="rounded-lg border border-amber-300/10 bg-amber-500/[0.07] px-2.5 py-1 font-mono text-xs text-amber-300"
              >
                {perm}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* ── Tags ─────────────────────────────────────────────── */}
      {plugin.tags.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <Tag className="h-3.5 w-3.5 text-slate-400" />
            <div className="text-[11px] uppercase tracking-[0.24em] text-slate-400">Tagi</div>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {plugin.tags.map((tag) => (
              <span
                key={tag}
                className="rounded-lg border border-white/10 bg-white/[0.05] px-2.5 py-1 text-xs text-slate-300"
              >
                {tag}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* ── Reviews ──────────────────────────────────────────── */}
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <Star className="h-4 w-4 text-slate-400" />
          <div className="text-[11px] uppercase tracking-[0.24em] text-slate-400">Recenzje ({plugin.rating_count})</div>
        </div>
        {reviews.length === 0 ? (
          <div className="rounded-xl border border-dashed border-white/10 bg-white/[0.02] py-8 text-center">
            <p className="text-sm text-slate-500">Brak recenzji dla tego pluginu.</p>
          </div>
        ) : (
          <div className="space-y-2">
            {reviews.map((review) => (
              <ReviewCard key={review.id} review={review} />
            ))}
          </div>
        )}
      </div>

      {/* ── Slug ref ─────────────────────────────────────────── */}
      <div className="space-y-2">
        <div className="text-[11px] uppercase tracking-[0.24em] text-slate-400">Identyfikator pluginu</div>
        <div className="rounded-xl border border-white/10 bg-black/30 px-4 py-3">
          <code className="font-mono text-xs text-slate-300 break-all">{plugin.slug}</code>
        </div>
      </div>
    </div>
  );
}
