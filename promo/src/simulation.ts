/**
 * Deterministic game simulation for promo video.
 * 4 players, territory expansion, unit movement, artillery, diplomacy.
 */
import provinceData from "../public/provinces_simple.json";

const { provinces } = provinceData;

const neighborMap: Record<number, number[]> = {};
for (const p of provinces) {
  neighborMap[p.id] = p.neighbors;
}

export interface TroopMovement {
  fromId: number;
  toId: number;
  playerIdx: number;
  units: number;
  /** 0 = just started, 1 = arrived */
  progress: number;
  type: "attack" | "move";
}

export interface ArtilleryShot {
  fromId: number;
  toId: number;
  playerIdx: number;
  /** 0 = fired, 1 = impact */
  progress: number;
}

export interface SimState {
  ownership: Record<number, number>;
  units: Record<number, number>;
  capitals: number[];
  wars: [number, number][];
  pacts: [number, number][];
  troops: TroopMovement[];
  artillery: ArtilleryShot[];
  /** Currently "selected" province for action panel display */
  selectedProvince: number | null;
  /** Events happening this tick */
  events: string[];
}

export interface SimSnapshot extends SimState {
  tick: number;
  playerRegions: number[];
  playerUnits: number[];
  playerAlive: boolean[];
  energy: number;
}

// Seeded random for determinism
function seededRandom(seed: number): number {
  const x = Math.sin(seed * 9301 + 49297) * 49297;
  return x - Math.floor(x);
}

function expandFrom(
  provinceId: number,
  playerIdx: number,
  ownership: Record<number, number>,
  count: number,
  seed: number,
): number[] {
  const claimed: number[] = [];
  const queue = [provinceId];
  const visited = new Set<number>([provinceId]);

  while (queue.length > 0 && claimed.length < count) {
    const current = queue.shift()!;
    const neighbors = neighborMap[current] || [];
    const shuffled = [...neighbors].sort(
      (a, b) => seededRandom(a + seed) - seededRandom(b + seed),
    );

    for (const nid of shuffled) {
      if (visited.has(nid)) continue;
      visited.add(nid);
      if (!(nid in ownership)) {
        ownership[nid] = playerIdx;
        claimed.push(nid);
        if (claimed.length >= count) break;
      }
      queue.push(nid);
    }
  }
  return claimed;
}

/**
 * Generate a simulation snapshot for a given tick.
 *
 * 4 players starting from different corners of the map.
 * Timeline:
 * - 0-20:    Setup, capitals appear
 * - 20-100:  Rapid neutral expansion
 * - 100-180: Borders form, contact
 * - 180-250: War between P0-P1, NAP between P0-P2
 * - 250-350: Multiple wars, troop movements, artillery
 * - 350-420: Endgame — dominance
 */
export function simulate(tick: number): SimSnapshot {
  const ownership: Record<number, number> = {};
  const units: Record<number, number> = {};
  const troops: TroopMovement[] = [];
  const artillery: ArtilleryShot[] = [];
  let wars: [number, number][] = [];
  let pacts: [number, number][] = [];
  const events: string[] = [];

  // 4 players starting from spread positions
  const capitalArrayIdx = [0, 36, 72, 108];
  const capitalIds = capitalArrayIdx.map((i) => provinces[Math.min(i, provinces.length - 1)]?.id ?? 1);
  const capitals = [...capitalIds];

  // Init
  for (let i = 0; i < 4; i++) {
    ownership[capitalIds[i]] = i;
    units[capitalIds[i]] = 10;
  }

  // Simulate ticks
  for (let t = 0; t <= tick; t++) {
    // Phase 1 (t < 250): Normal expansion — all players expand, Qwizi faster
    if (t < 250) {
      let rate = 0;
      if (t >= 20 && t < 80) rate = 3;
      else if (t >= 80 && t < 150) rate = 1.5;
      else if (t >= 150) rate = 0.5;

      if (rate >= 1 || (rate > 0 && t % Math.round(1 / rate) === 0)) {
        for (let p = 0; p < 4; p++) {
          const playerRate = p === 0 ? Math.ceil(rate * 1.8) : Math.max(1, Math.floor(rate));
          const ownedIds = Object.entries(ownership)
            .filter(([, owner]) => owner === p)
            .map(([id]) => Number(id));
          if (ownedIds.length === 0) continue;
          const borderIdx = Math.floor(seededRandom(t * 7 + p * 31) * ownedIds.length);
          expandFrom(ownedIds[borderIdx], p, ownership, playerRate, t + p * 100);
        }
      }
    }

    // Phase 2 (t >= 280): Qwizi slowly conquers — gradual takeover
    // Rate ramps up over time so map is ~100% red only at tick ~480
    // Timeline: 280-350: slow (1/tick), 350-400: medium (2/tick), 400-450: fast (3/tick), 450+: sweep (5/tick)
    if (t >= 280) {
      const conquestRate = t >= 450 ? 5 : t >= 400 ? 3 : t >= 350 ? 2 : 1;
      const qwiziIds = new Set(
        Object.entries(ownership).filter(([, o]) => o === 0).map(([id]) => Number(id))
      );
      const enemyProvs = Object.entries(ownership)
        .filter(([, o]) => o !== 0)
        .map(([id]) => Number(id));
      if (enemyProvs.length > 0) {
        for (let c = 0; c < conquestRate; c++) {
          // Prefer neighbor-based (looks like natural expansion)
          const borderTargets = enemyProvs.filter((eid) =>
            (neighborMap[eid] || []).some((nid) => qwiziIds.has(nid))
          );
          if (borderTargets.length > 0) {
            const idx = Math.floor(seededRandom(t * 3 + c * 17) * borderTargets.length);
            const taken = borderTargets[idx];
            ownership[taken] = 0;
            qwiziIds.add(taken);
            enemyProvs.splice(enemyProvs.indexOf(taken), 1);
          } else if (t >= 320) {
            // Cross-ocean invasion only after tick 320 (gives time for land expansion first)
            const idx = Math.floor(seededRandom(t * 5 + c * 23) * enemyProvs.length);
            const taken = enemyProvs[idx];
            ownership[taken] = 0;
            qwiziIds.add(taken);
            enemyProvs.splice(idx, 1);
          }
          if (enemyProvs.length === 0) break;
        }
      }
    }

    // Unit generation
    if (t >= 15 && t % 2 === 0) {
      for (const [idStr, owner] of Object.entries(ownership)) {
        const id = Number(idStr);
        const isCapital = capitalIds.includes(id);
        const current = units[id] || 0;
        units[id] = current + (isCapital ? 4 : 1);
      }
    }
  }

  // Diplomacy
  if (tick >= 180 && tick < 300) {
    wars = [[0, 1], [2, 3]];
    pacts = [[0, 2]];
    if (tick >= 180) events.push("war_declared");
  } else if (tick >= 300 && tick < 350) {
    wars = [[0, 3]];
    pacts = [[0, 1], [2, 3]];
    if (tick >= 300 && tick < 305) events.push("peace_accepted");
  } else if (tick >= 350) {
    wars = [[0, 1], [0, 3], [2, 1]];
    pacts = [];
    if (tick >= 350 && tick < 355) events.push("pact_broken");
  }

  // (dominance is now inside the main simulation loop above)

  // Troop movements — generate deterministic animated troops
  if (tick >= 100) {
    const movePeriod = 20; // new movement wave every 20 ticks
    const phase = tick % movePeriod;
    const wave = Math.floor(tick / movePeriod);

    // Generate a few troop movements per wave
    for (let p = 0; p < 4; p++) {
      const ownedIds = Object.entries(ownership)
        .filter(([, owner]) => owner === p)
        .map(([id]) => Number(id));
      if (ownedIds.length < 2) continue;

      // Pick source and target based on wave
      const srcIdx = Math.floor(seededRandom(wave * 13 + p * 7) * ownedIds.length);
      const srcId = ownedIds[srcIdx];
      const neighbors = neighborMap[srcId] || [];
      if (neighbors.length === 0) continue;

      const tgtIdx = Math.floor(seededRandom(wave * 17 + p * 11) * neighbors.length);
      const tgtId = neighbors[tgtIdx];
      const isAttack = ownership[tgtId] !== p;

      troops.push({
        fromId: srcId,
        toId: tgtId,
        playerIdx: p,
        units: Math.floor(seededRandom(wave + p) * 50) + 20,
        progress: Math.min(1, phase / (movePeriod - 1)),
        type: isAttack ? "attack" : "move",
      });
    }
  }

  // Artillery — only between nearby provinces (max range 3 hops via neighbor graph)
  if (tick >= 200) {
    const artPeriod = 15;
    const artPhase = tick % artPeriod;
    const artWave = Math.floor(tick / artPeriod);

    for (const [a, b] of wars) {
      const aOwned = Object.entries(ownership)
        .filter(([, o]) => o === a)
        .map(([id]) => Number(id));
      if (aOwned.length === 0) continue;

      // Find a border province owned by 'a' that has an enemy neighbor within 3 hops
      const srcIdx = Math.floor(seededRandom(artWave * 23 + a * 3) * aOwned.length);
      const srcId = aOwned[srcIdx];

      // BFS up to 3 hops to find enemy province
      let targetId: number | null = null;
      const visited = new Set<number>([srcId]);
      let frontier = [srcId];
      for (let hop = 0; hop < 3 && !targetId; hop++) {
        const next: number[] = [];
        for (const fid of frontier) {
          for (const nid of (neighborMap[fid] || [])) {
            if (visited.has(nid)) continue;
            visited.add(nid);
            if (ownership[nid] === b) {
              targetId = nid;
              break;
            }
            next.push(nid);
          }
          if (targetId) break;
        }
        frontier = next;
      }

      if (targetId != null) {
        artillery.push({
          fromId: srcId,
          toId: targetId,
          playerIdx: a,
          progress: Math.min(1, artPhase / (artPeriod - 2)),
        });
      }
    }
  }

  // Selected province for action panel — show at specific tick ranges
  let selectedProvince: number | null = null;
  if (tick >= 60 && tick < 120) {
    // Show player 0's capital selected
    selectedProvince = capitalIds[0];
  } else if (tick >= 200 && tick < 240) {
    // Show a border province selected during war
    const p0Owned = Object.entries(ownership)
      .filter(([, o]) => o === 0)
      .map(([id]) => Number(id));
    if (p0Owned.length > 5) {
      selectedProvince = p0Owned[Math.floor(p0Owned.length * 0.7)];
    }
  }

  // Stats
  const playerRegions = [0, 0, 0, 0];
  const playerUnits = [0, 0, 0, 0];
  for (const [idStr, owner] of Object.entries(ownership)) {
    playerRegions[owner]++;
    playerUnits[owner] += units[Number(idStr)] || 0;
  }
  // Players are dead when they have 0 regions
  const playerAlive = playerRegions.map((r) => r > 0);

  return {
    ownership,
    units,
    capitals,
    wars,
    pacts,
    troops,
    artillery,
    selectedProvince,
    events,
    tick,
    playerRegions,
    playerUnits,
    playerAlive,
    energy: Math.min(120 + tick * 2, 9999),
  };
}

export { provinces, neighborMap };
