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
  // Build URL without token — token is sent as the first message after the
  // connection opens so it never appears in server logs or browser history.
  let url = `${WS_BASE}${path}`;
  const params: string[] = [];
  if (ticket) params.push(`ticket=${ticket}`);
  if (nonce) params.push(`nonce=${nonce}`);
  if (params.length > 0) url += `${url.includes("?") ? "&" : "?"}${params.join("&")}`;

  const ws = new WebSocket(url);

  ws.onopen = () => {
    // Send auth token as first message so it travels over the encrypted WS
    // frame rather than appearing in the URL (which is logged by servers and
    // visible in browser history / DevTools network tab).
    if (token) {
      ws.send(JSON.stringify({ type: "auth", token }));
    }
  };

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
