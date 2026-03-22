"use client";
import { createContext, useContext } from "react";
import type { NotificationOut } from "@/lib/api";
import type { DirectMessagePayload } from "./useSocialSocket";

interface SocialSocketContextType {
  connected: boolean;
  onNotification: (handler: (n: NotificationOut) => void) => () => void;
  onDirectMessage: (handler: (m: DirectMessagePayload) => void) => () => void;
}

const noop = () => () => {};

export const SocialSocketContext = createContext<SocialSocketContextType>({
  connected: false,
  onNotification: noop,
  onDirectMessage: noop,
});

export function useSocialSocketContext() {
  return useContext(SocialSocketContext);
}
