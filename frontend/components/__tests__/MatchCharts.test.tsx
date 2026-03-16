import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import React from 'react'

// ---------------------------------------------------------------------------
// Mock recharts — replace chart components with simple identifiable divs
// ---------------------------------------------------------------------------

vi.mock('recharts', () => ({
  Bar: ({ dataKey }: { dataKey: string }) =>
    React.createElement('div', { 'data-testid': `recharts-bar-${dataKey}` }),
  BarChart: ({ children }: { children: React.ReactNode }) =>
    React.createElement('div', { 'data-testid': 'recharts-barchart' }, children),
  XAxis: () => React.createElement('div', { 'data-testid': 'recharts-xaxis' }),
  YAxis: () => React.createElement('div', { 'data-testid': 'recharts-yaxis' }),
  CartesianGrid: () => React.createElement('div', { 'data-testid': 'recharts-grid' }),
  RadarChart: ({ children }: { children: React.ReactNode }) =>
    React.createElement('div', { 'data-testid': 'recharts-radarchart' }, children),
  PolarGrid: () => React.createElement('div', { 'data-testid': 'recharts-polargrid' }),
  PolarAngleAxis: () => React.createElement('div', { 'data-testid': 'recharts-polara' }),
  Radar: ({ name }: { name: string }) =>
    React.createElement('div', { 'data-testid': `recharts-radar-${name}` }),
  Legend: () => React.createElement('div', { 'data-testid': 'recharts-legend' }),
}))

// ---------------------------------------------------------------------------
// Mock shadcn/ui chart components
// ---------------------------------------------------------------------------

vi.mock('@/components/ui/chart', () => ({
  ChartContainer: ({
    children,
    className,
  }: {
    children: React.ReactNode
    className?: string
  }) =>
    React.createElement('div', { 'data-testid': 'chart-container', className }, children),
  ChartTooltip: () => React.createElement('div', { 'data-testid': 'chart-tooltip' }),
  ChartTooltipContent: () => React.createElement('div', { 'data-testid': 'chart-tooltip-content' }),
}))

import MatchCharts from '@/components/match/MatchCharts'
import type { Match, MatchResult, PlayerResult } from '@/lib/api'

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makePlayerResult(overrides: Partial<PlayerResult> = {}): PlayerResult {
  return {
    user_id: 'user-1',
    username: 'Alpha',
    placement: 1,
    regions_conquered: 5,
    units_produced: 20,
    units_lost: 3,
    buildings_built: 2,
    elo_change: 25,
    is_banned: false,
    ...overrides,
  }
}

function makeMatch(overrides: Partial<Match> = {}): Match {
  return {
    id: 'm1',
    status: 'finished',
    max_players: 2,
    game_mode_id: null,
    winner_id: 'user-1',
    players: [
      { id: 'mp1', user_id: 'user-1', username: 'Alpha', color: '#22d3ee', is_alive: false, joined_at: '', is_banned: false },
      { id: 'mp2', user_id: 'user-2', username: 'Bravo', color: '#fbbf24', is_alive: false, joined_at: '', is_banned: false },
    ],
    started_at: '2026-03-16T10:00:00Z',
    finished_at: '2026-03-16T10:30:00Z',
    created_at: '2026-03-16T10:00:00Z',
    ...overrides,
  }
}

function makeMatchResult(overrides: Partial<MatchResult> = {}): MatchResult {
  return {
    id: 'mr1',
    match_id: 'm1',
    duration_seconds: 1800,
    total_ticks: 100,
    player_results: [
      makePlayerResult({ user_id: 'user-1', username: 'Alpha' }),
      makePlayerResult({ user_id: 'user-2', username: 'Bravo', placement: 2 }),
    ],
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('MatchCharts', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders nothing when player_results is empty', () => {
    const match = makeMatch()
    const result = makeMatchResult({ player_results: [] })
    const { container } = render(
      React.createElement(MatchCharts, { match, result })
    )
    expect(container.firstChild).toBeNull()
  })

  it('renders the chart container wrapper', () => {
    render(
      React.createElement(MatchCharts, {
        match: makeMatch(),
        result: makeMatchResult(),
      })
    )
    expect(screen.getByTestId('chart-container')).toBeTruthy()
  })

  it('renders tab buttons', () => {
    render(
      React.createElement(MatchCharts, {
        match: makeMatch(),
        result: makeMatchResult(),
      })
    )
    // Mobile labels — each tab button renders two spans (mobile + desktop)
    // so there will be multiple matches for the same text
    expect(screen.getAllByText('Stats').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Radar').length).toBeGreaterThan(0)
  })

  it('shows comparison tab content by default (BarChart)', () => {
    render(
      React.createElement(MatchCharts, {
        match: makeMatch(),
        result: makeMatchResult(),
      })
    )
    expect(screen.getByTestId('recharts-barchart')).toBeTruthy()
  })

  it('renders a Bar for each player in comparison tab', () => {
    render(
      React.createElement(MatchCharts, {
        match: makeMatch(),
        result: makeMatchResult(),
      })
    )
    expect(screen.getByTestId('recharts-bar-Alpha')).toBeTruthy()
    expect(screen.getByTestId('recharts-bar-Bravo')).toBeTruthy()
  })

  it('switching to radar tab shows RadarChart', () => {
    render(
      React.createElement(MatchCharts, {
        match: makeMatch(),
        result: makeMatchResult(),
      })
    )
    // Each tab has two spans (mobile/desktop), click the first one
    fireEvent.click(screen.getAllByText('Radar')[0])
    expect(screen.getByTestId('recharts-radarchart')).toBeTruthy()
  })

  it('radar tab hides the BarChart', () => {
    render(
      React.createElement(MatchCharts, {
        match: makeMatch(),
        result: makeMatchResult(),
      })
    )
    fireEvent.click(screen.getAllByText('Radar')[0])
    expect(screen.queryByTestId('recharts-barchart')).toBeNull()
  })

  it('renders a Radar series for each player in radar tab', () => {
    render(
      React.createElement(MatchCharts, {
        match: makeMatch(),
        result: makeMatchResult(),
      })
    )
    fireEvent.click(screen.getAllByText('Radar')[0])
    expect(screen.getByTestId('recharts-radar-Alpha')).toBeTruthy()
    expect(screen.getByTestId('recharts-radar-Bravo')).toBeTruthy()
  })

  it('switching back to comparison tab restores BarChart', () => {
    render(
      React.createElement(MatchCharts, {
        match: makeMatch(),
        result: makeMatchResult(),
      })
    )
    fireEvent.click(screen.getAllByText('Radar')[0])
    fireEvent.click(screen.getAllByText('Stats')[0])
    expect(screen.getByTestId('recharts-barchart')).toBeTruthy()
    expect(screen.queryByTestId('recharts-radarchart')).toBeNull()
  })

  it('renders legend inside the bar chart', () => {
    render(
      React.createElement(MatchCharts, {
        match: makeMatch(),
        result: makeMatchResult(),
      })
    )
    expect(screen.getByTestId('recharts-legend')).toBeTruthy()
  })

  it('renders with a single player result', () => {
    const result = makeMatchResult({
      player_results: [makePlayerResult({ user_id: 'user-1', username: 'Solo' })],
    })
    const match = makeMatch({
      players: [
        { id: 'mp1', user_id: 'user-1', username: 'Solo', color: '#22d3ee', is_alive: false, joined_at: '', is_banned: false },
      ],
    })
    render(React.createElement(MatchCharts, { match, result }))
    expect(screen.getByTestId('recharts-bar-Solo')).toBeTruthy()
  })

  it('renders CartesianGrid in comparison tab', () => {
    render(
      React.createElement(MatchCharts, {
        match: makeMatch(),
        result: makeMatchResult(),
      })
    )
    expect(screen.getByTestId('recharts-grid')).toBeTruthy()
  })
})
