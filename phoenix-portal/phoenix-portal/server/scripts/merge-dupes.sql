-- MERGE duplicate client rows into one per customer. DRY-RUN by default (ROLLBACK).
-- Keeps a survivor (the clean-numbered row, else lowest id), unions its services with the
-- audit's authoritative labels, gives it monitoring, re-points tickets/invoices/work-orders/
-- dmp onto it, then deletes the now-empty panel rows. Monitoring is added to the survivor
-- BEFORE any delete, so it can never be lost.
-- Run: sudo -u postgres psql -d phoenix_portal -f server/scripts/merge-dupes.sql
\set ON_ERROR_STOP on
BEGIN;

CREATE TEMP TABLE mon_map(mon text PRIMARY KEY, cust text) ON COMMIT DROP;
INSERT INTO mon_map(mon,cust) VALUES
  ('884863','1872'),
  ('884912','1888'),
  ('885418','1755'),
  ('137879','1577'),
  ('885417','1455'),
  ('884911','1455'),
  ('884865','1875'),
  ('131567','1692'),
  ('139941','1692'),
  ('884854','1866'),
  ('130912','1523'),
  ('386276','896'),
  ('884874','1909'),
  ('386100','1611'),
  ('131576','1265'),
  ('137884','588'),
  ('885943','588'),
  ('386071','1894'),
  ('386073','1894'),
  ('386093','1246'),
  ('884893','1288'),
  ('884936','1897'),
  ('885906','1399'),
  ('130913','1533'),
  ('885442','1709'),
  ('884972','1867'),
  ('885404','1906'),
  ('130919','1537'),
  ('139945','1713'),
  ('386072','1713'),
  ('386082','1638'),
  ('884892','1881'),
  ('885902','1881'),
  ('885430','1825'),
  ('885432','1825'),
  ('885436','1825'),
  ('885435','1825'),
  ('885932','1825'),
  ('885429','1825'),
  ('885433','1825'),
  ('885431','1825'),
  ('884940','1899'),
  ('885414','1617'),
  ('885407','1617'),
  ('885423','1573'),
  ('884910','1573'),
  ('885405','532'),
  ('885419','1762'),
  ('135479','716'),
  ('386098','716'),
  ('883768','716'),
  ('139946','716'),
  ('386133','716'),
  ('386134','716'),
  ('131003','716'),
  ('135477','716'),
  ('885402','1650'),
  ('884857','1218'),
  ('935026','1218'),
  ('884967','1905'),
  ('885420','1320'),
  ('884855','1320'),
  ('135367','1112'),
  ('131578','1112'),
  ('885915','1112'),
  ('885914','1112'),
  ('885913','1112'),
  ('139943','1112'),
  ('139954','1112'),
  ('139947','1112'),
  ('139952','1112'),
  ('885421','823'),
  ('130918','823'),
  ('130915','823'),
  ('130909','1500'),
  ('885437','1288'),
  ('386079','668'),
  ('885409','668'),
  ('135469','668'),
  ('135363','668'),
  ('131580','668'),
  ('885907','668'),
  ('885427','1794'),
  ('885448','1862'),
  ('130910','1507'),
  ('130914','1076'),
  ('884919','1813'),
  ('135365','1317'),
  ('884904','1423'),
  ('884895','1423'),
  ('885422','1423'),
  ('131008','1443'),
  ('139942','1408'),
  ('883789','1408'),
  ('883786','1408'),
  ('885406','1408'),
  ('885935','1408'),
  ('131568','1408'),
  ('130916','1531'),
  ('885945','1930'),
  ('884964','1016'),
  ('885447','1016'),
  ('885939','1016'),
  ('885446','1016'),
  ('88590','1939'),
  ('885951','1939'),
  ('137877','1500'),
  ('884971','1923'),
  ('386111','1443'),
  ('386131','1443'),
  ('386140','1443'),
  ('884901','1765'),
  ('131701','1765'),
  ('885955','1762'),
  ('885967','1953'),
  ('885969','1408'),
  ('130917','1514');

CREATE TEMP TABLE aud_lab(cust text, svc text) ON COMMIT DROP;
INSERT INTO aud_lab(cust,svc) VALUES
  ('1755','alarm'),
  ('1577','alarm'),
  ('1455','alarm'),
  ('1692','alarm'),
  ('1866','fire'),
  ('1523','alarm'),
  ('896','alarm'),
  ('1611','fire'),
  ('1265','alarm'),
  ('588','alarm'),
  ('1246','alarm'),
  ('1288','alarm'),
  ('1399','alarm'),
  ('1533','alarm'),
  ('1906','fire'),
  ('1537','alarm'),
  ('1713','alarm'),
  ('1713','fire'),
  ('1638','fire'),
  ('1881','alarm'),
  ('1825','alarm'),
  ('1617','alarm'),
  ('1573','alarm'),
  ('532','alarm'),
  ('1762','alarm'),
  ('716','alarm'),
  ('716','fire'),
  ('1650','alarm'),
  ('1218','fire'),
  ('1218','alarm'),
  ('1320','fire'),
  ('823','fire'),
  ('1500','alarm'),
  ('668','fire'),
  ('668','alarm'),
  ('1794','alarm'),
  ('1862','alarm'),
  ('1507','alarm'),
  ('1317','alarm'),
  ('1423','alarm'),
  ('1443','alarm'),
  ('1443','fire'),
  ('1408','fire'),
  ('1408','alarm'),
  ('1531','alarm'),
  ('1016','alarm'),
  ('1016','fire'),
  ('1939','alarm'),
  ('1939','fire'),
  ('1588','alarm'),
  ('1765','alarm'),
  ('1526','alarm'),
  ('1514','alarm');

CREATE TEMP TABLE cli ON COMMIT DROP AS
SELECT c.id, c.customer_id, c.services,
       COALESCE(m.cust, regexp_replace(c.customer_id, '[^0-9]', '', 'g')) AS real_num
FROM clients c LEFT JOIN mon_map m ON m.mon = regexp_replace(c.customer_id, '[^0-9]', '', 'g');

CREATE TEMP TABLE surv ON COMMIT DROP AS
SELECT DISTINCT ON (real_num) real_num, id AS survivor_id, customer_id AS survivor_cid
FROM cli ORDER BY real_num, (customer_id = real_num) DESC, id;

-- target services per customer = union(existing across the group) + audit labels
CREATE TEMP TABLE tgt ON COMMIT DROP AS
SELECT rn.real_num,
  ARRAY(SELECT DISTINCT s FROM (
     SELECT unnest(c.services) AS s FROM clients c JOIN cli ON cli.id = c.id AND cli.real_num = rn.real_num
     UNION
     SELECT svc FROM aud_lab WHERE cust = rn.real_num
  ) u WHERE s IS NOT NULL ORDER BY s) AS services
FROM (SELECT DISTINCT real_num FROM cli) rn;

CREATE TEMP TABLE losers ON COMMIT DROP AS
SELECT l.id FROM cli l JOIN surv s ON s.real_num = l.real_num WHERE l.id <> s.survivor_id;

\echo ''
\echo '=== BEFORE ==='
SELECT count(*) AS clients, count(*) FILTER (WHERE array_length(services,1)>0) AS labeled FROM clients;

\echo ''
\echo '=== MERGES (customers with >1 row) — survivor, final labels, rows removed ==='
SELECT s.real_num, s.survivor_id,
       array_to_string(t.services, ',') AS final_services,
       (SELECT count(*) FROM cli l WHERE l.real_num = s.real_num AND l.id <> s.survivor_id) AS rows_removed
FROM surv s JOIN tgt t ON t.real_num = s.real_num
WHERE (SELECT count(*) FROM cli l2 WHERE l2.real_num = s.real_num) > 1
ORDER BY s.real_num;

-- ============================ APPLY ============================
-- 1. renumber a survivor that is itself a panel row (no clean twin) to the real number
UPDATE clients c SET customer_id = s.real_num
FROM surv s WHERE c.id = s.survivor_id AND c.customer_id <> s.real_num
  AND NOT EXISTS (SELECT 1 FROM clients o WHERE o.customer_id = s.real_num AND o.id <> c.id);

-- 2. label survivors with the corrected union (also fixes singletons per the audit)
UPDATE clients c SET services = t.services
FROM surv s JOIN tgt t ON t.real_num = s.real_num
WHERE c.id = s.survivor_id AND c.services IS DISTINCT FROM t.services;

-- 3. ensure the survivor carries monitoring if ANY row in its group did (BEFORE deletes)
INSERT INTO client_monitoring (client_id, next_email_at)
SELECT s.survivor_id, NOW() + INTERVAL '7 days'
FROM surv s
WHERE EXISTS (SELECT 1 FROM cli l JOIN client_monitoring cm ON cm.client_id = l.id WHERE l.real_num = s.real_num)
ON CONFLICT (client_id) DO NOTHING;

-- 4. re-point children from losers onto their survivor
UPDATE service_tickets     x SET client_id = s.survivor_id FROM cli l JOIN surv s ON s.real_num = l.real_num WHERE x.client_id = l.id AND l.id <> s.survivor_id;
UPDATE client_transactions x SET client_id = s.survivor_id FROM cli l JOIN surv s ON s.real_num = l.real_num WHERE x.client_id = l.id AND l.id <> s.survivor_id;
UPDATE work_orders         x SET client_id = s.survivor_id FROM cli l JOIN surv s ON s.real_num = l.real_num WHERE x.client_id = l.id AND l.id <> s.survivor_id;
UPDATE dmp_accounts        x SET client_id = s.survivor_id FROM cli l JOIN surv s ON s.real_num = l.real_num WHERE x.client_id = l.id AND l.id <> s.survivor_id;

-- 5. now that the survivor is labeled, monitored, and owns the children, drop the panels
DELETE FROM client_monitoring WHERE client_id IN (SELECT id FROM losers);
DELETE FROM clients           WHERE id IN (SELECT id FROM losers);

\echo ''
\echo '=== AFTER ==='
SELECT count(*) AS clients, count(*) FILTER (WHERE array_length(services,1)>0) AS labeled FROM clients;

ROLLBACK;  -- <<< change to COMMIT and re-run to apply
