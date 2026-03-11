const WS_BASE = process.env.NEXT_PUBLIC_WS_URL || "ws://localhost/ws";

export type WSMessage = {
  type: string;
  [key: string]: unknown;
};

export type WSHandler = (msg: WSMessage) => void;

export function createSocket(
  path: string,
  token: string | null,
  onMessage: WSHandler,
  onClose?: (code: number) => void
): WebSocket {
  const url = token ? `${WS_BASE}${path}?token=${token}` : `${WS_BASE}${path}`;
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
    onClose?.(event.code);
  };

  ws.onerror = () => {
    // Browser intentionally hides WebSocket error details for security reasons.
    // The connection will close and onclose will fire with a code.
    console.warn("WS connection error (details unavailable in browser)");
  };

  return ws;
}
