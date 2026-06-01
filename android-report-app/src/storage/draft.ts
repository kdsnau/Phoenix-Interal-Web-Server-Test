import AsyncStorage from '@react-native-async-storage/async-storage';

const DRAFT_KEY = 'phx_report_draft';

export interface ReportDraft {
  jobName:    string;
  rfq:        string;
  technicians: string;
  arrival:    string;
  departure:  string;
  work:       string;
  parts:      string;
  returnTrip: boolean;
  photoUris:  string[];
  savedAt:    number;
}

const empty: Omit<ReportDraft, 'savedAt'> = {
  jobName:    '',
  rfq:        '',
  technicians: '',
  arrival:    '',
  departure:  '',
  work:       '',
  parts:      '',
  returnTrip: false,
  photoUris:  [],
};

export function emptyDraft(techName: string): ReportDraft {
  return { ...empty, technicians: techName, savedAt: Date.now() };
}

export async function saveDraft(data: Partial<ReportDraft>): Promise<void> {
  const current = await loadDraft();
  const merged  = { ...(current ?? empty), ...data, savedAt: Date.now() };
  await AsyncStorage.setItem(DRAFT_KEY, JSON.stringify(merged));
}

export async function loadDraft(): Promise<ReportDraft | null> {
  const raw = await AsyncStorage.getItem(DRAFT_KEY);
  if (!raw) return null;
  try { return JSON.parse(raw) as ReportDraft; }
  catch { return null; }
}

export async function clearDraft(): Promise<void> {
  await AsyncStorage.removeItem(DRAFT_KEY);
}
