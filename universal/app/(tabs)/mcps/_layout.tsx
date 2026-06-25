/**
 * MCPs tab — Expo Router Stack.
 *
 * The tab opens on the grid dashboard (``index``). Deeper screens push
 * onto this stack:
 *   - ``install``: secret-entry form for a marketplace server the user
 *     chose to install (params: name, version).
 *   - ``[name]``: edit screen for any installed MCP row.
 *
 * The "new custom MCP" form lives inline as the 4th tab on the dashboard,
 * not as a pushed route — so there is no ``new`` screen registered here.
 *
 * Expo Router is layered on react-navigation; the ``<Stack />`` below
 * is the same native stack navigator, so native back gestures and
 * screen transitions work out of the box. The navigator owns every
 * header: the dashboard gets the drawer toggle, sub-screens get a back
 * button + title (set per-screen via setOptions).
 */

import { Stack } from 'expo-router';
import { themedHeader, HeaderMenu, HeaderBack } from '../../../components/screenHeader';

export default function MCPsStackLayout() {
  return (
    <Stack
      screenOptions={{
        ...themedHeader,
        headerLeft: () => <HeaderBack />,
        animation: 'slide_from_right',
      }}
    >
      <Stack.Screen name="index" options={{ title: 'Connectors', headerLeft: () => <HeaderMenu /> }} />
      {/* Sub-screens set their own (dynamic) titles + actions. */}
      <Stack.Screen name="install" options={{ title: 'Install' }} />
      <Stack.Screen name="[name]" options={{ title: 'Connector' }} />
    </Stack>
  );
}
