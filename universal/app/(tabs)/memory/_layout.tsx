/**
 * Memory tab — Expo Router Stack.
 *
 * Opens on the graph dashboard (``index``). Tapping a note (in the
 * sidebar or on a graph node) pushes the editor onto this stack as
 * ``[...path]`` — catch-all so note paths with folder segments
 * (``docs/ideas.md``) work as-is.
 *
 * Mirrors ``mcps/_layout.tsx`` and ``workflows/_layout.tsx`` — same
 * pattern, same transitions; the navigator owns every header (the graph
 * gets the drawer toggle, sub-screens get a back button + title).
 */

import { Stack } from 'expo-router';
import { themedHeader, HeaderMenu, HeaderBack } from '../../../components/screenHeader';

export default function MemoryStackLayout() {
  return (
    <Stack
      screenOptions={{
        ...themedHeader,
        headerLeft: () => <HeaderBack />,
        animation: 'slide_from_right',
      }}
    >
      {/* Top-level: drawer toggle, not a back button. */}
      <Stack.Screen name="index" options={{ title: 'Memory', headerLeft: () => <HeaderMenu /> }} />
      {/* Sub-screens set their own (dynamic) titles via navigation.setOptions. */}
      <Stack.Screen name="[...path]" options={{ title: 'Note' }} />
      <Stack.Screen name="history" options={{ title: 'Vault history' }} />
      <Stack.Screen name="history/[...path]" options={{ title: 'History' }} />
    </Stack>
  );
}
