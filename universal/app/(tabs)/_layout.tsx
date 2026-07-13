/**
 * Authenticated app shell — a react-navigation Drawer.
 *
 * One navigator drives both form factors (no collapsed middle stage):
 *   - tablet / desktop (≥768): `drawerType: 'permanent'` — the full Sidebar
 *     is a fixed column beside the content.
 *   - phone (<768): `drawerType: 'back'` — the same full Sidebar rides in a
 *     drawer; the content slides right to reveal it (Claude-style), toggled
 *     by the menu button in each screen's header.
 *
 * The Sidebar is the drawer content. Navigation is plain expo-router
 * (`router.push` from the Sidebar); each route renders the real
 * react-navigation header with its own title + actions (see the per-tab
 * stacks and `components/screenHeader.tsx`). Detached editors / run
 * history / terminals are ordinary pushed routes inside their stacks.
 */

import { createDrawerNavigator } from '@react-navigation/drawer';
import { withLayoutContext } from 'expo-router';
import Sidebar from '../../components/Sidebar';
import { HeaderMenu, themedHeader } from '../../components/screenHeader';
import { useLayout } from '../../hooks/useLayout';
import { colors } from '../../theme';

const { Navigator } = createDrawerNavigator();
const Drawer = withLayoutContext(Navigator);

export default function AppDrawerLayout() {
  const layout = useLayout();
  // Two states only: a permanent full column on tablet+ , a toggleable full
  // drawer on phones. No collapsed icon-only middle stage.
  const permanent = !layout.isPhone;
  const width = permanent ? 244 : 296;

  // Top-level (drawer-root) screens get the menu button as headerLeft on
  // phones; stack sub-screens keep their native back button.
  const leaf = (title: string) => ({
    ...themedHeader,
    title,
    headerLeft: () => <HeaderMenu />,
  });

  return (
    <Drawer
      // The Drawer is the cross-section "back" boundary. react-navigation's
      // default backBehavior is 'firstRoute', which REBUILDS the drawer
      // history to [firstRoute(chat), current] on every section switch — so
      // any back that bubbles out of a section stack lands on chat (the
      // first route) instead of the section you came from. 'history' keeps a
      // real visited-section trail, so a back that bubbles into the Drawer
      // returns to the previously focused section (and canGoBack reflects it).
      backBehavior="history"
      drawerContent={(props: any) => (
        <Sidebar
          onNavigate={permanent ? undefined : () => props.navigation.closeDrawer()}
        />
      )}
      screenOptions={{
        headerShown: false,
        // Freeze a screen's React tree while it's not the focused route, so
        // a backgrounded tab (e.g. Chat) stops re-rendering on every store
        // mutation — the chat delta storm and any per-screen effects pause
        // until the user returns. The global store still receives updates;
        // the screen just defers rendering them until it's focused again.
        freezeOnBlur: true,
        drawerType: permanent ? 'permanent' : 'back',
        drawerStyle: { width, backgroundColor: 'transparent', borderRightWidth: 0 },
        overlayColor: 'transparent',
        swipeEnabled: !permanent,
        // The divider lives on the content's left edge (not the sidebar's
        // right) so it always sits at the true sidebar↔content boundary,
        // regardless of the drawer width.
        sceneStyle: {
          backgroundColor: colors.bg,
          borderLeftWidth: 1,
          borderLeftColor: colors.borderLight,
        },
      }}
    >
      {/* Leaf screens render the drawer header directly. */}
      <Drawer.Screen name="chat" options={leaf('Chat')} />
      <Drawer.Screen name="model" options={leaf('Model')} />
      <Drawer.Screen name="system" options={leaf('System')} />
      <Drawer.Screen name="settings" options={leaf('Settings')} />
      {/* Stacks own their own headers (per-screen titles + back). */}
      <Drawer.Screen name="memory" options={{ headerShown: false }} />
      <Drawer.Screen name="mcps" options={{ headerShown: false }} />
      <Drawer.Screen name="workflows" options={{ headerShown: false }} />
      <Drawer.Screen name="tasks" options={{ headerShown: false }} />
      <Drawer.Screen name="events" options={{ headerShown: false }} />
      {/* Hidden / legacy routes — reachable by link, never listed. */}
      {/* Single-run detail (from the sidebar's Recent feed) — a drawer-root
          stack so opening a run never highlights a workspace tab. */}
      <Drawer.Screen name="runs" options={{ headerShown: false, drawerItemStyle: { display: 'none' } }} />
      <Drawer.Screen name="terminal" options={{ headerShown: false, drawerItemStyle: { display: 'none' } }} />
      <Drawer.Screen name="automations" options={{ headerShown: false, drawerItemStyle: { display: 'none' } }} />
      <Drawer.Screen name="members" options={{ headerShown: false, drawerItemStyle: { display: 'none' } }} />
    </Drawer>
  );
}
