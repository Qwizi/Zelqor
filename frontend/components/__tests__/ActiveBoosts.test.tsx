import { render, screen } from "@testing-library/react";
import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Mock lucide-react icons
// ---------------------------------------------------------------------------

vi.mock("lucide-react", () => ({
  TrendingUp: ({ className }: { className?: string }) =>
    React.createElement("span", { "data-testid": "icon-trending-up", className }),
  Shield: ({ className }: { className?: string }) =>
    React.createElement("span", { "data-testid": "icon-shield", className }),
  Swords: ({ className }: { className?: string }) =>
    React.createElement("span", { "data-testid": "icon-swords", className }),
  Coins: ({ className }: { className?: string }) =>
    React.createElement("span", { "data-testid": "icon-coins", className }),
  Zap: ({ className }: { className?: string }) => React.createElement("span", { "data-testid": "icon-zap", className }),
}));

import ActiveBoosts, { type ActiveBoost, type ActiveMatchBoost } from "@/components/game/ActiveBoosts";

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("ActiveBoosts", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── Returns null when empty ──────────────────────────────────────────────

  it("renders nothing when both boosts and matchBoosts are empty", () => {
    const { container } = render(React.createElement(ActiveBoosts, { boosts: [], matchBoosts: [] }));
    expect(container.firstChild).toBeNull();
  });

  it("renders nothing when boosts is empty and matchBoosts is not provided", () => {
    const { container } = render(React.createElement(ActiveBoosts, { boosts: [] }));
    expect(container.firstChild).toBeNull();
  });

  // ── Known effect types render correct icons ───────────────────────────────

  it("renders TrendingUp icon for unit_bonus boost", () => {
    const boosts: ActiveBoost[] = [{ slug: "b1", params: { effect_type: "unit_bonus", value: 0.2 } }];
    render(React.createElement(ActiveBoosts, { boosts }));
    expect(screen.getByTestId("icon-trending-up")).toBeTruthy();
  });

  it("renders Shield icon for defense_bonus boost", () => {
    const boosts: ActiveBoost[] = [{ slug: "b1", params: { effect_type: "defense_bonus", value: 0.15 } }];
    render(React.createElement(ActiveBoosts, { boosts }));
    expect(screen.getByTestId("icon-shield")).toBeTruthy();
  });

  it("renders Swords icon for attack_bonus boost", () => {
    const boosts: ActiveBoost[] = [{ slug: "b1", params: { effect_type: "attack_bonus", value: 0.1 } }];
    render(React.createElement(ActiveBoosts, { boosts }));
    expect(screen.getByTestId("icon-swords")).toBeTruthy();
  });

  it("renders Coins icon for energy_bonus boost", () => {
    const boosts: ActiveBoost[] = [{ slug: "b1", params: { effect_type: "energy_bonus", value: 0.25 } }];
    render(React.createElement(ActiveBoosts, { boosts }));
    expect(screen.getByTestId("icon-coins")).toBeTruthy();
  });

  // ── Unknown effect_type falls back to Zap icon (line 49 — fallbackIcon) ────

  it("renders fallback Zap icon for unknown effect_type in boosts (line 49)", () => {
    const boosts: ActiveBoost[] = [{ slug: "b1", params: { effect_type: "unknown_boost", value: 0.1 } }];
    render(React.createElement(ActiveBoosts, { boosts }));
    expect(screen.getByTestId("icon-zap")).toBeTruthy();
  });

  it("renders fallback Zap icon when effect_type is missing from boost params", () => {
    const boosts: ActiveBoost[] = [{ slug: "b1", params: { value: 0.5 } }];
    render(React.createElement(ActiveBoosts, { boosts }));
    // effectType is "" which is not in BOOST_ICONS → fallbackIcon()
    expect(screen.getByTestId("icon-zap")).toBeTruthy();
  });

  it("renders fallback Zap icon for unknown effect_type in matchBoosts", () => {
    const matchBoosts: ActiveMatchBoost[] = [
      {
        slug: "mb1",
        effect_type: "custom_effect",
        value: 0.3,
        ticks_remaining: 5,
      },
    ];
    render(React.createElement(ActiveBoosts, { boosts: [], matchBoosts }));
    expect(screen.getByTestId("icon-zap")).toBeTruthy();
  });

  // ── Value percentage display ──────────────────────────────────────────────

  it("displays boost value as percentage (+20%)", () => {
    const boosts: ActiveBoost[] = [{ slug: "b1", params: { effect_type: "unit_bonus", value: 0.2 } }];
    render(React.createElement(ActiveBoosts, { boosts }));
    expect(screen.getByText("+20%")).toBeTruthy();
  });

  it("displays correct percentage for non-round value", () => {
    const boosts: ActiveBoost[] = [{ slug: "b1", params: { effect_type: "defense_bonus", value: 0.155 } }];
    render(React.createElement(ActiveBoosts, { boosts }));
    // Math.round(0.155 * 100) = 16
    expect(screen.getByText("+16%")).toBeTruthy();
  });

  // ── Tooltip title ─────────────────────────────────────────────────────────

  it("renders title with known label and percentage for unit_bonus", () => {
    const boosts: ActiveBoost[] = [{ slug: "b1", params: { effect_type: "unit_bonus", value: 0.3 } }];
    const { container } = render(React.createElement(ActiveBoosts, { boosts }));
    const el = container.querySelector("[title]");
    expect(el?.getAttribute("title")).toContain("Mobilizacja");
    expect(el?.getAttribute("title")).toContain("+30%");
    expect(el?.getAttribute("title")).toContain("cały mecz");
  });

  it("uses effect_type as label fallback for unknown effect type", () => {
    const boosts: ActiveBoost[] = [{ slug: "b1", params: { effect_type: "weird_boost", value: 0.1 } }];
    const { container } = render(React.createElement(ActiveBoosts, { boosts }));
    const el = container.querySelector("[title]");
    expect(el?.getAttribute("title")).toContain("weird_boost");
  });

  // ── matchBoosts display ───────────────────────────────────────────────────

  it("renders matchBoosts with ticks_remaining countdown", () => {
    const matchBoosts: ActiveMatchBoost[] = [
      {
        slug: "mb1",
        effect_type: "unit_bonus",
        value: 0.2,
        ticks_remaining: 3,
      },
    ];
    render(React.createElement(ActiveBoosts, { boosts: [], matchBoosts, tickIntervalMs: 1000 }));
    // remainingSec = ceil(3 * 1000 / 1000) = 3
    expect(screen.getByText("3s")).toBeTruthy();
  });

  it("renders matchBoosts tick display using custom tickIntervalMs", () => {
    const matchBoosts: ActiveMatchBoost[] = [
      {
        slug: "mb1",
        effect_type: "defense_bonus",
        value: 0.15,
        ticks_remaining: 2,
      },
    ];
    render(React.createElement(ActiveBoosts, { boosts: [], matchBoosts, tickIntervalMs: 2000 }));
    // remainingSec = ceil(2 * 2000 / 1000) = 4
    expect(screen.getByText("4s")).toBeTruthy();
  });

  it("renders matchBoosts value percentage", () => {
    const matchBoosts: ActiveMatchBoost[] = [
      {
        slug: "mb1",
        effect_type: "attack_bonus",
        value: 0.25,
        ticks_remaining: 10,
      },
    ];
    render(React.createElement(ActiveBoosts, { boosts: [], matchBoosts }));
    expect(screen.getByText("+25%")).toBeTruthy();
  });

  // ── Renders when only matchBoosts present ─────────────────────────────────

  it("renders when only matchBoosts are present and boosts is empty", () => {
    const matchBoosts: ActiveMatchBoost[] = [
      { slug: "mb1", effect_type: "unit_bonus", value: 0.1, ticks_remaining: 5 },
    ];
    const { container } = render(React.createElement(ActiveBoosts, { boosts: [], matchBoosts }));
    expect(container.firstChild).not.toBeNull();
  });

  // ── Multiple boosts rendered ──────────────────────────────────────────────

  it("renders multiple boosts", () => {
    const boosts: ActiveBoost[] = [
      { slug: "b1", params: { effect_type: "unit_bonus", value: 0.2 } },
      { slug: "b2", params: { effect_type: "defense_bonus", value: 0.1 } },
    ];
    render(React.createElement(ActiveBoosts, { boosts }));
    expect(screen.getByTestId("icon-trending-up")).toBeTruthy();
    expect(screen.getByTestId("icon-shield")).toBeTruthy();
  });
});
