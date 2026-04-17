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
  value_json: any | null;
  value_formatted?: string | null;
  raw_data: string | null;
  raw_hex?: string | null;
}

export function useWebSocket(url: string, onTelegram?: (t: Telegram) => void) {
  const [isConnected, setIsConnected] = useState(false);
  const ws = useRef<WebSocket | null>(null);

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
      const data = JSON.parse(event.data);
      if (onTelegramRef.current) {
        onTelegramRef.current(data);
      }
    };

    socket.onclose = () => {
      console.log('WS Disconnected, retrying...');
      setIsConnected(false);
      setTimeout(connect, 3000);
    };

    ws.current = socket;
  }, [url]);

  const send = useCallback((data: any) => {
    if (ws.current?.readyState === WebSocket.OPEN) {
      ws.current.send(JSON.stringify(data));
    }
  }, []);

  useEffect(() => {
    connect();
    return () => ws.current?.close();
  }, [connect]);

  return { isConnected, send };
}
