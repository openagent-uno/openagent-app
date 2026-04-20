import { colors, font } from '../../theme';
import Feather from '@expo/vector-icons/Feather';
import { Tabs } from 'expo-router';

export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarStyle: {
          backgroundColor: colors.sidebar,
          borderTopColor: colors.borderLight,
          borderTopWidth: 1,
          height: 54,
          paddingBottom: 6,
          paddingTop: 6,
        },
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.textMuted,
        tabBarLabelStyle: {
          fontSize: 10,
          fontWeight: '500',
          fontFamily: font.sans,
          letterSpacing: 0.2,
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
        name="settings"
        options={{
          title: 'Settings',
          tabBarIcon: ({ color }) => <Feather name="settings" size={18} color={color} />,
        }}
      />
    </Tabs>
  );
}
