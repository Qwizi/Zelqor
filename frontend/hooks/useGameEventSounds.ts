// ── Game event sounds & toasts ────────────────────────────────────────────────
// Extracted from game page — plays audio and shows toasts for game events.

import { useEffect, useRef } from "react";
import type { TroopAnimation } from "@/lib/gameTypes";
import { getEliminationVfx, getVictoryVfx } from "@/lib/animationConfig";
import { toast } from "sonner";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type GameEvent = Record<string, any>;

export function useGameEventSounds(
  events: GameEvent[],
  myUserId: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  gameStateRef: React.RefObject<any>,
  neighborMap: Record<string, string[]>,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  playSound: (key: any) => void,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  playJingle: (key: any) => void,
  setAnimations: React.Dispatch<React.SetStateAction<TroopAnimation[]>>,
  setNukeBlackout: React.Dispatch<React.SetStateAction<Array<{ rid: string; startTime: number }>>>,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  gameStatePlayers: any, // used only as dependency for re-running the effect
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
    for (const e of newEvents) { if (e.__eventKey) seen.add(e.__eventKey); }
    if (seen.size > 200) {
      const keep = new Set<string>();
      for (const e of events) { if (e.__eventKey) keep.add(e.__eventKey); }
      processedKeysRef.current = keep;
    }

    for (const e of newEvents) {
      if (e.type === "game_over") {
        const winnerId = e.winner_id as string;
        const winner = gameStateRef.current?.players[winnerId];
        if (winnerId === myUserId) {
          toast.success("Wygrales");
          playJingle("victory");
          const _victoryVfx = getVictoryVfx(gameStateRef.current?.players[myUserId]?.cosmetics);
          void _victoryVfx;
        } else {
          toast.error(`Przegrales. Wygrywa: ${winner?.username || "?"}`);
          playJingle("defeat");
        }
      }
      if (e.type === "player_eliminated" && e.player_id === myUserId) {
        if (e.reason === "disconnect_timeout") {
          toast.error("Zostales usuniety z meczu przez brak powrotu na czas");
        } else if (e.reason === "left_match") {
          toast.error("Opuściłeś mecz");
        } else {
          toast.error("Twoja stolica zostala zdobyta");
        }
        playJingle("elimination");
      }
      if (e.type === "player_eliminated" && e.player_id !== myUserId) {
        const eliminatedPlayer = gameStateRef.current?.players[String(e.player_id)];
        toast.info(`${eliminatedPlayer?.username || "Gracz"} został wyeliminowany`);
        void getEliminationVfx;
      }
      if (e.type === "player_disconnected" && e.player_id !== myUserId) {
        const disconnectedPlayer = gameStateRef.current?.players[String(e.player_id)];
        const graceSeconds = Number(e.grace_seconds || 0);
        toast.warning(`${disconnectedPlayer?.username || "Gracz"} rozlaczyl sie. Limit powrotu: ${graceSeconds}s`);
      }
      if (e.type === "build_started" && e.player_id === myUserId) {
        playSound("build");
      }
      if (e.type === "troops_sent") {
        const unitType = e.unit_type as string | undefined;
        const actionType = e.action_type as string | undefined;
        const targetRegionId = e.target_region_id as string | undefined;
        const attackerId = e.player_id as string | undefined;

        if (unitType === "fighter") playSound("plane_start");
        else playSound("click2");

        if (
          actionType === "attack" && attackerId !== myUserId &&
          targetRegionId && gameStateRef.current?.regions[targetRegionId]?.owner_id === myUserId
        ) {
          const attackerName = gameStateRef.current?.players[attackerId ?? ""]?.username ?? "Wróg";
          const regionName = gameStateRef.current?.regions[targetRegionId]?.name ?? targetRegionId;
          playSound("alert");
          toast.warning(`⚔️ ${attackerName} atakuje ${regionName}!`, { duration: 5000 });
        }
      }
      if (e.type === "attack_success" && e.player_id !== myUserId) {
        const targetRegionId = e.target_region_id as string | undefined;
        if (targetRegionId && gameStateRef.current?.regions[targetRegionId]?.owner_id === myUserId) {
          playSound("missile_explosion");
        }
      }
      if (e.type === "ability_used") {
        const soundKey = e.sound_key as string | undefined;
        const abilityName = e.ability_type as string;
        const isMyAbility = e.player_id === myUserId;
        const isNuke = abilityName === "ab_province_nuke";
        if (!isNuke) {
          const abilitySounds: Record<string, string> = {
            virus: "virus", submarine: "submarine", shield: "shield", quick_gain: "quick_gain",
          };
          if (soundKey && abilitySounds[soundKey]) {
            playSound(abilitySounds[soundKey]);
          }
        }
        if (isMyAbility) {
          toast.success(`Uzyto: ${abilityName}`);
        } else {
          const attackerName = gameStateRef.current?.players[String(e.player_id)]?.username ?? "Wrog";
          toast.warning(`${attackerName} uzyl zdolnosci: ${abilityName}`);
        }
        if (isNuke) {
          const casterId = e.player_id as string;
          const casterCapital = gameStateRef.current?.players[casterId]?.capital_region_id;
          const targetId = e.target_region_id as string;
          if (casterCapital && targetId && casterCapital !== targetId) {
            const color = gameStateRef.current?.players[casterId]?.color ?? "#ef4444";
            playSound("nuke");
            setTimeout(() => playSound("nuke_explosion"), 8000);
            setAnimations((prev) => [...prev, {
              id: `nuke-${crypto.randomUUID()}`,
              sourceId: casterCapital, targetId, color,
              units: 0, unitType: "nuke_rocket",
              type: "attack" as const, startTime: Date.now(), durationMs: 8000,
            }]);
            setTimeout(() => {
              setNukeBlackout((prev) => {
                const targetNeighbors = neighborMap[targetId] || [];
                const allAffected = [targetId, ...targetNeighbors];
                return [...prev, ...allAffected.map((rid) => ({ rid, startTime: Date.now() }))];
              });
            }, 8000);
          }
        }
      }
      if (e.type === "shield_blocked") {
        const targetRegionName = gameStateRef.current?.regions[String(e.target_region_id)]?.name ?? "region";
        if (e.attacker_id === myUserId) {
          toast.error(`Atak na ${targetRegionName} zostal zablokowany przez tarcze!`);
          playSound("shield");
        } else {
          const targetOwner = gameStateRef.current?.regions[String(e.target_region_id)]?.owner_id;
          if (targetOwner === myUserId) {
            toast.success(`Tarcza ochronila ${targetRegionName}!`);
            playSound("shield");
          }
        }
      }
      if (e.type === "bombard") playSound("missile_explosion");
      if (e.type === "aoe_damage") playSound("missile_explosion");
      if (e.type === "air_mission_launched") playSound("plane_start");
      if (e.type === "air_combat_resolved") playSound("missile_explosion");
      if (e.type === "flash_effect") {
        playSound("alert");
        if (e.affected_region_ids && Array.isArray(e.affected_region_ids)) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const myRegions = Object.entries(gameStateRef.current?.regions ?? {} as Record<string, any>)
            .filter(([, r]: [string, any]) => r.owner_id === myUserId).map(([id]: [string, any]) => id);
          const affectedMine = (e.affected_region_ids as string[]).some(id => myRegions.includes(id));
          if (affectedMine) toast.error("Flara oślepiająca! Prowincje zaciemnione!");
        }
      }
      if (e.type === "ability_effect_expired") {
        const effectType = e.effect_type as string;
        const targetRegionName = gameStateRef.current?.regions[String(e.target_region_id)]?.name ?? "region";
        if (effectType === "ab_shield") {
          const regionOwner = gameStateRef.current?.regions[String(e.target_region_id)]?.owner_id;
          if (regionOwner === myUserId) toast.info(`Tarcza na ${targetRegionName} wygasla`);
        }
      }
      if (e.type === "action_rejected" && e.player_id === myUserId) {
        toast.error(String(e.message ?? "Akcja zostala odrzucona"));
        playSound("fail");
      }
      if (e.type === "server_error") toast.error(e.message as string);

      // Diplomacy events
      if (e.type === "war_declared") {
        const aggressorId = e.aggressor_id as string;
        const aggressorName = gameStateRef.current?.players[aggressorId]?.username ?? "Gracz";
        if (aggressorId !== myUserId) {
          toast.error(`⚔️ Wojna z ${aggressorName}!`, { duration: 6000 });
        } else {
          const targetId = (e.player_a === myUserId ? e.player_b : e.player_a) as string;
          const targetName = gameStateRef.current?.players[targetId]?.username ?? "Gracz";
          toast.warning(`⚔️ Wypowiedziałeś wojnę graczowi ${targetName}!`, { duration: 6000 });
        }
      }
      if (e.type === "pact_proposed") {
        const fromId = e.from_player_id as string;
        if (fromId !== myUserId) {
          const fromName = gameStateRef.current?.players[fromId]?.username ?? "Gracz";
          toast.info(`🤝 ${fromName} proponuje pakt o nieagresji`, { duration: 6000 });
        }
      }
      if (e.type === "pact_accepted") {
        const fromId = e.from_player_id as string;
        const toId = e.to_player_id as string;
        const otherId = fromId === myUserId ? toId : fromId;
        const otherName = gameStateRef.current?.players[otherId]?.username ?? "Gracz";
        if (fromId === myUserId || toId === myUserId) toast.success(`✅ Pakt zaakceptowany z ${otherName}`, { duration: 5000 });
      }
      if (e.type === "pact_broken") {
        const breakerId = e.breaker_id as string;
        if (breakerId !== myUserId) {
          const breakerName = gameStateRef.current?.players[breakerId]?.username ?? "Gracz";
          toast.error(`❌ ${breakerName} zerwał pakt!`, { duration: 6000 });
        }
      }
      if (e.type === "peace_proposed") {
        const fromId = e.from_player_id as string;
        if (fromId !== myUserId) {
          const fromName = gameStateRef.current?.players[fromId]?.username ?? "Gracz";
          toast.info(`🕊️ ${fromName} proponuje pokój`, { duration: 6000 });
        }
      }
      if (e.type === "peace_accepted") {
        const fromId = e.from_player_id as string;
        const toId = e.to_player_id as string;
        const otherId = fromId === myUserId ? toId : fromId;
        const otherName = gameStateRef.current?.players[otherId]?.username ?? "Gracz";
        if (fromId === myUserId || toId === myUserId) toast.success(`✅ Pokój zawarty z ${otherName}`, { duration: 5000 });
      }
      if (e.type === "peace_rejected") {
        const fromId = e.from_player_id as string;
        const toId = e.to_player_id as string;
        if (fromId === myUserId) {
          const otherName = gameStateRef.current?.players[toId]?.username ?? "Gracz";
          toast.error(`❌ ${otherName} odrzucił propozycję pokoju`, { duration: 5000 });
        }
        if (toId === myUserId) {
          const otherName = gameStateRef.current?.players[fromId]?.username ?? "Gracz";
          toast.info(`Odrzucono propozycję pokoju od ${otherName}`, { duration: 3000 });
        }
      }
      if (e.type === "pact_rejected") {
        const fromId = e.from_player_id as string;
        const toId = e.to_player_id as string;
        if (fromId === myUserId) {
          const otherName = gameStateRef.current?.players[toId]?.username ?? "Gracz";
          toast.error(`❌ ${otherName} odrzucił propozycję paktu`, { duration: 5000 });
        }
      }
      if (e.type === "pact_expired") {
        const pa = e.player_a as string;
        const pb = e.player_b as string;
        if (pa === myUserId || pb === myUserId) {
          const otherId = pa === myUserId ? pb : pa;
          const otherName = gameStateRef.current?.players[otherId]?.username ?? "Gracz";
          toast.warning(`Pakt o nieagresji z ${otherName} wygasł`, { duration: 5000 });
        }
      }
      if (e.type === "proposal_expired") {
        const fromId = e.from_player_id as string;
        const toId = e.to_player_id as string;
        const proposalType = e.proposal_type as string;
        const label = proposalType === "peace" ? "pokoju" : "paktu";
        if (fromId === myUserId) {
          const otherName = gameStateRef.current?.players[toId]?.username ?? "Gracz";
          toast.warning(`Propozycja ${label} do ${otherName} wygasła`, { duration: 4000 });
        }
        if (toId === myUserId) {
          const otherName = gameStateRef.current?.players[fromId]?.username ?? "Gracz";
          toast.info(`Propozycja ${label} od ${otherName} wygasła`, { duration: 4000 });
        }
      }
      if (e.type === "capital_protected") {
        const ticksRemaining = e.ticks_remaining as number;
        if (e.player_id === myUserId) {
          toast.info(`🛡️ Stolica chroniona! Pozostało ${ticksRemaining} tur`, { duration: 4000 });
        }
      }
    }
  }, [events, myUserId, neighborMap, gameStatePlayers, playSound]);
}
