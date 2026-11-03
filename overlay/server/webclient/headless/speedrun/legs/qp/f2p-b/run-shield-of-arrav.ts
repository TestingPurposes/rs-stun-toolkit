/// <reference types="bun" />
// run-shield-of-arrav.ts — launcher for Shield of Arrav, a PAIR (q-shield-of-arrav.ts): one Phoenix + one Black Arm account.
//   --live <phoenixAccount> <blackarmAccount>   both in this process (CHEATS.blocked first: any staff command throws)
//   --live-one phoenix|blackarm <account> <partnerName>   one side only (run the other side in a second process)
//   --sim [name]      local LC_HOST only: two fresh accounts <name>p / <name>b; drops the tutorial kit, sets the sim stats,
//                     hands over each side's SUPPLY, teleports both to REQUIREMENTS.start, runs both sides in parallel.
//   --xbows-supplied  variant FAST: the Black Arm account starts with 2 phoenix crossbows (helper); no weapon store.
//   --supply          prints both supply lists and exits.
// Prints "QUEST COMPLETE in <n> ticks" when BOTH accounts are complete (n = the slower side; each side's ticks are printed).
import { SpeedBot, CHEATS, localSetup, objId, objDebugName } from '../../../core.js';
import { readBotEnv, createLive } from '../../k-live.js';
import { dropAllOf, KIT_JUNK, qp } from '../../q-lib.js';
import { simStats } from './fb-launch.js';
import * as Q from './q-shield-of-arrav.js';

const arg = (k: string, i = 1) => { const j = process.argv.indexOf(k); return j >= 0 ? process.argv[j + i] : undefined; };
const show = (l: Array<{ name: string; n: number }>) => l.map(i => `${i.name} x${i.n}`).join(', ') || '(nothing)';
if (process.argv.includes('--supply')) {
    console.log(`Shield of Arrav — Phoenix account: ${show(Q.SUPPLY_PHOENIX)}; Black Arm account: ${show(Q.SUPPLY_BLACKARM)} (variant --xbows-supplied: ${show(Q.SUPPLY_BLACKARM_FAST)})`);
    console.log(`Phoenix skills: ${Object.entries(Q.REQUIREMENTS.skills).map(([s, [l, w]]) => `${s} ${l} (${w})`).join('; ')}`);
    console.log(`completion varps: ${JSON.stringify(Q.COMPLETE_VARPS)}`);
    process.exit(0);
}
const live = arg('--live'), liveOne = arg('--live-one'), sim = process.argv.includes('--sim');
if ([!!live, !!liveOne, sim].filter(Boolean).length !== 1) { console.error('use one of --live <phoenix> <blackarm> | --live-one phoenix|blackarm <acct> <partner> | --sim [name] | --supply'); process.exit(2); }
if (sim && !/^(localhost|127\.)/.test(process.env.LC_HOST ?? '')) { console.error('--sim needs a local LC_HOST'); process.exit(2); }
if (!sim) CHEATS.blocked = 'run-shield-of-arrav --live';

const FAST = process.argv.includes('--xbows-supplied');
const SIM_STATS_P = simStats({ attack: 60, strength: 60, defence: 30, hitpoints: 30 });
type Side = { gang: 'phoenix' | 'blackarm'; bot: SpeedBot; partner: string };
const sides: Side[] = [];
if (sim) {
    const base = arg('--sim') && !arg('--sim')!.startsWith('-') ? arg('--sim')! : `fb${Date.now() % 100000}`;
    if (base.length > 11) { console.error('sim name <= 11 chars (p/b suffix)'); process.exit(2); }
    const p = await SpeedBot.create(`${base}p`), b = await SpeedBot.create(`${base}b`);
    sides.push({ gang: 'phoenix', bot: p, partner: b.loginUser }, { gang: 'blackarm', bot: b, partner: p.loginUser });
    for (const s of sides) {
        await s.bot.tick(3);
        dropAllOf(s.bot, [...KIT_JUNK, 'airrune', 'waterrune']); await s.bot.tick(3);
        if (s.gang === 'phoenix') { await localSetup(s.bot, { stats: SIM_STATS_P }); console.log(`[arrav] phoenix sim stats ${JSON.stringify(SIM_STATS_P)}`); }
        const sup = s.gang === 'phoenix' ? Q.SUPPLY_PHOENIX : FAST ? Q.SUPPLY_BLACKARM_FAST : Q.SUPPLY_BLACKARM;
        if (sup.length) await localSetup(s.bot, { items: sup.map(i => ({ name: i.name, n: i.n })) });
        const st = Q.REQUIREMENTS.start;
        await localSetup(s.bot, { tele: { x: st.x + (s.gang === 'phoenix' ? 0 : 1), z: st.z, level: st.level } });
    }
} else if (live) {
    const pa = live, ba = arg('--live', 2);
    if (!ba) { console.error('--live <phoenixAccount> <blackarmAccount>'); process.exit(2); }
    const p = await createLive(readBotEnv(pa)), b = await createLive(readBotEnv(ba));
    sides.push({ gang: 'phoenix', bot: p, partner: b.loginUser }, { gang: 'blackarm', bot: b, partner: p.loginUser });
} else {
    const gang = liveOne as 'phoenix' | 'blackarm', acct = arg('--live-one', 2), partner = arg('--live-one', 3);
    if (!['phoenix', 'blackarm'].includes(gang) || !acct || !partner) { console.error('--live-one phoenix|blackarm <account> <partnerName>'); process.exit(2); }
    sides.push({ gang, bot: await createLive(readBotEnv(acct)), partner });
}
for (const s of sides) {
    const sup = s.gang === 'phoenix' ? Q.SUPPLY_PHOENIX : Q.SUPPLY_BLACKARM;
    const miss = sup.filter(i => s.bot.count(objId(i.name)) < i.n && i.name !== 'lobster').map(i => i.name);
    if (miss.length) { console.error(`[arrav] ${s.bot.loginUser} missing ${miss.join(',')}`); process.exit(1); }
}
const qp0 = sides.map(s => qp(s.bot));
console.log(`[arrav] ${sides.map(s => `${s.gang}=${s.bot.loginUser}@${JSON.stringify(s.bot.pos())}`).join(' ')}`);
const res = await Promise.all(sides.map(s => s.gang === 'phoenix' ? Q.runPhoenix(s.bot, s.partner, { xbowsSupplied: FAST }) : Q.runBlackArm(s.bot, s.partner)));
let ok = true;
sides.forEach((s, i) => {
    const r = res[i]!;
    console.log(`[arrav] ${s.gang} ${s.bot.loginUser}: ${r.ok ? 'complete' : 'FAILED'} in ${r.ticks} ticks, qp ${qp0[i]} -> ${qp(s.bot)} | ${r.msg}`);
    console.log(`[arrav] ${s.gang} pack: ${s.bot.inv().map(x => `${objDebugName(x.obj)}${x.count > 1 ? ` x${x.count}` : ''}`).join(', ')}`);
    ok &&= r.ok;
});
if (ok) console.log(`[arrav] QUEST COMPLETE in ${Math.max(...res.map(r => r.ticks))} ticks (both gangs: ${sides.map((s, i) => `${s.gang} ${res[i]!.ticks}`).join(', ')})`);
for (const s of sides) { try { await s.bot.logout(); } catch { /* gone */ } }
process.exit(ok ? 0 : 1);
