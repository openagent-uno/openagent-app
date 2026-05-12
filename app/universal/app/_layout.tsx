import { Stack } from 'expo-router';
import { useEffect, useRef } from 'react';
import { Animated, View, StyleSheet, Platform } from 'react-native';
import { ThemeProvider, type Theme } from '@react-navigation/native';
import { useConnection } from '../stores/connection';
import { useChat } from '../stores/chat';
import { ConfirmProvider } from '../components/ConfirmDialog';
import Header from '../components/Header';
import { JarvisCanvas } from '../components/jarvis';

const navDarkTheme: Theme = {
  dark: true,
  colors: {
    primary: '#3FC8FF',
    background: 'transparent',
    card: 'transparent',
    text: '#EEF4FB',
    border: 'rgba(63, 200, 255, 0.20)',
    notification: '#FF6B7A',
  },
  fonts: { regular: { fontFamily: 'system', fontWeight: '400' }, medium: { fontFamily: 'system', fontWeight: '500' }, bold: { fontFamily: 'system', fontWeight: '700' }, heavy: { fontFamily: 'system', fontWeight: '900' } },
};

function desktop(): any {
  if (typeof window === 'undefined') return undefined;
  return (window as any).desktop;
}

export default function RootLayout() {
  const ws = useConnection((s) => s.ws);
  const handleServerMessage = useChat((s) => s.handleServerMessage);
  const loadAccounts = useConnection((s) => s.loadAccounts);
  const resumeConnection = useConnection((s) => s.resumeConnection);
  const isDesktop = desktop()?.isDesktop === true;
  const isChild = desktop()?.isChild === true;

  const fadeAnim = useRef(new Animated.Value(isChild ? 0 : 1)).current;

  useEffect(() => {
    if (!isChild) return;
    Animated.timing(fadeAnim, {
      toValue: 1,
      duration: 360,
      useNativeDriver: false,
    }).start();
  }, [isChild]);

  useEffect(() => {
    loadAccounts().then(() => {
      resumeConnection();
    });
  }, []);

  useEffect(() => {
    if (!ws) return;

    const unsub = ws.onMessage((msg) => {
      if (
        msg.type === 'status'
        || msg.type === 'delta'
        || msg.type === 'response'
        || msg.type === 'error'
      ) {
        handleServerMessage(msg);
      }

      if (isDesktop && !isChild) {
        try {
          desktop()?.wsRelayBroadcast(JSON.stringify(msg));
        } catch { /* ignore */ }
      }
    });

    let relayCleanup: (() => void) | undefined;
    if (isDesktop && !isChild) {
      const d = desktop();
      if (d?.onWsRelayFromChild) {
        relayCleanup = d.onWsRelayFromChild((data: string) => {
          try {
            ws.sendRaw(data);
          } catch { /* ignore */ }
        });
      }
    }

    return () => {
      unsub();
      relayCleanup?.();
    };
  }, [ws, handleServerMessage, isDesktop, isChild]);

  return (
    <ConfirmProvider>
      <JarvisCanvas style={styles.root}>
        {Platform.OS === 'web' && <Header />}
        <Animated.View style={[styles.content, { opacity: fadeAnim }]}>
          <ThemeProvider value={navDarkTheme}>
            <Stack
              screenOptions={{
                headerShown: false,
                contentStyle: { backgroundColor: 'transparent' },
                cardStyle: { backgroundColor: 'transparent' },
              } as any}
            >
              <Stack.Screen name="index" />
              <Stack.Screen name="(tabs)" />
            </Stack>
          </ThemeProvider>
        </Animated.View>
      </JarvisCanvas>
    </ConfirmProvider>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  content: { flex: 1 },
});
