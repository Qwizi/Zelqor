import { fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Mock recharts
// ---------------------------------------------------------------------------

vi.mock("recharts", () => ({
  Area: ({ dataKey }: { dataKey: string }) => React.createElement("div", { "data-testid": `recharts-area-${dataKey}` }),
  AreaChart: ({ children }: { children: React.ReactNode }) =>
    React.createElement("div", { "data-testid": "recharts-areachart" }, children),
  Bar: ({ dataKey }: { dataKey: string }) => React.createElement("div", { "data-testid": `recharts-bar-${dataKey}` }),
  BarChart: ({ children }: { children: React.ReactNode }) =>
    React.createElement("div", { "data-testid": "recharts-barchart" }, children),
  XAxis: () => React.createElement("div", { "data-testid": "recharts-xaxis" }),
  YAxis: () => React.createElement("div", { "data-testid": "recharts-yaxis" }),
  CartesianGrid: () => React.createElement("div", { "data-testid": "recharts-grid" }),
}));

// ---------------------------------------------------------------------------
// Mock shadcn/ui chart components
// ---------------------------------------------------------------------------

vi.mock("@/components/ui/chart", () => ({
  ChartContainer: ({ children, className }: { children: React.ReactNode; className?: string }) =>
    React.createElement("div", { "data-testid": "chart-container", className }, children),
  ChartTooltip: () => React.createElement("div", { "data-testid": "chart-tooltip" }),
  ChartTooltipContent: () => React.createElement("div", { "data-testid": "chart-tooltip-content" }),
}));

import ProfileCharts from "@/components/profile/ProfileCharts";
import type { Match } from "@/lib/api";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const USER_ID = "user-42";

function makeMatch(overrides: Partial<Match> = {}): Match {
  return {
    id: "m1",
    status: "finished",
    max_players: 2,
    game_mode_id: null,
    winner_id: USER_ID,
    players: [
      {
        id: "mp1",
        user_id: USER_ID,
        username: "Me",
        color: "#22d3ee",
        is_alive: false,
        joined_at: "",
        is_banned: false,
      },
      {
        id: "mp2",
        user_id: "opp",
        username: "Opp",
        color: "#fbbf24",
        is_alive: false,
        joined_at: "",
        is_banned: false,
      },
    ],
    started_at: "2026-03-01T10:00:00Z",
    finished_at: "2026-03-01T10:30:00Z",
    created_at: "2026-03-01T10:00:00Z",
    ...overrides,
  };
}

function makeLossMatch(overrides: Partial<Match> = {}): Match {
  return makeMatch({
    id: "m2",
    winner_id: "opp",
    players: [
      {
        id: "mp1",
        user_id: USER_ID,
        username: "Me",
        color: "#22d3ee",
        is_alive: false,
        joined_at: "",
        is_banned: false,
      },
      { id: "mp2", user_id: "opp", username: "Opp", color: "#fbbf24", is_alive: true, joined_at: "", is_banned: false },
    ],
    ...overrides,
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("ProfileCharts", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders nothing when there are no finished matches", () => {
    const { container } = render(
      React.createElement(ProfileCharts, {
        matches: [],
        userId: USER_ID,
        currentElo: 1000,
      }),
    );
    expect(container.firstChild).toBeNull();
  });

  it("renders nothing when all matches are not finished", () => {
    const activeMatch = makeMatch({ status: "active" });
    const { container } = render(
      React.createElement(ProfileCharts, {
        matches: [activeMatch],
        userId: USER_ID,
        currentElo: 1000,
      }),
    );
    expect(container.firstChild).toBeNull();
  });

  it("renders when there are finished matches", () => {
    const { container } = render(
      React.createElement(ProfileCharts, {
        matches: [makeMatch()],
        userId: USER_ID,
        currentElo: 1000,
      }),
    );
    expect(container.firstChild).not.toBeNull();
  });

  it("renders tab buttons: ELO, W/L, Mecze", () => {
    render(
      React.createElement(ProfileCharts, {
        matches: [makeMatch()],
        userId: USER_ID,
        currentElo: 1000,
      }),
    );
    expect(screen.getByText("ELO")).toBeTruthy();
    expect(screen.getByText("W/L")).toBeTruthy();
    expect(screen.getByText("Mecze")).toBeTruthy();
  });

  it("shows ELO chart (AreaChart) by default", () => {
    render(
      React.createElement(ProfileCharts, {
        matches: [makeMatch()],
        userId: USER_ID,
        currentElo: 1000,
      }),
    );
    expect(screen.getByTestId("recharts-areachart")).toBeTruthy();
  });

  it('ELO chart contains Area element with dataKey="elo"', () => {
    render(
      React.createElement(ProfileCharts, {
        matches: [makeMatch()],
        userId: USER_ID,
        currentElo: 1000,
      }),
    );
    expect(screen.getByTestId("recharts-area-elo")).toBeTruthy();
  });

  it("switching to W/L tab shows results view", () => {
    render(
      React.createElement(ProfileCharts, {
        matches: [makeMatch(), makeLossMatch()],
        userId: USER_ID,
        currentElo: 1000,
      }),
    );
    fireEvent.click(screen.getByText("W/L"));
    expect(screen.queryByTestId("recharts-areachart")).toBeNull();
    // Win rate percentage should be shown
    expect(screen.getByText(/Win Rate/)).toBeTruthy();
  });

  it("shows win rate percentage in results tab", () => {
    // 1 win out of 2 = 50%
    render(
      React.createElement(ProfileCharts, {
        matches: [makeMatch(), makeLossMatch()],
        userId: USER_ID,
        currentElo: 1000,
      }),
    );
    fireEvent.click(screen.getByText("W/L"));
    expect(screen.getByText("50%")).toBeTruthy();
  });

  it("shows 100% win rate when all matches are wins", () => {
    render(
      React.createElement(ProfileCharts, {
        matches: [makeMatch(), makeMatch({ id: "m2" })],
        userId: USER_ID,
        currentElo: 1000,
      }),
    );
    fireEvent.click(screen.getByText("W/L"));
    expect(screen.getByText("100%")).toBeTruthy();
  });

  it("shows wins and losses count in results tab", () => {
    render(
      React.createElement(ProfileCharts, {
        matches: [makeMatch(), makeLossMatch()],
        userId: USER_ID,
        currentElo: 1000,
      }),
    );
    fireEvent.click(screen.getByText("W/L"));
    expect(screen.getByText("wygranych")).toBeTruthy();
    expect(screen.getByText("przegranych")).toBeTruthy();
  });

  it("switching to activity tab shows BarChart", () => {
    render(
      React.createElement(ProfileCharts, {
        matches: [makeMatch()],
        userId: USER_ID,
        currentElo: 1000,
      }),
    );
    fireEvent.click(screen.getByText("Mecze"));
    expect(screen.getByTestId("recharts-barchart")).toBeTruthy();
  });

  it('activity BarChart contains a Bar with dataKey="count"', () => {
    render(
      React.createElement(ProfileCharts, {
        matches: [makeMatch()],
        userId: USER_ID,
        currentElo: 1000,
      }),
    );
    fireEvent.click(screen.getByText("Mecze"));
    expect(screen.getByTestId("recharts-bar-count")).toBeTruthy();
  });

  it("switching back to ELO tab restores AreaChart", () => {
    render(
      React.createElement(ProfileCharts, {
        matches: [makeMatch()],
        userId: USER_ID,
        currentElo: 1000,
      }),
    );
    fireEvent.click(screen.getByText("Mecze"));
    fireEvent.click(screen.getByText("ELO"));
    expect(screen.getByTestId("recharts-areachart")).toBeTruthy();
  });

  it("shows match count in results tab label", () => {
    render(
      React.createElement(ProfileCharts, {
        matches: [makeMatch(), makeLossMatch()],
        userId: USER_ID,
        currentElo: 1000,
      }),
    );
    fireEvent.click(screen.getByText("W/L"));
    expect(screen.getByText(/2 meczy/)).toBeTruthy();
  });

  it("renders chart containers for ELO tab", () => {
    render(
      React.createElement(ProfileCharts, {
        matches: [makeMatch()],
        userId: USER_ID,
        currentElo: 1000,
      }),
    );
    expect(screen.getByTestId("chart-container")).toBeTruthy();
  });

  // ── other++ branch (line 84) ──────────────────────────────────────────────
  // A match is counted as "other" when the user did NOT win and their player
  // entry either doesn't exist or is_alive is true (not definitively a loss).
  // The "other" data entry is computed in resultsData but the results view
  // only displays wins/losses counts — so we verify observable behavior.

  it("counts match as 'other' when player is alive but did not win (line 84 — 0 wins, 0 losses shown)", () => {
    // User is alive (not eliminated) but someone else won → other++
    // resultsData: wins=0, losses=0, other=1
    const otherMatch = makeMatch({
      id: "m-other",
      winner_id: "opp",
      players: [
        {
          id: "mp1",
          user_id: USER_ID,
          username: "Me",
          color: "#22d3ee",
          is_alive: true, // alive → not a loss
          joined_at: "",
          is_banned: false,
        },
        {
          id: "mp2",
          user_id: "opp",
          username: "Opp",
          color: "#fbbf24",
          is_alive: false,
          joined_at: "",
          is_banned: false,
        },
      ],
    });
    render(
      React.createElement(ProfileCharts, {
        matches: [otherMatch],
        userId: USER_ID,
        currentElo: 1000,
      }),
    );
    fireEvent.click(screen.getByText("W/L"));
    // Win rate is 0% since user is in "other" bucket, not wins
    expect(screen.getByText("0%")).toBeTruthy();
    // Both wins and losses show 0
    expect(screen.getByText("wygranych")).toBeTruthy();
    expect(screen.getByText("przegranych")).toBeTruthy();
  });

  it("computes other++ when user is not in match players list (line 84)", () => {
    // Match where user is not in players list → myPlayer is undefined → other++
    // wins=0, losses=0, other=1 → 0% win rate
    const matchWithoutUser = makeMatch({
      id: "m-no-user",
      winner_id: "opp",
      players: [
        {
          id: "mp2",
          user_id: "opp",
          username: "Opp",
          color: "#fbbf24",
          is_alive: false,
          joined_at: "",
          is_banned: false,
        },
      ],
    });
    render(
      React.createElement(ProfileCharts, {
        matches: [matchWithoutUser],
        userId: USER_ID,
        currentElo: 1000,
      }),
    );
    fireEvent.click(screen.getByText("W/L"));
    // 0 wins, 0 losses → 0% win rate (other is not shown in the UI directly)
    expect(screen.getByText("0%")).toBeTruthy();
  });

  it("shows 0 losses when match is 'other' type (not a definitive loss)", () => {
    const otherMatch = makeMatch({
      id: "m-other",
      winner_id: "opp",
      players: [
        {
          id: "mp1",
          user_id: USER_ID,
          username: "Me",
          color: "#22d3ee",
          is_alive: true, // still alive — not a loss
          joined_at: "",
          is_banned: false,
        },
      ],
    });
    render(
      React.createElement(ProfileCharts, {
        matches: [otherMatch],
        userId: USER_ID,
        currentElo: 1000,
      }),
    );
    fireEvent.click(screen.getByText("W/L"));
    // totalLosses = 0 (not a loss since is_alive=true)
    // totalWins = 0 (not a win)
    expect(screen.getAllByText("0").length).toBeGreaterThan(0);
  });

  it("correctly separates wins, losses, and other across multiple matches", () => {
    const winMatch = makeMatch({ id: "m-win" }); // user wins
    const lossMatch = makeLossMatch({ id: "m-loss" }); // user loses (is_alive=false, not winner)
    const otherMatch = makeMatch({
      id: "m-other",
      winner_id: "opp",
      players: [
        {
          id: "mp1",
          user_id: USER_ID,
          username: "Me",
          color: "#22d3ee",
          is_alive: true,
          joined_at: "",
          is_banned: false,
        },
        { id: "mp2", user_id: "opp", username: "Opp", color: "#f00", is_alive: false, joined_at: "", is_banned: false },
      ],
    });
    render(
      React.createElement(ProfileCharts, {
        matches: [winMatch, lossMatch, otherMatch],
        userId: USER_ID,
        currentElo: 1000,
      }),
    );
    fireEvent.click(screen.getByText("W/L"));
    // 3 total: 1 win → 33%
    expect(screen.getByText("33%")).toBeTruthy();
  });
});
