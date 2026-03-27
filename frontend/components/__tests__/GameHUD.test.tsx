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

import GameHUD from "@/components/game/GameHUD";
import type { GamePlayer } from "@/hooks/useGameSocket";
import type { DiplomacyState } from "@/lib/gameTypes";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const MY_USER_ID = "user-me";
const ENEMY_USER_ID = "user-enemy";

function makePlayer(id: string, overrides: Partial<GamePlayer> = {}): GamePlayer {
  return {
    user_id: id,
    username: id === MY_USER_ID ? "MyPlayer" : "EnemyPlayer",
    color: id === MY_USER_ID ? "#00aaff" : "#ff0000",
    is_alive: true,
    capital_region_id: null,
    energy: 100,
    action_points: 15,
    ...overrides,
  };
}

function makeRankedPlayer(
  id: string,
  overrides: Partial<{
    user_id: string;
    username: string;
    color: string;
    regionCount: number;
    unitCount: number;
    isAlive: boolean;
    isBot: boolean;
  }> = {},
) {
  return {
    user_id: id,
    username: id === MY_USER_ID ? "MyPlayer" : "EnemyPlayer",
    color: id === MY_USER_ID ? "#00aaff" : "#ff0000",
    regionCount: 5,
    unitCount: 100,
    isAlive: true,
    isBot: false,
    ...overrides,
  };
}

function defaultProps(overrides: Partial<Parameters<typeof GameHUD>[0]> = {}) {
  return {
    tick: 0,
    tickIntervalMs: 1000,
    status: "in_progress",
    players: {
      [MY_USER_ID]: makePlayer(MY_USER_ID),
      [ENEMY_USER_ID]: makePlayer(ENEMY_USER_ID),
    },
    rankedPlayers: [makeRankedPlayer(MY_USER_ID), makeRankedPlayer(ENEMY_USER_ID)],
    myUserId: MY_USER_ID,
    myRegionCount: 5,
    myUnitCount: 100,
    myEnergy: 75,
    myActionPoints: 10,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("GameHUD", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── Energy count ───────────────────────────────────────────────────────────

  it("shows player energy count", () => {
    render(<GameHUD {...defaultProps({ myEnergy: 42 })} />);
    expect(screen.getByText("42")).toBeInTheDocument();
  });

  it("shows energy label", () => {
    render(<GameHUD {...defaultProps()} />);
    expect(screen.getByText("Energia")).toBeInTheDocument();
  });

  // ── Region count ───────────────────────────────────────────────────────────

  it("shows region count", () => {
    render(<GameHUD {...defaultProps({ myRegionCount: 7 })} />);
    expect(screen.getByText("7")).toBeInTheDocument();
  });

  it("shows region count label", () => {
    render(<GameHUD {...defaultProps()} />);
    expect(screen.getByText("Regiony")).toBeInTheDocument();
  });

  // ── Unit count ─────────────────────────────────────────────────────────────

  it("shows unit count", () => {
    render(<GameHUD {...defaultProps({ myUnitCount: 250 })} />);
    expect(screen.getByText("250")).toBeInTheDocument();
  });

  it("shows unit count label", () => {
    render(<GameHUD {...defaultProps()} />);
    expect(screen.getByText("Sila")).toBeInTheDocument();
  });

  // ── Tick / clock display ───────────────────────────────────────────────────

  it("shows 00:00 at tick 0", () => {
    render(<GameHUD {...defaultProps({ tick: 0, tickIntervalMs: 1000 })} />);
    expect(screen.getByText("00:00")).toBeInTheDocument();
  });

  it("shows correct clock for elapsed ticks", () => {
    // tick=65, interval=1000ms → 65 seconds → "01:05"
    render(<GameHUD {...defaultProps({ tick: 65, tickIntervalMs: 1000 })} />);
    expect(screen.getByText("01:05")).toBeInTheDocument();
  });

  it("shows hours when elapsed time exceeds 3600 seconds", () => {
    // tick=3601, interval=1000ms → 3601 seconds → "01:00:01"
    render(<GameHUD {...defaultProps({ tick: 3601, tickIntervalMs: 1000 })} />);
    expect(screen.getByText("01:00:01")).toBeInTheDocument();
  });

  it("formats clock correctly with faster tick interval", () => {
    // tick=120, interval=500ms → 60 seconds → "01:00"
    render(<GameHUD {...defaultProps({ tick: 120, tickIntervalMs: 500 })} />);
    expect(screen.getByText("01:00")).toBeInTheDocument();
  });

  // ── Game status display ────────────────────────────────────────────────────

  it('shows "W trakcie" status for in_progress', () => {
    render(<GameHUD {...defaultProps({ status: "in_progress" })} />);
    expect(screen.getByText("W trakcie")).toBeInTheDocument();
  });

  it('shows "Wybor stolicy" for selecting status', () => {
    render(<GameHUD {...defaultProps({ status: "selecting" })} />);
    expect(screen.getByText("Wybor stolicy")).toBeInTheDocument();
  });

  it('shows "Koniec" for finished status', () => {
    render(<GameHUD {...defaultProps({ status: "finished" })} />);
    expect(screen.getByText("Koniec")).toBeInTheDocument();
  });

  it("shows raw status string for unknown status values", () => {
    render(<GameHUD {...defaultProps({ status: "custom_status" })} />);
    expect(screen.getByText("custom_status")).toBeInTheDocument();
  });

  // ── Active players count ───────────────────────────────────────────────────

  it("shows count of alive players", () => {
    const players = {
      [MY_USER_ID]: makePlayer(MY_USER_ID, { is_alive: true }),
      [ENEMY_USER_ID]: makePlayer(ENEMY_USER_ID, { is_alive: true }),
      "user-dead": makePlayer("user-dead", { is_alive: false }),
    };
    render(<GameHUD {...defaultProps({ players })} />);
    expect(screen.getByText("2 aktywnych")).toBeInTheDocument();
  });

  it("shows 0 active players when all are dead", () => {
    const players = {
      [MY_USER_ID]: makePlayer(MY_USER_ID, { is_alive: false }),
      [ENEMY_USER_ID]: makePlayer(ENEMY_USER_ID, { is_alive: false }),
    };
    render(<GameHUD {...defaultProps({ players })} />);
    expect(screen.getByText("0 aktywnych")).toBeInTheDocument();
  });

  // ── Ranking list ──────────────────────────────────────────────────────────

  it("renders player names in ranking", () => {
    render(<GameHUD {...defaultProps()} />);
    expect(screen.getByText(/MyPlayer/)).toBeInTheDocument();
    expect(screen.getByText(/EnemyPlayer/)).toBeInTheDocument();
  });

  it('marks current player with "(Ty)" in ranking', () => {
    render(<GameHUD {...defaultProps()} />);
    expect(screen.getByText(/MyPlayer \(Ty\)/)).toBeInTheDocument();
  });

  it("shows region and unit count per ranked player", () => {
    const rankedPlayers = [makeRankedPlayer(MY_USER_ID, { regionCount: 8, unitCount: 200 })];
    render(<GameHUD {...defaultProps({ rankedPlayers })} />);
    expect(screen.getByText("8r · 200u")).toBeInTheDocument();
  });

  it("shows rank position numbers starting from 1", () => {
    render(<GameHUD {...defaultProps()} />);
    expect(screen.getByText("1")).toBeInTheDocument();
    expect(screen.getByText("2")).toBeInTheDocument();
  });

  it("renders all players in ranking", () => {
    const rankedPlayers = Array.from({ length: 6 }, (_, i) =>
      makeRankedPlayer(`user-${i}`, { username: `Player${i}` }),
    );
    // Patch usernames manually
    rankedPlayers[0].username = "Player0";
    rankedPlayers[1].username = "Player1";
    rankedPlayers[2].username = "Player2";
    rankedPlayers[3].username = "Player3";
    rankedPlayers[4].username = "Player4";
    rankedPlayers[5].username = "Player5";

    render(<GameHUD {...defaultProps({ rankedPlayers })} />);
    // All players should be present (component renders all ranked players)
    expect(screen.getByText(/Player0/)).toBeInTheDocument();
    expect(screen.getByText(/Player5/)).toBeInTheDocument();
  });

  it("shows BOT label for bot players in ranking", () => {
    const rankedPlayers = [makeRankedPlayer(ENEMY_USER_ID, { isBot: true })];
    render(<GameHUD {...defaultProps({ rankedPlayers })} />);
    expect(screen.getByTitle("Bot AI")).toBeInTheDocument();
  });

  it("applies line-through styling for eliminated players", () => {
    const rankedPlayers = [makeRankedPlayer(ENEMY_USER_ID, { isAlive: false, username: "DeadPlayer" })];
    render(<GameHUD {...defaultProps({ rankedPlayers })} />);
    const deadEl = screen.getByText(/DeadPlayer/);
    // line-through is on the parent flex container, not the text span itself
    expect(deadEl.closest("[class*='line-through']")).not.toBeNull();
  });

  // ── Active boosts panel ────────────────────────────────────────────────────

  it("renders no boost panel when player has no active boosts", () => {
    render(<GameHUD {...defaultProps()} />);
    // No boost percentage badges
    expect(screen.queryByText(/\+\d+%/)).not.toBeInTheDocument();
  });

  it("renders deck boost badges", () => {
    const players = {
      [MY_USER_ID]: makePlayer(MY_USER_ID, {
        active_boosts: [{ slug: "boost-unit", params: { effect_type: "unit_bonus", value: 0.2 } }],
      }),
    };
    render(<GameHUD {...defaultProps({ players })} />);
    expect(screen.getByText("+20%")).toBeInTheDocument();
  });

  it("renders match boost badges with countdown", () => {
    const players = {
      [MY_USER_ID]: makePlayer(MY_USER_ID, {
        active_match_boosts: [
          {
            slug: "attack-boost",
            effect_type: "attack_bonus",
            value: 0.3,
            ticks_remaining: 5,
          },
        ],
      }),
    };
    render(<GameHUD {...defaultProps({ players, tickIntervalMs: 1000 })} />);
    expect(screen.getByText("+30%")).toBeInTheDocument();
    // 5 ticks * 1000ms = 5s, ceil(5000/1000) = 5
    expect(screen.getByText("5s")).toBeInTheDocument();
  });

  it("handles empty players object gracefully", () => {
    expect(() => render(<GameHUD {...defaultProps({ players: {} })} />)).not.toThrow();
  });

  it("handles myUserId not found in players gracefully", () => {
    expect(() => render(<GameHUD {...defaultProps({ myUserId: "nonexistent" })} />)).not.toThrow();
  });

  // ── Connected / disconnected states ────────────────────────────────────────

  it('shows "Rozlaczono" when connected is false', () => {
    render(<GameHUD {...defaultProps({ connected: false })} />);
    expect(screen.getByText("Rozlaczono")).toBeInTheDocument();
  });

  it("shows FPS counter when connected is true and fps is provided", () => {
    render(<GameHUD {...defaultProps({ connected: true, fps: 60 })} />);
    expect(screen.getByText("60 FPS")).toBeInTheDocument();
  });

  it("shows ping counter when connected is true and ping is provided", () => {
    render(<GameHUD {...defaultProps({ connected: true, ping: 45 })} />);
    expect(screen.getByText("45ms")).toBeInTheDocument();
  });

  it("does not show FPS when connected is false even if fps is provided", () => {
    render(<GameHUD {...defaultProps({ connected: false, fps: 60 })} />);
    expect(screen.queryByText("60 FPS")).not.toBeInTheDocument();
  });

  it("does not show ping when connected is false", () => {
    render(<GameHUD {...defaultProps({ connected: false, ping: 45 })} />);
    expect(screen.queryByText("45ms")).not.toBeInTheDocument();
  });

  // ── AP stat component ───────────────────────────────────────────────────────

  it("shows action points value", () => {
    render(<GameHUD {...defaultProps({ myActionPoints: 7 })} />);
    expect(screen.getByText("7")).toBeInTheDocument();
  });

  it("shows AP label", () => {
    render(<GameHUD {...defaultProps()} />);
    expect(screen.getByText("AP")).toBeInTheDocument();
  });

  it("shows AP max denominator", () => {
    render(<GameHUD {...defaultProps({ myActionPoints: 5 })} />);
    expect(screen.getByText("/15")).toBeInTheDocument();
  });

  it("renders AP stat at low AP (< 3) without crashing", () => {
    expect(() => render(<GameHUD {...defaultProps({ myActionPoints: 2 })} />)).not.toThrow();
  });

  it("renders AP stat at mid AP (3–5) without crashing", () => {
    expect(() => render(<GameHUD {...defaultProps({ myActionPoints: 4 })} />)).not.toThrow();
  });

  it("renders AP stat at high AP (>= 6) without crashing", () => {
    expect(() => render(<GameHUD {...defaultProps({ myActionPoints: 8 })} />)).not.toThrow();
  });

  // ── Capital protection timer ────────────────────────────────────────────────

  it("shows capital protection timer when protection is active", () => {
    render(
      <GameHUD
        {...defaultProps({
          tick: 5,
          tickIntervalMs: 1000,
          status: "in_progress",
          capitalProtectionTicks: 30,
        })}
      />,
    );
    expect(screen.getByText("Ochrona stolic")).toBeInTheDocument();
  });

  it("does not show capital protection timer when ticks have expired", () => {
    render(
      <GameHUD
        {...defaultProps({
          tick: 50,
          tickIntervalMs: 1000,
          status: "in_progress",
          capitalProtectionTicks: 30,
        })}
      />,
    );
    expect(screen.queryByText("Ochrona stolic")).not.toBeInTheDocument();
  });

  it("does not show capital protection when status is finished", () => {
    render(
      <GameHUD
        {...defaultProps({
          tick: 5,
          tickIntervalMs: 1000,
          status: "finished",
          capitalProtectionTicks: 30,
        })}
      />,
    );
    expect(screen.queryByText("Ochrona stolic")).not.toBeInTheDocument();
  });

  it("does not show protection timer when capitalProtectionTicks is 0", () => {
    render(
      <GameHUD
        {...defaultProps({
          tick: 0,
          capitalProtectionTicks: 0,
        })}
      />,
    );
    expect(screen.queryByText("Ochrona stolic")).not.toBeInTheDocument();
  });

  // ── Diplomacy: relation badges ──────────────────────────────────────────────

  it("shows war badge for player in war", () => {
    const diplomacy: DiplomacyState = {
      wars: [
        {
          player_a: MY_USER_ID,
          player_b: ENEMY_USER_ID,
          started_tick: 1,
          aggressor_id: MY_USER_ID,
          provinces_changed: [],
        },
      ],
      pacts: [],
      proposals: [],
    };
    render(<GameHUD {...defaultProps({ diplomacy })} />);
    expect(screen.getByTitle("W wojnie")).toBeInTheDocument();
  });

  it("shows NAP badge for player in pact", () => {
    const diplomacy: DiplomacyState = {
      wars: [],
      pacts: [
        {
          id: "pact-1",
          pact_type: "nap",
          player_a: MY_USER_ID,
          player_b: ENEMY_USER_ID,
          created_tick: 1,
          expires_tick: null,
        },
      ],
      proposals: [],
    };
    render(<GameHUD {...defaultProps({ diplomacy })} />);
    expect(screen.getByTitle("Pakt o nieagresji")).toBeInTheDocument();
  });

  it("shows neutral relation (no badge) when no wars or pacts", () => {
    const diplomacy: DiplomacyState = { wars: [], pacts: [], proposals: [] };
    render(<GameHUD {...defaultProps({ diplomacy })} />);
    expect(screen.queryByTitle("W wojnie")).not.toBeInTheDocument();
    expect(screen.queryByTitle("Pakt o nieagresji")).not.toBeInTheDocument();
  });

  // ── Diplomacy: expanded actions ─────────────────────────────────────────────

  it("expands player row when enemy player row is clicked", () => {
    render(<GameHUD {...defaultProps()} />);
    const enemyRows = screen.getAllByRole("button");
    // Find the row button for the enemy player
    const enemyRow = enemyRows.find((el) => el.textContent?.includes("EnemyPlayer"));
    if (enemyRow) {
      fireEvent.click(enemyRow);
    } else {
      // The enemy row might not have role=button; find by text
      const enemy = screen.getByText(/EnemyPlayer/);
      fireEvent.click(enemy.closest("[role='button']") ?? enemy);
    }
    // Expanded section should appear — propose pact and declare war buttons
    expect(screen.queryByText(/Zaproponuj pakt|Oczekuje|Zaproponuj pokoj|Zerwij pakt/)).not.toBeNull();
  });

  it("shows 'Zaproponuj pakt' and 'Wypowiedz wojne' for neutral player when expanded", () => {
    const diplomacy: DiplomacyState = { wars: [], pacts: [], proposals: [] };
    render(<GameHUD {...defaultProps({ diplomacy })} />);
    const enemyName = screen.getByText(/EnemyPlayer/);
    const row = enemyName.closest("[role='button']");
    fireEvent.click(row!);
    expect(screen.getByText("Zaproponuj pakt")).toBeInTheDocument();
    expect(screen.getByText("Wypowiedz wojne")).toBeInTheDocument();
  });

  it("calls onProposePact when 'Zaproponuj pakt' button is clicked", () => {
    const onProposePact = vi.fn();
    const diplomacy: DiplomacyState = { wars: [], pacts: [], proposals: [] };
    render(<GameHUD {...defaultProps({ diplomacy, onProposePact })} />);
    const enemyName = screen.getByText(/EnemyPlayer/);
    const row = enemyName.closest("[role='button']");
    fireEvent.click(row!);
    fireEvent.click(screen.getByText("Zaproponuj pakt"));
    expect(onProposePact).toHaveBeenCalledWith(ENEMY_USER_ID);
  });

  it("calls onDeclareWar when 'Wypowiedz wojne' button is clicked", () => {
    const onDeclareWar = vi.fn();
    const diplomacy: DiplomacyState = { wars: [], pacts: [], proposals: [] };
    render(<GameHUD {...defaultProps({ diplomacy, onDeclareWar })} />);
    const enemyName = screen.getByText(/EnemyPlayer/);
    const row = enemyName.closest("[role='button']");
    fireEvent.click(row!);
    fireEvent.click(screen.getByText("Wypowiedz wojne"));
    expect(onDeclareWar).toHaveBeenCalledWith(ENEMY_USER_ID);
  });

  it("shows 'Zaproponuj pokoj' for player in war when expanded", () => {
    const diplomacy: DiplomacyState = {
      wars: [
        {
          player_a: MY_USER_ID,
          player_b: ENEMY_USER_ID,
          started_tick: 1,
          aggressor_id: MY_USER_ID,
          provinces_changed: [],
        },
      ],
      pacts: [],
      proposals: [],
    };
    render(<GameHUD {...defaultProps({ diplomacy })} />);
    const enemyName = screen.getByText(/EnemyPlayer/);
    const row = enemyName.closest("[role='button']");
    fireEvent.click(row!);
    expect(screen.getByText("Zaproponuj pokoj")).toBeInTheDocument();
  });

  it("calls onProposePeace when 'Zaproponuj pokoj' is clicked in war state", () => {
    const onProposePeace = vi.fn();
    const diplomacy: DiplomacyState = {
      wars: [
        {
          player_a: MY_USER_ID,
          player_b: ENEMY_USER_ID,
          started_tick: 1,
          aggressor_id: MY_USER_ID,
          provinces_changed: [],
        },
      ],
      pacts: [],
      proposals: [],
    };
    render(<GameHUD {...defaultProps({ diplomacy, onProposePeace })} />);
    const enemyName = screen.getByText(/EnemyPlayer/);
    const row = enemyName.closest("[role='button']");
    fireEvent.click(row!);
    fireEvent.click(screen.getByText("Zaproponuj pokoj"));
    expect(onProposePeace).toHaveBeenCalledWith(ENEMY_USER_ID, "status_quo");
  });

  it("shows 'Zerwij pakt' for player in pact when expanded", () => {
    const diplomacy: DiplomacyState = {
      wars: [],
      pacts: [
        {
          id: "pact-1",
          pact_type: "nap",
          player_a: MY_USER_ID,
          player_b: ENEMY_USER_ID,
          created_tick: 1,
          expires_tick: null,
        },
      ],
      proposals: [],
    };
    render(<GameHUD {...defaultProps({ diplomacy })} />);
    const enemyName = screen.getByText(/EnemyPlayer/);
    const row = enemyName.closest("[role='button']");
    fireEvent.click(row!);
    expect(screen.getByText("Zerwij pakt")).toBeInTheDocument();
  });

  it("calls onBreakPact when 'Zerwij pakt' is clicked", () => {
    const onBreakPact = vi.fn();
    const diplomacy: DiplomacyState = {
      wars: [],
      pacts: [
        {
          id: "pact-999",
          pact_type: "nap",
          player_a: MY_USER_ID,
          player_b: ENEMY_USER_ID,
          created_tick: 1,
          expires_tick: null,
        },
      ],
      proposals: [],
    };
    render(<GameHUD {...defaultProps({ diplomacy, onBreakPact })} />);
    const enemyName = screen.getByText(/EnemyPlayer/);
    const row = enemyName.closest("[role='button']");
    fireEvent.click(row!);
    fireEvent.click(screen.getByText("Zerwij pakt"));
    expect(onBreakPact).toHaveBeenCalledWith("pact-999");
  });

  it("shows 'Oczekuje na odpowiedz' for player with outgoing pending proposal", () => {
    const diplomacy: DiplomacyState = {
      wars: [],
      pacts: [],
      proposals: [
        {
          id: "prop-1",
          proposal_type: "nap",
          from_player_id: MY_USER_ID,
          to_player_id: ENEMY_USER_ID,
          created_tick: 1,
          conditions: null,
          status: "pending",
          rejected_tick: null,
          expires_tick: null,
        },
      ],
    };
    render(<GameHUD {...defaultProps({ diplomacy })} />);
    const enemyName = screen.getByText(/EnemyPlayer/);
    const row = enemyName.closest("[role='button']");
    fireEvent.click(row!);
    expect(screen.getByText("Oczekuje na odpowiedz...")).toBeInTheDocument();
  });

  it("collapses expanded player row when clicked again", () => {
    const diplomacy: DiplomacyState = { wars: [], pacts: [], proposals: [] };
    render(<GameHUD {...defaultProps({ diplomacy })} />);
    const enemyName = screen.getByText(/EnemyPlayer/);
    const row = enemyName.closest("[role='button']");
    // Expand
    fireEvent.click(row!);
    expect(screen.getByText("Zaproponuj pakt")).toBeInTheDocument();
    // Collapse
    fireEvent.click(row!);
    expect(screen.queryByText("Zaproponuj pakt")).not.toBeInTheDocument();
  });

  it("does not expand when clicking on own player row", () => {
    const diplomacy: DiplomacyState = { wars: [], pacts: [], proposals: [] };
    render(<GameHUD {...defaultProps({ diplomacy })} />);
    const myName = screen.getByText(/MyPlayer \(Ty\)/);
    fireEvent.click(myName);
    // No diplomacy actions should appear
    expect(screen.queryByText("Zaproponuj pakt")).not.toBeInTheDocument();
  });

  // ── Diplomacy: incoming proposals ──────────────────────────────────────────

  it("shows incoming pact proposal from another player", () => {
    const players = {
      [MY_USER_ID]: makePlayer(MY_USER_ID),
      [ENEMY_USER_ID]: makePlayer(ENEMY_USER_ID),
    };
    const diplomacy: DiplomacyState = {
      wars: [],
      pacts: [],
      proposals: [
        {
          id: "incoming-1",
          proposal_type: "nap",
          from_player_id: ENEMY_USER_ID,
          to_player_id: MY_USER_ID,
          created_tick: 1,
          conditions: null,
          status: "pending",
          rejected_tick: null,
          expires_tick: null,
        },
      ],
    };
    render(<GameHUD {...defaultProps({ players, diplomacy })} />);
    // The proposals panel renders with "Propozycje" header
    expect(screen.getByText("Propozycje")).toBeInTheDocument();
    expect(screen.getByText(/pakt o nieagresji/)).toBeInTheDocument();
  });

  it("shows incoming peace proposal label", () => {
    const players = {
      [MY_USER_ID]: makePlayer(MY_USER_ID),
      [ENEMY_USER_ID]: makePlayer(ENEMY_USER_ID),
    };
    const diplomacy: DiplomacyState = {
      wars: [],
      pacts: [],
      proposals: [
        {
          id: "incoming-2",
          proposal_type: "peace",
          from_player_id: ENEMY_USER_ID,
          to_player_id: MY_USER_ID,
          created_tick: 1,
          conditions: null,
          status: "pending",
          rejected_tick: null,
          expires_tick: null,
        },
      ],
    };
    render(<GameHUD {...defaultProps({ players, diplomacy })} />);
    expect(screen.getByText(/pokoj/)).toBeInTheDocument();
  });

  it("shows expiry countdown for incoming proposal with expires_tick", () => {
    const players = {
      [MY_USER_ID]: makePlayer(MY_USER_ID),
      [ENEMY_USER_ID]: makePlayer(ENEMY_USER_ID),
    };
    const diplomacy: DiplomacyState = {
      wars: [],
      pacts: [],
      proposals: [
        {
          id: "incoming-3",
          proposal_type: "nap",
          from_player_id: ENEMY_USER_ID,
          to_player_id: MY_USER_ID,
          created_tick: 1,
          conditions: null,
          status: "pending",
          rejected_tick: null,
          expires_tick: 20,
        },
      ],
    };
    // tick=5, expires_tick=20, interval=1000ms → 15 ticks remaining → 15s
    render(<GameHUD {...defaultProps({ players, diplomacy, tick: 5, tickIntervalMs: 1000 })} />);
    expect(screen.getByText("15s")).toBeInTheDocument();
  });

  it("calls onRespondPact(accept=true) when Akceptuj clicked for nap proposal", () => {
    const onRespondPact = vi.fn();
    const players = {
      [MY_USER_ID]: makePlayer(MY_USER_ID),
      [ENEMY_USER_ID]: makePlayer(ENEMY_USER_ID),
    };
    const diplomacy: DiplomacyState = {
      wars: [],
      pacts: [],
      proposals: [
        {
          id: "prop-accept",
          proposal_type: "nap",
          from_player_id: ENEMY_USER_ID,
          to_player_id: MY_USER_ID,
          created_tick: 1,
          conditions: null,
          status: "pending",
          rejected_tick: null,
          expires_tick: null,
        },
      ],
    };
    render(<GameHUD {...defaultProps({ players, diplomacy, onRespondPact })} />);
    fireEvent.click(screen.getByText("Akceptuj"));
    expect(onRespondPact).toHaveBeenCalledWith("prop-accept", true);
  });

  it("calls onRespondPact(accept=false) when Odrzuc clicked for nap proposal", () => {
    const onRespondPact = vi.fn();
    const players = {
      [MY_USER_ID]: makePlayer(MY_USER_ID),
      [ENEMY_USER_ID]: makePlayer(ENEMY_USER_ID),
    };
    const diplomacy: DiplomacyState = {
      wars: [],
      pacts: [],
      proposals: [
        {
          id: "prop-reject",
          proposal_type: "nap",
          from_player_id: ENEMY_USER_ID,
          to_player_id: MY_USER_ID,
          created_tick: 1,
          conditions: null,
          status: "pending",
          rejected_tick: null,
          expires_tick: null,
        },
      ],
    };
    render(<GameHUD {...defaultProps({ players, diplomacy, onRespondPact })} />);
    fireEvent.click(screen.getByText("Odrzuc"));
    expect(onRespondPact).toHaveBeenCalledWith("prop-reject", false);
  });

  it("calls onRespondPeace(accept=true) when Akceptuj clicked for peace proposal", () => {
    const onRespondPeace = vi.fn();
    const players = {
      [MY_USER_ID]: makePlayer(MY_USER_ID),
      [ENEMY_USER_ID]: makePlayer(ENEMY_USER_ID),
    };
    const diplomacy: DiplomacyState = {
      wars: [],
      pacts: [],
      proposals: [
        {
          id: "peace-accept",
          proposal_type: "peace",
          from_player_id: ENEMY_USER_ID,
          to_player_id: MY_USER_ID,
          created_tick: 1,
          conditions: null,
          status: "pending",
          rejected_tick: null,
          expires_tick: null,
        },
      ],
    };
    render(<GameHUD {...defaultProps({ players, diplomacy, onRespondPeace })} />);
    fireEvent.click(screen.getByText("Akceptuj"));
    expect(onRespondPeace).toHaveBeenCalledWith("peace-accept", true);
  });

  it("calls onRespondPeace(accept=false) when Odrzuc clicked for peace proposal", () => {
    const onRespondPeace = vi.fn();
    const players = {
      [MY_USER_ID]: makePlayer(MY_USER_ID),
      [ENEMY_USER_ID]: makePlayer(ENEMY_USER_ID),
    };
    const diplomacy: DiplomacyState = {
      wars: [],
      pacts: [],
      proposals: [
        {
          id: "peace-reject",
          proposal_type: "peace",
          from_player_id: ENEMY_USER_ID,
          to_player_id: MY_USER_ID,
          created_tick: 1,
          conditions: null,
          status: "pending",
          rejected_tick: null,
          expires_tick: null,
        },
      ],
    };
    render(<GameHUD {...defaultProps({ players, diplomacy, onRespondPeace })} />);
    fireEvent.click(screen.getByText("Odrzuc"));
    expect(onRespondPeace).toHaveBeenCalledWith("peace-reject", false);
  });

  it("skips proposal rendering when from_player_id not found in players", () => {
    const diplomacy: DiplomacyState = {
      wars: [],
      pacts: [],
      proposals: [
        {
          id: "ghost-prop",
          proposal_type: "nap",
          from_player_id: "ghost-user",
          to_player_id: MY_USER_ID,
          created_tick: 1,
          conditions: null,
          status: "pending",
          rejected_tick: null,
          expires_tick: null,
        },
      ],
    };
    expect(() => render(<GameHUD {...defaultProps({ diplomacy })} />)).not.toThrow();
    // Akceptuj / Odrzuc should not appear because the sender is unknown
    expect(screen.queryByText("Akceptuj")).not.toBeInTheDocument();
  });

  // ── Emblem cosmetics ───────────────────────────────────────────────────────

  it("renders emblem image when player cosmetics include string emblem url", () => {
    const rankedPlayers = [
      {
        ...makeRankedPlayer(ENEMY_USER_ID, { username: "EmblemPlayer" }),
        cosmetics: { emblem: "/assets/emblems/test.png" },
      },
    ];
    render(<GameHUD {...defaultProps({ rankedPlayers })} />);
    const img = document.querySelector('img[src="/assets/emblems/test.png"]');
    expect(img).not.toBeNull();
  });

  it("renders emblem image when cosmetics emblem is object with url field", () => {
    const rankedPlayers = [
      {
        ...makeRankedPlayer(ENEMY_USER_ID, { username: "EmblemObjPlayer" }),
        cosmetics: { emblem: { url: "/assets/emblems/obj.png" } },
      },
    ];
    render(<GameHUD {...defaultProps({ rankedPlayers })} />);
    const img = document.querySelector('img[src="/assets/emblems/obj.png"]');
    expect(img).not.toBeNull();
  });

  it("renders clan tag when rankedPlayer has clan_tag", () => {
    const rankedPlayers = [
      {
        ...makeRankedPlayer(ENEMY_USER_ID, { username: "ClanPlayer" }),
        clan_tag: "GRP",
      },
    ];
    render(<GameHUD {...defaultProps({ rankedPlayers })} />);
    expect(screen.getByText(/\[GRP\]/)).toBeInTheDocument();
  });

  it("shows teammate badge when player is on the same team", () => {
    const players = {
      [MY_USER_ID]: makePlayer(MY_USER_ID, { team: "team-a" }),
      [ENEMY_USER_ID]: makePlayer(ENEMY_USER_ID, { team: "team-a" }),
    };
    render(<GameHUD {...defaultProps({ players })} />);
    expect(screen.getByTitle("Sojusznik")).toBeInTheDocument();
  });

  // ── Keyboard accessibility ──────────────────────────────────────────────────

  it("expands player row on Enter key press", () => {
    const diplomacy: DiplomacyState = { wars: [], pacts: [], proposals: [] };
    render(<GameHUD {...defaultProps({ diplomacy })} />);
    const enemyName = screen.getByText(/EnemyPlayer/);
    const row = enemyName.closest("[role='button']");
    fireEvent.keyDown(row!, { key: "Enter" });
    expect(screen.getByText("Zaproponuj pakt")).toBeInTheDocument();
  });

  it("expands player row on Space key press", () => {
    const diplomacy: DiplomacyState = { wars: [], pacts: [], proposals: [] };
    render(<GameHUD {...defaultProps({ diplomacy })} />);
    const enemyName = screen.getByText(/EnemyPlayer/);
    const row = enemyName.closest("[role='button']");
    fireEvent.keyDown(row!, { key: " " });
    expect(screen.getByText("Zaproponuj pakt")).toBeInTheDocument();
  });

  it("does not expand on other key presses", () => {
    const diplomacy: DiplomacyState = { wars: [], pacts: [], proposals: [] };
    render(<GameHUD {...defaultProps({ diplomacy })} />);
    const enemyName = screen.getByText(/EnemyPlayer/);
    const row = enemyName.closest("[role='button']");
    fireEvent.keyDown(row!, { key: "Tab" });
    expect(screen.queryByText("Zaproponuj pakt")).not.toBeInTheDocument();
  });
});
