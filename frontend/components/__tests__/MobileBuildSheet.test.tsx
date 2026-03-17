import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
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

// ---------------------------------------------------------------------------
// Mock gameAssets
// ---------------------------------------------------------------------------

vi.mock('@/lib/gameAssets', () => ({
  getActionAsset: (action: string) => `/assets/icons/${action}.webp`,
  getPlayerBuildingAsset: (slug: string) => `/assets/buildings/${slug}.webp`,
  getPlayerUnitAsset: (kind: string) => `/assets/units/${kind}.webp`,
}))

// ---------------------------------------------------------------------------
// Mock lucide-react
// ---------------------------------------------------------------------------

vi.mock('lucide-react', () => ({
  Lock: ({ className }: { className?: string }) =>
    React.createElement('span', { 'data-testid': 'icon-lock', className }),
}))

import MobileBuildSheet from '@/components/game/MobileBuildSheet'
import type { GameRegion, BuildingQueueItem } from '@/hooks/useGameSocket'
import type { BuildingType, UnitType } from '@/lib/api'

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeRegion(overrides: Partial<GameRegion> = {}): GameRegion {
  return {
    name: 'Test Region',
    country_code: 'PL',
    owner_id: 'user-1',
    unit_count: 10,
    is_coastal: false,
    is_capital: false,
    building_type: null,
    buildings: {},
    building_instances: [],
    defense_bonus: 0,
    ...overrides,
  }
}

function makeBuilding(overrides: Partial<BuildingType> = {}): BuildingType {
  return {
    id: 'b1',
    name: 'Koszary',
    slug: 'barracks',
    asset_key: 'barracks',
    asset_url: null,
    description: 'Test building',
    icon: '',
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
  }
}

function makeUnit(overrides: Partial<UnitType> = {}): UnitType {
  return {
    id: 'u1',
    name: 'Piechota',
    slug: 'infantry',
    asset_key: 'infantry',
    asset_url: null,
    description: '',
    icon: '',
    attack: 10,
    defense: 5,
    speed: 1,
    attack_range: 1,
    sea_range: 0,
    sea_hop_distance_km: 0,
    movement_type: 'ground',
    produced_by_slug: 'barracks',
    production_cost: 30,
    production_time_ticks: 3,
    manpower_cost: 1,
    order: 1,
    max_level: 1,
    level_stats: {},
    ...overrides,
  }
}

const defaultProps = {
  region: makeRegion(),
  regionId: 'r1',
  myEnergy: 200,
  buildings: [makeBuilding()],
  buildingQueue: [] as BuildingQueueItem[],
  units: [makeUnit()],
  onBuild: vi.fn(),
  onProduceUnit: vi.fn(),
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('MobileBuildSheet', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders nothing when no build options and no produce options', () => {
    // Building max_per_region=1 and region already has 1 → no build options
    // No units provided → no produce options
    const region = makeRegion({ buildings: { barracks: 1 } })
    const building = makeBuilding({ max_per_region: 1 })
    const { container } = render(
      React.createElement(MobileBuildSheet, {
        ...defaultProps,
        region,
        buildings: [building],
        units: [], // no units → no produce options
      })
    )
    expect(container.firstChild).toBeNull()
  })

  it('renders the build action button when build options exist', () => {
    render(React.createElement(MobileBuildSheet, defaultProps))
    const buildBtn = screen.getByTitle('Buduj')
    expect(buildBtn).toBeTruthy()
  })

  it('renders the produce action button when unit can be produced', () => {
    const region = makeRegion({ buildings: { barracks: 1 } })
    render(
      React.createElement(MobileBuildSheet, { ...defaultProps, region })
    )
    const produceBtn = screen.getByTitle('Produkuj')
    expect(produceBtn).toBeTruthy()
  })

  it('clicking build button shows the build sheet with building name', () => {
    render(React.createElement(MobileBuildSheet, defaultProps))
    fireEvent.click(screen.getByTitle('Buduj'))
    expect(screen.getByText('Koszary')).toBeTruthy()
  })

  it('shows energy cost for a building', () => {
    render(React.createElement(MobileBuildSheet, defaultProps))
    fireEvent.click(screen.getByTitle('Buduj'))
    // The energy cost should be displayed
    expect(screen.getByText('50')).toBeTruthy()
  })

  it('disables build button when energy is insufficient', () => {
    render(
      React.createElement(MobileBuildSheet, { ...defaultProps, myEnergy: 10 })
    )
    fireEvent.click(screen.getByTitle('Buduj'))
    const buildBtn = screen.getByRole('button', { name: /koszary/i })
    expect(buildBtn).toHaveProperty('disabled', true)
  })

  it('enables build button when energy is sufficient', () => {
    render(
      React.createElement(MobileBuildSheet, { ...defaultProps, myEnergy: 100 })
    )
    fireEvent.click(screen.getByTitle('Buduj'))
    const buttons = screen.getAllByRole('button')
    // Find button containing the building name
    const buildBtns = buttons.filter((b) => b.textContent?.includes('Koszary'))
    expect(buildBtns.length).toBeGreaterThan(0)
    expect(buildBtns[0]).toHaveProperty('disabled', false)
  })

  it('calls onBuild with building slug when build button clicked', () => {
    const onBuild = vi.fn()
    render(
      React.createElement(MobileBuildSheet, { ...defaultProps, onBuild })
    )
    fireEvent.click(screen.getByTitle('Buduj'))
    fireEvent.click(screen.getByText('Koszary'))
    expect(onBuild).toHaveBeenCalledWith('barracks')
  })

  it('closes sheet after build action', () => {
    const onBuild = vi.fn()
    render(
      React.createElement(MobileBuildSheet, { ...defaultProps, onBuild })
    )
    fireEvent.click(screen.getByTitle('Buduj'))
    expect(screen.getByText('Koszary')).toBeTruthy()
    fireEvent.click(screen.getByText('Koszary'))
    // After clicking, mode resets to null — sheet should disappear
    expect(screen.queryByText('Budowa')).toBeNull()
  })

  it('shows sheet title "Budowa" in build mode', () => {
    render(React.createElement(MobileBuildSheet, defaultProps))
    fireEvent.click(screen.getByTitle('Buduj'))
    expect(screen.getByText(/Budowa/)).toBeTruthy()
  })

  it('shows sheet title "Produkcja jednostek" in produce mode', () => {
    const region = makeRegion({ buildings: { barracks: 1 } })
    render(
      React.createElement(MobileBuildSheet, { ...defaultProps, region })
    )
    fireEvent.click(screen.getByTitle('Produkuj'))
    expect(screen.getByText(/Produkcja jednostek/)).toBeTruthy()
  })

  it('shows close button in sheet mode', () => {
    render(React.createElement(MobileBuildSheet, defaultProps))
    fireEvent.click(screen.getByTitle('Buduj'))
    expect(screen.getByLabelText('Zamknij')).toBeTruthy()
  })

  it('clicking close button returns to floating mode', () => {
    render(React.createElement(MobileBuildSheet, defaultProps))
    fireEvent.click(screen.getByTitle('Buduj'))
    fireEvent.click(screen.getByLabelText('Zamknij'))
    // Should show build floating button again
    expect(screen.getByTitle('Buduj')).toBeTruthy()
  })

  it('shows locked state for building not in unlockedBuildings', () => {
    render(
      React.createElement(MobileBuildSheet, {
        ...defaultProps,
        unlockedBuildings: ['other_building'],
      })
    )
    fireEvent.click(screen.getByTitle('Buduj'))
    expect(screen.getByText('Wymaga blueprintu z talii')).toBeTruthy()
    expect(screen.getAllByTestId('icon-lock').length).toBeGreaterThan(0)
  })

  it('does not show lock when building IS in unlockedBuildings', () => {
    render(
      React.createElement(MobileBuildSheet, {
        ...defaultProps,
        unlockedBuildings: ['barracks'],
      })
    )
    fireEvent.click(screen.getByTitle('Buduj'))
    expect(screen.queryByText('Wymaga blueprintu z talii')).toBeNull()
  })

  it('filters out coastal buildings for non-coastal region', () => {
    const coastalBuilding = makeBuilding({
      id: 'b2',
      slug: 'port',
      name: 'Port',
      requires_coastal: true,
    })
    render(
      React.createElement(MobileBuildSheet, {
        ...defaultProps,
        buildings: [makeBuilding(), coastalBuilding],
        region: makeRegion({ is_coastal: false }),
      })
    )
    fireEvent.click(screen.getByTitle('Buduj'))
    expect(screen.queryByText('Port')).toBeNull()
    expect(screen.getByText('Koszary')).toBeTruthy()
  })

  it('shows coastal buildings for coastal region', () => {
    const coastalBuilding = makeBuilding({
      id: 'b2',
      slug: 'port',
      name: 'Port',
      requires_coastal: true,
    })
    render(
      React.createElement(MobileBuildSheet, {
        ...defaultProps,
        buildings: [makeBuilding(), coastalBuilding],
        region: makeRegion({ is_coastal: true }),
      })
    )
    fireEvent.click(screen.getByTitle('Buduj'))
    expect(screen.getByText('Port')).toBeTruthy()
  })

  it('calls onProduceUnit with unit slug when produce button clicked', () => {
    const onProduceUnit = vi.fn()
    const region = makeRegion({ buildings: { barracks: 1 } })
    render(
      React.createElement(MobileBuildSheet, {
        ...defaultProps,
        region,
        onProduceUnit,
      })
    )
    fireEvent.click(screen.getByTitle('Produkuj'))
    fireEvent.click(screen.getByText('Piechota'))
    expect(onProduceUnit).toHaveBeenCalledWith('infantry')
  })

  it('shows unit production cost', () => {
    const region = makeRegion({ buildings: { barracks: 1 } })
    render(
      React.createElement(MobileBuildSheet, { ...defaultProps, region })
    )
    fireEvent.click(screen.getByTitle('Produkuj'))
    expect(screen.getByText('30')).toBeTruthy()
  })

  it('disables unit button when energy is insufficient', () => {
    const region = makeRegion({ buildings: { barracks: 1 } })
    render(
      React.createElement(MobileBuildSheet, {
        ...defaultProps,
        region,
        myEnergy: 5,
      })
    )
    fireEvent.click(screen.getByTitle('Produkuj'))
    const unitBtns = screen.getAllByRole('button').filter((b) =>
      b.textContent?.includes('Piechota')
    )
    expect(unitBtns[0]).toHaveProperty('disabled', true)
  })
})
