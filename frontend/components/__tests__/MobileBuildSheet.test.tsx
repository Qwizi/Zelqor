import { fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Mock next/image
// ---------------------------------------------------------------------------

vi.mock("next/image", () => ({
  default: ({
    src,
    alt,
    width,
    height,
    className,
  }: {
    src: string;
    alt: string;
    width?: number;
    height?: number;
    className?: string;
  }) => React.createElement("img", { src, alt, width, height, className }),
}));

// ---------------------------------------------------------------------------
// Mock gameAssets
// ---------------------------------------------------------------------------

vi.mock("@/lib/gameAssets", () => ({
  getActionAsset: (action: string) => `/assets/icons/${action}.webp`,
  getPlayerBuildingAsset: (slug: string) => `/assets/buildings/${slug}.webp`,
  getPlayerUnitAsset: (kind: string) => `/assets/units/${kind}.webp`,
}));

// ---------------------------------------------------------------------------
// Mock lucide-react
// ---------------------------------------------------------------------------

vi.mock("lucide-react", () => ({
  Lock: ({ className }: { className?: string }) =>
    React.createElement("span", { "data-testid": "icon-lock", className }),
}));

import MobileBuildSheet from "@/components/game/MobileBuildSheet";
import type { BuildingQueueItem, GameRegion } from "@/hooks/useGameSocket";
import type { BuildingType, UnitType } from "@/lib/api";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeRegion(overrides: Partial<GameRegion> = {}): GameRegion {
  return {
    name: "Test Region",
    country_code: "PL",
    owner_id: "user-1",
    unit_count: 10,
    is_coastal: false,
    is_capital: false,
    building_type: null,
    buildings: {},
    building_instances: [],
    defense_bonus: 0,
    ...overrides,
  };
}

function makeBuilding(overrides: Partial<BuildingType> = {}): BuildingType {
  return {
    id: "b1",
    name: "Koszary",
    slug: "barracks",
    asset_key: "barracks",
    asset_url: null,
    description: "Test building",
    icon: "",
    cost: 0,
    energy_cost: 50,
    build_time_ticks: 5,
    max_per_region: 2,
    requires_coastal: false,
    defense_bonus: 0,
    vision_range: 0,
    unit_generation_bonus: 0,
    energy_generation_bonus: 0,
    order: 1,
    max_level: 3,
    level_stats: {},
    ...overrides,
  };
}

function makeUnit(overrides: Partial<UnitType> = {}): UnitType {
  return {
    id: "u1",
    name: "Piechota",
    slug: "infantry",
    asset_key: "infantry",
    asset_url: null,
    description: "",
    icon: "",
    attack: 10,
    defense: 5,
    speed: 1,
    attack_range: 1,
    sea_range: 0,
    sea_hop_distance_km: 0,
    movement_type: "ground",
    produced_by_slug: "barracks",
    production_cost: 30,
    production_time_ticks: 3,
    manpower_cost: 1,
    order: 1,
    max_level: 1,
    level_stats: {},
    is_stealth: false,
    path_damage: 0,
    aoe_damage: 0,
    blockade_port: false,
    intercept_air: false,
    can_station_anywhere: false,
    lifetime_ticks: 0,
    combat_target: "ground",
    ticks_per_hop: 1,
    air_speed_ticks_per_hop: 1,
    ...overrides,
  };
}

const defaultProps = {
  region: makeRegion(),
  regionId: "r1",
  myEnergy: 200,
  buildings: [makeBuilding()],
  buildingQueue: [] as BuildingQueueItem[],
  units: [makeUnit()],
  onBuild: vi.fn(),
  onProduceUnit: vi.fn(),
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("MobileBuildSheet", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders nothing when no build options and no produce options", () => {
    // Building max_per_region=1 and region already has 1 → no build options
    // No units provided → no produce options
    const region = makeRegion({ buildings: { barracks: 1 } });
    const building = makeBuilding({ max_per_region: 1 });
    const { container } = render(
      React.createElement(MobileBuildSheet, {
        ...defaultProps,
        region,
        buildings: [building],
        units: [], // no units → no produce options
      }),
    );
    expect(container.firstChild).toBeNull();
  });

  it("renders the build action button when build options exist", () => {
    render(React.createElement(MobileBuildSheet, defaultProps));
    const buildBtn = screen.getByTitle("Buduj");
    expect(buildBtn).toBeTruthy();
  });

  it("renders the produce action button when unit can be produced", () => {
    const region = makeRegion({ buildings: { barracks: 1 } });
    render(React.createElement(MobileBuildSheet, { ...defaultProps, region }));
    const produceBtn = screen.getByTitle("Produkuj");
    expect(produceBtn).toBeTruthy();
  });

  it("clicking build button shows the build sheet with building name", () => {
    render(React.createElement(MobileBuildSheet, defaultProps));
    fireEvent.click(screen.getByTitle("Buduj"));
    expect(screen.getByText("Koszary")).toBeTruthy();
  });

  it("shows energy cost for a building", () => {
    render(React.createElement(MobileBuildSheet, defaultProps));
    fireEvent.click(screen.getByTitle("Buduj"));
    // The energy cost should be displayed
    expect(screen.getByText("50")).toBeTruthy();
  });

  it("disables build button when energy is insufficient", () => {
    render(React.createElement(MobileBuildSheet, { ...defaultProps, myEnergy: 10 }));
    fireEvent.click(screen.getByTitle("Buduj"));
    const buildBtn = screen.getByRole("button", { name: /koszary/i });
    expect(buildBtn).toHaveProperty("disabled", true);
  });

  it("enables build button when energy is sufficient", () => {
    render(React.createElement(MobileBuildSheet, { ...defaultProps, myEnergy: 100 }));
    fireEvent.click(screen.getByTitle("Buduj"));
    const buttons = screen.getAllByRole("button");
    // Find button containing the building name
    const buildBtns = buttons.filter((b) => b.textContent?.includes("Koszary"));
    expect(buildBtns.length).toBeGreaterThan(0);
    expect(buildBtns[0]).toHaveProperty("disabled", false);
  });

  it("calls onBuild with building slug when build button clicked", () => {
    const onBuild = vi.fn();
    render(React.createElement(MobileBuildSheet, { ...defaultProps, onBuild }));
    fireEvent.click(screen.getByTitle("Buduj"));
    fireEvent.click(screen.getByText("Koszary"));
    expect(onBuild).toHaveBeenCalledWith("barracks");
  });

  it("closes sheet after build action", () => {
    const onBuild = vi.fn();
    render(React.createElement(MobileBuildSheet, { ...defaultProps, onBuild }));
    fireEvent.click(screen.getByTitle("Buduj"));
    expect(screen.getByText("Koszary")).toBeTruthy();
    fireEvent.click(screen.getByText("Koszary"));
    // After clicking, mode resets to null — sheet should disappear
    expect(screen.queryByText("Budowa")).toBeNull();
  });

  it('shows sheet title "Budowa" in build mode', () => {
    render(React.createElement(MobileBuildSheet, defaultProps));
    fireEvent.click(screen.getByTitle("Buduj"));
    expect(screen.getByText(/Budowa/)).toBeTruthy();
  });

  it('shows sheet title "Produkcja jednostek" in produce mode', () => {
    const region = makeRegion({ buildings: { barracks: 1 } });
    render(React.createElement(MobileBuildSheet, { ...defaultProps, region }));
    fireEvent.click(screen.getByTitle("Produkuj"));
    expect(screen.getByText(/Produkcja jednostek/)).toBeTruthy();
  });

  it("shows close button in sheet mode", () => {
    render(React.createElement(MobileBuildSheet, defaultProps));
    fireEvent.click(screen.getByTitle("Buduj"));
    expect(screen.getByLabelText("Zamknij")).toBeTruthy();
  });

  it("clicking close button returns to floating mode", () => {
    render(React.createElement(MobileBuildSheet, defaultProps));
    fireEvent.click(screen.getByTitle("Buduj"));
    fireEvent.click(screen.getByLabelText("Zamknij"));
    // Should show build floating button again
    expect(screen.getByTitle("Buduj")).toBeTruthy();
  });

  it("shows locked state for building not in unlockedBuildings", () => {
    render(
      React.createElement(MobileBuildSheet, {
        ...defaultProps,
        unlockedBuildings: ["other_building"],
      }),
    );
    fireEvent.click(screen.getByTitle("Buduj"));
    expect(screen.getByText("Wymaga blueprintu z talii")).toBeTruthy();
    expect(screen.getAllByTestId("icon-lock").length).toBeGreaterThan(0);
  });

  it("does not show lock when building IS in unlockedBuildings", () => {
    render(
      React.createElement(MobileBuildSheet, {
        ...defaultProps,
        unlockedBuildings: ["barracks"],
      }),
    );
    fireEvent.click(screen.getByTitle("Buduj"));
    expect(screen.queryByText("Wymaga blueprintu z talii")).toBeNull();
  });

  it("filters out coastal buildings for non-coastal region", () => {
    const coastalBuilding = makeBuilding({
      id: "b2",
      slug: "port",
      name: "Port",
      requires_coastal: true,
    });
    render(
      React.createElement(MobileBuildSheet, {
        ...defaultProps,
        buildings: [makeBuilding(), coastalBuilding],
        region: makeRegion({ is_coastal: false }),
      }),
    );
    fireEvent.click(screen.getByTitle("Buduj"));
    expect(screen.queryByText("Port")).toBeNull();
    expect(screen.getByText("Koszary")).toBeTruthy();
  });

  it("shows coastal buildings for coastal region", () => {
    const coastalBuilding = makeBuilding({
      id: "b2",
      slug: "port",
      name: "Port",
      requires_coastal: true,
    });
    render(
      React.createElement(MobileBuildSheet, {
        ...defaultProps,
        buildings: [makeBuilding(), coastalBuilding],
        region: makeRegion({ is_coastal: true }),
      }),
    );
    fireEvent.click(screen.getByTitle("Buduj"));
    expect(screen.getByText("Port")).toBeTruthy();
  });

  it("calls onProduceUnit with unit slug when produce button clicked", () => {
    const onProduceUnit = vi.fn();
    const region = makeRegion({ buildings: { barracks: 1 } });
    render(
      React.createElement(MobileBuildSheet, {
        ...defaultProps,
        region,
        onProduceUnit,
      }),
    );
    fireEvent.click(screen.getByTitle("Produkuj"));
    fireEvent.click(screen.getByText("Piechota"));
    expect(onProduceUnit).toHaveBeenCalledWith("infantry");
  });

  it("shows unit production cost", () => {
    const region = makeRegion({ buildings: { barracks: 1 } });
    render(React.createElement(MobileBuildSheet, { ...defaultProps, region }));
    fireEvent.click(screen.getByTitle("Produkuj"));
    expect(screen.getByText("30")).toBeTruthy();
  });

  it("disables unit button when energy is insufficient", () => {
    const region = makeRegion({ buildings: { barracks: 1 } });
    render(
      React.createElement(MobileBuildSheet, {
        ...defaultProps,
        region,
        myEnergy: 5,
      }),
    );
    fireEvent.click(screen.getByTitle("Produkuj"));
    const unitBtns = screen.getAllByRole("button").filter((b) => b.textContent?.includes("Piechota"));
    expect(unitBtns[0]).toHaveProperty("disabled", true);
  });

  // ── building_instances format ──────────────────────────────────────────────

  it("uses building_instances when present to determine building counts", () => {
    const region = makeRegion({
      buildings: {},
      building_instances: [{ building_type: "barracks", level: 1 }],
    });
    render(React.createElement(MobileBuildSheet, { ...defaultProps, region }));
    // barracks already present via instance, max_per_region=2 so can still build
    fireEvent.click(screen.getByTitle("Buduj"));
    expect(screen.getByText("Koszary Lvl 1")).toBeTruthy();
  });

  it("shows upgrade label when instance level is below player max level", () => {
    const region = makeRegion({
      buildings: {},
      building_instances: [{ building_type: "barracks", level: 1 }],
    });
    const building = makeBuilding({ max_per_region: 2, max_level: 3 });
    render(
      React.createElement(MobileBuildSheet, {
        ...defaultProps,
        region,
        buildings: [building],
        buildingLevels: { barracks: 3 },
      }),
    );
    fireEvent.click(screen.getByTitle("Buduj"));
    expect(screen.getByText(/Ulepsz do Lvl 2/)).toBeTruthy();
  });

  it("shows 'Max' label when building is at max player level", () => {
    const region = makeRegion({
      buildings: {},
      building_instances: [{ building_type: "barracks", level: 2 }],
    });
    const building = makeBuilding({ max_per_region: 2, max_level: 2 });
    render(
      React.createElement(MobileBuildSheet, {
        ...defaultProps,
        region,
        buildings: [building],
        buildingLevels: { barracks: 2 },
      }),
    );
    fireEvent.click(screen.getByTitle("Buduj"));
    // "Max" label appears in both the description and the badge
    const maxEls = screen.getAllByText("Max");
    expect(maxEls.length).toBeGreaterThan(0);
  });

  it("shows count/max_per_region label when no level info is available", () => {
    const region = makeRegion({ buildings: { barracks: 1 } });
    const building = makeBuilding({ max_per_region: 2 });
    render(
      React.createElement(MobileBuildSheet, {
        ...defaultProps,
        region,
        buildings: [building],
      }),
    );
    fireEvent.click(screen.getByTitle("Buduj"));
    // 1 existing + 0 queued / max 2 → "1/2"
    expect(screen.getByText("1/2")).toBeTruthy();
  });

  // ── buildingQueue interaction ──────────────────────────────────────────────

  it("counts queued buildings toward the per-region limit", () => {
    const region = makeRegion({ buildings: { barracks: 1 } });
    // max_per_region=2, 1 built, 1 queued → total=2 → no more builds available
    const building = makeBuilding({ max_per_region: 2 });
    const buildingQueue: BuildingQueueItem[] = [
      { region_id: "r1", building_type: "barracks", player_id: "user-1", ticks_remaining: 2, total_ticks: 5 },
    ];
    const { container } = render(
      React.createElement(MobileBuildSheet, {
        ...defaultProps,
        region,
        buildings: [building],
        buildingQueue,
        units: [],
      }),
    );
    // hasBuild = false, hasProduce = false → null
    expect(container.firstChild).toBeNull();
  });

  // ── Locked unit in produce mode ────────────────────────────────────────────

  it("shows locked state for unit not in unlockedUnits", () => {
    const region = makeRegion({ buildings: { barracks: 1 } });
    render(
      React.createElement(MobileBuildSheet, {
        ...defaultProps,
        region,
        unlockedUnits: ["tank"],
      }),
    );
    fireEvent.click(screen.getByTitle("Produkuj"));
    // infantry is not in unlockedUnits → locked
    expect(screen.getByText("Wymaga blueprintu z talii")).toBeTruthy();
  });

  it("does not show lock when unit IS in unlockedUnits", () => {
    const region = makeRegion({ buildings: { barracks: 1 } });
    render(
      React.createElement(MobileBuildSheet, {
        ...defaultProps,
        region,
        unlockedUnits: ["infantry"],
      }),
    );
    fireEvent.click(screen.getByTitle("Produkuj"));
    expect(screen.queryByText("Wymaga blueprintu z talii")).toBeNull();
  });

  it("shows crew and tick label for unlocked units", () => {
    const region = makeRegion({ buildings: { barracks: 1 } });
    render(React.createElement(MobileBuildSheet, { ...defaultProps, region }));
    fireEvent.click(screen.getByTitle("Produkuj"));
    // infantry: manpower=1, time=3 ticks
    expect(screen.getByText(/Zaloga: 1 · 3 tick/)).toBeTruthy();
  });

  it("does not call onProduceUnit when locked unit button is clicked", () => {
    const onProduceUnit = vi.fn();
    const region = makeRegion({ buildings: { barracks: 1 } });
    render(
      React.createElement(MobileBuildSheet, {
        ...defaultProps,
        region,
        onProduceUnit,
        unlockedUnits: ["tank"], // infantry not unlocked
      }),
    );
    fireEvent.click(screen.getByTitle("Produkuj"));
    const unitBtns = screen.getAllByRole("button").filter((b) => b.textContent?.includes("Piechota"));
    fireEvent.click(unitBtns[0]);
    expect(onProduceUnit).not.toHaveBeenCalled();
  });

  it("does not call onBuild when locked building button is clicked", () => {
    const onBuild = vi.fn();
    render(
      React.createElement(MobileBuildSheet, {
        ...defaultProps,
        onBuild,
        unlockedBuildings: ["factory"],
      }),
    );
    fireEvent.click(screen.getByTitle("Buduj"));
    const buildBtns = screen.getAllByRole("button").filter((b) => b.textContent?.includes("Koszary"));
    fireEvent.click(buildBtns[0]);
    expect(onBuild).not.toHaveBeenCalled();
  });

  // ── Multiple building instances for upgrade label ─────────────────────────

  it("shows weakest level info when multiple instances exist", () => {
    const region = makeRegion({
      buildings: {},
      building_instances: [
        { building_type: "barracks", level: 1 },
        { building_type: "barracks", level: 3 },
      ],
    });
    const building = makeBuilding({ max_per_region: 3, max_level: 5 });
    render(
      React.createElement(MobileBuildSheet, {
        ...defaultProps,
        region,
        buildings: [building],
        buildingLevels: { barracks: 5 },
      }),
    );
    fireEvent.click(screen.getByTitle("Buduj"));
    // 2 instances → shows "weakest" info: "najslabsza: Lvl 1"
    expect(screen.getByText(/najslabsza: Lvl 1/)).toBeTruthy();
  });

  // ── Level stats cost override ──────────────────────────────────────────────

  it("shows level_stats energy cost for next level when upgrading", () => {
    const region = makeRegion({
      buildings: {},
      building_instances: [{ building_type: "barracks", level: 1 }],
    });
    const building = makeBuilding({
      max_per_region: 2,
      max_level: 3,
      energy_cost: 50,
      level_stats: { "2": { energy_cost: 80 } },
    });
    render(
      React.createElement(MobileBuildSheet, {
        ...defaultProps,
        region,
        buildings: [building],
        buildingLevels: { barracks: 3 },
        myEnergy: 200,
      }),
    );
    fireEvent.click(screen.getByTitle("Buduj"));
    // Next level is 2, cost = level_stats["2"].energy_cost = 80
    expect(screen.getByText("80")).toBeTruthy();
  });

  // ── Backdrop click closes sheet ────────────────────────────────────────────

  it("clicking backdrop overlay closes the sheet", () => {
    render(React.createElement(MobileBuildSheet, defaultProps));
    fireEvent.click(screen.getByTitle("Buduj"));
    expect(screen.getByText(/Budowa/)).toBeTruthy();
    // Click the backdrop overlay (fixed inset-0 element)
    const backdrop = document.querySelector(".fixed.inset-0.bg-background\\/60");
    if (backdrop) fireEvent.click(backdrop);
    // Sheet should close
    expect(screen.queryByText("Budowa")).toBeNull();
  });

  // ── producedUnits sort fallback to name.localeCompare (line 92) ─────────────

  it("sorts produced units by name when order and production_cost are equal (line 92)", () => {
    const region = makeRegion({ buildings: { barracks: 1 } });
    const unitA = makeUnit({
      id: "u-a",
      slug: "z_unit",
      name: "Zolnierz",
      produced_by_slug: "barracks",
      order: 1,
      production_cost: 30,
    });
    const unitB = makeUnit({
      id: "u-b",
      slug: "a_unit",
      name: "Artyleria",
      produced_by_slug: "barracks",
      order: 1,
      production_cost: 30,
    });
    render(
      React.createElement(MobileBuildSheet, {
        ...defaultProps,
        region,
        units: [unitA, unitB],
      }),
    );
    fireEvent.click(screen.getByTitle("Produkuj"));
    // Both units should appear; Artyleria sorts before Zolnierz alphabetically
    const buttons = screen.getAllByRole("button");
    const unitBtns = buttons.filter((b) => b.textContent?.match(/Artyleria|Zolnierz/));
    expect(unitBtns.length).toBeGreaterThan(0);
    // Artyleria comes before Zolnierz in alphabetical order
    expect(unitBtns[0].textContent).toContain("Artyleria");
  });

  // ── region.building_levels fallback ───────────────────────────────────────

  it("reads current level from region.building_levels when no instances exist", () => {
    const region = makeRegion({
      buildings: { barracks: 1 },
      building_instances: [],
      // @ts-expect-error — add building_levels for coverage
      building_levels: { barracks: 2 },
    });
    const building = makeBuilding({ max_per_region: 2, max_level: 5 });
    render(
      React.createElement(MobileBuildSheet, {
        ...defaultProps,
        region,
        buildings: [building],
        buildingLevels: { barracks: 5 },
      }),
    );
    fireEvent.click(screen.getByTitle("Buduj"));
    // Should show upgrade label using region.building_levels
    expect(screen.getByText(/Ulepsz do Lvl 3/)).toBeTruthy();
  });
});
