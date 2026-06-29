-- rebuild-clients.sql  (DRY-RUN: ends in ROLLBACK)
-- In-place reconcile of the clients table. Generated from the invoice-folder
-- customer master + monitoring export + number-match worksheet.
--   * keeps all 52 billing anchors + monitored panels
--   * stamps the shared QuickBooks customer_number on 168 rows
--   * deletes 17 junk rows: the mangled-audit block (ids 1051-1076,
--     all verified 0 children) + Office Test Panel XR550 (id 46)
--   * syncs monitoring_enabled to the client_monitoring table
-- Billing (client_transactions) and monitoring are never detached.
-- To APPLY: pipe through sed to flip ROLLBACK->COMMIT:
--   sed 's/^ROLLBACK;.*/COMMIT;/' server/scripts/rebuild-clients.sql | sudo -u postgres psql -d phoenix_portal
-- To DRY-RUN: sudo -u postgres psql -d phoenix_portal -f server/scripts/rebuild-clients.sql

BEGIN;

-- before snapshot
SELECT 'BEFORE' phase, count(*) clients,
       count(*) FILTER (WHERE monitoring_enabled) monitored
  FROM clients;

-- 0) canonical customer number column
ALTER TABLE clients ADD COLUMN IF NOT EXISTS customer_number text;

-- 1) stamp customer_number (shared across a customer's anchor + panel rows)
UPDATE clients c SET customer_number = v.num
FROM (VALUES
  (1,'1872'),
  (2,'1888'),
  (3,'1755'),
  (4,'1274'),
  (5,'1455'),
  (6,'1455'),
  (7,'1875'),
  (8,'1866'),
  (9,'1692'),
  (10,'1692'),
  (12,'1953'),
  (13,'1909'),
  (14,'1288'),
  (15,'1399'),
  (16,'1288'),
  (17,'1897'),
  (18,'1709'),
  (19,'1867'),
  (21,'1881'),
  (22,'1881'),
  (23,'1825'),
  (24,'1825'),
  (25,'1825'),
  (26,'1825'),
  (27,'1825'),
  (28,'1825'),
  (29,'1825'),
  (30,'1825'),
  (31,'1899'),
  (32,'962'),
  (33,'1591'),
  (34,'1617'),
  (35,'1573'),
  (36,'1573'),
  (37,'532'),
  (38,'1911'),
  (39,'1762'),
  (40,'716'),
  (42,'1650'),
  (43,'1218'),
  (44,'1939'),
  (47,'1320'),
  (53,'1874'),
  (54,'595'),
  (57,'1794'),
  (58,'1862'),
  (59,'1813'),
  (60,'1423'),
  (61,'1423'),
  (62,'1423'),
  (63,'1408'),
  (65,'1408'),
  (66,'1408'),
  (67,'1408'),
  (68,'1891'),
  (69,'1930'),
  (70,'1683'),
  (71,'1016'),
  (72,'1016'),
  (73,'1016'),
  (76,'1500'),
  (77,'1507'),
  (78,'1526'),
  (79,'1533'),
  (80,'1076'),
  (81,'1948'),
  (82,'1531'),
  (84,'1537'),
  (85,'896'),
  (86,'716'),
  (87,'915'),
  (88,'1692'),
  (89,'1408'),
  (90,'1265'),
  (91,'1112'),
  (92,'1565'),
  (93,'1565'),
  (94,'1317'),
  (95,'1112'),
  (96,'1565'),
  (97,'716'),
  (98,'716'),
  (99,'1500'),
  (100,'1577'),
  (101,'1588'),
  (104,'1112'),
  (106,'1112'),
  (107,'1112'),
  (108,'1112'),
  (109,'1894'),
  (110,'1894'),
  (111,'1565'),
  (112,'1638'),
  (113,'1246'),
  (115,'1611'),
  (116,'1940'),
  (120,'1408'),
  (121,'1408'),
  (124,'1638'),
  (125,'1881'),
  (148,'1408'),
  (149,'716'),
  (150,'716'),
  (151,'1940'),
  (152,'716'),
  (153,'1408'),
  (154,'1320'),
  (155,'1948'),
  (156,'1565'),
  (157,'1112'),
  (158,'1112'),
  (159,'1112'),
  (160,'1016'),
  (161,'1939'),
  (162,'1408'),
  (163,'1218'),
  (178,'1016'),
  (235,'1076'),
  (271,'1112'),
  (369,'1218'),
  (394,'1246'),
  (412,'1265'),
  (435,'1288'),
  (461,'1317'),
  (464,'1320'),
  (538,'1399'),
  (546,'1408'),
  (559,'1423'),
  (579,'1443'),
  (591,'1455'),
  (595,'1500'),
  (602,'1507'),
  (609,'1514'),
  (621,'1526'),
  (626,'1531'),
  (628,'1533'),
  (632,'1537'),
  (668,'1573'),
  (672,'1577'),
  (683,'1588'),
  (706,'1611'),
  (711,'1617'),
  (732,'1638'),
  (744,'1650'),
  (787,'1692'),
  (804,'1709'),
  (808,'1713'),
  (849,'1755'),
  (856,'1762'),
  (887,'1794'),
  (906,'1813'),
  (917,'1825'),
  (953,'1862'),
  (957,'1866'),
  (958,'1867'),
  (963,'1872'),
  (966,'1875'),
  (972,'1881'),
  (979,'1888'),
  (985,'1894'),
  (988,'1897'),
  (990,'1899'),
  (996,'1905'),
  (997,'1906'),
  (1000,'1909'),
  (1021,'1930'),
  (1030,'1939'),
  (1044,'1953')
) AS v(id, num)
WHERE c.id = v.id;

-- 2) delete mangled-audit junk + test panel (all verified 0 monitoring/txn/wo/dmp)
DELETE FROM clients WHERE id IN (46,1051,1052,1053,1054,1055,1056,1057,1068,1069,1070,1071,1072,1073,1074,1075,1076);

-- 3) sync monitoring flag to the monitoring table (source of truth)
UPDATE clients SET monitoring_enabled = true
 WHERE id IN (SELECT client_id FROM client_monitoring);

-- ===== verification =====
SELECT 'AFTER' phase, count(*) clients,
       count(*) FILTER (WHERE monitoring_enabled) monitored,
       count(*) FILTER (WHERE customer_number IS NOT NULL) with_number,
       count(*) FILTER (WHERE customer_number IS NULL) no_number,
       count(DISTINCT customer_number) distinct_customers
  FROM clients;

-- billing must be untouched (expect 156)
SELECT 'transactions' k, count(*) FROM client_transactions;

-- rows left WITHOUT a number (should be the ~13 genuine residential/unknown + Culvers + your office)
SELECT id, customer_id, left(name,46) AS name, services
  FROM clients WHERE customer_number IS NULL ORDER BY name;

-- any customer_number carried by more than one billing-anchor row (true customer-level dup to eyeball)
SELECT customer_number, count(*) anchors
  FROM clients WHERE coalesce(array_length(services,1),0)=0 AND customer_number IS NOT NULL
  GROUP BY customer_number HAVING count(*)>1 ORDER BY 2 DESC;

ROLLBACK;  -- flip to COMMIT to apply
