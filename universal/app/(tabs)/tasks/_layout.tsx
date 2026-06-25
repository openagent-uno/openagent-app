/**
 * Scheduled-tasks tab — Expo Router Stack.
 *
 * Opens on the list dashboard (``index``). The task editor (``[id]``,
 * also used for create via the ``new`` sentinel) and run history
 * (``runs/[id]``) push onto this stack on web / native, and open as
 * separate desktop windows via ``openDetached``.
 *
 * Mirrors ``workflows/_layout.tsx`` — the navigator owns every header:
 * the list gets the drawer toggle, the editor and run history get a back
 * button + title (the editor adds a Save action via setOptions).
 */

import { Stack } from 'expo-router';
import { themedHeader, HeaderMenu, HeaderBack } from '../../../components/screenHeader';

export default function TasksStackLayout() {
  return (
    <Stack
      screenOptions={{
        ...themedHeader,
        headerLeft: () => <HeaderBack />,
        animation: 'slide_from_right',
      }}
    >
      <Stack.Screen name="index" options={{ title: 'Scheduled', headerLeft: () => <HeaderMenu /> }} />
      {/* Editor sets its own title (New Task / the task name) + Save action. */}
      <Stack.Screen name="[id]" options={{ title: 'Task' }} />
      <Stack.Screen name="runs/[id]" options={{ title: 'Run history' }} />
    </Stack>
  );
}
