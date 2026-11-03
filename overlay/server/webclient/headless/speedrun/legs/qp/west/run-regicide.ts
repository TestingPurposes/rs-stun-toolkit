// run-regicide.ts — launcher for Regicide (q-regicide.ts).
//   --live <account> [--relog]   reads bots/<account>/bot.env; every staff cheat throws. --relog logs out and in first (arms the
//                                King's messenger timer: do it once right after Underground Pass).
//   --sim [name]       local engine only: drops the tutorial kit; sets Biohazard + Plague City (scroll read) + Underground Pass
//                      complete with every %ibanmulti bit the pass leaves set, saves the account's grid digits (what Underground
//                      Pass records), sets the sim stats, hands over SUPPLY, teleports beside King Lathas and RELOGS (the
//                      messenger timer is armed only at login). Debug: --from <segment>, --env K=V.
//   --supply           prints the supply list.
import * as Q from './q-regicide.js';
import { saveGrid } from './q-underground-pass.js';
import { launch } from './we-lib.js';

const argv = (globalThis as any).process?.argv as string[];
const GRID = (argv.find(a => a.startsWith('REG_GRID=')) ?? 'REG_GRID=343').split('=')[1]!;
const name = argv[argv.indexOf('--sim') + 1];
if (argv.includes('--sim') && name && !name.startsWith('-')) saveGrid(name, GRID);
// %ibanmulti after Underground Pass (quest_upass.constant): doll 1-4, orbs 5-8, cat 9, started 11, crate 12, jerro 13,
// badges 14-16, koftik 17, horn 18, history 19, inscription 20, brew 21; the grid digits in bits 22-31
let IBAN = 0;
for (const b of [1, 2, 3, 4, 5, 6, 7, 8, 9, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21]) IBAN += 2 ** b;
IBAN += Number(GRID) * 2 ** 22;
const BASE = ['setvar biohazard 16', 'setvar elenaquest 30', 'setvar upass 10', `setvar ibanmulti ${IBAN}`];
const STATS = { attack: 83, strength: 83, defence: 60, hitpoints: 70, ranged: 56, prayer: 47, magic: 80, agility: 75, thieving: 70, crafting: 30, mining: 50, cooking: 34 };
await launch(Q, 'regicide', {
    stats: STATS,
    varps: BASE,
    relog: true,
    segs: {
        lathas: { varps: ['setvar regicide_quest 1'], tele: { x: 2577, z: 3293, level: 1 } },
        pass1: { varps: ['setvar regicide_quest 2'], tele: { x: 2577, z: 3293, level: 1 } },
        isafdar: { varps: ['setvar regicide_quest 2'], tele: { x: 2014, z: 4711, level: 1 } },
        isaf1: { varps: ['setvar regicide_quest 3'], tele: { x: 2267, z: 3205 } },
        outside: { varps: ['setvar regicide_quest 11'], items: [{ name: 'regicide_barrel_tar', n: 1 }, { name: 'regicide_sulphar_dust', n: 1 }, { name: 'regicide_cloth', n: 1 }, { name: 'cooked_rabbit', n: 1 }], drop: ['shortbow', 'bronze_arrow', 'rope', 'spade', 'ball_of_wool'], tele: { x: 2205, z: 3250 } },
        isaf2: { varps: ['setvar regicide_quest 11'], items: [{ name: 'regicide_barrel_lid_fused', n: 1 }, { name: 'cooked_rabbit', n: 1 }], tele: { x: 2312, z: 3216 } },
        finish: { varps: ['setvar regicide_quest 13'], items: [{ name: 'regicide_iorwerth_message', n: 1 }], tele: { x: 2205, z: 3250 } },
    },
});
