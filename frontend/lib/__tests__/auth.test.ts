import { describe, it, expect, beforeEach } from 'vitest'
import {
  getAccessToken,
  getRefreshToken,
  setTokens,
  clearTokens,
  isLoggedIn,
} from '../auth'

describe('auth utilities', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  describe('getAccessToken', () => {
    it('returns null when no token is stored', () => {
      expect(getAccessToken()).toBeNull()
    })

    it('returns the stored access token', () => {
      localStorage.setItem('maplord_access', 'test-access-token')
      expect(getAccessToken()).toBe('test-access-token')
    })
  })

  describe('getRefreshToken', () => {
    it('returns null when no refresh token is stored', () => {
      expect(getRefreshToken()).toBeNull()
    })

    it('returns the stored refresh token', () => {
      localStorage.setItem('maplord_refresh', 'test-refresh-token')
      expect(getRefreshToken()).toBe('test-refresh-token')
    })
  })

  describe('setTokens', () => {
    it('stores both access and refresh tokens in localStorage', () => {
      setTokens('my-access', 'my-refresh')
      expect(localStorage.getItem('maplord_access')).toBe('my-access')
      expect(localStorage.getItem('maplord_refresh')).toBe('my-refresh')
    })

    it('overwrites previously stored tokens', () => {
      setTokens('first-access', 'first-refresh')
      setTokens('second-access', 'second-refresh')
      expect(localStorage.getItem('maplord_access')).toBe('second-access')
      expect(localStorage.getItem('maplord_refresh')).toBe('second-refresh')
    })
  })

  describe('clearTokens', () => {
    it('removes both tokens from localStorage', () => {
      setTokens('access', 'refresh')
      clearTokens()
      expect(localStorage.getItem('maplord_access')).toBeNull()
      expect(localStorage.getItem('maplord_refresh')).toBeNull()
    })

    it('does not throw when tokens are not present', () => {
      expect(() => clearTokens()).not.toThrow()
    })
  })

  describe('isLoggedIn', () => {
    it('returns false when no access token is present', () => {
      expect(isLoggedIn()).toBe(false)
    })

    it('returns true when an access token is stored', () => {
      setTokens('valid-token', 'refresh-token')
      expect(isLoggedIn()).toBe(true)
    })

    it('returns false after tokens are cleared', () => {
      setTokens('valid-token', 'refresh-token')
      clearTokens()
      expect(isLoggedIn()).toBe(false)
    })
  })
})
