import { colors, font } from '../../theme';
import Feather from '@expo/vector-icons/Feather';
import { Tabs } from 'expo-router';
import { JarvisDock } from '../../components/jarvis';

export default function TabsLayout() {
  return (
    <Tabs
      tabBar={(props) => <JarvisDock {...props} />}
      screenOptions={{
        headerShown: false,
        sceneStyle: { backgroundColor: 'transparent' },
        // Position the tab-bar wrapper absolutely so screen content
        // fills the full viewport and flows *under* the floating
        // JarvisDock (rather than the navigator reserving a slot
        // that would otherwise paint a default white surface).
        tabBarStyle: {
          position: 'absolute',
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: 'transparent',
          borderTopWidth: 0,
          elevation: 0,
          shadowOpacity: 0,
        },
        tabBarActiveTintColor: colors.accent,
        tabBarInactiveTintColor: colors.textSecondary,
        tabBarLabelStyle: {
          fontSize: 9.5,
          fontWeight: '600',
          fontFamily: font.sans,
          letterSpacing: 1.5,
        },
      }}
    >
      <Tabs.Screen
        name="chat"
        options={{
          title: 'Chat',
          tabBarIcon: ({ color }) => <Feather name="message-circle" size={18} color={color} />,
        }}
      />
      <Tabs.Screen
        name="voice"
        options={{
          title: 'Voice',
          tabBarIcon: ({ color }) => <Feather name="mic" size={18} color={color} />,
        }}
      />
      <Tabs.Screen
        name="memory"
        options={{
          title: 'Memory',
          tabBarIcon: ({ color }) => <Feather name="book-open" size={18} color={color} />,
        }}
      />
      <Tabs.Screen
        name="mcps"
        options={{
          title: 'MCPs',
          tabBarIcon: ({ color }) => <Feather name="tool" size={18} color={color} />,
        }}
      />
      <Tabs.Screen
        name="workflows"
        options={{
          title: 'Workflows',
          tabBarIcon: ({ color }) => <Feather name="git-branch" size={18} color={color} />,
        }}
      />
      <Tabs.Screen
        name="tasks"
        options={{
          title: 'Scheduled',
          tabBarIcon: ({ color }) => <Feather name="clock" size={18} color={color} />,
        }}
      />
      {/*
        Route stub for the old /automations path. Hidden from the tab
        bar but still present so a saved link, an opened deep link, or
        an Expo-Router sibling navigation keeps working — it redirects
        to /workflows inside the screen. Remove after one release.
      */}
      <Tabs.Screen
        name="automations"
        options={{
          href: null,
          title: 'Automations',
        }}
      />
      <Tabs.Screen
        name="model"
        options={{
          title: 'Model',
          tabBarIcon: ({ color }) => <Feather name="cpu" size={18} color={color} />,
        }}
      />
      <Tabs.Screen
        name="system"
        options={{
          title: 'System',
          tabBarIcon: ({ color }) => <Feather name="activity" size={18} color={color} />,
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          title: 'Settings',
          tabBarIcon: ({ color }) => <Feather name="settings" size={18} color={color} />,
        }}
      />
    </Tabs>
  );
}
