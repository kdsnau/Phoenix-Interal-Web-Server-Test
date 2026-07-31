-- Extended demo data — populates the remaining modules for look-and-feel dry runs.
-- All rows are "[Demo]"/"DEMO"-marked and guarded, so re-running won't duplicate.
--   PGPASSWORD=phoenix_dev psql -h localhost -U phoenix -d phoenix_portal -f db/sample_data_extra.sql
-- Depends on db/sample_data.sql (clients, vehicles, tickets, etc.) having run first.

BEGIN;

-- Extra staff so assignments / messages / time-off look real (login: Admin1234!) --
INSERT INTO users (name, email, password_hash, role)
SELECT v.name, v.email, v.hash, v.role::user_role FROM (VALUES
  ('Mia Tech',   'mia@phoenixsectech.com',  '$2b$10$MZpG4CackjOFiL6tDGhQhOgGnR/5Zuygx.PEwKveMMg5Vk7JO3.2i', 'technician'),
  ('Sam Ledger', 'sam@phoenixsectech.com',  '$2b$10$MZpG4CackjOFiL6tDGhQhOgGnR/5Zuygx.PEwKveMMg5Vk7JO3.2i', 'accounting'),
  ('Alex Field', 'alex@phoenixsectech.com', '$2b$10$MZpG4CackjOFiL6tDGhQhOgGnR/5Zuygx.PEwKveMMg5Vk7JO3.2i', 'technician')
) AS v(name,email,hash,role)
WHERE NOT EXISTS (SELECT 1 FROM users u WHERE u.email = v.email);

-- Fill in the empty vehicle fields --------------------------------------------
UPDATE vehicles SET registration='AZ-4821D', tags_renewal=CURRENT_DATE+45,  slack_name='van-1',  driver=COALESCE(driver,'Mia Tech')   WHERE vehicle_id='DEMO-VAN-1';
UPDATE vehicles SET registration='AZ-7714K', tags_renewal=CURRENT_DATE+112, slack_name='van-2',  driver=COALESCE(driver,'Alex Field') WHERE vehicle_id='DEMO-VAN-2';
UPDATE vehicles SET registration='AZ-3390T', tags_renewal=CURRENT_DATE-8,   slack_name='truck-1',driver=COALESCE(driver,'Sam Ledger') WHERE vehicle_id='DEMO-TRK-1';

-- Vehicle maintenance notes + service reminders -------------------------------
INSERT INTO vehicle_notes (vehicle_id, category, content, resolved)
SELECT (SELECT id FROM vehicles WHERE vehicle_id=v.vid), v.cat, v.content, v.resolved
FROM (VALUES
  ('DEMO-VAN-1','service','Oil change due at 55k miles.', false),
  ('DEMO-VAN-2','repair','Scratch on rear bumper, cosmetic.', false),
  ('DEMO-TRK-1','service','Front brakes replaced.', true)
) AS v(vid,cat,content,resolved)
WHERE NOT EXISTS (SELECT 1 FROM vehicle_notes n WHERE n.content = v.content);

INSERT INTO vehicle_service_notifications (vehicle_id, enabled, next_due_at)
SELECT (SELECT id FROM vehicles WHERE vehicle_id=v.vid), true, CURRENT_DATE + v.days
FROM (VALUES ('DEMO-VAN-1',20), ('DEMO-VAN-2',75), ('DEMO-TRK-1',5)) AS v(vid,days)
WHERE NOT EXISTS (SELECT 1 FROM vehicle_service_notifications s
                  WHERE s.vehicle_id=(SELECT id FROM vehicles WHERE vehicle_id=v.vid));

-- Completed, assigned, time-stamped tickets -> feed the Timesheets module ------
INSERT INTO service_tickets (title, description, status, ticket_type, client_id, assigned_to, assignee_ids, event_start, event_end)
SELECT t.title, t.descr, 'resolved'::ticket_status, t.tt,
       (SELECT id FROM clients WHERE customer_id=t.cust),
       (SELECT id FROM users WHERE email=t.tech),
       ARRAY[(SELECT id FROM users WHERE email=t.tech)]::int[],
       t.es, t.ee
FROM (VALUES
  ('[Demo] Camera install — Verde Auto', 'Mounted 4 cameras in service bay.', 'install', 'DEMO-1004','mia@phoenixsectech.com',  NOW()-interval '2 days 6 hours', NOW()-interval '2 days 2 hours'),
  ('[Demo] NVR drive swap — Papago',     'Replaced failed NVR drive.',        'service', 'DEMO-1003','alex@phoenixsectech.com', NOW()-interval '1 day 5 hours',  NOW()-interval '1 day 1 hour'),
  ('[Demo] Panel upgrade — Ironwood',    'Swapped to new Qolsys panel.',      'install', 'DEMO-1002','mia@phoenixsectech.com',  NOW()-interval '4 hours',        NOW()-interval '1 hour')
) AS t(title,descr,tt,cust,tech,es,ee)
WHERE NOT EXISTS (SELECT 1 FROM service_tickets s WHERE s.title = t.title);

-- Calendar notes + meetings + time-off (Calendar / Schedule) ------------------
INSERT INTO calendar_notes (note_date, user_id, body)
SELECT CURRENT_DATE + v.d, (SELECT id FROM users WHERE email='mia@phoenixsectech.com'), v.body
FROM (VALUES (1,'[Demo] Pick up permit at city office'), (3,'[Demo] Verde Auto camera install'), (7,'[Demo] Quarterly inspection — Ironwood')) AS v(d,body)
WHERE NOT EXISTS (SELECT 1 FROM calendar_notes c WHERE c.body = v.body);

INSERT INTO meetings (title, starts_at, ends_at, location, notes, attendee_ids, created_by)
SELECT v.title, (CURRENT_DATE + v.d)::timestamp + v.st, (CURRENT_DATE + v.d)::timestamp + v.et, v.loc, v.notes,
       ARRAY[(SELECT id FROM users WHERE email='mia@phoenixsectech.com'),(SELECT id FROM users WHERE email='sam@phoenixsectech.com')]::int[],
       (SELECT id FROM users WHERE role='admin' ORDER BY id LIMIT 1)
FROM (VALUES
  ('[Demo] Weekly ops sync', 2, interval '9 hours',  interval '10 hours', 'Office',       'Review open tickets + fleet.'),
  ('[Demo] Verde Auto walkthrough', 5, interval '13 hours', interval '14 hours','Verde Auto Group','Scope camera expansion.')
) AS v(title,d,st,et,loc,notes)
WHERE NOT EXISTS (SELECT 1 FROM meetings m WHERE m.title = v.title);

INSERT INTO time_off (user_id, start_date, end_date, reason, status)
SELECT (SELECT id FROM users WHERE email=v.email), CURRENT_DATE + v.s, CURRENT_DATE + v.e, v.reason, v.status
FROM (VALUES
  ('alex@phoenixsectech.com', 10, 12, '[Demo] Family trip',   'approved'),
  ('mia@phoenixsectech.com',   4,  4, '[Demo] Dentist',       'requested')
) AS v(email,s,e,reason,status)
WHERE NOT EXISTS (SELECT 1 FROM time_off t WHERE t.reason = v.reason);

-- Licenses --------------------------------------------------------------------
INSERT INTO licenses (name, vendor, license_key, seats_total, seats_used, category, expires_at, notes)
SELECT v.* FROM (VALUES
  ('[Demo] Alarm.com Dealer',   'Alarm.com', 'ADC-XXXX-1042', 50, 34, 'Monitoring',  (CURRENT_DATE+220)::date, 'Annual dealer license'),
  ('[Demo] Milestone XProtect', 'Milestone', 'MIL-XXXX-8890', 16,  9, 'VMS',         (CURRENT_DATE+95)::date,  'Per-camera VMS seats'),
  ('[Demo] QuickBooks Online',  'Intuit',    'QBO-XXXX-2201',  5,  3, 'Accounting',  (CURRENT_DATE-14)::date,  'EXPIRED — renew')
) AS v(name,vendor,license_key,seats_total,seats_used,category,expires_at,notes)
WHERE NOT EXISTS (SELECT 1 FROM licenses l WHERE l.name = v.name);

-- Internal messages + notifications -------------------------------------------
INSERT INTO messages (from_id, to_id, body, read)
SELECT (SELECT id FROM users WHERE email=v.f), (SELECT id FROM users WHERE email=v.t), v.body, v.rd
FROM (VALUES
  ('mia@phoenixsectech.com','sam@phoenixsectech.com','[Demo] Verde install done, parts on the WO.', true),
  ('sam@phoenixsectech.com','mia@phoenixsectech.com','[Demo] Thanks — invoicing now.',            false),
  ('alex@phoenixsectech.com','mia@phoenixsectech.com','[Demo] Need a spare NVR drive for Papago.', false)
) AS v(f,t,body,rd)
WHERE NOT EXISTS (SELECT 1 FROM messages m WHERE m.body = v.body);

INSERT INTO notifications (user_id, message)
SELECT (SELECT id FROM users WHERE role='admin' ORDER BY id LIMIT 1), v.msg
FROM (VALUES ('[Demo] License "QuickBooks Online" has expired.'), ('[Demo] Vehicle DEMO-TRK-1 tags renewal is overdue.')) AS v(msg)
WHERE NOT EXISTS (SELECT 1 FROM notifications n WHERE n.message = v.msg);

-- NVR + DMP + monitoring ------------------------------------------------------
INSERT INTO nvr_servers (name, host, port, use_https, username, mock, client_id)
SELECT '[Demo] Verde Auto NVR', '10.20.0.50', 7001, true, 'viewer', true, (SELECT id FROM clients WHERE customer_id='DEMO-1004')
WHERE NOT EXISTS (SELECT 1 FROM nvr_servers n WHERE n.name='[Demo] Verde Auto NVR');

INSERT INTO dmp_accounts (name, site_id, mock, client_id)
SELECT '[Demo] Saguaro Dental DMP', 'SITE-1001', true, (SELECT id FROM clients WHERE customer_id='DEMO-1001')
WHERE NOT EXISTS (SELECT 1 FROM dmp_accounts d WHERE d.name='[Demo] Saguaro Dental DMP');

INSERT INTO client_monitoring (client_id, next_email_at)
SELECT (SELECT id FROM clients WHERE customer_id=v.cust), NOW() + (v.days || ' days')::interval
FROM (VALUES ('DEMO-1001',7), ('DEMO-1002',30)) AS v(cust,days)
WHERE NOT EXISTS (SELECT 1 FROM client_monitoring m WHERE m.client_id=(SELECT id FROM clients WHERE customer_id=v.cust));

-- Work orders -----------------------------------------------------------------
INSERT INTO work_orders (label, client_id, amount, status, wo_number, job_site, line_items)
SELECT v.label, (SELECT id FROM clients WHERE customer_id=v.cust), v.amount, v.status, v.won, v.site, v.items::jsonb
FROM (VALUES
  ('[Demo] Camera expansion — Verde',   'DEMO-1004', 2450.00, 'open', 'WO-2041', '7001 W Bell Rd', '[{"desc":"4MP Dome","qty":4,"price":129}]'),
  ('[Demo] Access controllers — Ironwood','DEMO-1002', 1875.00, 'paid', 'WO-2039', '88 W Baseline Rd','[{"desc":"Door controller","qty":3,"price":420}]')
) AS v(label,cust,amount,status,won,site,items)
WHERE NOT EXISTS (SELECT 1 FROM work_orders w WHERE w.label = v.label);

-- Roles, admin bulletin, vault, ticket parts ----------------------------------
INSERT INTO job_roles (name, color)
SELECT v.name, v.color FROM (VALUES
  ('[Demo] Lead Tech','#f6921e'), ('[Demo] Installer','#3b82f6'), ('[Demo] Monitoring','#16a34a'), ('[Demo] Office','#a855f7')
) AS v(name,color)
WHERE NOT EXISTS (SELECT 1 FROM job_roles r WHERE r.name = v.name);

INSERT INTO admin_posts (content, author_id, author_name)
SELECT '[Demo] Reminder: submit timesheets by Friday. New camera stock arrived.',
       (SELECT id FROM users WHERE role='admin' ORDER BY id LIMIT 1), 'Admin'
WHERE NOT EXISTS (SELECT 1 FROM admin_posts p WHERE p.content LIKE '[Demo] Reminder: submit timesheets%');

INSERT INTO vault_entries (label, username, secret, allowed_roles, created_by)
SELECT v.label, v.uname, v.secret, v.roles::text[], (SELECT id FROM users WHERE role='admin' ORDER BY id LIMIT 1)
FROM (VALUES
  ('[Demo] Verde Auto NVR',    'viewer', 'demo-not-real-1', ARRAY['admin','technician']),
  ('[Demo] Alarm.com Dealer',  'phxdealer','demo-not-real-2', ARRAY['admin'])
) AS v(label,uname,secret,roles)
WHERE NOT EXISTS (SELECT 1 FROM vault_entries e WHERE e.label = v.label);

INSERT INTO ticket_items (ticket_id, inventory_item_id, quantity, used)
SELECT (SELECT id FROM service_tickets WHERE title='[Demo] Camera 3 offline'),
       (SELECT id FROM inventory_items WHERE name='[Demo] Hikvision 4MP Dome'), 1, true
WHERE NOT EXISTS (
  SELECT 1 FROM ticket_items ti
  WHERE ti.ticket_id=(SELECT id FROM service_tickets WHERE title='[Demo] Camera 3 offline')
    AND ti.inventory_item_id=(SELECT id FROM inventory_items WHERE name='[Demo] Hikvision 4MP Dome'));

COMMIT;
