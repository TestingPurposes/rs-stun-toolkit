// run-demon-slayer.ts — launcher for Demon Slayer (q-demon-slayer.ts).
//   --live <account>   reads bots/<account>/bot.env; every staff cheat throws. Bank 25 bones at Draynor first (SUPPLY_BANK).
//   --sim [name]       local engine only: drops the tutorial kit, stages 25 bones in the Draynor bank, sets the sim stats,
//                      gives the supplies (staff of air wielded), teleports to Varrock square.
//                      FA_NOTELE=1 walks instead of the two teleports; FA_BONES=helper hands the bones over at the tower
//                      instead of the bank stage (models a helper trade) — both A/B switches.
//   --supply           prints the supply list.
import * as Q from './q-demon-slayer.js';
import { launch } from './fa-lib.js';
import { localSetup, SpeedBot } from '../../../core.js';

declare const process: { env: Record<string, string | undefined> };
const e = (k: string, d: number) => Number(process.env[k] || d);
await launch(Q, 'demon-slayer', {
    // sim stats: the lowest proven set (see STATUS.md); FA_ATT/FA_STR/FA_DEF/FA_HP override for A/B
    stats: { magic: 31, prayer: e('FA_PRAY', 1), attack: e('FA_ATT', 45), strength: e('FA_STR', 45), defence: e('FA_DEF', 20), hitpoints: e('FA_HP', 30) },
    wield: ['staff_of_air'],
    preSim: async bot => {
        if (process.env.FA_BONES === 'helper') return;
        // stage 25 bones in the Draynor bank (setup only)
        await localSetup(bot, { tele: { x: Q.DRAYNOR_BANK.x, z: Q.DRAYNOR_BANK.z }, items: [{ name: 'bones', n: 25 }] });
        await bot.tick(2);
        const ob = await bot.openBank({ radius: 12 });
        if (!ob.ok) throw new Error(`preSim: bank ${ob.message}`);
        await bot.depositAll([]);
        bot.closeBank(); await bot.tick(2);
    },
    runOpts: async (_bot, name) => {
        if (process.env.FA_BONES !== 'helper') return {};
        // a second (local) account waits on Traiborn's floor with the bones and keeps offering them
        const cname = `${name.slice(0, 10)}c`;
        const c = await SpeedBot.create(cname);
        await c.tick(2);
        await localSetup(c, { clear: true });
        await localSetup(c, { items: [{ name: 'bones', n: 25 }], tele: { x: 3111, z: 3161, level: 1 } });
        (async () => { for (let k = 0; k < 400 && !c.disposed && c.count('bones') > 0; k++) { const r = await c.giveTo(_bot.loginUser, [{ obj: 'bones', n: 'all' }], { maxTicks: 60 }); if (!r.ok) await c.tick(5); } })();
        return { helper: cname };
    },
});
