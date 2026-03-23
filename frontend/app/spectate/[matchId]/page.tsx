"use client";

import { useEffect, useMemo, use } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/hooks/useAuth";
import { useGameSocket } from "@/hooks/useGameSocket";
import { useShapesData } from "@/hooks/useShapesData";
import { loadAssetOverrides } from "@/lib/assetOverrides";
import { useRegionsGraph, useConfig } from "@/hooks/queries";
import dynamic from "next/dynamic";
import { Eye, ArrowLeft, Loader2, Users, Trophy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

const GameCanvas = dynamic(() => import("@/components/map/GameCanvas"), { ssr: false });

export default function SpectatePage({
  params,
}: {
  params: Promise<{ matchId: string }>;
}) {
  const { matchId } = use(params);
  const { user, loading: authLoading } = useAuth();
  const router = useRouter();

  const {
    connected,
    gameState,
    bannedReason,
  } = useGameSocket(matchId, { spectator: true });

  // Map data
  const { shapesData: shapes } = useShapesData();
  const { data: regionGraphData } = useRegionsGraph();
  const { data: configData } = useConfig();

  const regionGraph = regionGraphData ?? [];
  const buildings = configData?.buildings ?? [];
  const units = configData?.units ?? [];

  const buildingIcons = useMemo<Record<string, string>>(() => {
    const icons: Record<string, string> = {};
    for (const b of buildings) {
      if (b.icon) icons[b.slug] = b.icon;
    }
    return icons;
  }, [buildings]);

  useEffect(() => {
    loadAssetOverrides().catch(() => {});
  }, []);

  const status = gameState?.meta?.status;
  const tick = parseInt(gameState?.meta?.current_tick ?? "0", 10);

  // Player list for overlay — includes unit count and territory count from regions
  const playersList = useMemo(() => {
    if (!gameState?.players) return [];
    const regions = gameState.regions ?? {};
    // Count territories and units per player
    const territoryCounts: Record<string, number> = {};
    const unitCounts: Record<string, number> = {};
    for (const region of Object.values(regions)) {
      if (region.owner_id) {
        territoryCounts[region.owner_id] = (territoryCounts[region.owner_id] ?? 0) + 1;
        // Sum all unit types in the region
        const totalUnits = region.units
          ? Object.values(region.units).reduce((s, n) => s + n, 0)
          : region.unit_count ?? 0;
        unitCounts[region.owner_id] = (unitCounts[region.owner_id] ?? 0) + totalUnits;
      }
    }
    return Object.entries(gameState.players).map(([uid, p]) => ({
      user_id: uid,
      username: p.username ?? "?",
      color: p.color ?? "#888",
      is_alive: p.is_alive !== false,
      energy: p.energy ?? 0,
      territories: territoryCounts[uid] ?? 0,
      totalUnits: unitCounts[uid] ?? 0,
    }));
  }, [gameState?.players, gameState?.regions]);

  // Neighbor map for GameCanvas
  const neighborMap = useMemo(() => {
    const map: Record<string, string[]> = {};
    for (const entry of regionGraph) {
      map[entry.id] = entry.neighbor_ids;
    }
    return map;
  }, [regionGraph]);

  if (authLoading) {
    return (
      <div className="flex h-screen items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (bannedReason) {
    return (
      <div className="flex h-screen items-center justify-center bg-background">
        <div className="text-center space-y-4">
          <Eye className="h-12 w-12 text-destructive mx-auto" />
          <h2 className="font-display text-2xl text-foreground">Nie można oglądać tego meczu</h2>
          <p className="text-muted-foreground">{bannedReason}</p>
          <Button onClick={() => router.back()}>Wróć</Button>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 bg-background text-foreground overflow-hidden">
      {/* Game canvas — full screen */}
      {gameState && shapes && (
        <GameCanvas
          shapesData={shapes}
          regions={gameState.regions ?? {}}
          players={gameState.players ?? {}}
          selectedRegion={null}
          targetRegions={[]}
          highlightedNeighbors={[]}
          dimmedRegions={[]}
          onRegionClick={() => {}}
          myUserId="__spectator__"
          animations={[]}
          buildingIcons={buildingIcons}
          airTransitQueue={gameState.air_transit_queue}
          plannedMoves={[]}
        />
      )}

      {/* Spectator HUD overlay */}
      <div className="absolute inset-x-0 top-0 z-30 pointer-events-none">
        {/* Top bar */}
        <div className="flex items-center gap-3 px-4 h-12 bg-gradient-to-b from-black/60 to-transparent pointer-events-auto">
          <Button variant="ghost" size="sm" onClick={() => router.back()} className="gap-2 text-white/80 hover:text-white hover:bg-white/10">
            <ArrowLeft size={16} />
            Wróć
          </Button>
          <div className="flex-1" />
          <Badge className="gap-1.5 bg-accent/20 text-accent border-accent/30 backdrop-blur-sm">
            <Eye size={14} />
            Obserwator
          </Badge>
          <Badge variant="outline" className="gap-1.5 text-white/60 border-white/20 backdrop-blur-sm">
            Na żywo
          </Badge>
          <div className="flex items-center gap-2 text-sm text-white/60">
            {connected ? (
              <span className="flex items-center gap-1.5">
                <span className="h-1.5 w-1.5 rounded-full bg-green-500" />
                Tick {tick}
              </span>
            ) : (
              <span className="flex items-center gap-1.5">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Łączenie...
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Player scoreboard — bottom left */}
      <div className="absolute left-4 bottom-4 z-30 w-72 pointer-events-auto">
        <div className="rounded-2xl bg-card/90 border border-border backdrop-blur-xl overflow-hidden shadow-xl">
          <div className="flex items-center gap-2 px-4 py-2.5 border-b border-border">
            <Users size={14} className="text-muted-foreground" />
            <span className="text-xs uppercase tracking-[0.15em] text-muted-foreground font-medium">Gracze</span>
            {status === "finished" && (
              <Badge className="ml-auto bg-accent/15 text-accent border-0 text-[10px]">Zakończony</Badge>
            )}
          </div>
          {/* Column headers */}
          <div className="flex items-center gap-2 px-4 py-1.5 text-[10px] uppercase tracking-wider text-muted-foreground/50 border-b border-border/50">
            <span className="w-3" />
            <span className="flex-1">Gracz</span>
            <span className="w-8 text-center">Ter.</span>
            <span className="w-8 text-center">Jed.</span>
            <span className="w-10 text-right">⚡</span>
          </div>
          <div className="divide-y divide-border/50">
            {[...playersList]
              .sort((a, b) => (b.is_alive ? 1 : 0) - (a.is_alive ? 1 : 0) || b.territories - a.territories)
              .map((p) => (
                <div
                  key={p.user_id}
                  className={`flex items-center gap-2 px-4 py-2 text-sm ${
                    p.is_alive ? "" : "opacity-40"
                  }`}
                >
                  <div className="h-3 w-3 rounded-sm shrink-0" style={{ backgroundColor: p.color }} />
                  <span className="flex-1 font-medium text-foreground truncate">
                    {p.username}
                    {!p.is_alive && <span className="ml-1 text-[10px] text-destructive">✕</span>}
                  </span>
                  <span className="w-8 text-center text-xs tabular-nums text-foreground/70">{p.territories}</span>
                  <span className="w-8 text-center text-xs tabular-nums text-foreground/70">{p.totalUnits}</span>
                  <span className="w-10 text-right text-xs tabular-nums text-accent">{p.energy}</span>
                </div>
              ))}
          </div>
        </div>
      </div>

      {/* Loading overlay */}
      {!gameState && (
        <div className="absolute inset-0 z-40 flex flex-col items-center justify-center bg-background/80 backdrop-blur-sm gap-4">
          <Loader2 className="h-10 w-10 animate-spin text-primary" />
          <p className="text-lg text-muted-foreground">Ładowanie meczu...</p>
          <p className="text-sm text-muted-foreground/60">Dane opóźnione o ~30 sekund</p>
        </div>
      )}
    </div>
  );
}
