-- Third demo seed — fills the last remaining modules for full look-and-feel.
-- "[Demo]"/"DEMO"-marked, idempotent. Run after sample_data.sql + sample_data_extra.sql.
--   PGPASSWORD=phoenix_dev psql -h localhost -U phoenix -d phoenix_portal -f db/sample_data_more.sql

BEGIN;

-- Client billing ledger (invoices / payments / expenses) ----------------------
INSERT INTO client_transactions (client_id, description, amount, type, date, customer_name)
SELECT (SELECT id FROM clients WHERE customer_id=v.cust), v.descr, v.amount, v.type, CURRENT_DATE - v.ago,
       (SELECT name FROM clients WHERE customer_id=v.cust)
FROM (VALUES
  ('DEMO-1004','[Demo] Camera install invoice', 2450.00,'invoice', 12),
  ('DEMO-1004','[Demo] Payment received',       2450.00,'payment',  4),
  ('DEMO-1001','[Demo] Monthly monitoring',        89.00,'invoice',  9),
  ('DEMO-1002','[Demo] Access upgrade invoice',  1875.00,'invoice', 20),
  ('DEMO-1002','[Demo] Partial payment',          900.00,'payment',  6)
) AS v(cust,descr,amount,type,ago)
WHERE NOT EXISTS (SELECT 1 FROM client_transactions t WHERE t.description=v.descr);

-- Per-client posts / notes ----------------------------------------------------
INSERT INTO client_posts (client_id, content, author_id, author_name)
SELECT (SELECT id FROM clients WHERE customer_id=v.cust), v.content,
       (SELECT id FROM users WHERE role='admin' ORDER BY id LIMIT 1), 'Admin'
FROM (VALUES
  ('DEMO-1001','[Demo] Gate code changed to 4471 — update techs.'),
  ('DEMO-1004','[Demo] Owner prefers morning appointments only.')
) AS v(cust,content)
WHERE NOT EXISTS (SELECT 1 FROM client_posts p WHERE p.content=v.content);

-- Ticket completion reports ---------------------------------------------------
INSERT INTO ticket_reports (ticket_id, author_id, author_name, work, parts, arrival, return_trip, photo_count)
SELECT (SELECT id FROM service_tickets WHERE title=v.title),
       (SELECT id FROM users WHERE email=v.email), v.who, v.work, v.parts, v.arr, v.ret, v.photos
FROM (VALUES
  ('[Demo] Camera install — Verde Auto','mia@phoenixsectech.com','Mia Tech','Mounted + aimed 4 dome cameras, tested NVR.','4x 4MP dome, 200ft Cat6','08:10–12:05', false, 3),
  ('[Demo] NVR drive swap — Papago','alex@phoenixsectech.com','Alex Field','Replaced failed drive, rebuilt array.','1x 4TB surveillance drive','13:00–14:30', false, 1)
) AS v(title,email,who,work,parts,arr,ret,photos)
WHERE NOT EXISTS (SELECT 1 FROM ticket_reports r WHERE r.ticket_id=(SELECT id FROM service_tickets WHERE title=v.title));

-- Project completion overrides ------------------------------------------------
INSERT INTO project_completions (name, completed, updated_at)
SELECT v.name, true, NOW() FROM (VALUES ('[Demo] Ironwood — access control upgrade')) AS v(name)
WHERE NOT EXISTS (SELECT 1 FROM project_completions p WHERE p.name=v.name);

-- Fleet invoices + inspection reports + van stock ----------------------------
INSERT INTO vehicle_invoices (vehicle_id, description, amount, invoice_date)
SELECT (SELECT id FROM vehicles WHERE vehicle_id=v.vid), v.descr, v.amount, CURRENT_DATE - v.ago
FROM (VALUES
  ('DEMO-VAN-1','[Demo] Oil change + tire rotation', 89.50, 30),
  ('DEMO-TRK-1','[Demo] Front brake pads + rotors', 412.00, 10)
) AS v(vid,descr,amount,ago)
WHERE NOT EXISTS (SELECT 1 FROM vehicle_invoices i WHERE i.description=v.descr);

INSERT INTO vehicle_reports (vehicle_id, user_id, mileage, content)
SELECT (SELECT id FROM vehicles WHERE vehicle_id=v.vid), (SELECT id FROM users WHERE email=v.email), v.mi, v.content
FROM (VALUES
  ('DEMO-VAN-1','mia@phoenixsectech.com', 54290, '[Demo] Weekly check: all good, washer fluid low.'),
  ('DEMO-TRK-1','alex@phoenixsectech.com',81260, '[Demo] Brakes feel firm after service.')
) AS v(vid,email,mi,content)
WHERE NOT EXISTS (SELECT 1 FROM vehicle_reports r WHERE r.content=v.content);

INSERT INTO vehicle_inventory (vehicle_id, inventory_item_id, quantity, notes)
SELECT (SELECT id FROM vehicles WHERE vehicle_id=v.vid), (SELECT id FROM inventory_items WHERE name=v.item), v.qty, v.notes
FROM (VALUES
  ('DEMO-VAN-1','[Demo] Hikvision 4MP Dome', 4,'[Demo] Van stock'),
  ('DEMO-VAN-1','[Demo] 12V 7Ah Battery',    6,'[Demo] Van stock'),
  ('DEMO-VAN-2','[Demo] DMP 1100X Wireless PIR', 10,'[Demo] Van stock')
) AS v(vid,item,qty,notes)
WHERE NOT EXISTS (
  SELECT 1 FROM vehicle_inventory vi
  WHERE vi.vehicle_id=(SELECT id FROM vehicles WHERE vehicle_id=v.vid)
    AND vi.inventory_item_id=(SELECT id FROM inventory_items WHERE name=v.item));

-- Work-order parts + inventory restock requests -------------------------------
INSERT INTO work_order_stock (work_order_id, inventory_item_id, quantity)
SELECT (SELECT id FROM work_orders WHERE label=v.wo), (SELECT id FROM inventory_items WHERE name=v.item), v.qty
FROM (VALUES
  ('[Demo] Camera expansion — Verde','[Demo] Hikvision 4MP Dome', 4),
  ('[Demo] Access controllers — Ironwood','[Demo] Cat6 Cable Box 1000ft', 1)
) AS v(wo,item,qty)
WHERE NOT EXISTS (
  SELECT 1 FROM work_order_stock ws
  WHERE ws.work_order_id=(SELECT id FROM work_orders WHERE label=v.wo)
    AND ws.inventory_item_id=(SELECT id FROM inventory_items WHERE name=v.item));

INSERT INTO stock_change_requests (inventory_item_id, qty, requested_by, requester_name, note, status)
SELECT (SELECT id FROM inventory_items WHERE name=v.item), v.qty,
       (SELECT id FROM users WHERE email=v.email), v.who, v.note, v.status
FROM (VALUES
  ('[Demo] Hikvision 4MP Dome','mia@phoenixsectech.com','Mia Tech', 12,'[Demo] Running low after Verde job','requested'),
  ('[Demo] 12V 7Ah Battery','alex@phoenixsectech.com','Alex Field', 20,'[Demo] Restock vans','approved')
) AS v(item,email,who,qty,note,status)
WHERE NOT EXISTS (SELECT 1 FROM stock_change_requests s WHERE s.note=v.note);

-- Dashboard snapshot + compliance + settings + rollup ------------------------
INSERT INTO snapshot_entries (type, customer, rfq, hours, notes)
SELECT v.type, v.cust, v.rfq, v.hours, v.notes FROM (VALUES
  ('project','[Demo] Verde Auto Group','RFQ-2041', 6.0,'[Demo] Camera expansion in progress'),
  ('project','[Demo] Ironwood Storage','RFQ-2039', 4.5,'[Demo] Access upgrade complete')
) AS v(type,cust,rfq,hours,notes)
WHERE NOT EXISTS (SELECT 1 FROM snapshot_entries s WHERE s.rfq=v.rfq);

INSERT INTO unmonitored_clients (name, first_seen, last_seen)
SELECT v.name, NOW()-interval '20 days', NOW()-interval '1 day' FROM (VALUES
  ('[Demo] Cactus Cafe (no contract)'), ('[Demo] Desert Ridge HOA (lapsed)')
) AS v(name)
WHERE NOT EXISTS (SELECT 1 FROM unmonitored_clients u WHERE u.name=v.name);

INSERT INTO app_settings (key, value)
SELECT v.k, v.val FROM (VALUES
  ('company_name','[Demo] Phoenix Security & Technology'),
  ('office_address','2400 W Phoenix Ave, Phoenix, AZ'),
  ('support_phone','602-555-0100')
) AS v(k,val)
WHERE NOT EXISTS (SELECT 1 FROM app_settings a WHERE a.key=v.k);

INSERT INTO client_rollups (name, created_by)
SELECT '[Demo] Scottsdale Accounts', (SELECT id FROM users WHERE role='admin' ORDER BY id LIMIT 1)
WHERE NOT EXISTS (SELECT 1 FROM client_rollups r WHERE r.name='[Demo] Scottsdale Accounts');

COMMIT;
