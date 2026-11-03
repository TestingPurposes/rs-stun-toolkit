/// <reference types="node" />
// run-haunted-mine.ts — launcher for q-haunted-mine.ts.
//   --live <account>   real account, cheats throw. Needs Priest in Peril (Morytania), SUPPLY in the pack, start next to
//                      the Saradominist zealot south of Mort'ton.
//   --sim [name]       LOCAL engine only: sets Priest in Peril 61, the stats, hands over SUPPLY + a weapon, teleports.
//   --supply           prints the supply list.
import { launch } from './mo-lib.js';
import { QUEST, REQUIREMENTS, SUPPLY, WEAR, run } from './q-haunted-mine.js';

await launch({
    quest: QUEST, reqs: REQUIREMENTS, supply: SUPPLY, wear: WEAR, tag: 'haunted-mine',
    simVarps: [['priestperil', 61]],
    simStats: { attack: 85, strength: 85, defence: 85, hitpoints: 85, prayer: 70 },
    run: (bot, o) => run(bot, o),
});
