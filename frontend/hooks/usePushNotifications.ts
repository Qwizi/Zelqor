"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { getVapidKey, subscribePush, unsubscribePush } from "@/lib/api";
import { getAccessToken } from "@/lib/auth";

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  const arr = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
  return arr;
}

const PUSH_DISMISSED_KEY = "maplord_push_dismissed";

export function usePushNotifications(autoPrompt = false) {
  const [permission, setPermission] = useState<NotificationPermission>("default");
  const [subscribed, setSubscribed] = useState(false);
  const initRef = useRef(false);

  useEffect(() => {
    if (typeof window === "undefined" || !("Notification" in window)) return;
    setPermission(Notification.permission);

    if (initRef.current) return;
    initRef.current = true;

    // Check if already subscribed
    navigator.serviceWorker?.ready.then((reg) => {
      reg.pushManager.getSubscription().then((sub) => {
        setSubscribed(!!sub);
      });
    });
  }, []);

  const subscribe = useCallback(async () => {
    const token = getAccessToken();
    if (!token) return false;

    try {
      const perm = await Notification.requestPermission();
      setPermission(perm);
      if (perm !== "granted") return false;

      const vapidKey = await getVapidKey();
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(vapidKey) as BufferSource,
      });

      const json = sub.toJSON();
      await subscribePush(token, {
        endpoint: json.endpoint!,
        p256dh: json.keys?.p256dh!,
        auth: json.keys?.auth!,
      });

      setSubscribed(true);
      return true;
    } catch (err) {
      console.error("Push subscribe failed:", err);
      return false;
    }
  }, []);

  const unsubscribe = useCallback(async () => {
    const token = getAccessToken();
    if (!token) return;

    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (sub) {
        await unsubscribePush(token, sub.endpoint);
        await sub.unsubscribe();
      }
      setSubscribed(false);
    } catch {
      // ignore
    }
  }, []);

  const dismiss = useCallback(() => {
    sessionStorage.setItem(PUSH_DISMISSED_KEY, "1");
  }, []);

  // Whether to show the prompt banner
  const showPrompt =
    autoPrompt &&
    permission === "default" &&
    !subscribed &&
    typeof window !== "undefined" &&
    "Notification" in window &&
    !sessionStorage.getItem(PUSH_DISMISSED_KEY);

  return { permission, subscribed, subscribe, unsubscribe, dismiss, showPrompt };
}
