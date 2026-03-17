import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import React from 'react'

// ---------------------------------------------------------------------------
// WebSocket mock
// ---------------------------------------------------------------------------

const OPEN = 1

class MockWebSocket {
  static OPEN = OPEN
  url: string
  readyState = OPEN
  onmessage: ((event: MessageEvent) => void) | null = null
  onclose: ((event: CloseEvent) => void) | null = null
  onopen: (() => void) | null = null
  onerror: (() => void) | null = null
  sent: string[] = []

  static instances: MockWebSocket[] = []

  constructor(url: string) {
    this.url = url
    MockWebSocket.instances.push(this)
    Promise.resolve().then(() => this.onopen?.())
  }

  send(data: string) { this.sent.push(data) }
  close() { this.readyState = 3 }

  simulateMessage(data: unknown) {
    const event = new MessageEvent('message', { data: JSON.stringify(data) })
    this.onmessage?.(event)
  }

  simulateClose(code = 1000) {
    const event = new CloseEvent('close', { code })
    this.onclose?.(event)
  }
}

vi.stubGlobal('WebSocket', MockWebSocket)

// ---------------------------------------------------------------------------
// Dependency mocks
// ---------------------------------------------------------------------------

vi.mock('@/lib/auth', () => ({
  getAccessToken: vi.fn(() => 'test-token'),
}))

vi.mock('@/lib/api', () => ({
  getWsTicket: vi.fn().mockRejectedValue(new Error('no ticket')),
}))

vi.mock('@/lib/pow', () => ({
  solveChallenge: vi.fn().mockResolvedValue('nonce'),
}))

// ---------------------------------------------------------------------------
// Import provider + hook after mocks
// ---------------------------------------------------------------------------
import { MatchmakingProvider, useMatchmaking } from '../useMatchmaking'

function wrapper({ children }: { children: React.ReactNode }) {
  return React.createElement(MatchmakingProvider, null, children)
}

function getLastWs(): MockWebSocket {
  return MockWebSocket.instances[MockWebSocket.instances.length - 1]
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('useMatchmaking', () => {
  beforeEach(() => {
    MockWebSocket.instances = []
    sessionStorage.clear()
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.clearAllMocks()
  })

  it('throws when used outside MatchmakingProvider', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(() => renderHook(() => useMatchmaking())).toThrow(
      'useMatchmaking must be used within MatchmakingProvider'
    )
    spy.mockRestore()
  })

  // -------------------------------------------------------------------------
  // Initial state
  // -------------------------------------------------------------------------

  it('has correct initial state', async () => {
    const { result } = renderHook(() => useMatchmaking(), { wrapper })
    await act(async () => {})

    expect(result.current.inQueue).toBe(false)
    expect(result.current.playersInQueue).toBe(0)
    expect(result.current.matchId).toBeNull()
    expect(result.current.activeMatchId).toBeNull()
    expect(result.current.lobbyId).toBeNull()
    expect(result.current.lobbyPlayers).toEqual([])
    expect(result.current.lobbyFull).toBe(false)
    expect(result.current.allReady).toBe(false)
    expect(result.current.readyCountdown).toBeNull()
  })

  // -------------------------------------------------------------------------
  // joinQueue
  // -------------------------------------------------------------------------

  it('joinQueue() creates a WebSocket connection', async () => {
    const { result } = renderHook(() => useMatchmaking(), { wrapper })
    await act(async () => {})

    const countBefore = MockWebSocket.instances.length

    act(() => {
      result.current.joinQueue()
    })
    await act(async () => { await Promise.resolve() })

    expect(MockWebSocket.instances.length).toBeGreaterThan(countBefore)
  })

  it('joinQueue() sets inQueue=true when socket opens', async () => {
    const { result } = renderHook(() => useMatchmaking(), { wrapper })
    await act(async () => {})

    act(() => {
      result.current.joinQueue()
    })
    await act(async () => { await Promise.resolve() })

    expect(result.current.inQueue).toBe(true)
  })

  it('joinQueue() sends status action on open', async () => {
    const { result } = renderHook(() => useMatchmaking(), { wrapper })
    await act(async () => {})

    act(() => {
      result.current.joinQueue()
    })
    await act(async () => { await Promise.resolve() })

    const sentMessages = getLastWs().sent.map((s) => JSON.parse(s))
    expect(sentMessages.some((m) => m.action === 'status')).toBe(true)
  })

  // -------------------------------------------------------------------------
  // leaveQueue
  // -------------------------------------------------------------------------

  it('leaveQueue() sets inQueue=false and clears lobby state', async () => {
    const { result } = renderHook(() => useMatchmaking(), { wrapper })
    await act(async () => {})

    act(() => { result.current.joinQueue() })
    await act(async () => { await Promise.resolve() })
    expect(result.current.inQueue).toBe(true)

    act(() => { result.current.leaveQueue() })

    expect(result.current.inQueue).toBe(false)
    expect(result.current.lobbyId).toBeNull()
    expect(result.current.lobbyPlayers).toEqual([])
    expect(result.current.lobbyFull).toBe(false)
  })

  it('leaveQueue() sends cancel action before closing', async () => {
    const { result } = renderHook(() => useMatchmaking(), { wrapper })
    await act(async () => {})

    act(() => { result.current.joinQueue() })
    await act(async () => { await Promise.resolve() })

    const ws = getLastWs()
    ws.readyState = OPEN

    act(() => { result.current.leaveQueue() })

    const sentMessages = ws.sent.map((s) => JSON.parse(s))
    expect(sentMessages.some((m) => m.action === 'cancel')).toBe(true)
  })

  // -------------------------------------------------------------------------
  // Server messages — queue_status
  // -------------------------------------------------------------------------

  it('queue_status message updates playersInQueue', async () => {
    const { result } = renderHook(() => useMatchmaking(), { wrapper })
    await act(async () => {})

    act(() => { result.current.joinQueue() })
    await act(async () => { await Promise.resolve() })

    act(() => {
      getLastWs().simulateMessage({ type: 'queue_status', players_in_queue: 7 })
    })

    expect(result.current.playersInQueue).toBe(7)
  })

  // -------------------------------------------------------------------------
  // Server messages — match_found
  // -------------------------------------------------------------------------

  it('match_found message sets matchId and clears queue state', async () => {
    const { result } = renderHook(() => useMatchmaking(), { wrapper })
    await act(async () => {})

    act(() => { result.current.joinQueue() })
    await act(async () => { await Promise.resolve() })

    act(() => {
      getLastWs().simulateMessage({ type: 'match_found', match_id: 'match-99' })
    })

    expect(result.current.matchId).toBe('match-99')
    expect(result.current.activeMatchId).toBe('match-99')
    expect(result.current.inQueue).toBe(false)
  })

  // -------------------------------------------------------------------------
  // Server messages — lobby_created / lobby_full / all_ready
  // -------------------------------------------------------------------------

  it('lobby_created sets lobbyId and lobbyPlayers', async () => {
    const { result } = renderHook(() => useMatchmaking(), { wrapper })
    await act(async () => {})

    act(() => { result.current.joinQueue() })
    await act(async () => { await Promise.resolve() })

    act(() => {
      getLastWs().simulateMessage({
        type: 'lobby_created',
        lobby_id: 'lobby-42',
        max_players: 2,
        players: [
          { user_id: 'u1', username: 'Alice', is_bot: false, is_ready: false, is_banned: false },
        ],
        created_at: Date.now() / 1000,
      })
    })

    expect(result.current.lobbyId).toBe('lobby-42')
    expect(result.current.lobbyPlayers).toHaveLength(1)
    expect(result.current.lobbyMaxPlayers).toBe(2)
  })

  it('lobby_full sets lobbyFull=true', async () => {
    const { result } = renderHook(() => useMatchmaking(), { wrapper })
    await act(async () => {})

    act(() => { result.current.joinQueue() })
    await act(async () => { await Promise.resolve() })

    act(() => {
      getLastWs().simulateMessage({
        type: 'lobby_full',
        full_at: Date.now() / 1000,
        players: [
          { user_id: 'u1', username: 'Alice', is_bot: false, is_ready: false, is_banned: false },
          { user_id: 'u2', username: 'Bob', is_bot: false, is_ready: false, is_banned: false },
        ],
      })
    })

    expect(result.current.lobbyFull).toBe(true)
  })

  it('all_ready message sets allReady=true', async () => {
    const { result } = renderHook(() => useMatchmaking(), { wrapper })
    await act(async () => {})

    act(() => { result.current.joinQueue() })
    await act(async () => { await Promise.resolve() })

    act(() => {
      getLastWs().simulateMessage({ type: 'all_ready' })
    })

    expect(result.current.allReady).toBe(true)
  })

  // -------------------------------------------------------------------------
  // Server messages — lobby_cancelled
  // -------------------------------------------------------------------------

  it('lobby_cancelled resets all lobby state', async () => {
    const { result } = renderHook(() => useMatchmaking(), { wrapper })
    await act(async () => {})

    act(() => { result.current.joinQueue() })
    await act(async () => { await Promise.resolve() })

    // Set some lobby state first
    act(() => {
      getLastWs().simulateMessage({
        type: 'lobby_created',
        lobby_id: 'lobby-1',
        max_players: 2,
        players: [{ user_id: 'u1', username: 'Alice', is_bot: false, is_ready: false, is_banned: false }],
        created_at: Date.now() / 1000,
      })
    })

    act(() => {
      getLastWs().simulateMessage({ type: 'lobby_cancelled' })
    })

    expect(result.current.inQueue).toBe(false)
    expect(result.current.lobbyId).toBeNull()
    expect(result.current.lobbyPlayers).toEqual([])
  })

  // -------------------------------------------------------------------------
  // queue_left
  // -------------------------------------------------------------------------

  it('queue_left message sets inQueue=false', async () => {
    const { result } = renderHook(() => useMatchmaking(), { wrapper })
    await act(async () => {})

    act(() => { result.current.joinQueue() })
    await act(async () => { await Promise.resolve() })

    act(() => {
      getLastWs().simulateMessage({ type: 'queue_left' })
    })

    expect(result.current.inQueue).toBe(false)
  })

  // -------------------------------------------------------------------------
  // voice_token
  // -------------------------------------------------------------------------

  it('voice_token message sets voiceToken and voiceUrl', async () => {
    const { result } = renderHook(() => useMatchmaking(), { wrapper })
    await act(async () => {})

    act(() => { result.current.joinQueue() })
    await act(async () => { await Promise.resolve() })

    act(() => {
      getLastWs().simulateMessage({ type: 'voice_token', token: 'vt-xyz', url: 'wss://voice.test' })
    })

    expect(result.current.voiceToken).toBe('vt-xyz')
    expect(result.current.voiceUrl).toBe('wss://voice.test')
  })
})
