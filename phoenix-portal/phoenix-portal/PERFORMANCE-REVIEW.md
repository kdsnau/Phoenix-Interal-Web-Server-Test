**Note:** the schema snippet omits columns the code already uses (`service_tickets.assignee_ids`, `event_start`, `event_end`, `event_location`, `reminder_sent`, `google_event_id`, `ticket_type`, `users.assignable`, `clients.maintenance_*`, etc.). The indexes below assume those columns exist.

---

### 1. HIGH — `server/routes/timesheets.js`
**Inefficiency:** `buildTimesheet` geocodes destinations one row at a time (`await officeDistance(dest)` inside a `for…of`), and `/summary` awaits each staff timesheet sequentially.

**Fix:** pre-warm the distance cache for all unique destinations in parallel, and build staff sheets concurrently with a DB-safe limit.

```js
// inside buildTimesheet, before the loop
const dests = [...new Set(
  r.rows.map(t => normAddr(t.event_location) || normAddr(t.site_address))
        .filter(Boolean)
)];
await Promise.all(dests.map(d => officeDistance(d)));

// in /summary
const pLimit = require('p-limit');
const limit = pLimit(5);
const sheets = await Promise.all(
  staff.rows.map(u => limit(() => buildTimesheet(u.id, start, end)))
);
const out = sheets
  .map((s, i) => ({ user_id: staff.rows[i].id, name: staff.rows[i].name,
                    tickets: s.rows.length, ...s.totals }))
  .filter(s => s.tickets);
```

Best long-term fix: geocode all client/site addresses in a background job so request-time calls never hit Nominatim.

---

### 2. HIGH — `service_tickets`
**Inefficiency:** `WHERE $1 = ANY(assignee_ids)`, `status IN / NOT IN`, and date-range filters run against unindexed columns.

**Fix:** add these indexes.

```sql
CREATE INDEX IF NOT EXISTS idx_service_tickets_assignees
  ON service_tickets USING GIN(assignee_ids);

CREATE INDEX IF NOT EXISTS idx_service_tickets_status_event_end
  ON service_tickets(status, event_end);

CREATE INDEX IF NOT EXISTS idx_service_tickets_status_event_start
  ON service_tickets(status, event_start)
  WHERE status NOT IN ('resolved','closed');

CREATE INDEX IF NOT EXISTS idx_service_tickets_event_end_phx
  ON service_tickets((event_end AT TIME ZONE 'America/Phoenix'))
  WHERE status NOT IN ('resolved','closed') AND event_end IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_service_tickets_event_start_phx
  ON service_tickets((event_start AT TIME ZONE 'America/Phoenix'))
  WHERE reminder_sent = FALSE
    AND status NOT IN ('resolved','closed')
    AND assignee_ids <> '{}';
```

---

### 3. HIGH — `server/routes/snapshot.js`
**Inefficiency:** `GET /api/snapshot` returns **all** rows (`ORDER BY created_at DESC` with no `LIMIT`) and `SELECT s.*` pulls the large `line_items` JSONB for every list row.

**Fix:** paginate and exclude `line_items` from the list select.

```js
const LIST_SELECT = `
  SELECT s.id, s.type, s.customer, s.rfq, s.hours, s.scheduled_date,
         s.invoice_num, s.email_date, s.notes, s.client_id,
         s.created_by, s.created_at, s.updated_at, c.name AS client_name
  FROM snapshot_entries s
  LEFT JOIN clients c ON c.id = s.client_id`;

const limit  = Math.min(parseInt(req.query.limit, 10)  || 50, 200);
const offset = parseInt(req.query.offset, 10) || 0;

const r = client_id
  ? await pool.query(
      `${LIST_SELECT} WHERE s.client_id = $1 ORDER BY s.created_at DESC LIMIT $2 OFFSET $3`,
      [client_id, limit, offset])
  : await pool.query(
      `${LIST_SELECT} ORDER BY s.created_at DESC LIMIT $1 OFFSET $2`,
      [limit, offset]);
```

```sql
CREATE INDEX IF NOT EXISTS idx_snapshot_entries_created_at
  ON snapshot_entries(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_snapshot_entries_client_created
  ON snapshot_entries(client_id, created_at DESC);
```

---

### 4. MEDIUM-HIGH — `messages`
**Inefficiency:** dashboard unread aggregate (`to_id = $1 AND read = FALSE … ORDER BY MAX(created_at)`) lacks an index.

**Fix:**

```sql
CREATE INDEX IF NOT EXISTS idx_messages_unread
  ON messages(to_id, created_at DESC)
  INCLUDE (from_id)
  WHERE read = FALSE;

CREATE INDEX IF NOT EXISTS idx_messages_from_id
  ON messages(from_id);
```

---

### 5. MEDIUM — `server/services/monitoringScheduler.js`
**Inefficiency:** `runMaintenanceCheck` and `runAppointmentReminders` query `users` once per client/ticket inside a loop (N+1), and external calls (email/gcal) run sequentially.

**Fix:** batch the user lookup, then parallelize with a limit.

```js
// runMaintenanceCheck example
const allIds = [...new Set(
  due.rows.flatMap(c => c.maintenance_assignee_id ? [c.maintenance_assignee_id] : [])
))];
const usersRes = await pool.query(
  'SELECT id, email, name FROM users WHERE id = ANY($1)', [allIds]);
const userById = new Map(usersRes.rows.map(u => [u.id, u]));

const limit = pLimit(5);
await Promise.all(due.rows.map(c => limit(async () => {
  const techs = (c.maintenance_assignee_id ? [userById.get(c.maintenance_assignee_id)] : [])
                  .filter(Boolean);
  // insert ticket, send email, update client ...
})));
```

Do the same batch lookup in `runAppointmentReminders`.

---

### 6. MEDIUM — `clients`
**Inefficiency:** all renewal/due-date queries (`contract_end`, `permit_expires`, `next_inspection`, `maintenance_next`) and `monitoring_enabled` scans are unindexed.

**Fix:**

```sql
CREATE INDEX IF NOT EXISTS idx_clients_contract_end
  ON clients(contract_end);

CREATE INDEX IF NOT EXISTS idx_clients_permit_expires
  ON clients(permit_expires);

CREATE INDEX IF NOT EXISTS idx_clients_next_inspection
  ON clients(next_inspection);

CREATE INDEX IF NOT EXISTS idx_clients_maintenance_next
  ON clients(maintenance_next)
  WHERE maintenance_enabled = TRUE;

CREATE INDEX IF NOT EXISTS idx_clients_monitoring_enabled
  ON clients(monitoring_enabled);
```

---

### 7. MEDIUM — `server/db/pool.js`
**Inefficiency:** default `pg.Pool` size is 10 and has no connection timeout, which becomes a bottleneck under concurrent mobile requests.

**Fix:**

```js
const pool = new Pool({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT || 5432,
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  max: parseInt(process.env.DB_POOL_SIZE, 10) || 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});
```

---

### 8. LOW-MEDIUM — `server/routes/reminders.js`
**Inefficiency:** the vehicle-report query uses a correlated aggregate subquery per row; `vehicle_reports` has no index.

**Fix:** rewrite as a join/group and index it.

```js
const r = await pool.query(
  `SELECT v.id, v.name, MAX(vr.created_at) AS last_report
   FROM vehicles v
   LEFT JOIN vehicle_reports vr ON vr.vehicle_id = v.id AND vr.user_id = $1
   WHERE v.driver_id = $1
   GROUP BY v.id, v.name
   ORDER BY v.id ASC LIMIT 1`,
  [uid]
);
```

```sql
CREATE INDEX IF NOT EXISTS idx_vehicle_reports_vehicle_user_created
  ON vehicle_reports(vehicle_id, user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_vehicles_driver_id
  ON vehicles(driver_id);
```

---

### 9. LOW-MEDIUM — `server/routes/dashboard.js`
**Inefficiency:** `active_clients` and `technicians` counts, plus `getLeaderboard('month')`, are recomputed on every dashboard load even though they change slowly.

**Fix:** cache with a short TTL.

```js
const counts = await cache.wrap('dash:counts', 60, async () => ({
  active_clients: (await pool.query('SELECT COUNT(*)::int n FROM clients')).rows[0].n,
  technicians:    (await pool.query("SELECT COUNT(*)::int n FROM users WHERE role='technician'")).rows[0].n,
}));
const board = await cache.wrap('dash:leaderboard:month', 60, () => getLeaderboard('month'));
```

---

### 10. LOW — misc missing indexes

```sql
CREATE INDEX IF NOT EXISTS idx_users_role
  ON users(role);

-- only if the assignable column exists (used in timesheets/staff queries)
CREATE INDEX IF NOT EXISTS idx_users_role_assignable
  ON users(role, assignable);

CREATE INDEX IF NOT EXISTS idx_client_monitoring_next_email
  ON client_monitoring(next_email_at);

CREATE INDEX IF NOT EXISTS idx_vehicle_notes_open
  ON vehicle_notes(vehicle_id)
  WHERE resolved = FALSE;

CREATE INDEX IF NOT EXISTS idx_work_orders_status
  ON work_orders(status);
```

Also add `LIMIT` caps to the unconstrained digests in `monitoringScheduler.js` (`runReminderDigest`, `runDeadbeatDigest`, `runFleetIssuesDigest`) so a growing dataset cannot OOM the worker.
