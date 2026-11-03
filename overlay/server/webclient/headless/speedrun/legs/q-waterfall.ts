// q-waterfall.ts — Waterfall Quest, tick-tight (speedrun route leg 15: att/str 1 -> 83 from the reward). LOCAL ONLY.
//
// PRECONDITIONS: magic >= 45 (Camelot x2), prayer >= 43 recommended (Protect from Melee is used in Golrie's cave,
//   Glarial's tomb and the waterfall dungeon: hobgoblins max 3, moss giants max 6, fire giants max 11 vs ~10 hp),
//   anywhere a teleport works. Pack: rope 954, airrune x10 + lawrune x2 (EXACTLY two Camelot teleports: the tomb
//   refuses any rune), sharks 385 x3+, NO weapon/armour/arrows/knife/logs (tomb ban, quest_waterfall.rs2:44-98),
//   >= 7 free slots at the chalice (5 for the reward). Wear nothing but jewellery.
// EXIT STATE: Baxtorian's treasure room (2603,9914), attack + strength 343,750 xp each (83), 1 QP; pack gains 2
//   diamonds, 2 gold bars, 40 mithril seeds, the empty urn, the book; the pillar runes are used up.
// SUPPLY (helper -> trainee): before: rope 954 x1, airrune 556 x10, lawrune 563 x2, shark 385 x3 (food).
//   At the raft after the tomb (step 11, ~4 ticks): airrune x6, earthrune 557 x6, waterrune 555 x6 (+ teleport
//   runes for the next leg). Every quest item is tradeable=no and is collected by the trainee.
//
// Run from server/webclient:  LC_HOST=localhost:8888 bun headless/speedrun/legs/q-waterfall.ts [suffix]
import { SpeedBot, runLeg, localSetup, objId, cheb, densify } from '../core.js';
import {
    nav, talk, npc, inDialog, log, trace, walkOp, prePlanArea, prePlan, tele, locAt, dismiss, dropAllOf, KIT_JUNK,
    waitText, routeToLoc, sendToks, navSync, turning, opNpcGo, msgsSince, R, M2, type FTok,
} from './q-lib.js';
import { isResuming, journalStage, failHook } from './qp/journal.js';

const ALMERA = 304, HUDON = 305, GOLRIE = 306;
const CAMELOT = { x: 2757, z: 3478 };
const ALMERA_AT = { x: 2522, z: 3498 };
const RAFT_LAND = { x: 2512, z: 3481 }, SWIM_TELE = { x: 2527, z: 3413 };
const HADLEY_DOWN = { x: 2516, z: 3423 }, TGV_LADDER_STAND = { x: 2534, z: 3155 };
const TOMB_IN = { x: 2554, z: 9844 }, RAFT_STAND = { x: 2510, z: 3494 };
const DUNGEON_IN = { x: 2575, z: 9861 }, TREASURE = { x: 2603, z: 9914 };
const BOOK = 292, GOLRIE_KEY = 293, PEBBLE = 294, AMULET = 295, URN = 296, BAX_KEY = 298;
export const WATERFALL_SUPPLY = [{ name: 'rope', n: 1 }, { name: 'airrune', n: 10 }, { name: 'lawrune', n: 2 }, { name: 'shark', n: 3 }];
export const WATERFALL_PILLAR_SUPPLY = [{ name: 'airrune', n: 6 }, { name: 'earthrune', n: 6 }, { name: 'waterrune', n: 6 }];
// pillar coords (waterfall_pillars.rs2 get_pillar_index): sw, w, nw, se, e, ne
const PILLARS = [{ x: 2562, z: 9910 }, { x: 2562, z: 9912 }, { x: 2562, z: 9914 }, { x: 2569, z: 9914 }, { x: 2569, z: 9912 }, { x: 2569, z: 9910 }];

export async function waterfallPrep(): Promise<void> {
    await prePlanArea(0, CAMELOT, 2, ALMERA_AT);
    await prePlan(0, HADLEY_DOWN, TGV_LADDER_STAND);
}

export async function waterfallLeg(bot: SpeedBot, o: { verbose?: boolean; giveRunes?: () => Promise<void>; part2?: boolean } = {}): Promise<Record<string, number | boolean>> {
    await nav();
    bot.holdDialogs = true;
    const t0 = bot.tickCount, m: Record<string, number | boolean> = {};
    const at = (k: string) => { m[k] = bot.tickCount - t0; if (o.verbose) log(bot, t0, `${k} pos=${JSON.stringify(bot.pos())} hp=${bot.stat('hitpoints').cur}`); failHook(`wf:${k}`); };
    trace(bot, t0);
    const opN = (type: number) => () => { const n = npc(bot, type); if (!n) return false; opNpcGo(bot, n, 1); return true; };
    const pray = (on: boolean) => {
        if (bot.stat('prayer').cur < 43) return;
        if (on && !bot.isPrayerActive('protectfrommelee')) { bot.activatePrayer('protectfrommelee'); bot.queueFlush(); }
        if (!on && bot.isPrayerActive('protectfrommelee')) { (bot as any).setPrayer('protectfrommelee', false); bot.queueFlush(); }
    };
    const eat = () => { if (bot.stat('hitpoints').cur <= 5 && bot.count('shark') > 0) { bot.opHeld1(objId('shark'), bot.slot('shark')); bot.queueFlush(); } };
    const fail = (s: string) => { throw new Error(`${s} at ${JSON.stringify(bot.pos())}`); };
    const raft = locAt(1987, 2509, 3493, 0), rock = locAt(1996, 2512, 3468, 0), tree = locAt(2020, 2512, 3465, 0), ledge = locAt(2010, 2511, 3464, 0);
    const hStairs0 = locAt(1737, 2516, 3424, 0), bookcase = locAt(1989, 2520, 3426, 1), hStairs1 = locAt(1736, 2516, 3425, 1);
    const tgvLadder = locAt(1754, 2533, 3155, 0), gCrate = locAt(1990, 2548, 9565, 0), gGate = locAt(1991, 2515, 9575, 0), gLadder = locAt(1757, 2533, 9555, 0);
    const tombstone = locAt(1992, 2558, 3444, 0), chest = locAt(1994, 2530, 9844, 0), coffin = locAt(1993, 2542, 9811, 0), tLadder = locAt(1757, 2556, 9844, 0);
    const bCrate = locAt(1999, 2589, 9888, 0), doorA = locAt(2002, 2568, 9893, 0), doorB = locAt(2002, 2566, 9901, 0);
    const statue = locAt(2006, 2565, 9916, 0), chalice = locAt(2014, 2603, 9910, 0);
    const pillars = PILLARS.map(p => locAt(2004, p.x, p.z, 0));
    const useOn = (obj: number, l: { x: number; z: number; id: number }) => () => { const s = bot.slot(obj); if (s >= 0) bot.useItemOnLoc(l.x, l.z, l.id, obj, s); };

    const toSwimSpot = () => { const me = bot.tile(); const pts = navSync().findLongPath(0, me.x, me.z, 2512, 3477, 50); if (pts.length) bot.sendRoute(turning(me, densify([me, ...pts]).slice(1)), true); };
    // session 11 (so the route may retry the Waterfall): on a retry, the stage the quest JOURNAL shows (waterfall_journal.rs2,
    // latest first: 0 not started, 1 Almera, 2 Hudon, 3 book read, 4 in Glarial's tomb, 5 in the falls, 6 puzzle room,
    // 7 amulet on the statue, 8 complete) + the quest items held + where we stand pick the next step. The route leg's
    // resumeHere keeps a retry that holds a quest item (or stands underground) where it is: an exact-pack bank visit would
    // deposit the book/pebble/amulet/urn. Every source re-gives a lost item (chest, coffin, crate, bookcase); the pillars
    // remember their runes ('You remember putting that type of rune there' = done). WF_RESUME=0 = from the top as before.
    const has = (id: number) => bot.count(id) > 0;
    let S = 0;
    const resuming = !o.part2 && isResuming(bot) && process.env.WF_RESUME !== '0';
    if (resuming) {
        if (bot.chatModalId !== -1 || bot.mainModalId !== -1) { bot.closeModal(); bot.queueFlush(); await bot.tick(1); }
        S = await journalStage<number>(bot, 'waterfall', [
            [/QUEST COMPLETE/i, 8], [/floating\s+out\s+of\s+reach\s+but\s+I\s+worked/i, 7], [/floating\s+out\s+of\s+reach\.\s+I'll\s+need/i, 6],
            [/I\s+should\s+look\s+around\s+and\s+see/i, 5], [/something\s+that\s+will\s+help\s+me\s+down\s+here|I\s+wonder\s+if\s+I\s+can\s+find\s+my\s+way/i, 4],
            [/pebble\s+is\s+used\s+to\s+enter\s+the\s+tomb/i, 3], [/Maybe\s+I\s+need\s+to\s+do\s+a\s+little\s+research/i, 2], [/Hudon's\s+looking\s+for\s+treasure/i, 1],
        ], 0, s2 => log(bot, t0, `[wf] ${s2}`));
        if (S === 8) { m.ok = true; m.resumed = true; return m; }
        m.resumeStage = S;
        log(bot, t0, `[wf] resume at stage ${S}: book ${has(BOOK)} gkey ${has(GOLRIE_KEY)} pebble ${has(PEBBLE)} amulet ${has(AMULET)} urn ${has(URN)} bkey ${has(BAX_KEY)} runes law ${bot.count(563)} air ${bot.count(556)} earth ${bot.count(557)} water ${bot.count(555)} at ${JSON.stringify(bot.pos())}`);
    }
    const T = () => bot.tile(), under = () => bot.tile().z > 6400;
    const inGolrie = () => under() && T().x >= 2500 && T().x <= 2560 && T().z >= 9540 && T().z <= 9600;
    const inTomb = () => under() && T().x >= 2520 && T().x <= 2565 && T().z >= 9800 && T().z <= 9850;
    const inBax = () => under() && T().x >= 2555 && T().x <= 2620 && T().z >= 9860 && T().z <= 9925;
    if (!o.part2) {   // part 2 = debug entry at the raft after the tomb (cheated state)
    // resume: phases A (Almera/raft/swim) and B (book) only while the book is not held; C (pebble) while it is not held;
    // D (tomb) until amulet + urn are held; E/F (falls) after that
    if (S <= 2 && !has(BOOK)) {
    // 1. Camelot -> Almera: chatplayer | chatnpc | multi2 "How can I help?" | chatplayer | chatnpc | chatplayer -> =1,
    //    then route + OPLOC to the raft in the same burst (the MOVE closes her last page)
    if (!(await tele(bot, 'camelot_teleport')).ok) fail('camelot 1');
    at('tele1');
    if (S === 0) {
    if (!(await walkOp(bot, ALMERA_AT, opN(ALMERA), () => inDialog(bot), { near: 1, maxTicks: 300 }))) fail('no Almera dialog');
    at('almera');
    await talk(bot, ALMERA, [R, R, M2[1]!, R, R, R], { noOp: true, done: () => false, maxTicks: 2, adaptive: false, label: 'almera' });
    // the raft refuses until %waterfall_quest (varp 65) != 0, which only "How can I help?" sets. The 2-tick blind burst
    // above sometimes misses it (R13 and R21 both aborted at the raft): verify, and re-talk adaptively if needed.
    const QUEST_VARP = 65;   // %waterfall_quest; not flagged transmit, so the reliable signal is Almera's raft line
    const raftText = () => [...bot.ifText.values()].some(v => /small raft out back|use the raft go ahead/i.test(v));
    const started = () => bot.getVarp(QUEST_VARP) > 0 || raftText();
    if (!(await bot.until(started, 4))) {
        m.almeraRetalk = true;
        for (let k = 0; k < 3 && !started(); k++) {
            if (bot.chatModalId !== -1 || bot.mainModalId !== -1) { bot.closeModal(); bot.queueFlush(); await bot.tick(1); }
            if (!(await walkOp(bot, ALMERA_AT, opN(ALMERA), () => inDialog(bot), { near: 1, maxTicks: 60 }))) continue;
            await talk(bot, ALMERA, [R, R, M2[1]!, R, R, R], { done: started, maxTicks: 30, adaptive: true, label: 'almera2' });
            await bot.until(started, 4);
        }
        if (!started()) fail('Almera: quest not started');
    }
    }   // S === 0
    // walkOp, not a bare route: her back door is on the way (the door tracker opens it)
    dismiss(bot);
    await walkOp(bot, RAFT_STAND, () => bot.opLoc(raft.x, raft.z, raft.id, 1), () => cheb(bot.tile(), RAFT_LAND) <= 1, { maxTicks: S === 0 ? 60 : 300 });
    // 2. raft (p_delay 2,2 -> (2512,3481) -> p_delay 2,2) -> Hudon's forced dialog: 7 pages -> =2; then "Swim to"
    //    the rock (aploc1 from the landing zone) -> washed down to (2527,3413) next to Hadley's house
    // the raft op did not fire (e.g. the MOVE was eaten, or Almera's dialog still open): walk + op again, checked.
    // R13 aborted here: one unchecked retry left the trainee on the bank and the swim then failed far upstream.
    for (let k = 0; k < 4 && !(await bot.until(() => cheb(bot.tile(), RAFT_LAND) <= 1, 2)); k++) {
        m.raftRetries = k + 1;
        dismiss(bot); if (bot.chatModalId !== -1 || bot.mainModalId !== -1) { bot.closeModal(); bot.queueFlush(); await bot.tick(1); }
        await walkOp(bot, RAFT_STAND, () => bot.opLoc(raft.x, raft.z, raft.id, 1), () => cheb(bot.tile(), RAFT_LAND) <= 1, { maxTicks: 40 });
    }
    if (cheb(bot.tile(), RAFT_LAND) > 1) fail('raft');
    at('raft');
    // aploc1 'Swim to': ap range is 10, the rock is 13 south of the landing tile: walk to the zone's south edge
    //    ((2512,3480) S is blocked: a real path, via x 2511)
    const swim = { fn: () => { toSwimSpot(); bot.opLoc(rock.x, rock.z, rock.id, 1); }, cost: 2 };
    if (S >= 2) {   // resume: Hudon already spoken to (no forced dialog): swim straight away
        for (let k = 0; k < 4 && cheb(bot.tile(), SWIM_TELE) > 3; k++) { dismiss(bot); swim.fn(); bot.queueFlush(); await bot.until(() => cheb(bot.tile(), SWIM_TELE) <= 3, 15); }
        if (cheb(bot.tile(), SWIM_TELE) > 3) fail('swim (resume)');
    } else {
    const hud = await talk(bot, HUDON, [R, R, R, R, R, R, R, swim], { noOp: true, done: () => cheb(bot.tile(), SWIM_TELE) <= 3, maxTicks: 25, adaptive: false, label: 'hudon' });
    if (!hud.ok) {
        // no forced dialog (Hudon > 5 tiles away): talk to him (apnpc1 works from range), then swim
        m.hudonFallback = true;
        await talk(bot, HUDON, [R, R, R, R, R, R, R, R, swim], { done: () => cheb(bot.tile(), SWIM_TELE) <= 3, maxTicks: 40, label: 'hudon2' });
        if (cheb(bot.tile(), SWIM_TELE) > 3) fail('swim teleport');
    }
    }
    at('swim');
    // 3. Hadley's stairs -> bookcase (p_delay 2 -> book) -> read (=3) + close + stairs down, one burst
    dismiss(bot);
    if (!(await walkOp(bot, { x: 2516, z: 3423 }, () => bot.opLoc(hStairs0.x, hStairs0.z, hStairs0.id, 1), () => bot.minusedlevel === 1, { maxTicks: 40 }))) fail('hadley stairs');
    if (!(await walkOp(bot, { x: 2519, z: 3426 }, () => bot.opLoc(bookcase.x, bookcase.z, bookcase.id, 1), () => bot.count(BOOK) > 0, { level: 1, maxTicks: 15 }))) fail('bookcase');
    }   // phase A
    if (S <= 2) {
    if (!has(BOOK)) fail('no book (resume)');
    at('book');
    if (bot.minusedlevel !== 1) {   // resume holding an unread book on the ground floor: read it here
        for (let k = 0; k < 3 && !(await bot.until(() => bot.mainModalId !== -1 || inDialog(bot), 4)); k++) { bot.opHeld1(BOOK, bot.slot(BOOK)); bot.queueFlush(); }
        if (bot.chatModalId !== -1 || bot.mainModalId !== -1) { bot.closeModal(); bot.queueFlush(); await bot.tick(1); }
    } else {
    sendToks(bot, [() => bot.opHeld1(BOOK, bot.slot(BOOK)), 'X', () => { routeToLoc(bot, hStairs1); bot.opLoc(hStairs1.x, hStairs1.z, hStairs1.id, 1); }]);
    if (!(await bot.until(() => bot.minusedlevel === 0, 10))) {
        await walkOp(bot, { x: 2517, z: 3426 }, () => bot.opLoc(hStairs1.x, hStairs1.z, hStairs1.id, 1), () => bot.minusedlevel === 0, { level: 1, maxTicks: 10 });
    }
    }
    at('hadley-down');
    }   // phase B
    if (S <= 3 && !has(PEBBLE)) {
    // 4. the long run to the Tree Gnome Village ladder
    dismiss(bot);
    if (resuming && bot.minusedlevel > 0) {   // resume upstairs at Hadley's: down first
        await walkOp(bot, { x: 2517, z: 3426 }, () => bot.opLoc(hStairs1.x, hStairs1.z, hStairs1.id, 1), () => bot.minusedlevel === 0, { level: 1, maxTicks: 20 });
    }
    if (!inGolrie()) {
    if (!(await walkOp(bot, TGV_LADDER_STAND, () => bot.opLoc(tgvLadder.x, tgvLadder.z, tgvLadder.id, 1), () => bot.tile().z > 6400, { maxTicks: resuming ? 900 : 400 }))) fail('tgv ladder');
    at('tgv');
    }
    pray(true);
    if (bot.tile().z < 9576) {   // resume: already inside Golrie's gate -> straight to him
    // 5. Golrie: crate (p_delay 2 -> key), key on the gate (p_delay 2, walk through), talk (4 pages, p_delay 2,
    //    2 pages -> pebble), back through the gate (op1 from inside), ladder up
    if (!has(GOLRIE_KEY) && !(await walkOp(bot, { x: 2548, z: 9566 }, () => bot.opLoc(gCrate.x, gCrate.z, gCrate.id, 1), () => bot.count(GOLRIE_KEY) > 0, { maxTicks: 30 }))) fail('golrie crate');
    at('golrie-key');
    if (!(await walkOp(bot, { x: 2515, z: 9575 }, useOn(GOLRIE_KEY, gGate), () => bot.tile().z >= 9576, { maxTicks: 40 }))) fail('golrie gate in');
    }
    at('gate-in');
    dismiss(bot);
    await talk(bot, GOLRIE, [R, R, R, R], { done: () => false, maxTicks: 6, adaptive: false, label: 'golrie1' });
    if (await waitText(bot, /Could I take this old pebble/, 10)) await talk(bot, GOLRIE, [R, R], { noOp: true, done: () => bot.count(PEBBLE) > 0, maxTicks: 6, label: 'golrie2' });
    // fallback: the burst desynced (Golrie wanders, pages arrive late): re-talk and drive the pages until the pebble lands
    for (let k = 0; k < 5 && bot.count(PEBBLE) === 0; k++) {
        const q = await import('./q-lib.js');
        if (!q.inDialog(bot)) { const n = q.npc(bot, GOLRIE); if (n) q.opNpcGo(bot, n, 1); await bot.until(() => q.inDialog(bot), 12); }
        await q.drive(bot, () => bot.count(PEBBLE) > 0, [/pebble/i], 30, 1);
    }
    if (bot.count(PEBBLE) === 0) fail('no pebble');
    at('pebble');
    dismiss(bot);
    for (let k = 0; k < 8 && bot.tile().z >= 9576; k++) await walkOp(bot, { x: 2515, z: 9576 }, () => bot.opLoc(gGate.x, gGate.z, gGate.id, 1), () => bot.tile().z < 9576, { maxTicks: 4 });
    if (!(await walkOp(bot, { x: 2533, z: 9556 }, () => bot.opLoc(gLadder.x, gLadder.z, gLadder.id, 1), () => bot.tile().z < 6400, { maxTicks: 40 }))) fail('golrie ladder up');
    at('tgv-up');
    pray(false);
    }   // phase C
    if (resuming && inGolrie()) {   // resume: pebble held, still in Golrie's cave: out through the gate + up the ladder
        for (let k = 0; k < 8 && bot.tile().z >= 9576; k++) await walkOp(bot, { x: 2515, z: 9576 }, () => bot.opLoc(gGate.x, gGate.z, gGate.id, 1), () => bot.tile().z < 9576, { maxTicks: 4 });
        if (!(await walkOp(bot, { x: 2533, z: 9556 }, () => bot.opLoc(gLadder.x, gLadder.z, gLadder.id, 1), () => bot.tile().z < 6400, { maxTicks: 40 }))) fail('golrie ladder up (resume)');
        pray(false);
    }
    if (S <= 3 || (S === 4 && !inTomb() && !(has(AMULET) && has(URN)))) {
    // 6. Camelot (the last runes) -> tombstone: pebble on it (p_delay 2,2,2) -> tomb (2554,9844), =4
    if (!resuming || (bot.count(563) >= 1 && bot.count(556) >= 5)) {
        if (!(await tele(bot, 'camelot_teleport')).ok) fail('camelot 2');
        at('tele2');
    }
    if (bot.inv().some(s => [554, 555, 556, 557, 558, 559, 560, 561, 562, 563, 564, 565, 566].includes(s.obj))) fail('runes left: the tomb would refuse');
    if (!has(PEBBLE)) fail('no pebble for the tombstone (resume)');
    if (!(await walkOp(bot, { x: 2559, z: 3443 }, useOn(PEBBLE, tombstone), () => bot.tile().z > 6400, { maxTicks: resuming ? 700 : 160 }))) fail('tombstone');
    at('tomb');
    }   // tomb entry
    if (!(has(AMULET) && has(URN)) || inTomb()) {
    pray(true);
    // 7. chest (Open, then Search -> amulet), coffin (p_delay 1,1 -> urn), ladder up
    const chestOpen = { ...chest, id: 1995 };
    if (!has(AMULET)) {
    if (!(await walkOp(bot, { x: 2531, z: 9844 }, () => bot.opLoc(chest.x, chest.z, chest.id, 1), () => bot.liveLocs.get(`0,${chest.x},${chest.z}`) === 1995 || bot.count(AMULET) > 0, { maxTicks: 30 }))) fail('chest open');
    for (let k = 0; k < 8 && bot.count(AMULET) === 0; k++) { bot.opLoc(chestOpen.x, chestOpen.z, chestOpen.id, 1); bot.queueFlush(); await bot.tick(1); eat(); }
    if (bot.count(AMULET) === 0) fail('no amulet');
    }
    at('amulet');
    if (!has(URN) && !(await walkOp(bot, { x: 2543, z: 9812 }, () => bot.opLoc(coffin.x, coffin.z, coffin.id, 1), () => bot.count(URN) > 0, { maxTicks: 40 }))) fail('coffin');
    at('urn');
    if (!(await walkOp(bot, { x: 2557, z: 9844 }, () => bot.opLoc(tLadder.x, tLadder.z, tLadder.id, 1), () => bot.tile().z < 6400, { maxTicks: 40 }))) fail('tomb ladder');
    at('tomb-up');
    pray(false);
    }   // phase D
    } // end part 1
    if (!inBax()) {
    // 8. raft again; the helper trades the pillar runes on the way (local: cheat, not counted in ticks? it IS
    //    counted: the cheat costs ~2 ticks, close to the ~4-tick trade)
    const pillarRunes = bot.count(556) >= 6 && bot.count(557) >= 6 && bot.count(555) >= 6;
    if (o.giveRunes && !(resuming && (pillarRunes || S >= 5))) await o.giveRunes();
    at('runes');
    if (!(await walkOp(bot, RAFT_STAND, () => bot.opLoc(raft.x, raft.z, raft.id, 1), () => cheb(bot.tile(), RAFT_LAND) <= 1, { maxTicks: resuming ? 400 : 80 }))) fail('raft 2');
    at('raft2');
    // 9. rope on the rock (aplocu, forcemoves to 2513,3468), rope on the tree (-> ledge 2511,3463), ledge door (=5)
    // re-send only while still standing in the landing zone (the rope script force-walks us through the water)
    for (let k = 0; k < 30 && !(bot.tile().x === 2513 && bot.tile().z === 3468); k++) {
        if (k % 4 === 0 && bot.tile().z >= 3476) { toSwimSpot(); useOn(954, rock)(); bot.queueFlush(); }
        await bot.tick(1);
    }
    at('rock');
    const opUntil = async (send: () => void, done: () => boolean, maxTicks: number, every = 3) => {
        for (let k = 0; k < maxTicks && !done(); k++) { if (k % every === 0) { send(); bot.queueFlush(); } await bot.tick(1); }
        return done();
    };
    if (!(await opUntil(() => { routeToLoc(bot, tree); useOn(954, tree)(); }, () => bot.tile().z <= 3463, 12))) fail(`tree: ${msgsSince(bot, t0).slice(-3).join(' | ')}`);
    at('ledge');
    if (!(await opUntil(() => bot.opLoc(ledge.x, ledge.z, ledge.id, 1), () => bot.tile().z > 6400, 12, 5))) fail('ledge door');
    at('dungeon');
    }   // into the falls
    pray(true);
    if (S <= 6) {
    // 10. crate (key), door A, door B (=6)
    if (!has(BAX_KEY) && !(await walkOp(bot, { x: 2589, z: 9887 }, () => bot.opLoc(bCrate.x, bCrate.z, bCrate.id, 1), () => bot.count(BAX_KEY) > 0, { maxTicks: 40 }))) {
        // B1 (live): stood on the tile with the dungeon's skeletons/spiders on it and the single op was lost: re-send
        for (let k = 0; k < 10 && bot.count(BAX_KEY) === 0; k++) { routeToLoc(bot, bCrate); bot.opLoc(bCrate.x, bCrate.z, bCrate.id, 1); bot.queueFlush(); await bot.until(() => bot.count(BAX_KEY) > 0, 3); eat(); }
        if (bot.count(BAX_KEY) === 0) fail(`baxtorian crate (${msgsSince(bot, bot.tickCount - 60).slice(-4).join(' | ')}; npcs ${Array.from(bot.npcIndices.slice(0, bot.npcCount), i => bot.npcs[i]).filter(Boolean).map(n => `${n!.typeId}`).slice(0, 8).join(',')})`);
    }
    at('bax-key');
    if (bot.tile().z < 9894 && !(await walkOp(bot, { x: 2568, z: 9893 }, useOn(BAX_KEY, doorA), () => bot.tile().z >= 9894, { maxTicks: 50 }))) fail('door A');
    at('doorA');
    if (bot.tile().z < 9902 && !(await walkOp(bot, { x: 2566, z: 9901 }, useOn(BAX_KEY, doorB), () => bot.tile().z >= 9902, { maxTicks: 20 }))) fail('door B');
    at('doorB');
    // 11. 18 runes on 6 pillars (each use: p_delay(0) -> 2 ticks), the amulet on the statue (=8, -> 2603,9914)
    // (resume: a pillar that already holds the rune answers 'You remember putting that type of rune there' = done)
    for (const p of pillars) {
        for (const rune of [556, 557, 555]) {
            const before = bot.count(rune), tu = bot.tickCount;
            const placed = () => bot.count(rune) < before || (resuming && msgsSince(bot, tu).some(t => /remember putting that type of rune/i.test(t)));
            for (let k = 0; k < 8 && !placed(); k++) {
                routeToLoc(bot, p); useOn(rune, p)(); bot.queueFlush();
                await bot.tick(1); eat();
                if (resuming && !placed()) await bot.tick(1);
            }
            if (!placed()) fail(`pillar ${p.x},${p.z} rune ${rune}`);
        }
    }
    at('pillars');
    if (!(await walkOp(bot, { x: 2565, z: 9915 }, useOn(AMULET, statue), () => cheb(bot.tile(), TREASURE) <= 2, { maxTicks: 20 }))) fail('statue');
    at('statue');
    pray(false);
    } else if (cheb(bot.tile(), TREASURE) > 6) {   // resume at stage 7 away from the raised room: door B with the key lifts you there
        if (!(await walkOp(bot, { x: 2566, z: 9901 }, useOn(BAX_KEY, doorB), () => cheb(bot.tile(), TREASURE) <= 8, { maxTicks: 120 }))) fail('door B to the raised room (resume)');
        pray(false);
    }
    // 12. the urn on the chalice (p_delay 0,2 -> queue: =10, att/str xp)
    const a0 = bot.stat('attack').xp;
    if (!(await walkOp(bot, { x: 2603, z: 9912 }, useOn(URN, chalice), () => bot.stat('attack').xp > a0, { maxTicks: 20 }))) fail('chalice');
    m.ok = true;
    at('done');
    return m;
}

if (import.meta.main) {
    if (!/^(localhost|127\.)/.test(process.env.LC_HOST ?? '')) { console.error('set LC_HOST=localhost:8888'); process.exit(1); }
    const sfx = process.argv[2] ?? String(Date.now() % 100000);
    const bot = await SpeedBot.create(`qwat${sfx}`);
    dropAllOf(bot, [...KIT_JUNK, 'airrune', 'waterrune']); await bot.tick(5);
    // route state at leg 15: magic ~80, prayer 99, hp 10, att/str 1; standing at Varrock west bank
    await localSetup(bot, { stats: { magic: 80, prayer: 99 }, items: WATERFALL_SUPPLY, tele: { x: 3185, z: 3436 } });
    await waterfallPrep();
    await bot.tick(2);
    if (process.argv[3] === 'part2') {
        await bot.cheat('setvar waterfall_quest 4');
        await localSetup(bot, { items: [{ name: 'glarials_amulet_waterfall_quest', n: 1 }, { name: 'glarials_urn_full_waterfall_quest', n: 1 }], tele: { x: 2557, z: 3444 } });
        const { rec } = await runLeg(bot, 'q-waterfall-part2', b => waterfallLeg(b, { verbose: true, part2: true, giveRunes: () => localSetup(b, { items: WATERFALL_PILLAR_SUPPLY }) }));
        console.log(`[q-waterfall] part2 ${rec.ticks} ticks ${JSON.stringify(rec.result)}`);
        await bot.logout(); process.exit(rec.ok ? 0 : 1);
    }
    const { rec } = await runLeg(bot, 'q-waterfall', b => waterfallLeg(b, { verbose: true, giveRunes: () => localSetup(b, { items: WATERFALL_PILLAR_SUPPLY }) }));
    console.log(`[q-waterfall] ${rec.ticks} ticks ${JSON.stringify(rec.result)} | gh_kadeski 1,045`);
    await bot.logout();
    process.exit(rec.ok ? 0 : 1);
}
