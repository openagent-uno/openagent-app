import { Slot } from 'expo-router';
import { useEffect } from 'react';
import { View, StyleSheet, Platform } from 'react-native';
import { useConnection } from '../stores/connection';
import { useChat } from '../stores/chat';

export default function RootLayout() {
  const ws = useConnection((s) => s.ws);
  const handleServerMessage = useChat((s) => s.handleServerMessage);

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
      {/* Drag area for Electron titlebar (macOS/Windows/Linux) */}
      {Platform.OS === 'web' && (
        <View
          style={styles.dragBar}
          // @ts-ignore — web-only CSS property
          pointerEvents="none"
        />
      )}
      <View style={styles.content}>
        <Slot />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#FAFAFA',
  },
  dragBar: {
    height: 38,
    // @ts-ignore — web-only
    WebkitAppRegion: 'drag',
    backgroundColor: '#F5F5F5',
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 100,
  },
  content: {
    flex: 1,
    paddingTop: Platform.OS === 'web' ? 38 : 0,
  },
});
