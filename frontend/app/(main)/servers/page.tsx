"use client";

import { ArrowRight, Globe, Lock, Search, ServerCrash, Shield, Swords, Users } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { type CommunityServer, getPublicServers } from "@/lib/api";

// ── Constants ──────────────────────────────────────────────────

const REGIONS = [
  { value: "", label: "Wszystkie regiony" },
  { value: "EU", label: "Europa (EU)" },
  { value: "US", label: "Ameryka (US)" },
  { value: "ASIA", label: "Azja (ASIA)" },
];

// ── Helpers ────────────────────────────────────────────────────

function formatHeartbeat(iso: string | null): string {
  if (!iso) return "Brak danych";
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "Przed chwila";
  if (mins < 60) return `${mins} min temu`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} godz. temu`;
  return new Date(iso).toLocaleDateString("pl-PL");
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("pl-PL", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

// ── Status badge ───────────────────────────────────────────────

function StatusBadge({ status }: { status: CommunityServer["status"] }) {
  if (status === "online") {
    return (
      <Badge className="border-0 bg-emerald-500/15 text-[10px] uppercase tracking-[0.18em] text-emerald-300 hover:bg-emerald-500/15">
        Online
      </Badge>
    );
  }
  if (status === "maintenance") {
    return (
      <Badge className="border-0 bg-amber-500/15 text-[10px] uppercase tracking-[0.18em] text-amber-300 hover:bg-amber-500/15">
        Konserwacja
      </Badge>
    );
  }
  return (
    <Badge className="border-0 bg-slate-500/20 text-[10px] uppercase tracking-[0.18em] text-slate-400 hover:bg-slate-500/20">
      Offline
    </Badge>
  );
}

// ── Server card ────────────────────────────────────────────────

function ServerCard({ server }: { server: CommunityServer }) {
  return (
    <Link
      href={`/servers/${server.id}`}
      className="hover-lift group relative flex flex-col gap-4 rounded-2xl border border-white/10 bg-white/[0.05] p-5 backdrop-blur-xl transition-all hover:border-white/25 hover:bg-white/[0.10]"
    >
      {/* Status badge */}
      <div className="absolute right-4 top-4">
        <StatusBadge status={server.status} />
      </div>

      {/* Icon + name + description */}
      <div className="flex items-start gap-3 pr-20">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-white/10 bg-[linear-gradient(135deg,rgba(34,211,238,0.10),rgba(251,191,36,0.05))]">
          <Globe className="h-5 w-5 text-cyan-300" />
        </div>
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="truncate font-display text-base text-zinc-50 transition-colors group-hover:text-cyan-100">
              {server.name}
            </h3>
            {server.is_verified && (
              <Shield className="h-3.5 w-3.5 shrink-0 text-cyan-400" aria-label="Zweryfikowany serwer" />
            )}
          </div>
          {server.description ? (
            <p className="mt-0.5 line-clamp-2 text-xs leading-5 text-slate-400">{server.description}</p>
          ) : (
            <p className="mt-0.5 text-xs italic text-slate-500">Brak opisu</p>
          )}
        </div>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-2 gap-2">
        <div className="rounded-xl border border-white/10 bg-black/20 px-3 py-2">
          <div className="text-[10px] uppercase tracking-[0.18em] text-slate-500">Region</div>
          <div className="mt-0.5 font-mono text-xs font-medium text-slate-300">{server.region}</div>
        </div>
        <div className="rounded-xl border border-white/10 bg-black/20 px-3 py-2">
          <div className="flex items-center gap-1.5">
            <Users className="h-3 w-3 text-slate-500" />
            <div className="text-[10px] uppercase tracking-[0.18em] text-slate-500">Gracze</div>
          </div>
          <div className="mt-0.5 font-mono text-xs font-medium text-slate-300">
            {server.current_player_count ?? 0}/{server.max_players}
          </div>
        </div>
        <div className="rounded-xl border border-white/10 bg-black/20 px-3 py-2">
          <div className="flex items-center gap-1.5">
            <Swords className="h-3 w-3 text-slate-500" />
            <div className="text-[10px] uppercase tracking-[0.18em] text-slate-500">Mecze</div>
          </div>
          <div className="mt-0.5 font-mono text-xs font-medium text-slate-300">
            {server.current_match_count ?? 0}/{server.max_concurrent_matches ?? "—"}
          </div>
        </div>
        <div className="rounded-xl border border-white/10 bg-black/20 px-3 py-2">
          <div className="text-[10px] uppercase tracking-[0.18em] text-slate-500">Dodano</div>
          <div className="mt-0.5 font-mono text-xs font-medium text-slate-300">{formatDate(server.created_at)}</div>
        </div>
      </div>

      {/* Tags + footer */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 flex-1 flex-wrap gap-1">
          {server.has_password && (
            <span className="inline-flex items-center gap-1 rounded-md border border-amber-400/20 bg-amber-500/10 px-1.5 py-0.5 text-[10px] text-amber-300">
              <Lock className="h-2.5 w-2.5" />
              Haslo
            </span>
          )}
          {(server.tags ?? []).slice(0, 3).map((tag) => (
            <span
              key={tag}
              className="rounded-md border border-white/10 bg-white/[0.05] px-1.5 py-0.5 text-[10px] text-slate-400"
            >
              {tag}
            </span>
          ))}
        </div>
        <ArrowRight className="h-4 w-4 shrink-0 text-slate-500 transition-colors group-hover:text-cyan-300" />
      </div>
    </Link>
  );
}

// ── Skeleton card ──────────────────────────────────────────────

function ServerCardSkeleton() {
  return (
    <div className="flex flex-col gap-4 rounded-2xl border border-white/10 bg-white/[0.05] p-5">
      <div className="flex items-start gap-3 pr-16">
        <Skeleton className="h-10 w-10 shrink-0 rounded-xl" />
        <div className="flex-1 space-y-2">
          <Skeleton className="h-4 w-36" />
          <Skeleton className="h-3 w-52" />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="rounded-xl border border-white/10 bg-black/20 px-3 py-2 space-y-1.5">
            <Skeleton className="h-2.5 w-12" />
            <Skeleton className="h-3 w-10" />
          </div>
        ))}
      </div>
      <div className="flex items-center justify-between gap-2">
        <div className="flex gap-1">
          <Skeleton className="h-4 w-14 rounded-md" />
          <Skeleton className="h-4 w-10 rounded-md" />
        </div>
        <Skeleton className="h-4 w-4 rounded" />
      </div>
    </div>
  );
}

// ── Empty state ────────────────────────────────────────────────

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-white/10 bg-white/[0.02] py-16 text-center">
      <div className="flex h-16 w-16 items-center justify-center rounded-2xl border border-white/10 bg-[linear-gradient(135deg,rgba(34,211,238,0.08),rgba(251,191,36,0.04))]">
        <ServerCrash className="h-7 w-7 text-slate-500" />
      </div>
      <h3 className="mt-4 font-display text-lg text-zinc-300">Brak serwerow</h3>
      <p className="mt-2 max-w-xs text-sm text-slate-400">
        Nie znaleziono zadnych serwerow spolecznosci dla wybranych filtrow.
      </p>
    </div>
  );
}

// ── Page ───────────────────────────────────────────────────────

export default function ServersPage() {
  const [servers, setServers] = useState<CommunityServer[]>([]);
  const [loading, setLoading] = useState(true);
  const [region, setRegion] = useState("");
  const [search, setSearch] = useState("");

  useEffect(() => {
    setLoading(true);
    getPublicServers(region || undefined)
      .then(setServers)
      .catch(() => setServers([]))
      .finally(() => setLoading(false));
  }, [region]);

  const filtered = servers.filter((s) => s.name.toLowerCase().includes(search.toLowerCase()));

  const onlineCount = servers.filter((s) => s.status === "online").length;
  const verifiedCount = servers.filter((s) => s.is_verified).length;

  return (
    <div className="animate-page-in space-y-6">
      {/* ── Header ───────────────────────────────────────────── */}
      <div className="space-y-1">
        <p className="text-[11px] uppercase tracking-[0.24em] text-slate-400">Spolecznosc</p>
        <h1 className="font-display text-3xl text-zinc-50">Serwery spolecznosci</h1>
        <p className="mt-2 max-w-lg text-sm text-slate-400">
          Przegladaj publiczne serwery spolecznosci Zelqor. Dolacz do rozgrywki na serwerze w swoim regionie.
        </p>
      </div>

      {/* ── Stats strip ──────────────────────────────────────── */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <div className="rounded-2xl border border-white/10 bg-white/[0.05] px-4 py-3 backdrop-blur-xl">
          <div className="text-[11px] uppercase tracking-[0.24em] text-slate-400 font-medium">Wszystkie</div>
          <div className="mt-1 font-display text-2xl text-zinc-50">
            {loading ? <Skeleton className="h-7 w-10" /> : servers.length}
          </div>
        </div>
        <div className="rounded-2xl border border-white/10 bg-white/[0.05] px-4 py-3 backdrop-blur-xl">
          <div className="text-[11px] uppercase tracking-[0.24em] text-slate-400 font-medium">Online</div>
          <div className="mt-1 font-display text-2xl text-emerald-300">
            {loading ? <Skeleton className="h-7 w-10" /> : onlineCount}
          </div>
        </div>
        <div className="col-span-2 rounded-2xl border border-white/10 bg-white/[0.05] px-4 py-3 backdrop-blur-xl sm:col-span-1">
          <div className="text-[11px] uppercase tracking-[0.24em] text-slate-400 font-medium">Zweryfikowane</div>
          <div className="mt-1 font-display text-2xl text-cyan-300">
            {loading ? <Skeleton className="h-7 w-10" /> : verifiedCount}
          </div>
        </div>
      </div>

      {/* ── Filters ──────────────────────────────────────────── */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
          <Input
            placeholder="Szukaj po nazwie..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="border-white/10 bg-white/[0.04] pl-9 text-zinc-50 placeholder:text-slate-600 focus-visible:border-cyan-400/40 focus-visible:ring-cyan-400/20"
          />
        </div>
        <div className="flex gap-2 flex-wrap">
          {REGIONS.map((r) => (
            <Button
              key={r.value}
              variant="outline"
              onClick={() => setRegion(r.value)}
              className={`h-9 rounded-full px-4 text-xs font-display uppercase tracking-[0.15em] transition-all ${
                region === r.value
                  ? "border-cyan-300/40 bg-cyan-500/10 text-cyan-200 hover:bg-cyan-500/15"
                  : "border-white/10 bg-white/[0.04] text-slate-400 hover:bg-white/[0.10] hover:border-white/25 hover:text-zinc-100"
              }`}
            >
              {r.label}
            </Button>
          ))}
        </div>
      </div>

      {/* ── Server grid ──────────────────────────────────────── */}
      {loading ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <ServerCardSkeleton key={i} />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <EmptyState />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((server) => (
            <ServerCard key={server.id} server={server} />
          ))}
        </div>
      )}
    </div>
  );
}
