import { act, render, screen } from "@testing-library/react";
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Mock gsap — avoid animation side-effects in tests
// ---------------------------------------------------------------------------

vi.mock("gsap", () => {
  const timeline = {
    fromTo: vi.fn().mockReturnThis(),
    to: vi.fn().mockReturnThis(),
  };
  return {
    default: {
      timeline: vi.fn(() => timeline),
      to: vi.fn(),
      fromTo: vi.fn(),
    },
  };
});

vi.mock("@gsap/react", () => ({
  useGSAP: vi.fn((fn: () => void) => {
    // Execute the GSAP setup function immediately so we can test it doesn't crash
    try {
      fn();
    } catch {
      /* ignore GSAP errors in tests */
    }
  }),
}));

// ---------------------------------------------------------------------------
// Mock lucide-react
// ---------------------------------------------------------------------------

vi.mock("lucide-react", () => ({
  Loader2: ({ className }: { className?: string }) =>
    React.createElement("span", { "data-testid": "icon-loader", className }),
  Swords: ({ className }: { className?: string }) =>
    React.createElement("span", { "data-testid": "icon-swords", className }),
  CheckCircle2: ({ className }: { className?: string }) =>
    React.createElement("span", { "data-testid": "icon-check-circle", className }),
}));

import MatchIntroOverlay, { type MatchIntroOverlayProps } from "@/components/game/MatchIntroOverlay";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const PLAYER_ME = {
  user_id: "user-me",
  username: "Alpha",
  color: "#22d3ee",
};

const PLAYER_OPPONENT = {
  user_id: "user-opp",
  username: "Bravo",
  color: "#fbbf24",
};

const PLAYER_BOT = {
  user_id: "bot-1",
  username: "Bot",
  color: "#4ade80",
  is_bot: true,
};

function makeProps(overrides: Partial<MatchIntroOverlayProps> = {}): MatchIntroOverlayProps {
  return {
    players: {
      "user-me": PLAYER_ME,
      "user-opp": PLAYER_OPPONENT,
    },
    myUserId: "user-me",
    connected: true,
    gameStateLoaded: true,
    mapReady: false,
    onComplete: vi.fn(),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("MatchIntroOverlay", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("renders the overlay container with aria-label", () => {
    render(React.createElement(MatchIntroOverlay, makeProps()));
    const modal = screen.getByLabelText("Przygotowanie do bitwy");
    expect(modal).toBeTruthy();
  });

  it('renders the "Przygotowanie do Bitwy" title', () => {
    render(React.createElement(MatchIntroOverlay, makeProps()));
    expect(screen.getByText("Przygotowanie do Bitwy")).toBeTruthy();
  });

  it("renders the MapLord eyebrow text", () => {
    render(React.createElement(MatchIntroOverlay, makeProps()));
    expect(screen.getByText("MapLord")).toBeTruthy();
  });

  it("renders both player usernames in a 1v1 match", () => {
    render(React.createElement(MatchIntroOverlay, makeProps()));
    // CSS `text-transform: uppercase` is not applied by jsdom — text content is original casing
    expect(screen.getByText("Alpha")).toBeTruthy();
    expect(screen.getByText("Bravo")).toBeTruthy();
  });

  it('shows "(Ty)" label for the current user', () => {
    render(React.createElement(MatchIntroOverlay, makeProps()));
    expect(screen.getByText("(Ty)")).toBeTruthy();
  });

  it("renders VS text in 1v1 (duel) layout", () => {
    render(React.createElement(MatchIntroOverlay, makeProps()));
    expect(screen.getByText("VS")).toBeTruthy();
  });

  it("shows swords icons in 1v1 layout", () => {
    render(React.createElement(MatchIntroOverlay, makeProps()));
    const swords = screen.getAllByTestId("icon-swords");
    expect(swords.length).toBeGreaterThanOrEqual(1);
  });

  it("renders loading state when mapReady is false", () => {
    render(React.createElement(MatchIntroOverlay, makeProps({ mapReady: false })));
    expect(screen.getByText("Ładowanie mapy...")).toBeTruthy();
    expect(screen.getByTestId("icon-loader")).toBeTruthy();
  });

  it('renders "Gotowe!" when all conditions met and min time elapsed', async () => {
    render(
      React.createElement(MatchIntroOverlay, makeProps({ mapReady: true, connected: true, gameStateLoaded: true })),
    );
    await act(async () => {
      vi.advanceTimersByTime(3001);
    });
    expect(screen.getByText("Gotowe!")).toBeTruthy();
  });

  it("still shows overlay when mapReady=true but min time has not elapsed", () => {
    render(
      React.createElement(MatchIntroOverlay, makeProps({ mapReady: true, connected: true, gameStateLoaded: true })),
    );
    // Don't advance timers — min time not elapsed, overlay still visible
    // Component renders but has not completed/dismissed yet
    expect(screen.getByLabelText("Przygotowanie do bitwy")).toBeTruthy();
  });

  it('renders FFA layout "Wszyscy Przeciw Wszystkim" for >2 players', () => {
    const props = makeProps({
      players: {
        "user-me": PLAYER_ME,
        "user-opp": PLAYER_OPPONENT,
        "bot-1": PLAYER_BOT,
      },
    });
    render(React.createElement(MatchIntroOverlay, props));
    expect(screen.getByText("Wszyscy Przeciw Wszystkim")).toBeTruthy();
  });

  it("shows BOT badge for bot players", () => {
    const props = makeProps({
      players: {
        "user-me": PLAYER_ME,
        "bot-1": { ...PLAYER_BOT, user_id: "bot-1" },
      },
    });
    render(React.createElement(MatchIntroOverlay, props));
    expect(screen.getByText("BOT")).toBeTruthy();
  });

  it("shows player color hex labels", () => {
    render(React.createElement(MatchIntroOverlay, makeProps()));
    expect(screen.getByText("#22d3ee")).toBeTruthy();
    expect(screen.getByText("#fbbf24")).toBeTruthy();
  });

  it("renders progress dots", () => {
    const { container } = render(React.createElement(MatchIntroOverlay, makeProps()));
    // Progress dots for each step (4 steps: connect, game state, map, ready)
    const dots = container.querySelectorAll(".inline-block.h-1\\.5.w-1\\.5.rounded-full");
    expect(dots.length).toBe(4);
  });

  it("renders player initial avatar letters", () => {
    render(React.createElement(MatchIntroOverlay, makeProps()));
    expect(screen.getByText("A")).toBeTruthy(); // Alpha → A
    expect(screen.getByText("B")).toBeTruthy(); // Bravo → B
  });

  it('does not show "(Ty)" for the opponent', () => {
    render(React.createElement(MatchIntroOverlay, makeProps()));
    const tyElements = screen.queryAllByText("(Ty)");
    // Only one "(Ty)" label should exist
    expect(tyElements.length).toBe(1);
  });
});
