/// <reference types="node" />
// run-shades-of-mortton.ts — launcher for q-shades-of-mortton.ts.
//   --live <account>   real account, cheats throw. Needs Priest in Peril (Morytania), herblore 15, crafting 20,
//                      firemaking 5, SUPPLY in the pack, start at Herbi Flax's house in Mort'ton.
//   --sim [name]       LOCAL engine only: sets Priest in Peril 61, the stats, hands over SUPPLY + weapon, teleports.
//   --supply           prints the supply list.
import { launch } from './mo-lib.js';
import { QUEST, REQUIREMENTS, SUPPLY, WEAR, run } from './q-shades-of-mortton.js';

await launch({
    quest: QUEST, reqs: REQUIREMENTS, supply: SUPPLY, wear: WEAR, tag: 'mortton',
    simVarps: [['priestperil', 61]],
    simStats: { attack: 70, strength: 70, defence: 70, hitpoints: 70, herblore: 15, crafting: 20, firemaking: 5, prayer: 70 },
    run: (bot, o) => run(bot, o),
});
