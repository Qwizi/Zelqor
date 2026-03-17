import { describe, it, expect } from 'vitest'
import { cn } from '../utils'

describe('cn utility', () => {
  it('merges two class name strings', () => {
    expect(cn('foo', 'bar')).toBe('foo bar')
  })

  it('handles a single class name', () => {
    expect(cn('only')).toBe('only')
  })

  it('deduplicates conflicting Tailwind classes, keeping the last one', () => {
    // tailwind-merge resolves conflicting utility classes
    expect(cn('p-2', 'p-4')).toBe('p-4')
    expect(cn('text-red-500', 'text-blue-500')).toBe('text-blue-500')
  })

  it('handles conditional classes with objects', () => {
    expect(cn('base', { active: true, disabled: false })).toBe('base active')
  })

  it('omits falsy conditional classes', () => {
    expect(cn('base', { active: false })).toBe('base')
  })

  it('handles undefined and null gracefully', () => {
    expect(cn('foo', undefined, null, 'bar')).toBe('foo bar')
  })

  it('returns an empty string when called with no arguments', () => {
    expect(cn()).toBe('')
  })

  it('handles array inputs', () => {
    expect(cn(['a', 'b'], 'c')).toBe('a b c')
  })

  it('merges non-conflicting Tailwind classes together', () => {
    const result = cn('px-2 py-1', 'rounded')
    expect(result).toBe('px-2 py-1 rounded')
  })
})
