/**
 * MCPs tab — Expo Router Stack.
 *
 * The tab opens on the grid dashboard (``index``). Two deeper screens
 * push onto this stack:
 *   - ``install``: secret-entry form for a marketplace server the user
 *     chose to install (params: name, version).
 *
 * Expo Router is layered on react-navigation; the ``<Stack />`` below
 * is the same native stack navigator, so native back gestures and
 * screen transitions work out of the box. Headers are suppressed —
 * each screen renders its own so we can style the title typography.
 */

import { Stack } from 'expo-router';

export default function MCPsStackLayout() {
  return (
    <Stack screenOptions={{ headerShown: false, animation: 'slide_from_right' }}>
      <Stack.Screen name="index" />
      <Stack.Screen name="install" />
    </Stack>
  );
}
