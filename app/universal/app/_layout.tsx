import { Stack } from 'expo-router';
import { useEffect } from 'react';
import { View, StyleSheet, Platform } from 'react-native';
import { useConnection } from '../stores/connection';
import { useChat } from '../stores/chat';
import Header from '../components/Header';

export default function RootLayout() {
  const ws = useConnection((s) => s.ws);
  const handleServerMessage = useChat((s) => s.handleServerMessage);
  const loadAccounts = useConnection((s) => s.loadAccounts);

  useEffect(() => {
    loadAccounts();
  }, []);

  useEffect(() => {
    if (!ws) return;
    const unsub = ws.onMessage((msg) => {
      if (msg.type === 'status' || msg.type === 'response' || msg.type === 'error') {
        handleServerMessage(msg);
      }
    });
    return unsub;
  }, [ws, handleServerMessage]);

  return (
    <View style={styles.root}>
      {Platform.OS === 'web' && <Header />}
      <View style={styles.content}>
        <Stack screenOptions={{ headerShown: false }}>
          <Stack.Screen name="index" />
          <Stack.Screen name="(tabs)" />
          <Stack.Screen
            name="editor"
            options={{
              headerShown: true,
              presentation: 'modal',
              headerStyle: { backgroundColor: '#FAFAFA' },
              headerTintColor: '#D97757',
            }}
          />
        </Stack>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#FAFAFA' },
  content: { flex: 1 },
});
