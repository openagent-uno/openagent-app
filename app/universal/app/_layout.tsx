import { Slot } from 'expo-router';
import { useEffect } from 'react';
import { useConnection } from '../stores/connection';
import { useChat } from '../stores/chat';

export default function RootLayout() {
  const ws = useConnection((s) => s.ws);
  const handleServerMessage = useChat((s) => s.handleServerMessage);

  // Wire WS messages into chat store
  useEffect(() => {
    if (!ws) return;
    const unsub = ws.onMessage((msg) => {
      if (msg.type === 'status' || msg.type === 'response' || msg.type === 'error') {
        handleServerMessage(msg);
      }
    });
    return unsub;
  }, [ws, handleServerMessage]);

  return <Slot />;
}
