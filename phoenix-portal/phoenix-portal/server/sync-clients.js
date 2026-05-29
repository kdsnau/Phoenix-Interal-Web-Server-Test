/**
 * sync-clients.js
 * Syncs the DB clients table to the authoritative monitoring system list.
 *   1. Inserts 16 missing clients
 *   2. Updates 54 name mismatches to the authoritative name
 *   3. Reports 13 extra DB entries for manual review (not auto-deleted)
 *
 * Run from the server directory:
 *   node sync-clients.js
 */

require('dotenv').config();
const pool = require('./db/pool');

function toCid(acct) {
    const s = String(acct);
    if (/^88\d{4}$/.test(s)) return `88-${s.slice(2)}`;
    return s;
}

/* Full authoritative list — isFire drives the services array */
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

/* These DB entries are not in the auth list — listed for review, not deleted */
const EXTRAS = [
    { cid: '1-35781',  name: 'BLT Kitchens'            },
    { cid: '1-3786',   name: 'Sunday Goods'             },
    { cid: '1-41482',  name: 'Hydro Extrusion'          },
    { cid: '1-52774',  name: 'Phoenix Towers'           },
    { cid: '1-5406',   name: 'Sunday Goods'             },
    { cid: '1-64119',  name: 'iPaper'                   },
    { cid: '1-8561',   name: 'BLT Kitchens'             },
    { cid: '88-17542', name: 'Ramsey Residence'         },
    { cid: '88-4963',  name: 'VERDE INDUSTRIES'         },  // likely typo — should be 88-4964
    { cid: '88-4971',  name: 'Tait Development'         },  // not in auth list
    { cid: '88-5407',  name: 'I Smoke'                  },  // possibly cancelled
    { cid: '88-5415',  name: 'Office Test Panel XR550'  },  // test panel
    { cid: '88-5439',  name: 'Quality Woods'            },  // possibly cancelled
    { cid: '88-5445',  name: 'Trenco LLC'               },  // not in auth list
];

function normalize(s) { return s.trim().toUpperCase().replace(/\s+/g, ' '); }

async function run() {
    console.log('=== Phoenix Portal — Client Sync to Auth List ===\n');

    const dbResult = await pool.query('SELECT id, customer_id, name FROM clients');
    const dbMap = {};
    dbResult.rows.forEach(r => { dbMap[r.customer_id] = r; });

    let inserted = 0, updated = 0;

    for (const a of AUTH) {
        const cid      = toCid(a.acct);
        const services = a.fire ? ['fire'] : ['alarm'];
        const existing = dbMap[cid];

        if (!existing) {
            /* INSERT missing client */
            await pool.query(
                `INSERT INTO clients (customer_id, name, services) VALUES ($1, $2, $3)`,
                [cid, a.name, services]
            );
            console.log(`  ✅ INSERT  ${cid.padEnd(12)} ${a.name}`);
            inserted++;
        } else if (normalize(existing.name) !== normalize(a.name)) {
            /* UPDATE mismatched name + fix services */
            await pool.query(
                `UPDATE clients SET name = $1, services = $2 WHERE customer_id = $3`,
                [a.name, services, cid]
            );
            console.log(`  ✏️  UPDATE  ${cid.padEnd(12)} "${existing.name}" → "${a.name}"`);
            updated++;
        } else {
            /* services may still need correcting even if name matches */
            await pool.query(
                `UPDATE clients SET services = $1 WHERE customer_id = $2`,
                [services, cid]
            );
        }
    }

    console.log(`\n✅  Inserted: ${inserted}   ✏️  Updated: ${updated}`);

    console.log(`\n🔵  EXTRA IN DB — not in auth list (${EXTRAS.length} entries, NOT deleted — review manually):`);
    console.log('─'.repeat(65));
    EXTRAS.forEach(e => console.log(`  ${e.cid.padEnd(12)} ${e.name}`));
    console.log('\n  To delete all extras run: node delete-extras.js');
    console.log('\nDone.');
    await pool.end();
}

run().catch(err => { console.error('Sync failed:', err.message); process.exit(1); });
