// q-druidic.ts — Druidic Ritual, tick-tight (speedrun: herblore needs level 3 before anything gives xp). LOCAL ONLY.
//
// Flow (quest_druid.rs2, kaqemeex.rs2, sanfew.rs2, prison_doors.rs2): Falador teleport -> Kaqemeex (2924,3486)
//   "I'm in search of a quest." / "Ok, I will try and help." -> Sanfew (2897,3426, L1 via stairs 2898,3428)
//   "I've been sent to help purify..." -> Taverley dungeon ladder (2884,3397) -> cauldron door 2144 (2889,9830):
//   from outside, op 1 and op 2 each wake a suit of armour (npc 453, retaliates; max hit ~2) instead of opening,
//   op 3 opens -> cauldron 2142 (2893,9831): use the 4 raw meats (no delay, but one interaction per tick) ->
//   ladder up -> Sanfew (hand in) -> Kaqemeex: completion is a strong queue* (closes the page itself).
//
// PRECONDITIONS: magic >= 37 + 3 air/1 water/1 law (Falador teleport), anywhere. Pack: raw_beef 2132, raw_rat_meat
//   2134, raw_bear_meat 2136, raw_chicken 2138 (1 each). Recommended: prayer >= 43 (Protect from Melee is switched
//   on for the dungeon when available: two suits of armour attack while the door is worked).
// EXIT STATE: next to Kaqemeex (~2924,3486), herblore reward xp (2500 tenths = 6,250 displayed), quest scroll open.
// SUPPLY (helper -> trainee): raw_beef 2132, raw_rat_meat 2134, raw_bear_meat 2136, raw_chicken 2138 (x1 each),
//   lawrune 563 x1 (+3 air, 1 water if the trainee has none).
//
// Run from server/webclient:  LC_HOST=localhost:8888 bun headless/speedrun/legs/q-druidic.ts [suffix]
import { SpeedBot, runLeg, localSetup, objId, cheb } from '../core.js';
import {
    nav, talk, npc, inDialog, log, trace, walkOp, prePlanArea, tele, locAt, dismiss, dropAllOf, KIT_JUNK, opNpcGo, qp,
    R, M2, M3, type FTok,
} from './q-lib.js';

import { isResuming, journalStage, failHook } from './qp/journal.js';
const KAQEMEEX = 455, SANFEW = 454;
const FALADOR_TELE = { x: 2965, z: 3378 };
const KAQ_AT = { x: 2924, z: 3486 };
const STAIRS_STAND = { x: 2900, z: 3428 }, LADDER_STAND = { x: 2885, z: 3397 };
const DOOR_STAND = { x: 2888, z: 9830 }, CAULDRON_STAND = { x: 2892, z: 9831 }, UPLADDER_STAND = { x: 2884, z: 9798 };
const MEATS = ['raw_beef', 'raw_rat_meat', 'raw_bear_meat', 'raw_chicken'];
const ENCHANTED = ['enchanted_beef', 'enchanted_rat_meat', 'enchanted_bear_meat', 'enchanted_chicken'];
export const DRUIDIC_SUPPLY = [...MEATS.map(name => ({ name, n: 1 })), { name: 'lawrune', n: 1 }];

export async function druidicPrep(): Promise<void> { await prePlanArea(0, FALADOR_TELE, 2, KAQ_AT); }

export async function druidicLeg(bot: SpeedBot, o: { verbose?: boolean } = {}): Promise<Record<string, number | boolean>> {
    await nav();
    bot.holdDialogs = true;
    const t0 = bot.tickCount, m: Record<string, number | boolean> = {};
    // failHook (resume proofs): SR_FAIL_AT=druidic:<mark> throws once right after that mark
    const at = (k: string) => { m[k] = bot.tickCount - t0; if (o.verbose) log(bot, t0, `${k} pos=${JSON.stringify(bot.pos())}`); failHook(`druidic:${k}`); };
    trace(bot, t0);
    const opN = (type: number) => () => { const n = npc(bot, type); if (!n) return false; opNpcGo(bot, n, 1); return true; };
    const stairs0 = locAt(1738, 2898, 3428, 0), stairs1 = locAt(1740, 2898, 3428, 1), ladder = locAt(1759, 2884, 3397, 0);
    const door = locAt(2144, 2889, 9830, 0), cauldron = locAt(2142, 2893, 9831, 0), upLadder = locAt(1755, 2884, 9797, 0);
    const herb0 = bot.stat('herblore').xp;
    // session 11 (so the route may retry it): on a retry, the stage the JOURNAL shows (druid_journal.rs2, latest first):
    // done / claim (Kaqemeex's reward) / cauldron (Sanfew spoken) / sanfew (started) / start. The steps before it are skipped,
    // the teleport only when far from Taverley. DRUIDIC_RESUME=0 = from the top as before.
    const resume = isResuming(bot) && process.env.DRUIDIC_RESUME !== '0';
    const st = resume ? await journalStage<string>(bot, 'druid', [
        [/QUEST COMPLETE/i, 'done'], [/speak to\s+Kaqemeex\s+again and claim/i, 'claim'], [/Cauldron of Thunder/i, 'cauldron'],
        [/speak to\s+Sanfew\s+in the village/i, 'sanfew'],
    ], 'start', s2 => log(bot, t0, s2)) : 'start';
    if (st === 'done') return { ...m, ok: true, resumed: true };
    const ORDER = ['start', 'sanfew', 'cauldron', 'claim'];
    const doS = (k: string) => ORDER.indexOf(st) <= ORDER.indexOf(k);
    const allDipped = () => ENCHANTED.every(e => bot.count(e) > 0);
    const inDungeon = () => bot.tile().z > 6400;
    // 1. Falador teleport -> Kaqemeex: chatplayer | chatnpc | multi3 "I'm in search of a quest." | chatplayer |
    //    chatnpc | chatnpc | chatnpc | multi3 "Ok, I will try and help." | chatplayer -> %druidquest = started
    const far = !(cheb(bot.tile(), { x: 2905, z: 3440 }) <= 70 && !inDungeon()) && !(inDungeon() && st === 'cauldron' && !allDipped() && cheb(bot.tile(), { x: 2890, z: 9815 }) <= 40);
    if (!resume || far) {
    if (!(await tele(bot, 'falador_teleport')).ok) throw new Error('falador teleport failed');
    at('tele');
    } else log(bot, t0, `resume at '${st}' from ${JSON.stringify(bot.pos())}: no teleport`);
    // route runner (fix 116, partner pre-run qrm5p: the teleport's magic level-up page made the Kaqemeex walk 'arrive' at once
    // (done = inDialog), so the quest never started and Sanfew failed): continue any open page first
    for (let k = 0; k < 6 && bot.chatModalId !== -1; k++) { bot.resumeDialogPage(); bot.queueFlush(); await bot.tick(1); }
    if (doS('start')) {
    if (!(await walkOp(bot, KAQ_AT, opN(KAQEMEEX), () => inDialog(bot), { near: 1, maxTicks: 120 }))) throw new Error('no Kaqemeex dialog');
    at('kaqemeex1');
    await talk(bot, KAQEMEEX, [R, R, M3[1]!, R, R, R, R, M3[0]!, R], {
        noOp: true, done: () => false, answers: [/^I'm in search of a quest\.$/, /^Ok, I will try and help\.$/], maxTicks: 2, adaptive: false, label: 'kaqemeex1',
    });
    }
    if (doS('sanfew')) {
    // 2. Sanfew (L1): chatnpc | multi2 "I've been sent..." | chatplayer | chatnpc | chatnpc -> spoken_sanfew
    // route runner (fix 108, chaos qrk3m 'stairs up': Sanfew's house door in a random state): core walkTo first (opens closed
    // doors, closes an opened leaf that walls the route)
    // route session 5 (allchaos qscp 'stairs up 2': doors flip while we work): up to 4 tries, each closing an open leaf
    // next to us and re-walking with closeDoors first
    for (let k = 0; k < 4 && bot.minusedlevel !== 1; k++) {
        if (k > 0) { try { if (await bot.closeBlockingDoor()) await bot.tick(2); } catch { /* none */ } }
        // route session 5 (allchaos qslm: Sanfew's front door 1530 CLOSED on (2902,3428); core walkTo stops ON the door tile
        // reporting ok and never opens it (route/probe-leaf.ts); opened from its own tile it works, then the stairs op climbs
        // in 2 t): open it from (2902,3428) first
        if (bot.liveLocs.get('0,2902,3428') === 1530 && bot.minusedlevel === 0) {
            if (cheb(bot.tile(), { x: 2902, z: 3428 }) > 0) await bot.walkTo(2902, 3428, { near: 0, maxTicks: 40, log: false });
            for (let d = 0; d < 3 && bot.liveLocs.get('0,2902,3428') === 1530; d++) { bot.opLoc(2902, 3428, 1530, 1); bot.queueFlush(); await bot.tick(3); }
        }
        await bot.walkTo(STAIRS_STAND.x, STAIRS_STAND.z, { near: 1, closeDoors: true, maxTicks: 120, log: false });
        await walkOp(bot, STAIRS_STAND, () => bot.opLoc(stairs0.x, stairs0.z, stairs0.id, 1), () => bot.minusedlevel === 1, { maxTicks: 80 });
    }
    if (bot.minusedlevel !== 1) throw new Error('stairs up');
    at('L1');
    dismiss(bot);
    // + 'What was I meant to be doing again?' (sanfew.rs2:70, a talk at spoken_sanfew without the meats)
    const r2b = await talk(bot, SANFEW, [R, M2[0]!, R, R, R], { done: () => bot.dialogOptions().some(x => /Where can I find this cauldron/.test(x.text)), answers: [/^I've been sent to help purify/, ...(process.env.DRUIDIC_RESUME !== '0' ? [/^What was I meant to be doing again\?$/] : [])], maxTicks: 15, label: 'sanfew1' });
    if (!r2b.ok) throw new Error('Sanfew 1 did not reach spoken_sanfew');
    at('sanfew1');
    }
    if (doS('cauldron') && !(resume && allDipped())) {
    if (bot.minusedlevel === 1) {
    // 3. stairs down, dungeon ladder
    if (!(await walkOp(bot, { x: 2898, z: 3427 }, () => bot.opLoc(stairs1.x, stairs1.z, stairs1.id, 1), () => bot.minusedlevel === 0, { level: 1, maxTicks: 10 }))) throw new Error('stairs down');
    at('L0');
    }
    if (!inDungeon()) {
    if (!(await walkOp(bot, LADDER_STAND, () => bot.opLoc(ladder.x, ladder.z, ladder.id, 1), () => bot.tile().z > 6400, { maxTicks: 40 }))) throw new Error('ladder down');
    at('dungeon');
    }
    if (bot.stat('prayer').cur >= 43) { bot.activatePrayer('protectfrommelee'); bot.queueFlush(); }
    // 4. the cauldron door: op until we stand east of it (ops 1-2 wake the suits)
    let inside = false;
    for (let k = 0; k < 6 && !inside; k++) {
        inside = await walkOp(bot, DOOR_STAND, () => bot.opLoc(door.x, door.z, door.id, 1), () => bot.tile().x >= 2889, { maxTicks: k === 0 ? 40 : 3 });
    }
    if (!inside) throw new Error(`cauldron door: ${JSON.stringify(bot.pos())}`);
    at('door');
    // 5. dip the four meats: one OPLOCU per tick (one interaction per tick)
    for (let k = 0; k < 12 && ENCHANTED.some(e => bot.count(e) === 0); k++) {
        const next = MEATS.find(mm => bot.count(mm) > 0);
        if (!next) break;
        if (k === 0) await walkOp(bot, CAULDRON_STAND, () => bot.useItemOnLoc(cauldron.x, cauldron.z, cauldron.id, objId(next), bot.slot(next)), () => bot.count(next) === 0, { maxTicks: 10 });
        else { bot.useItemOnLoc(cauldron.x, cauldron.z, cauldron.id, objId(next), bot.slot(next)); bot.queueFlush(); await bot.tick(1); }
    }
    if (ENCHANTED.some(e => bot.count(e) === 0)) throw new Error(`meats not enchanted: ${JSON.stringify(bot.inv())}`);
    at('dipped');
    // 6. out: door from inside (one op), ladder up
    for (let k = 0; k < 6 && bot.tile().x >= 2889; k++) {
        await walkOp(bot, { x: 2889, z: 9830 }, () => bot.opLoc(door.x, door.z, door.id, 1), () => bot.tile().x < 2889, { maxTicks: 4 });
    }
    if (!(await walkOp(bot, UPLADDER_STAND, () => bot.opLoc(upLadder.x, upLadder.z, upLadder.id, 1), () => bot.tile().z < 6400, { maxTicks: 40 }))) throw new Error('ladder up');
    at('surface');
    if (bot.isPrayerActive('protectfrommelee')) { (bot as any).setPrayer('protectfrommelee', false); bot.queueFlush(); }
    } else if (resume && inDungeon() && doS('cauldron')) {
        // dipped already, still below: out through the door if inside, up the ladder
        for (let k = 0; k < 6 && bot.tile().x >= 2889; k++) await walkOp(bot, { x: 2889, z: 9830 }, () => bot.opLoc(door.x, door.z, door.id, 1), () => bot.tile().x < 2889, { maxTicks: 4 });
        if (!(await walkOp(bot, UPLADDER_STAND, () => bot.opLoc(upLadder.x, upLadder.z, upLadder.id, 1), () => bot.tile().z < 6400, { maxTicks: 40 }))) throw new Error('ladder up');
        at('surface');
    }
    if (doS('cauldron')) {
    // 7. Sanfew: chatnpc | chatplayer | chatnpc | chatnpc -> meats deleted, given_ingredients
    // route session 5 (allchaos qscp 'stairs up 2': doors flip while we work): up to 4 tries, each closing an open leaf
    // next to us and re-walking with closeDoors first
    for (let k = 0; k < 4 && bot.minusedlevel !== 1; k++) {
        if (k > 0) { try { if (await bot.closeBlockingDoor()) await bot.tick(2); } catch { /* none */ } }
        // route session 5 (allchaos qslm: Sanfew's front door 1530 CLOSED on (2902,3428); core walkTo stops ON the door tile
        // reporting ok and never opens it (route/probe-leaf.ts); opened from its own tile it works, then the stairs op climbs
        // in 2 t): open it from (2902,3428) first
        if (bot.liveLocs.get('0,2902,3428') === 1530 && bot.minusedlevel === 0) {
            if (cheb(bot.tile(), { x: 2902, z: 3428 }) > 0) await bot.walkTo(2902, 3428, { near: 0, maxTicks: 40, log: false });
            for (let d = 0; d < 3 && bot.liveLocs.get('0,2902,3428') === 1530; d++) { bot.opLoc(2902, 3428, 1530, 1); bot.queueFlush(); await bot.tick(3); }
        }
        await bot.walkTo(STAIRS_STAND.x, STAIRS_STAND.z, { near: 1, closeDoors: true, maxTicks: 120, log: false });
        await walkOp(bot, STAIRS_STAND, () => bot.opLoc(stairs0.x, stairs0.z, stairs0.id, 1), () => bot.minusedlevel === 1, { maxTicks: 40 });
    }
    if (bot.minusedlevel !== 1) throw new Error('stairs up 2');
    at('L1b');
    dismiss(bot);
    const r7 = await talk(bot, SANFEW, [R, R, R, R], { done: () => ENCHANTED.every(e => bot.count(e) === 0), maxTicks: 15, label: 'sanfew2' });
    if (!r7.ok) throw new Error('Sanfew 2 failed');
    at('sanfew2');
    }
    if (bot.minusedlevel === 1 && !(await walkOp(bot, { x: 2898, z: 3427 }, () => bot.opLoc(stairs1.x, stairs1.z, stairs1.id, 1), () => bot.minusedlevel === 0, { level: 1, maxTicks: 10 }))) throw new Error('stairs down 2');
    // 8. Kaqemeex: chatplayer | chatnpc -> queue*(druid_quest_complete) (strong: closes the page, runs at once)
    dismiss(bot);
    if (!(await walkOp(bot, KAQ_AT, opN(KAQEMEEX), () => inDialog(bot), { near: 1, maxTicks: 80 }))) throw new Error('no Kaqemeex dialog 2');
    at('kaqemeex2');
    if (process.env.DRUIDIC_CLAIM_TEST === '1' && !(globalThis as any).__druClaimTest) { (globalThis as any).__druClaimTest = 1; console.log('[druidic] TEST: Kaqemeex page closed (the cut)'); bot.closeModal(); bot.queueFlush(); await bot.tick(2); }
    const r8 = await talk(bot, KAQEMEEX, [R, R], { noOp: true, done: () => bot.stat('herblore').xp > herb0, maxTicks: 10, label: 'kaqemeex2' });
    m.ok = r8.ok;
    // 269 (qx06m: an engine-restart drop (ws 1012, all bots, 38 t) on the way down from Sanfew; 'kaqemeex2' talked 10 t,
    // logged 'done' with no herblore xp and the route judged qp 34->34 (empty message); the retry's journal said 'claim'
    // and banked + walked back for a 66 t finish): wait up to 6 t for the reward (herblore xp / the qp varp), then
    // re-open Kaqemeex and talk again (20 t) up to 3 rounds; still nothing -> throw with the state, so the retry is a
    // journal 'claim' resume. DRUIDIC_CLAIM_WAIT=0 reverts. TEST: DRUIDIC_CLAIM_TEST=1 closes the first Kaqemeex page once.
    if (process.env.DRUIDIC_CLAIM_WAIT !== '0') {
        const qp0 = qp(bot);
        const rewarded = () => bot.stat('herblore').xp > herb0 || qp(bot) > qp0;
        if (!rewarded()) await bot.until(rewarded, 6);
        for (let k = 0; k < 3 && !rewarded(); k++) {
            console.log(`[druidic] kaqemeex2: no reward yet (herblore ${bot.stat('herblore').xp}/${herb0}, qp ${qp(bot)}, dialog ${inDialog(bot)}): re-talk #${k + 1}`);
            dismiss(bot); await bot.tick(1);
            if (!(await walkOp(bot, KAQ_AT, opN(KAQEMEEX), () => inDialog(bot), { near: 1, maxTicks: 60 }))) continue;
            await talk(bot, KAQEMEEX, [R, R, R], { noOp: true, done: rewarded, maxTicks: 20, label: `kaqemeex2 re-talk ${k + 1}` });
            if (!rewarded()) await bot.until(rewarded, 6);
        }
        if (!rewarded()) throw new Error(`kaqemeex2: no reward (herblore ${bot.stat('herblore').xp}/${herb0}, qp ${qp(bot)}/${qp0})`);
        m.ok = true;
    }
    m.herbloreLevel = bot.stat('herblore').level;
    at('done');
    return m;
}

if (import.meta.main) {
    if (!/^(localhost|127\.)/.test(process.env.LC_HOST ?? '')) { console.error('set LC_HOST=localhost:8888'); process.exit(1); }
    const sfx = process.argv[2] ?? String(Date.now() % 100000);
    const bot = await SpeedBot.create(`qdru${sfx}`);
    dropAllOf(bot, KIT_JUNK); await bot.tick(5);
    // route position: herblore after prayer (leg 13): prayer 99, magic >= 37, hp ~10, at Varrock west bank
    await localSetup(bot, { stats: { magic: 60, prayer: 99 }, items: DRUIDIC_SUPPLY, tele: { x: 3185, z: 3436 } });
    await druidicPrep();
    await bot.tick(2);
    const { rec } = await runLeg(bot, 'q-druidic', b => druidicLeg(b, { verbose: true }));
    console.log(`[q-druidic] ${rec.ticks} ticks ${JSON.stringify(rec.result)} | gh_kadeski ~317`);
    await bot.logout();
    process.exit(rec.ok ? 0 : 1);
}
