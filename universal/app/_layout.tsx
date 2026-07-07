import { Stack, useUnstableGlobalHref } from 'expo-router';
import { useEffect, useRef } from 'react';
import { Animated, View, StyleSheet, Platform } from 'react-native';
import { ThemeProvider, type Theme } from '@react-navigation/native';
import { useConnection } from '../stores/connection';
import { useChat } from '../stores/chat';
import { useNavHistory, trailHref } from '../stores/navHistory';
import { ConfirmProvider } from '../components/ConfirmDialog';
import Header from '../components/Header';
import { JarvisCanvas } from '../components/jarvis';

/**
 * Records every route change into the explicit nav trail (see
 * stores/navHistory). Renders nothing; lives inside the router so the
 * expo-router hook re-runs it on each navigation. Uses
 * ``useUnstableGlobalHref`` — the REACTIVE full href (path + query) from
 * expo-router's route info — rather than reading ``window.location`` out of
 * band, which lagged the route update and dropped query params (e.g. a run's
 * ``?kind&parentId&name``), corrupting the back target. Cross-platform too:
 * the global href carries the query on native as well.
 */
function NavHistoryRecorder() {
  const href = useUnstableGlobalHref();
  useEffect(() => {
    useNavHistory.getState().record(trailHref(href));
  }, [href]);
  return null;
}

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
  // macOS shows native traffic lights in the sidebar's top-left, so it
  // needs no chrome strip; Win/Linux keep the custom controls Header.
  const isMac = desktop()?.platform === 'darwin';

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
        || msg.type === 'seed'
        || msg.type === 'error'
        || msg.type === 'session_compacted'
      ) {
        handleServerMessage(msg);
      }

      // End of a logical assistant turn → snap the live transcript to the
      // authoritative DB-derived shape so the live view matches a reopen
      // exactly (real authorship, delegation cards, no missing/dup messages).
      // The runs are persisted by the time this frame is emitted.
      // ``finaliseStreaming`` first: clears any stuck streaming:true / isProcessing:true
      // left when a gateway omits the ``response`` frame or a RAF delta flush
      // races past it. This unblocks ``reconcileSession`` so it can fetch the
      // canonical transcript — without it, isProcessing:true would make
      // reconcileSession a no-op and the markdown renderer would stay on the
      // plain-text (literal asterisks) fallback path permanently.
      if (msg.type === 'turn_complete' && msg.session_id) {
        useChat.getState().finaliseStreaming(msg.session_id);
        useChat.getState().reconcileSession(msg.session_id);
      }

      // A session was deleted/pruned server-side → drop it from this sidebar
      // in realtime (the events store separately handles 'created' by
      // refetching the list, which surfaces new sub-agent sessions live).
      if (msg.type === 'resource_event' && msg.resource === 'session'
          && msg.action === 'deleted' && msg.id) {
        useChat.getState().dropSessionLocal(msg.id);
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
      <NavHistoryRecorder />
      <JarvisCanvas style={styles.root} showBrackets={false} showEdgeTicks={false} showGrid={false}>
        {/* Window chrome (drag strip + custom traffic-light controls) for
            frameless Win/Linux only. macOS uses native traffic lights in
            the sidebar; plain web / native render no chrome. */}
        {isDesktop && !isMac && <Header />}
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
