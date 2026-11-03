/// <reference types="node" />
// run-priest-in-peril.ts — launcher for q-priest-in-peril.ts (Priest in Peril through stage 61).
//   --live <account>   real account (bots/<account>/bot.env), every staff cheat throws; needs SUPPLY in the pack, WEAR worn
//                      or held, and SUPPLY_BANK (27 rune essence) in the Varrock east bank.
//   --sim [name]       LOCAL engine only: drops the tutorial kit, sets the stats, puts 27 essence in the Varrock east bank
//                      (setup, not timed), hands over SUPPLY + WEAR, teleports to the start, runs. --helper: the second
//                      essence batch (27) is handed over by cheat at the mausoleum trapdoor (models a helper trade there).
//   --walk-roald       A/B: walk back to King Roald instead of Varrock Teleport.
//   --supply           prints the supply list.
import { localSetup, objId } from '../../../core.js';
import { openBooth } from '../../run-lib.js';
import { launch } from './mo-lib.js';
import { QUEST, REQUIREMENTS, SUPPLY, SUPPLY_BANK, SUPPLY_HELPER, WEAR, run } from './q-priest-in-peril.js';

const helper = process.argv.includes('--helper'), walk = process.argv.includes('--walk-roald');
await launch({
    quest: QUEST, reqs: REQUIREMENTS, supply: helper ? SUPPLY_HELPER : SUPPLY, wear: WEAR, tag: 'priest-in-peril',
    simStats: { attack: 40, strength: 40, defence: 40, hitpoints: 40, magic: 25 },
    simBank: helper ? [] : SUPPLY_BANK,
    run: (bot, o) => run(bot, { ...o, walkToRoald: walk, restock: helper && o.sim ? async need => { await localSetup(bot, { items: [{ name: 'blankrune', n: need }] }); } : undefined }),
});
