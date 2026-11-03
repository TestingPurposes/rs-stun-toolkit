// =====================================================================================================
// legs/legends/run-legends.ts — standalone launcher for the Legends' Quest bot (segments A..E, seg-*.ts).
// =====================================================================================================
// Three modes:
//
//   LIVE (any server, NO cheats — every staff command throws):
//     bun headless/speedrun/legs/legends/run-legends.ts --live <account> [--from A] [--to E]
//       reads bots/<account>/bot.env (BOT_USERNAME, PASSWORD, SERVER); set LC_HOST=<server> if SERVER is not the default.
//     Requirements: REQUIREMENTS in common.ts (107 QP + five quests, skill levels, start outside the Legends' Guild gate).
//     The script checks the skill levels before it starts (quests cannot be read from the client). Every hand-off point
//     (the start of each segment, and the mid-segment kits B/C/D ask for) is a PACK CHECK in live mode: when anything is
//     short the run stops and prints the missing list. Fetch it (bank) and resume with --from <that segment>.
//     NOT RUN LIVE YET. Several hand-off points are inside the Kharazi jungle / the Shaman caves (see SHARE.md).
//
//   SIM (a LOCAL engine with staff cheats, e.g. the rs-sdk lockstep sim):
//     LC_HOST=localhost:<port> SIM_LOCKSTEP=1 TELEMETRY=false bun headless/speedrun/legs/legends/run-legends.ts --sim [name] [--from A] [--to E]
//       fresh account: cheats in the prerequisites (PREREQ: quest varps, 99 stats), the state before --from (each segment's
//       `pre`), and every supply kit at its hand-off point. Refuses any non-local host. Use a new name per run.
//
//   --supply  prints every kit (before each segment AND the mid-segment ones) and exits.
import { SpeedBot, runLeg, CHEATS, objId, objDebugName } from '../../core.js';
import { readBotEnv, createLive } from '../k-live.js';
import { simSetup, REQUIREMENTS, type Seg } from './common.js';
import { SEG_A, SEG_E } from './seg-a.js';
import { SEG_B, SEG_B_RESUPPLY } from './seg-b.js';
import { SEG_C, SEG_C_KIT, MIN_SHARKS } from './seg-c.js';
import { SEG_D, HANDOFF1, RESUPPLY } from './seg-d.js';

type Item = { name: string; n: number };
const SEGS: Seg[] = [SEG_A, SEG_B, SEG_C, SEG_D, SEG_E];
/** every kit, in the order the run asks for them (`when` = where the hand-off happens) */
const KITS: Array<{ seg: Seg['id']; when: string; items: Item[] }> = [
    { seg: 'A', when: 'before A (outside the Legends\' Guild gate)', items: SEG_A.supply },
    { seg: 'B', when: 'before B (fight kit; A ends in the Kharazi jungle by the cave rocks)', items: SEG_B.supply },
    { seg: 'B', when: 'B, right after it drops A\'s junk (quest kit, 16 slots)', items: SEG_B_RESUPPLY },
    { seg: 'C', when: 'C, right after it drops B\'s junk (inside the Shaman caves, next to Ungadulu)', items: [...SEG_C_KIT, { name: 'shark', n: MIN_SHARKS }] },
    { seg: 'D', when: 'D hand-off 1, at the start (lower dungeon, Echned\'s boulder)', items: HANDOFF1 },
    { seg: 'D', when: 'D hand-off 2, in the Kharazi jungle before the final summon (sharks are trimmed to the free slots)', items: RESUPPLY },
    { seg: 'E', when: 'E, at the start (Kharazi jungle, by the totem)', items: SEG_E.supply },
];

const arg = (k: string) => { const i = process.argv.indexOf(k); return i >= 0 ? process.argv[i + 1] : undefined; };
const show = (l: Item[]) => l.map(i => { let id = -1; try { id = objId(i.name); } catch { /* unknown */ } return `${i.name} (${id}) x${i.n}`; }).join(', ');
if (process.argv.includes('--supply')) {
    for (const k of KITS) console.log(`${k.seg} | ${k.when}:\n    ${show(k.items)}`);
    // the cheatless route runner uses HELPER MODE instead (kits.ts): no hand-off inside the jungle/caves
    const { HELPER_CARRY, HELPER_MEETS } = await import('./kits.js');
    console.log(`\nHELPER MODE (route runner, qp/route/route-legs.ts):\nA | carried in from the bank before the quest:\n    ${show(HELPER_CARRY)}`);
    for (const k of HELPER_MEETS) console.log(`${k.seg} | helper meeting, ${k.when}:\n    ${show(k.items)}`);
    process.exit(0);
}

const live = arg('--live'), sim = process.argv.includes('--sim');
if (!!live === sim) { console.error('use exactly one of --live <account> | --sim [name] (or --supply)'); process.exit(2); }
const LOCAL = /^(localhost|127\.)/.test(process.env.LC_HOST ?? '');
if (sim && !LOCAL) { console.error('--sim needs a local LC_HOST (it uses staff cheats)'); process.exit(2); }
if (live) CHEATS.blocked = 'run-legends --live';   // any cheat call now throws

const from = (arg('--from') ?? 'A').toUpperCase(), to = (arg('--to') ?? 'E').toUpperCase();
const i0 = SEGS.findIndex(s => s.id === from), i1 = SEGS.findIndex(s => s.id === to);
if (i0 < 0 || i1 < i0) { console.error(`bad --from/--to (${from}..${to}); segments are A B C D E`); process.exit(2); }

const simName = arg('--sim') && !arg('--sim')!.startsWith('-') ? arg('--sim')! : `leg${Date.now() % 1000000}`;
const bot = live ? await createLive(readBotEnv(live)) : await SpeedBot.create(simName.slice(0, 12));
await bot.tick(3);
const stop = async (code: number): Promise<never> => { await bot.logout(); process.exit(code); };
const scim = objId('rune_scimitar');
const have = (i: Item) => bot.count(objId(i.name)) + (objId(i.name) === scim && bot.isWorn(scim) ? 1 : 0);
const missing = (l: Item[]) => l.filter(i => have(i) < i.n).map(i => ({ name: i.name, n: i.n - have(i) }));
const pack = () => bot.inv().map(x => `${objDebugName(x.obj)}${x.count > 1 ? ` x${x.count}` : ''}`).join(', ');

/** LIVE hand-off = pack check. Stops the run with the missing list `m` (the segment is restarted with --from). */
async function liveStop(seg: Seg, tag: string, m: Item[]): Promise<void> {
    m = m.filter(i => i.n > 0);
    if (!m.length) return;
    console.error(`[legends] ${tag}: MISSING ${m.map(i => `${i.name} x${i.n}`).join(', ')}`);
    console.error(`[legends] pack (${bot.inv().length}/28): ${pack()}`);
    console.error(`[legends] bring these (bank trip) and rerun: --live ${live} --from ${seg.id}`);
    await stop(1);
}

if (live) {
    const low = Object.entries(REQUIREMENTS.skills).filter(([s, r]) => bot.stat(s).level < r.level);
    if (low.length) {
        for (const [s, r] of low) console.error(`[legends] ${s} ${bot.stat(s).level} < ${r.level}: ${r.why}`);
        if (process.env.LEG_IGNORE_LEVELS !== '1') { console.error('[legends] levels too low (LEG_IGNORE_LEVELS=1 runs anyway)'); await stop(2); }
    }
    console.log(`[legends] live ${bot.loginUser}: needs ${REQUIREMENTS.questPoints} QP + ${REQUIREMENTS.quests.join(', ')} (not checkable from the client)`);
} else {
    const first = SEGS[i0]!;
    console.log(`[legends] sim ${bot.loginUser}: setup for segment ${first.id} (stage ${first.fromStage})`);
    await simSetup(bot, { ...first.pre, items: [...(first.pre.items ?? []), ...first.supply] });
    await bot.tick(2);
}

const t0 = bot.tickCount, marks: Record<string, number> = {};
for (let i = i0; i <= i1; i++) {
    const s = SEGS[i]!;
    if (live) await liveStop(s, `before ${s.id}`, missing(s.supply));
    else if (i > i0 && s.supply.length) await simSetup(bot, { items: s.supply });
    // A, B, C and E call resupply with what is still MISSING (a delta); D passes its full kit (sharks trimmed to the free slots)
    const resupply = live
        ? async (items: Item[]) => { await liveStop(s, `segment ${s.id} hand-off`, s.id === 'D' ? missing(items) : items); }
        : async (items: Item[]) => { await simSetup(bot, { items }); };
    const ts = bot.tickCount;
    const { rec, result } = await runLeg(bot, `legends-${s.id}`, b => s.run(b, { verbose: true, resupply }));
    marks[s.id] = bot.tickCount - ts;
    console.log(`[legends] segment ${s.id} ${rec.ok ? 'OK' : 'FAILED'} in ${marks[s.id]} t ${JSON.stringify(result ?? null).slice(0, 400)}`);
    if (!rec.ok || (result as { ok?: boolean } | undefined)?.ok === false) {
        console.log(`[legends] STOP at ${s.id}; segments ${JSON.stringify(marks)}; pack: ${pack()}`);
        await stop(1);
    }
}
console.log(`[legends] DONE ${from}..${to} in ${bot.tickCount - t0} t; segments ${JSON.stringify(marks)}${to === 'E' ? ' — QUEST COMPLETE' : ''}`);
await stop(0);
