import { Stack } from 'expo-router';
import { HeaderBack, HeaderMenu, themedHeader } from '../../../components/screenHeader';

export const unstable_settings = { initialRouteName: 'index' };

export default function ViewsStackLayout() {
  return (
    <Stack
      screenOptions={{
        ...themedHeader,
        headerLeft: () => <HeaderBack fallback="/(tabs)/views" />,
        animation: 'slide_from_right',
      }}
    >
      <Stack.Screen name="index" options={{ title: 'Views', headerLeft: () => <HeaderMenu /> }} />
      <Stack.Screen name="[id]" options={{ title: 'View' }} />
    </Stack>
  );
}
