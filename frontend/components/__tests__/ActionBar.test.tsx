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
    expect(screen.getAllByText("Lotnictwo").length).toBeGreaterThan(0);
  });
});
