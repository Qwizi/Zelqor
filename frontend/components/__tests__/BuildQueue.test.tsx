import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import React from 'react'

// ---------------------------------------------------------------------------
// Mock next/image — render as a plain <img>
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
  }) =>
    React.createElement('img', { src, alt, width, height, className }),
}))

// ---------------------------------------------------------------------------
// Mock gameAssets to return deterministic strings
// ---------------------------------------------------------------------------

vi.mock('@/lib/gameAssets', () => ({
  getActionAsset: (_action: string) => `/assets/icons/${_action}.webp`,
  getPlayerBuildingAsset: (_slug: string, _cosmetics?: unknown, _url?: string | null) =>
    `/assets/buildings/${_slug}.webp`,
  getPlayerUnitAsset: (_kind: string, _cosmetics?: unknown, _url?: string | null) =>
    `/assets/units/${_kind}.webp`,
}))

import BuildQueue from '@/components/game/BuildQueue'
import type { BuildingQueueItem, UnitQueueItem } from '@/hooks/useGameSocket'
import type { BuildingType, UnitType } from '@/lib/api'

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const USER_ID = 'user-1'

const BUILDINGS: BuildingType[] = [
  {
    slug: 'barracks',
    name: 'Koszary',
    asset_key: 'barracks',
    asset_url: null,
    description: '',
    cost: 100,
    build_time: 5,
    max_per_region: 1,
    level_stats: {},
  } as unknown as BuildingType,
]

const UNITS: UnitType[] = [
  {
    slug: 'infantry',
    name: 'Piechota',
    asset_key: 'infantry',
    asset_url: null,
    description: '',
    cost: 50,
    train_time: 3,
  } as unknown as UnitType,
]

function makeBuildItem(overrides: Partial<BuildingQueueItem> = {}): BuildingQueueItem {
  return {
    region_id: 'r1',
    player_id: USER_ID,
    building_type: 'barracks',
    ticks_remaining: 3,
    total_ticks: 5,
    ...overrides,
  } as BuildingQueueItem
}

function makeUnitItem(overrides: Partial<UnitQueueItem> = {}): UnitQueueItem {
  return {
    region_id: 'r1',
    player_id: USER_ID,
    unit_type: 'infantry',
    ticks_remaining: 2,
    total_ticks: 3,
    ...overrides,
  } as UnitQueueItem
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('BuildQueue', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders nothing when both queues are empty', () => {
    const { container } = render(
      React.createElement(BuildQueue, {
        queue: [],
        unitQueue: [],
        buildings: BUILDINGS,
        units: UNITS,
        myUserId: USER_ID,
      })
    )
    expect(container.firstChild).toBeNull()
  })

  it('renders a building queue section when items are present', () => {
    render(
      React.createElement(BuildQueue, {
        queue: [makeBuildItem()],
        unitQueue: [],
        buildings: BUILDINGS,
        units: UNITS,
        myUserId: USER_ID,
      })
    )

    expect(screen.getAllByText(/Budowa/i).length).toBeGreaterThan(0)
  })

  it('renders a unit queue section when unit items are present', () => {
    render(
      React.createElement(BuildQueue, {
        queue: [],
        unitQueue: [makeUnitItem()],
        buildings: BUILDINGS,
        units: UNITS,
        myUserId: USER_ID,
      })
    )

    expect(screen.getAllByText(/Produkcja/i).length).toBeGreaterThan(0)
  })

  it('shows the building name from the buildings config', () => {
    render(
      React.createElement(BuildQueue, {
        queue: [makeBuildItem({ building_type: 'barracks' })],
        unitQueue: [],
        buildings: BUILDINGS,
        units: UNITS,
        myUserId: USER_ID,
      })
    )

    expect(screen.getAllByText('Koszary').length).toBeGreaterThan(0)
  })

  it('falls back to the slug when no building config is found', () => {
    render(
      React.createElement(BuildQueue, {
        queue: [makeBuildItem({ building_type: 'unknown_building' })],
        unitQueue: [],
        buildings: [],
        units: UNITS,
        myUserId: USER_ID,
      })
    )

    expect(screen.getAllByText('unknown_building').length).toBeGreaterThan(0)
  })

  it('shows the unit name from the units config', () => {
    render(
      React.createElement(BuildQueue, {
        queue: [],
        unitQueue: [makeUnitItem({ unit_type: 'infantry' })],
        buildings: BUILDINGS,
        units: UNITS,
        myUserId: USER_ID,
      })
    )

    expect(screen.getAllByText('Piechota').length).toBeGreaterThan(0)
  })

  it('shows "Ukończono!" when ticks_remaining is 0', () => {
    render(
      React.createElement(BuildQueue, {
        queue: [makeBuildItem({ ticks_remaining: 0 })],
        unitQueue: [],
        buildings: BUILDINGS,
        units: UNITS,
        myUserId: USER_ID,
      })
    )

    expect(screen.getAllByText('Ukończono!').length).toBeGreaterThan(0)
  })

  it('shows remaining ticks label when ticks_remaining > 0', () => {
    render(
      React.createElement(BuildQueue, {
        queue: [makeBuildItem({ ticks_remaining: 4 })],
        unitQueue: [],
        buildings: BUILDINGS,
        units: UNITS,
        myUserId: USER_ID,
      })
    )

    expect(screen.getAllByText(/4 tur do końca/i).length).toBeGreaterThan(0)
  })

  it('only shows items belonging to myUserId', () => {
    const ownItem = makeBuildItem({ player_id: USER_ID, building_type: 'barracks' })
    const otherItem = makeBuildItem({ player_id: 'other-player', building_type: 'barracks', region_id: 'r2' })

    render(
      React.createElement(BuildQueue, {
        queue: [ownItem, otherItem],
        unitQueue: [],
        buildings: BUILDINGS,
        units: UNITS,
        myUserId: USER_ID,
      })
    )

    // Section title should say count of 1, not 2
    const sections = screen.getAllByText(/Budowa/i)
    // At least one mention of "Budowa (1)"
    const countOne = sections.some((el) => el.textContent?.includes('1'))
    expect(countOne).toBe(true)
  })

  it('calculates progress percentage correctly at midpoint', () => {
    // remaining=2, total=4 → 50% done (1 - 2/4 = 0.5)
    render(
      React.createElement(BuildQueue, {
        queue: [makeBuildItem({ ticks_remaining: 2, total_ticks: 4 })],
        unitQueue: [],
        buildings: BUILDINGS,
        units: UNITS,
        myUserId: USER_ID,
      })
    )

    // The 50% badge should appear somewhere in the component
    expect(screen.getAllByText('50%').length).toBeGreaterThan(0)
  })

  it('shows 100% when ticks_remaining is 0', () => {
    render(
      React.createElement(BuildQueue, {
        queue: [makeBuildItem({ ticks_remaining: 0, total_ticks: 5 })],
        unitQueue: [],
        buildings: BUILDINGS,
        units: UNITS,
        myUserId: USER_ID,
      })
    )

    expect(screen.getAllByText('100%').length).toBeGreaterThan(0)
  })

  it('renders both building and unit sections when both queues have items', () => {
    render(
      React.createElement(BuildQueue, {
        queue: [makeBuildItem()],
        unitQueue: [makeUnitItem()],
        buildings: BUILDINGS,
        units: UNITS,
        myUserId: USER_ID,
      })
    )

    expect(screen.getAllByText(/Budowa/i).length).toBeGreaterThan(0)
    expect(screen.getAllByText(/Produkcja/i).length).toBeGreaterThan(0)
  })

  it('section header shows correct item count', () => {
    const items = [
      makeBuildItem({ region_id: 'r1' }),
      makeBuildItem({ region_id: 'r2' }),
    ]

    render(
      React.createElement(BuildQueue, {
        queue: items,
        unitQueue: [],
        buildings: BUILDINGS,
        units: UNITS,
        myUserId: USER_ID,
      })
    )

    const sections = screen.getAllByText(/Budowa/i)
    const countTwo = sections.some((el) => el.textContent?.includes('2'))
    expect(countTwo).toBe(true)
  })
})
