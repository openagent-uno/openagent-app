/**
 * Single-run stack — hosts the run-detail route opened from the sidebar's
 * Recent feed (``/runs/{id}?kind=…&parentId=…``).
 *
 * This lives at the drawer root (not inside the Scheduled / Workflows
 * stacks) on purpose: clicking a run in the Recent feed is like opening a
 * chat session — it swaps the content without selecting a workspace tab.
 * Because the screen is the stack's root, the navigator gives it the
 * drawer toggle (``HeaderMenu``) rather than a back button — there is no
 * parent screen in this stack to go back to.
 */

import { Stack } from 'expo-router';
import { themedHeader, HeaderMenu } from '../../../components/screenHeader';

export default function RunsStackLayout() {
  return (
    <Stack
      screenOptions={{
        ...themedHeader,
        headerLeft: () => <HeaderMenu />,
        animation: 'slide_from_right',
      }}
    >
      <Stack.Screen name="[id]" options={{ title: 'Run' }} />
    </Stack>
  );
}
