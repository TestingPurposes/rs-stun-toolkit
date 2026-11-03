// q-doric.ts — Doric's Quest, tick-tight (speedrun route leg 2, straight after q-imp). LOCAL ONLY.
//
// PRECONDITIONS: magic >= 37 (q-imp leaves 44), anywhere a teleport works (q-imp leaves us on Wizards' Tower L2 with
//   the quest scroll open). Pack: airrune >= 3, waterrune >= 1, lawrune >= 1 (Falador teleport), clay x6, copper_ore
//   x4, iron_ore x2, >= 0 free slots (the reward adds nothing; the abandoned 180 coins are never added).
// EXIT STATE: Doric's house (~2951,3450), mining 49 (32,500 xp), magic 45 (Falador teleport xp), quest scroll open.
//   Pack: what q-imp left minus 3 air + 1 water + 1 law (air 22, water 5, amulet of accuracy).
// SUPPLY (helper -> trainee, best in q-imp's bead trade so no extra trade is needed): clay 434 x6, copper_ore 436 x4,
//   iron_ore 440 x2, lawrune 563 x1.
//
// Run from server/webclient:  LC_HOST=localhost:8888 bun headless/speedrun/legs/q-doric.ts [suffix]
//   (runs q-imp first from a fresh account so the start state is the real one; both legs are logged)
import { SpeedBot, runLeg, localSetup, cheb } from '../core.js';
import { nav, talk, drive, npc, inDialog, log, trace, walkOp, prePlanArea, tele, dropAllOf, KIT_JUNK, opNpcGo, R, X, M2, M4, type FTok, situation } from './q-lib.js';
import { impLeg, impPrep, IMP_SUPPLY } from './q-imp.js';
import * as locScene from '../../loc-scene.js';
import { isResuming, journalStage, failHook } from './qp/journal.js';

export const DORIC = 284;
export const DORIC_SUPPLY = [{ name: 'clay', n: 6 }, { name: 'copper_ore', n: 4 }, { name: 'iron_ore', n: 2 }];
const FALADOR_TELE = { x: 2965, z: 3378 };
const DORIC_AT = { x: 2952, z: 3451 };
const DORIC_DOOR = { id: 1530, x: 2952, z: 3453, level: 0 };   // the closed leaf (static map)
const DORIC_DOOR_OPEN_KEY = '0,2952,3452';   // an OPEN door shows as a live loc here (1531); the closed leaf's tile only gets a LOC_DEL

export async function doricPrep(): Promise<void> { await prePlanArea(0, FALADOR_TELE, 2, DORIC_AT); }

export async function doricLeg(bot: SpeedBot, o: { verbose?: boolean } = {}): Promise<Record<string, number | boolean>> {
    await nav();
    bot.holdDialogs = true;
    const t0 = bot.tickCount, mark: Record<string, number | boolean> = {};
    trace(bot, t0);
    const mine0 = bot.stat('mining').xp;   // reward = mining xp (a level test is already true on a mining-49+ account)
    const rewarded = () => bot.stat('mining').xp > mine0;
    // session 11 (re-entrant, so the route may retry it): on a retry, QUEST COMPLETE in the journal = done; otherwise the talk
    // below and its adaptive fallback handle a half-done quest. DORIC_RESUME=0 = as before.
    if (isResuming(bot) && process.env.DORIC_RESUME !== '0' && (await journalStage(bot, 'doric', [[/QUEST COMPLETE/i, 'done']], 'open', s => log(bot, t0, s))) === 'done') return { ...mark, ok: true, resumed: true };
    // 1. Falador teleport (CLOSE_MODAL for the quest scroll + the spell in one burst)
    // a retry (runner reloginRetry) starts next to Doric with the teleport already spent: walk on from here
    if (cheb(bot.tile(), DORIC_AT) > 120) {   // Falador square (the teleport spot) is 73 away
        const tr = await tele(bot, 'falador_teleport');
        if (!tr.ok) throw new Error(`falador teleport failed at ${JSON.stringify(bot.pos())}`);
    }
    mark.tele = bot.tickCount - t0;
    failHook('doric:tele');
    // 2. run to Doric; OPNPC rides on the last MOVE chunk (re-tried once he is in view)
    // Doric's front door (loc 1530 on the south edge of (2952,3453)) is toggled by other players on the demo: while it is
    // shut, every OPNPC from outside is silently dropped (live zt8/ba5 + probe). Open it first, then talk.
    const opDoric = () => {
        const n = npc(bot, DORIC); if (!n) return false;
        if (!(bot as any).__doricDiag) { (bot as any).__doricDiag = 1; console.log(`[diag] doric arrive: open leaf 1531@2952,3452 ${bot.liveLocs.has(DORIC_DOOR_OPEN_KEY) ? 'PRESENT (door OPEN)' : 'absent (door SHUT)'}; Doric @${n.x},${n.z}; us ${bot.tile().x},${bot.tile().z} | ${situation(bot)}`); }   // rig diag
        if (!bot.liveLocs.has(DORIC_DOOR_OPEN_KEY) && n.z >= DORIC_DOOR.z && bot.tile().z < DORIC_DOOR.z) { console.log(`[doric] door (2952,3453) is SHUT (Doric inside at ${n.x},${n.z}, us ${bot.tile().x},${bot.tile().z}): opening it`); { const door = locScene.getNearbyLocs(DORIC_DOOR.x, DORIC_DOOR.z, 0, 0).find(l => l.id === DORIC_DOOR.id && l.x === DORIC_DOOR.x && l.z === DORIC_DOOR.z); if (door) bot.opLocReach(door, 1); else bot.opLoc(DORIC_DOOR.x, DORIC_DOOR.z, DORIC_DOOR.id, 1); } return true; }   // rig: a bare OPLOC from out of reach is silently discarded (core.ts opLocReach), walk into reach first
        opNpcGo(bot, n, 1); return true;
    };
    const ok = await walkOp(bot, DORIC_AT, opDoric, () => inDialog(bot), { near: 1, maxTicks: 120 });
    if (!ok) throw new Error(`no Doric dialog at ${JSON.stringify(bot.pos())} modal ${bot.mainModalId}/${bot.chatModalId}/${(bot as any).sideModalId ?? '-'} doricNpc ${JSON.stringify(npc(bot, DORIC))} hold ${bot.holdDialogs}`);
    mark.firstPage = bot.tickCount - t0;
    failHook('doric:firstPage');
    // 3. talk 1: chatnpc | multi4 "I wanted to use your anvils." | chatplayer | chatnpc | multi2 "Yes, I will get you
    //    materials." | chatplayer -> %doricquest = 10.  Then OPNPC again + FENCE, talk 2: chatnpc | chatplayer |
    //    chatnpc -> ores deleted + queue(doric_quest_complete) | CLOSE (the queue runs once no modal is open).
    const reop = { fn: () => { const n = npc(bot, DORIC); if (n) bot.opNpc(n.idx, 1); }, cost: 1 };
    const plan: FTok[] = [R, M4[0]!, R, R, M2[0]!, R, reop, 'F', R, R, R, X];
    const r = await talk(bot, DORIC, plan as any, {
        noOp: true, done: () => rewarded(),
        answers: [/^I wanted to use your anvils\.$/, /^Yes, I will get you materials\.$/], maxTicks: 45, label: 'doric',
    });
    // fallback (the burst plan desyncs when Doric walks off mid-chain): adaptive talks until the reward lands
    for (let k = 0; k < 5 && !rewarded(); k++) {
        if (bot.chatModalId === -1) {
            if (bot.mainModalId !== -1) { bot.closeModal(); bot.queueFlush(); await bot.tick(1); }
            if (rewarded()) break;
            if (!(await walkOp(bot, DORIC_AT, opDoric, () => inDialog(bot) || rewarded(), { near: 1, maxTicks: 60 }))) continue;
        }
        await drive(bot, () => rewarded() || bot.chatModalId === -1, [/^I wanted to use your anvils\.$/, /^Yes, I will get you materials\.$/], 40);
        if (bot.chatModalId === -1) await bot.until(() => rewarded(), 3);
        mark.fallback = k + 1;
    }
    mark.done = bot.tickCount - t0;
    mark.ok = r.ok || rewarded();
    if (o.verbose) log(bot, t0, `Doric ${JSON.stringify(r)} mining=${JSON.stringify(bot.stat('mining'))} magic=${bot.stat('magic').level} pos=${JSON.stringify(bot.pos())}`);
    return mark;
}

if (import.meta.main) {
    if (!/^(localhost|127\.)/.test(process.env.LC_HOST ?? '')) { console.error('set LC_HOST=localhost:8888'); process.exit(1); }
    const sfx = process.argv[2] ?? String(Date.now() % 100000);
    const bot = await SpeedBot.create(`qdor${sfx}`);
    const skip = bot.tickCount;
    await localSetup(bot, { items: IMP_SUPPLY });
    await impPrep(bot.tile()); await doricPrep();
    await bot.tick(1);
    if (process.argv[3] === 'fast') {   // cheat straight to q-imp's exit state
        await localSetup(bot, { stats: { magic: 44 }, tele: { x: 3104, z: 3161, level: 2 } });
        dropAllOf(bot, KIT_JUNK); await bot.tick(5);
        await localSetup(bot, { items: DORIC_SUPPLY });
        const dor = await runLeg(bot, 'q-doric', b => doricLeg(b, { verbose: true }));
        console.log(`[q-doric] doric ${dor.rec.ticks} ${JSON.stringify(dor.rec.result)} | gh_kadeski ~69`);
        await bot.logout(); process.exit(dor.rec.ok ? 0 : 1);
    }
    const imp = await runLeg(bot, 'q-imp-catcher', b => impLeg(b));
    await localSetup(bot, { items: DORIC_SUPPLY });   // demo: in the same L2 trade as the beads (after the kit drop)
    const dor = await runLeg(bot, 'q-doric', b => doricLeg(b, { verbose: true }));
    console.log(`[q-doric] imp ${imp.rec.ticks} (+${skip} skip) ${JSON.stringify(imp.rec.result)}`);
    console.log(`[q-doric] doric ${dor.rec.ticks} ${JSON.stringify(dor.rec.result)} | gh_kadeski ~69 | cumulative ${skip + imp.rec.ticks + dor.rec.ticks} (gh 207)`);
    await bot.logout();
    process.exit(imp.rec.ok && dor.rec.ok ? 0 : 1);
}
