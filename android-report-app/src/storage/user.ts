import * as SecureStore from 'expo-secure-store';

const KEY_NAME = 'phx_user_name';
const KEY_PIN  = 'phx_user_pin';

export async function saveUser(name: string, pin: string): Promise<void> {
  await SecureStore.setItemAsync(KEY_NAME, name.trim());
  await SecureStore.setItemAsync(KEY_PIN, pin);
}

export async function getUser(): Promise<{ name: string } | null> {
  const name = await SecureStore.getItemAsync(KEY_NAME);
  return name ? { name } : null;
}

export async function verifyPin(pin: string): Promise<boolean> {
  const stored = await SecureStore.getItemAsync(KEY_PIN);
  return stored === pin;
}

export async function clearUser(): Promise<void> {
  await SecureStore.deleteItemAsync(KEY_NAME);
  await SecureStore.deleteItemAsync(KEY_PIN);
}
