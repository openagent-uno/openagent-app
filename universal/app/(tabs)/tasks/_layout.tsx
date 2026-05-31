/**
 * Scheduled-tasks tab — Expo Router Stack.
 *
 * Opens on the list dashboard (``index``). The task editor (``[id]``,
 * also used for create via the ``new`` sentinel) and run history
 * (``runs/[id]``) push onto this stack on web / native, and open as
 * separate desktop windows via ``openDetached``.
 *
 * Mirrors ``workflows/_layout.tsx`` — headers suppressed because each
 * screen renders its own ``DetachedHeader``.
 */

import { Stack } from 'expo-router';

export default function TasksStackLayout() {
  return (
    <Stack screenOptions={{ headerShown: false, animation: 'slide_from_right' }}>
      <Stack.Screen name="index" />
      <Stack.Screen name="[id]" />
      <Stack.Screen name="runs/[id]" />
    </Stack>
  );
}
