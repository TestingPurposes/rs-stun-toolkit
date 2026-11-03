// q-seaslug.ts — Sea Slug, tick-tight (speedrun: after q-doric and the firemaking leg). LOCAL ONLY.
//
// PRECONDITIONS: firemaking >= 30 (CURRENT level; "Rub-together" gate), magic >= 45, anywhere a teleport works.
//   Pack: airrune >= 5 + lawrune >= 1 (Camelot teleport), swamppaste x1, torch_unlit x1, 3+ free slots (glass,
//   damp sticks, oyster pearls). No weapons needed: nothing fights.
// EXIT STATE: next to Caroline (~2716,3303), fishing 74 (179,375 xp), 1 QP, oyster pearls 413 in the pack, quest
//   scroll open. Pack: torch_lit, dry_sticks? (consumed? no: kept), broken_glass gone (used), oyster pearls.
// SUPPLY (helper -> trainee): swamppaste 1941 x1, torch_unlit 596 x1, lawrune 563 x1 (+5 air if q-imp's 25 are gone).
//   damp_sticks 1467 and broken_glass 1469 are tradeable=no: picked up on the platform.
//
// Run from server/webclient:  LC_HOST=localhost:8888 bun headless/speedrun/legs/q-seaslug.ts [suffix]
import { SpeedBot, runLeg, localSetup, objId, objDebugName, cheb } from '../core.js';
import {
    nav, talk, npc, inDialog, log, trace, walkOp, prePlanArea, prePlan, tele, locAt, dropAllOf, KIT_JUNK, opNpcGo,
    sendToks, waitText, dismiss, opLocFrom, routeToLoc, addWalls, R, X, M2, type FTok,
} from './q-lib.js';
import { isResuming, journalStage, failHook } from './qp/journal.js';

const CAROLINE = 696, HOLGART_LAND = 700, HOLGART_PLATFORM = 699, KENT = 701, HOLGART_SUNK = 698;
const CAMELOT = { x: 2757, z: 3478 };
const CAROLINE_AT = { x: 2716, z: 3302 };
const PLATFORM = { x: 2782, z: 3273 }, ISLAND = { x: 2800, z: 3320 }, SHORE = { x: 2722, z: 3305 };
const GLASS = { x: 2765, z: 3278 }, STICKS = { x: 2784, z: 3289 };
const LADDER_STAND = { x: 2783, z: 3286 };
// npcs (fishermen) block player steps live and park around the crates: walkOp re-plans around them, and the
// stands below are tried in order
const CRATE_STANDS = [{ x: 2764, z: 3286 }, { x: 2765, z: 3287 }, { x: 2763, z: 3287 }], PANEL_STAND = { x: 2766, z: 3288 }, CRANE_STAND = { x: 2768, z: 3290 };
export const SEASLUG_SUPPLY = [{ name: 'swamppaste', n: 1 }, { name: 'torch_unlit', n: 1 }, { name: 'lawrune', n: 1 }];

export async function seaslugPrep(): Promise<void> {
    await prePlanArea(0, CAMELOT, 2, CAROLINE_AT);
    await prePlan(0, PLATFORM, GLASS); await prePlan(0, GLASS, STICKS);
}

export async function seaslugLeg(bot: SpeedBot, o: { verbose?: boolean } = {}): Promise<Record<string, number | boolean>> {
    await nav();
    bot.holdDialogs = true;
    const t0 = bot.tickCount, m: Record<string, number | boolean> = {};
    const at = (k: string) => { m[k] = bot.tickCount - t0; if (o.verbose) log(bot, t0, `${k} pos=${JSON.stringify(bot.pos())}`); failHook(`ss:${k}`); };
    trace(bot, t0);
    const opN = (type: number) => () => { const n = npc(bot, type); if (!n) return false; opNpcGo(bot, n, 1); return true; };
    const goN = (type: number) => ({ fn: () => { const n = npc(bot, type); if (n) opNpcGo(bot, n, 1); }, cost: 2 });
    const ladder0 = locAt(2517, 2784, 3286, 0), ladder1 = locAt(1746, 2784, 3286, 1);
    const crates = locAt(2519, 2764, 3287, 1), panel = locAt(2518, 2765, 3288, 1), crane = locAt(2520, 2768, 3286, 1);
    const near = (p: { x: number; z: number }, d = 3) => cheb(bot.tile(), p) <= d && bot.minusedlevel === 0;

    // 287 (qx34m 'no Holgart (platform) dialog 2', INFERRED from the log; a plain fork qyt04 did not reproduce): from the ladder
    // the walk to Holgart goes round the west side of the platform (1-tile walkways; the fishermen park there). It stopped at
    // (2769,3278), a re-plan WITH npc blocks found no way past the npc and walkOp's no-route bail gave up within ~3 t; the
    // retry 3 t later (npc gone, first plan without npc blocks) walked it at once. No drop, no modal. Fix: up to 4 rounds,
    // 3 t apart (the npc moves on), 150 t in all. SS_HOLGART_ROUNDS=1 = as before; SS_HOLGART_TEST=1 = round 1 is cut
    // after 1 t (forced failure: proves the re-try path).
    const toHolgartPlatform = async (which: number): Promise<boolean> => {
        const rounds = Math.max(1, Number(process.env.SS_HOLGART_ROUNDS ?? 4)), end = bot.tickCount + 150;
        for (let k = 0; k < rounds && bot.tickCount < end; k++) {
            const test = k === 0 && process.env.SS_HOLGART_TEST === '1';
            if (await walkOp(bot, { x: 2782, z: 3277 }, opN(HOLGART_PLATFORM), () => inDialog(bot), { near: 1, maxTicks: test ? 1 : Math.max(10, end - bot.tickCount) })) return true;
            if (k + 1 >= rounds) break;
            const h = npc(bot, HOLGART_PLATFORM);
            console.log(`[seaslug] 287: Holgart (platform) ${which} round ${k + 1} failed at ${JSON.stringify(bot.pos())} (Holgart ${h ? `${h.x},${h.z}` : 'not seen'}${test ? ', TEST' : ''}): again in 3 t`);
            if (bot.chatModalId !== -1 || bot.mainModalId !== -1) dismiss(bot);
            await bot.tick(3);
        }
        return inDialog(bot);
    };
    // session 11 (so the route may retry Sea Slug): on a retry, the stage the quest JOURNAL shows (seaslug_journal.rs2, latest
    // first; 4/5 and 8/9 share one text) + where we stand. Offshore (platform/island: the route leg's resumeHere keeps us there,
    // no bank) the chain carries on from that stage; on the mainland: Camelot, then Holgart's boat ('Will you take me there?')
    // for stage >= 3. The platform's glass and damp sticks are picked up again when no longer held. SS_RESUME=0 = as before.
    let S = 0;
    const resuming = isResuming(bot) && process.env.SS_RESUME !== '0';
    const offshore = () => { const t = bot.tile(); return t.x >= 2755 && t.x <= 2815 && t.z >= 3265 && t.z <= 3330; };
    if (resuming) {
        if (bot.chatModalId !== -1 || bot.mainModalId !== -1) { bot.closeModal(); bot.queueFlush(); await bot.tick(1); }
        S = await journalStage<number>(bot, 'seaslug', [
            [/QUEST COMPLETE/i, 12], [/take the boat back to shore/i, 11], [/can't get downstairs without some help/i, 10],
            [/created an opening to let/i, 8], [/won't go near the\s+Sea Slugs/i, 7], [/find a way of lighting this damp torch/i, 6],
            [/I need to find\s+Kent\.(\s|$)/i, 4], [/I need to find\s+Kent\s+and\s+Kennith/i, 3],
            [/I've spoken to\s+Holgart|take the\s+Swamp Paste\s+to\s+Holgart/i, 2], [/I need to talk to\s+Holgart/i, 1],
        ], 0, s2 => log(bot, t0, `[ss] ${s2}`));
        if (S === 12) { m.ok = true; m.resumed = true; return m; }
        if (S === 4 && cheb(bot.tile(), ISLAND) <= 15) S = 5;   // on the island: Holgart sailed us there (stage 5)
        m.resumeStage = S;
        log(bot, t0, `[ss] resume at stage ${S} ${offshore() ? 'offshore' : 'mainland'} L${bot.minusedlevel} at ${JSON.stringify(bot.pos())}: glass ${bot.count('broken_glass')} damp ${bot.count('damp_sticks')} dry ${bot.count('dry_sticks')} torch ${bot.count('torch_unlit')}/${bot.count('torch_lit')} paste ${bot.count('swamppaste')}`);
    }
    const ashore = S > 0 && !offshore();
    if (S === 0 || ashore) {
    // 1. Camelot teleport, run to Caroline (OPNPC on the last chunk)
    if (!(await tele(bot, 'camelot_teleport')).ok) throw new Error('camelot teleport failed');
    at('tele');
    }
    if (ashore && S !== 11) {   // resume on the mainland: Holgart (paste at 2, 'Will you take me there?' from 3) -> the platform
        const want = () => near(PLATFORM, 4) || near(ISLAND, 6);
        const hg = npc(bot, HOLGART_LAND);
        const rb = await boatFallback(bot, HOLGART_LAND, hg ? { x: hg.x, z: hg.z } : SHORE, want, [/^Okay, lets do it\./, /^Will you take me there\?/, /^Yes/i], 8);
        if (!rb.ok) throw new Error(`no boat to the platform (resume stage ${S}): ${JSON.stringify(bot.pos())}`);
        if (S <= 2) S = 3;
        if (S === 5 && near(PLATFORM, 4)) S = 4;
        at('platform1');
    }
    if (S === 0) {
    if (!(await walkOp(bot, CAROLINE_AT, opN(CAROLINE), () => inDialog(bot), { near: 1, maxTicks: 150 }))) throw new Error('no Caroline dialog');
    at('caroline');
    // 2. Caroline: 8 pages, multi2 "I suppose so, how do I get there?", chatplayer, chatnpc, chatplayer -> %seaslug = 1.
    //    Then straight to Holgart (MOVE + OPNPC; the MOVE closes the last page).
    await talk(bot, CAROLINE, [R, R, R, R, R, R, R, R, M2[0]!, R, R, R, goN(HOLGART_LAND)], {
        noOp: true, done: () => false,
        answers: [/^I suppose so/], maxTicks: 3, adaptive: false, label: 'caroline',
    });
    // the 3-tick blind burst can miss "I suppose so" (A3 on 289: Holgart never took us to the platform). Caroline's
    // reply only appears on the branch that starts the quest; the quest varp is not transmitted. Verify, re-talk.
    const started = () => [...bot.ifText.values()].some(v => /Holgart will take you there|reward you for your time/i.test(v));
    if (!(await bot.until(started, 4))) {
        m.carolineRetalk = true;
        for (let k = 0; k < 3 && !started(); k++) {
            if (bot.chatModalId !== -1 || bot.mainModalId !== -1) { bot.closeModal(); bot.queueFlush(); await bot.tick(1); }
            if (!(await walkOp(bot, CAROLINE_AT, opN(CAROLINE), () => inDialog(bot), { near: 1, maxTicks: 60 }))) continue;
            await talk(bot, CAROLINE, [R, R, R, R, R, R, R, R, M2[0]!, R, R, R], { done: started, answers: [/^I suppose so/], maxTicks: 30, adaptive: true, label: 'caroline2' });
            await bot.until(started, 4);
        }
        if (!started()) throw new Error('Caroline: quest not started');
        if (bot.chatModalId !== -1) { bot.closeModal(); bot.queueFlush(); await bot.tick(1); }
        const hg = npc(bot, HOLGART_LAND);
        if (!(await walkOp(bot, hg ? { x: hg.x, z: hg.z } : CAROLINE_AT, opN(HOLGART_LAND), () => inDialog(bot), { near: 1, maxTicks: 60 }))) throw new Error('no Holgart dialog after the Caroline re-talk');
    }
    // 3. Holgart (land): talk 1 = 10 pages -> %seaslug = 2 (script ends, chat closes). OPNPC again, FENCE, talk 2:
    //    chatplayer | chatnpc -> paste deleted, =3 | chatnpc | mesbox | chatnpc | multi2 "Okay, lets do it." |
    //    chatplayer -> board (if_close, p_delay 2, telejump to the platform).
    const reop = { fn: () => { const n = npc(bot, HOLGART_LAND); if (n) bot.opNpc(n.idx, 1); }, cost: 1 };
    let r3 = await talk(bot, HOLGART_LAND, [R, R, R, R, R, R, R, R, R, R, reop, 'F', R, R, R, R, R, M2[1]!, R], {
        noOp: true, firstText: /^Hello\.$/, done: () => near(PLATFORM, 4), answers: [/^Okay, lets do it\./], maxTicks: 40, label: 'holgart-land',
    });
    // the blind burst can desync like the later boats (LV23: still at Witchaven after 40 ticks): re-talk adaptively
    if (!r3.ok) { m.holgartRetalk = true; const hg = npc(bot, HOLGART_LAND); r3 = await boatFallback(bot, HOLGART_LAND, hg ? { x: hg.x, z: hg.z } : SHORE, () => near(PLATFORM, 4)); }
    if (!r3.ok) throw new Error(`no boat to the platform: ${JSON.stringify(bot.pos())}`);
    at('platform1');
    }   // S === 0
    // the platform's glass + damp sticks (tradeable=no): picked up on the way; a resume re-picks what is no longer held
    const sticksHeld = () => bot.count('damp_sticks') > 0 || bot.count('dry_sticks') > 0 || bot.count('torch_lit') > 0;
    const glassHeld = () => bot.count('broken_glass') > 0 || bot.count('dry_sticks') > 0 || bot.count('torch_lit') > 0;
    const pickUps = async () => {
        if (bot.minusedlevel === 1 && !(glassHeld() && sticksHeld())) {
            if (!(await walkOp(bot, LADDER_STAND, () => bot.opLoc(ladder1.x, ladder1.z, ladder1.id, 1), () => bot.minusedlevel === 0, { level: 1, maxTicks: 80 }))) throw new Error('ladder down (resume pick-ups)');
        }
        // 4. pick up the glass, the damp sticks, climb the ladder
        // 296 (qx47p 'no glass', CONFIRMED in the log: 'walkOp(2765,3278) from (2766,3276) L0: no route' 2 tiles short of the
        // glass spawn, 18 t after landing; the retry from the same tile picked it up in 7 t. Not supply (a tradeable=no ground
        // spawn), not lost. Same class as 287: re-plans WITH npc blocks found no way past a fisherman on the 1-tile walkway
        // (npc INFERRED) and the no-route bail gave up at once): up to SS_PICK_ROUNDS (4) walks, 3 t apart, 150 t in all, for
        // the glass and the sticks. SS_PICK_ROUNDS=1 = as before; SS_PICK_TEST=1 = the glass round 1 is cut after 1 t.
        const pick = async (dest: { x: number; z: number }, name: string, label: string): Promise<boolean> => {
            const rounds = Math.max(1, Number(process.env.SS_PICK_ROUNDS ?? 4)), end = bot.tickCount + (rounds > 1 ? 150 : 120);
            for (let k = 0; k < rounds && bot.tickCount < end; k++) {
                const test = k === 0 && label === 'glass' && process.env.SS_PICK_TEST === '1';
                if (await walkOp(bot, dest, () => bot.opObj(dest.x, dest.z, objId(name), 3), () => bot.count(name) > 0, { maxTicks: test ? 1 : rounds > 1 ? Math.max(10, end - bot.tickCount) : 120 })) return true;
                if (k + 1 >= rounds) break;
                console.log(`[seaslug] 296: ${label} round ${k + 1} failed at ${JSON.stringify(bot.pos())}${test ? ' (TEST)' : ''}: again in 3 t`);
                if (bot.chatModalId !== -1 || bot.mainModalId !== -1) dismiss(bot);
                await bot.tick(3);
            }
            return bot.count(name) > 0;
        };
        if (!glassHeld() && !(await pick(GLASS, 'broken_glass', 'glass'))) throw new Error('no glass');
        at('glass');
        if (!sticksHeld() && !(await pick(STICKS, 'damp_sticks', 'sticks'))) throw new Error('no sticks');
        at('sticks');
    };
    if (S <= 3) {
    await pickUps();
    if (bot.minusedlevel !== 1 && !(await walkOp(bot, LADDER_STAND, () => bot.opLoc(ladder0.x, ladder0.z, ladder0.id, 1), () => bot.minusedlevel === 1, { maxTicks: 120 }))) throw new Error('ladder up 1');
    at('up1');
    // 5. Shout-across at the crates: Kennith, 6 pages -> =4 (script ends)
    if (!(await opLocFrom(bot, crates, 1, () => inDialog(bot), CRATE_STANDS, { level: 1, perTry: 30 }))) throw new Error('no Kennith dialog');
    at('kennith1');
    // 6 pages, then walk back to the ladder top in the same burst (the MOVE would close an open page; the script has ended)
    await talk(bot, [], [R, R, R, R, R, R], { noOp: true, maxTicks: 6, adaptive: false, label: 'kennith1' });
    }
    if (S <= 4) {
    if (bot.minusedlevel !== 0 && !(await walkOp(bot, LADDER_STAND, () => bot.opLoc(ladder1.x, ladder1.z, ladder1.id, 1), () => bot.minusedlevel === 0, { level: 1, maxTicks: 80 }))) throw new Error('ladder down 1');
    at('down1');
    // 6. Holgart (platform): 4 pages -> =5, boat to the island
    dismiss(bot);
    if (!(await toHolgartPlatform(1))) throw new Error('no Holgart (platform) dialog');
    at('holgart-platform');
    let r6 = await talk(bot, HOLGART_PLATFORM, [R, R, R, R], { noOp: true, done: () => near(ISLAND, 4), maxTicks: 15, label: 'holgart-platform' });
    if (!r6.ok) r6 = await boatFallback(bot, HOLGART_PLATFORM, { x: 2782, z: 3277 }, () => near(ISLAND, 4));
    if (!r6.ok) throw new Error('no boat to the island');
    at('island');
    }
    if (S <= 5) {
    // 7. Kent: 9 pages -> if_close, =6, p_delay(2), "Traveller wait!"... abandon it: go to Holgart (sunk boat)
    dismiss(bot);
    if (!(await walkOp(bot, { x: 2794, z: 3321 }, opN(KENT), () => inDialog(bot), { near: 1, maxTicks: 120 }))) throw new Error('no Kent dialog');
    at('kent');
    await talk(bot, KENT, [R, R, R, R, R, R, R, R, R], { noOp: true, maxTicks: 4, adaptive: false, label: 'kent' });
    }
    if (S <= 6 && !near(PLATFORM, 6)) {   // (resume at stage 6 on the island: straight to the sunk boat)
    // the delayed player drops every packet: re-send the Holgart op each tick until his dialog is up
    const sunkDone = () => inDialog(bot) && npc(bot, HOLGART_SUNK) !== null && /Where are we|platform/i.test([...bot.ifText.values()].join(' '));
    for (let k = 0; k < 15 && !near(PLATFORM, 4); k++) {
        if (await waitText(bot, /better get back to the platform/, 1)) break;
        const n = npc(bot, HOLGART_SUNK); if (n) opNpcGo(bot, n, 1);
    }
    void sunkDone;
    at('holgart-sunk');
    let r7 = await talk(bot, HOLGART_SUNK, [R, R], { noOp: true, done: () => near(PLATFORM, 4), maxTicks: 15, label: 'holgart-sunk' });
    if (!r7.ok) { const hs = npc(bot, HOLGART_SUNK); r7 = await boatFallback(bot, HOLGART_SUNK, hs ? { x: hs.x, z: hs.z } : bot.tile(), () => near(PLATFORM, 4)); }
    if (!r7.ok) throw new Error('no boat back to the platform');
    at('platform2');
    }
    if (S <= 6) {
    if (resuming) await pickUps();
    // 8. glass on damp sticks (p_delay 1) -> dry sticks; rub x3 (77% each at fm 30) -> torch lit, =7; then the ladder
    if (bot.count('dry_sticks') === 0 && bot.count('torch_lit') === 0) {
    bot.useItemOnItem(objId('broken_glass'), bot.slot('broken_glass'), objId('damp_sticks'), bot.slot('damp_sticks')); bot.queueFlush();
    if (!(await bot.until(() => bot.count('dry_sticks') > 0, 8))) throw new Error('no dry sticks');
    }
    at('dry');
    for (let k = 0; k < 6 && bot.count('torch_lit') === 0; k++) {
        const s = bot.slot('dry_sticks');
        sendToks(bot, [() => bot.opHeld1(objId('dry_sticks'), s), () => bot.opHeld1(objId('dry_sticks'), s), () => bot.opHeld1(objId('dry_sticks'), s)]);
        await bot.tick(1);
    }
    if (bot.count('torch_lit') === 0) throw new Error('torch not lit');
    at('torch');
    }
    if (S <= 10) {
    if (bot.minusedlevel !== 1 && !(await walkOp(bot, LADDER_STAND, () => bot.opLoc(ladder0.x, ladder0.z, ladder0.id, 1), () => bot.minusedlevel === 1, { maxTicks: 120 }))) throw new Error('ladder up 2');
    at('up2');
    }
    if (S <= 7) {
    // 9. Shout-across (stage 7: 7 pages -> =8), kick the panel (p_delay 2+2 -> =9), shout again (6 pages -> =10),
    //    rotate the crane from (2768,3290) (-> =11)
    // a second go before giving up (rig TZ9 seed 39, TH9: 'no Kennith dialog 2' 72t after the ladder, 2 in ~145 lanes; the
    // leg retry restarts at the Camelot teleport and cannot redo the quest steps already done)
    if (!(await opLocFrom(bot, crates, 1, () => inDialog(bot), CRATE_STANDS, { level: 1, perTry: 30 }))) {
        console.log(`[seaslug] no Kennith dialog 2 yet: at ${JSON.stringify(bot.pos())} modal ${bot.mainModalId}/${bot.chatModalId} inv ${bot.inv().map(s => objDebugName(s.obj)).join(',')} msgs ${JSON.stringify(bot.getChat({ limit: 4 }).map((m: any) => m.text))}; trying again`);
        if (bot.mainModalId !== -1 || bot.chatModalId !== -1) { bot.closeModal(); await bot.tick(1); }
        if (bot.minusedlevel !== 1 && !(await walkOp(bot, LADDER_STAND, () => bot.opLoc(ladder0.x, ladder0.z, ladder0.id, 1), () => bot.minusedlevel === 1, { maxTicks: 120 }))) throw new Error('ladder up 2 (retry)');
        if (!(await opLocFrom(bot, crates, 1, () => inDialog(bot), CRATE_STANDS, { level: 1, perTry: 40 }))) throw new Error('no Kennith dialog 2');
    }
    at('kennith2');
    const kickTok = { fn: () => { routeToLoc(bot, panel, PANEL_STAND); bot.opLoc(panel.x, panel.z, panel.id, 1); }, cost: 2 };
    // session 11 fix 349 (qx141p: 1012 mass drop on this burst's tick, re-attached after 39 t): the kick script ran on while we
    // were offline (quest_seaslug.rs2:81-91, =9), its 'leaving an opening' went to the dead socket, every re-kick at 9 says
    // 'But nothing interesting happens.' (:93-94): 3 kicks, 'panel kick did not finish', the 8/9 resume took it at once. After a
    // reconnect since the burst accept that text too (without one it still means the kick beat =8: desynced). SS_KICK_RC=0
    // reverts. TEST SS_KICK_TEST=1: swallow the first kick's text (as the drop did), loop as after a reconnect.
    let ep0 = (bot as any).dropEpoch ?? 0;
    await talk(bot, [], [R, R, R, R, R, R, R, kickTok], { noOp: true, maxTicks: 3, adaptive: false, label: 'kennith2' });
    if (process.env.SS_KICK_TEST === '1' && !resuming && await waitText(bot, /leaving an opening/i, 12)) ep0 = -1;
    const kickRe = () => process.env.SS_KICK_RC !== '0' && ((bot as any).dropEpoch ?? 0) !== ep0 ? /leaving an opening|nothing interesting happens/i : /leaving an opening/i;
    // the kick: wait for its second message, then shout again
    for (let k = 0; k < 3 && !(await waitText(bot, kickRe(), k ? 16 : 12)); k++) {   // desynced: finish the pages, kick again
        const { drive } = await import('./q-lib.js'); await drive(bot, () => !inDialog(bot), [], 12);
        routeToLoc(bot, panel, PANEL_STAND); bot.opLoc(panel.x, panel.z, panel.id, 1); bot.queueFlush();
        if (k === 2) throw new Error('panel kick did not finish');
    }
    at('kicked');
    } else if (S <= 9) {   // resume at 8/9 (one journal text): kick the panel; at 9 it answers 'nothing interesting happens'
        for (let k = 0; k < 3; k++) {
            if (bot.chatModalId !== -1 || bot.mainModalId !== -1) { dismiss(bot); await bot.tick(1); }
            routeToLoc(bot, panel, PANEL_STAND); bot.opLoc(panel.x, panel.z, panel.id, 1); bot.queueFlush();
            if (await waitText(bot, /leaving an opening|nothing interesting happens/i, 16)) break;
            if (k === 2) throw new Error('panel kick (resume) did not finish');
        }
        at('kicked');
    }
    if (S <= 9) {
    if (!(await opLocFrom(bot, crates, 1, () => inDialog(bot), CRATE_STANDS, { level: 1, perTry: 30 }))) {
        // fix 325 (qx93m): no dialog in 30 t after the kick, the leg retry got it at once from the same tile: one more try here
        // (as dialog 2 has). SS_K3_RETRY=0 reverts.
        if (process.env.SS_K3_RETRY === '0') throw new Error('no Kennith dialog 3');
        console.log(`[seaslug] no Kennith dialog 3 yet: at ${JSON.stringify(bot.pos())} modal ${bot.mainModalId}/${bot.chatModalId} msgs ${JSON.stringify(bot.getChat({ limit: 4 }).map((m: any) => m.text))}; trying again`);
        if (bot.mainModalId !== -1 || bot.chatModalId !== -1) { bot.closeModal(); await bot.tick(1); }
        if (bot.minusedlevel !== 1 && !(await walkOp(bot, LADDER_STAND, () => bot.opLoc(ladder0.x, ladder0.z, ladder0.id, 1), () => bot.minusedlevel === 1, { maxTicks: 120 }))) throw new Error('ladder up 3 (retry)');
        if (!(await opLocFrom(bot, crates, 1, () => inDialog(bot), CRATE_STANDS, { level: 1, perTry: 40 }))) throw new Error('no Kennith dialog 3');
    }
    at('kennith3');
    const craneTok = { fn: () => { routeToLoc(bot, crane, CRANE_STAND); bot.opLoc(crane.x, crane.z, crane.id, 1); }, cost: 2 };
    await talk(bot, [], [R, R, R, R, R, R, craneTok], { noOp: true, maxTicks: 3, adaptive: false, label: 'kennith3' });
    for (let k = 0; k < 3 && !(await waitText(bot, /lower Kennith to the row boat/i, 20)); k++) {
        const { drive } = await import('./q-lib.js'); await drive(bot, () => !inDialog(bot), [], 12);
        routeToLoc(bot, crane, CRANE_STAND); bot.opLoc(crane.x, crane.z, crane.id, 1); bot.queueFlush();
        if (k === 2) throw new Error('crane did not finish');
    }
    at('crane');
    } else if (S === 10) {   // resume: Kennith already waits behind the panel: rotate the crane
        for (let k = 0; k < 3; k++) {
            if (bot.chatModalId !== -1 || bot.mainModalId !== -1) { dismiss(bot); await bot.tick(1); }
            routeToLoc(bot, crane, CRANE_STAND); bot.opLoc(crane.x, crane.z, crane.id, 1); bot.queueFlush();
            if (await waitText(bot, /lower Kennith to the row boat/i, 20)) break;
            if (k === 2) throw new Error('crane (resume) did not finish');
        }
        at('crane');
    }
    if (offshore()) {
    // 10. ladder down, Holgart (platform): 3 pages -> boat to the shore
    if (bot.minusedlevel !== 0 && !(await walkOp(bot, LADDER_STAND, () => bot.opLoc(ladder1.x, ladder1.z, ladder1.id, 1), () => bot.minusedlevel === 0, { level: 1, maxTicks: 120 }))) throw new Error('ladder down 2');
    at('down2');
    dismiss(bot);
    if (!(await toHolgartPlatform(2))) throw new Error('no Holgart (platform) dialog 2');
    let r10 = await talk(bot, HOLGART_PLATFORM, [R, R, R], { noOp: true, done: () => near(SHORE, 4), maxTicks: 15, label: 'holgart-shore' });
    if (!r10.ok) r10 = await boatFallback(bot, HOLGART_PLATFORM, { x: 2782, z: 3277 }, () => near(SHORE, 4));
    if (!r10.ok) throw new Error('no boat to the shore');
    at('shore');
    }
    // 11. Caroline: 7 pages -> =12, fishing xp, QP; close
    dismiss(bot);
    if (!(await walkOp(bot, CAROLINE_AT, opN(CAROLINE), () => inDialog(bot), { near: 1, maxTicks: resuming ? 300 : 120 }))) throw new Error('no Caroline dialog 2');
    at('caroline2');
    // done = the reward's fishing xp landed (was 'fishing level >= 74': true only for the speedrun trainee's carried fishing
    // level at its server's xp rate; a fresh account gains far fewer levels and the leg reported a completed quest as failed)
    const fx0 = bot.stat('fishing').xp;
    const r11 = await talk(bot, CAROLINE, [R, R, R, R, R, R, R, X], { noOp: true, done: () => bot.stat('fishing').xp > fx0, maxTicks: 15, label: 'caroline2' });
    m.ok = r11.ok;
    at('done');
    return m;
}

if (import.meta.main) {
    if (!/^(localhost|127\.)/.test(process.env.LC_HOST ?? '')) { console.error('set LC_HOST=localhost:8888'); process.exit(1); }
    const sfx = process.argv[2] ?? String(Date.now() % 100000);
    const bot = await SpeedBot.create(`qsea${sfx}`);
    dropAllOf(bot, KIT_JUNK); await bot.tick(5);
    // q-doric's exit state + the firemaking leg: magic 45, fm 30, at Doric's house
    await localSetup(bot, { stats: { magic: 45, firemaking: 30 }, items: SEASLUG_SUPPLY, tele: { x: 2951, z: 3450 } });
    await seaslugPrep();
    await bot.tick(2);
    const { rec } = await runLeg(bot, 'q-seaslug', b => seaslugLeg(b, { verbose: true }));
    console.log(`[q-seaslug] ${rec.ticks} ticks ${JSON.stringify(rec.result)} | gh_kadeski ~529 incl. ~53 firemaking`);
    await bot.logout();
    process.exit(rec.ok ? 0 : 1);
}

/** A Holgart boat chain that desynced: re-talk and drive the pages adaptively until the boat moves us. */
async function boatFallback(bot: SpeedBot, type: number, at: { x: number; z: number }, done: () => boolean, answers: RegExp[] = [/^Okay, lets do it\./, /^Yes/i], tries = 4): Promise<{ ok: boolean; ticks: number; firstPage: number }> {
    const t0 = bot.tickCount;
    const { drive } = await import('./q-lib.js');
    for (let k = 0; k < tries && !done(); k++) {
        if (!inDialog(bot)) await walkOp(bot, at, () => { const n = npc(bot, type); if (!n) return false; opNpcGo(bot, n, 1); return true; }, () => inDialog(bot) || done(), { near: 1, maxTicks: k ? 60 : 200 });
        await drive(bot, done, answers, 25, 1);
    }
    return { ok: done(), ticks: bot.tickCount - t0, firstPage: 0 };
}
