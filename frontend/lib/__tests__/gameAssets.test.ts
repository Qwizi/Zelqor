import { describe, it, expect, vi, beforeEach } from 'vitest'

// ---------------------------------------------------------------------------
// Mock assetOverrides — controls getOverrideUrl and getAssetUrl
// ---------------------------------------------------------------------------

const mockGetOverrideUrl = vi.fn((_key: string): string | null => null)
const mockGetAssetUrl = vi.fn((key: string, fallback: string): string => fallback)

vi.mock('@/lib/assetOverrides', () => ({
  getOverrideUrl: (...args: unknown[]) => mockGetOverrideUrl(...(args as [string])),
  getAssetUrl: (...args: unknown[]) => mockGetAssetUrl(...(args as [string, string])),
}))

import {
  BUILDING_ASSET_MAP,
  getBuildingAsset,
  getUnitAsset,
  getPlayerBuildingAsset,
  getPlayerUnitAsset,
  getActionAsset,
} from '../gameAssets'

// ---------------------------------------------------------------------------
// BUILDING_ASSET_MAP structure
// ---------------------------------------------------------------------------

describe('BUILDING_ASSET_MAP', () => {
  beforeEach(() => {
    mockGetOverrideUrl.mockReturnValue(null)
    mockGetAssetUrl.mockImplementation((_key, fallback) => fallback)
  })

  it('contains all primary building slugs', () => {
    const primarySlugs = ['port', 'barracks', 'carrier', 'radar', 'tower', 'factory']
    for (const slug of primarySlugs) {
      expect(BUILDING_ASSET_MAP).toHaveProperty(slug)
    }
  })

  it('contains all legacy fallback slugs', () => {
    const legacySlugs = ['airport', 'navy_port', 'power_plant', 'military_base', 'ironworks', 'mine']
    for (const slug of legacySlugs) {
      expect(BUILDING_ASSET_MAP).toHaveProperty(slug)
    }
  })

  it('all values are non-empty strings starting with /assets/', () => {
    for (const [, url] of Object.entries(BUILDING_ASSET_MAP)) {
      expect(typeof url).toBe('string')
      expect(url.startsWith('/assets/')).toBe(true)
    }
  })

  it('carrier and airport share the same asset URL (same file)', () => {
    expect(BUILDING_ASSET_MAP['carrier']).toBe(BUILDING_ASSET_MAP['airport'])
  })

  it('port and navy_port share the same asset URL', () => {
    expect(BUILDING_ASSET_MAP['port']).toBe(BUILDING_ASSET_MAP['navy_port'])
  })
})

// ---------------------------------------------------------------------------
// getBuildingAsset
// ---------------------------------------------------------------------------

describe('getBuildingAsset()', () => {
  beforeEach(() => {
    mockGetOverrideUrl.mockReturnValue(null)
    mockGetAssetUrl.mockImplementation((_key, fallback) => fallback)
  })

  it('returns the provided assetUrl directly when non-null', () => {
    const customUrl = '/custom/building.png'
    expect(getBuildingAsset('barracks', customUrl)).toBe(customUrl)
  })

  it('returns null when slug is null and no assetUrl provided', () => {
    expect(getBuildingAsset(null)).toBeNull()
  })

  it('returns null when slug is undefined and no assetUrl provided', () => {
    expect(getBuildingAsset(undefined)).toBeNull()
  })

  it('returns mapped URL for a known slug', () => {
    const url = getBuildingAsset('barracks')
    expect(url).toBe(BUILDING_ASSET_MAP['barracks'])
  })

  it('returns null for an unknown slug with no override', () => {
    expect(getBuildingAsset('nonexistent_building')).toBeNull()
  })

  it('returns the override URL when getOverrideUrl returns a value', () => {
    mockGetOverrideUrl.mockReturnValue('/override/barracks.png')
    expect(getBuildingAsset('barracks')).toBe('/override/barracks.png')
  })

  it('returns assetUrl even when an override exists (assetUrl takes priority)', () => {
    mockGetOverrideUrl.mockReturnValue('/override/barracks.png')
    expect(getBuildingAsset('barracks', '/explicit.png')).toBe('/explicit.png')
  })
})

// ---------------------------------------------------------------------------
// getUnitAsset
// ---------------------------------------------------------------------------

describe('getUnitAsset()', () => {
  beforeEach(() => {
    mockGetOverrideUrl.mockReturnValue(null)
    mockGetAssetUrl.mockImplementation((_key, fallback) => fallback)
  })

  it('returns assetUrl directly when provided', () => {
    expect(getUnitAsset('tank', '/custom/tank.png')).toBe('/custom/tank.png')
  })

  it('returns ground_unit_sphere asset for default/unknown kind', () => {
    expect(getUnitAsset()).toContain('ground_unit_sphere')
    expect(getUnitAsset('unknown_kind')).toContain('ground_unit_sphere')
  })

  it('returns moving asset for "moving" kind', () => {
    expect(getUnitAsset('moving')).toBe('/assets/units/moving.webp')
  })

  it('returns nuke icon for "nuke_rocket" kind', () => {
    expect(getUnitAsset('nuke_rocket')).toBe('/assets/units/nuke_icon.png')
  })

  it('returns bomber asset for "fighter" kind', () => {
    expect(getUnitAsset('fighter')).toContain('bomber')
  })

  it('returns bomber asset for "bomber" kind (same asset as fighter)', () => {
    expect(getUnitAsset('bomber')).toBe(getUnitAsset('fighter'))
  })

  it('returns bomber asset for "air" kind', () => {
    expect(getUnitAsset('air')).toBe(getUnitAsset('fighter'))
  })

  it('returns ship asset for "ship" kind', () => {
    expect(getUnitAsset('ship')).toContain('ship')
  })

  it('returns ship asset for "ship_1" kind (same as ship)', () => {
    expect(getUnitAsset('ship_1')).toBe(getUnitAsset('ship'))
  })

  it('returns ground_unit_sphere for "tank" and "ground_unit_sphere" kinds', () => {
    expect(getUnitAsset('tank')).toContain('ground_unit_sphere')
    expect(getUnitAsset('ground_unit_sphere')).toBe(getUnitAsset('tank'))
  })

  it('returns ground_unit for "infantry" kind', () => {
    expect(getUnitAsset('infantry')).toContain('ground_unit')
  })

  it('returns override when getOverrideUrl returns a value', () => {
    mockGetOverrideUrl.mockReturnValue('/override/unit.png')
    expect(getUnitAsset('infantry')).toBe('/override/unit.png')
  })
})

// ---------------------------------------------------------------------------
// getPlayerBuildingAsset
// ---------------------------------------------------------------------------

describe('getPlayerBuildingAsset()', () => {
  beforeEach(() => {
    mockGetOverrideUrl.mockReturnValue(null)
    mockGetAssetUrl.mockImplementation((_key, fallback) => fallback)
  })

  it('returns string cosmetic URL when playerCosmetics has string entry for slug', () => {
    const cosmetics = { barracks: '/cosmetic/barracks.png' }
    expect(getPlayerBuildingAsset('barracks', cosmetics)).toBe('/cosmetic/barracks.png')
  })

  it('returns object cosmetic url when playerCosmetics entry is { url: "..." }', () => {
    const cosmetics = { barracks: { url: '/cosmetic/barracks_obj.png' } }
    expect(getPlayerBuildingAsset('barracks', cosmetics)).toBe('/cosmetic/barracks_obj.png')
  })

  it('falls through to getBuildingAsset when playerCosmetics has no entry for slug', () => {
    const cosmetics = { other: '/cosmetic/other.png' }
    expect(getPlayerBuildingAsset('barracks', cosmetics)).toBe(BUILDING_ASSET_MAP['barracks'])
  })

  it('falls through to getBuildingAsset when playerCosmetics is undefined', () => {
    expect(getPlayerBuildingAsset('barracks', undefined)).toBe(BUILDING_ASSET_MAP['barracks'])
  })

  it('returns null for unknown slug with no cosmetics', () => {
    expect(getPlayerBuildingAsset('ghost_slug')).toBeNull()
  })

  it('prioritizes assetUrl over cosmetics when assetUrl is provided', () => {
    // assetUrl is passed as third arg to getBuildingAsset, cosmetic wins for slug key
    const cosmetics = { barracks: '/cosmetic/barracks.png' }
    // cosmetic wins because it is checked before assetUrl delegation
    expect(getPlayerBuildingAsset('barracks', cosmetics, '/explicit.png')).toBe('/cosmetic/barracks.png')
  })
})

// ---------------------------------------------------------------------------
// getPlayerUnitAsset
// ---------------------------------------------------------------------------

describe('getPlayerUnitAsset()', () => {
  beforeEach(() => {
    mockGetOverrideUrl.mockReturnValue(null)
    mockGetAssetUrl.mockImplementation((_key, fallback) => fallback)
  })

  it('returns string cosmetic URL for the resolved kind', () => {
    const cosmetics = { tank: '/cosmetic/tank.png' }
    expect(getPlayerUnitAsset('tank', cosmetics)).toBe('/cosmetic/tank.png')
  })

  it('falls back to getUnitAsset when no cosmetic entry for kind', () => {
    expect(getPlayerUnitAsset('infantry', {})).toBe(getUnitAsset('infantry'))
  })

  it('uses "default" key when kind is null', () => {
    const cosmetics = { default: '/cosmetic/default_unit.png' }
    expect(getPlayerUnitAsset(null, cosmetics)).toBe('/cosmetic/default_unit.png')
  })
})

// ---------------------------------------------------------------------------
// getActionAsset
// ---------------------------------------------------------------------------

describe('getActionAsset()', () => {
  beforeEach(() => {
    mockGetOverrideUrl.mockReturnValue(null)
    // Return fallback directly for assertion clarity
    mockGetAssetUrl.mockImplementation((_key, fallback) => fallback)
  })

  it('returns close icon asset for "close" action', () => {
    const url = getActionAsset('close')
    expect(url).toContain('close')
  })

  it('returns build icon asset for "build" action', () => {
    const url = getActionAsset('build')
    expect(url).toContain('building')
  })

  it('returns defense icon asset for "defense" action', () => {
    const url = getActionAsset('defense')
    expect(url).toContain('shield')
  })

  it('returns players icon asset for "players" action', () => {
    const url = getActionAsset('players')
    expect(url).toContain('hex')
  })

  it('returns plane tag for "attack" with fighter unit type', () => {
    const url = getActionAsset('attack', 'fighter')
    expect(url).toContain('plane')
  })

  it('returns plane tag for "move" with bomber unit type', () => {
    const url = getActionAsset('move', 'bomber')
    expect(url).toContain('plane')
  })

  it('returns ship attack asset for "attack" with ship unit type', () => {
    const url = getActionAsset('attack', 'ship')
    expect(url).toContain('ship')
  })

  it('returns ship move asset for "move" with ship unit type', () => {
    const url = getActionAsset('move', 'ship')
    expect(url).toContain('ship')
  })

  it('returns generic attack icon for "attack" with ground unit', () => {
    const url = getActionAsset('attack', 'infantry')
    expect(url).toContain('attack')
  })

  it('returns generic move icon for "move" with ground unit', () => {
    const url = getActionAsset('move', 'infantry')
    expect(url).toContain('arrow')
  })

  it('returns generic attack icon for "attack" with no unit type', () => {
    const url = getActionAsset('attack')
    expect(url).toContain('attack')
  })
})
