import type { GameState } from "@/hooks/useGameSocket";

export interface TutorialStep {
  id: string;
  title: string;
  description: string;
  /** Return region IDs to highlight with red dashed border on the map */
  getHighlightRegions?: (state: GameState, userId: string, neighborMap: Record<string, string[]>) => string[];
  /** data-tutorial attribute to point red indicator at (UI elements) */
  uiTarget?: string;
  /** Only this ability slug is clickable during this step (others locked) */
  allowedAbility?: string;
  /** Check if the step's condition is met to auto-advance */
  condition?: (state: GameState, userId: string) => boolean;
  /** Tick multiplier to apply when entering this step */
  tickMultiplier?: number;
  /** If true, show a "Dalej" (Next) button instead of waiting for condition */
  manualAdvance?: boolean;
}

/** Get unowned neighbor region IDs of regions owned by userId */
function getNeutralNeighbors(state: GameState, userId: string, neighborMap: Record<string, string[]>): string[] {
  const result: string[] = [];
  for (const [rid, region] of Object.entries(state.regions)) {
    if (region.owner_id !== userId) continue;
    const neighbors = neighborMap[rid] ?? [];
    for (const nid of neighbors) {
      const nr = state.regions[nid];
      if (nr && !nr.owner_id && !result.includes(nid)) {
        result.push(nid);
      }
    }
  }
  return result;
}

/** Get the enemy bot's capital region ID */
function getEnemyCapital(state: GameState, userId: string): string | null {
  for (const [, player] of Object.entries(state.players)) {
    if (player.user_id !== userId && player.is_alive && player.capital_region_id) {
      return player.capital_region_id;
    }
  }
  return null;
}

/** Get player's own region IDs */
function getOwnRegions(state: GameState, userId: string): string[] {
  return Object.entries(state.regions)
    .filter(([, r]) => r.owner_id === userId)
    .map(([id]) => id);
}

/** Get enemy (bot) region IDs */
function getEnemyRegions(state: GameState, userId: string): string[] {
  return Object.entries(state.regions)
    .filter(([, r]) => r.owner_id !== null && r.owner_id !== userId)
    .map(([id]) => id);
}

export const TUTORIAL_STEPS: TutorialStep[] = [
  // ── Intro ──
  {
    id: "welcome",
    title: "Witaj w MapLord!",
    description:
      "Samouczek nauczy Cie podstaw gry. Grasz 1v1 przeciwko slabemu botowi \u2014 poprowadze Cie krok po kroku.",
    manualAdvance: true,
    tickMultiplier: 1,
  },

  // ── Capital selection ──
  {
    id: "select_capital",
    title: "Krok 1: Wybierz stolice",
    description:
      "Kliknij na dowolny region na mapie. To bedzie Twoja stolica \u2014 najwazniejszy region w grze. Stracisz go = przegrywasz!",
    condition: (state, userId) => !!state.players[userId]?.capital_region_id,
    tickMultiplier: 1,
  },

  // ── Economy ──
  {
    id: "economy_intro",
    title: "Krok 2: Zasoby",
    description:
      "W lewym gornym rogu widzisz: walute (zloto), liczbe regionow i jednostki. Stolica generuje je automatycznie co ture.",
    uiTarget: "hud",
    manualAdvance: true,
    tickMultiplier: 1,
  },

  // ── First attack ──
  {
    id: "attack_neutral",
    title: "Krok 3: Pierwszy atak",
    description:
      "Kliknij na swoj region (kolorowy), potem na sasiedni szary region (podswietlony czerwona ramka). Ustaw ilosc jednostek i potwierdz atak!",
    getHighlightRegions: (state, userId, neighborMap) => getNeutralNeighbors(state, userId, neighborMap).slice(0, 3),
    condition: (state, userId) => Object.values(state.regions).filter((r) => r.owner_id === userId).length >= 2,
    tickMultiplier: 2,
  },

  // ── Expand ──
  {
    id: "expand",
    title: "Krok 4: Rozszerzaj terytorium",
    description: "Wiecej regionow = wiecej jednostek i waluty co ture. Zdobadz jeszcze kilka neutralnych regionow!",
    getHighlightRegions: (state, userId, neighborMap) => getNeutralNeighbors(state, userId, neighborMap).slice(0, 5),
    condition: (state, userId) => Object.values(state.regions).filter((r) => r.owner_id === userId).length >= 4,
    tickMultiplier: 3,
  },

  // ── Buildings ──
  {
    id: "buildings_explain",
    title: "Krok 5: Budynki",
    description:
      "Mozesz budowac budynki w swoich regionach. Kliknij swoj region \u2014 po prawej pojawi sie panel z opcjami budowy.",
    manualAdvance: true,
    tickMultiplier: 1,
  },
  {
    id: "buildings_types",
    title: "Typy budynkow",
    description:
      "Koszary \u2014 przyspieszaja generowanie piechoty. Fabryka \u2014 produkuje czolgi. Wieza obronna \u2014 bonus obronny. Elektrownia \u2014 wiecej waluty. Port \u2014 okrety (wymaga wybrzeza). Lotnisko \u2014 mysliwce.",
    manualAdvance: true,
    tickMultiplier: 1,
  },
  {
    id: "build_action",
    title: "Zbuduj cos!",
    description:
      "Kliknij swoj region (podswietlony), otworz panel po prawej i postaw dowolny budynek. Koszary sa najtansze!",
    uiTarget: "build-section",
    getHighlightRegions: (state, userId) => getOwnRegions(state, userId).slice(0, 3),
    condition: (state, userId) =>
      state.buildings_queue.some((b) => b.player_id === userId) ||
      Object.values(state.regions).some(
        (r) => r.owner_id === userId && r.buildings && Object.values(r.buildings).some((v) => v > 0),
      ),
    tickMultiplier: 2,
  },
  {
    id: "build_wait",
    title: "Budowanie w toku...",
    description: "Budynek jest w budowie! Przyspieszam czas \u2014 poczekaj chwile az zostanie ukonczony.",
    condition: (state, userId) =>
      Object.values(state.regions).some(
        (r) => r.owner_id === userId && r.buildings && Object.values(r.buildings).some((v) => v > 0),
      ),
    tickMultiplier: 5,
  },

  // ── Abilities: one by one ──
  {
    id: "abilities_intro",
    title: "Krok 6: Zdolnosci specjalne",
    description:
      "Po lewej stronie ekranu masz panel zdolnosci. Kazda kosztuje walute i ma cooldown. Uzyj kazdej po kolei zeby zobaczyc jak dzialaja!",
    uiTarget: "ability-bar",
    manualAdvance: true,
    tickMultiplier: 2,
  },
  {
    id: "ability_conscription",
    title: "Zdolnosc: Pobor",
    description:
      "Pobor zbiera procent jednostek z neutralnych sasiadow do Twojego regionu. Kliknij ikone Poboru po lewej, a potem kliknij SWOJ region.",
    uiTarget: "ability-bar",
    allowedAbility: "ab_conscription_point",
    condition: (state, userId) => {
      const cd = state.players[userId]?.ability_cooldowns ?? {};
      return (cd.ab_conscription_point ?? 0) > 0;
    },
    tickMultiplier: 2,
  },
  {
    id: "ability_shield",
    title: "Zdolnosc: Tarcza",
    description:
      "Tarcza blokuje wszystkie ataki na wybrany region przez kilka tur. Kliknij ikone Tarczy, potem kliknij SWOJ region do ochrony.",
    uiTarget: "ability-bar",
    allowedAbility: "ab_shield",
    condition: (state, userId) => {
      const cd = state.players[userId]?.ability_cooldowns ?? {};
      return (cd.ab_shield ?? 0) > 0;
    },
    tickMultiplier: 2,
  },
  {
    id: "ability_virus",
    title: "Zdolnosc: Wirus",
    description:
      "Wirus zabija jednostki wroga i redukuje jego produkcje. Kliknij ikone Wirusa, potem kliknij WROGI region (czerwony).",
    uiTarget: "ability-bar",
    allowedAbility: "ab_virus",
    getHighlightRegions: (state, userId) => getEnemyRegions(state, userId).slice(0, 3),
    condition: (state, userId) => {
      const cd = state.players[userId]?.ability_cooldowns ?? {};
      return (cd.ab_virus ?? 0) > 0;
    },
    tickMultiplier: 2,
  },
  {
    id: "ability_submarine",
    title: "Zdolnosc: Okret podwodny",
    description: "Ujawnia jednostki wroga w wybranym regionie na kilka tur. Kliknij ikone, potem kliknij WROGI region.",
    uiTarget: "ability-bar",
    allowedAbility: "ab_pr_submarine",
    getHighlightRegions: (state, userId) => getEnemyRegions(state, userId).slice(0, 3),
    condition: (state, userId) => {
      const cd = state.players[userId]?.ability_cooldowns ?? {};
      return (cd.ab_pr_submarine ?? 0) > 0;
    },
    tickMultiplier: 2,
  },
  {
    id: "abilities_nuke",
    title: "Zdolnosc: Nuke",
    description:
      "Najpotezniejsza zdolnosc! Niszczy prawie wszystkie jednostki w regionie. Kliknij ikone Nuke, potem kliknij WROGI region.",
    uiTarget: "ability-bar",
    allowedAbility: "ab_province_nuke",
    getHighlightRegions: (state, userId) => getEnemyRegions(state, userId).slice(0, 3),
    condition: (state, userId) => {
      const cd = state.players[userId]?.ability_cooldowns ?? {};
      return (cd.ab_province_nuke ?? 0) > 0;
    },
    tickMultiplier: 3,
  },

  // ── Enemy attack warning ──
  {
    id: "enemy_attack",
    title: "Krok 7: Uwaga na wroga!",
    description: "Bot atakuje Twoje regiony. Utrzymuj garnizon na granicach i buduj wieze obronne!",
    manualAdvance: true,
    tickMultiplier: 2,
  },

  // ── Final objective ──
  {
    id: "capture_capital",
    title: "Krok 8: Zdobadz stolice wroga!",
    description: "Znajdz stolice bota (region z zoltym obrysem/gwiazdka) i wyslij duza armie! To konczy gre.",
    getHighlightRegions: (state, userId) => {
      const cap = getEnemyCapital(state, userId);
      return cap ? [cap] : [];
    },
    condition: (state) => state.meta.status === "finished",
    tickMultiplier: 3,
  },

  // ── Victory ──
  {
    id: "victory",
    title: "Gratulacje!",
    description:
      "Wygrales samouczek! Znasz podstawy \u2014 dolacz do kolejki na dashboardzie i zmierz sie z prawdziwymi graczami.",
    manualAdvance: true,
    tickMultiplier: 1,
  },
];
