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
      "W lewym gornym rogu widzisz: energie (zolta belka), punkty akcji (AP), liczbe regionow i sile armii. Stolica generuje energie i jednostki automatycznie co ture.",
    uiTarget: "hud",
    manualAdvance: true,
    tickMultiplier: 1,
  },

  // ── AP system ──
  {
    id: "ap_intro",
    title: "Punkty Akcji (AP)",
    description:
      "Kazda akcja kosztuje AP: atak 1\u20134 AP (zalezy od % wyslanych jednostek), budowa 1 AP, zdolnosc 3 AP. Masz max 15 AP i regenerujesz +1 co 2 tury. Planuj ruchy madrze!",
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
    description: "Wiecej regionow = wiecej jednostek i energii co ture. Zdobadz jeszcze kilka neutralnych regionow!",
    getHighlightRegions: (state, userId, neighborMap) => getNeutralNeighbors(state, userId, neighborMap).slice(0, 5),
    condition: (state, userId) => Object.values(state.regions).filter((r) => r.owner_id === userId).length >= 4,
    tickMultiplier: 3,
  },

  // ── Move units ──
  {
    id: "move_units",
    title: "Krok 5: Przenoszenie jednostek",
    description:
      "Mozesz przesuwac jednostki miedzy SWOIMI regionami. Kliknij region zrodlowy, potem kliknij sasiedni SWOJ region i wybierz 'Przenies'. Kosztuje tylko 1 AP \u2014 uzyj tego do wzmacniania granic!",
    manualAdvance: true,
    tickMultiplier: 1,
  },

  // ── Buildings ──
  {
    id: "buildings_explain",
    title: "Krok 6: Budynki",
    description:
      "Mozesz budowac budynki w swoich regionach. Kliknij swoj region \u2014 na dole ekranu pojawi sie panel akcji z sekcja 'Budynki'. Kazdy budynek kosztuje 1 AP.",
    manualAdvance: true,
    tickMultiplier: 1,
  },
  {
    id: "buildings_types",
    title: "Typy budynkow",
    description:
      "Koszary \u2014 przyspieszaja generowanie piechoty. Fabryka \u2014 produkuje czolgi. Wieza \u2014 bonus obronny i wizja. Elektrownia \u2014 wiecej energii. Port \u2014 produkuje okrety (wymaga wybrzeza). Lotnisko \u2014 produkuje mysliwce.",
    manualAdvance: true,
    tickMultiplier: 1,
  },
  {
    id: "build_action",
    title: "Zbuduj cos!",
    description:
      "Kliknij swoj region (podswietlony) \u2014 na dole pojawi sie panel akcji. Znajdz sekcje 'Budynki' i postaw dowolny budynek. Koszary sa najtansze!",
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

  // ── Unit production ──
  {
    id: "produce_unit",
    title: "Krok 7: Produkcja jednostek",
    description:
      "Piechota generuje sie automatycznie, ale mozesz tez produkowac specjalne jednostki! Zbuduj fabryke i wyprodukuj czolg \u2014 kliknij region z fabryka, na dole panelu znajdz sekcje 'Produkuj'. Czolgi maja 3x wieksza sile ataku niz piechota.",
    getHighlightRegions: (state, userId) => getOwnRegions(state, userId).slice(0, 3),
    condition: (state, userId) =>
      state.unit_queue.some((u) => u.player_id === userId) ||
      Object.values(state.regions).some(
        (r) =>
          r.owner_id === userId &&
          r.units &&
          Object.entries(r.units).some(([type, count]) => type !== "infantry" && count > 0),
      ),
    tickMultiplier: 3,
  },

  // ── Abilities: one by one ──
  {
    id: "abilities_intro",
    title: "Krok 8: Zdolnosci specjalne",
    description:
      "Po lewej stronie ekranu masz panel zdolnosci. Kazda kosztuje energie + 3 AP i ma cooldown. Uzyj kazdej po kolei zeby zobaczyc jak dzialaja!",
    uiTarget: "ability-bar",
    manualAdvance: true,
    tickMultiplier: 2,
  },
  {
    id: "ability_conscription",
    title: "Zdolnosc: Pobor",
    description:
      "Pobor zbiera 30% jednostek z neutralnych sasiadow do Twojego regionu. Kliknij ikone Poboru po lewej, a potem kliknij SWOJ region.",
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
      "Tarcza blokuje wszystkie ataki na wybrany region przez 20 tur. Kliknij ikone Tarczy, potem kliknij SWOJ region do ochrony.",
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
      "Wirus zabija 5% jednostek wroga co ture przez 15 tur i redukuje produkcje o 50%. Moze sie rozprzestrzenic! Kliknij ikone Wirusa, potem kliknij WROGI region.",
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
    title: "Zdolnosc: Zwiad",
    description: "Ujawnia ukryte jednostki wroga w wybranym regionie na 10 tur. Kliknij ikone, potem kliknij WROGI region.",
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
      "Najpotezniejsza zdolnosc! Niszczy 50 jednostek w regionie natychmiast. Kliknij ikone Nuke, potem kliknij WROGI region.",
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
    title: "Krok 9: Uwaga na wroga!",
    description:
      "Bot atakuje Twoje regiony! Pamietaj: obronca ma +10% bonusu w walce, a po kazdej bitwie jednostki sa zmeczone (mniejsza sila przez kilka tur). Buduj wieze obronne i trzymaj garnizon na granicach!",
    manualAdvance: true,
    tickMultiplier: 2,
  },

  // ── Final objective ──
  {
    id: "capture_capital",
    title: "Krok 10: Zdobadz stolice wroga!",
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
