import * as Notifications from 'expo-notifications';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';

const KEY_NOTIF_ID   = 'phx_notif_id';
const KEY_LAST_REPORT = 'phx_last_report_ts';

const FOUR_HOURS_SEC = 4 * 60 * 60;

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge:  true,
  }),
});

export async function setupChannel(): Promise<void> {
  if (Platform.OS !== 'android') return;
  await Notifications.setNotificationChannelAsync('report-reminders', {
    name:                'Report Reminders',
    importance:          Notifications.AndroidImportance.MAX,
    vibrationPattern:    [0, 300, 200, 300],
    lightColor:          '#d4552b',
    lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
    sound:               'default',
    bypassDnd:           false,
  });
}

export async function requestPermissions(): Promise<boolean> {
  const { status } = await Notifications.requestPermissionsAsync();
  return status === 'granted';
}

export async function scheduleReminder(): Promise<void> {
  await cancelReminder();

  const id = await Notifications.scheduleNotificationAsync({
    content: {
      title:    'Field Report Due',
      body:     'Time to submit your site report. Tap to open.',
      sound:    'default',
      priority: Notifications.AndroidNotificationPriority.MAX,
      data:     { action: 'open_form' },
    },
    trigger: {
      seconds:   FOUR_HOURS_SEC,
      repeats:   true,
      channelId: 'report-reminders',
    },
  });

  await AsyncStorage.setItem(KEY_NOTIF_ID, id);
}

export async function cancelReminder(): Promise<void> {
  const id = await AsyncStorage.getItem(KEY_NOTIF_ID);
  if (id) {
    await Notifications.cancelScheduledNotificationAsync(id);
    await AsyncStorage.removeItem(KEY_NOTIF_ID);
  }
}

export async function recordSubmission(): Promise<void> {
  await AsyncStorage.setItem(KEY_LAST_REPORT, Date.now().toString());
  await scheduleReminder();
}

export async function getLastSubmission(): Promise<Date | null> {
  const ts = await AsyncStorage.getItem(KEY_LAST_REPORT);
  return ts ? new Date(parseInt(ts, 10)) : null;
}

export async function getNextReminderDate(): Promise<Date | null> {
  const id = await AsyncStorage.getItem(KEY_NOTIF_ID);
  if (!id) return null;

  const scheduled = await Notifications.getAllScheduledNotificationsAsync();
  const match = scheduled.find(n => n.identifier === id);
  if (!match) return null;

  const trigger = match.trigger as { value?: number; seconds?: number; repeats?: boolean };
  if (trigger?.value) return new Date(trigger.value * 1000);
  return null;
}
