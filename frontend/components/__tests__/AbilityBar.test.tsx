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
// Mock assetOverrides
// ---------------------------------------------------------------------------

vi.mock('@/lib/assetOverrides', () => ({
  getAssetUrl: (_key: string, fallback: string) => fallback,
}))

import AbilityBar from '@/components/game/AbilityBar'
import type { AbilityType } from '@/lib/api'

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeAbility(overrides: Partial<AbilityType> = {}): AbilityType {
  return {
    id: 'a-1',
    name: 'Strike',
    slug: 'strike',
    asset_key: 'strike',
    asset_url: null,
    description: 'Deals damage',
    icon: '',
    sound_key: '',
    sound_url: null,
    target_type: 'enemy',
    range: 1,
    energy_cost: 15,
    cooldown_ticks: 10,
    damage: 50,
    effect_duration_ticks: 0,
    effect_params: {},
    order: 1,
    max_level: 3,
    level_stats: {},
    ...overrides,
  }
}

function makeBoostAbility(overrides: Partial<AbilityType> = {}): AbilityType {
  return makeAbility({
    id: 'a-boost',
    name: 'Production Boost',
    slug: 'boost-production',
    asset_key: 'boost-production',
    energy_cost: 20,
    cooldown_ticks: 20,
    order: 10,
    ...overrides,
  })
}

function defaultProps(
  overrides: Partial<Parameters<typeof AbilityBar>[0]> = {}
) {
  const abilities = [makeAbility()]
  const scrolls: Record<string, number> = { strike: 3 }
  return {
    abilities,
    myEnergy: 100,
    abilityCooldowns: {},
    currentTick: 0,
    selectedAbility: null,
    onSelectAbility: vi.fn(),
    onActivateBoost: vi.fn(),
    abilityScrolls: scrolls,
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('AbilityBar', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // ── Render nothing when no abilities ──────────────────────────────────────

  it('renders nothing when abilities list is empty', () => {
    const { container } = render(
      <AbilityBar {...defaultProps({ abilities: [], abilityScrolls: {} })} />
    )
    expect(container.firstChild).toBeNull()
  })

  it('renders nothing when abilityScrolls is undefined', () => {
    const { container } = render(
      <AbilityBar {...defaultProps({ abilityScrolls: undefined })} />
    )
    expect(container.firstChild).toBeNull()
  })

  it('renders nothing when abilityScrolls is empty (no uses remaining)', () => {
    const { container } = render(
      <AbilityBar {...defaultProps({ abilityScrolls: {} })} />
    )
    expect(container.firstChild).toBeNull()
  })

  // ── Ability buttons ────────────────────────────────────────────────────────

  it('renders ability buttons for abilities with remaining uses', () => {
    render(<AbilityBar {...defaultProps()} />)
    // Strike ability image appears (alt = ability name)
    expect(screen.getAllByAltText('Strike').length).toBeGreaterThan(0)
  })

  it('does not render ability with zero remaining uses', () => {
    render(
      <AbilityBar
        {...defaultProps({
          abilityScrolls: { strike: 0 },
        })}
      />
    )
    expect(screen.queryByAltText('Strike')).not.toBeInTheDocument()
  })

  // ── Energy cost display ────────────────────────────────────────────────────

  it('shows energy cost below each ability button', () => {
    render(<AbilityBar {...defaultProps()} />)
    // Cost shown as "15⚡" (both mobile and desktop)
    const costTexts = screen.getAllByText(/15⚡/)
    expect(costTexts.length).toBeGreaterThan(0)
  })

  it('shows energy cost in destructive color when player cannot afford', () => {
    render(<AbilityBar {...defaultProps({ myEnergy: 5 })} />)
    const costTexts = screen.getAllByText(/15⚡/)
    costTexts.forEach((el) => {
      expect(el.className).toContain('destructive')
    })
  })

  it('shows energy cost in accent color when player can afford', () => {
    render(<AbilityBar {...defaultProps({ myEnergy: 100 })} />)
    const costTexts = screen.getAllByText(/15⚡/)
    costTexts.forEach((el) => {
      expect(el.className).toContain('accent')
    })
  })

  // ── Level stats energy cost ────────────────────────────────────────────────

  it('uses level_stats energy cost when abilityLevel is provided', () => {
    const ability = makeAbility({
      level_stats: { '2': { energy_cost: 25 } },
    })
    render(
      <AbilityBar
        {...defaultProps({
          abilities: [ability],
          abilityLevels: { strike: 2 },
        })}
      />
    )
    expect(screen.getAllByText(/25⚡/).length).toBeGreaterThan(0)
  })

  // ── Cooldown display ───────────────────────────────────────────────────────

  it('shows cooldown countdown when ability is on cooldown', () => {
    render(
      <AbilityBar
        {...defaultProps({
          abilityCooldowns: { strike: 15 }, // ready at tick 15
          currentTick: 10, // current is 10, so 5 ticks remaining
        })}
      />
    )
    // Cooldown remaining shown as "Xs"
    expect(screen.getAllByText('5s').length).toBeGreaterThan(0)
  })

  it('does not show cooldown overlay when ability is ready', () => {
    render(
      <AbilityBar
        {...defaultProps({
          abilityCooldowns: { strike: 5 },
          currentTick: 10, // current > cooldown ready → not on cooldown
        })}
      />
    )
    expect(screen.queryByText(/\ds$/)).not.toBeInTheDocument()
  })

  // ── Disabled when on cooldown ─────────────────────────────────────────────

  it('disables ability button when on cooldown', () => {
    render(
      <AbilityBar
        {...defaultProps({
          abilityCooldowns: { strike: 20 },
          currentTick: 10,
        })}
      />
    )
    const buttons = screen.getAllByRole('button')
    const abilityButtons = buttons.filter((btn) =>
      btn.title?.includes('Strike')
    )
    expect(abilityButtons.length).toBeGreaterThan(0)
    abilityButtons.forEach((btn) => expect(btn).toBeDisabled())
  })

  it('disables ability button when energy is insufficient', () => {
    render(<AbilityBar {...defaultProps({ myEnergy: 0 })} />)
    const buttons = screen.getAllByRole('button')
    const abilityButtons = buttons.filter((btn) =>
      btn.title?.includes('Strike')
    )
    expect(abilityButtons.length).toBeGreaterThan(0)
    abilityButtons.forEach((btn) => expect(btn).toBeDisabled())
  })

  it('enables ability button when ready and affordable', () => {
    render(
      <AbilityBar
        {...defaultProps({
          abilityCooldowns: {},
          myEnergy: 100,
        })}
      />
    )
    const buttons = screen.getAllByRole('button')
    const abilityButtons = buttons.filter((btn) =>
      btn.title?.includes('Strike')
    )
    expect(abilityButtons.length).toBeGreaterThan(0)
    abilityButtons.forEach((btn) => expect(btn).not.toBeDisabled())
  })

  // ── Click triggers onSelectAbility ────────────────────────────────────────

  it('calls onSelectAbility with ability slug on click', () => {
    const onSelectAbility = vi.fn()
    render(<AbilityBar {...defaultProps({ onSelectAbility })} />)
    const buttons = screen.getAllByRole('button')
    const abilityButtons = buttons.filter((btn) =>
      btn.title?.includes('Strike')
    )
    fireEvent.click(abilityButtons[0])
    expect(onSelectAbility).toHaveBeenCalledWith('strike')
  })

  it('toggles selection off when clicking already-selected ability', () => {
    const onSelectAbility = vi.fn()
    render(
      <AbilityBar
        {...defaultProps({
          onSelectAbility,
          selectedAbility: 'strike',
        })}
      />
    )
    const buttons = screen.getAllByRole('button')
    const abilityButtons = buttons.filter((btn) =>
      btn.title?.includes('Strike')
    )
    fireEvent.click(abilityButtons[0])
    expect(onSelectAbility).toHaveBeenCalledWith(null)
  })

  // ── Boost abilities ────────────────────────────────────────────────────────

  it('renders boost ability buttons when scrolls has boost', () => {
    const boostAbility = makeBoostAbility()
    render(
      <AbilityBar
        {...defaultProps({
          abilities: [boostAbility],
          abilityScrolls: { 'boost-production': 2 },
        })}
      />
    )
    expect(
      screen.getAllByAltText('Production Boost').length
    ).toBeGreaterThan(0)
  })

  it('calls onActivateBoost instead of onSelectAbility for boost abilities', () => {
    const onActivateBoost = vi.fn()
    const onSelectAbility = vi.fn()
    const boostAbility = makeBoostAbility()
    render(
      <AbilityBar
        {...defaultProps({
          abilities: [boostAbility],
          abilityScrolls: { 'boost-production': 2 },
          onActivateBoost,
          onSelectAbility,
        })}
      />
    )
    const buttons = screen.getAllByRole('button')
    const boostButtons = buttons.filter((btn) =>
      btn.title?.includes('Production Boost')
    )
    fireEvent.click(boostButtons[0])
    expect(onActivateBoost).toHaveBeenCalledWith('boost-production')
    expect(onSelectAbility).not.toHaveBeenCalled()
  })

  it('shows BOOST chip for boost abilities when not on cooldown', () => {
    const boostAbility = makeBoostAbility()
    render(
      <AbilityBar
        {...defaultProps({
          abilities: [boostAbility],
          abilityScrolls: { 'boost-production': 2 },
        })}
      />
    )
    expect(screen.getAllByText('BOOST').length).toBeGreaterThan(0)
  })

  // ── Remaining uses badge ───────────────────────────────────────────────────

  it('shows remaining uses badge when < 100', () => {
    render(
      <AbilityBar
        {...defaultProps({
          abilityScrolls: { strike: 5 },
        })}
      />
    )
    expect(screen.getAllByText('5').length).toBeGreaterThan(0)
  })

  it('hides remaining uses badge when >= 100', () => {
    render(
      <AbilityBar
        {...defaultProps({
          abilityScrolls: { strike: 100 },
        })}
      />
    )
    // Badge is hidden but ability is still shown; check no "100" badge
    // The energy cost might contain numbers but should not have a "100" badge element
    const badges = screen.queryAllByText('100')
    // If found, they should not be the small badge element (only appears in cost text etc.)
    badges.forEach((el) => {
      expect(el.tagName).not.toBe('SPAN')
    })
  })

  // ── Level badge ────────────────────────────────────────────────────────────

  it('shows level badge when abilityLevels is provided', () => {
    render(
      <AbilityBar
        {...defaultProps({
          abilityLevels: { strike: 2 },
        })}
      />
    )
    expect(screen.getAllByText('Lvl 2').length).toBeGreaterThan(0)
  })

  it('does not show level badge when abilityLevels not provided', () => {
    render(<AbilityBar {...defaultProps({ abilityLevels: undefined })} />)
    expect(screen.queryByText(/^Lvl \d+$/)).not.toBeInTheDocument()
  })

  // ── Locked abilities (tutorial mode) ─────────────────────────────────────

  it('disables abilities not matching allowedAbility in tutorial mode', () => {
    const abilities = [
      makeAbility({ id: 'a-1', slug: 'strike', name: 'Strike' }),
      makeAbility({ id: 'a-2', slug: 'shield', name: 'Shield', order: 2 }),
    ]
    render(
      <AbilityBar
        {...defaultProps({
          abilities,
          abilityScrolls: { strike: 1, shield: 1 },
          allowedAbility: 'shield',
        })}
      />
    )
    const buttons = screen.getAllByRole('button')
    const strikeButtons = buttons.filter((btn) =>
      btn.title?.includes('Strike')
    )
    strikeButtons.forEach((btn) => expect(btn).toBeDisabled())
  })

  // ── Mixed abilities and boosts render separator ────────────────────────────

  it('renders both regular abilities and boosts when both present', () => {
    const normalAbility = makeAbility()
    const boostAbility = makeBoostAbility()
    render(
      <AbilityBar
        {...defaultProps({
          abilities: [normalAbility, boostAbility],
          abilityScrolls: { strike: 1, 'boost-production': 1 },
        })}
      />
    )
    expect(screen.getAllByAltText('Strike').length).toBeGreaterThan(0)
    expect(screen.getAllByAltText('Production Boost').length).toBeGreaterThan(0)
  })

  // ── Button title tooltip ──────────────────────────────────────────────────

  it('button title contains ability name and energy cost', () => {
    render(<AbilityBar {...defaultProps()} />)
    const buttons = screen.getAllByRole('button')
    const abilityButtons = buttons.filter((btn) =>
      btn.title?.includes('Strike')
    )
    expect(abilityButtons.length).toBeGreaterThan(0)
    expect(abilityButtons[0].title).toContain('15⚡')
  })

  it('button title contains remaining uses when defined', () => {
    render(
      <AbilityBar {...defaultProps({ abilityScrolls: { strike: 7 } })} />
    )
    const buttons = screen.getAllByRole('button')
    const abilityButtons = buttons.filter((btn) =>
      btn.title?.includes('Strike')
    )
    abilityButtons.forEach((btn) => {
      expect(btn.title).toContain('7')
    })
  })
})
