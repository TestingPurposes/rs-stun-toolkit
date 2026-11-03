// run-holy-grail.ts — launcher for Holy Grail (q-holy-grail.ts). Modes (ka-lib launch):
//   --live <account>   reads bots/<account>/bot.env; every staff cheat throws
//   --sim [name]       LOCAL engine only: clears the pack, sets Merlin's Crystal (%arthur 7) and Lost City (%zanaris 6,
//                      the dragon longsword's wield gate) complete, sets stats, gives Excalibur + SUPPLY, teleports
//   --supply           prints the supply list and requirements
// Prints "QUEST COMPLETE in <n> ticks" on success.
//   SIM99=1     attack/strength/defence/hitpoints/prayer 99 instead of the route-position stats
//   GRAIL_ARD=1 also Plague City read-scroll (%elenaquest 30) + magic 51 + 4 law/4 water: Karamja via Ardougne Teleport
//               and Captain Barnaby's ship instead of the glory
import * as Q from './q-holy-grail.js';
import { launch, type Item } from './ka-lib.js';
declare const process: { env: Record<string, string | undefined> };

const ard = process.env.GRAIL_ARD === '1';
const stats: Record<string, number> = process.env.SIM99 === '1'
    ? { attack: 99, strength: 99, defence: 99, hitpoints: 99, prayer: 99, magic: 45 }
    // route position: Waterfall att/str 83, Witch's House hp 72, Restless Ghost prayer 47, defence untrained
    : { attack: 83, strength: 83, defence: 1, hitpoints: 72, prayer: 47, magic: 45 };
if (ard) stats.magic = 51;
const varps: Array<[string, number]> = [['arthur', 7], ['zanaris', 6]];
if (ard) varps.push(['elenaquest', 30]);
const extra: Item[] = [{ name: 'excalibur', n: 1 }];
if (ard) extra.push({ name: 'lawrune', n: 4 }, { name: 'waterrune', n: 4 });
await launch(Q, { stats, varps, extra });
