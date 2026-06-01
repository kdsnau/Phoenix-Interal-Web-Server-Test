import { getDb } from './database';

export interface Suggestion {
  id: number;
  name: string;
  kind: 'client' | 'job';
}

export async function searchSuggestions(query: string): Promise<Suggestion[]> {
  if (!query.trim()) return [];
  const db = getDb();
  const pattern = `%${query.trim()}%`;

  return db.getAllAsync<Suggestion>(`
    SELECT id, name, 'client' AS kind FROM clients WHERE name LIKE ? COLLATE NOCASE
    UNION
    SELECT id, name, 'job'    AS kind FROM jobs    WHERE name LIKE ? COLLATE NOCASE
    ORDER BY name
    LIMIT 12
  `, [pattern, pattern]);
}

export async function upsertJob(name: string, client?: string): Promise<void> {
  const db = getDb();
  await db.runAsync(
    'INSERT OR IGNORE INTO jobs (name, client) VALUES (?, ?)',
    [name.trim(), client ?? null]
  );
}

export async function upsertClients(names: string[]): Promise<void> {
  const db = getDb();
  for (const name of names) {
    await db.runAsync('INSERT OR IGNORE INTO clients (name) VALUES (?)', [name.trim()]);
  }
}

export async function saveReport(report: {
  jobName: string;
  rfq: string;
  technicians: string;
  arrival: string;
  work: string;
  parts: string;
  returnTrip: boolean;
  photoCount: number;
  slackSent: boolean;
}): Promise<number> {
  const db = getDb();
  const result = await db.runAsync(`
    INSERT INTO reports
      (job_name, rfq, technicians, arrival, work, parts, return_trip, photo_count, submitted_at, slack_sent)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `, [
    report.jobName,
    report.rfq,
    report.technicians,
    report.arrival,
    report.work,
    report.parts,
    report.returnTrip ? 1 : 0,
    report.photoCount,
    Date.now(),
    report.slackSent ? 1 : 0,
  ]);
  return result.lastInsertRowId;
}

export async function markReportSent(id: number): Promise<void> {
  const db = getDb();
  await db.runAsync('UPDATE reports SET slack_sent = 1 WHERE id = ?', [id]);
}

export async function getUnsentReports(): Promise<Array<{
  id: number;
  job_name: string;
  rfq: string;
  technicians: string;
  arrival: string;
  work: string;
  parts: string;
  return_trip: number;
  photo_count: number;
  submitted_at: number;
}>> {
  const db = getDb();
  return db.getAllAsync(`
    SELECT * FROM reports WHERE slack_sent = 0 ORDER BY submitted_at ASC
  `);
}
