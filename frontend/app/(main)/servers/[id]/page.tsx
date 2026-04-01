"use client";

import { ArrowLeft, Calendar, Globe, Lock, MessageSquare, Puzzle, Server, Shield, Swords, Users } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  type CommunityServer,
  type CustomGameMode,
  getServer,
  getServerGameModes,
  getServerPlugins,
  type ServerPlugin,
} from "@/lib/api";

// ── Helpers ────────────────────────────────────────────────────

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("pl-PL", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

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

// ── Skeleton ───────────────────────────────────────────────────

function ServerDetailSkeleton() {
  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        <Skeleton className="h-4 w-4 rounded" />
        <Skeleton className="h-4 w-32" />
      </div>
      <div className="space-y-3">
        <Skeleton className="h-3 w-24" />
        <Skeleton className="h-9 w-64" />
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
      <Skeleton className="h-10 w-36 rounded-full" />
    </div>
  );
}

// ── Page ───────────────────────────────────────────────────────

export default function ServerDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [server, setServer] = useState<CommunityServer | null>(null);
  const [plugins, setPlugins] = useState<ServerPlugin[]>([]);
  const [gameModes, setGameModes] = useState<CustomGameMode[]>([]);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    if (!id) return;
    setLoading(true);
    getServer(id)
      .then((s) => {
        setServer(s);
        // Load supplementary data; ignore errors (optional sections)
        getServerPlugins(id)
          .then(setPlugins)
          .catch(() => {});
        getServerGameModes(id)
          .then(setGameModes)
          .catch(() => {});
      })
      .catch(() => setNotFound(true))
      .finally(() => setLoading(false));
  }, [id]);

  if (loading) {
    return (
      <div className="animate-page-in">
        <ServerDetailSkeleton />
      </div>
    );
  }

  if (notFound || !server) {
    return (
      <div className="animate-page-in space-y-6">
        <Link
          href="/servers"
          className="inline-flex items-center gap-1.5 text-sm text-slate-400 transition-colors hover:text-zinc-100"
        >
          <ArrowLeft className="h-4 w-4" />
          Powrot do listy serwerow
        </Link>
        <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-white/10 bg-white/[0.02] py-16 text-center">
          <div className="flex h-16 w-16 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.04]">
            <Server className="h-7 w-7 text-slate-500" />
          </div>
          <h3 className="mt-4 font-display text-lg text-zinc-300">Serwer nie znaleziony</h3>
          <p className="mt-2 max-w-xs text-sm text-slate-400">
            Serwer o podanym identyfikatorze nie istnieje lub zostal usuniety.
          </p>
          <Link href="/servers">
            <Button className="mt-6 rounded-full border border-cyan-300/30 bg-[linear-gradient(135deg,#38bdf8,#0f766e)] font-display uppercase tracking-[0.2em] text-slate-950 hover:opacity-90">
              Przegladaj serwery
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
        href="/servers"
        className="inline-flex items-center gap-1.5 text-sm text-slate-400 transition-colors hover:text-zinc-100"
      >
        <ArrowLeft className="h-4 w-4" />
        Powrot do listy serwerow
      </Link>

      {/* ── Header ───────────────────────────────────────────── */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-1">
          <p className="text-[11px] uppercase tracking-[0.24em] text-slate-400">Serwer spolecznosci</p>
          <div className="flex items-center gap-3">
            <h1 className="font-display text-3xl text-zinc-50">{server.name}</h1>
            {server.is_verified && (
              <div className="flex items-center gap-1.5 rounded-full border border-cyan-300/20 bg-cyan-500/10 px-2.5 py-1">
                <Shield className="h-3.5 w-3.5 text-cyan-400" />
                <span className="text-[10px] uppercase tracking-[0.18em] text-cyan-300">Zweryfikowany</span>
              </div>
            )}
            <StatusBadge status={server.status} />
          </div>
          {server.description && <p className="mt-2 max-w-lg text-sm text-slate-400">{server.description}</p>}
        </div>

        <Button
          disabled={server.status !== "online"}
          className="h-11 shrink-0 self-start gap-2 rounded-full border border-cyan-300/30 bg-[linear-gradient(135deg,#38bdf8,#0f766e)] px-6 font-display uppercase tracking-[0.2em] text-slate-950 hover:opacity-90 disabled:opacity-40"
        >
          <Users className="h-4 w-4" />
          Dolacz do serwera
        </Button>
      </div>

      {/* ── MOTD ─────────────────────────────────────────────── */}
      {server.motd && (
        <div className="rounded-xl border border-cyan-300/10 bg-cyan-500/[0.04] px-4 py-3">
          <div className="mb-1 flex items-center gap-1.5">
            <MessageSquare className="h-3.5 w-3.5 text-cyan-400" />
            <span className="text-[10px] uppercase tracking-[0.18em] text-cyan-400">Wiadomosc serwera</span>
          </div>
          <p className="text-sm leading-relaxed text-slate-300">{server.motd}</p>
        </div>
      )}

      {/* ── Detail grid ──────────────────────────────────────── */}
      <div className="grid gap-3 sm:grid-cols-2">
        <DetailRow icon={<Globe className="h-4 w-4" />} label="Region" value={server.region} />
        <DetailRow
          icon={<Users className="h-4 w-4" />}
          label="Gracze"
          value={`${server.current_player_count ?? 0} / ${server.max_players}`}
        />
        <DetailRow
          icon={<Swords className="h-4 w-4" />}
          label="Aktywne mecze"
          value={`${server.current_match_count ?? 0} / ${server.max_concurrent_matches ?? "—"}`}
        />
        <DetailRow
          icon={<Server className="h-4 w-4" />}
          label="Wersja serwera"
          value={<span className="font-mono text-xs">{server.server_version || "—"}</span>}
        />
        <DetailRow
          icon={<Calendar className="h-4 w-4" />}
          label="Ostatni sygnal"
          value={formatHeartbeat(server.last_heartbeat)}
        />
        <DetailRow
          icon={<Calendar className="h-4 w-4" />}
          label="Data rejestracji"
          value={formatDate(server.created_at)}
        />
        <DetailRow
          icon={<Globe className="h-4 w-4" />}
          label="Widocznosc"
          value={server.is_public ? "Publiczny" : "Prywatny"}
        />
        <DetailRow
          icon={<Lock className="h-4 w-4" />}
          label="Haslo"
          value={server.has_password ? "Wymagane" : "Brak"}
        />
      </div>

      {/* ── Tags ─────────────────────────────────────────────── */}
      {(server.tags ?? []).length > 0 && (
        <div className="space-y-2">
          <div className="text-[11px] uppercase tracking-[0.24em] text-slate-400">Tagi</div>
          <div className="flex flex-wrap gap-1.5">
            {server.tags.map((tag) => (
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

      {/* ── Installed plugins ────────────────────────────────── */}
      {plugins.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <Puzzle className="h-4 w-4 text-slate-400" />
            <div className="text-[11px] uppercase tracking-[0.24em] text-slate-400">Zainstalowane pluginy</div>
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            {plugins.map((plugin) => (
              <Link
                key={plugin.id}
                href={`/plugins/${plugin.plugin_slug}`}
                className="group flex items-center justify-between rounded-xl border border-white/10 bg-black/20 px-4 py-3 transition-all hover:border-white/20 hover:bg-white/[0.06]"
              >
                <div className="min-w-0">
                  <div className="truncate text-sm text-zinc-200 transition-colors group-hover:text-cyan-200">
                    {plugin.plugin_name}
                  </div>
                  <div className="mt-0.5 font-mono text-xs text-slate-500">v{plugin.plugin_version}</div>
                </div>
                <Badge
                  className={`ml-3 shrink-0 border-0 text-[10px] uppercase tracking-[0.14em] ${
                    plugin.is_enabled
                      ? "bg-emerald-500/15 text-emerald-300 hover:bg-emerald-500/15"
                      : "bg-slate-500/20 text-slate-400 hover:bg-slate-500/20"
                  }`}
                >
                  {plugin.is_enabled ? "Aktywny" : "Wylaczony"}
                </Badge>
              </Link>
            ))}
          </div>
        </div>
      )}

      {/* ── Custom game modes ────────────────────────────────── */}
      {gameModes.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <Swords className="h-4 w-4 text-slate-400" />
            <div className="text-[11px] uppercase tracking-[0.24em] text-slate-400">Tryby gry</div>
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            {gameModes.map((mode) => (
              <div key={mode.id} className="rounded-xl border border-white/10 bg-black/20 px-4 py-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium text-zinc-200">{mode.name}</div>
                    {mode.description && (
                      <p className="mt-0.5 line-clamp-2 text-xs leading-5 text-slate-400">{mode.description}</p>
                    )}
                  </div>
                  <Badge className="shrink-0 border-0 bg-slate-500/20 text-[10px] uppercase tracking-[0.14em] text-slate-400 hover:bg-slate-500/20">
                    {mode.play_count} rozg.
                  </Badge>
                </div>
                {mode.required_plugins.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1">
                    {mode.required_plugins.map((slug) => (
                      <span
                        key={slug}
                        className="rounded-md border border-white/10 bg-white/[0.03] px-1.5 py-0.5 font-mono text-[10px] text-slate-500"
                      >
                        {slug}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Config block ─────────────────────────────────────── */}
      <div className="space-y-2">
        <div className="text-[11px] uppercase tracking-[0.24em] text-slate-400">Identyfikator serwera</div>
        <div className="rounded-xl border border-white/10 bg-black/30 px-4 py-3">
          <code className="font-mono text-xs text-slate-300 break-all">{server.id}</code>
        </div>
      </div>
    </div>
  );
}
