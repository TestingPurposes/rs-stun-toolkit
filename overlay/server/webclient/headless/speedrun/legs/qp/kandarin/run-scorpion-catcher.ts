// run-scorpion-catcher.ts — launcher for Scorpion Catcher (q-scorpion-catcher.ts). Modes (ka-lib launch):
//   --live <account>   reads bots/<account>/bot.env; every staff cheat throws
//   --sim [name]       LOCAL engine only: clears the pack, sets Alfred Grimhand's Barcrawl complete (%barcrawl 2, the
//                      outpost gate), stats, SUPPLY, teleports to the start
//   --supply           prints the supply list and requirements
// Prints "QUEST COMPLETE in <n> ticks" on success.
import * as Q from './q-scorpion-catcher.js';
import { launch } from './ka-lib.js';

// prayer 31 base (Abbot Langley); hp 40 for the Taverley dungeon / outpost wanderers
// route position after Holy Grail (defence ~86, prayer ~78 from its x25 reward), Waterfall att/str 83, Witch's House hp 72:
// the dusty-key part of Taverley dungeon has blue dragons, poison spiders and a lesser demon on the way
await launch(Q, { stats: { prayer: 78, magic: 45, hitpoints: 72, attack: 83, strength: 83, defence: 86 }, varps: [['barcrawl', 2]] });
