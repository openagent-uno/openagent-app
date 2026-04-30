import { Stack } from 'expo-router';
import { useEffect } from 'react';
import { View, StyleSheet, Platform } from 'react-native';
import { useConnection } from '../stores/connection';
import { useChat } from '../stores/chat';
import { ConfirmProvider } from '../components/ConfirmDialog';
import Header from '../components/Header';
import { JarvisCanvas } from '../components/jarvis';
import { colors } from '../theme';

export default function RootLayout() {
  const ws = useConnection((s) => s.ws);
  const handleServerMessage = useChat((s) => s.handleServerMessage);
  const loadAccounts = useConnection((s) => s.loadAccounts);

  useEffect(() => { loadAccounts(); }, []);

  useEffect(() => {
    if (!ws) return;
    return ws.onMessage((msg) => {
      // ``delta`` frames carry token-streaming chunks for the in-flight
      // assistant bubble — without forwarding them here the chat store's
      // typewriter handler (chat.ts:168) is dead code and the UI only
      // updates when the trailing ``response`` lands. ``audio_*`` frames
      // are intentionally NOT here: the Voice tab taps the WS directly
      // (voice.tsx:123) so audio routing stays out of the chat store.
      if (
        msg.type === 'status'
        || msg.type === 'delta'
        || msg.type === 'response'
        || msg.type === 'error'
      ) {
        handleServerMessage(msg);
      }
    });
  }, [ws, handleServerMessage]);

  return (
    <ConfirmProvider>
      {/*
        JarvisCanvas paints the grid backdrop + edge ticks + corner
        brackets so every screen below shares the same engineering
        canvas without each having to re-implement it.
      */}
      <JarvisCanvas style={styles.root}>
        {Platform.OS === 'web' && <Header />}
        <View style={styles.content}>
          <Stack
            screenOptions={{
              headerShown: false,
              contentStyle: { backgroundColor: 'transparent' },
            }}
          >
            <Stack.Screen name="index" />
            <Stack.Screen name="(tabs)" />
          </Stack>
        </View>
      </JarvisCanvas>
    </ConfirmProvider>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  content: { flex: 1 },
});
