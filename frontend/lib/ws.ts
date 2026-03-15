// Auto-detect WebSocket URL from current page origin (works for any domain/IP)
const WS_BASE =
  process.env.NEXT_PUBLIC_WS_URL ||
  (typeof window !== "undefined"
    ? `${window.location.protocol === "https:" ? "wss" : "ws"}://${window.location.host}/ws`
    : "ws://localhost/ws");

export type WSMessage = {
  type: string;
  [key: string]: unknown;
};

export type WSHandler = (msg: WSMessage) => void;

export function createSocket(
  path: string,
  token: string | null,
  onMessage: WSHandler,
  onClose?: (event: CloseEvent) => void,
  ticket?: string | null,
  nonce?: string | null,
): WebSocket {
  let url = token ? `${WS_BASE}${path}?token=${token}` : `${WS_BASE}${path}`;
  if (ticket) {
    url += `&ticket=${ticket}`;
  }
  if (nonce) {
    url += `&nonce=${nonce}`;
  }
  const ws = new WebSocket(url);

  ws.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);
      onMessage(data);
    } catch {
      console.error("WS parse error:", event.data);
    }
  };

  ws.onclose = (event) => {
    onClose?.(event);
  };

  ws.onerror = () => {
    // Browser intentionally hides WebSocket error details for security reasons.
    // The connection will close and onclose will fire with a code.
    console.warn("WS connection error (details unavailable in browser)");
  };

  return ws;
}
