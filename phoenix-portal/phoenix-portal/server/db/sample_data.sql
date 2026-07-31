-- Sample / demo data for LOCAL look-and-feel dry runs. NOT real client data.
-- Every row is prefixed "[Demo]" so it can never be mistaken for production data.
-- Idempotent: guarded by natural keys, so re-running does not duplicate.
--   PGPASSWORD=phoenix_dev psql -h localhost -U phoenix -d phoenix_portal -f db/sample_data.sql

BEGIN;

-- Clients ---------------------------------------------------------------------
INSERT INTO clients (customer_id, name, vendor, services, monitoring_enabled, billing_amount,
                     site_address, contact_name, contact_phone, contact_email, panel_brand, camera_count)
SELECT v.* FROM (VALUES
  ('DEMO-1001','[Demo] Saguaro Dental','DMP',        ARRAY['Alarm','Cameras'],                 true,   89.00, '1420 E Camelback Rd, Phoenix, AZ',   'Dana Ruiz',  '602-555-0142','dana@saguarodental.example','DMP',      8),
  ('DEMO-1002','[Demo] Ironwood Storage','Alarm.com', ARRAY['Alarm','Access Control'],          true,  149.00, '88 W Baseline Rd, Tempe, AZ',        'Marcus Bell','480-555-0199','ops@ironwood.example',      'Qolsys',  24),
  ('DEMO-1003','[Demo] Papago Bistro','DMP',          ARRAY['Cameras'],                          false,   0.00, '3312 N Scottsdale Rd, Scottsdale, AZ','Lena Cho',   '480-555-0177','lena@papago.example',       'Hikvision',6),
  ('DEMO-1004','[Demo] Verde Auto Group','Alarm.com', ARRAY['Alarm','Cameras','Fire'],          true,  210.00, '7001 W Bell Rd, Glendale, AZ',       'Tomas Vega', '623-555-0110','tomas@verdeauto.example',   'DSC',     32)
) AS v(customer_id,name,vendor,services,monitoring_enabled,billing_amount,site_address,contact_name,contact_phone,contact_email,panel_brand,camera_count)
WHERE NOT EXISTS (SELECT 1 FROM clients c WHERE c.customer_id = v.customer_id);

-- Service tickets (linked to the demo clients) --------------------------------
INSERT INTO service_tickets (title, description, status, ticket_type, client_id)
SELECT t.title, t.description, t.status::ticket_status, t.ticket_type, c.id
FROM (VALUES
  ('[Demo] Camera 3 offline',    'NVR shows channel 3 disconnected since Monday.', 'open',        'service',    'DEMO-1001'),
  ('[Demo] Add rear door contact','Install contact + wire on new rear door.',      'in_progress', 'install',    'DEMO-1002'),
  ('[Demo] Annual inspection',   'Yearly fire / alarm inspection walk-through.',   'open',        'inspection', 'DEMO-1004'),
  ('[Demo] False alarm review',  'Recurring motion false alarms overnight.',       'resolved',    'service',    'DEMO-1003')
) AS t(title,description,status,ticket_type,customer_id)
JOIN clients c ON c.customer_id = t.customer_id
WHERE NOT EXISTS (SELECT 1 FROM service_tickets s WHERE s.title = t.title);

-- Financial records -----------------------------------------------------------
INSERT INTO financial_records (description, amount, type)
SELECT v.description, v.amount, v.type::record_type FROM (VALUES
  ('[Demo] Monthly monitoring — Saguaro Dental',   89.00, 'income'),
  ('[Demo] Monthly monitoring — Ironwood Storage', 149.00,'income'),
  ('[Demo] Camera install — Verde Auto Group',    2450.00,'income'),
  ('[Demo] Parts — Hikvision cameras (x6)',        780.00,'expense'),
  ('[Demo] Fuel — service van',                     96.40,'expense')
) AS v(description,amount,type)
WHERE NOT EXISTS (SELECT 1 FROM financial_records f WHERE f.description = v.description);

-- Inventory -------------------------------------------------------------------
INSERT INTO inventory_items (name, sku, category, quantity, min_threshold, unit, price, cost, vendor)
SELECT v.* FROM (VALUES
  ('[Demo] Hikvision 4MP Dome',       'HIK-DS2CD','Cameras',18, 5,'ea',129.00, 78.00,'Hikvision'),
  ('[Demo] DMP 1100X Wireless PIR',   'DMP-1100X','Sensors',40,10,'ea', 54.00, 31.00,'DMP'),
  ('[Demo] Cat6 Cable Box 1000ft',    'C6-1000',  'Cabling', 6, 2,'box',189.00,120.00,'Southwire'),
  ('[Demo] 12V 7Ah Battery',          'BAT-12-7', 'Power',  25, 8,'ea', 22.00, 11.00,'PowerSonic')
) AS v(name,sku,category,quantity,min_threshold,unit,price,cost,vendor)
WHERE NOT EXISTS (SELECT 1 FROM inventory_items i WHERE i.name = v.name);

-- Fleet vehicles --------------------------------------------------------------
INSERT INTO vehicles (vehicle_id, name, make, model, year, mileage, driver)
SELECT v.* FROM (VALUES
  ('DEMO-VAN-1','[Demo] Van 1 — NV200',  'Nissan','NV200',  2021,54210,'A. Tech'),
  ('DEMO-VAN-2','[Demo] Van 2 — Transit','Ford',  'Transit',2022,38900,'B. Tech'),
  ('DEMO-TRK-1','[Demo] Truck 1 — F-150','Ford',  'F-150',  2020,81200,'C. Lead')
) AS v(vehicle_id,name,make,model,year,mileage,driver)
WHERE NOT EXISTS (SELECT 1 FROM vehicles x WHERE x.vehicle_id = v.vehicle_id);

-- Projects (manual entries; shown even without Slack) --------------------------
INSERT INTO manual_projects (name, rfq, notes, completed, created_by)
SELECT v.name, v.rfq, v.notes, v.completed, (SELECT id FROM users ORDER BY id LIMIT 1)
FROM (VALUES
  ('[Demo] Verde Auto — camera expansion','RFQ-2041','Added 8 cameras to service bay + parking.', false),
  ('[Demo] Ironwood — access control upgrade','RFQ-2039','Replaced 3 door controllers.',           true)
) AS v(name,rfq,notes,completed)
WHERE NOT EXISTS (SELECT 1 FROM manual_projects m WHERE m.name = v.name);

COMMIT;
