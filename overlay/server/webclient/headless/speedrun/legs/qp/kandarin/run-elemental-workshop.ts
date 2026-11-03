// run-elemental-workshop.ts — launcher for Elemental Workshop (q-elemental-workshop.ts). Modes (ka-lib launch):
//   --live <account>   reads bots/<account>/bot.env; every staff cheat throws
//   --sim [name]       LOCAL engine only: clears the pack, sets stats, hands over SUPPLY, teleports to the start
//   --supply           prints the supply list and requirements
// Prints "QUEST COMPLETE in <n> ticks" on success.
import * as Q from './q-elemental-workshop.js';
import { launch } from './ka-lib.js';

// the quest's own gates (crafting/mining/smithing 20) + route-position melee (Waterfall 83, Witch's House hp 72)
await launch(Q, { stats: { attack: 83, strength: 83, defence: 1, hitpoints: 72, crafting: 20, mining: 20, smithing: 20 } });
