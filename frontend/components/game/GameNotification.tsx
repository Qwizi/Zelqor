"use client";

import { AlertTriangle, CheckCircle2, Info, XCircle } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface GameNotification {
  id: string;
  message: string;
  type: "success" | "error" | "warning" | "info";
  duration?: number; // ms, default 4000
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useGameNotifications() {
  const [notifications, setNotifications] = useState<GameNotification[]>([]);
  const counterRef = useRef(0);

  const notify = useCallback((message: string, type: GameNotification["type"], duration?: number) => {
    const id = `gn-${Date.now()}-${++counterRef.current}`;
    setNotifications((prev) => [...prev, { id, message, type, duration }]);
  }, []);

  const dismiss = useCallback((id: string) => {
    setNotifications((prev) => prev.filter((n) => n.id !== id));
  }, []);

  const clearAll = useCallback(() => {
    setNotifications([]);
  }, []);

  return { notifications, notify, dismiss, clearAll };
}

// ─── Config per type ──────────────────────────────────────────────────────────

const TYPE_CONFIG = {
  success: {
    icon: CheckCircle2,
    iconClass: "text-emerald-400",
    borderClass: "border-emerald-400/20",
    glowClass: "shadow-[0_10px_24px_rgba(52,211,153,0.10)]",
    labelClass: "text-emerald-300/70",
    label: "Sukces",
  },
  error: {
    icon: XCircle,
    iconClass: "text-red-400",
    borderClass: "border-red-400/20",
    glowClass: "shadow-[0_10px_24px_rgba(248,113,113,0.10)]",
    labelClass: "text-red-300/70",
    label: "Błąd",
  },
  warning: {
    icon: AlertTriangle,
    iconClass: "text-amber-400",
    borderClass: "border-amber-400/20",
    glowClass: "shadow-[0_10px_24px_rgba(251,191,36,0.10)]",
    labelClass: "text-amber-200/70",
    label: "Uwaga",
  },
  info: {
    icon: Info,
    iconClass: "text-sky-400",
    borderClass: "border-sky-400/20",
    glowClass: "shadow-[0_10px_24px_rgba(56,189,248,0.10)]",
    labelClass: "text-sky-300/70",
    label: "Info",
  },
} as const;

// ─── Single notification item ─────────────────────────────────────────────────

interface NotificationItemProps {
  notification: GameNotification;
  onDismiss: (id: string) => void;
}

function NotificationItem({ notification, onDismiss }: NotificationItemProps) {
  const { id, message, type, duration = 4000 } = notification;
  const config = TYPE_CONFIG[type];
  const Icon = config.icon;

  // Two-phase visibility: mount with opacity-0, then flip to opacity-100 on
  // next frame so the transition actually plays. Before dismissal we flip back.
  const [visible, setVisible] = useState(false);
  const dismissedRef = useRef(false);

  const startDismiss = useCallback(() => {
    if (dismissedRef.current) return;
    dismissedRef.current = true;
    setVisible(false);
    // Wait for the leave transition to finish before removing from state
    const timer = setTimeout(() => onDismiss(id), 300);
    return () => clearTimeout(timer);
  }, [id, onDismiss]);

  // Enter transition
  useEffect(() => {
    const raf = requestAnimationFrame(() => setVisible(true));
    return () => cancelAnimationFrame(raf);
  }, []);

  // Auto-dismiss timer
  useEffect(() => {
    const timer = setTimeout(startDismiss, duration);
    return () => clearTimeout(timer);
  }, [duration, startDismiss]);

  return (
    <div
      role="status"
      aria-live="polite"
      onClick={startDismiss}
      className={[
        // Layout
        "flex cursor-pointer items-center gap-3 rounded-full px-4 py-2.5",
        // Glassmorphism — matches capital-selection banner exactly
        "border bg-card/85 backdrop-blur-xl",
        config.borderClass,
        config.glowClass,
        // Transition
        "transition-all duration-300 ease-out",
        visible ? "translate-y-0 opacity-100" : "-translate-y-2 opacity-0",
      ].join(" ")}
    >
      <Icon size={16} className={`shrink-0 ${config.iconClass}`} />
      <div className="flex flex-col">
        <span className={`text-[10px] uppercase tracking-[0.18em] ${config.labelClass}`}>{config.label}</span>
        <span className="text-sm leading-snug text-foreground">{message}</span>
      </div>
    </div>
  );
}

// ─── Overlay ──────────────────────────────────────────────────────────────────

export function GameNotificationOverlay({
  notifications,
  onDismiss,
}: {
  notifications: GameNotification[];
  onDismiss: (id: string) => void;
}) {
  if (notifications.length === 0) return null;

  return (
    // Positioned below the capital-selection banner (top-2/top-4 + ~52px banner
    // height) so they never overlap. pointer-events-none on the wrapper means
    // only the individual pills capture clicks.
    <div
      aria-label="Game notifications"
      className="pointer-events-none absolute left-1/2 top-20 z-30 flex -translate-x-1/2 flex-col items-center gap-2 sm:top-24"
    >
      {notifications.map((n) => (
        <div key={n.id} className="pointer-events-auto">
          <NotificationItem notification={n} onDismiss={onDismiss} />
        </div>
      ))}
    </div>
  );
}
