/**
 * compare-clients.js
 * Compares the authoritative monitoring system client list against the DB.
 * Reports: missing from DB, extra in DB (not in auth list), and name mismatches.
 */

require('dotenv').config();
const pool = require('./db/pool');

/* Convert auth list Acct# to DB customer_id format */
function toCid(acct) {
    const s = String(acct);
    if (/^88\d{4}$/.test(s)) return `88-${s.slice(2)}`;
    return s;
}

/* Authoritative list from monitoring system */
const AUTH = [
    { acct: '130908', name: 'GLEN BNB FIRE',                                          fire: false },
    { acct: '130909', name: 'PROQUAL LANDSCAPING 411/423 BLD. (BURG)',                fire: false },
    { acct: '130910', name: 'RICK GULLETTE (BURG)',                                   fire: false },
    { acct: '130912', name: 'BUYBACK BOSS (BURG)',                                    fire: false },
    { acct: '130913', name: 'ELLEN DEAN (BURG)',                                      fire: false },
    { acct: '130914', name: 'I-17 AUTO CELL ACCT BURG',                               fire: false },
    { acct: '130915', name: 'FLW STORAGE LLC (BURG) CELL',                            fire: false },
    { acct: '130916', name: 'TORAH DAY SCHOOL (BURG)',                                fire: false },
    { acct: '130917', name: 'REGINA, JAMIE: RESIDENCE (BURG)',                        fire: false },
    { acct: '130919', name: 'FAIRYTALE BROWNIES (BURG)',                              fire: false },
    { acct: '131001', name: 'CARTS & PARTS (BURG) CELL',                             fire: false },
    { acct: '131003', name: 'JF LONG 7136 BURG',                                      fire: false },
    { acct: '131008', name: 'SUNBELT CLIMATE CONTROL RENTALS',                        fire: false },
    { acct: '131567', name: 'BLT KITCHENS GLENDALE',                                  fire: false },
    { acct: '131568', name: 'THE PHARM: THE PHARM WILCOX (BURG)',                     fire: false },
    { acct: '131576', name: 'CORK N BOTTLE (BURG)',                                   fire: false },
    { acct: '131578', name: 'PAL CONSULTING: TRUMED WAREHOUSE: BURG',                 fire: false },
    { acct: '131580', name: 'RAMEN DEEP: DAIRY QUEEN (13365 GOODYEAR) (BURG)',        fire: false },
    { acct: '135363', name: 'RAMEN DEEP: DAIRY QUEEN (12456 N. 28TH) (BURG)',         fire: false },
    { acct: '135365', name: 'SIERRA AUTO AUCTION (BURG)',                             fire: false },
    { acct: '135367', name: 'PAL CONSULTING: BURG : TRUMED DISPENSARY',               fire: false },
    { acct: '135469', name: 'RAMEN DEEP: DAIRY QUEEN(10100 LAKE PLEASANT)(BURG)',     fire: false },
    { acct: '135477', name: 'JF LONG PROPERTIES: JF LONG OFFICE-MAIN (BURG)',         fire: false },
    { acct: '135479', name: 'JF LONG PROPERTIES: BUILDING "B" (BURG)',                fire: false },
    { acct: '137877', name: 'PROQUAL LANDSCAPING 402 BLD. (BURG)',                    fire: false },
    { acct: '137879', name: 'ARIZONA PROFESSIONAL PAINTING (BURG)',                   fire: false },
    { acct: '137884', name: 'CULVERS-JACOB: CULVERS (QUEEN CREEK) (BURG)',            fire: false },
    { acct: '139941', name: 'BLT MODERN TORTILLA (BURG)',                             fire: false },
    { acct: '139942', name: 'THE PHARM: SUNDAY GOODS (1616 GLENDALE) (FIRE)',         fire: false },
    { acct: '139943', name: 'PAL CONSULTING: BURG : 15TH AVE GROW',                  fire: false },
    { acct: '139946', name: 'JF LONG PROPERTIES: JFL 7130 (FIRE)',                   fire: true  },
    { acct: '139947', name: 'PAL CONSULTING: BURG : 2937 GROW',                      fire: false },
    { acct: '139952', name: 'PAL CONSULTING: BURG : 3006 OFFICE',                    fire: false },
    { acct: '139954', name: 'PAL CONSULTING: BURG : 2929 GROW',                      fire: false },
    { acct: '386071', name: 'DADAM, JEFF',                                            fire: false },
    { acct: '386073', name: 'DADAM, JEFF - GUEST HOUSE',                              fire: false },
    { acct: '386079', name: 'RAMEN DEEP: DAIRY QUEEN (3308 BASELINE) (FIRE)',         fire: true  },
    { acct: '386082', name: 'FLORA-TECH (FIRE)',                                      fire: true  },
    { acct: '386093', name: 'DESERT LAKES APTS: MAINTENANCE (BURG)',                  fire: false },
    { acct: '386098', name: 'JF LONG PROPERTIES: JF LONG OFFICE-MAIN (FIRE)',         fire: true  },
    { acct: '386100', name: 'COMPASS CHURCH (FIRE)',                                  fire: true  },
    { acct: '386111', name: 'ELONTEC-NEW BLDG OWNER (BURG)',                          fire: false },
    { acct: '386131', name: 'ELONTEC-NEW BLDG OWNER (FIRE)',                          fire: true  },
    { acct: '386134', name: 'JF LONG PROPERTIES: JFL 7136 (FIRE)',                   fire: true  },
    { acct: '386140', name: 'CLAYTON-RAMON HOLDINGS (BURG)',                          fire: false },
    { acct: '883768', name: 'JF LONG PROPERTIES: JFL 7130 (BURG)',                   fire: false },
    { acct: '883786', name: 'THE PHARM: SUNDAY GOODS TEMPE (FIRE)',                  fire: false },
    { acct: '883789', name: 'THE PHARM: SUNDAY GOODS TEMPE (BURG)',                  fire: false },
    { acct: '884854', name: 'BLICK ART MATERIALS (FIRE)',                             fire: true  },
    { acct: '884855', name: 'OSG BILLING (FIRE)',                                     fire: true  },
    { acct: '884857', name: 'MAAX SPAS (FIRE)',                                       fire: false },
    { acct: '884863', name: 'ACHEN-GARNER CONSTRUCTION LLC',                          fire: false },
    { acct: '884865', name: 'BILTMORE ENT',                                           fire: false },
    { acct: '884874', name: 'CLARK, DAMIEN',                                          fire: false },
    { acct: '884892', name: 'FORESIGHT TECHNOLOGIES PRIEST',                          fire: false },
    { acct: '884893', name: 'DP CONSULTING FIRE',                                     fire: true  },
    { acct: '884895', name: 'STSS RECYCLING (39TH & BUCKEYE)',                        fire: false },
    { acct: '884904', name: 'STSS 63RD AVENUE STE 105',                               fire: false },
    { acct: '884910', name: 'ICM DOCUMENTS WAREHOUSE',                                fire: false },
    { acct: '884911', name: 'ASSA ABLOY ANNEX BUILDING',                              fire: false },
    { acct: '884912', name: 'ALLIANCE PLUMBING',                                      fire: false },
    { acct: '884919', name: 'SONOVISION DOWNTOWN',                                    fire: false },
    { acct: '884921', name: 'SHERIDAN, JOHN',                                         fire: false },
    { acct: '884936', name: 'DRINIQUE',                                               fire: false },
    { acct: '884940', name: 'HELLAS CONSTRUCTION',                                    fire: false },
    { acct: '884964', name: 'VERDE INDUSTRIES (BURG)',                                fire: false },
    { acct: '884972', name: 'EVENT RENTS PHOENIX',                                    fire: false },
    { acct: '885402', name: 'JUPITER RESEARCH (BURG)',                                fire: false },
    { acct: '885403', name: 'PHOENIX SURVEILLANCE OFFICE',                            fire: false },
    { acct: '885404', name: 'HOSKINS EQUIPMENT (FIRE)',                               fire: true  },
    { acct: '885405', name: 'IIAB (BURG)',                                            fire: false },
    { acct: '885406', name: 'THE PHARM: SUNDAY GOODS (1616 GLENDALE) (BURG)',         fire: false },
    { acct: '885414', name: 'I SMOKE (SHEA) (BURG)',                                  fire: false },
    { acct: '885417', name: 'ASSA ABLOY (BURG)',                                      fire: false },
    { acct: '885418', name: 'APD POWER CENTER (BURG)',                                fire: false },
    { acct: '885420', name: 'OSG BILLING BURGLARY',                                   fire: false },
    { acct: '885421', name: 'FLW STORAGE LLC (FIRE)',                                 fire: true  },
    { acct: '885422', name: 'STSS RECYCLING (BURG) STE 103',                          fire: false },
    { acct: '885423', name: 'ICM DOCUMENT SOLUTIONS (BURG)',                          fire: false },
    { acct: '885427', name: 'RAYO WHOLE SALE PHOENIX (BURG)',                         fire: false },
    { acct: '885429', name: 'GG&D MOTOR VEHICLE SERVICES: 1120 CNTRY CLUB (BURG)',    fire: false },
    { acct: '885430', name: 'GG&D MOTOR VEHICLE SERV. 6601 W. INDI SCH. (BURG)',     fire: false },
    { acct: '885431', name: 'GG&D MOTOR VEHICLE SERVICES: 4307 GLENDALE (BURG)',      fire: false },
    { acct: '885432', name: 'GG&D MOTOR VEHICLE SERVICES (BURG)',                     fire: false },
    { acct: '885433', name: 'GG&D MOTOR VEHICLE SERVICES: 2302 BELL (BURG)',          fire: false },
    { acct: '885435', name: 'GG&D MOTOR VEHICLE SERVICES 7207 S CENTRAL',             fire: false },
    { acct: '885436', name: 'GG&D MOTOR VEHICLE SERVICES 1625 INDIAN SCHOOL',         fire: false },
    { acct: '885437', name: 'PRUEDHOMME, DAVID -DP CONSULTING (RESIDENTIAL-BURG)',    fire: false },
    { acct: '885442', name: 'ENVOY DATA',                                             fire: false },
    { acct: '885446', name: 'VERDE INDUSTRIES 3820 (FIRE)',                           fire: true  },
    { acct: '885447', name: 'VERDE INDUSTRIES 3812 (FIRE)',                           fire: true  },
    { acct: '885448', name: 'RECONSERVE ARIZONA (BURG)',                              fire: false },
    { acct: '885902', name: 'FORESIGHT 1301 (BURG)',                                  fire: false },
    { acct: '885906', name: 'DESERT APPEAL (BURG)',                                   fire: false },
    { acct: '885907', name: 'RAMEN DEEP: DAIRY QUEEN GOODYEAR (FIRE)',                fire: true  },
    { acct: '885913', name: 'PAL CONSULTING: FIRE : 2937 GROW',                      fire: true  },
    { acct: '885914', name: 'PAL CONSULTING: FIRE : 2929 GROW',                      fire: true  },
    { acct: '885915', name: 'PAL CONSULTING: FIRE : 15TH AVE GROW',                  fire: true  },
    { acct: '885932', name: 'GG&D MOTOR VEHICLE SERVICES BELL RD',                    fire: false },
    { acct: '885935', name: 'THE PHARM: SUNDAY GOODS SURPRISE (BURG)',                fire: false },
    { acct: '885939', name: 'VERDE INDUSTRIES 3820 (BURG)',                           fire: false },
    { acct: '885943', name: 'CULVERS ELLSWORTH',                                      fire: false },
    { acct: '885945', name: 'TREK BICYCLE',                                           fire: false },
    { acct: '885950', name: 'MCFADDEN DALE INDUSTRIAL HARDWARE',                      fire: false },
    { acct: '885951', name: 'MCFADDEN DALE INDUSTRIAL HARDWARE "FIRE"',              fire: false },
    { acct: '885952', name: 'DUSKIN, APRIL',                                          fire: false },
    { acct: '885955', name: 'JEEP FARM (BURG) [NEW]',                                 fire: false },
    { acct: '885957', name: 'THE PHARM DISTRIBUTION CENTER',                          fire: false },
    { acct: '885967', name: 'CUNNINGHAM LAW FIRM',                                   fire: true  },
    { acct: '885969', name: 'THE PHARM: SUNDAY GOODS SHOW LOW (BURG)',                fire: false },
    { acct: '935026', name: 'MAAX SPAS (BURG)',                                       fire: false },
    { acct: 'EL1401', name: 'FLORA-TECH (ELEVATOR)',                                  fire: false },
    { acct: 'EL1719', name: 'FORESIGHT - ELEVATOR - PRIEST',                         fire: true  },
];

function normalize(s) { return s.trim().toUpperCase().replace(/\s+/g, ' '); }

async function run() {
    console.log('=== Phoenix Portal — Client DB vs Auth List Comparison ===\n');

    const dbResult = await pool.query('SELECT id, customer_id, name FROM clients ORDER BY customer_id');
    const dbMap = {};
    dbResult.rows.forEach(r => { dbMap[r.customer_id] = r; });

    const authMap = {};
    AUTH.forEach(a => { authMap[toCid(a.acct)] = a; });

    const missing   = [];   // in auth, not in DB
    const extra     = [];   // in DB, not in auth
    const nameWrong = [];   // in both, but name differs

    /* Auth → DB */
    for (const a of AUTH) {
        const cid = toCid(a.acct);
        if (!dbMap[cid]) {
            missing.push({ cid, authName: a.name });
        } else {
            const dbName = normalize(dbMap[cid].name);
            const authName = normalize(a.name);
            if (dbName !== authName) {
                nameWrong.push({ cid, dbName: dbMap[cid].name, authName: a.name });
            }
        }
    }

    /* DB → Auth (find entries not in auth list) */
    for (const row of dbResult.rows) {
        if (!authMap[row.customer_id]) {
            extra.push({ cid: row.customer_id, dbName: row.name });
        }
    }

    /* Report */
    console.log(`Auth list total : ${AUTH.length}`);
    console.log(`DB total        : ${dbResult.rowCount}`);
    console.log('');

    console.log(`❌  MISSING FROM DB (${missing.length}) — need to be inserted:`);
    console.log('─'.repeat(70));
    missing.forEach(m => console.log(`  ${m.cid.padEnd(12)} ${m.authName}`));

    console.log(`\n⚠️   NAME MISMATCH (${nameWrong.length}) — DB name differs from auth list:`);
    console.log('─'.repeat(70));
    nameWrong.forEach(m => {
        console.log(`  ${m.cid.padEnd(12)}`);
        console.log(`    DB  : ${m.dbName}`);
        console.log(`    Auth: ${m.authName}`);
    });

    console.log(`\n🔵  EXTRA IN DB — not in auth list (${extra.length}):`);
    console.log('─'.repeat(70));
    extra.forEach(e => console.log(`  ${e.cid.padEnd(12)} ${e.dbName}`));

    await pool.end();
}

run().catch(err => { console.error('Failed:', err.message); process.exit(1); });
