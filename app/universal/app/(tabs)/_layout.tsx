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
        name="automations"
        options={{
          title: 'Automations',
          tabBarIcon: ({ color }) => <Feather name="zap" size={18} color={color} />,
        }}
      />
      <Tabs.Screen
        name="tasks"
        options={{
          title: 'Tasks',
          tabBarIcon: ({ color }) => <Feather name="check-square" size={18} color={color} />,
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
