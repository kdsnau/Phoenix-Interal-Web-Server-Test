-- ENRICH panels from the CLEAN Phoenix Surveillance export. DRY-RUN by default (ROLLBACK).
-- For each monitoring account: set the clean name, address, and label
-- (BURG->alarm, FIRE->fire, unlabeled->access_control). Adds any account with no
-- client yet. ZERO deletes. Matches a client by its customer_id digits (e.g. 88-5418
-- -> 885418) or exact id (EL1401). Billing rows (4-digit numbers) never match.
-- Run: sudo -u postgres psql -d phoenix_portal -f server/scripts/enrich-from-clean.sql
\set ON_ERROR_STOP on
BEGIN;

CREATE TEMP TABLE acct_data(acctkey text PRIMARY KEY, name text, addr text, svcs text[]) ON COMMIT DROP;
INSERT INTO acct_data(acctkey,name,addr,svcs) VALUES
  ('130908','GLEN BNB FIRE','4238 N CRAFTSMAN CT',ARRAY['fire']::text[]),
  ('130909','PROQUAL LANDSCAPING 411/423 BLD. (BURG)','411 W ORION STREET',ARRAY['alarm']::text[]),
  ('130910','RICK GULLETTE (BURG)','1118 E MISSOURI AVE / STE #B UNIT #1',ARRAY['alarm']::text[]),
  ('130912','BUYBACK BOSS (BURG)','4405 E BASELINE RD / SUITE 123',ARRAY['alarm']::text[]),
  ('130913','ELLEN DEAN (BURG)','1118 E MISSOURI AVE / BLD B STE #3',ARRAY['alarm']::text[]),
  ('130914','I-17 AUTO CELL ACCT BURG','22230 N 24TH AVE / 22242 N',ARRAY['alarm']::text[]),
  ('130915','FLW STORAGE LLC (BURG) CELL','825 E UNIVERSITY DR',ARRAY['alarm']::text[]),
  ('130916','TORAH DAY SCHOOL (BURG)','1118 W GLENDALE AVE',ARRAY['alarm']::text[]),
  ('130917','REGINA, JAMIE: RESIDENCE (BURG)','31515 N 44TH STREET',ARRAY['alarm']::text[]),
  ('130919','FAIRYTALE BROWNIES (BURG)','4610 E COTTON CENTER BLVD STE #100',ARRAY['alarm']::text[]),
  ('131001','CARTS & PARTS (BURG) CELL','16 E JONES AVE',ARRAY['alarm']::text[]),
  ('131003','JF LONG 7136 BURG','7136 W FRIER',ARRAY['alarm']::text[]),
  ('131008','SUNBELT CLIMATE CONTROL RENTALS','3832 E ROESER RD / SUITE #110',ARRAY['access_control']::text[]),
  ('131567','BLT KITCHENS GLENDALE','6727 N 47TH AVE',ARRAY['access_control']::text[]),
  ('131568','THE PHARM: THE PHARM WILCOX (BURG)','5900 W GREENHOUSE RD',ARRAY['alarm']::text[]),
  ('131576','CORK N BOTTLE (BURG)','4101 E MCDOWELL RD',ARRAY['alarm']::text[]),
  ('131578','PAL CONSULTING: TRUMED WAREHOUSE: BURG','1621 N 40TH STREET',ARRAY['alarm']::text[]),
  ('131580','RAMEN DEEP: DAIRY QUEEN (13365 GOODYEAR) (BURG)','13365 W MCDOWELL RD.',ARRAY['alarm']::text[]),
  ('135363','RAMEN DEEP: DAIRY QUEEN (12456 N. 28TH) (BURG)','12456 N 28TH DR',ARRAY['alarm']::text[]),
  ('135365','SIERRA AUTO AUCTION (BURG)','3570 GRAND AVE',ARRAY['alarm']::text[]),
  ('135367','PAL CONSULTING: BURG : TRUMED DISPENSARY','1613 N 40TH STREET',ARRAY['alarm']::text[]),
  ('135469','RAMEN DEEP: DAIRY QUEEN(10100 LAKE PLEASANT)(BURG)','10100 W LAKE PLEASANT PKWY STE 1320',ARRAY['alarm']::text[]),
  ('135477','JF LONG PROPERTIES: JF LONG OFFICE-MAIN (BURG)','1118 E MISSOURI AVE STE A1 [RADIO]',ARRAY['alarm']::text[]),
  ('135479','JF LONG PROPERTIES: BUILDING "B" (BURG)','1118 E MISSOURI AVE / BLDG B STE #2',ARRAY['alarm']::text[]),
  ('137877','PROQUAL LANDSCAPING 402 BLD. (BURG)','402 W ORION STREET',ARRAY['alarm']::text[]),
  ('137879','ARIZONA PROFESSIONAL PAINTING (BURG)','5424 S 39TH STREET',ARRAY['alarm']::text[]),
  ('137884','CULVERS-JACOB: CULVERS (QUEEN CREEK) (BURG)','140 W OCOTILLO RD',ARRAY['alarm']::text[]),
  ('139941','BLT MODERN TORTILLA (BURG)','739 E DUNLAP AVE',ARRAY['alarm']::text[]),
  ('139942','THE PHARM: SUNDAY GOODS (1616 GLENDALE) (FIRE)','1616 E GLENDALE',ARRAY['fire']::text[]),
  ('139943','PAL CONSULTING: BURG : 15TH AVE GROW','2315 S 15TH AVENUE',ARRAY['alarm']::text[]),
  ('139946','JF LONG PROPERTIES: JFL 7130 (FIRE)','7130 W. FRIER DR.',ARRAY['fire']::text[]),
  ('139947','PAL CONSULTING: BURG : 2937 GROW','2937 WEST THOMAS RD',ARRAY['alarm']::text[]),
  ('139952','PAL CONSULTING: BURG : 3006 OFFICE','3006 W. THOMAS RD',ARRAY['alarm']::text[]),
  ('139954','PAL CONSULTING: BURG : 2929 GROW','2929 WEST THOMAS',ARRAY['alarm']::text[]),
  ('386071','DADAM, JEFF','3801 E WELDON AVE',ARRAY['access_control']::text[]),
  ('386073','DADAM, JEFF - GUEST HOUSE','3801 E WELDON AVE',ARRAY['access_control']::text[]),
  ('386079','RAMEN DEEP: DAIRY QUEEN (3308 BASELINE) (FIRE)','3308 EAST BASELINE ROAD',ARRAY['fire']::text[]),
  ('386082','FLORA-TECH (FIRE)','291 E EL PRADO CT',ARRAY['fire']::text[]),
  ('386093','DESERT LAKES APTS: MAINTENANCE (BURG)','8245 N 27TH AVE',ARRAY['alarm']::text[]),
  ('386098','JF LONG PROPERTIES: JF LONG OFFICE- MAIN - (FIRE)','1118 E. MISSOURI AVE.',ARRAY['fire']::text[]),
  ('386100','COMPASS CHURCH (FIRE)','1825 S ALMA SCHOOL RD',ARRAY['fire']::text[]),
  ('386111','ELONTEC-NEW BLDG OWNER (BURG)','116 W MCDOWELL RD',ARRAY['alarm']::text[]),
  ('386131','ELONTEC-NEW BLDG OWNER (FIRE)','116 W MCDOWELL RD',ARRAY['fire']::text[]),
  ('386134','JF LONG PROPERTIES: JFL 7136 (FIRE)','7136 W FRIER DR',ARRAY['fire']::text[]),
  ('386140','CLAYTON-RAMON HOLDINGS (BURG)','116 W MCDOWELL RD / SUITE 101',ARRAY['alarm']::text[]),
  ('883768','JF LONG PROPERTIES: JFL 7130 (BURG)','7130 W FRIER DR',ARRAY['alarm']::text[]),
  ('883786','THE PHARM: SUNDAY GOODS TEMPE (FIRE)','723 N SCOTTSDALE RD',ARRAY['fire']::text[]),
  ('883789','THE PHARM: SUNDAY GOODS TEMPE (BURG)','723 N SCOTTSDALE RD',ARRAY['alarm']::text[]),
  ('884854','BLICK ART MATERIALS (FIRE)','17520 N 75TH AVE',ARRAY['fire']::text[]),
  ('884855','OSG BILLING (FIRE)','415 W GUADALUPE RD',ARRAY['fire']::text[]),
  ('884857','MAAX SPAS (FIRE)','25605 S ARIZONA AVE',ARRAY['fire']::text[]),
  ('884863','ACHEN-GARNER CONSTRUCTION LLC','2195 W CHANDLER BLVD',ARRAY['access_control']::text[]),
  ('884865','BILTMORE ENT','1010 E MCDOWELL RD',ARRAY['access_control']::text[]),
  ('884874','CLARK, DAMIEN','633 W SOUTHERN AVE / #1197',ARRAY['access_control']::text[]),
  ('884892','FORESIGHT TECHNOLOGIES PRIEST','3001 S PRIEST DRIVE',ARRAY['access_control']::text[]),
  ('884893','DP CONSULTING FIRE','2395 W UTOPIA RD',ARRAY['fire']::text[]),
  ('884895','STSS RECYCLING (39TH & BUCKEYE)','1645 S 39TH AVE',ARRAY['access_control']::text[]),
  ('884904','STSS 63RD AVENUE STE 105','1015 S 63RD AVE #105',ARRAY['access_control']::text[]),
  ('884910','ICM DOCUMENTS WAREHOUSE','4214 S 36TH ST',ARRAY['access_control']::text[]),
  ('884911','ASSA ABLOY ANNEX BUILDING','15175 S 50TH ST / #150',ARRAY['access_control']::text[]),
  ('884912','ALLIANCE PLUMBING','2626 E ELWOOD ST',ARRAY['access_control']::text[]),
  ('884919','SONOVISION DOWNTOWN','300 W CLARENDON AVE / 320',ARRAY['access_control']::text[]),
  ('884921','SHERIDAN, JOHN','8261 E MONTE VISTA',ARRAY['access_control']::text[]),
  ('884936','DRINIQUE','5720 S. 40TH STREET STE #3',ARRAY['access_control']::text[]),
  ('884940','HELLAS CONSTRUCTION','3841 E SUPERIOR AVE',ARRAY['access_control']::text[]),
  ('884964','VERDE INDUSTRIES (BURG)','3812 WEST WASHINGTON ST',ARRAY['alarm']::text[]),
  ('884972','EVENT RENTS PHOENIX','5444 WEST ROOSEVELT STREET / SUITE 100',ARRAY['access_control']::text[]),
  ('885402','JUPITER RESEARCH (BURG)','7655 E. REDFIELD RD',ARRAY['alarm']::text[]),
  ('885403','PHOENIX SURVEILLANCE OFFICE','4001 E BROADWAY RD STE B15',ARRAY['access_control']::text[]),
  ('885404','HOSKINS EQUIPMENT (FIRE)','3737 EAST BROADWAY RD',ARRAY['fire']::text[]),
  ('885405','IIAB (BURG)','333 E FLOWER STREET',ARRAY['alarm']::text[]),
  ('885406','THE PHARM: SUNDAY GOODS (1616 GLENDALE) (BURG)','1616 E GLENDALE AVE',ARRAY['alarm']::text[]),
  ('885414','I SMOKE (SHEA) (BURG)','7119 E SHEA BLVD / SUITE 109',ARRAY['alarm']::text[]),
  ('885417','ASSA ABLOY (BURG)','10027 S 51ST STREET #102',ARRAY['alarm']::text[]),
  ('885418','APD POWER CENTER (BURG)','412 W GEMINI DR',ARRAY['alarm']::text[]),
  ('885420','OSG BILLING BURGLARY','415 W GUADALUPE RD',ARRAY['alarm']::text[]),
  ('885421','FLW STORAGE LLC (FIRE)','825 E UNIVERSITY AVE',ARRAY['fire']::text[]),
  ('885422','STSS RECYCLING (BURG) STE 103','1015 S 63RD AVE. STE 103',ARRAY['alarm']::text[]),
  ('885423','ICM DOCUMENT SOLUTIONS (BURG)','4100 E BROADWAY RD / #180',ARRAY['alarm']::text[]),
  ('885427','RAYO WHOLE SALE PHOENIX (BURG)','2633 N 36TH AVE',ARRAY['alarm']::text[]),
  ('885429','GG&D MOTOR VEHICLE SERVICES:1120 CNTRY CLUB (BURG)','1120 S. COUNTRY CLUB DR. #101',ARRAY['alarm']::text[]),
  ('885430','GG&D MOTOR VEHICLE SERV. 6601 W. INDI SCH. (BURG)','6601 W INDIAN SCHOOL STE 20',ARRAY['alarm']::text[]),
  ('885431','GG&D MOTOR VEHICLE SERVICES: 4307 GLENDALE (BURG)','4307 W GLENDALE',ARRAY['alarm']::text[]),
  ('885432','GG&D MOTOR VEHICLE SERVICES (BURG)','1625 E INDIAN SCHOOL RD SUITE A',ARRAY['alarm']::text[]),
  ('885433','GG&D MOTOR VEHICLE SERVICES: 2302 BELL (BURG)','2302 E BELL RD',ARRAY['alarm']::text[]),
  ('885435','GG&D MOTOR VEHICLE SERVICES 7207 S CENTRAL','7207 SOUTH CENTRAL',ARRAY['access_control']::text[]),
  ('885436','GG&D MOTOR VEHICLE SERVICES 1625 INDIAN SCHOOL)','1625 E INDIAN SCHOOL RD / SUITE B & C',ARRAY['access_control']::text[]),
  ('885437','PRUEDHOMME, DAVID -DP CONSULTING(RESIDENTIAL-BURG)','16636 N 40TH PL',ARRAY['alarm']::text[]),
  ('885442','ENVOY DATA','8444 N. 90TH STREET / SUITE 125',ARRAY['access_control']::text[]),
  ('885446','VERDE INDUSTRIES 3820 (FIRE)','3820 W. WASHINGTON ST',ARRAY['fire']::text[]),
  ('885447','VERDE INDUSTRIES 3812 (FIRE)','3812 W. WASHINGTON',ARRAY['fire']::text[]),
  ('885448','RECONSERVE ARIZONA (BURG)','1704 W BROADWAY RD.',ARRAY['alarm']::text[]),
  ('885902','FORESIGHT 1301 (BURG)','1301 W GENEVA DR.',ARRAY['alarm']::text[]),
  ('885906','DESERT APPEAL (BURG)','2802 E ILLINI ST',ARRAY['alarm']::text[]),
  ('885907','RAMEN DEEP: DAIRY QUEEN GOODYEAR (FIRE)','13365 W MCDOWELL RD',ARRAY['fire']::text[]),
  ('885913','PAL CONSULTING: FIRE : 2937 GROW','2937 WEST THOMAS RD',ARRAY['fire']::text[]),
  ('885914','PAL CONSULTING: FIRE : 2929 GROW','2929 WEST THOMAS',ARRAY['fire']::text[]),
  ('885915','PAL CONSULTING: FIRE : 15TH AVE GROW','2315 SOUTH 15TH AVENUE',ARRAY['fire']::text[]),
  ('885932','GG&D MOTOR VEHICLE SERVICES BELL RD','8155 W. BELL ROAD / SUITE 114',ARRAY['access_control']::text[]),
  ('885935','THE PHARM: SUNDAY GOODS SURPRISE (BURG)','13150 W BELL RD',ARRAY['alarm']::text[]),
  ('885939','VERDE INDUSTRIES 3820 (BURG)','3820 W. WASHINGTON STREET',ARRAY['alarm']::text[]),
  ('885943','CULVERS ELLSWORTH','23651 S ELLSWORTH RD',ARRAY['access_control']::text[]),
  ('885945','TREK BICYCLE','13810 W. TEST DR.',ARRAY['access_control']::text[]),
  ('885950','MCFADDEN DALE INDUSTRIAL HARDWARE','4647 S 32ND ST.',ARRAY['access_control']::text[]),
  ('885951','MCFADDEN DALE INDUSTRIAL HARDWARE "FIRE"','4647 S. 32ND STREET',ARRAY['fire']::text[]),
  ('885952','DUSKIN, APRIL','24691 N 169TH AVE.',ARRAY['access_control']::text[]),
  ('885955','JEEP FARM (BURG) [NEW}','22201 N 24TH AVE',ARRAY['alarm']::text[]),
  ('885957','THE PHARM DISTRIBUTION CENTER','4417 W BUCKEYE RD',ARRAY['access_control']::text[]),
  ('885967','CUNNINGHAM LAW FIRM','330 N 2ND AVE',ARRAY['access_control']::text[]),
  ('885969','THE PHARM: CONSUME SHOW LOW (BURG)','1350 N PENROD RD',ARRAY['alarm']::text[]),
  ('935026','MAAX SPAS (BURG)','25605 S ARIZONA AVE',ARRAY['alarm']::text[]),
  ('EL1401','FLORA-TECH (ELEVATOR)','291 E EL PRADO CT',ARRAY['access_control']::text[]),
  ('EL1719','FORESIGHT - ELEVATOR - PRIEST','3001 S PRIEST DRIVE',ARRAY['access_control']::text[]);

CREATE TEMP TABLE pcli ON COMMIT DROP AS
SELECT c.id, c.name AS old_name, c.services AS old_svcs, a.acctkey, a.name AS new_name, a.addr, a.svcs
FROM clients c JOIN acct_data a ON (regexp_replace(c.customer_id, '[^0-9]', '', 'g') = a.acctkey OR c.customer_id = a.acctkey);

\echo ''
\echo '=== coverage ==='
SELECT (SELECT count(*) FROM acct_data)  AS audit_accounts,
       (SELECT count(*) FROM pcli)        AS matched_in_db,
       (SELECT count(*) FROM acct_data a WHERE NOT EXISTS
          (SELECT 1 FROM clients c WHERE (regexp_replace(c.customer_id, '[^0-9]', '', 'g') = a.acctkey OR c.customer_id = a.acctkey))) AS missing_to_add;

\echo ''
\echo '=== name changes (mangled -> clean), sample 30 ==='
SELECT acctkey, left(old_name,34) AS old_name, left(new_name,40) AS new_clean_name, array_to_string(svcs,',') AS label
FROM pcli WHERE old_name IS DISTINCT FROM new_name ORDER BY acctkey LIMIT 30;

-- ===================== APPLY (no deletes) =====================
UPDATE clients c SET name = p.new_name, site_address = p.addr, services = p.svcs
FROM pcli p WHERE c.id = p.id;

INSERT INTO clients (name, customer_id, vendor, services, site_address, monitoring_enabled)
SELECT a.name, a.acctkey, 'generic', a.svcs, a.addr, FALSE
FROM acct_data a
WHERE NOT EXISTS (SELECT 1 FROM clients c WHERE (regexp_replace(c.customer_id, '[^0-9]', '', 'g') = a.acctkey OR c.customer_id = a.acctkey));

\echo ''
\echo '=== AFTER ==='
SELECT count(*) AS clients,
       count(*) FILTER (WHERE 'alarm'          = ANY(services)) AS alarm,
       count(*) FILTER (WHERE 'fire'           = ANY(services)) AS fire,
       count(*) FILTER (WHERE 'access_control' = ANY(services)) AS access
FROM clients;

ROLLBACK;  -- <<< change to COMMIT and re-run to apply
