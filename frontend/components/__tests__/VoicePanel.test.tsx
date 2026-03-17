import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import React from 'react'

// ---------------------------------------------------------------------------
// Mock lucide-react
// ---------------------------------------------------------------------------

vi.mock('lucide-react', () => ({
  Mic: ({ className }: { className?: string }) =>
    React.createElement('span', { 'data-testid': 'icon-mic', className }),
  MicOff: ({ className }: { className?: string }) =>
    React.createElement('span', { 'data-testid': 'icon-mic-off', className }),
  PhoneOff: ({ className }: { className?: string }) =>
    React.createElement('span', { 'data-testid': 'icon-phone-off', className }),
  Phone: ({ className }: { className?: string }) =>
    React.createElement('span', { 'data-testid': 'icon-phone', className }),
  Users: ({ className }: { className?: string }) =>
    React.createElement('span', { 'data-testid': 'icon-users', className }),
}))

import VoicePanel from '@/components/chat/VoicePanel'
import type { VoicePeer } from '@/hooks/useVoiceChat'

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makePeer(overrides: Partial<VoicePeer> = {}): VoicePeer {
  return {
    identity: 'user-peer',
    name: 'Charlie',
    isSpeaking: false,
    isMuted: false,
    ...overrides,
  }
}

const defaultProps = {
  token: 'test-token',
  url: 'wss://livekit.example.com',
  players: {
    'user-peer': { username: 'Charlie', color: '#4ade80' },
  },
  connected: false,
  micEnabled: true,
  isSpeaking: false,
  peers: [] as VoicePeer[],
  onJoin: vi.fn(),
  onLeave: vi.fn(),
  onToggleMic: vi.fn(),
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('VoicePanel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders nothing when token is null', () => {
    const { container } = render(
      React.createElement(VoicePanel, { ...defaultProps, token: null })
    )
    expect(container.firstChild).toBeNull()
  })

  it('renders nothing when url is null', () => {
    const { container } = render(
      React.createElement(VoicePanel, { ...defaultProps, url: null })
    )
    expect(container.firstChild).toBeNull()
  })

  it('renders nothing when both token and url are null', () => {
    const { container } = render(
      React.createElement(VoicePanel, { ...defaultProps, token: null, url: null })
    )
    expect(container.firstChild).toBeNull()
  })

  it('renders join button in disconnected state (mobile)', () => {
    render(React.createElement(VoicePanel, { ...defaultProps, connected: false }))
    expect(screen.getByTitle('Dolacz do rozmowy')).toBeTruthy()
  })

  it('shows Phone icon when disconnected', () => {
    render(React.createElement(VoicePanel, { ...defaultProps, connected: false }))
    expect(screen.getAllByTestId('icon-phone').length).toBeGreaterThan(0)
  })

  it('calls onJoin when join button is clicked (mobile)', () => {
    const onJoin = vi.fn()
    render(React.createElement(VoicePanel, { ...defaultProps, connected: false, onJoin }))
    fireEvent.click(screen.getByTitle('Dolacz do rozmowy'))
    expect(onJoin).toHaveBeenCalledTimes(1)
  })

  it('renders desktop "Dolacz do rozmowy" text when disconnected', () => {
    render(React.createElement(VoicePanel, { ...defaultProps, connected: false }))
    expect(screen.getAllByText('Dolacz do rozmowy').length).toBeGreaterThan(0)
  })

  it('renders mute button when connected with mic enabled', () => {
    render(
      React.createElement(VoicePanel, {
        ...defaultProps,
        connected: true,
        micEnabled: true,
      })
    )
    expect(screen.getByTitle('Wycisz')).toBeTruthy()
  })

  it('shows Mic icon when mic is enabled', () => {
    render(
      React.createElement(VoicePanel, {
        ...defaultProps,
        connected: true,
        micEnabled: true,
      })
    )
    expect(screen.getAllByTestId('icon-mic').length).toBeGreaterThan(0)
  })

  it('shows MicOff icon when mic is disabled', () => {
    render(
      React.createElement(VoicePanel, {
        ...defaultProps,
        connected: true,
        micEnabled: false,
      })
    )
    expect(screen.getAllByTestId('icon-mic-off').length).toBeGreaterThan(0)
  })

  it('renders "Wlacz mikrofon" title when mic is disabled', () => {
    render(
      React.createElement(VoicePanel, {
        ...defaultProps,
        connected: true,
        micEnabled: false,
      })
    )
    // Both mobile and desktop buttons share this title when mic is off
    expect(screen.getAllByTitle('Wlacz mikrofon').length).toBeGreaterThan(0)
  })

  it('calls onToggleMic when mic button is clicked', () => {
    const onToggleMic = vi.fn()
    render(
      React.createElement(VoicePanel, {
        ...defaultProps,
        connected: true,
        micEnabled: true,
        onToggleMic,
      })
    )
    fireEvent.click(screen.getByTitle('Wycisz'))
    expect(onToggleMic).toHaveBeenCalledTimes(1)
  })

  it('renders leave button when connected', () => {
    render(
      React.createElement(VoicePanel, {
        ...defaultProps,
        connected: true,
      })
    )
    expect(screen.getByTitle('Rozlacz')).toBeTruthy()
  })

  it('shows PhoneOff icon when connected', () => {
    render(
      React.createElement(VoicePanel, {
        ...defaultProps,
        connected: true,
      })
    )
    expect(screen.getAllByTestId('icon-phone-off').length).toBeGreaterThan(0)
  })

  it('calls onLeave when leave button is clicked', () => {
    const onLeave = vi.fn()
    render(
      React.createElement(VoicePanel, {
        ...defaultProps,
        connected: true,
        onLeave,
      })
    )
    fireEvent.click(screen.getByTitle('Rozlacz'))
    expect(onLeave).toHaveBeenCalledTimes(1)
  })

  it('shows "Brak graczy" when connected with no peers (desktop)', () => {
    render(
      React.createElement(VoicePanel, {
        ...defaultProps,
        connected: true,
        peers: [],
      })
    )
    expect(screen.getByText('Brak graczy')).toBeTruthy()
  })

  it('renders peer name when a peer is present', () => {
    const peers = [makePeer({ identity: 'user-peer', name: 'Charlie' })]
    render(
      React.createElement(VoicePanel, {
        ...defaultProps,
        connected: true,
        peers,
      })
    )
    expect(screen.getByText('Charlie')).toBeTruthy()
  })

  it('uses player username from players map for peers', () => {
    const peers = [makePeer({ identity: 'user-peer', name: 'FallbackName' })]
    render(
      React.createElement(VoicePanel, {
        ...defaultProps,
        connected: true,
        peers,
        players: { 'user-peer': { username: 'Charlie', color: '#4ade80' } },
      })
    )
    // Should use players map username, not peer.name
    expect(screen.getByText('Charlie')).toBeTruthy()
  })

  it('falls back to peer.name when player not found in players map', () => {
    const peers = [makePeer({ identity: 'unknown-peer', name: 'UnknownName' })]
    render(
      React.createElement(VoicePanel, {
        ...defaultProps,
        connected: true,
        peers,
        players: {},
      })
    )
    expect(screen.getByText('UnknownName')).toBeTruthy()
  })

  it('renders multiple peers', () => {
    const peers = [
      makePeer({ identity: 'user-peer', name: 'Charlie' }),
      makePeer({ identity: 'user-peer2', name: 'Delta', isMuted: true }),
    ]
    render(
      React.createElement(VoicePanel, {
        ...defaultProps,
        connected: true,
        peers,
        players: {
          'user-peer': { username: 'Charlie', color: '#4ade80' },
          'user-peer2': { username: 'Delta', color: '#f43f5e' },
        },
      })
    )
    expect(screen.getByText('Charlie')).toBeTruthy()
    expect(screen.getByText('Delta')).toBeTruthy()
  })
})
