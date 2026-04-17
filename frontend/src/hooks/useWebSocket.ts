import { useState, useEffect, useCallback, useRef } from 'react';

export interface Telegram {
  timestamp: string;
  source_address: string;
  source_name?: string | null;
  target_address: string;
  target_name?: string | null;
  telegram_type: string;
  simplified_type?: string | null;
  dpt: string | null;
  dpt_main: number | null;
  dpt_sub: number | null;
  dpt_name: string | null;
  unit?: string | null;
  value_numeric: number | null;
  value_json: Record<string, unknown> | null;
  value_formatted?: string | null;
  raw_data: string | null;
  raw_hex?: string | null;
}

export function useWebSocket(url: string, onTelegram?: (t: Telegram) => void) {
  const [isConnected, setIsConnected] = useState(false);
  const ws = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<number | null>(null);
  const connectRef = useRef<() => void>(() => {});

  const onTelegramRef = useRef(onTelegram);
  useEffect(() => {
    onTelegramRef.current = onTelegram;
  }, [onTelegram]);

  const connect = useCallback(() => {
    if (ws.current?.readyState === WebSocket.OPEN) return;

    const socket = new WebSocket(url);

    socket.onopen = () => {
      console.log('WS Connected');
      setIsConnected(true);
    };

    socket.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data) as Telegram;
        if (onTelegramRef.current) {
          onTelegramRef.current(data);
        }
      } catch (err) {
        console.error('Error parsing WS message:', err);
      }
    };

    socket.onclose = () => {
      console.log('WS Disconnected, retrying...');
      setIsConnected(false);
      
      // Clean up previous timeout if it exists
      if (reconnectTimeoutRef.current) {
        window.clearTimeout(reconnectTimeoutRef.current);
      }
      
      // Schedule reconnect using the ref to avoid TDZ issues
      reconnectTimeoutRef.current = window.setTimeout(() => {
        connectRef.current();
      }, 3000);
    };

    ws.current = socket;
  }, [url]);

  // Sync the ref with the memoized connect function
  useEffect(() => {
    connectRef.current = connect;
  }, [connect]);

  const send = useCallback((data: Record<string, unknown>) => {
    if (ws.current?.readyState === WebSocket.OPEN) {
      ws.current.send(JSON.stringify(data));
    }
  }, []);

  useEffect(() => {
    connect();
    return () => {
      if (reconnectTimeoutRef.current) {
        window.clearTimeout(reconnectTimeoutRef.current);
      }
      ws.current?.close();
    };
  }, [connect]);

  return { isConnected, send };
}
