import { upsertClients } from '../db/clients';

// Internal server — only reachable on-site. Sync silently fails when off-network.
const INTERNAL_BASE = 'http://192.168.10.222:5000';
const TIMEOUT_MS    = 3000;

export async function syncClientsFromServer(): Promise<void> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

    const res = await fetch(`${INTERNAL_BASE}/api/clients`, {
      signal: controller.signal,
    });
    clearTimeout(timer);

    if (!res.ok) return;

    const data: Array<{ name: string }> = await res.json();
    const names = data.map(c => c.name).filter(Boolean);
    if (names.length > 0) await upsertClients(names);
  } catch {
    // Not on network — this is expected and fine
  }
}
