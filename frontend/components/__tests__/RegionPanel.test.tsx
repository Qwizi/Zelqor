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
// Mock game asset helpers
// ---------------------------------------------------------------------------

vi.mock('@/lib/gameAssets', () => ({
  getActionAsset: (_action: string) => `/assets/icons/${_action}.webp`,
  getPlayerBuildingAsset: (_slug: string) => `/assets/buildings/${_slug}.webp`,
  getPlayerUnitAsset: (_kind: string) => `/assets/units/${_kind}.webp`,
}))

// ---------------------------------------------------------------------------
// Mock assetOverrides (used indirectly via some sub-imports)
// ---------------------------------------------------------------------------

vi.mock('@/lib/assetOverrides', () => ({
  getAssetUrl: (_key: string, fallback: string) => fallback,
}))

import RegionPanel from '@/components/game/RegionPanel'
import type { GameRegion, GamePlayer } from '@/hooks/useGameSocket'
import type { BuildingType, UnitType } from '@/lib/api'

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const MY_USER_ID = 'user-me'
const ENEMY_USER_ID = 'user-enemy'

function makeRegion(overrides: Partial<GameRegion> = {}): GameRegion {
  return {
    name: 'Warsaw',
    country_code: 'PL',
    owner_id: MY_USER_ID,
    unit_count: 50,
    unit_type: 'infantry',
    units: { infantry: 50 },
    is_coastal: false,
    is_capital: false,
    building_type: null,
    buildings: {},
    building_instances: [],
    defense_bonus: 0,
    ...overrides,
  }
}

function makePlayers(
  ownerId = MY_USER_ID
): Record<string, GamePlayer> {
  return {
    [MY_USER_ID]: {
      user_id: MY_USER_ID,
      username: 'MyPlayer',
      color: '#00aaff',
      is_alive: true,
      capital_region_id: 'r-1',
      energy: 100,
      cosmetics: {},
    },
    [ENEMY_USER_ID]: {
      user_id: ENEMY_USER_ID,
      username: 'EnemyPlayer',
      color: '#ff0000',
      is_alive: true,
      capital_region_id: 'r-2',
      energy: 80,
      cosmetics: {},
    },
  }
}

const BUILDINGS: BuildingType[] = [
  {
    id: 'b-1',
    name: 'Barracks',
    slug: 'barracks',
    asset_key: 'barracks',
    asset_url: null,
    description: 'Produces infantry',
    icon: '',
    cost: 100,
    energy_cost: 20,
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
  },
  {
    id: 'b-2',
    name: 'Port',
    slug: 'port',
    asset_key: 'port',
    asset_url: null,
    description: 'Naval base',
    icon: '',
    cost: 150,
    energy_cost: 30,
    build_time_ticks: 8,
    max_per_region: 1,
    requires_coastal: true,
    defense_bonus: 0,
    vision_range: 0,
    unit_generation_bonus: 0,
    energy_generation_bonus: 0,
    order: 2,
    max_level: 3,
    level_stats: {},
  },
]

const UNITS: UnitType[] = [
  {
    id: 'u-1',
    name: 'Infantry',
    slug: 'infantry',
    asset_key: 'infantry',
    asset_url: null,
    description: 'Basic unit',
    icon: '',
    attack: 10,
    defense: 10,
    speed: 1,
    attack_range: 1,
    sea_range: 0,
    sea_hop_distance_km: 0,
    movement_type: 'ground',
    produced_by_slug: 'barracks',
    production_cost: 10,
    production_time_ticks: 3,
    manpower_cost: 1,
    order: 1,
    max_level: 3,
    level_stats: {},
  },
  {
    id: 'u-2',
    name: 'Tank',
    slug: 'tank',
    asset_key: 'tank',
    asset_url: null,
    description: 'Heavy unit',
    icon: '',
    attack: 30,
    defense: 20,
    speed: 2,
    attack_range: 1,
    sea_range: 0,
    sea_hop_distance_km: 0,
    movement_type: 'ground',
    produced_by_slug: null,
    production_cost: 40,
    production_time_ticks: 8,
    manpower_cost: 3,
    order: 2,
    max_level: 3,
    level_stats: {},
  },
]

function defaultProps(overrides: Partial<Parameters<typeof RegionPanel>[0]> = {}) {
  return {
    regionId: 'r-warsaw',
    region: makeRegion(),
    players: makePlayers(),
    myUserId: MY_USER_ID,
    myEnergy: 100,
    buildings: BUILDINGS,
    buildingQueue: [],
    units: UNITS,
    onBuild: vi.fn(),
    onProduceUnit: vi.fn(),
    onClose: vi.fn(),
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('RegionPanel', () => {
  // ── Region name and owner info ─────────────────────────────────────────────

  it('renders the region name', () => {
    render(<RegionPanel {...defaultProps()} />)
    expect(screen.getByText('Warsaw')).toBeInTheDocument()
  })

  it('shows owner username', () => {
    render(<RegionPanel {...defaultProps()} />)
    expect(screen.getByText('MyPlayer')).toBeInTheDocument()
  })

  it('shows enemy owner username for enemy-owned region', () => {
    const region = makeRegion({ owner_id: ENEMY_USER_ID })
    render(<RegionPanel {...defaultProps({ region })} />)
    expect(screen.getByText('EnemyPlayer')).toBeInTheDocument()
  })

  it('shows "Neutralny" when region has no owner', () => {
    const region = makeRegion({ owner_id: null })
    render(<RegionPanel {...defaultProps({ region })} />)
    expect(screen.getByText('Neutralny')).toBeInTheDocument()
  })

  it('shows "Stolica" badge for capital region', () => {
    const region = makeRegion({ is_capital: true })
    render(<RegionPanel {...defaultProps({ region })} />)
    expect(screen.getByText('Stolica')).toBeInTheDocument()
  })

  it('shows "Przybrzezny" for coastal region', () => {
    const region = makeRegion({ is_coastal: true })
    render(<RegionPanel {...defaultProps({ region })} />)
    expect(screen.getByText('Przybrzezny')).toBeInTheDocument()
  })

  it('shows "(BOT)" for bot owners', () => {
    const players = makePlayers()
    players[MY_USER_ID].is_bot = true
    render(<RegionPanel {...defaultProps({ players })} />)
    expect(screen.getByText(/BOT/)).toBeInTheDocument()
  })

  // ── Unit count ────────────────────────────────────────────────────────────

  it('shows unit count for owned region', () => {
    const region = makeRegion({ unit_count: 42 })
    render(<RegionPanel {...defaultProps({ region })} />)
    expect(screen.getByText('42')).toBeInTheDocument()
  })

  it('shows "?" unit count for enemy regions', () => {
    const region = makeRegion({ owner_id: ENEMY_USER_ID })
    const { getAllByText } = render(<RegionPanel {...defaultProps({ region })} />)
    // Unit count and energy both show "?" for enemy
    const questionMarks = getAllByText('?')
    expect(questionMarks.length).toBeGreaterThanOrEqual(1)
  })

  it('shows energy for owned region', () => {
    render(<RegionPanel {...defaultProps({ myEnergy: 75 })} />)
    expect(screen.getByText('75')).toBeInTheDocument()
  })

  // ── Building info ─────────────────────────────────────────────────────────

  it('shows building info tab when region has buildings', () => {
    const region = makeRegion({
      buildings: { barracks: 1 },
      building_instances: [{ building_type: 'barracks', level: 1 }],
    })
    render(<RegionPanel {...defaultProps({ region })} />)
    // Switch to info tab to see built buildings
    fireEvent.click(screen.getByText('Info'))
    // Barracks name should appear in the infrastructure list
    expect(screen.getAllByText('Barracks').length).toBeGreaterThan(0)
  })

  it('shows level badge for building instances', () => {
    const region = makeRegion({
      buildings: { barracks: 1 },
      building_instances: [{ building_type: 'barracks', level: 2 }],
    })
    render(<RegionPanel {...defaultProps({ region })} />)
    // Switch to info tab
    fireEvent.click(screen.getByText('Info'))
    expect(screen.getByText('Lvl 2')).toBeInTheDocument()
  })

  it('shows defense bonus in info tab', () => {
    const region = makeRegion({ defense_bonus: 0.25 })
    render(<RegionPanel {...defaultProps({ region })} />)
    // Navigate to info tab (component may start on build tab)
    const infoTab = screen.queryByText('Info')
    if (infoTab) fireEvent.click(infoTab)
    expect(screen.getByText('+25%')).toBeInTheDocument()
  })

  it('shows energy generation bonus in info tab', () => {
    const region = makeRegion({ energy_generation_bonus: 1.5 })
    render(<RegionPanel {...defaultProps({ region })} />)
    const infoTab = screen.queryByText('Info')
    if (infoTab) fireEvent.click(infoTab)
    expect(screen.getByText('+1.5/tick')).toBeInTheDocument()
  })

  // ── Action buttons for owned regions ─────────────────────────────────────

  it('shows Build tab button for owned region with buildable options', () => {
    render(<RegionPanel {...defaultProps()} />)
    // "Budowa" tab label
    expect(screen.getByText('Budowa')).toBeInTheDocument()
  })

  it('shows building options in build tab', () => {
    render(<RegionPanel {...defaultProps()} />)
    // Click build tab
    fireEvent.click(screen.getByText('Budowa'))
    expect(screen.getAllByText('Barracks').length).toBeGreaterThan(0)
  })

  it('calls onBuild when build button clicked with sufficient energy', () => {
    const onBuild = vi.fn()
    render(<RegionPanel {...defaultProps({ onBuild, myEnergy: 100 })} />)
    fireEvent.click(screen.getByText('Budowa'))

    const barracksButtons = screen.getAllByRole('button')
    const barracksBtn = barracksButtons.find((btn) =>
      btn.textContent?.includes('Barracks')
    )
    expect(barracksBtn).toBeDefined()
    if (barracksBtn) fireEvent.click(barracksBtn)
    expect(onBuild).toHaveBeenCalledWith('barracks')
  })

  it('disables build button when energy is insufficient', () => {
    render(<RegionPanel {...defaultProps({ myEnergy: 0 })} />)
    fireEvent.click(screen.getByText('Budowa'))

    const barracksButtons = screen.getAllByRole('button')
    const barracksBtn = barracksButtons.find(
      (btn) => btn.textContent?.includes('Barracks') && btn.closest('button')
    )
    expect(barracksBtn).toBeDefined()
    expect(barracksBtn).toBeDisabled()
  })

  it('does not show build tab for enemy regions', () => {
    const region = makeRegion({ owner_id: ENEMY_USER_ID })
    render(<RegionPanel {...defaultProps({ region })} />)
    expect(screen.queryByText('Budowa')).not.toBeInTheDocument()
  })

  it('filters coastal buildings for non-coastal regions', () => {
    const region = makeRegion({ is_coastal: false })
    render(<RegionPanel {...defaultProps({ region })} />)
    fireEvent.click(screen.getByText('Budowa'))
    // Port requires coastal — should not appear
    expect(screen.queryByText('Port')).not.toBeInTheDocument()
  })

  it('shows coastal buildings for coastal regions', () => {
    const region = makeRegion({ is_coastal: true })
    render(<RegionPanel {...defaultProps({ region })} />)
    fireEvent.click(screen.getByText('Budowa'))
    expect(screen.getByText('Port')).toBeInTheDocument()
  })

  // ── Produce tab ────────────────────────────────────────────────────────────

  it('shows produce tab when barracks is built', () => {
    const region = makeRegion({
      buildings: { barracks: 1 },
      building_instances: [{ building_type: 'barracks', level: 1 }],
    })
    render(<RegionPanel {...defaultProps({ region })} />)
    expect(screen.getByText('Jednostki')).toBeInTheDocument()
  })

  it('calls onProduceUnit when unit button is clicked', () => {
    const onProduceUnit = vi.fn()
    const region = makeRegion({
      buildings: { barracks: 1 },
      building_instances: [{ building_type: 'barracks', level: 1 }],
    })
    render(
      <RegionPanel
        {...defaultProps({ region, onProduceUnit, myEnergy: 100 })}
      />
    )
    fireEvent.click(screen.getByText('Jednostki'))

    const infantryButtons = screen.getAllByRole('button')
    const infantryBtn = infantryButtons.find((btn) =>
      btn.textContent?.includes('Infantry')
    )
    expect(infantryBtn).toBeDefined()
    if (infantryBtn) fireEvent.click(infantryBtn)
    expect(onProduceUnit).toHaveBeenCalledWith('infantry')
  })

  // ── Close button ──────────────────────────────────────────────────────────

  it('calls onClose when close button is clicked', () => {
    const onClose = vi.fn()
    render(<RegionPanel {...defaultProps({ onClose })} />)
    fireEvent.click(screen.getByLabelText('Zamknij'))
    expect(onClose).toHaveBeenCalled()
  })

  // ── Build queue ────────────────────────────────────────────────────────────

  it('shows queued buildings in info tab', () => {
    const buildingQueue = [
      { region_id: 'r-warsaw', building_type: 'barracks', queued_at: 1 },
    ]
    // Use a region where barracks is already maxed so build tab may not show,
    // or simply navigate to info tab
    render(<RegionPanel {...defaultProps({ buildingQueue })} />)
    // Click info tab (component defaults to build tab when buildable options exist)
    const infoTab = screen.queryByText('Info')
    if (infoTab) fireEvent.click(infoTab)
    expect(screen.getByText('W kolejce')).toBeInTheDocument()
    expect(screen.getByText('+1')).toBeInTheDocument()
  })

  // ── Unit breakdown ────────────────────────────────────────────────────────

  it('shows unit breakdown in info tab', () => {
    const region = makeRegion({
      units: { infantry: 30, tank: 5 },
    })
    render(<RegionPanel {...defaultProps({ region })} />)
    // Navigate to info tab to see unit breakdown
    const infoTab = screen.queryByText('Info')
    if (infoTab) fireEvent.click(infoTab)
    // "Jednostki" section header appears in info tab when units > 0
    expect(screen.getByText('Jednostki')).toBeInTheDocument()
  })

  // ── Locked buildings/units ────────────────────────────────────────────────

  it('shows lock icon for locked buildings', () => {
    render(
      <RegionPanel
        {...defaultProps({
          unlockedBuildings: ['port'], // barracks NOT unlocked
        })}
      />
    )
    fireEvent.click(screen.getByText('Budowa'))
    // "Wymaga blueprintu" should appear
    expect(screen.getByText('Wymaga blueprintu')).toBeInTheDocument()
  })

  // ── Null / empty region ───────────────────────────────────────────────────

  it('handles region with no units gracefully', () => {
    const region = makeRegion({ units: {} })
    expect(() => render(<RegionPanel {...defaultProps({ region })} />)).not.toThrow()
  })

  it('handles region with no buildings gracefully', () => {
    const region = makeRegion({ buildings: {}, building_instances: [] })
    expect(() => render(<RegionPanel {...defaultProps({ region })} />)).not.toThrow()
  })

  it('shows region info for enemy-owned regions without build actions', () => {
    const region = makeRegion({ owner_id: ENEMY_USER_ID })
    render(<RegionPanel {...defaultProps({ region })} />)
    // Enemy regions still show info but not build actions
    expect(screen.queryByText('Budowa')).not.toBeInTheDocument()
  })
})
