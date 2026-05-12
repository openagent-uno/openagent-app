/**
 * Responsive sidebar.
 *
 * Wide (>= 768px): sidebar overlays content with absolute positioning
 * and blur; content extends full-width underneath.
 * Narrow (< 768px): slide-in drawer with gesture support.
 */

import { createContext, useContext, useRef, useEffect } from 'react';
import { View, StyleSheet, Platform } from 'react-native';
import {
  createDrawerNavigator,
  DrawerContentComponentProps,
} from '@react-navigation/drawer';
import { NavigationIndependentTree, useNavigation } from '@react-navigation/native';
import { useIsWideScreen } from '../hooks/useLayout';
import { useDrawer } from '../stores/drawer';
import { colors, radius, spacing } from '../theme';
import BlurView from './BlurView';

const SIDEBAR_WIDTH = 248;
const SIDEBAR_MARGIN = spacing.sm; // 8px gap around the panel
const Nav = createDrawerNavigator();

const ContentCtx = createContext<{ sidebar: React.ReactNode; children: React.ReactNode }>({
  sidebar: null,
  children: null,
});

/** The blur panel reused for both the wide overlay and the narrow drawer. */
function SidebarPanel({ children }: { children: React.ReactNode }) {
  return (
    <BlurView intensity={10} style={styles.sidebarPanel}>
      {children}
    </BlurView>
  );
}

// ── Narrow: drawer-based sidebar ──────────────────────────────

function DrawerSidebarContent(_props: DrawerContentComponentProps) {
  const { sidebar } = useContext(ContentCtx);
  return <SidebarPanel>{sidebar}</SidebarPanel>;
}

function MainScreen() {
  const { children } = useContext(ContentCtx);
  const navigation = useNavigation<any>();
  const toggleRequested = useDrawer((s) => s.toggleRequested);
  const lastToggle = useRef(0);

  useEffect(() => {
    if (toggleRequested > 0 && toggleRequested !== lastToggle.current) {
      lastToggle.current = toggleRequested;
      navigation.toggleDrawer();
    }
  }, [toggleRequested, navigation]);

  return <View style={styles.fill}>{children}</View>;
}

// ── Wide: absolute-overlay sidebar ────────────────────────────

function WideLayout({ sidebar, children }: { sidebar: React.ReactNode; children: React.ReactNode }) {
  return (
    <View style={styles.wideRoot}>
      <View style={styles.wideContent}>
        {children}
      </View>
      <View style={styles.wideSidebar}>
        <SidebarPanel>{sidebar}</SidebarPanel>
      </View>
    </View>
  );
}

// ── Main component ────────────────────────────────────────────

interface Props {
  sidebar: React.ReactNode;
  children: React.ReactNode;
}

export default function ResponsiveSidebar({ sidebar, children }: Props) {
  const isWide = useIsWideScreen();

  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const style = document.createElement('style');
    style.textContent = `[style*="border-radius: 0px 16px"] { border-radius: 0px !important; }`;
    document.head.appendChild(style);
    return () => { document.head.removeChild(style); };
  }, []);

  if (isWide) {
    return <WideLayout sidebar={sidebar}>{children}</WideLayout>;
  }

  return (
    <ContentCtx.Provider value={{ sidebar, children }}>
      <NavigationIndependentTree>
        <Nav.Navigator
          screenOptions={{
            headerShown: false,
            drawerType: 'front',
            drawerStyle: {
              width: SIDEBAR_WIDTH,
              backgroundColor: 'transparent',
              borderRightWidth: 0,
              borderRadius: 0,
            },
            sceneStyle: { borderRadius: 0 } as any,
            overlayColor: 'rgba(14, 13, 11, 0.35)',
            swipeEnabled: true,
            drawerStatusBarAnimation: 'none',
          }}
          drawerContent={DrawerSidebarContent}
        >
          <Nav.Screen name="__main__" component={MainScreen} />
        </Nav.Navigator>
      </NavigationIndependentTree>
    </ContentCtx.Provider>
  );
}

const styles = StyleSheet.create({
  sidebarPanel: {
    flex: 1,
    margin: SIDEBAR_MARGIN,
    borderRadius: radius.lg,
    backgroundColor: Platform.OS === 'web' ? 'rgba(4, 6, 14, 0.45)' : 'transparent',
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
  },
  fill: { flex: 1 },

  // ── Wide layout ──
  wideRoot: { flex: 1 },
  wideContent: {
    flex: 1,
  },
  wideSidebar: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    width: SIDEBAR_WIDTH,
  },
});
