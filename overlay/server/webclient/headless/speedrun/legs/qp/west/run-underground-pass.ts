// run-underground-pass.ts — launcher for Underground Pass (q-underground-pass.ts).
//   --live <account>   reads bots/<account>/bot.env; every staff cheat throws.
//   --sim [name]       local engine only: drops the tutorial kit, sets Biohazard complete (%biohazard = 16,
//                      general/configs/quest.constant:6), the sim stats, hands over SUPPLY, teleports to the start.
//                      Debug: --from <segment> (cheat-set state, see SEGS), --env K=V (A/B switches).
//   --supply           prints the supply list.
import * as Q from './q-underground-pass.js';
import { launch } from './we-lib.js';

const STATS = { attack: 83, strength: 83, defence: 60, hitpoints: 70, ranged: 56, prayer: 47, magic: 80, agility: 75, thieving: 70 };
// %ibanmulti bits (quest_upass.constant): 11 started; 22-31 the grid value (3 digits 1-5, setupassgrilltrap)
const STARTED = 1 << 11;
// --env UPASS_GRID=<3 digits 1-5> picks the debug grid for --from runs (the real run gets a random one from King Lathas)
const argv = (globalThis as any).process?.argv as string[];
const gi = argv.indexOf('--env'); const GRID = Number((argv.find(a => a.startsWith('UPASS_GRID=')) ?? 'UPASS_GRID=343').split('=')[1]);
await launch(Q, 'underground-pass', {
    stats: STATS,
    // Biohazard complete (quest.constant:6); Plague City complete + its scroll read (%elenaquest 30, quest_elena.constant:21) =
    // Ardougne Teleport learnt (teleport.rs2:22-37)
    varps: ['setvar biohazard 16', 'setvar elenaquest 30'],
    segs: {
        enter: { varps: [`setvar ibanmulti ${STARTED | (GRID << 22)}`], tele: { x: 2437, z: 3313 } },
        bridge: { varps: ["setvar upass 1", `setvar ibanmulti ${STARTED | (GRID << 22)}`], tele: { x: 2494, z: 9716 } },
        swing: { varps: ["setvar upass 2", `setvar ibanmulti ${STARTED | (GRID << 22)}`], tele: { x: 2442, z: 9716 } },
        grid: { varps: ["setvar upass 2", `setvar ibanmulti ${STARTED | (GRID << 22)}`], tele: { x: 2481, z: 9679 } },
        orbs: { varps: ["setvar upass 2", `setvar ibanmulti ${STARTED | (GRID << 22)}`], tele: { x: 2466, z: 9673 } },
        area2: { varps: ["setvar upass 3", `setvar ibanmulti ${STARTED | (GRID << 22) | (15 << 5)}`], tele: { x: 2423, z: 9660 } },
        nilhoof: { varps: ["setvar upass 5", `setvar ibanmulti ${STARTED | (GRID << 22) | (15 << 5)}`], tele: { x: 2173, z: 4725, level: 1 } },
        doll: { varps: ["setvar upass 6", `setvar ibanmulti ${STARTED | (GRID << 22) | (15 << 5)}`], items: [{ name: "upassdwarfbrew", n: 1 }], tele: { x: 2150, z: 4546, level: 1 } },
        shadow: { varps: ["setvar upass 7", `setvar ibanmulti ${STARTED | (GRID << 22) | (15 << 5)}`], items: [{ name: "upassdwarfbrew", n: 1 }, { name: "ibandoll", n: 1 }], tele: { x: 2159, z: 4566, level: 1 } },
        tombkalrag: { varps: ["setvar upass 7", `setvar ibanmulti ${STARTED | (GRID << 22) | (15 << 5) | (1 << 4)}`], items: [{ name: "upassdwarfbrew", n: 1 }, { name: "ibandoll", n: 1 }], tele: { x: 2173, z: 4725, level: 1 } },
        temple: { varps: ["setvar upass 7", `setvar ibanmulti ${STARTED | (GRID << 22) | (15 << 5) | (1 << 1) | (1 << 3) | (1 << 4)}`], items: [{ name: "ibandoll", n: 1 }], tele: { x: 2113, z: 4729, level: 1 } },
        finish: { varps: ["setvar upass 9", `setvar ibanmulti ${STARTED | (GRID << 22) | (15 << 5)}`], tele: { x: 2482, z: 9607 } },
        paladins: { varps: ["setvar upass 4", `setvar ibanmulti ${STARTED | (GRID << 22) | (15 << 5)}`], items: [{ name: "cave_unicorn_horn", n: 1 }], tele: { x: 2371, z: 9666 } },
    },
});
