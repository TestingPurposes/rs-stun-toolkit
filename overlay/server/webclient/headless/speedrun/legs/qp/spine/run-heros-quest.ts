/// <reference types="bun" />
// run-heros-quest.ts — launcher for q-heros-quest.ts (lane spine). TWO accounts in one process: Phoenix + Black Arm.
//   bun headless/speedrun/legs/qp/spine/run-heros-quest.ts --live <phoenixAccount> <blackArmAccount>   (cheats blocked)
//   LC_HOST=localhost:<port> SIM_LOCKSTEP=1 bun headless/speedrun/legs/qp/spine/run-heros-quest.ts --sim [prefix]
//       (accounts <prefix>p and <prefix>b; prefix at most 11 characters)
//   bun headless/speedrun/legs/qp/spine/run-heros-quest.ts --supply
// --sim: drops the tutorial kit; prerequisite varps (qp 65 from completed quests, Lost City, Dragon Slayer, Merlin's Crystal,
// Plague City + scroll, Shield of Arrav: Phoenix on account p, Black Arm on account b); route stats; SUPPLY; teleport to the
// Heroes' Guild. HQ_FROM=<phase> (sim debugging) starts both accounts at that phase with the state it needs.
import { SpeedBot, CHEATS, localSetup, objId, objDebugName } from '../../../core.js';
import { readBotEnv, createLive } from '../../k-live.js';
import { qp } from '../../q-lib.js';
import * as Q from './q-heros-quest.js';
import { simPrep, missing, show, type SimSetup } from './sp-launch.js';
import { wieldAll, type Item } from './sp-lib.js';

const arg = (k: string, i = 1) => { const j = process.argv.indexOf(k); return j >= 0 ? process.argv[j + i] : undefined; };
if (process.argv.includes('--supply')) {
    for (const g of ['phoenix', 'blackarm'] as const) console.log(`${g}: SUPPLY ${show(Q.SUPPLY[g])}`);
    console.log(`requirements (each account): quests [${Q.REQUIREMENTS.quests.join(', ')}] qp ${Q.REQUIREMENTS.qp}; ${Object.entries(Q.REQUIREMENTS.skills).map(([s, [l, w]]) => `${s} ${l} (${w})`).join('; ')}`);
    console.log(`start ${JSON.stringify(Q.REQUIREMENTS.start)} -> end ${JSON.stringify(Q.REQUIREMENTS.end)}`);
    process.exit(0);
}
const live = process.argv.includes('--live'), sim = process.argv.includes('--sim');
if (live === sim) { console.error('use exactly one of --live <phoenix> <blackarm> | --sim [prefix] (or --supply)'); process.exit(2); }
if (sim && !/^(localhost|127\.)/.test(process.env.LC_HOST ?? '')) { console.error('--sim needs a local LC_HOST (it uses staff cheats)'); process.exit(2); }
if (live) CHEATS.blocked = 'run-heros-quest --live';

// completed quests for qp 65 (values from each quest's .constant; counted by general/scripts/quests.rs2:96-302)
const QP65 = ['setvar rjquest 100', 'setvar goblinquest 6', 'setvar druidquest 4', 'setvar arthur 7', 'setvar haunted 3', 'setvar vampire 3',
    'setvar princequest 110', 'setvar spy 4', 'setvar zanaris 6', 'setvar dragonquest 10', 'setvar grandtree 160', 'setvar treequest 9',
    'setvar waterfall_quest 10', 'setvar seaslugquest 12', 'setvar murderquest 2', 'setvar ballquest 7', 'setvar demonstart 30',
    'setvar sheepherderquest 3', 'setvar mcannon 11', 'setvar doricquest 100', 'setvar cookquest 2', 'setvar elenaquest 30', 'setvar qp 65'];
const ROUTE = { attack: 80, strength: 80, defence: 70, hitpoints: 75, prayer: 47, magic: 70, fishing: 70, cooking: 55, herblore: 28, mining: 55 };
const MAX = { attack: 99, strength: 99, defence: 99, hitpoints: 99, prayer: 99, magic: 99, fishing: 99, cooking: 99, herblore: 99, mining: 99 };
const STATS = process.env.SP_STATS === '99' ? MAX : ROUTE;
const GANG: Record<Q.Gang, string[]> = { phoenix: ['setvar phoenixgang 10'], blackarm: ['setvar blackarmgang 4'] };

const FROM = process.env.HQ_FROM as Q.Phase | undefined;
if (FROM && !Q.PHASES.includes(FROM)) { console.error(`HQ_FROM must be one of ${Q.PHASES.join(' ')}`); process.exit(2); }
type R = { cheats: string[]; extra: Item[]; wear?: string[]; at: { x: number; z: number; level: number } };
const RESUME: Partial<Record<Q.Phase, Record<Q.Gang, R>>> = {
    icequeen: { phoenix: { cheats: ['setvar heroquest 1'], extra: [], at: Q.REQUIREMENTS.start }, blackarm: { cheats: ['setvar heroquest 1'], extra: [], at: Q.REQUIREMENTS.start } },
    gang: { phoenix: { cheats: ['setvar heroquest 1'], extra: [{ name: 'ice_gloves', n: 1 }], wear: ['ice_gloves'], at: { x: 2860, z: 3519, level: 0 } },
            blackarm: { cheats: ['setvar heroquest 1'], extra: [{ name: 'ice_gloves', n: 1 }], wear: ['ice_gloves'], at: { x: 2860, z: 3519, level: 0 } } },
    brim: { phoenix: { cheats: ['setvar heroquest 2'], extra: [{ name: 'ice_gloves', n: 1 }], wear: ['ice_gloves'], at: { x: 3212, z: 3426, level: 0 } },
            blackarm: { cheats: ['setvar heroquest 7'], extra: [{ name: 'ice_gloves', n: 1 }], wear: ['ice_gloves'], at: { x: 3212, z: 3426, level: 0 } } },
    pair: { phoenix: { cheats: ['setvar heroquest 2'], extra: [{ name: 'ice_gloves', n: 1 }], wear: ['ice_gloves'], at: { x: 2772, z: 3230, level: 0 } },
            blackarm: { cheats: ['setvar heroquest 7'], extra: [{ name: 'ice_gloves', n: 1 }], wear: ['ice_gloves'], at: { x: 2772, z: 3230, level: 0 } } },
    entrana: { phoenix: { cheats: ['setvar heroquest 6'], extra: [{ name: 'ice_gloves', n: 1 }, { name: 'master_thief_armband', n: 1 }], wear: ['ice_gloves'], at: { x: 3212, z: 3426, level: 0 } },
               blackarm: { cheats: ['setvar heroquest 13'], extra: [{ name: 'ice_gloves', n: 1 }, { name: 'master_thief_armband', n: 1 }], wear: ['ice_gloves'], at: { x: 3212, z: 3426, level: 0 } } },
    eel: { phoenix: { cheats: ['setvar heroquest 6'], extra: [{ name: 'ice_gloves', n: 1 }, { name: 'master_thief_armband', n: 1 }, { name: 'hot_feather', n: 1 }, { name: 'oily_fishing_rod', n: 1 }], wear: ['ice_gloves'], at: { x: 3013, z: 3226, level: 0 } },
           blackarm: { cheats: ['setvar heroquest 13'], extra: [{ name: 'ice_gloves', n: 1 }, { name: 'master_thief_armband', n: 1 }, { name: 'hot_feather', n: 1 }, { name: 'oily_fishing_rod', n: 1 }], wear: ['ice_gloves'], at: { x: 3013, z: 3226, level: 0 } } },
};

const prefix = sim ? (arg('--sim') && !arg('--sim')!.startsWith('-') ? arg('--sim')! : `sph${Date.now() % 10000}`) : '';
const pName = live ? arg('--live', 1)! : `${prefix}p`, bName = live ? arg('--live', 2)! : `${prefix}b`;
if (!pName || !bName || pName.startsWith('-') || bName.startsWith('-')) { console.error('--live needs <phoenix> <blackarm>'); process.exit(2); }
const [pb, bb] = live ? [await createLive(readBotEnv(pName)), await createLive(readBotEnv(bName))] : [await SpeedBot.create(pName), await SpeedBot.create(bName)];
await Promise.all([pb.tick(3), bb.tick(3)]);
const fin = async (code: number, s: string): Promise<never> => { console.log(s); for (const b of [pb, bb]) { try { await b.logout(); } catch { /* gone */ } } process.exit(code); };

if (sim) {
    await Promise.all((['phoenix', 'blackarm'] as const).map(async g => {
        const bot = g === 'phoenix' ? pb : bb;
        const r = FROM ? RESUME[FROM]?.[g] : undefined;
        const setup: SimSetup = { cheats: [...QP65, ...GANG[g], ...(r?.cheats ?? [])], stats: STATS, extra: r?.extra };
        await simPrep(bot, Q.SUPPLY[g], [], setup, r?.at ?? Q.REQUIREMENTS.start);
        if (r?.wear?.length) await wieldAll(bot, r.wear);
        const lack = (r?.extra ?? []).filter(i => bot.count(objId(i.name)) + (bot.isWorn(objId(i.name)) ? 1 : 0) < i.n).map(i => i.name);
        if (lack.length) console.log(`[hero] ${g}: resume items NOT given: ${lack.join(', ')}`);
    }));
}
for (const [g, bot] of [['phoenix', pb], ['blackarm', bb]] as const) {
    const miss = missing(bot, { SUPPLY: Q.SUPPLY[g], REQUIREMENTS: Q.REQUIREMENTS });
    if (miss.length) await fin(1, `[hero] ${g} ${bot.loginUser}: missing ${miss.join(', ')}`);
}
const qp0 = [qp(pb), qp(bb)];
console.log(`[hero] phoenix ${pName} + black arm ${bName}: start ${JSON.stringify(pb.pos())} qp ${qp0.join('/')}${FROM ? ` from ${FROM}` : ''}`);
const t0 = Math.max(pb.tickCount, bb.tickCount);
const r = await Q.runPair(pb, bb, { log: true, from: FROM });
for (const [g, bot] of [['phoenix', pb], ['blackarm', bb]] as const) console.log(`[hero] ${g} pack: ${bot.inv().map(x => `${objDebugName(x.obj)}${x.count > 1 ? ` x${x.count}` : ''}`).join(', ')}`);
console.log(`[hero] phoenix: ${r.phoenix.ok ? 'OK' : 'FAILED'} ${r.phoenix.ticks} t ${r.phoenix.msg}`);
console.log(`[hero] blackarm: ${r.blackarm.ok ? 'OK' : 'FAILED'} ${r.blackarm.ticks} t ${r.blackarm.msg}`);
void t0;
if (r.phoenix.ok && r.blackarm.ok) await fin(0, `[hero] QUEST COMPLETE in ${Math.max(r.phoenix.ticks, r.blackarm.ticks)} ticks (both accounts; phoenix ${r.phoenix.ticks}, black arm ${r.blackarm.ticks}; qp ${qp0.join('/')} -> ${qp(pb)}/${qp(bb)})`);
await fin(1, '[hero] FAILED');
