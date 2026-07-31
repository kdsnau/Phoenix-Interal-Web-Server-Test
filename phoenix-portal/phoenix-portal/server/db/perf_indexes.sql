-- Performance indexes (from the Kimi efficiency review). Safe, additive, idempotent.
-- Apply with continue-on-error so any index whose column doesn't exist is skipped:
--   PGPASSWORD=... psql -h localhost -U phoenix -d phoenix_portal -f db/perf_indexes.sql

-- service_tickets: assignee lookups, status + event-date filters (timesheets, reminders)
CREATE INDEX IF NOT EXISTS idx_service_tickets_assignees        ON service_tickets USING GIN(assignee_ids);
CREATE INDEX IF NOT EXISTS idx_service_tickets_status_event_end ON service_tickets(status, event_end);
CREATE INDEX IF NOT EXISTS idx_service_tickets_status_start     ON service_tickets(status, event_start);
CREATE INDEX IF NOT EXISTS idx_service_tickets_client           ON service_tickets(client_id);

-- snapshot_entries: list ordering + per-client
CREATE INDEX IF NOT EXISTS idx_snapshot_entries_created_at      ON snapshot_entries(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_snapshot_entries_client_created  ON snapshot_entries(client_id, created_at DESC);

-- messages: unread badge + inbox
CREATE INDEX IF NOT EXISTS idx_messages_unread                  ON messages(to_id, created_at DESC) WHERE read = FALSE;
CREATE INDEX IF NOT EXISTS idx_messages_from_id                 ON messages(from_id);

-- clients: renewal / due-date digests + monitoring scans
CREATE INDEX IF NOT EXISTS idx_clients_contract_end            ON clients(contract_end);
CREATE INDEX IF NOT EXISTS idx_clients_permit_expires          ON clients(permit_expires);
CREATE INDEX IF NOT EXISTS idx_clients_next_inspection         ON clients(next_inspection);
CREATE INDEX IF NOT EXISTS idx_clients_maintenance_next        ON clients(maintenance_next) WHERE maintenance_enabled = TRUE;
CREATE INDEX IF NOT EXISTS idx_clients_monitoring_enabled      ON clients(monitoring_enabled);

-- fleet: driver dashboards + open notes
CREATE INDEX IF NOT EXISTS idx_vehicle_reports_vehicle_user    ON vehicle_reports(vehicle_id, user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_vehicles_driver_id              ON vehicles(driver_id);
CREATE INDEX IF NOT EXISTS idx_vehicle_notes_open              ON vehicle_notes(vehicle_id) WHERE resolved = FALSE;

-- misc slow-scan columns
CREATE INDEX IF NOT EXISTS idx_users_role                      ON users(role);
CREATE INDEX IF NOT EXISTS idx_client_monitoring_next_email    ON client_monitoring(next_email_at);
CREATE INDEX IF NOT EXISTS idx_work_orders_status              ON work_orders(status);
