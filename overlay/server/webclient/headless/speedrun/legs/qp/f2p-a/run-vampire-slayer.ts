// run-vampire-slayer.ts — launcher for Vampire Slayer (q-vampire-slayer.ts). f2p-a agent 2.
//   --live <account>   reads bots/<account>/bot.env; every staff cheat throws.
//   --sim [name]       local engine only: drops the tutorial kit, sets the sim stats, gives the supplies + sim gear (weapon
//                      wielded; the teleports use air runes, no staff swap), teleports outside
//                      Morgan's house. FC_TELE=harlow,manor (default) | harlow | manor | none. FC_ATT/FC_STR/FC_DEF/FC_HP,
//                      FC_WEAPON, FC_FOOD (sharks) override for A/B.
//   --supply           prints the supply list.
import * as Q from './q-vampire-slayer.js';
import { launch } from './fa-lib.js';

declare const process: { env: Record<string, string | undefined> };
const e = (k: string, d: number) => Number(process.env[k] || d);
const weapon = process.env.FC_WEAPON || 'rune_scimitar';
await launch(Q, 'vampire-slayer', {
    stats: { magic: 25, attack: e('FC_ATT', 40), strength: e('FC_STR', 40), defence: e('FC_DEF', 20), hitpoints: e('FC_HP', 30) },
    items: [{ name: weapon, n: 1 }, ...(e('FC_FOOD', 2) > 0 ? [{ name: 'shark', n: e('FC_FOOD', 2) }] : [])],
    wield: [weapon],
});
