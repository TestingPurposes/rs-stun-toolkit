// run-merlins-crystal.ts — launcher for Merlin's Crystal (q-merlins-crystal.ts). Modes (ka-lib launch):
//   --live <account>   reads bots/<account>/bot.env; every staff cheat throws
//   --sim [name]       LOCAL engine only: clears the pack, sets stats, hands over SUPPLY, teleports to the start
//   --supply           prints the supply list and requirements
// Prints "QUEST COMPLETE in <n> ticks" on success.
import * as Q from './q-merlins-crystal.js';
import { launch } from './ka-lib.js';

// route-position stats (Waterfall gives att/str 83 early in P1); magic 45 for Camelot Teleport
await launch(Q, { stats: { attack: 83, strength: 83, defence: 1, hitpoints: 40, magic: 45 } });
