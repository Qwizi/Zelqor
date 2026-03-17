import { describe, it, expect } from 'vitest'
import { TUTORIAL_STEPS, type TutorialStep } from '../tutorialSteps'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Minimal GameState stub sufficient for condition/highlight tests */
function makeGameState(overrides: Record<string, unknown> = {}) {
  return {
    tick: 0,
    meta: { status: 'in_progress' },
    players: {},
    regions: {},
    buildings_queue: [],
    units_queue: [],
    ...overrides,
  } as unknown as Parameters<NonNullable<TutorialStep['condition']>>[0]
}

// ---------------------------------------------------------------------------
// Structure and completeness
// ---------------------------------------------------------------------------

describe('TUTORIAL_STEPS — structure', () => {
  it('is a non-empty array', () => {
    expect(Array.isArray(TUTORIAL_STEPS)).toBe(true)
    expect(TUTORIAL_STEPS.length).toBeGreaterThan(0)
  })

  it('contains at least 18 steps', () => {
    expect(TUTORIAL_STEPS.length).toBeGreaterThanOrEqual(18)
  })

  it('every step has a non-empty string id', () => {
    for (const step of TUTORIAL_STEPS) {
      expect(typeof step.id).toBe('string')
      expect(step.id.length).toBeGreaterThan(0)
    }
  })

  it('every step has a non-empty string title', () => {
    for (const step of TUTORIAL_STEPS) {
      expect(typeof step.title).toBe('string')
      expect(step.title.length).toBeGreaterThan(0)
    }
  })

  it('every step has a non-empty string description', () => {
    for (const step of TUTORIAL_STEPS) {
      expect(typeof step.description).toBe('string')
      expect(step.description.length).toBeGreaterThan(0)
    }
  })

  it('all step ids are unique', () => {
    const ids = TUTORIAL_STEPS.map((s) => s.id)
    const unique = new Set(ids)
    expect(unique.size).toBe(ids.length)
  })

  it('optional fields, when present, have the correct types', () => {
    for (const step of TUTORIAL_STEPS) {
      if (step.uiTarget !== undefined) {
        expect(typeof step.uiTarget).toBe('string')
      }
      if (step.allowedAbility !== undefined) {
        expect(typeof step.allowedAbility).toBe('string')
      }
      if (step.tickMultiplier !== undefined) {
        expect(typeof step.tickMultiplier).toBe('number')
        expect(step.tickMultiplier).toBeGreaterThan(0)
      }
      if (step.manualAdvance !== undefined) {
        expect(typeof step.manualAdvance).toBe('boolean')
      }
      if (step.condition !== undefined) {
        expect(typeof step.condition).toBe('function')
      }
      if (step.getHighlightRegions !== undefined) {
        expect(typeof step.getHighlightRegions).toBe('function')
      }
    }
  })
})

// ---------------------------------------------------------------------------
// Specific well-known steps
// ---------------------------------------------------------------------------

describe('TUTORIAL_STEPS — required step ids', () => {
  const requiredIds = [
    'welcome',
    'select_capital',
    'economy_intro',
    'attack_neutral',
    'expand',
    'buildings_explain',
    'build_action',
    'abilities_intro',
    'capture_capital',
    'victory',
  ]

  for (const id of requiredIds) {
    it(`contains step with id "${id}"`, () => {
      expect(TUTORIAL_STEPS.some((s) => s.id === id)).toBe(true)
    })
  }
})

describe('TUTORIAL_STEPS — ordering', () => {
  it('welcome step is first', () => {
    expect(TUTORIAL_STEPS[0].id).toBe('welcome')
  })

  it('victory step is last', () => {
    expect(TUTORIAL_STEPS[TUTORIAL_STEPS.length - 1].id).toBe('victory')
  })

  it('select_capital comes before attack_neutral', () => {
    const capitalIdx = TUTORIAL_STEPS.findIndex((s) => s.id === 'select_capital')
    const attackIdx = TUTORIAL_STEPS.findIndex((s) => s.id === 'attack_neutral')
    expect(capitalIdx).toBeLessThan(attackIdx)
  })

  it('attack_neutral comes before expand', () => {
    const attackIdx = TUTORIAL_STEPS.findIndex((s) => s.id === 'attack_neutral')
    const expandIdx = TUTORIAL_STEPS.findIndex((s) => s.id === 'expand')
    expect(attackIdx).toBeLessThan(expandIdx)
  })

  it('buildings steps come before abilities steps', () => {
    const buildIdx = TUTORIAL_STEPS.findIndex((s) => s.id === 'buildings_explain')
    const abIdx = TUTORIAL_STEPS.findIndex((s) => s.id === 'abilities_intro')
    expect(buildIdx).toBeLessThan(abIdx)
  })

  it('capture_capital comes before victory', () => {
    const captureIdx = TUTORIAL_STEPS.findIndex((s) => s.id === 'capture_capital')
    const victoryIdx = TUTORIAL_STEPS.findIndex((s) => s.id === 'victory')
    expect(captureIdx).toBeLessThan(victoryIdx)
  })
})

// ---------------------------------------------------------------------------
// manualAdvance and tickMultiplier
// ---------------------------------------------------------------------------

describe('TUTORIAL_STEPS — manualAdvance steps', () => {
  it('welcome has manualAdvance: true', () => {
    const step = TUTORIAL_STEPS.find((s) => s.id === 'welcome')!
    expect(step.manualAdvance).toBe(true)
  })

  it('victory has manualAdvance: true', () => {
    const step = TUTORIAL_STEPS.find((s) => s.id === 'victory')!
    expect(step.manualAdvance).toBe(true)
  })

  it('select_capital does not have manualAdvance (condition-based)', () => {
    const step = TUTORIAL_STEPS.find((s) => s.id === 'select_capital')!
    expect(step.manualAdvance).toBeFalsy()
  })
})

describe('TUTORIAL_STEPS — tickMultiplier', () => {
  it('welcome step has tickMultiplier of 1', () => {
    const step = TUTORIAL_STEPS.find((s) => s.id === 'welcome')!
    expect(step.tickMultiplier).toBe(1)
  })

  it('build_wait step has a higher tickMultiplier (speed up build wait)', () => {
    const step = TUTORIAL_STEPS.find((s) => s.id === 'build_wait')!
    expect(step.tickMultiplier).toBeGreaterThan(1)
  })

  it('all defined tickMultiplier values are positive integers', () => {
    for (const step of TUTORIAL_STEPS) {
      if (step.tickMultiplier !== undefined) {
        expect(step.tickMultiplier).toBeGreaterThan(0)
        expect(Number.isInteger(step.tickMultiplier)).toBe(true)
      }
    }
  })
})

// ---------------------------------------------------------------------------
// condition functions
// ---------------------------------------------------------------------------

describe('TUTORIAL_STEPS — condition functions', () => {
  it('select_capital condition is false when player has no capital', () => {
    const step = TUTORIAL_STEPS.find((s) => s.id === 'select_capital')!
    const state = makeGameState({
      players: { 'user-1': { capital_region_id: null, is_alive: true, user_id: 'user-1' } },
    })
    expect(step.condition!(state, 'user-1')).toBe(false)
  })

  it('select_capital condition is true when player has a capital', () => {
    const step = TUTORIAL_STEPS.find((s) => s.id === 'select_capital')!
    const state = makeGameState({
      players: { 'user-1': { capital_region_id: 'r1', is_alive: true, user_id: 'user-1' } },
    })
    expect(step.condition!(state, 'user-1')).toBe(true)
  })

  it('attack_neutral condition is false with only 1 owned region', () => {
    const step = TUTORIAL_STEPS.find((s) => s.id === 'attack_neutral')!
    const state = makeGameState({
      regions: { r1: { owner_id: 'user-1' } },
    })
    expect(step.condition!(state, 'user-1')).toBe(false)
  })

  it('attack_neutral condition is true with 2 or more owned regions', () => {
    const step = TUTORIAL_STEPS.find((s) => s.id === 'attack_neutral')!
    const state = makeGameState({
      regions: {
        r1: { owner_id: 'user-1' },
        r2: { owner_id: 'user-1' },
      },
    })
    expect(step.condition!(state, 'user-1')).toBe(true)
  })

  it('expand condition is false with fewer than 4 owned regions', () => {
    const step = TUTORIAL_STEPS.find((s) => s.id === 'expand')!
    const state = makeGameState({
      regions: {
        r1: { owner_id: 'user-1' },
        r2: { owner_id: 'user-1' },
        r3: { owner_id: 'user-1' },
      },
    })
    expect(step.condition!(state, 'user-1')).toBe(false)
  })

  it('expand condition is true with 4 or more owned regions', () => {
    const step = TUTORIAL_STEPS.find((s) => s.id === 'expand')!
    const state = makeGameState({
      regions: {
        r1: { owner_id: 'user-1' },
        r2: { owner_id: 'user-1' },
        r3: { owner_id: 'user-1' },
        r4: { owner_id: 'user-1' },
      },
    })
    expect(step.condition!(state, 'user-1')).toBe(true)
  })

  it('capture_capital condition is true when match status is "finished"', () => {
    const step = TUTORIAL_STEPS.find((s) => s.id === 'capture_capital')!
    const state = makeGameState({ meta: { status: 'finished' } })
    expect(step.condition!(state, 'user-1')).toBe(true)
  })

  it('capture_capital condition is false when match is still in_progress', () => {
    const step = TUTORIAL_STEPS.find((s) => s.id === 'capture_capital')!
    const state = makeGameState({ meta: { status: 'in_progress' } })
    expect(step.condition!(state, 'user-1')).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// getHighlightRegions functions
// ---------------------------------------------------------------------------

describe('TUTORIAL_STEPS — getHighlightRegions functions', () => {
  it('attack_neutral getHighlightRegions returns neutral neighbor region ids', () => {
    const step = TUTORIAL_STEPS.find((s) => s.id === 'attack_neutral')!
    const state = makeGameState({
      regions: {
        r1: { owner_id: 'user-1' },   // owned
        r2: { owner_id: null },         // neutral neighbor
        r3: { owner_id: 'enemy-1' },   // enemy, not neutral
      },
    })
    const neighborMap = { r1: ['r2', 'r3'] }
    const highlighted = step.getHighlightRegions!(state, 'user-1', neighborMap)
    expect(highlighted).toContain('r2')
    expect(highlighted).not.toContain('r3')
  })

  it('capture_capital getHighlightRegions returns the enemy capital', () => {
    const step = TUTORIAL_STEPS.find((s) => s.id === 'capture_capital')!
    const state = makeGameState({
      players: {
        'user-1': { user_id: 'user-1', is_alive: true, capital_region_id: 'r1' },
        'bot-1': { user_id: 'bot-1', is_alive: true, capital_region_id: 'r99' },
      },
    })
    const result = step.getHighlightRegions!(state, 'user-1', {})
    expect(result).toContain('r99')
    expect(result).not.toContain('r1')
  })

  it('capture_capital getHighlightRegions returns empty array when no alive enemy', () => {
    const step = TUTORIAL_STEPS.find((s) => s.id === 'capture_capital')!
    const state = makeGameState({
      players: {
        'user-1': { user_id: 'user-1', is_alive: true, capital_region_id: 'r1' },
        'bot-1': { user_id: 'bot-1', is_alive: false, capital_region_id: 'r99' },
      },
    })
    const result = step.getHighlightRegions!(state, 'user-1', {})
    expect(result).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// ability steps
// ---------------------------------------------------------------------------

describe('TUTORIAL_STEPS — ability steps', () => {
  const abilityStepIds = [
    'ability_conscription',
    'ability_shield',
    'ability_virus',
    'ability_submarine',
    'abilities_nuke',
  ]

  for (const id of abilityStepIds) {
    it(`${id} has an allowedAbility slug`, () => {
      const step = TUTORIAL_STEPS.find((s) => s.id === id)!
      expect(typeof step.allowedAbility).toBe('string')
      expect(step.allowedAbility!.length).toBeGreaterThan(0)
    })

    it(`${id} has a condition that checks the ability cooldown`, () => {
      const step = TUTORIAL_STEPS.find((s) => s.id === id)!
      expect(typeof step.condition).toBe('function')

      const slug = step.allowedAbility!
      const stateWithCooldown = makeGameState({
        players: {
          'user-1': { ability_cooldowns: { [slug]: 5 } },
        },
      })
      const stateWithoutCooldown = makeGameState({
        players: {
          'user-1': { ability_cooldowns: { [slug]: 0 } },
        },
      })

      expect(step.condition!(stateWithCooldown, 'user-1')).toBe(true)
      expect(step.condition!(stateWithoutCooldown, 'user-1')).toBe(false)
    })
  }
})
