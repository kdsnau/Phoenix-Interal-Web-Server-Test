import React, { useEffect } from 'react';
import { NavigationContainer, DefaultTheme } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import * as Notifications from 'expo-notifications';

import { initDatabase } from './src/db/database';
import { setupChannel, scheduleReminder, requestPermissions } from './src/services/notifications';
import { syncClientsFromServer } from './src/services/sync';
import { theme } from './src/constants/theme';

import LoginScreen    from './src/screens/LoginScreen';
import HomeScreen     from './src/screens/HomeScreen';
import ReportFormScreen from './src/screens/ReportFormScreen';

export type RootStackParamList = {
  Login:      undefined;
  Home:       { userName: string };
  ReportForm: { userName: string };
};

const Stack = createNativeStackNavigator<RootStackParamList>();

const navTheme = {
  ...DefaultTheme,
  colors: {
    ...DefaultTheme.colors,
    background:  theme.bg0,
    card:        theme.bg1,
    text:        theme.text,
    border:      theme.border,
    primary:     theme.accent,
    notification: theme.accent,
  },
};

export default function App() {
  const navRef = React.useRef<any>(null);

  useEffect(() => {
    // Init DB, notifications, and background sync — all non-blocking
    initDatabase().catch(console.error);

    setupChannel().then(async () => {
      const granted = await requestPermissions();
      if (granted) await scheduleReminder();
    });

    syncClientsFromServer();

    // Navigate to ReportForm when user taps a notification
    const sub = Notifications.addNotificationResponseReceivedListener(response => {
      const data = response.notification.request.content.data as { action?: string };
      if (data?.action === 'open_form') {
        // We don't have userName here without storage — go to Login which redirects
        navRef.current?.navigate('Login');
      }
    });

    return () => sub.remove();
  }, []);

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <NavigationContainer theme={navTheme} ref={navRef}>
        <Stack.Navigator
          initialRouteName="Login"
          screenOptions={{ headerShown: false, animation: 'slide_from_right' }}
        >
          <Stack.Screen name="Login"      component={LoginScreen} />
          <Stack.Screen name="Home"       component={HomeScreen} />
          <Stack.Screen name="ReportForm" component={ReportFormScreen} />
        </Stack.Navigator>
      </NavigationContainer>
    </GestureHandlerRootView>
  );
}
