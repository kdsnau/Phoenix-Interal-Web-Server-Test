import AsyncStorage from '@react-native-async-storage/async-storage';
import seedData from '../data/clients_seed.json';

const KEY_CLIENTS = 'phx_clients';
const KEY_JOBS    = 'phx_jobs';
const KEY_REPORTS = 'phx_reports';

export interface StoredClient { name: string; }
export interface StoredJob    { name: string; client?: string; }
export interface StoredReport {
  id:           number;
  job_name:     string;
  rfq:          string;
  technicians:  string;
  arrival:      string;
  work:         string;
  parts:        string;
  return_trip:  number;
  photo_count:  number;
  submitted_at: number;
  slack_sent:   boolean;
}

export async function initDatabase(): Promise<void> {
  const existing = await AsyncStorage.getItem(KEY_CLIENTS);
  if (!existing) {
    const seed = seedData as Array<{ name: string }>;
    await AsyncStorage.setItem(KEY_CLIENTS, JSON.stringify(seed));
  }
  const existingJobs = await AsyncStorage.getItem(KEY_JOBS);
  if (!existingJobs) {
    await AsyncStorage.setItem(KEY_JOBS, JSON.stringify([]));
  }
  const existingReports = await AsyncStorage.getItem(KEY_REPORTS);
  if (!existingReports) {
    await AsyncStorage.setItem(KEY_REPORTS, JSON.stringify([]));
  }
}

export async function getClients(): Promise<StoredClient[]> {
  const raw = await AsyncStorage.getItem(KEY_CLIENTS);
  return raw ? JSON.parse(raw) : [];
}

export async function getJobs(): Promise<StoredJob[]> {
  const raw = await AsyncStorage.getItem(KEY_JOBS);
  return raw ? JSON.parse(raw) : [];
}

export async function addJob(name: string, client?: string): Promise<void> {
  const jobs = await getJobs();
  if (!jobs.find(j => j.name.toLowerCase() === name.trim().toLowerCase())) {
    const updated = [{ name: name.trim(), client }, ...jobs].slice(0, 100);
    await AsyncStorage.setItem(KEY_JOBS, JSON.stringify(updated));
  }
}

export async function addClients(names: string[]): Promise<void> {
  const clients  = await getClients();
  const existing = new Set(clients.map(c => c.name.toLowerCase()));
  const toAdd    = names.filter(n => !existing.has(n.toLowerCase()));
  if (toAdd.length > 0) {
    await AsyncStorage.setItem(
      KEY_CLIENTS,
      JSON.stringify([...clients, ...toAdd.map(n => ({ name: n }))])
    );
  }
}

export async function getAllReports(): Promise<StoredReport[]> {
  const raw = await AsyncStorage.getItem(KEY_REPORTS);
  return raw ? JSON.parse(raw) : [];
}

export async function appendReport(report: StoredReport): Promise<void> {
  const reports = await getAllReports();
  await AsyncStorage.setItem(KEY_REPORTS, JSON.stringify([report, ...reports]));
}

export async function patchReport(id: number, patch: Partial<StoredReport>): Promise<void> {
  const reports = await getAllReports();
  const updated = reports.map(r => r.id === id ? { ...r, ...patch } : r);
  await AsyncStorage.setItem(KEY_REPORTS, JSON.stringify(updated));
}
