import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, act, fireEvent } from '@testing-library/react'
import React from 'react'

// ---------------------------------------------------------------------------
// Mock lucide-react icons to avoid svg complexity in tests
// ---------------------------------------------------------------------------

vi.mock('lucide-react', () => ({
  AlertTriangle: ({ size, className }: { size?: number; className?: string }) =>
    React.createElement('span', { 'data-testid': 'icon-warning', className }),
  CheckCircle2: ({ size, className }: { size?: number; className?: string }) =>
    React.createElement('span', { 'data-testid': 'icon-success', className }),
  Info: ({ size, className }: { size?: number; className?: string }) =>
    React.createElement('span', { 'data-testid': 'icon-info', className }),
  XCircle: ({ size, className }: { size?: number; className?: string }) =>
    React.createElement('span', { 'data-testid': 'icon-error', className }),
}))

import {
  GameNotificationOverlay,
  useGameNotifications,
  type GameNotification,
} from '@/components/game/GameNotification'
import { renderHook } from '@testing-library/react'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeNotification(overrides: Partial<GameNotification> = {}): GameNotification {
  return {
    id: `gn-${Date.now()}-1`,
    message: 'Test message',
    type: 'info',
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// useGameNotifications hook tests
// ---------------------------------------------------------------------------

describe('useGameNotifications', () => {
  it('starts with an empty notifications array', () => {
    const { result } = renderHook(() => useGameNotifications())
    expect(result.current.notifications).toEqual([])
  })

  it('notify() adds a notification with the correct fields', () => {
    const { result } = renderHook(() => useGameNotifications())

    act(() => {
      result.current.notify('Hello!', 'success')
    })

    expect(result.current.notifications).toHaveLength(1)
    const n = result.current.notifications[0]
    expect(n.message).toBe('Hello!')
    expect(n.type).toBe('success')
    expect(n.id).toMatch(/^gn-/)
  })

  it('notify() stores duration when provided', () => {
    const { result } = renderHook(() => useGameNotifications())

    act(() => {
      result.current.notify('Timed', 'warning', 2000)
    })

    expect(result.current.notifications[0].duration).toBe(2000)
  })

  it('notify() assigns unique ids for multiple notifications', () => {
    const { result } = renderHook(() => useGameNotifications())

    act(() => {
      result.current.notify('First', 'info')
      result.current.notify('Second', 'error')
    })

    const ids = result.current.notifications.map((n) => n.id)
    expect(new Set(ids).size).toBe(2)
  })

  it('dismiss() removes the notification with the given id', () => {
    const { result } = renderHook(() => useGameNotifications())

    act(() => {
      result.current.notify('A', 'info')
      result.current.notify('B', 'info')
    })

    const idToRemove = result.current.notifications[0].id

    act(() => {
      result.current.dismiss(idToRemove)
    })

    expect(result.current.notifications).toHaveLength(1)
    expect(result.current.notifications[0].message).toBe('B')
  })

  it('clearAll() removes all notifications', () => {
    const { result } = renderHook(() => useGameNotifications())

    act(() => {
      result.current.notify('A', 'success')
      result.current.notify('B', 'error')
      result.current.notify('C', 'warning')
    })

    expect(result.current.notifications).toHaveLength(3)

    act(() => {
      result.current.clearAll()
    })

    expect(result.current.notifications).toHaveLength(0)
  })

  it('all four notification types can be created', () => {
    const { result } = renderHook(() => useGameNotifications())
    const types: GameNotification['type'][] = ['success', 'error', 'warning', 'info']

    act(() => {
      for (const t of types) {
        result.current.notify(`Msg ${t}`, t)
      }
    })

    const createdTypes = result.current.notifications.map((n) => n.type)
    for (const t of types) {
      expect(createdTypes).toContain(t)
    }
  })
})

// ---------------------------------------------------------------------------
// GameNotificationOverlay rendering tests
// ---------------------------------------------------------------------------

describe('GameNotificationOverlay', () => {
  const noop = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('renders nothing when notifications array is empty', () => {
    const { container } = render(
      React.createElement(GameNotificationOverlay, { notifications: [], onDismiss: noop })
    )
    expect(container.firstChild).toBeNull()
  })

  it('renders the overlay container when notifications exist', () => {
    const notifications = [makeNotification({ id: 'n1', message: 'Alert!' })]

    render(
      React.createElement(GameNotificationOverlay, { notifications, onDismiss: noop })
    )

    const overlay = screen.getByLabelText('Game notifications')
    expect(overlay).toBeTruthy()
  })

  it('renders the correct message text', () => {
    const notifications = [makeNotification({ id: 'n1', message: 'Territory captured!' })]

    render(
      React.createElement(GameNotificationOverlay, { notifications, onDismiss: noop })
    )

    expect(screen.getByText('Territory captured!')).toBeTruthy()
  })

  it('renders success notification with success label', () => {
    const notifications = [makeNotification({ id: 'n1', type: 'success', message: 'Done' })]

    render(
      React.createElement(GameNotificationOverlay, { notifications, onDismiss: noop })
    )

    expect(screen.getByText('Sukces')).toBeTruthy()
    expect(screen.getByTestId('icon-success')).toBeTruthy()
  })

  it('renders error notification with error label', () => {
    const notifications = [makeNotification({ id: 'n1', type: 'error', message: 'Failed' })]

    render(
      React.createElement(GameNotificationOverlay, { notifications, onDismiss: noop })
    )

    expect(screen.getByText('Błąd')).toBeTruthy()
    expect(screen.getByTestId('icon-error')).toBeTruthy()
  })

  it('renders warning notification with warning label', () => {
    const notifications = [makeNotification({ id: 'n1', type: 'warning', message: 'Watch out' })]

    render(
      React.createElement(GameNotificationOverlay, { notifications, onDismiss: noop })
    )

    expect(screen.getByText('Uwaga')).toBeTruthy()
    expect(screen.getByTestId('icon-warning')).toBeTruthy()
  })

  it('renders info notification with info label', () => {
    const notifications = [makeNotification({ id: 'n1', type: 'info', message: 'FYI' })]

    render(
      React.createElement(GameNotificationOverlay, { notifications, onDismiss: noop })
    )

    expect(screen.getByText('Info')).toBeTruthy()
    expect(screen.getByTestId('icon-info')).toBeTruthy()
  })

  it('renders multiple notifications', () => {
    const notifications = [
      makeNotification({ id: 'n1', type: 'success', message: 'First' }),
      makeNotification({ id: 'n2', type: 'error', message: 'Second' }),
      makeNotification({ id: 'n3', type: 'info', message: 'Third' }),
    ]

    render(
      React.createElement(GameNotificationOverlay, { notifications, onDismiss: noop })
    )

    expect(screen.getByText('First')).toBeTruthy()
    expect(screen.getByText('Second')).toBeTruthy()
    expect(screen.getByText('Third')).toBeTruthy()
  })

  it('calls onDismiss with the correct id when a notification is clicked', async () => {
    const dismissFn = vi.fn()
    const notifications = [makeNotification({ id: 'n-click-me', type: 'info', message: 'Click me' })]

    render(
      React.createElement(GameNotificationOverlay, { notifications, onDismiss: dismissFn })
    )

    // Click on the notification pill
    const item = screen.getByRole('status')
    await act(async () => {
      fireEvent.click(item)
      // Advance timers past the 300ms leave transition
      vi.advanceTimersByTime(400)
    })

    expect(dismissFn).toHaveBeenCalledWith('n-click-me')
  })

  it('auto-dismisses after the default duration (4000ms)', async () => {
    const dismissFn = vi.fn()
    const notifications = [makeNotification({ id: 'auto-dismiss', type: 'info', message: 'Auto' })]

    render(
      React.createElement(GameNotificationOverlay, { notifications, onDismiss: dismissFn })
    )

    await act(async () => {
      vi.advanceTimersByTime(4000 + 400)
    })

    expect(dismissFn).toHaveBeenCalledWith('auto-dismiss')
  })

  it('auto-dismisses after a custom duration', async () => {
    const dismissFn = vi.fn()
    const notifications = [makeNotification({ id: 'custom-dur', type: 'warning', message: 'Quick', duration: 1000 })]

    render(
      React.createElement(GameNotificationOverlay, { notifications, onDismiss: dismissFn })
    )

    // Should NOT dismiss before the duration
    await act(async () => {
      vi.advanceTimersByTime(500)
    })
    expect(dismissFn).not.toHaveBeenCalled()

    // Should dismiss after the duration + transition
    await act(async () => {
      vi.advanceTimersByTime(800)
    })
    expect(dismissFn).toHaveBeenCalledWith('custom-dur')
  })
})
