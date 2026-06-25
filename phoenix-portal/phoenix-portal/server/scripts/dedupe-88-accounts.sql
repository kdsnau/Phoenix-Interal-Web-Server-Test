-- One-time cleanup: collapse per-monitoring-account client rows (88-XXXX etc.)
-- back onto their real customer number. DRY-RUN by default (ends in ROLLBACK).
-- Review the output, then change the final ROLLBACK to COMMIT and re-run to apply.
-- Run: sudo -u postgres psql -d phoenix_portal -f server/scripts/dedupe-88-accounts.sql
-- Generated from "alarm audit(1).xlsx" with 117 monitoring-account mappings.
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

-- Account-keyed rows = clients whose customer_id digits equal a monitoring account.
CREATE TEMP TABLE plan ON COMMIT DROP AS
SELECT c.id, c.name, c.customer_id, m.cust AS real_num,
       EXISTS (SELECT 1 FROM clients r WHERE r.customer_id = m.cust AND r.id <> c.id) AS real_exists,
       row_number() OVER (PARTITION BY m.cust ORDER BY c.id) AS rn
FROM clients c
JOIN mon_map m ON m.mon = regexp_replace(c.customer_id, '[^0-9]', '', 'g');

\echo ''
\echo '=== PLAN (what will happen) ==='
SELECT CASE WHEN real_exists THEN 'DELETE (dup of '||real_num||')'
            WHEN rn = 1      THEN 'RENUMBER -> '||real_num
            ELSE 'DELETE (extra acct for '||real_num||')' END AS action,
       customer_id, real_num, name
FROM plan ORDER BY 1, real_num;

\echo ''
\echo '=== 88-style rows NOT covered by the audit (left untouched - review) ==='
SELECT customer_id, name FROM clients
WHERE (customer_id LIKE '88-%' OR (customer_id ~ '^88' AND length(customer_id) = 6))
  AND regexp_replace(customer_id, '[^0-9]', '', 'g') NOT IN (SELECT mon FROM mon_map);

UPDATE clients SET customer_id = p.real_num
  FROM plan p WHERE clients.id = p.id AND NOT p.real_exists AND p.rn = 1;
DELETE FROM clients USING plan p
  WHERE clients.id = p.id AND (p.real_exists OR p.rn > 1);

\echo ''
\echo '=== SUMMARY ==='
SELECT (SELECT count(*) FROM plan WHERE real_exists OR rn > 1)      AS deleted,
       (SELECT count(*) FROM plan WHERE NOT real_exists AND rn = 1) AS renumbered,
       (SELECT count(*) FROM clients)                              AS clients_after;

ROLLBACK;  -- <<< change to COMMIT and re-run to apply
