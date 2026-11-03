// q-imp.ts — Imp Catcher, tick-tight (speedrun route leg 1, right after the tutorial skip). LOCAL ONLY.
//
// PRECONDITIONS: fresh account straight out of the tutorial skip at Lumbridge (3222,32xx), L0, the 18-slot starter
//   kit in the pack. Beads (red/yellow/black/white x1) in the pack (demo: helper trade; local: cheat).
// EXIT STATE: Wizards' Tower L2 next to Mizgog (~3104,3162), magic 44 (21,875 xp), amulet of accuracy in the pack,
//   quest-complete scroll open (the next leg's teleport closes it). Kept from the kit: air x25, water x6 (+ the
//   law rune if the helper already handed it over) for the Falador teleport that starts q-doric.
// SUPPLY (helper -> trainee): red_bead 1470, yellow_bead 1472, black_bead 1474, white_bead 1476 (1 each)
//   + lawrune 563 x1 for q-doric's Falador teleport (same trade).
//
// Run from server/webclient:  LC_HOST=localhost:8888 bun headless/speedrun/legs/q-imp.ts [suffix]
import { SpeedBot, runLeg, localSetup } from '../core.js';
import { nav, locAt, opLocGo, talk, dropAllOf, KIT_JUNK, npc, log, trace, walkOp, prePlan, drive, inDialog, opNpcGo, R, X, M2, M3, type FTok } from './q-lib.js';
import { cheb } from '../core.js';
import { isResuming, journalStage, failHook } from './qp/journal.js';

export const MIZGOG = 706;
export const IMP_KEEP = ['airrune', 'waterrune', 'lawrune', 'red_bead', 'yellow_bead', 'black_bead', 'white_bead'];
export const IMP_SUPPLY = [{ name: 'red_bead', n: 1 }, { name: 'yellow_bead', n: 1 }, { name: 'black_bead', n: 1 }, { name: 'white_bead', n: 1 }, { name: 'lawrune', n: 1 }];

/** Offline prep (before login on the demo): plan the 188-tile route so the leg does not spend ~3 ticks of CPU on it. */
export async function impPrep(from = { x: 3222, z: 3222 }): Promise<number> { return prePlan(0, from, { x: 3105, z: 3160 }); }

export async function impLeg(bot: SpeedBot, o: { verbose?: boolean } = {}): Promise<Record<string, number | boolean>> {
    await nav();
    bot.holdDialogs = true;
    const t0 = bot.tickCount, mark: Record<string, number | boolean> = {};
    trace(bot, t0);
    // session 11 (re-entrant, so the route may retry it): on a retry the journal says whether it is complete already, and the
    // stairs already climbed are skipped (Wizards' Tower L1/L2: route-legs resumeHere keeps us there). IMP_RESUME=0 = as before.
    const resume = isResuming(bot) && process.env.IMP_RESUME !== '0';
    if (resume && (await journalStage(bot, 'imp', [[/QUEST COMPLETE/i, 'done']], 'open', s => log(bot, t0, s))) === 'done') return { ...mark, ok: true, resumed: true };
    const onTower = (lv: number) => bot.minusedlevel === lv && cheb(bot.tile(), { x: 3105, z: 3160 }) <= 12;
    if (!(resume && (onTower(1) || onTower(2)))) {
    // 1. run to the tower stairs; drop the kit in the same ticks (MOVE first, the drops carry over 5/tick)
    const stairs0 = locAt(1738, 3103, 3159, 0);
    const w = walkOp(bot, { x: 3105, z: 3160 }, () => bot.opLoc(stairs0.x, stairs0.z, stairs0.id, 1), () => bot.minusedlevel === 1, { maxTicks: 200 });
    await new Promise(r => setImmediate(r));
    mark.dropped = dropAllOf(bot, KIT_JUNK);
    if (!(await w)) throw new Error(`walk / L0 stairs failed at ${JSON.stringify(bot.pos())}`);
    }
    mark.l1 = bot.tickCount - t0;
    failHook('imp:l1');
    if (!(resume && onTower(2))) {
    // 2. L1 -> L2: loc_1739 op2 "Climb-up" (op1 opens an up/down menu); the L1 landing tile is already in reach
    opLocGo(bot, locAt(1739, 3103, 3159, 1), 2);
    // route session 5 (chaos qsam: 'L1 stairs failed at 3109,3163 L1' = one try only): from the 2nd try walk back to the
    // stairs first (core walkTo opens a closed door on the way), then climb again
    for (let k = 0; k < 3 && !(await bot.until(() => bot.minusedlevel === 2, 8 + 4 * k)); k++) {
        if (bot.minusedlevel === 1) await bot.walkTo(3105, 3160, { level: 1, near: 2, closeDoors: true, maxTicks: 40 });
        if (bot.chatModalId !== -1 || bot.mainModalId !== -1) { try { (bot as any).closeModal?.(); } catch { /* none */ } await bot.tick(1); }
        opLocGo(bot, locAt(1739, 3103, 3159, 1), 2);
    }
    if (bot.minusedlevel !== 2) throw new Error(`L1 stairs failed at ${JSON.stringify(bot.pos())}`);
    }
    mark.l2 = bot.tickCount - t0;
    failHook('imp:l2');
    // 3. Mizgog: talk 1 (start) and talk 2 (hand in) as ONE token stream.
    //    talk 1: chatnpc | multi2 "Give me a quest!" | chatplayer | chatnpc | multi3 "Give me a quest please." |
    //            chatplayer | 5 chatnpc -> %imp = 1 ("I'll try." page open)  => 11 tokens, then OPNPC again,
    //    FENCE (talk 2's first page only opens in the OPNPC's own tick), then talk 2:
    //            chatnpc | chatplayer | chatnpc | mesbox -> beads deleted + queue(imp_quest_complete) | CLOSE
    //            (the queue only runs when no modal is open: closing in the same tick fires the reward that tick).
    let mizIdx = -1;
    const magic0 = bot.stat('magic').xp;   // reward = magic xp (a level test is already true on a magic-44+ account)
    const reop = { fn: () => { const n = npc(bot, MIZGOG); if (n) bot.opNpc(n.idx, 1); }, cost: 1 };
    const plan: FTok[] = [R, M2[0]!, R, R, M3[0]!, R, R, R, R, R, R, reop, 'F', R, R, R, R, X];
    const r = await talk(bot, MIZGOG, plan as any, {
        done: () => bot.stat('magic').xp > magic0,
        answers: [/^Give me a quest!$/, /^Give me a quest please\.$/],
        maxTicks: 40, label: 'mizgog',
    });
    void mizIdx;
    mark.firstPage = r.firstPage + (mark.l2 as number);
    // session 11: the burst plan desyncs on a half-done quest (a retry: Mizgog asks for the beads) or a closed page: adaptive
    // talks until the reward lands (only when the plan did not finish). IMP_RESUME=0 = as before.
    for (let k = 0; k < 4 && !(bot.stat('magic').xp > magic0) && process.env.IMP_RESUME !== '0'; k++) {
        if (bot.chatModalId === -1) {
            if (bot.mainModalId !== -1) { bot.closeModal(); bot.queueFlush(); await bot.tick(1); }
            const opened = await walkOp(bot, { x: 3104, z: 3161 }, () => { const n = npc(bot, MIZGOG); if (!n) return false; opNpcGo(bot, n, 1); return true; }, () => inDialog(bot) || bot.stat('magic').xp > magic0, { near: 1, maxTicks: 40, level: 2 } as any);
            if (!opened) continue;
        }
        await drive(bot, () => bot.stat('magic').xp > magic0 || bot.chatModalId === -1, [/^Give me a quest!$/, /^Give me a quest please\.$/], 40);
        if (bot.chatModalId === -1) await bot.until(() => bot.stat('magic').xp > magic0, 3);
        mark.fallback = k + 1;
    }
    mark.done = bot.tickCount - t0;
    mark.ok = r.ok || bot.stat('magic').xp > magic0;
    if (o.verbose) log(bot, t0, `Mizgog ${JSON.stringify(r)} magic=${JSON.stringify(bot.stat('magic'))} pos=${JSON.stringify(bot.pos())}`);
    return mark;
}

if (import.meta.main) {
    if (!/^(localhost|127\.)/.test(process.env.LC_HOST ?? '')) { console.error('set LC_HOST=localhost:8888'); process.exit(1); }
    const sfx = process.argv[2] ?? String(Date.now() % 100000);
    const bot = await SpeedBot.create(`qimp${sfx}`);
    const skipTicks = bot.tickCount;
    console.log(`[q-imp] logged in + tutorial skipped in ${skipTicks} ticks at ${JSON.stringify(bot.pos())}, inv ${bot.inv().length} stacks`);
    await localSetup(bot, { items: IMP_SUPPLY });
    await impPrep(bot.tile());
    await bot.tick(1);
    const { rec } = await runLeg(bot, 'q-imp-catcher', b => impLeg(b, { verbose: true }));
    console.log(`[q-imp] ${JSON.stringify(rec.result)} | leg ${rec.ticks} ticks (+${skipTicks} login/skip) | gh_kadeski 138 incl. skip`);
    await bot.logout();
    process.exit(rec.ok ? 0 : 1);
}
