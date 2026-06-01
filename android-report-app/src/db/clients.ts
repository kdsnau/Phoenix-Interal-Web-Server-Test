import {
  getClients, getJobs, addJob, addClients,
  getAllReports, appendReport, patchReport,
  StoredReport,
} from './database';

export interface Suggestion {
  id:   number;
  name: string;
  kind: 'client' | 'job';
}

export async function searchSuggestions(query: string): Promise<Suggestion[]> {
  if (!query.trim()) return [];
  const q = query.trim().toLowerCase();

  const [clients, jobs] = await Promise.all([getClients(), getJobs()]);

  const jobMatches = jobs
    .filter(j => j.name.toLowerCase().includes(q))
    .map((j, i) => ({ id: i, name: j.name, kind: 'job' as const }));

  const clientMatches = clients
    .filter(c => c.name.toLowerCase().includes(q))
    .map((c, i) => ({ id: i + 10000, name: c.name, kind: 'client' as const }));

  return [...jobMatches, ...clientMatches].slice(0, 12);
}

export async function upsertJob(name: string, client?: string): Promise<void> {
  await addJob(name, client);
}

export async function upsertClients(names: string[]): Promise<void> {
  await addClients(names);
}

export async function saveReport(report: {
  jobName:     string;
  rfq:         string;
  technicians: string;
  arrival:     string;
  work:        string;
  parts:       string;
  returnTrip:  boolean;
  photoCount:  number;
  slackSent:   boolean;
}): Promise<number> {
  const id = Date.now();
  await appendReport({
    id,
    job_name:     report.jobName,
    rfq:          report.rfq,
    technicians:  report.technicians,
    arrival:      report.arrival,
    work:         report.work,
    parts:        report.parts,
    return_trip:  report.returnTrip ? 1 : 0,
    photo_count:  report.photoCount,
    submitted_at: id,
    slack_sent:   report.slackSent,
  });
  return id;
}

export async function markReportSent(id: number): Promise<void> {
  await patchReport(id, { slack_sent: true });
}

export async function getUnsentReports(): Promise<StoredReport[]> {
  const reports = await getAllReports();
  return reports.filter(r => !r.slack_sent);
}
