import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import React from 'react'

// ---------------------------------------------------------------------------
// Mock dependencies
// ---------------------------------------------------------------------------

const mockGetMe = vi.fn()
const mockLogin = vi.fn()
const mockRegister = vi.fn()
const mockRefreshToken = vi.fn()

vi.mock('@/lib/api', () => ({
  getMe: (...args: unknown[]) => mockGetMe(...args),
  login: (...args: unknown[]) => mockLogin(...args),
  register: (...args: unknown[]) => mockRegister(...args),
  refreshToken: (...args: unknown[]) => mockRefreshToken(...args),
  APIError: class APIError extends Error {
    status: number
    body: unknown
    constructor(status: number, message: string, body?: unknown) {
      super(message)
      this.name = 'APIError'
      this.status = status
      this.body = body
    }
  },
  BannedError: class BannedError extends Error {
    constructor() {
      super('Account banned')
      this.name = 'BannedError'
    }
  },
}))

vi.mock('@/lib/auth', () => ({
  getAccessToken: vi.fn(),
  getRefreshToken: vi.fn(),
  setTokens: vi.fn(),
  clearTokens: vi.fn(),
}))

import { getAccessToken, getRefreshToken, setTokens, clearTokens } from '@/lib/auth'
import { APIError, BannedError } from '@/lib/api'

// Import the hook/provider after mocks are set up.
import { AuthProvider, useAuth } from '../useAuth'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const mockUser = {
  id: 'user-1',
  username: 'Alice',
  email: 'alice@example.com',
  role: 'player',
  elo_rating: 1200,
  date_joined: '2026-01-01T00:00:00Z',
  tutorial_completed: true,
  is_banned: false,
}

function wrapper({ children }: { children: React.ReactNode }) {
  return React.createElement(AuthProvider, null, children)
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('useAuth', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Default: no stored token
    vi.mocked(getAccessToken).mockReturnValue(null)
    vi.mocked(getRefreshToken).mockReturnValue(null)
  })

  it('throws when used outside of AuthProvider', () => {
    // Suppress the React error boundary console.error noise
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(() => renderHook(() => useAuth())).toThrow('useAuth must be used within AuthProvider')
    spy.mockRestore()
  })

  // -------------------------------------------------------------------------
  // Initial loading state
  // -------------------------------------------------------------------------

  it('has loading=true initially when an access token exists', async () => {
    vi.mocked(getAccessToken).mockReturnValue('stored-token')
    // Delay resolution so we can catch the loading state
    mockGetMe.mockReturnValue(new Promise(() => {}))

    const { result } = renderHook(() => useAuth(), { wrapper })
    expect(result.current.loading).toBe(true)
  })

  it('has loading=false and user=null when no token is stored', async () => {
    vi.mocked(getAccessToken).mockReturnValue(null)
    const { result } = renderHook(() => useAuth(), { wrapper })
    // No async work — loading should become false synchronously via useEffect
    await act(async () => {})
    expect(result.current.loading).toBe(false)
    expect(result.current.user).toBeNull()
  })

  // -------------------------------------------------------------------------
  // Authenticated user loaded on mount
  // -------------------------------------------------------------------------

  it('loads user from stored token on mount', async () => {
    vi.mocked(getAccessToken).mockReturnValue('valid-token')
    mockGetMe.mockResolvedValue(mockUser)

    const { result } = renderHook(() => useAuth(), { wrapper })
    await act(async () => {})

    expect(result.current.user).toEqual(mockUser)
    expect(result.current.loading).toBe(false)
    expect(result.current.token).toBe('valid-token')
  })

  it('clears user when stored token fetch fails and no refresh token', async () => {
    vi.mocked(getAccessToken).mockReturnValue('expired-token')
    vi.mocked(getRefreshToken).mockReturnValue(null)
    mockGetMe.mockRejectedValue(new Error('network error'))

    const { result } = renderHook(() => useAuth(), { wrapper })
    await act(async () => {})

    expect(result.current.user).toBeNull()
    expect(result.current.loading).toBe(false)
  })

  // -------------------------------------------------------------------------
  // Token refresh on 401
  // -------------------------------------------------------------------------

  it('refreshes token when getMe fails and a refresh token exists', async () => {
    vi.mocked(getAccessToken).mockReturnValue('expired-token')
    vi.mocked(getRefreshToken).mockReturnValue('refresh-token')

    // First getMe call fails, refresh succeeds, second getMe call succeeds
    mockGetMe
      .mockRejectedValueOnce(new Error('expired'))
      .mockResolvedValueOnce(mockUser)

    mockRefreshToken.mockResolvedValue({ access: 'new-access', refresh: 'new-refresh' })

    const { result } = renderHook(() => useAuth(), { wrapper })
    await act(async () => {})

    expect(mockRefreshToken).toHaveBeenCalledWith('refresh-token')
    expect(setTokens).toHaveBeenCalledWith('new-access', 'new-refresh')
    expect(result.current.user).toEqual(mockUser)
  })

  // -------------------------------------------------------------------------
  // login()
  // -------------------------------------------------------------------------

  it('login() sets user and token on success', async () => {
    vi.mocked(getAccessToken).mockReturnValue(null)
    mockLogin.mockResolvedValue({ access: 'acc', refresh: 'ref' })
    mockGetMe.mockResolvedValue(mockUser)

    const { result } = renderHook(() => useAuth(), { wrapper })
    await act(async () => {})

    await act(async () => {
      await result.current.login('alice@example.com', 'password')
    })

    expect(setTokens).toHaveBeenCalledWith('acc', 'ref')
    expect(result.current.user).toEqual(mockUser)
    expect(result.current.token).toBe('acc')
  })

  it('login() throws BannedError when user is banned', async () => {
    vi.mocked(getAccessToken).mockReturnValue(null)
    mockLogin.mockResolvedValue({ access: 'acc', refresh: 'ref' })
    mockGetMe.mockResolvedValue({ ...mockUser, is_banned: true })

    const { result } = renderHook(() => useAuth(), { wrapper })
    await act(async () => {})

    await expect(
      act(async () => {
        await result.current.login('banned@example.com', 'password')
      })
    ).rejects.toThrow()

    expect(clearTokens).toHaveBeenCalled()
  })

  // -------------------------------------------------------------------------
  // logout()
  // -------------------------------------------------------------------------

  it('logout() clears user and token', async () => {
    vi.mocked(getAccessToken).mockReturnValue('valid-token')
    mockGetMe.mockResolvedValue(mockUser)

    const { result } = renderHook(() => useAuth(), { wrapper })
    await act(async () => {})

    expect(result.current.user).toEqual(mockUser)

    act(() => {
      result.current.logout()
    })

    expect(clearTokens).toHaveBeenCalled()
    expect(result.current.user).toBeNull()
    expect(result.current.token).toBeNull()
    expect(result.current.isBanned).toBe(false)
  })

  // -------------------------------------------------------------------------
  // Banned state
  // -------------------------------------------------------------------------

  it('sets isBanned=true and clears user when getMe returns a banned user', async () => {
    vi.mocked(getAccessToken).mockReturnValue('valid-token')
    mockGetMe.mockResolvedValue({ ...mockUser, is_banned: true })

    const { result } = renderHook(() => useAuth(), { wrapper })
    await act(async () => {})

    expect(result.current.isBanned).toBe(true)
    expect(result.current.user).toBeNull()
    expect(clearTokens).toHaveBeenCalled()
  })

  it('sets isBanned=true when getMe returns a 401 APIError', async () => {
    vi.mocked(getAccessToken).mockReturnValue('valid-token')
    vi.mocked(getRefreshToken).mockReturnValue(null)
    mockGetMe.mockRejectedValue(new APIError(401, 'Unauthorized'))

    const { result } = renderHook(() => useAuth(), { wrapper })
    await act(async () => {})

    expect(result.current.isBanned).toBe(true)
    expect(result.current.user).toBeNull()
  })

  // -------------------------------------------------------------------------
  // refreshUser()
  // -------------------------------------------------------------------------

  it('refreshUser() re-fetches and updates the user', async () => {
    vi.mocked(getAccessToken).mockReturnValue('valid-token')
    mockGetMe.mockResolvedValue(mockUser)

    const { result } = renderHook(() => useAuth(), { wrapper })
    await act(async () => {})

    const updatedUser = { ...mockUser, elo_rating: 1300 }
    mockGetMe.mockResolvedValue(updatedUser)

    await act(async () => {
      await result.current.refreshUser()
    })

    expect(result.current.user?.elo_rating).toBe(1300)
  })
})
