/**
 * Terminal stack — hosts the full-screen / detached terminal route.
 *
 * Opened from the System tab via ``openDetached(router, 'terminal/<id>')``
 * — a new OS window on desktop, a pushed full-screen route on web /
 * native. Mirrors ``workflows/_layout.tsx``; the screen renders its own
 * chrome so headers are suppressed here.
 */

import { Stack } from 'expo-router';

export default function TerminalStackLayout() {
  return (
    <Stack screenOptions={{ headerShown: false, animation: 'fade' }}>
      <Stack.Screen name="[id]" />
    </Stack>
  );
}
