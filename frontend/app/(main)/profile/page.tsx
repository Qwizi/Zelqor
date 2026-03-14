"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import {
  Trophy,
  Swords,
  Crown,
  Coins,
  User,
  ChevronRight,
  Layers,
  Package,
} from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import {
  getMe,
  getMyMatches,
  getMyWallet,
  getMyInventory,
  getMyDecks,
  type Match,
  type WalletOut,
  type InventoryItemOut,
  type DeckOut,
  type User as UserType,
} from "@/lib/api";
import { Badge } from "@/components/ui/badge";

const STATUS_LABELS: Record<string, { label: string; color: string }> = {
  finished: { label: "Zakończony", color: "text-slate-400" },
  in_progress: { label: "W trakcie", color: "text-emerald-300" },
  selecting: { label: "Wybór stolic", color: "text-amber-200" },
  cancelled: { label: "Anulowany", color: "text-red-400" },
};

function StatCard({
  value,
  label,
  color = "text-zinc-50",
}: {
  value: string | number;
  label: string;
  color?: string;
}) {
  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.04] px-3 py-3 text-center">
      <div className={`font-display text-2xl ${color}`}>{value}</div>
      <div className="mt-0.5 text-[10px] uppercase tracking-[0.2em] text-slate-500">
        {label}
      </div>
    </div>
  );
}

export default function ProfilePage() {
  const { user, loading: authLoading, token } = useAuth();
  const router = useRouter();

  const [profile, setProfile] = useState<UserType | null>(null);
  const [matches, setMatches] = useState<Match[]>([]);
  const [wallet, setWallet] = useState<WalletOut | null>(null);
  const [inventory, setInventory] = useState<InventoryItemOut[]>([]);
  const [decks, setDecks] = useState<DeckOut[]>([]);
  const [dataLoading, setDataLoading] = useState(true);

  useEffect(() => {
    if (authLoading) return;
    if (!user || !token) {
      router.replace("/login");
      return;
    }

    Promise.allSettled([
      getMe(token),
      getMyMatches(token, 10),
      getMyWallet(token),
      getMyInventory(token, 8),
      getMyDecks(token),
    ]).then(([profileRes, matchesRes, walletRes, inventoryRes, decksRes]) => {
      if (profileRes.status === "fulfilled") setProfile(profileRes.value);
      if (matchesRes.status === "fulfilled") setMatches(matchesRes.value.items);
      if (walletRes.status === "fulfilled") setWallet(walletRes.value);
      if (inventoryRes.status === "fulfilled") setInventory(inventoryRes.value.items);
      if (decksRes.status === "fulfilled") setDecks(decksRes.value.items);
      setDataLoading(false);
    });
  }, [authLoading, user, token, router]);

  if (authLoading || dataLoading || !user) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-zinc-950">
        <Image
          src="/assets/match_making/circle291.webp"
          alt=""
          width={48}
          height={48}
          className="h-12 w-12 animate-spin object-contain"
        />
      </div>
    );
  }

  const currentUser = profile ?? user;
  const wins = matches.filter(
    (m) => m.status === "finished" && m.winner_id === currentUser.id
  ).length;
  const finishedMatches = matches.filter((m) => m.status === "finished").length;
  const winRate =
    finishedMatches > 0 ? Math.round((wins / finishedMatches) * 100) : 0;
  const defaultDeck = decks.find((d) => d.is_default);

  const joinDate = new Date(currentUser.date_joined);
  const joinDateStr = joinDate.toLocaleDateString("pl-PL", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });

  return (
    <div className="space-y-6">
      {/* Page header */}
      <div className="space-y-1">
        <p className="text-[11px] uppercase tracking-[0.24em] text-slate-500">
          PROFIL
        </p>
        <h1 className="font-display text-3xl text-zinc-50">Twój profil</h1>
      </div>

      {/* Identity card */}
      <section className="rounded-2xl border border-white/10 bg-slate-950/55 p-6 backdrop-blur-xl">
        <div className="flex flex-col gap-5 sm:flex-row sm:items-start sm:gap-6">
          {/* Avatar */}
          <div className="flex h-20 w-20 shrink-0 items-center justify-center rounded-2xl border border-white/10 bg-[linear-gradient(135deg,rgba(34,211,238,0.12),rgba(251,191,36,0.06))]">
            <User className="h-9 w-9 text-cyan-200" />
          </div>

          {/* Info */}
          <div className="flex-1 space-y-1.5">
            <h2 className="font-display text-2xl text-zinc-50">
              {currentUser.username}
            </h2>
            <p className="text-sm text-slate-400">{currentUser.email}</p>
            <p className="text-xs text-slate-500">
              Dołączył:{" "}
              <span className="text-slate-400">{joinDateStr}</span>
            </p>
            {currentUser.tutorial_completed && (
              <span className="inline-flex items-center gap-1 rounded-full border border-emerald-400/20 bg-emerald-400/10 px-2.5 py-0.5 text-[11px] text-emerald-300">
                Samouczek ukończony
              </span>
            )}
          </div>
        </div>

        {/* Stats grid */}
        <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-5">
          <StatCard
            value={currentUser.elo_rating}
            label="ELO"
            color="text-amber-200"
          />
          <StatCard
            value={matches.length}
            label="Mecze"
            color="text-cyan-200"
          />
          <StatCard
            value={wins}
            label="Wygrane"
            color="text-emerald-300"
          />
          <StatCard
            value={`${winRate}%`}
            label="Win Rate"
            color="text-violet-300"
          />
          <StatCard
            value={wallet ? wallet.gold.toLocaleString("pl-PL") : "—"}
            label="Złoto"
            color="text-amber-300"
          />
        </div>
      </section>

      {/* Recent matches */}
      <section className="rounded-2xl border border-white/10 bg-slate-950/55 p-6 backdrop-blur-xl">
        <div className="mb-5 flex items-center justify-between">
          <p className="text-[11px] uppercase tracking-[0.24em] text-slate-500">
            Ostatnie mecze
          </p>
          <Link
            href="/dashboard"
            className="text-xs text-slate-500 hover:text-cyan-300 transition-colors"
          >
            Panel
            <ChevronRight className="inline h-3 w-3" />
          </Link>
        </div>

        {matches.length === 0 ? (
          <div className="rounded-2xl border border-white/10 bg-white/[0.02] px-5 py-8 text-center">
            <Swords className="mx-auto h-8 w-8 text-slate-600" />
            <p className="mt-3 text-sm text-slate-500">
              Brak rozegranych meczów
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-white/[0.06]">
                  <th className="pb-2 text-left text-[10px] uppercase tracking-[0.2em] text-slate-500">
                    Data
                  </th>
                  <th className="pb-2 text-left text-[10px] uppercase tracking-[0.2em] text-slate-500">
                    Status
                  </th>
                  <th className="pb-2 text-left text-[10px] uppercase tracking-[0.2em] text-slate-500">
                    Gracze
                  </th>
                  <th className="pb-2 text-left text-[10px] uppercase tracking-[0.2em] text-slate-500">
                    Wynik
                  </th>
                  <th className="pb-2" />
                </tr>
              </thead>
              <tbody className="divide-y divide-white/[0.04]">
                {matches.slice(0, 10).map((match) => {
                  const isActive =
                    match.status === "in_progress" ||
                    match.status === "selecting";
                  const isWinner = match.winner_id === currentUser.id;
                  const myPlayer = match.players.find(
                    (p) => p.user_id === currentUser.id
                  );
                  const dateStr =
                    match.finished_at ??
                    match.started_at ??
                    match.created_at;
                  const date = new Date(dateStr);
                  const status =
                    STATUS_LABELS[match.status] ?? {
                      label: match.status,
                      color: "text-slate-400",
                    };

                  return (
                    <tr key={match.id} className="group">
                      <td className="py-2.5 pr-4 text-xs text-slate-400">
                        {date.toLocaleDateString("pl-PL", {
                          day: "numeric",
                          month: "short",
                        })}
                      </td>
                      <td className={`py-2.5 pr-4 text-xs ${status.color}`}>
                        {status.label}
                      </td>
                      <td className="py-2.5 pr-4 text-xs text-slate-400">
                        {match.players.length} graczy
                      </td>
                      <td className="py-2.5 pr-4">
                        {isActive ? (
                          <Badge className="border-0 bg-emerald-400/15 text-[10px] text-emerald-300 hover:bg-emerald-400/15">
                            Na żywo
                          </Badge>
                        ) : match.status === "finished" ? (
                          isWinner ? (
                            <Badge className="border-0 bg-amber-400/15 text-[10px] text-amber-200 hover:bg-amber-400/15">
                              Wygrana
                            </Badge>
                          ) : myPlayer && !myPlayer.is_alive ? (
                            <Badge className="border-0 bg-red-400/15 text-[10px] text-red-300 hover:bg-red-400/15">
                              Przegrana
                            </Badge>
                          ) : (
                            <span className="text-xs text-slate-500">—</span>
                          )
                        ) : (
                          <span className="text-xs text-slate-500">—</span>
                        )}
                      </td>
                      <td className="py-2.5 text-right">
                        <Link
                          href={
                            isActive
                              ? `/game/${match.id}`
                              : `/match/${match.id}`
                          }
                          className="text-slate-600 transition-colors group-hover:text-slate-300"
                        >
                          <ChevronRight className="h-4 w-4" />
                        </Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Inventory preview */}
      <section className="rounded-2xl border border-white/10 bg-slate-950/55 p-6 backdrop-blur-xl">
        <div className="mb-5 flex items-center justify-between">
          <p className="text-[11px] uppercase tracking-[0.24em] text-slate-500">
            Ekwipunek (podgląd)
          </p>
          <Link
            href="/inventory"
            className="rounded-xl border border-cyan-400/20 bg-cyan-500/15 px-4 py-2 text-sm font-medium text-cyan-200 hover:bg-cyan-500/25 transition-colors"
          >
            Pełny ekwipunek
          </Link>
        </div>

        {inventory.length === 0 ? (
          <div className="rounded-2xl border border-white/10 bg-white/[0.02] px-5 py-8 text-center">
            <Package className="mx-auto h-8 w-8 text-slate-600" />
            <p className="mt-3 text-sm text-slate-500">
              Brak przedmiotów w ekwipunku
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-4 gap-3 sm:grid-cols-8">
            {inventory.map((inv) => (
              <div
                key={inv.id}
                title={`${inv.item.name} ×${inv.quantity}`}
                className="group relative flex aspect-square flex-col items-center justify-center rounded-xl border border-white/10 bg-white/[0.04] p-2 transition-colors hover:border-white/20 hover:bg-white/[0.07]"
              >
                <span className="text-xs font-medium text-zinc-200 text-center leading-tight line-clamp-2">
                  {inv.item.name}
                </span>
                {inv.quantity > 1 && (
                  <span className="absolute bottom-1 right-1.5 text-[10px] text-slate-400">
                    ×{inv.quantity}
                  </span>
                )}
                <span
                  className={`mt-1 text-[9px] uppercase tracking-wider ${
                    inv.item.rarity === "legendary"
                      ? "text-amber-400"
                      : inv.item.rarity === "epic"
                        ? "text-violet-400"
                        : inv.item.rarity === "rare"
                          ? "text-cyan-400"
                          : "text-slate-500"
                  }`}
                >
                  {inv.item.rarity}
                </span>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Active deck */}
      <section className="rounded-2xl border border-white/10 bg-slate-950/55 p-6 backdrop-blur-xl">
        <div className="mb-5 flex items-center justify-between">
          <p className="text-[11px] uppercase tracking-[0.24em] text-slate-500">
            Aktywna talia
          </p>
          <Link
            href="/decks"
            className="rounded-xl border border-cyan-400/20 bg-cyan-500/15 px-4 py-2 text-sm font-medium text-cyan-200 hover:bg-cyan-500/25 transition-colors"
          >
            Zarządzaj taliami
          </Link>
        </div>

        {!defaultDeck ? (
          <div className="rounded-2xl border border-white/10 bg-white/[0.02] px-5 py-8 text-center">
            <Layers className="mx-auto h-8 w-8 text-slate-600" />
            <p className="mt-3 text-sm text-slate-500">
              Brak domyślnej talii — stwórz talię przed grą
            </p>
          </div>
        ) : (
          <div>
            <div className="mb-3 flex items-center gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-xl border border-white/10 bg-white/[0.04]">
                <Layers className="h-4 w-4 text-cyan-300" />
              </div>
              <div>
                <span className="font-medium text-zinc-50">
                  {defaultDeck.name}
                </span>
                <span className="ml-2 rounded bg-amber-500/20 px-1.5 py-0.5 text-[10px] text-amber-300">
                  domyślna
                </span>
              </div>
            </div>

            {defaultDeck.items.length === 0 ? (
              <p className="text-xs text-slate-500">
                Talia nie zawiera przedmiotów
              </p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {defaultDeck.items.map((di, i) => (
                  <div
                    key={i}
                    className="flex items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-xs text-slate-300"
                  >
                    <span>{di.item.name}</span>
                    {di.quantity > 1 && (
                      <span className="text-slate-500">×{di.quantity}</span>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </section>
    </div>
  );
}
