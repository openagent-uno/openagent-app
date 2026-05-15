/**
 * Workflows tab — Expo Router Stack.
 *
 * Opens on the list dashboard (``index``). The visual editor pushes
 * onto this stack as ``[id]``.
 *
 * Mirrors ``mcps/_layout.tsx`` one-to-one — same pattern, same
 * transitions, headers suppressed because each screen renders its
 * own title bar.
 *
 * Both screens are declared explicitly. Expo Router will still discover
 * ``[id]`` from the file system without this line, but being explicit
 * keeps the route order deterministic and matches ``mcps/_layout.tsx``.
 */

import { Stack } from 'expo-router';

export default function WorkflowsStackLayout() {
  return (
    <Stack screenOptions={{ headerShown: false, animation: 'slide_from_right' }}>
      <Stack.Screen name="index" />
      <Stack.Screen name="[id]" />
    </Stack>
  );
}
