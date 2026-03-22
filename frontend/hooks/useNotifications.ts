"use client";
import { useState, useEffect, useCallback } from "react";
import {
  getUnreadNotificationCount,
  getNotifications,
  markNotificationRead,
  markAllNotificationsRead,
  type NotificationOut,
} from "@/lib/api";

export function useNotifications(token: string | null) {
  const [unreadCount, setUnreadCount] = useState(0);
  const [notifications, setNotifications] = useState<NotificationOut[]>([]);
  const [loading, setLoading] = useState(false);

  // Fetch initial unread count once on mount (or when token changes)
  useEffect(() => {
    if (!token) return;
    getUnreadNotificationCount(token)
      .then((r) => setUnreadCount(r.count))
      .catch(() => {});
  }, [token]);

  const refreshList = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    try {
      const r = await getNotifications(token, 10);
      setNotifications(r.items);
      const c = await getUnreadNotificationCount(token);
      setUnreadCount(c.count);
    } catch {
      // silently ignore
    } finally {
      setLoading(false);
    }
  }, [token]);

  const markRead = useCallback(async (id: string) => {
    if (!token) return;
    await markNotificationRead(token, id);
    setNotifications((prev) =>
      prev.map((n) => (n.id === id ? { ...n, is_read: true } : n))
    );
    setUnreadCount((prev) => Math.max(0, prev - 1));
  }, [token]);

  const markAllRead = useCallback(async () => {
    if (!token) return;
    await markAllNotificationsRead(token);
    setNotifications((prev) => prev.map((n) => ({ ...n, is_read: true })));
    setUnreadCount(0);
  }, [token]);

  // Called by the social socket when a new notification arrives in real-time
  const handleIncoming = useCallback((notif: NotificationOut) => {
    setNotifications((prev) => {
      if (prev.some((n) => n.id === notif.id)) return prev;
      return [notif, ...prev].slice(0, 10);
    });
    setUnreadCount((prev) => prev + 1);
  }, []);

  return { unreadCount, notifications, loading, refreshList, markRead, markAllRead, handleIncoming };
}
