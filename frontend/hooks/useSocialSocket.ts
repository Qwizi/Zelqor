"use client";
import { useEffect, useRef, useCallback, useState } from "react";
import type { NotificationOut } from "@/lib/api";

interface SocialMessage {
  type: "notification" | "direct_message" | "clan_war_started";
  payload: Record<string, unknown>;
}

export interface ClanWarStartedPayload {
  war_id: string;
  match_id: string;
  challenger_tag: string;
  defender_tag: string;
}

export interface DirectMessagePayload {
  id: string;
  sender: { id: string; username: string };
  content: string;
  created_at: string;
}

type NotificationHandler = (notification: NotificationOut) => void;
type DirectMessageHandler = (message: DirectMessagePayload) => void;
type ClanWarStartedHandler = (data: ClanWarStartedPayload) => void;

export function useSocialSocket(token: string | null) {
  const wsRef = useRef<WebSocket | null>(null);
  const notifHandlersRef = useRef<Set<NotificationHandler>>(new Set());
  const dmHandlersRef = useRef<Set<DirectMessageHandler>>(new Set());
  const warStartedHandlersRef = useRef<Set<ClanWarStartedHandler>>(new Set());
  const [connected, setConnected] = useState(false);
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  // Keep a ref to the latest token so the reconnect closure always uses it
  const tokenRef = useRef(token);
  useEffect(() => { tokenRef.current = token; }, [token]);

  const connect = useCallback(() => {
    const currentToken = tokenRef.current;
    if (!currentToken) return;
    if (wsRef.current?.readyState === WebSocket.OPEN || wsRef.current?.readyState === WebSocket.CONNECTING) return;

    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const host = window.location.host;
    const ws = new WebSocket(`${protocol}//${host}/ws/social/?token=${currentToken}`);

    ws.onopen = () => {
      setConnected(true);
    };

    ws.onmessage = (event) => {
      try {
        const data: SocialMessage = JSON.parse(event.data as string);
        if (data.type === "notification") {
          const notif = data.payload as unknown as NotificationOut;
          notifHandlersRef.current.forEach((handler) => handler(notif));
        } else if (data.type === "direct_message") {
          const msg = data.payload as unknown as DirectMessagePayload;
          dmHandlersRef.current.forEach((handler) => handler(msg));
        } else if (data.type === "clan_war_started") {
          const warData = data.payload as unknown as ClanWarStartedPayload;
          warStartedHandlersRef.current.forEach((handler) => handler(warData));
        }
      } catch {
        // Ignore malformed messages
      }
    };

    ws.onclose = () => {
      setConnected(false);
      wsRef.current = null;
      // Reconnect after 3 seconds if we still have a token
      reconnectTimeoutRef.current = setTimeout(() => {
        if (tokenRef.current) connect();
      }, 3000);
    };

    ws.onerror = () => {
      ws.close();
    };

    wsRef.current = ws;
  }, []); // stable — uses tokenRef

  useEffect(() => {
    if (!token) return;
    connect();
    return () => {
      clearTimeout(reconnectTimeoutRef.current);
      wsRef.current?.close();
      wsRef.current = null;
    };
  }, [token, connect]);

  const onNotification = useCallback((handler: NotificationHandler) => {
    notifHandlersRef.current.add(handler);
    return () => {
      notifHandlersRef.current.delete(handler);
    };
  }, []);

  const onDirectMessage = useCallback((handler: DirectMessageHandler) => {
    dmHandlersRef.current.add(handler);
    return () => {
      dmHandlersRef.current.delete(handler);
    };
  }, []);

  const onClanWarStarted = useCallback((handler: ClanWarStartedHandler) => {
    warStartedHandlersRef.current.add(handler);
    return () => {
      warStartedHandlersRef.current.delete(handler);
    };
  }, []);

  return { connected, onNotification, onDirectMessage, onClanWarStarted };
}
