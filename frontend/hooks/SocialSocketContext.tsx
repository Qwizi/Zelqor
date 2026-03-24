"use client";
import { createContext, useContext } from "react";
import type { NotificationOut } from "@/lib/api";
import type { ClanWarStartedPayload, DirectMessagePayload } from "./useSocialSocket";

interface SocialSocketContextType {
  connected: boolean;
  onNotification: (handler: (n: NotificationOut) => void) => () => void;
  onDirectMessage: (handler: (m: DirectMessagePayload) => void) => () => void;
  onClanWarStarted: (handler: (d: ClanWarStartedPayload) => void) => () => void;
}

const noop = () => () => {};

export const SocialSocketContext = createContext<SocialSocketContextType>({
  connected: false,
  onNotification: noop,
  onDirectMessage: noop,
  onClanWarStarted: noop,
});

export function useSocialSocketContext() {
  return useContext(SocialSocketContext);
}
