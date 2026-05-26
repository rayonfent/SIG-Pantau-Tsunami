import { useEffect, useRef, useCallback, useState } from 'react';

const WS_URL = process.env.REACT_APP_WS_URL || 'ws://localhost:8000';

interface WSMessage {
  event: string;
  data: any;
}

export function useWebSocket(onMessage: (msg: WSMessage) => void) {
  const ws = useRef<WebSocket | null>(null);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout>>();
  const [connected, setConnected] = useState(false);
  const onMessageRef = useRef(onMessage);
  onMessageRef.current = onMessage;

  const connect = useCallback(() => {
    try {
      ws.current = new WebSocket(`${WS_URL}/ws`);

      ws.current.onopen = () => {
        setConnected(true);
        // Ping keepalive every 30s
        const ping = setInterval(() => {
          if (ws.current?.readyState === WebSocket.OPEN) {
            ws.current.send('ping');
          }
        }, 30000);
        ws.current!.onclose = () => {
          clearInterval(ping);
          setConnected(false);
          reconnectTimer.current = setTimeout(connect, 5000);
        };
      };

      ws.current.onmessage = (e) => {
        try {
          const msg = JSON.parse(e.data);
          if (msg.event !== 'pong') onMessageRef.current(msg);
        } catch {}
      };

      ws.current.onerror = () => {
        ws.current?.close();
      };
    } catch {
      reconnectTimer.current = setTimeout(connect, 5000);
    }
  }, []);

  useEffect(() => {
    connect();
    return () => {
      clearTimeout(reconnectTimer.current);
      ws.current?.close();
    };
  }, [connect]);

  return { connected };
}
