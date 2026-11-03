// glory-wild.ts — SR_GLORY_WILD=0: carry NO glory into the Wilderness when the leg does not need one
// there. Wilderness legs of the max-QP route (session-8 audit): Merlin's Crystal (chaos altar 3239,3608, wilderness 12; main
// AND partner) and Family Crest (Chronozon 3087,9937, Edgeville dungeon wilderness part). Both reach it by a glory rub to
// Edgeville and leave by a spell teleport (Camelot / Varrock), so the glories go into the Edgeville bank next to the landing.
// Temple of Ikov only crosses the warning line (z 3512-3515) south of the ditch: not the Wilderness.
// Default (unset / anything but '0'): no change.
import { SpeedBot, objDebugName, objId } from '../../core.js';

const GLORY_ANY = /^amulet_of_glory(_[1-4])?$/;
const GLORY_NAMES = ['amulet_of_glory', 'amulet_of_glory_1', 'amulet_of_glory_2', 'amulet_of_glory_3', 'amulet_of_glory_4'];

export async function wildStash(bot: SpeedBot, label: string): Promise<boolean> {
    if (process.env.SR_GLORY_WILD !== '0') return true;
    const t0 = bot.tickCount;
    const wg = GLORY_NAMES.map(n => objId(n)).filter(id => bot.isWorn(id));
    if (wg.length && bot.free() >= wg.length) { bot.burst(wg.map(id => () => bot.unequipItem(id))); await bot.until(() => wg.every(id => !bot.isWorn(id)), 6); }
    const held = () => bot.inv().filter(s => GLORY_ANY.test(objDebugName(s.obj)));
    if (!held().length) return true;
    const what = held().map(s => objDebugName(s.obj).replace('amulet_of_', '')).join(',');
    let opened = false;
    for (let k = 0; k < 4 && !opened; k++) opened = (await bot.openBank({ radius: 16, kind: k % 2 === 0 ? 'npc' : 'any', maxTicks: 15 })).ok;
    if (!opened) { console.log(`[glory-wild] ${bot.loginUser} ${label}: no bank opened at ${JSON.stringify(bot.tile())}, carrying ${what}`); return false; }
    await bot.tick(1);
    const keepIds = [...new Set(bot.inv().filter(s => !GLORY_ANY.test(objDebugName(s.obj))).map(s => s.obj))];
    for (let k = 0; k < 3 && held().length; k++) { await bot.depositAll(keepIds); await bot.tick(2); }
    await bot.tick(3);   // the glory ledger reads the bank while it is open
    const ok = !held().length;
    bot.closeBank(); await bot.tick(1);
    console.log(`[glory-wild] ${bot.loginUser} ${label}: ${ok ? `banked ${what}` : `FAILED, still ${held().length}`} (${bot.tickCount - t0} t)`);
    return ok;
}
