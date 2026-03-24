// ── Event-driven game animations ──────────────────────────────────────────────
// Extracted from game page — transforms server events into TroopAnimations.

import { useEffect, useRef } from "react";
import { toast } from "sonner";
import type { UnitType } from "@/lib/api";
import { BOOST_EFFECT_LABELS, getAnimationPower } from "@/lib/gamePageUtils";
import type { TroopAnimation } from "@/lib/gameTypes";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type GameEvent = Record<string, any>;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type GameStateRef = React.RefObject<any>;

/**
 * Processes server events and produces TroopAnimation[] entries for visual rendering.
 * Handles: troops_sent, bombard (with SAM intercepts), air combat, bomber strikes,
 * province neutralization, boost notifications.
 */
export function useGameAnimations(
  events: GameEvent[],
  myUserId: string,
  unitsConfig: UnitType[],
  unitConfigBySlug: Record<string, { movement_type?: string; attack?: number }>,
  unitManpowerMap: Record<string, number> | undefined,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  gameStateRef: React.RefObject<any>,
  _neighborMap: Record<string, string[]>,
  localDispatchKeysRef: React.RefObject<Map<string, number>>,
  setAnimations: React.Dispatch<React.SetStateAction<TroopAnimation[]>>,
  _setNukeBlackout: React.Dispatch<React.SetStateAction<Array<{ rid: string; startTime: number }>>>,
) {
  const processedKeysRef = useRef(new Set<string>());

  useEffect(() => {
    if (events.length === 0) return;

    const seen = processedKeysRef.current;
    const newEvents = events.filter((e) => {
      const key = e.__eventKey;
      return key ? !seen.has(key) : true;
    });
    if (newEvents.length === 0) return;
    for (const e of newEvents) {
      if (e.__eventKey) seen.add(e.__eventKey);
    }
    if (seen.size > 200) {
      const keep = new Set<string>();
      for (const e of events) {
        if (e.__eventKey) keep.add(e.__eventKey);
      }
      processedKeysRef.current = keep;
    }

    const newAnims: TroopAnimation[] = [];
    for (const e of newEvents) {
      if (e.type === "troops_sent") {
        const eventKey = [
          e.action_type,
          e.player_id,
          e.source_region_id,
          e.target_region_id,
          e.unit_type,
          e.units,
        ].join(":");
        const localDispatchAt = localDispatchKeysRef.current.get(eventKey);
        if (e.player_id === myUserId && localDispatchAt && Date.now() - localDispatchAt < 3000) {
          localDispatchKeysRef.current.delete(eventKey);
          continue;
        }
        const playerId = e.player_id as string;
        const unitTypeStr = (e.unit_type as string) || null;
        if (unitConfigBySlug[unitTypeStr ?? ""]?.movement_type === "air") continue;
        const color = gameStateRef.current?.players[playerId]?.color ?? "#3b82f6";
        const carrierCount = (e.units as number) || 0;
        const travelTicks = Math.max(1, (e.travel_ticks as number) || 1);
        const tickMs = parseInt(gameStateRef.current?.meta?.tick_interval_ms || "1000", 10);
        newAnims.push({
          id: crypto.randomUUID(),
          sourceId: e.source_region_id as string,
          targetId: e.target_region_id as string,
          color,
          units: getAnimationPower(unitsConfig, unitTypeStr, carrierCount),
          unitType: unitTypeStr,
          type: (e.action_type as string) === "attack" ? "attack" : "move",
          startTime: Date.now(),
          durationMs: travelTicks * tickMs,
          playerId,
        });
      } else if (e.type === "boost_activated" && e.player_id === myUserId) {
        const effectLabel = BOOST_EFFECT_LABELS[e.effect_type as string] ?? (e.effect_type as string);
        toast.success(`Boost aktywowany: ${effectLabel}`, { id: `game-boost-activated-${e.effect_type}` });
      } else if (e.type === "boost_expired" && e.player_id === myUserId) {
        const slug = e.boost_slug as string;
        const label = slug
          .replace(/^boost-/, "")
          .replace(/-\d+$/, "")
          .replace(/-/g, " ");
        toast.warning(`Boost wygasł: ${label}`, { id: `game-boost-expired-${e.boost_slug}` });
      } else if (e.type === "bombard") {
        const sourceId = e.source_region_id as string;
        const targetId = e.target_region_id as string;
        const rocketCount = (e.rocket_count as number) ?? 1;
        const totalKilled = (e.total_killed as number) ?? 0;
        const playerId = e.player_id as string;
        const color = gameStateRef.current?.players[playerId]?.color ?? "#ef4444";
        const manpowerPerUnit = unitManpowerMap?.artillery ?? 5;
        const artilleryAttack = unitConfigBySlug.artillery?.attack ?? 3.5;
        const rocketDmg = Math.ceil(manpowerPerUnit * artilleryAttack);

        const interceptedCount = (e.intercepted_count as number) ?? 0;
        const samRegionIds = (e.sam_region_ids as string[]) ?? [];

        if (interceptedCount > 0) {
          const isMyProvince = gameStateRef.current?.regions[targetId]?.owner_id === myUserId;
          if (isMyProvince) {
            toast.success(`SAM przechwycil ${interceptedCount} rakiet!`, { id: `sam-${targetId}`, duration: 3000 });
          } else if (playerId === myUserId) {
            toast.warning(`SAM wroga przechwycil ${interceptedCount} Twoich rakiet`, {
              id: `sam-${targetId}`,
              duration: 3000,
            });
          }
        }

        window.dispatchEvent(new CustomEvent("province-bombed", { detail: { regionId: targetId } }));

        const ROCKET_FLIGHT_MS = 1500;
        const visibleRockets = rocketCount;
        const SALVO_GAP_MS = 200;
        const PAIR_STAGGER_MS = 60;
        const rocketsThrough = rocketCount - interceptedCount;
        const killPerRocket = rocketsThrough > 0 ? Math.floor(totalKilled / rocketsThrough) : 0;
        let killRemainder = rocketsThrough > 0 ? totalKilled % rocketsThrough : 0;

        for (let i = 0; i < rocketsThrough; i++) {
          const salvoIdx = Math.floor(i / 2);
          const inPairIdx = i % 2;
          const delay = salvoIdx * SALVO_GAP_MS + inPairIdx * PAIR_STAGGER_MS;
          const landingTime = delay + ROCKET_FLIGHT_MS;

          newAnims.push({
            id: crypto.randomUUID(),
            sourceId,
            targetId,
            color,
            units: rocketDmg,
            unitCount: rocketDmg,
            unitType: "artillery",
            type: "attack" as const,
            startTime: Date.now() + delay,
            durationMs: ROCKET_FLIGHT_MS,
            playerId,
          });

          const thisRocketKill = killPerRocket + (killRemainder > 0 ? 1 : 0);
          if (killRemainder > 0) killRemainder--;
          if (thisRocketKill > 0) {
            const capturedKill = thisRocketKill;
            setTimeout(() => {
              window.dispatchEvent(
                new CustomEvent("bombard-damage", {
                  detail: { regionId: targetId, killed: capturedKill },
                }),
              );
            }, landingTime);
          }
        }

        if (interceptedCount > 0 && samRegionIds.length > 0) {
          for (let i = 0; i < interceptedCount; i++) {
            const samRegion = samRegionIds[i % samRegionIds.length];
            const interceptDelay = (rocketsThrough + i) * (SALVO_GAP_MS / 2);

            const artAnimId = crypto.randomUUID();
            newAnims.push({
              id: artAnimId,
              sourceId,
              targetId,
              color,
              units: rocketDmg,
              unitCount: rocketDmg,
              unitType: "artillery",
              type: "attack" as const,
              startTime: Date.now() + interceptDelay,
              durationMs: ROCKET_FLIGHT_MS,
              playerId,
            });

            const SAM_FLIGHT_MS = 600;
            const capturedArtId = artAnimId;
            const capturedSamRegion = samRegion;

            setTimeout(() => {
              window.dispatchEvent(
                new CustomEvent("sam-intercept-visual", {
                  detail: {
                    sourceId,
                    targetId,
                    samRegionId: capturedSamRegion,
                    flightMs: ROCKET_FLIGHT_MS,
                    samFlightMs: SAM_FLIGHT_MS,
                  },
                }),
              );
            }, interceptDelay);

            setTimeout(() => {
              setAnimations((prev) => prev.filter((a) => a.id !== capturedArtId));
              window.dispatchEvent(new CustomEvent("kill-animation", { detail: { animId: capturedArtId } }));
            }, interceptDelay + SAM_FLIGHT_MS);
          }
        }

        const lastLandingTime =
          Math.floor((visibleRockets - 1) / 2) * SALVO_GAP_MS +
          ((visibleRockets - 1) % 2) * PAIR_STAGGER_MS +
          ROCKET_FLIGHT_MS;
        setTimeout(() => {
          window.dispatchEvent(new CustomEvent("bombard-complete", { detail: { regionId: targetId } }));
        }, lastLandingTime + 500);
      } else if (e.type === "air_combat_resolved") {
        const flightId = e.flight_id as string;
        const bombersRemaining = (e.bombers_remaining as number) ?? 0;
        const interceptorsRemaining = (e.interceptors_remaining as number) ?? 0;
        const interceptorPlayerId = e.interceptor_player_id as string;

        if (bombersRemaining <= 0) {
          setAnimations((prev) => prev.filter((a) => a.id !== flightId && !a.id.startsWith(`${flightId}_escort`)));
        }
        setAnimations((prev) => prev.filter((a) => !a.id.startsWith(`${flightId}_int_`)));

        if (interceptorsRemaining > 0 && interceptorPlayerId) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const flight = gameStateRef.current?.air_transit_queue?.find((f: any) => f.id === flightId);
          const targetId = flight?.target_region_id ?? (e.target_region_id as string);
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const interceptorGroup = flight?.interceptors?.find((ig: any) => ig.player_id === interceptorPlayerId);
          const sourceId = interceptorGroup?.source_region_id;
          if (sourceId && targetId) {
            const intColor = gameStateRef.current?.players[interceptorPlayerId]?.color ?? "#3b82f6";
            const numReturn = Math.min(interceptorsRemaining, 4);
            const offsets = [-15, 15, -28, 28];
            for (let i = 0; i < numReturn; i++) {
              newAnims.push({
                id: `int_return_${crypto.randomUUID()}_${i}`,
                sourceId: targetId,
                targetId: sourceId,
                color: intColor,
                units: 1,
                unitCount: 1,
                unitType: "fighter",
                type: "move" as const,
                startTime: Date.now(),
                durationMs: 3000,
                playerId: interceptorPlayerId,
                pathOffset: offsets[i],
              });
            }
          }
        }

        const interceptorsLost = (e.interceptors_lost as number) ?? 0;
        const bombersLost = (e.bombers_lost as number) ?? 0;
        const escortsLost = (e.escorts_lost as number) ?? 0;
        if (interceptorPlayerId === myUserId) {
          toast.info(`Przechwycenie: stracono ${interceptorsLost} myśliwców, zniszczono ${bombersLost} bombowców`, {
            id: `game-air-intercept-${e.flight_id}`,
          });
        } else if (e.target_player_id === myUserId) {
          toast.warning(`Wróg przechwycił nalot: stracono ${escortsLost} eskort, ${bombersLost} bombowców`, {
            id: `game-air-intercepted-${e.flight_id}`,
          });
        }
      } else if (e.type === "path_damage") {
        const killed = (e.units_killed as number) ?? 0;
        const targetId = e.target_region_id as string;
        window.dispatchEvent(new CustomEvent("province-bombed", { detail: { regionId: targetId } }));
        window.dispatchEvent(new CustomEvent("path-damage-bomb", { detail: { regionId: targetId, killed } }));
        const regionName = gameStateRef.current?.regions[targetId]?.name ?? targetId;
        if (killed >= 3)
          toast.info(`Nalot na ${regionName}: -${killed} jednostek`, { id: `game-path-damage-${targetId}` });
      } else if (e.type === "bomber_strike") {
        const targetId = e.target_region_id as string;
        const playerId = e.player_id as string;
        window.dispatchEvent(new CustomEvent("province-bombed", { detail: { regionId: targetId } }));
        const groundKilled = (e.ground_units_destroyed as number) ?? 0;
        const neutralized = e.province_neutralized as boolean;
        const regionName = gameStateRef.current?.regions[targetId]?.name ?? targetId;
        if (groundKilled > 0)
          toast.info(`Bombardowanie ${regionName}: -${groundKilled} jednostek`, {
            id: `game-bomber-strike-${targetId}`,
          });
        if (neutralized)
          toast.info(`${regionName} zneutralizowana przez bombardowanie!`, {
            id: `game-bomber-neutralized-${targetId}`,
          });

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const completedFlight = gameStateRef.current?.air_transit_queue?.find(
          (f: any) => f.target_region_id === targetId && f.player_id === playerId && f.unit_type === "bomber",
        );
        const escortCount = completedFlight?.escort_fighters ?? (e.escorts_surviving as number) ?? 0;
        if (escortCount > 0) {
          const sourceId = completedFlight?.source_region_id ?? (e.source_region_id as string);
          if (sourceId) {
            const color = gameStateRef.current?.players[playerId]?.color ?? "#3b82f6";
            const numEscorts = Math.min(escortCount, 4);
            const offsets = [-18, 18, -32, 32];
            for (let ei = 0; ei < numEscorts; ei++) {
              newAnims.push({
                id: `escort_return_${crypto.randomUUID()}_${ei}`,
                sourceId: targetId,
                targetId: sourceId,
                color,
                units: 1,
                unitCount: 1,
                unitType: "fighter",
                type: "move" as const,
                startTime: Date.now(),
                durationMs: 4000,
                playerId,
                pathOffset: offsets[ei],
              });
            }
          }
        }
      } else if (e.type === "province_neutralized") {
        const regionId = e.region_id as string;
        const previousOwner = e.previous_owner_id as string;
        if (previousOwner === myUserId) {
          const regionName = gameStateRef.current?.regions[regionId]?.name ?? regionId;
          toast.error(`Stracono prowincję ${regionName} — zneutralizowana!`, {
            id: `game-province-neutralized-${regionId}`,
          });
        }
      } else if (e.type === "air_intercept_dispatched") {
        if ((e.interceptor_player_id as string) === myUserId) {
          toast.info("Myśliwce wysłane na przechwycenie!", { id: "game-intercept-dispatched" });
        }
      }
    }

    if (newAnims.length > 0) {
      setAnimations((prev) => [...prev, ...newAnims]);
    }
  }, [
    events,
    myUserId,
    unitsConfig,
    gameStateRef.current?.air_transit_queue?.find,
    gameStateRef.current?.meta?.tick_interval_ms,
    gameStateRef.current?.players,
    gameStateRef.current?.regions,
    localDispatchKeysRef.current.delete,
    localDispatchKeysRef.current.get,
    setAnimations,
    unitConfigBySlug,
    unitManpowerMap?.artillery,
  ]);
}
