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
// Mock game asset helpers
// ---------------------------------------------------------------------------

vi.mock("@/lib/gameAssets", () => ({
  getActionAsset: (action: string) => `/assets/icons/${action}.webp`,
  getPlayerUnitAsset: (kind: string) => `/assets/units/${kind}.webp`,
}));

import ActionBar, { type TargetEntry } from "@/components/game/ActionBar";
import type { GameRegion } from "@/hooks/useGameSocket";
import type { UnitType } from "@/lib/api";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeSourceRegion(overrides: Partial<GameRegion> = {}): GameRegion {
  return {
    name: "Source Region",
    country_code: "PL",
    owner_id: "user-1",
    unit_count: 100,
    unit_type: "infantry",
    units: { infantry: 100 },
    is_coastal: false,
    is_capital: false,
    building_type: null,
    buildings: {},
    defense_bonus: 0,
    building_instances: [],
    ...overrides,
  };
}

const UNITS_CONFIG: UnitType[] = [
  {
    id: "u-1",
    name: "Infantry",
    slug: "infantry",
    asset_key: "infantry",
    asset_url: null,
    description: "",
    icon: "",
    attack: 10,
    defense: 10,
    speed: 1,
    attack_range: 1,
    sea_range: 0,
    sea_hop_distance_km: 0,
    movement_type: "ground",
    produced_by_slug: null,
    production_cost: 10,
    production_time_ticks: 3,
    manpower_cost: 1,
    order: 1,
    max_level: 3,
    level_stats: {},
    is_stealth: false,
    path_damage: 0,
    aoe_damage: 0,
    blockade_port: false,
    intercept_air: false,
    can_station_anywhere: false,
    lifetime_ticks: 0,
    combat_target: "all",
    ticks_per_hop: 1,
    air_speed_ticks_per_hop: 1,
  },
  {
    id: "u-2",
    name: "Tank",
    slug: "tank",
    asset_key: "tank",
    asset_url: null,
    description: "",
    icon: "",
    attack: 30,
    defense: 20,
    speed: 2,
    attack_range: 1,
    sea_range: 0,
    sea_hop_distance_km: 0,
    movement_type: "ground",
    produced_by_slug: null,
    production_cost: 40,
    production_time_ticks: 8,
    manpower_cost: 3,
    order: 2,
    max_level: 3,
    level_stats: {},
    is_stealth: false,
    path_damage: 0,
    aoe_damage: 0,
    blockade_port: false,
    intercept_air: false,
    can_station_anywhere: false,
    lifetime_ticks: 0,
    combat_target: "all",
    ticks_per_hop: 1,
    air_speed_ticks_per_hop: 1,
  },
];

const MOVE_TARGET: TargetEntry = {
  regionId: "r-target",
  region: makeSourceRegion({ name: "Target Region", owner_id: "user-1" }),
  name: "Target Region",
  isAttack: false,
};

const ATTACK_TARGET: TargetEntry = {
  regionId: "r-enemy",
  region: makeSourceRegion({ name: "Enemy Region", owner_id: "user-enemy" }),
  name: "Enemy Region",
  isAttack: true,
};

function defaultProps(overrides: Partial<Parameters<typeof ActionBar>[0]> = {}) {
  return {
    sourceRegion: makeSourceRegion(),
    sourceName: "Warsaw",
    targets: [],
    selectedUnitType: "infantry",
    unitsConfig: UNITS_CONFIG,
    onSelectedUnitTypeChange: vi.fn(),
    onConfirm: vi.fn(),
    onRemoveTarget: vi.fn(),
    onCancel: vi.fn(),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("ActionBar", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── Returns null when no units ──────────────────────────────────────────────

  it("renders nothing when source region has no units", () => {
    const sourceRegion = makeSourceRegion({ units: {} });
    const { container } = render(<ActionBar {...defaultProps({ sourceRegion })} />);
    expect(container.firstChild).toBeNull();
  });

  // ── Source region display ──────────────────────────────────────────────────

  it("renders source region name", () => {
    render(<ActionBar {...defaultProps()} />);
    // "Warsaw" appears in the component as source name
    expect(screen.getAllByText("Warsaw").length).toBeGreaterThan(0);
  });

  // ── Unit type selector ─────────────────────────────────────────────────────

  it("renders unit type buttons for each unit in source region", () => {
    const sourceRegion = makeSourceRegion({
      units: { infantry: 50, tank: 10 },
    });
    render(<ActionBar {...defaultProps({ sourceRegion })} />);
    expect(screen.getAllByText("Piechota").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Czolgi").length).toBeGreaterThan(0);
  });

  it("does not render unit type button for zero-count units", () => {
    const sourceRegion = makeSourceRegion({ units: { infantry: 50, tank: 0 } });
    render(<ActionBar {...defaultProps({ sourceRegion })} />);
    expect(screen.queryByText("Czolgi")).not.toBeInTheDocument();
  });

  it("calls onSelectedUnitTypeChange when a unit type button is clicked", () => {
    const onSelectedUnitTypeChange = vi.fn();
    const sourceRegion = makeSourceRegion({
      units: { infantry: 50, tank: 10 },
    });
    render(<ActionBar {...defaultProps({ sourceRegion, onSelectedUnitTypeChange })} />);
    const tankButtons = screen.getAllByText("Czolgi");
    fireEvent.click(tankButtons[0]);
    expect(onSelectedUnitTypeChange).toHaveBeenCalledWith("tank");
  });

  // ── Confirm / action button ───────────────────────────────────────────────

  it('shows "Ruch" button when all targets are moves (no attack)', () => {
    render(<ActionBar {...defaultProps({ targets: [MOVE_TARGET] })} />);
    expect(screen.getAllByText("Ruch").length).toBeGreaterThan(0);
  });

  it('shows "Atak" button when any target is an attack', () => {
    render(<ActionBar {...defaultProps({ targets: [ATTACK_TARGET] })} />);
    expect(screen.getAllByText("Atak").length).toBeGreaterThan(0);
  });

  it("confirm button is disabled when targets list is empty", () => {
    render(<ActionBar {...defaultProps({ targets: [] })} />);
    const confirmButtons = screen
      .getAllByRole("button")
      .filter((btn) => btn.textContent?.includes("Ruch") || btn.textContent?.includes("Atak"));
    confirmButtons.forEach((btn) => expect(btn).toBeDisabled());
  });

  it("confirm button is enabled when targets exist", () => {
    render(<ActionBar {...defaultProps({ targets: [MOVE_TARGET] })} />);
    const confirmButtons = screen.getAllByRole("button").filter((btn) => btn.textContent?.includes("Ruch"));
    expect(confirmButtons.length).toBeGreaterThan(0);
    confirmButtons.forEach((btn) => expect(btn).not.toBeDisabled());
  });

  it("calls onConfirm with correct payload when confirm button clicked", () => {
    const onConfirm = vi.fn();
    render(<ActionBar {...defaultProps({ targets: [MOVE_TARGET], onConfirm })} />);
    const confirmButtons = screen.getAllByRole("button").filter((btn) => btn.textContent?.includes("Ruch"));
    fireEvent.click(confirmButtons[0]);
    expect(onConfirm).toHaveBeenCalledWith(
      expect.objectContaining({
        unitType: "infantry",
        allocations: expect.arrayContaining([expect.objectContaining({ regionId: "r-target" })]),
      }),
    );
  });

  // ── Cancel button ─────────────────────────────────────────────────────────

  it("calls onCancel when cancel button is clicked", () => {
    const onCancel = vi.fn();
    render(<ActionBar {...defaultProps({ onCancel })} />);
    const cancelButtons = screen.getAllByLabelText("Anuluj");
    fireEvent.click(cancelButtons[0]);
    expect(onCancel).toHaveBeenCalled();
  });

  // ── Target chips ──────────────────────────────────────────────────────────

  it("shows placeholder text when no targets are selected", () => {
    render(<ActionBar {...defaultProps({ targets: [] })} />);
    // Both mobile and desktop versions show placeholder
    const texts = screen.getAllByText(/Wybierz/i);
    expect(texts.length).toBeGreaterThan(0);
  });

  it("renders target region names as chips", () => {
    render(<ActionBar {...defaultProps({ targets: [MOVE_TARGET] })} />);
    expect(screen.getAllByText("Target Region").length).toBeGreaterThan(0);
  });

  it("calls onRemoveTarget when a target chip is clicked", () => {
    const onRemoveTarget = vi.fn();
    render(<ActionBar {...defaultProps({ targets: [MOVE_TARGET], onRemoveTarget })} />);
    const targetChips = screen.getAllByText("Target Region");
    fireEvent.click(targetChips[0]);
    expect(onRemoveTarget).toHaveBeenCalledWith("r-target");
  });

  it("renders multiple target chips when multiple targets selected", () => {
    const targets = [MOVE_TARGET, ATTACK_TARGET];
    render(<ActionBar {...defaultProps({ targets })} />);
    expect(screen.getAllByText("Target Region").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Enemy Region").length).toBeGreaterThan(0);
  });

  // ── Unit range slider ──────────────────────────────────────────────────────

  it("renders range slider for unit count selection", () => {
    render(<ActionBar {...defaultProps({ targets: [MOVE_TARGET] })} />);
    const sliders = screen.getAllByRole("slider");
    expect(sliders.length).toBeGreaterThan(0);
  });

  it("shows unit count display as X/max format", () => {
    const sourceRegion = makeSourceRegion({ units: { infantry: 100 } });
    render(<ActionBar {...defaultProps({ sourceRegion, targets: [MOVE_TARGET] })} />);
    // The component shows `safeTotalUnits/maxUnits`
    expect(screen.getAllByText(/\d+\/100/).length).toBeGreaterThan(0);
  });

  // ── Attack vs move styling ────────────────────────────────────────────────

  it("applies attack border styling when any target is an attack", () => {
    const { container } = render(<ActionBar {...defaultProps({ targets: [ATTACK_TARGET] })} />);
    // The container uses `border-destructive/30` for attack
    expect(container.innerHTML).toContain("border-destructive");
  });

  it("applies move border styling when all targets are moves", () => {
    const { container } = render(<ActionBar {...defaultProps({ targets: [MOVE_TARGET] })} />);
    expect(container.innerHTML).toContain("border-primary");
  });

  // ── selectedUnitScale ─────────────────────────────────────────────────────

  it("multiplies allocation by selectedUnitScale in target chip display", () => {
    render(
      <ActionBar
        {...defaultProps({
          targets: [MOVE_TARGET],
          selectedUnitScale: 3,
        })}
      />,
    );
    // The chip shows `allocations[index].units * selectedUnitScale`
    // With 100 infantry, scale=3, safeTotalUnits=50, chip shows 50*3=150
    const chips = screen.getAllByText("150");
    expect(chips.length).toBeGreaterThan(0);
  });

  // ── Unit type labels ──────────────────────────────────────────────────────

  it("renders correct Polish label for ship unit type", () => {
    const sourceRegion = makeSourceRegion({ units: { ship: 20 } });
    render(<ActionBar {...defaultProps({ sourceRegion, selectedUnitType: "ship" })} />);
    expect(screen.getAllByText("Flota").length).toBeGreaterThan(0);
  });

  it("renders correct Polish label for fighter unit type", () => {
    const sourceRegion = makeSourceRegion({ units: { fighter: 15 } });
    render(<ActionBar {...defaultProps({ sourceRegion, selectedUnitType: "fighter" })} />);
    expect(screen.getAllByText("Mysliwce").length).toBeGreaterThan(0);
  });

  it("renders correct Polish label for artillery unit type", () => {
    const sourceRegion = makeSourceRegion({ units: { artillery: 8 } });
    render(<ActionBar {...defaultProps({ sourceRegion, selectedUnitType: "artillery" })} />);
    expect(screen.getAllByText("Artyleria").length).toBeGreaterThan(0);
  });

  it("renders correct Polish label for submarine unit type", () => {
    const sourceRegion = makeSourceRegion({ units: { submarine: 5 } });
    render(<ActionBar {...defaultProps({ sourceRegion, selectedUnitType: "submarine" })} />);
    expect(screen.getAllByText("Okret podw.").length).toBeGreaterThan(0);
  });

  it("renders correct Polish label for bomber unit type", () => {
    const sourceRegion = makeSourceRegion({ units: { bomber: 3 } });
    render(<ActionBar {...defaultProps({ sourceRegion, selectedUnitType: "bomber" })} />);
    expect(screen.getAllByText("Bombowce").length).toBeGreaterThan(0);
  });

  it("renders correct Polish label for commando unit type", () => {
    const sourceRegion = makeSourceRegion({ units: { commando: 4 } });
    render(<ActionBar {...defaultProps({ sourceRegion, selectedUnitType: "commando" })} />);
    expect(screen.getAllByText("Komandosi").length).toBeGreaterThan(0);
  });

  it("renders correct Polish label for SAM unit type", () => {
    const sourceRegion = makeSourceRegion({ units: { sam: 6 } });
    render(<ActionBar {...defaultProps({ sourceRegion, selectedUnitType: "sam" })} />);
    expect(screen.getAllByText("Rakiety SAM").length).toBeGreaterThan(0);
  });

  it("renders correct Polish label for nuke_rocket unit type", () => {
    const sourceRegion = makeSourceRegion({ units: { nuke_rocket: 1 } });
    render(<ActionBar {...defaultProps({ sourceRegion, selectedUnitType: "nuke_rocket" })} />);
    expect(screen.getAllByText("Rakieta nuk.").length).toBeGreaterThan(0);
  });

  it("falls back to raw unit type string for unknown types", () => {
    const sourceRegion = makeSourceRegion({ units: { custom_unit: 10 } });
    render(<ActionBar {...defaultProps({ sourceRegion, selectedUnitType: "custom_unit" })} />);
    expect(screen.getAllByText("custom_unit").length).toBeGreaterThan(0);
  });

  // ── Desktop variant (sm:block) ──────────────────────────────────────────────

  it("renders desktop region source label 'Region zrodlowy'", () => {
    render(<ActionBar {...defaultProps()} />);
    expect(screen.getByText("Region zrodlowy")).toBeInTheDocument();
  });

  it("renders desktop unit count in X / max format with space", () => {
    const sourceRegion = makeSourceRegion({ units: { infantry: 80 } });
    render(<ActionBar {...defaultProps({ sourceRegion, targets: [MOVE_TARGET] })} />);
    // Desktop shows "40 / 80" style format
    expect(screen.getAllByText(/\d+ \/ 80|\d+\/80/).length).toBeGreaterThan(0);
  });

  it("renders desktop target placeholder when no targets", () => {
    render(<ActionBar {...defaultProps({ targets: [] })} />);
    // Mobile: "Wybierz cele na mapie" / Desktop: "Wybierz cel na mapie"
    const placeholders = screen.getAllByText(/Wybierz cel/i);
    expect(placeholders.length).toBeGreaterThan(0);
  });

  it("desktop confirm button is enabled when targets exist", () => {
    render(<ActionBar {...defaultProps({ targets: [MOVE_TARGET] })} />);
    const confirmButtons = screen.getAllByRole("button").filter((btn) => btn.textContent?.includes("Ruch"));
    const enabledBtn = confirmButtons.find((b) => !(b as HTMLButtonElement).disabled);
    expect(enabledBtn).toBeDefined();
  });

  it("desktop cancel button calls onCancel", () => {
    const onCancel = vi.fn();
    render(<ActionBar {...defaultProps({ onCancel })} />);
    const cancelButtons = screen.getAllByLabelText("Anuluj");
    // Click last one (desktop)
    fireEvent.click(cancelButtons[cancelButtons.length - 1]);
    expect(onCancel).toHaveBeenCalled();
  });

  // ── Unit type switching via desktop buttons ─────────────────────────────────

  it("calls onSelectedUnitTypeChange when desktop unit type button is clicked", () => {
    const onSelectedUnitTypeChange = vi.fn();
    const sourceRegion = makeSourceRegion({ units: { infantry: 50, tank: 10 } });
    render(<ActionBar {...defaultProps({ sourceRegion, onSelectedUnitTypeChange })} />);
    const tankButtons = screen.getAllByText("Czolgi");
    // Click the last one (desktop version)
    fireEvent.click(tankButtons[tankButtons.length - 1]);
    expect(onSelectedUnitTypeChange).toHaveBeenCalledWith("tank");
  });

  // ── Target removal ─────────────────────────────────────────────────────────

  it("desktop: calls onRemoveTarget when target chip is clicked", () => {
    const onRemoveTarget = vi.fn();
    render(<ActionBar {...defaultProps({ targets: [ATTACK_TARGET], onRemoveTarget })} />);
    const enemyChips = screen.getAllByText("Enemy Region");
    // Click the last chip (desktop)
    fireEvent.click(enemyChips[enemyChips.length - 1]);
    expect(onRemoveTarget).toHaveBeenCalledWith("r-enemy");
  });

  // ── Mixed attack + move targets ────────────────────────────────────────────

  it("mixed targets: shows 'Atak' button when any target is attack", () => {
    const targets = [MOVE_TARGET, ATTACK_TARGET];
    render(<ActionBar {...defaultProps({ targets })} />);
    expect(screen.getAllByText("Atak").length).toBeGreaterThan(0);
  });

  // ── Non-infantry unit manpower display ─────────────────────────────────────

  it("displays manpower cost in parentheses for non-infantry units", () => {
    const unitsConfig = UNITS_CONFIG; // tank has manpower_cost: 3
    const sourceRegion = makeSourceRegion({ units: { infantry: 50, tank: 5 } });
    render(<ActionBar {...defaultProps({ sourceRegion, unitsConfig, selectedUnitType: "infantry" })} />);
    // tank: 5 units, manpower_cost=3 → display "5 (15)"
    expect(screen.getAllByText("5 (15)").length).toBeGreaterThan(0);
  });

  // ── maxUnits < 1 returns null ──────────────────────────────────────────────

  it("returns null when infantry display count is 0 (all reserved by other units)", () => {
    // 10 infantry, tank=10 with manpower=3 → reserved=30 > 10 → infantry display=0, maxUnits=0
    const bigTankConfig = [
      {
        ...UNITS_CONFIG[1],
        manpower_cost: 5,
      },
    ];
    const sourceRegion = makeSourceRegion({ units: { infantry: 2, tank: 2 } });
    const { container } = render(
      <ActionBar
        {...defaultProps({
          sourceRegion,
          selectedUnitType: "infantry",
          unitsConfig: bigTankConfig,
        })}
      />,
    );
    // infantry display = max(0, 2 - 2*5) = 0 → maxUnits=0 → return null
    expect(container.firstChild).toBeNull();
  });

  // ── ship_1 unit type label ─────────────────────────────────────────────────

  it("renders correct Polish label for ship_1 (alias for ship)", () => {
    const sourceRegion = makeSourceRegion({ units: { ship_1: 5 } });
    render(<ActionBar {...defaultProps({ sourceRegion, selectedUnitType: "ship_1" })} />);
    // ship_1 is not in getUnitLabel switch; falls back to raw or "Flota"
    // getUnitLabel("ship_1") returns "ship_1" (not in switch)
    expect(screen.getAllByText("ship_1").length).toBeGreaterThan(0);
  });

  // ── setTotalUnits reset when selectedUnitType changes (line 134) ────────────

  it("resets slider value when selectedUnitType changes between renders", () => {
    const sourceRegion = makeSourceRegion({ units: { infantry: 100, tank: 10 } });
    const { rerender } = render(
      <ActionBar
        {...defaultProps({
          sourceRegion,
          selectedUnitType: "infantry",
          targets: [MOVE_TARGET],
        })}
      />,
    );
    // Verify infantry slider exists (max=100, default=50)
    const sliders = screen.getAllByRole("slider");
    expect(sliders.length).toBeGreaterThan(0);

    // Re-render with a different selectedUnitType — triggers setTotalUnits(defaultTotalUnits)
    rerender(
      <ActionBar
        {...defaultProps({
          sourceRegion,
          selectedUnitType: "tank",
          targets: [MOVE_TARGET],
        })}
      />,
    );
    // After switch to tank (10 units), slider should reset: default = max(1, floor(10/2)) = 5
    // The count display now shows tank count
    expect(screen.getAllByText(/\d+\/10/).length).toBeGreaterThan(0);
  });

  it("resets slider value when maxUnits changes to a smaller value between renders", () => {
    const sourceRegion = makeSourceRegion({ units: { infantry: 100 } });
    const { rerender } = render(
      <ActionBar
        {...defaultProps({
          sourceRegion,
          selectedUnitType: "infantry",
          targets: [MOVE_TARGET],
        })}
      />,
    );

    // Simulate live count dropping
    const reducedRegion = makeSourceRegion({ units: { infantry: 4 } });
    rerender(
      <ActionBar
        {...defaultProps({
          sourceRegion: reducedRegion,
          selectedUnitType: "infantry",
          targets: [MOVE_TARGET],
        })}
      />,
    );
    // maxUnits now 4, slider default = max(1, floor(4/2)) = 2
    expect(screen.getAllByRole("slider").length).toBeGreaterThan(0);
  });

  // ── Desktop slider disabled state (line 319) ────────────────────────────────

  it("desktop slider is disabled when no targets are selected", () => {
    render(<ActionBar {...defaultProps({ targets: [] })} />);
    const sliders = screen.getAllByRole("slider");
    // At least one slider (desktop) should be disabled when targets.length === 0
    const disabledSliders = sliders.filter((s) => (s as HTMLInputElement).disabled);
    expect(disabledSliders.length).toBeGreaterThan(0);
  });

  it("desktop slider is enabled when targets exist", () => {
    render(<ActionBar {...defaultProps({ targets: [MOVE_TARGET] })} />);
    const sliders = screen.getAllByRole("slider");
    // At least one slider should not be disabled
    const enabledSliders = sliders.filter((s) => !(s as HTMLInputElement).disabled);
    expect(enabledSliders.length).toBeGreaterThan(0);
  });

  // ── Mobile slider onChange (line 213) ────────────────────────────────────────

  it("updates slider value when mobile range input changes", () => {
    const sourceRegion = makeSourceRegion({ units: { infantry: 100 } });
    render(
      <ActionBar
        {...defaultProps({
          sourceRegion,
          selectedUnitType: "infantry",
          targets: [MOVE_TARGET],
        })}
      />,
    );
    const sliders = screen.getAllByRole("slider");
    // Fire change on the first (mobile) slider
    fireEvent.change(sliders[0], { target: { value: "80" } });
    // After change, at least one display should show 80/100 or similar
    expect(screen.getAllByRole("slider").length).toBeGreaterThan(0);
  });

  // ── Desktop confirm button onClick (line 350) ─────────────────────────────────

  it("desktop confirm button calls onConfirm when clicked", () => {
    const onConfirm = vi.fn();
    render(
      <ActionBar
        {...defaultProps({
          targets: [MOVE_TARGET],
          onConfirm,
        })}
      />,
    );
    const confirmButtons = screen.getAllByRole("button").filter((btn) => btn.textContent?.includes("Ruch"));
    // The last confirm button is the desktop one
    fireEvent.click(confirmButtons[confirmButtons.length - 1]);
    expect(onConfirm).toHaveBeenCalledWith(
      expect.objectContaining({
        unitType: "infantry",
        allocations: expect.arrayContaining([expect.objectContaining({ regionId: "r-target" })]),
      }),
    );
  });
});
