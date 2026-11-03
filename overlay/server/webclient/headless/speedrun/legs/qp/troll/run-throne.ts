// run-throne.ts — launcher for Throne of Miscellania (q-throne.ts). Modes: --live <account> | --sim [name] | --supply.
//   --sim: sets Hero's Quest (%heroquest 15, general/configs/quest.constant:32) and The Fremennik Trials (%viking 10, :68) complete,
//          herblore 35 (THRONE_HERB to change), hands over SUPPLY, teleports to the Rellekka pier.
//   THRONE_START=<stage> / THRONE_STOP=<stage> resume / stop (the sim sets %misc_quest for that stage + the items it needs).
//   THRONE_WEEDOP=1|3: which herb op the weeding uses (A/B).
import { launch } from './launch-lib.js';
import * as Q from './q-throne.js';
const from = process.env.THRONE_START ?? 'sail';
const MISC = { x: 2501, z: 3861, level: 1 }, ETC = { x: 2612, z: 3875, level: 1 };
// %misc_quest per stage start (quest_misc.constant); approval/affection live in misc_varbit_1 (approval bits 18-24 -> 32 = 25%)
const SETUP: Record<string, { q: number; extra?: Array<{ name: string; n: number }>; at: { x: number; z: number; level?: number } }> = {
    sail: { q: 0, at: Q.REQUIREMENTS.start },
    vargas1: { q: 0, at: MISC },
    court: { q: 10, at: MISC },
    sigrid1: { q: 10, at: MISC },
    vargas2: { q: 20, at: ETC },
    sigrid2: { q: 30, at: MISC },
    brand: { q: 40, at: ETC },
    ghrim: { q: 50, extra: [{ name: 'misc_awful_anthem', n: 1 }], at: MISC },
    sigrid3: { q: 60, extra: [{ name: 'misc_good_anthem', n: 1 }], at: MISC },
    vargas3: { q: 70, extra: [{ name: 'misc_treaty', n: 1 }], at: ETC },
    derrik: { q: 80, at: MISC },
    approval: { q: 80, at: MISC },
    finish: { q: 80, at: MISC },
};
const st = SETUP[from];
if (!st) { console.error(`THRONE_START=${from}: one of ${Object.keys(SETUP).join(' ')}`); process.exit(2); }
const varps: Array<[string, number]> = [['heroquest', 15], ['viking', 10], ['misc_quest', st.q]];
// resumed past the start: approval 32 (Vargas' reset) so the sim matches a real run
if (st.q >= 10) varps.push(['misc_varbit_1', 32 << 18]);
await launch({ ...Q, run: (b, o) => Q.run(b, { ...o, from, to: process.env.THRONE_STOP, weedOp: Number(process.env.THRONE_WEEDOP ?? 1) }) }, {
    prefix: 'tft',
    varps,
    stats: { herblore: Number(process.env.THRONE_HERB ?? 35), hitpoints: 80 },
    extra: st.extra ?? [],
    start: st.at,
});
