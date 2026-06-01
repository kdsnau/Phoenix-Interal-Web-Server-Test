// Replace this with the real Incoming Webhook URL from api.slack.com/apps
// Set via app.config.js extra or environment variable — never hardcode here
const WEBHOOK_URL = process.env.SLACK_WEBHOOK_URL ?? '';

export interface ReportPayload {
  jobName:     string;
  rfq:         string;
  technicians: string;
  arrival:     string;
  work:        string;
  parts:       string;
  returnTrip:  boolean;
  photoCount:  number;
}

function buildMessage(p: ReportPayload): string {
  const lines = [
    '*Job name*',
    p.jobName || '—',
    '',
    '*RFQ*',
    p.rfq || '—',
    '',
    '*Technicians*',
    p.technicians || '—',
    '',
    '*Site arrival and departure times*',
    p.arrival || '—',
    '',
    '*What work was completed*',
    p.work || '—',
    '',
    '*What parts and supplies were used*',
    p.parts || '—',
    '',
    '*Is a return trip required*',
    p.returnTrip ? 'Yes' : 'No',
  ];

  if (p.photoCount > 0) {
    lines.push('', `_${p.photoCount} photo(s) taken on-site — attach via Slack when available_`);
  }

  return lines.join('\n');
}

export async function postReport(payload: ReportPayload): Promise<void> {
  const response = await fetch(WEBHOOK_URL, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ text: buildMessage(payload) }),
  });

  if (!response.ok) {
    throw new Error(`Slack webhook returned ${response.status}`);
  }
}
