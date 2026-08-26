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
import { useRouter, withLayoutContext } from 'expo-router';
import { useCallback, useEffect } from 'react';
import { Platform } from 'react-native';
import Sidebar from '../../components/Sidebar';
import GlobalSearchOverlay from '../../components/search/GlobalSearchOverlay';
import { HeaderMenu, themedHeader } from '../../components/screenHeader';
import { useLayout } from '../../hooks/useLayout';
import { useConnection } from '../../stores/connection';
import { globalSearchAvailable, useSearch } from '../../stores/search';
import { openSearchTarget } from '../../services/searchNavigation';
import type { EventCause, SearchTarget } from '../../../common/unified-history';
import { colors } from '../../theme';

const { Navigator } = createDrawerNavigator();
const Drawer = withLayoutContext(Navigator);

export default function AppDrawerLayout() {
  const layout = useLayout();
  const router = useRouter();
  const accountId = useConnection((state) => state.activeAccountId);
  const ws = useConnection((state) => state.ws);
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

  useEffect(() => {
    if (!accountId) {
      useSearch.getState().clear();
      return;
    }
    void useSearch.getState().initialize(accountId);
  }, [accountId]);

  useEffect(() => {
    if (!ws) return;
    return ws.onMessage((message) => {
      if (message.type === 'history_changed') {
        useSearch.getState().handleHistoryChanged(message);
      } else if (message.type === 'search_index_changed') {
        useSearch.getState().handleSearchIndexChanged(message);
      } else if (message.type === 'auth_ok' && message.capabilities && accountId) {
        // REST discovery remains authoritative. A reconnect can change server
        // generation/version, so re-run it instead of trusting stale state.
        void useSearch.getState().initialize(accountId, true);
      }
    });
  }, [accountId, ws]);

  useEffect(() => {
    if (Platform.OS !== 'web' || typeof window === 'undefined') return;
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.repeat || event.isComposing) return;
      if (!(event.metaKey || event.ctrlKey) || event.altKey || event.shiftKey) return;
      if (event.key.toLowerCase() !== 'p') return;
      const state = useSearch.getState();
      if (!globalSearchAvailable(state)) return;
      event.preventDefault();
      state.show();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const handleOpenTarget = useCallback((target: SearchTarget, causedBy?: EventCause | null) => {
    openSearchTarget(router, target, causedBy);
  }, [router]);

  return (
    <>
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
      <Drawer.Screen name="logs" options={leaf('Logs')} />
      <Drawer.Screen name="settings" options={leaf('Settings')} />
      {/* Stacks own their own headers (per-screen titles + back). */}
      <Drawer.Screen name="memory" options={{ headerShown: false }} />
      <Drawer.Screen name="mcps" options={{ headerShown: false }} />
      <Drawer.Screen name="skills" options={{ headerShown: false }} />
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
      <GlobalSearchOverlay onOpenTarget={handleOpenTarget} />
    </>
  );
}
