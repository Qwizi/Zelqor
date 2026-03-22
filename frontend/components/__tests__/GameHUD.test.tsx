import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import React from 'react'

// ---------------------------------------------------------------------------
// Mock next/image
// ---------------------------------------------------------------------------

vi.mock('next/image', () => ({
  default: ({
    src,
    alt,
    width,
    height,
    className,
  }: {
    src: string
    alt: string
    width?: number
    height?: number
    className?: string
  }) => React.createElement('img', { src, alt, width, height, className }),
}))

import GameHUD from '@/components/game/GameHUD'
import type { GamePlayer } from '@/hooks/useGameSocket'

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const MY_USER_ID = 'user-me'
const ENEMY_USER_ID = 'user-enemy'

function makePlayer(
  id: string,
  overrides: Partial<GamePlayer> = {}
): GamePlayer {
  return {
    user_id: id,
    username: id === MY_USER_ID ? 'MyPlayer' : 'EnemyPlayer',
    color: id === MY_USER_ID ? '#00aaff' : '#ff0000',
    is_alive: true,
    capital_region_id: null,
    energy: 100,
    ...overrides,
  }
}

function makeRankedPlayer(
  id: string,
  overrides: Partial<{
    user_id: string
    username: string
    color: string
    regionCount: number
    unitCount: number
    isAlive: boolean
    isBot: boolean
  }> = {}
) {
  return {
    user_id: id,
    username: id === MY_USER_ID ? 'MyPlayer' : 'EnemyPlayer',
    color: id === MY_USER_ID ? '#00aaff' : '#ff0000',
    regionCount: 5,
    unitCount: 100,
    isAlive: true,
    isBot: false,
    ...overrides,
  }
}

function defaultProps(
  overrides: Partial<Parameters<typeof GameHUD>[0]> = {}
) {
  return {
    tick: 0,
    tickIntervalMs: 1000,
    status: 'in_progress',
    players: {
      [MY_USER_ID]: makePlayer(MY_USER_ID),
      [ENEMY_USER_ID]: makePlayer(ENEMY_USER_ID),
    },
    rankedPlayers: [
      makeRankedPlayer(MY_USER_ID),
      makeRankedPlayer(ENEMY_USER_ID),
    ],
    myUserId: MY_USER_ID,
    myRegionCount: 5,
    myUnitCount: 100,
    myEnergy: 75,
    myActionPoints: 10,
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('GameHUD', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // ── Energy count ───────────────────────────────────────────────────────────

  it('shows player energy count', () => {
    render(<GameHUD {...defaultProps({ myEnergy: 42 })} />)
    expect(screen.getByText('42')).toBeInTheDocument()
  })

  it('shows energy label', () => {
    render(<GameHUD {...defaultProps()} />)
    expect(screen.getByText('Energia')).toBeInTheDocument()
  })

  // ── Region count ───────────────────────────────────────────────────────────

  it('shows region count', () => {
    render(<GameHUD {...defaultProps({ myRegionCount: 7 })} />)
    expect(screen.getByText('7')).toBeInTheDocument()
  })

  it('shows region count label', () => {
    render(<GameHUD {...defaultProps()} />)
    expect(screen.getByText('Regiony')).toBeInTheDocument()
  })

  // ── Unit count ─────────────────────────────────────────────────────────────

  it('shows unit count', () => {
    render(<GameHUD {...defaultProps({ myUnitCount: 250 })} />)
    expect(screen.getByText('250')).toBeInTheDocument()
  })

  it('shows unit count label', () => {
    render(<GameHUD {...defaultProps()} />)
    expect(screen.getByText('Siła')).toBeInTheDocument()
  })

  // ── Tick / clock display ───────────────────────────────────────────────────

  it('shows 00:00 at tick 0', () => {
    render(<GameHUD {...defaultProps({ tick: 0, tickIntervalMs: 1000 })} />)
    expect(screen.getByText('00:00')).toBeInTheDocument()
  })

  it('shows correct clock for elapsed ticks', () => {
    // tick=65, interval=1000ms → 65 seconds → "01:05"
    render(<GameHUD {...defaultProps({ tick: 65, tickIntervalMs: 1000 })} />)
    expect(screen.getByText('01:05')).toBeInTheDocument()
  })

  it('shows hours when elapsed time exceeds 3600 seconds', () => {
    // tick=3601, interval=1000ms → 3601 seconds → "01:00:01"
    render(
      <GameHUD {...defaultProps({ tick: 3601, tickIntervalMs: 1000 })} />
    )
    expect(screen.getByText('01:00:01')).toBeInTheDocument()
  })

  it('formats clock correctly with faster tick interval', () => {
    // tick=120, interval=500ms → 60 seconds → "01:00"
    render(<GameHUD {...defaultProps({ tick: 120, tickIntervalMs: 500 })} />)
    expect(screen.getByText('01:00')).toBeInTheDocument()
  })

  // ── Game status display ────────────────────────────────────────────────────

  it('shows "W trakcie" status for in_progress', () => {
    render(<GameHUD {...defaultProps({ status: 'in_progress' })} />)
    expect(screen.getByText('W trakcie')).toBeInTheDocument()
  })

  it('shows "Wybór stolicy" for selecting status', () => {
    render(<GameHUD {...defaultProps({ status: 'selecting' })} />)
    expect(screen.getByText('Wybór stolicy')).toBeInTheDocument()
  })

  it('shows "Koniec" for finished status', () => {
    render(<GameHUD {...defaultProps({ status: 'finished' })} />)
    expect(screen.getByText('Koniec')).toBeInTheDocument()
  })

  it('shows raw status string for unknown status values', () => {
    render(<GameHUD {...defaultProps({ status: 'custom_status' })} />)
    expect(screen.getByText('custom_status')).toBeInTheDocument()
  })

  // ── Active players count ───────────────────────────────────────────────────

  it('shows count of alive players', () => {
    const players = {
      [MY_USER_ID]: makePlayer(MY_USER_ID, { is_alive: true }),
      [ENEMY_USER_ID]: makePlayer(ENEMY_USER_ID, { is_alive: true }),
      'user-dead': makePlayer('user-dead', { is_alive: false }),
    }
    render(<GameHUD {...defaultProps({ players })} />)
    expect(screen.getByText('2 aktywnych')).toBeInTheDocument()
  })

  it('shows 0 active players when all are dead', () => {
    const players = {
      [MY_USER_ID]: makePlayer(MY_USER_ID, { is_alive: false }),
      [ENEMY_USER_ID]: makePlayer(ENEMY_USER_ID, { is_alive: false }),
    }
    render(<GameHUD {...defaultProps({ players })} />)
    expect(screen.getByText('0 aktywnych')).toBeInTheDocument()
  })

  // ── Ranking list ──────────────────────────────────────────────────────────

  it('renders player names in ranking', () => {
    render(<GameHUD {...defaultProps()} />)
    expect(screen.getByText(/MyPlayer/)).toBeInTheDocument()
    expect(screen.getByText(/EnemyPlayer/)).toBeInTheDocument()
  })

  it('marks current player with "(Ty)" in ranking', () => {
    render(<GameHUD {...defaultProps()} />)
    expect(screen.getByText(/MyPlayer \(Ty\)/)).toBeInTheDocument()
  })

  it('shows region and unit count per ranked player', () => {
    const rankedPlayers = [makeRankedPlayer(MY_USER_ID, { regionCount: 8, unitCount: 200 })]
    render(<GameHUD {...defaultProps({ rankedPlayers })} />)
    expect(screen.getByText('8r · 200u')).toBeInTheDocument()
  })

  it('shows rank position numbers starting from 1', () => {
    render(<GameHUD {...defaultProps()} />)
    expect(screen.getByText('1')).toBeInTheDocument()
    expect(screen.getByText('2')).toBeInTheDocument()
  })

  it('only shows top 4 players in ranking', () => {
    const rankedPlayers = Array.from({ length: 6 }, (_, i) =>
      makeRankedPlayer(`user-${i}`, { username: `Player${i}` })
    )
    // Patch usernames manually
    rankedPlayers[0].username = 'Player0'
    rankedPlayers[1].username = 'Player1'
    rankedPlayers[2].username = 'Player2'
    rankedPlayers[3].username = 'Player3'
    rankedPlayers[4].username = 'Player4'
    rankedPlayers[5].username = 'Player5'

    render(<GameHUD {...defaultProps({ rankedPlayers })} />)
    expect(screen.queryByText('Player4')).not.toBeInTheDocument()
    expect(screen.queryByText('Player5')).not.toBeInTheDocument()
  })

  it('shows BOT label for bot players in ranking', () => {
    const rankedPlayers = [makeRankedPlayer(ENEMY_USER_ID, { isBot: true })]
    render(<GameHUD {...defaultProps({ rankedPlayers })} />)
    expect(screen.getByTitle('Bot AI')).toBeInTheDocument()
  })

  it('applies line-through styling for eliminated players', () => {
    const rankedPlayers = [
      makeRankedPlayer(ENEMY_USER_ID, { isAlive: false, username: 'DeadPlayer' }),
    ]
    render(<GameHUD {...defaultProps({ rankedPlayers })} />)
    const deadEl = screen.getByText(/DeadPlayer/)
    expect(deadEl.className).toContain('line-through')
  })

  // ── Active boosts panel ────────────────────────────────────────────────────

  it('renders no boost panel when player has no active boosts', () => {
    render(<GameHUD {...defaultProps()} />)
    // No boost percentage badges
    expect(screen.queryByText(/\+\d+%/)).not.toBeInTheDocument()
  })

  it('renders deck boost badges', () => {
    const players = {
      [MY_USER_ID]: makePlayer(MY_USER_ID, {
        active_boosts: [
          { slug: 'boost-unit', params: { effect_type: 'unit_bonus', value: 0.2 } },
        ],
      }),
    }
    render(<GameHUD {...defaultProps({ players })} />)
    expect(screen.getByText('+20%')).toBeInTheDocument()
  })

  it('renders match boost badges with countdown', () => {
    const players = {
      [MY_USER_ID]: makePlayer(MY_USER_ID, {
        active_match_boosts: [
          {
            slug: 'attack-boost',
            effect_type: 'attack_bonus',
            value: 0.3,
            ticks_remaining: 5,
          },
        ],
      }),
    }
    render(<GameHUD {...defaultProps({ players, tickIntervalMs: 1000 })} />)
    expect(screen.getByText('+30%')).toBeInTheDocument()
    // 5 ticks * 1000ms = 5s, ceil(5000/1000) = 5
    expect(screen.getByText('5s')).toBeInTheDocument()
  })

  it('handles empty players object gracefully', () => {
    expect(() =>
      render(<GameHUD {...defaultProps({ players: {} })} />)
    ).not.toThrow()
  })

  it('handles myUserId not found in players gracefully', () => {
    expect(() =>
      render(<GameHUD {...defaultProps({ myUserId: 'nonexistent' })} />)
    ).not.toThrow()
  })
})
