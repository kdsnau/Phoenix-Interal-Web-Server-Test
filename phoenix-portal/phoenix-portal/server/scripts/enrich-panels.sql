-- ENRICH per-panel clients from the audit. DRY-RUN by default (ROLLBACK). ZERO deletes.
-- Matches a client to a monitoring account by its customer_id digits, then corrects the
-- alarm/fire label and fills the address; adds any audit account with no client yet.
-- Billing rows (4-digit customer numbers) and non-monitored customers are never matched.
-- Run: sudo -u postgres psql -d phoenix_portal -f server/scripts/enrich-panels.sql
\set ON_ERROR_STOP on
BEGIN;

CREATE TEMP TABLE mon_lab(mon text, svc text) ON COMMIT DROP;
INSERT INTO mon_lab(mon,svc) VALUES
  ('885418','alarm'),
  ('137879','alarm'),
  ('885417','alarm'),
  ('139941','alarm'),
  ('884854','fire'),
  ('130912','alarm'),
  ('386276','alarm'),
  ('386100','fire'),
  ('131576','alarm'),
  ('137884','alarm'),
  ('885943','alarm'),
  ('386093','alarm'),
  ('884893','fire'),
  ('885906','alarm'),
  ('130913','alarm'),
  ('885404','fire'),
  ('130919','alarm'),
  ('139945','alarm'),
  ('386072','fire'),
  ('386082','fire'),
  ('885902','alarm'),
  ('885430','alarm'),
  ('885432','alarm'),
  ('885429','alarm'),
  ('885433','alarm'),
  ('885431','alarm'),
  ('885414','alarm'),
  ('885407','alarm'),
  ('885423','alarm'),
  ('885405','alarm'),
  ('130917','alarm'),
  ('885419','alarm'),
  ('135479','alarm'),
  ('386098','fire'),
  ('883768','alarm'),
  ('139946','fire'),
  ('386133','alarm'),
  ('386134','fire'),
  ('131003','alarm'),
  ('135477','alarm'),
  ('885402','alarm'),
  ('884857','fire'),
  ('935026','alarm'),
  ('885420','alarm'),
  ('884855','fire'),
  ('135367','alarm'),
  ('131578','alarm'),
  ('885915','fire'),
  ('885914','fire'),
  ('885913','fire'),
  ('139943','alarm'),
  ('139954','alarm'),
  ('139947','alarm'),
  ('139952','alarm'),
  ('885421','fire'),
  ('130915','alarm'),
  ('130909','alarm'),
  ('885437','alarm'),
  ('386079','fire'),
  ('135469','alarm'),
  ('135363','alarm'),
  ('131580','alarm'),
  ('885907','fire'),
  ('885427','alarm'),
  ('885448','alarm'),
  ('130910','alarm'),
  ('130914','alarm'),
  ('135365','alarm'),
  ('885422','alarm'),
  ('139942','fire'),
  ('883789','alarm'),
  ('883786','fire'),
  ('885406','alarm'),
  ('885935','alarm'),
  ('131568','alarm'),
  ('130916','alarm'),
  ('884964','alarm'),
  ('885447','fire'),
  ('885939','alarm'),
  ('885446','fire'),
  ('88590','alarm'),
  ('885951','fire'),
  ('137877','alarm'),
  ('885969','alarm');

CREATE TEMP TABLE mon_meta(mon text PRIMARY KEY, name text, addr text) ON COMMIT DROP;
INSERT INTO mon_meta(mon,name,addr) VALUES
  ('884863','ACH E N -GARN E R CON STRU CTY ON LLC','21 95 W CH AN D LE R BLVD'),
  ('884912','ALLI AN CE PLU M B I N G','2626 E ELWOOD ST'),
  ('885418','APD POWER CEN TER','41 2 W GEM I N I D R'),
  ('137879','ARY ZON A PROFE SSY ON AL PAY N TY N G','5424 S 39TH STRE E T'),
  ('885417','ASSA ABLOY','1 0027 S 51 ST STREET #1 02'),
  ('884911','ASSA ABLOY AN N EX BU I LD I N G','1 51 75 S 50TH ST / #1 50'),
  ('884865','B I LTMORE EN T','1 01 0 E M CD OWELL RD'),
  ('131567','BLT Ks TCH EN S GLEN DALE','6727 N 47TH AVE'),
  ('139941','BLT MOD E RN TORTY LLA','739 E D U N LAP AVE'),
  ('884854','BLY CK ART M ATE RY ALS','1 7520 N 75TH AVE'),
  ('130912','BU YBACK BOSS','450 N 54TH STREET / SU s TE 4'),
  ('386276','CARTS & PARTS','1 6 E JON E S AVE'),
  ('884874','CLARKm D AM I EN','633 W SOU TH ERN AVE / #1 1 97'),
  ('386100','COM PASS CH U RCH','1 825 S ALM A SCH OOL RD'),
  ('131576','CORK N BOTTLE','41 01 E MCDOWELL RD'),
  ('137884','CU LVE RS-JACOB: CU LVE RS','1 40 W OCOTY LLO RD'),
  ('885943','CU LVERS ELLSWORTH **NEW**','23651 S ELLSWORTH RD'),
  ('386071','D AD AM ‰ JE FF','3801 E WE LD ON AVE'),
  ('386073','D AD AM ‰ JE FF - GU E ST H OU SE','3801 E WE LD ON AVE'),
  ('386093','D E SE RT LAKE S APTS: M AY N TE N AN CE','8245 N 27TH AVE'),
  ('884893','D P CON SU LTI N G F I RE','2395 W U TOPI A RD'),
  ('884936','D RI N I QU E','5720 S. 40TH STREET STE #3'),
  ('885906','DESERT APPEAL','2802 E WILLOW ST'),
  ('130913','ELLEN DEAN','1 1 1 8 E M s SSOU Rs AVE / BLD B STE #3'),
  ('885442','EN VOY DATA','8444 N. 90TH STREET/SUW TE 125'),
  ('884972','EVEN T REN TS PH OEN I X','5444 WEST ROOSEVELT STREET / SU I TE 1 00'),
  ('885404','F I RST L I N EAGE','3737 EAST BROAD WAY RD'),
  ('130919','FAs RYTALE BROWN s ES','461 0 E COTTON CEN TER BLVD STE #1 00'),
  ('139945','FBN OFFY CE / WARE H OU SE','271 0 W. CH E E RY LYN N'),
  ('386072','FBN OFFY CE / WARE H OU SE','271 0 W. CH E E RY LYN N'),
  ('386082','FLORA-TE CH','291 E E L PRAD O CT'),
  ('884892','FORESI GH T TECH N OLOGI ES PRI EST','3001 S PRI EST D RI VE'),
  ('885902','FORESW GH T 1 301','1 301 W GENEVA DR'),
  ('885430','GG&D MOTOR VEH W CLE SERV. 6601 W. W N D W SCH .','6601 W INDIAN SCHOOL STE 20'),
  ('885432','GG&D MOTOR VEH W CLE SERVW CES','1 625 E INDIAN SCHOOL RD SU W TEA'),
  ('885436','GG&D MOTOR VEH W CLE SERVW CES 1 625 W N D W AN SCH OOL)','1 625 E INDIAN SCHOOLRD/ SUW TEB &'),
  ('885435','GG&D MOTOR VEH W CLE SERVW CES 7207 S CEN TRAL','7207 SOUTH CEN TRAL'),
  ('885932','GG&D MOTOR VEH W CLE SERVW CES BELL RD','81 55 W BELL ROAD STE 114'),
  ('885429','GG&D MOTOR VEH W CLE SERVW CES: 1 1 20 CN TRY CLU B','1120 S COUNTRY CLUB DR #101'),
  ('885433','GG&D MOTOR VEH W CLE SERVW CES: 2302 BELL','2302 E BELL RD'),
  ('885431','GG&D MOTOR VEH W CLE SERVW CES: 4307 GLEN DALE','4307 W GLENDALE'),
  ('130908','GLEN BN B F s RE','4238 N CRAFTSMAN CT'),
  ('884940','H ELLAS CON STRU CTI ON','3841 E SU PERI OR AVE'),
  ('885414','I SMOKE','71 1 9 E SH EA BLVD / SU I TE 1 09'),
  ('885407','I SMOKE GREY H AWK','20731 N SCOTTSD ALE RD #1 03'),
  ('885423','I CM D OCU M EN T SOLU TI ON S','41 00 E BROAD WAY RD / #1 80'),
  ('884910','I CM D OCU M EN TS WAREH OU SE','421 4 S 36TH ST'),
  ('885405','I I AB','333 E FLOWER STREET'),
  ('130917','JAMs E REGs N A: RESs DEN CE','31 51 5 N 44TH STREET'),
  ('885419','JEEP FARM','21 844 N 1 9TH AVE'),
  ('135479','JF LON G PROPE RTY E S: BU Y LD Y N G " B "','1 1 1 8 E M Y SSOU RY AVE / BLD G B STE #2'),
  ('386098','JF LON G PROPE RTY E S: JF LON G OFFY CE - M AY N -','1 1 1 8 E . M Y SSOU RY AVE .'),
  ('883768','JF LON G PROPE RTY E S: JFL 71 30','71 30 W FRY E R D R'),
  ('139946','JF LON G PROPE RTY E S: JFL 71 30','71 30 W. FRY E R D R.'),
  ('386133','JF LON G PROPE RTY E S: JFL 71 36','71 36 W FRY E R D R'),
  ('386134','JF LON G PROPE RTY E S: JFL 71 36','71 36 W FRY E R D R'),
  ('131003','JF LON G 71 36 BU RG','71 36 W FRs ER'),
  ('135477','JF LON G PROPERTs ES: JF LON G OFFs CE-MAs N','1 1 1 8 E M s SSOU Rs AVE STE A1 ¯RADs O]'),
  ('885402','JU P I TER RESEARCH','7655 E . RED F I ELD RD'),
  ('884857','M AAX SPAS','25605 S ARY ZON A AVE'),
  ('935026','MAAX SPAS','25605 S ARW ZON A AVE'),
  ('884967','N U M ARK TRAN SPORTATI ON','5446 W. ROOSEVELT STREET / SU I TE 1 09'),
  ('885420','OSG B I LLI N G BU RGLARY','41 5 W GU AD ALU PE RD'),
  ('884855','OSG B Y LLY N G','41 5 W GU AD ALU PE RD'),
  ('135367','PAL CON SU LTs N G: BU RG : TRU MED D s SPEN SARY','1 61 3 N 40TH STREET'),
  ('131578','PAL CON SU LTs N G: TRU MED WAREH OU SE: BU RG','1 621 N 40TH STREET'),
  ('885915','PAL CON SU LTW N G: F W RE : 1 5TH AVE GROW','231 5 SOUTH 15TH AVENUE'),
  ('885914','PAL CON SU LTW N G: F W RE : 2929 GROW','2929 WEST TOMAS'),
  ('885913','PAL CON SU LTW N G: F W RE : 2937 GROW','2937 WEST THOMAS RD'),
  ('139943','PAL CON SU LTY N G: BU RG : 1 5TH AVE GROW','231 5 S 1 5TH AVE N U E'),
  ('139954','PAL CON SU LTY N G: BU RG : 2929 GROW','2929 WE ST TH OM AS'),
  ('139947','PAL CON SU LTY N G: BU RG : 2937 GROW','2937 WE ST TH OM AS RD'),
  ('139952','PAL CON SU LTY N G: BU RG : 3006 WARE H OU SE','3006 W. TH OM AS RD'),
  ('885421','PBP P I TN EY BOWES','825 E U N I VERSI TY AVE'),
  ('130918','PBP: GSA COU Rs ER CELLU LAR','825 E U N s VERSs TY / STE B'),
  ('130915','PBP: P s TN EY BOWES MAs N BU RG CELLU LAR','825 E U N s VERSs TY DR'),
  ('885403','PH OEN I X SU RVEI LLAN CE OFFI CE','4001 E BROAD WAY RD STE B 1 5'),
  ('130909','PROQU AL LAN DSCAPs N G 41 1 /423 BLD˜','41 1 W ORs ON STREET'),
  ('885437','PRU EDH OMMEE DAVW D -DP CON SU LTW N G','1 6636 N 40TH PL'),
  ('386079','RAM E N D E E P : D AY RY QU E E N','3308 E AST BASE L Y N E ROAD'),
  ('885409','RAM SEY RESI D EN CE','5701 E I N D I AN SCH OOL RD'),
  ('135469','RAMEN DEEP: DAs RY QU EEN','1 01 00 W LAKE PLEASAN T PKWY STE 1 320'),
  ('135363','RAMEN DEEP: DAs RY QU EEN','1 2456 N 28TH DR'),
  ('131580','RAMEN DEEP: DAs RY QU EEN','1 3365 W MCDOWELL RD˜'),
  ('885907','RAMEN DEEP: DAW RY QU EEN GOODYEAR','1 3365 W MCDOWELL RD'),
  ('885427','RAYO WH OLE SALE PH OEN W X','2633 N 36TH AVE'),
  ('885448','RECON SERVE ARW ZON A','1 704 W BROADWAY RD'),
  ('130910','Rs CK GU LLETTE','1 1 1 8 E M s SSOU Rs AVE / STE #B U N s T #1'),
  ('130914','s -1 7 AU TO CELL ACCT BU RG','22230 N 24TH AVE'),
  ('884921','SH ERI D AN m JOH N','8261 E MON TE VI STA'),
  ('884919','SON OVI SI ON D OWN TOWN','300 W CLAREN D ON AVE / 320'),
  ('135365','Ss ERRA AU TO AU CTs ON','3570 GRAN D AVE'),
  ('884904','STSS 63RD AVEN U E STE 1 05','1 01 5 S 63RD AVE #1 05'),
  ('884895','STSS RECYCLI N G','1 645 S 39TH AVE'),
  ('885422','STSS RECYCLI N G STE 1 03','1 01 5 S 63RD AVE. STE 1 03'),
  ('131008','SU N BELT CLs MATE CON TROL REN TALS','3832 E ROESER RD / SU s TE #1 1 0'),
  ('139942','TH E PH ARM : SU N D AY GOOD S','1 61 6 E GLE N D ALE'),
  ('883789','TH E PH ARM : SU N D AY GOOD S TE M PE','723 N SCOTTSD ALE RD'),
  ('883786','TH E PH ARM : SU N D AY GOOD S TE M PE','723 N SCOTTSD ALE RD'),
  ('885406','TH E PH ARM g SU N D AY GOOD S','1 61 6 E GLEN D ALE AVE'),
  ('885935','TH E PH ARM: SU N DAY GOODS SU RPRW SE','1 31 50 W BELL RD'),
  ('131568','TH E PH ARM: TH E PH ARM Ws LCOX','5900 W GREEN H OU SE RD'),
  ('130916','TORAH DAY SCH OOL','1 1 1 8 W GLEN DALE AVE'),
  ('885945','TREK B W CYCLE','1 381 0 W. TEST DR.'),
  ('884964','VERD E I N D U STRI ES','381 2 WEST WASH I N GTON ST'),
  ('885447','VERDE W N DU STRW ES 381 2','381 2 W WASHINGTON'),
  ('885939','VERDE W N DU STRW ES 3820','3820 W WASHINGTON ST'),
  ('885446','VERDE W N DU STRW ES 3820','3820 W WASHINGTON ST'),
  ('88590','McFadden Hardware','4647 S 32nd st'),
  ('885951','McFadden Hardware','4647 S 32nd st'),
  ('137877','PROQUAL LAND SCAPING 402','402 W ORION ST'),
  ('885955','JEEP FARM 24TH AVENUE','22201 N 24TH AVENUE'),
  ('885967','CUNNINGHAM LAW OFFICES','330 N 2nd AVE PHOENIX AZ 85003'),
  ('885969','CONSUME SHOW LOW','1350 N PENROD ROAD SHOWLOW');

-- account -> sorted services array
CREATE TEMP TABLE acct_svc ON COMMIT DROP AS
SELECT mon, ARRAY(SELECT DISTINCT svc FROM mon_lab x WHERE x.mon = m.mon ORDER BY svc) AS svcs
FROM (SELECT DISTINCT mon FROM mon_lab) m;

-- existing clients that ARE a monitoring panel (customer_id digits = an audit account)
CREATE TEMP TABLE pcli ON COMMIT DROP AS
SELECT c.id, c.customer_id, c.services, c.site_address, regexp_replace(c.customer_id, '[^0-9]', '', 'g') AS mon
FROM clients c WHERE regexp_replace(c.customer_id, '[^0-9]', '', 'g') IN (SELECT mon FROM mon_meta);

\echo ''
\echo '=== panels matched / audit accounts / missing ==='
SELECT (SELECT count(*) FROM pcli)                                            AS panels_in_db,
       (SELECT count(*) FROM mon_meta)                                        AS audit_accounts,
       (SELECT count(*) FROM mon_meta m WHERE m.mon NOT IN (SELECT mon FROM pcli)) AS missing_to_add;

\echo ''
\echo '=== label fixes (current -> audit) ==='
SELECT p.customer_id, array_to_string(p.services,',') AS current, array_to_string(a.svcs,',') AS audit, c.name
FROM pcli p JOIN acct_svc a ON a.mon = p.mon JOIN clients c ON c.id = p.id
WHERE p.services IS DISTINCT FROM a.svcs
ORDER BY p.customer_id;

-- ===================== APPLY (no deletes) =====================
-- 1. correct labels
UPDATE clients c SET services = a.svcs
FROM pcli p JOIN acct_svc a ON a.mon = p.mon
WHERE c.id = p.id AND c.services IS DISTINCT FROM a.svcs;

-- 2. fill missing addresses
UPDATE clients c SET site_address = m.addr
FROM pcli p JOIN mon_meta m ON m.mon = p.mon
WHERE c.id = p.id AND COALESCE(c.site_address,'') = '' AND m.addr <> '';

-- 3. add audit accounts that have no client yet
INSERT INTO clients (name, customer_id, vendor, services, site_address, monitoring_enabled)
SELECT m.name, m.mon, 'generic', COALESCE(a.svcs, ARRAY[]::text[]), m.addr, FALSE
FROM mon_meta m LEFT JOIN acct_svc a ON a.mon = m.mon
WHERE m.mon NOT IN (SELECT mon FROM pcli);

\echo ''
\echo '=== AFTER ==='
SELECT count(*) AS clients, count(*) FILTER (WHERE array_length(services,1)>0) AS labeled FROM clients;

ROLLBACK;  -- <<< change to COMMIT and re-run to apply
