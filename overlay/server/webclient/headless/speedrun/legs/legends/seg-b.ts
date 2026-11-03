// =====================================================================================================
// legs/legends/seg-b.ts — LEGENDS' QUEST segment B: stage 5 (accepted the Ungadulu rescue) -> 12 (Nezikchened (fire) defeated)
// =====================================================================================================
// ⛔ CHEATLESS: no bot.cheat / localSetup / simSetup / setvar in here. Gates are observables only (items, position, dialog
//    text, game messages, npcs in view).
//
// Route (content: quest_legends.rs2, ungadulu.rs2, gujuo.rs2, nezikchened.rs2, bullroarer.rs2, jungle_tree.rs2, smithing.rs2):
//   1 search the cave rocks 2902 (2782,2935) -> stage 6, crawl (agility 50) -> cavern (2773,9341)
//   2 Investigate a Fire Wall 2908 (2788,9326) -> Ungadulu talks -> stage 7; "Who are you?" sets asked_where + asked_who
//   3 Cave entrance 2903 (2773,9342) -> (2781,2934)
//   4 bullroarer -> Gujuo walks up -> "I need some pure water to douse some magic flames." -> stage 8
//   5 chop out of the jungle north (x 2795, 2939..2942), walk to the anvil 2783 (2790,3101): gold bar on anvil -> golden bowl
//   6 chop back in, bullroarer -> Gujuo -> bless the bowl (prayer >= 42; the roll FAILS often, -5 prayer each try; retry)
//   7 machete on Tall Reeds 2944 (2836,2916) -> hollow reed; reed on Water Pool 2942 (2837,2915) -> blessed bowl of pure
//     water, stage 10. NO jungle chopping from here on (a chop evaporates the bowl, jungle_tree.rs2:31).
//   8 cave again; bookcase 2911 (2795,9339) crevice -> east tunnel; lockpick gate 2913 (2809,9332) (thieving 50 + lockpick);
//     3 boulders 2919/2920/2921 (mining 52 + pickaxe); strength gate 2923 (2809,9314) (strength 50); Jagged wall 2926
//     (agility 50) -> walled cavern; soul, mind, earth, law, law on the Marked wall 2927 (2779,9305) -> gem room (2774,9301)
//   9 the 7 cut gems on their Carved rocks 2928 -> Book of Binding appears at (2765,9297): take it
//  10 back: Marked wall (2776,9303) -> jagged wall -> strength gate -> boulders -> lockpick gate (lever side) -> crevice 2918
//     (2799,9341) -> main cave
//  11 bowl of pure water on the Fire Wall (2788,9326) -> inside the octagram; Book of Binding on Ungadulu -> stage 11,
//     Nezikchened spawns (prayer drained to 10%); prayer potion + Protect from Melee; kill him -> stage 12
// EXIT STATE (for C): inside the flaming octagram next to Ungadulu (~2789-2796, 9325-9332, level 0), stage 12, blessed bowl
//   of pure water (9 doses left; C germinates the yommi seeds with it), book of binding, bullroarer, map, axe, machete,
//   hammer, lockpick, rune pickaxe, rune scimitar worn, left-over sharks/potions. legends_bits: 0-2 (jungle mapped),
//   4+5 (asked_ungadulu_where/who), 7-11 (the five rune bits), bowl uses = 1; gem bits cleared when the book was taken.
import { SpeedBot, objId, objDebugName, cheb } from '../../core.js';
import { nav, npc, npcsOf, locAt, opLocGo, useOnLocGo, opNpcGo, msgsSince, inDialog, levelUpOpen, dismiss, dropAllOf, KIT_JUNK, pickupGo } from '../q-lib.js';
import * as locScene from '../../../loc-scene.js';
import { PREREQ, MEET, type Seg, type SegCtx } from './common.js';
import { isResuming, journalStage, readJournal, failHook } from '../qp/journal.js';

const UNGADULU = 929, GUJUO = 928, NEZIK = 934;
const L = {
    caveRock: [2902, 2782, 2935], caveExit: [2903, 2773, 9342], fireWall: [2908, 2788, 9326], bookcase: [2911, 2795, 9339],
    crevice: [2918, 2799, 9341], lockGate: [2913, 2809, 9332], boulder1: [2919, 2809, 9327], boulder2: [2920, 2809, 9323],
    boulder3: [2921, 2809, 9319], strGate: [2923, 2809, 9314], jagged: [2926, 2789, 9295], markIn: [2927, 2779, 9305],
    markOut: [2927, 2776, 9303], reeds: [2944, 2836, 2916], pool: [2942, 2837, 2915], anvil: [2783, 2790, 3101],
} as const;
// gem -> its carved rock (quest_legends.constant ^legends_*_coord), in a short walking order from the gem-room entry (2774,9301)
const GEMS: Array<[string, number, number]> = [
    ['jade', 2771, 9303], ['opal', 2764, 9309], ['emerald', 2757, 9297], ['ruby', 2767, 9289],
    ['diamond', 2774, 9287], ['sapphire', 2781, 9291], ['red_topaz', 2772, 9295],
];
const PRAYER_POTS = [143, 141, 139, 2434];   // 1..4 dose prayer restore (lowest first)
/** open jungle inside the kharazi_jungle zone (z <= 2935) where Gujuo can walk up to us (bullroarer.rs2) */
const GUJUO_SPOT = { x: 2800, z: 2926 };
const JUNGLE = new Set([2887, 2889, 2890, 2892, 2893]);
const IN_CAVE = () => (b: SpeedBot) => b.tile().z > 9000;

export const SEG_B: Seg = {
    id: 'B', title: 'Ungadulu, the golden bowl, the Book of Binding, Nezikchened (fire)', fromStage: 5, toStage: 12,
    pre: {
        ...PREREQ,
        varps: { ...(PREREQ.varps ?? {}), legendsquest: 5, legends_bits: 0b111 },
        stats: {
            attack: 99, strength: 99, defence: 99, hitpoints: 99, prayer: 99, magic: 99, agility: 99, mining: 99,
            smithing: 99, thieving: 99, woodcutting: 99, crafting: 99, herblore: 99, ...(PREREQ.stats ?? {}),
        },
        // what segment A leaves: the completed jungle map, the bullroarer, the axe + machete it chopped in with
        items: [...(PREREQ.items ?? []), { name: 'thkaramjamapcomp', n: 1 }, { name: 'bullroarer', n: 1 }, { name: 'rune_axe', n: 1 }, { name: 'machette', n: 1 }],
        tele: { x: 2781, z: 2933 },
        clear: true,   // sim: drop the fresh account starter kit so A's items + the supply fit
    },
    // hand-off 1 (before the segment): fight kit only, 6 slots (5 once the scimitar is worn), fits beside whatever A leaves (A's pack can be 15+ slots of logs etc.)
    // (1 potion = 4 doses: the blessing fallback below 42 prayer + Protect from Melee for the Nezikchened fight)
    supply: [{ name: 'rune_scimitar', n: 1 }, { name: '4doseprayerrestore', n: 1 }, { name: 'shark', n: 4 }],
    run: runB,
};
/** hand-off 2 (ctx.resupply, right after B drops A's junk and wields the scimitar): the quest kit, 16 slots.
 *  Pack then (chain ab2): map, machete, rune axe, bullroarer, A-s air+water runes, coins (7) + 5 fight kit + 16 = 28. */
/** helper mode: sharks topped up to this at the anvil meeting (the helper's B list carries them; B ate 0-2 in the sims) */
export const B_SHARKS = 4;
/** 318a: below this many sharks (and hurt by 25+) after the blessing, the helper tops sharks up before the dungeon */
export const B_FOOD_MIN = Number(process.env.LG_B_FOOD_MIN ?? 2);
/** fix 417 ( acct9, --existing hard-full, Legends attempt 2: B fought Nezikchened with sharks=0, hp 40 -> 25,
 *  then C walked the jungle at hp 20). 318a topped food up only when BOTH sharks < 2 AND hp < level-25, so a bot with 1 shark
 *  and hp 80 went into the dungeon (strength gate 8 x2, crevice/jagged wall 5 each: quest_legends.rs2:348/509/615) and met
 *  the demon with nothing. Content (quest_legends.npc [nezikchened]): att 165, str 168 (max hit 18), 150 hp, attackrate 5,
 *  melee next to us / ^nezikchened_mage_attack (max 18) from range (nezikchened.rs2:48-56); the summon takes 75% of the
 *  current prayer (:145) and the defeat bolt hits up to 16 (:203). Protect from Melee is the right prayer (we melee him).
 *  Now: (a) before the pure water (the last point B can chop out) the bot needs >= 3 sharks, hp + 20/shark >= level + 40 and
 *  >= 1 prayer potion, else the helper (--existing: the bank) tops it up to B_NEZ_SHARKS + the sharks that heal it to near
 *  full and it eats up at the meeting. (--existing also needed route-lib BankHelper's shortfall -> total fix: before it a
 *  top-up of sharks already held fetched nothing, the belt meeting's included);
 *  (b) a hard gate before the fire wall: hp >= max(60, 70%), >= 2 sharks, a prayer potion or prayer >= 40, else out of the
 *  cave, restock, refill the bowl, back in (no helper: fail = the Runner's fail safe, never a fight on no food).
 *  LG_B_SAFE=0 reverts all of fix 417. TEST: LG_B_SAFE_TEST=food (drops all sharks after the blessing) / =nez (drops all
 *  sharks but 1 before the fire wall). */
export const B_SAFE = process.env.LG_B_SAFE !== '0';
export const B_NEZ_SHARKS = Number(process.env.LG_B_NEZ_SHARKS ?? 4);
/** helper mode: prayer potions held after the anvil meeting (the helper's B list carries the extra one; LG_B_PRAYER) */
export const B_POTS = 2;
/** helper mode: the anvil-trip kit = the quest kit with law topped up to 4 (wall 2 + E's Camelot 1 + 1 spare; lge2 reached E
 *  with none) + sharks to B_SHARKS (topped up in the free slots) */
export const SEG_B_HELPER_LAW = 4;
/** session 11 helper W, W2 (fork qye03 'B: out of gold bars': ONE "You make a mistake forging the bowl." with the kit's 2 bars).
 *  quest_legends.rs2 make_golden_bowl: needs 2 bars; stat_random(smithing, 31, 256) fails ~9% at smithing 89, and a failure
 *  eats 1 bar (121/256) or 2 (135/256). 2 bars = one try (~9% fail -> a ~500 t retry with a 2nd helper trip); +2 spare bars
 *  (4) leave >= 2 tries (fail ~0.7%). The helper carries them (route-legs legends stock + B send list); the belt meeting takes
 *  them when the pack has room (Sea Slug leftovers dropped for it), leftovers dropped after the bowl. LG_B_SPARE_BARS=0 reverts. */
export const B_SPARE_BARS = process.env.LG_B_SPARE_BARS === '0' ? 0 : Number(process.env.LG_B_SPARE_BARS ?? 2) || 0;
/** W2: carried leftovers no Legends step uses (Sea Slug torch/sticks/glass, pearls): dropped at the belt meeting for the spare bars */
const B_ROOM_JUNK = ['broken_glass', 'damp_sticks', 'dry_sticks', 'torch_lit', 'bigoysterpearls'];
export const SEG_B_RESUPPLY = [
    { name: 'gold_bar', n: 2 }, { name: 'hammer', n: 1 }, { name: 'lockpick', n: 1 }, { name: 'rune_pickaxe', n: 1 },
    { name: 'soulrune', n: 1 }, { name: 'mindrune', n: 1 }, { name: 'earthrune', n: 1 }, { name: 'lawrune', n: 2 },
    { name: 'opal', n: 1 }, { name: 'jade', n: 1 }, { name: 'red_topaz', n: 1 }, { name: 'sapphire', n: 1 },
    { name: 'diamond', n: 1 }, { name: 'ruby', n: 1 }, { name: 'emerald', n: 1 },
];

async function runB(bot: SpeedBot, ctx: SegCtx): Promise<Record<string, unknown>> {
    await nav();
    bot.holdDialogs = true;
    const t0 = bot.tickCount, marks: Record<string, number> = {};
    const log = (s: string) => console.log(`[B +${String(bot.tickCount - t0).padStart(4)}] ${s} pos=${JSON.stringify(bot.pos())} hp=${bot.stat('hitpoints').cur} pr=${bot.stat('prayer').cur}`);
    // failHook (resume proofs): SR_FAIL_AT=B:<mark> throws once right after that mark
    const mark = (k: string) => { marks[k] = bot.tickCount - t0; log(k); failHook(`B:${k}`); };
    const msgs = (since: number) => msgsSince(bot, since);
    const fail = (s: string): never => { throw new Error(`B: ${s} at ${JSON.stringify(bot.pos())} msgs: ${msgs(t0).slice(-4).join(' | ')}`); };
    const loc = (k: keyof typeof L) => { const [id, x, z] = L[k]; return locAt(id, x, z, 0); };
    const me = () => bot.tile();

    /** Resume pages / answer choices (first matching regex) until done. Unmatched choice: log once and fail. */
    const dlg = async (label: string, done: () => boolean, answers: RegExp[], maxTicks = 60): Promise<boolean> => {
        const end = bot.tickCount + maxTicks; let lastSig = '', lastClick = -99, closedFor = 0;
        while (!done() && bot.tickCount < end && !bot.disposed) {
            // nothing open for 20 t (longest scripted gap: Gujuo s ~12-t meditation): the talk was interrupted (an animal hit
            // us, a roll failed) - hand back to the caller instead of standing idle
            closedFor = bot.chatModalId === -1 && bot.mainModalId === -1 ? closedFor + 1 : 0;
            if (closedFor >= 20) return done();
            // survival beats the conversation: eating closes it (the callers retry the talk)
            if (bot.stat('hitpoints').cur < 30 && held('shark')) { log(`${label}: hp low in a dialog - eating`); eatIfLow(30); await bot.tick(1); return done(); }
            if (bot.chatModalId !== -1) {
                const opts = bot.dialogOptions();
                if (opts.length) {
                    const sig = opts.map(o => o.text).join('|');
                    if (sig !== lastSig || bot.tickCount - lastClick >= 3) {
                        let hit = -1;
                        for (const re of answers) { hit = bot.clickDialogByText(re); if (hit > 0) break; }
                        if (hit < 0) { console.log(`[B] ${label}: unplanned choice [${sig}]`); return false; }
                        lastSig = sig; lastClick = bot.tickCount;
                    }
                } else bot.resumeDialogPage();
                bot.queueFlush();
            } else if (bot.mainModalId !== -1) { bot.closeModal(); bot.queueFlush(); }
            await bot.tick(1);
        }
        return done();
    };
    /** Re-send an action every `every` ticks (routing included) until done; dialogs opened by it are left to the caller. */
    const act = async (label: string, send: () => void, done: () => boolean, maxTicks = 60, every = 5, stopOnDialog = false): Promise<void> => {
        const end = bot.tickCount + maxTicks; let last = -100;
        while (!done() && bot.tickCount < end && !bot.disposed) {
            if (stopOnDialog && inDialog(bot)) return;
            if (bot.tickCount - last >= every) { if (levelUpOpen(bot)) bot.resumeDialogPage(); send(); bot.queueFlush(); last = bot.tickCount; }
            await bot.tick(1);
        }
        if (!done() && !(stopOnDialog && inDialog(bot))) fail(label);
    };
    // fix 415 helpers: the x=2816 belt column (helper mode) and 'am I inside the Kharazi jungle'
    const COL0 = ctx.helper ? 2816 : 2795, IN_Z0 = ctx.helper ? 2936 : 2938, OUT_Z0 = ctx.helper ? 2940 : 2943;
    const insideJungle = () => { const t = me(); return t.z <= 2941 && t.x >= 2760 && t.x <= 2900; };
    /** travel to the belt meeting (2816,2947) with the route planner (needs a glory in the pack: no ship edge to that target), then
     *  drop the travel glory (it would cost the slot the spare gold bars need; a charged glory is droppable) */
    const reachBeltFromOutside = async () => {
        log(`415: B is outside the jungle at ${JSON.stringify(me())}: travel to the belt meeting ${MEET.B.x},${MEET.B.z}`);
        const { travelTo } = await import('../qp/route/route-lib.js');
        const tr = await travelTo(bot, { x: MEET.B.x, z: MEET.B.z, level: 0 }, new Set<string>(), { near: 2, tag: 'legends-B', maxTicks: 900 });
        log(`415: travel ${tr.ok ? 'OK' : 'short'} (${tr.how}, ${tr.ticks} t, est ${tr.est})`);
        if (!tr.ok && cheb(me(), MEET.B) > 3) fail(`415: travel to the belt meeting failed (${tr.how}, ${tr.ticks} t)`);
        // core's glory guard refuses every glory drop (SR_GLORY_GUARD); this one is deliberate: lift the guard for the drop only
        // LG_B_KEEP_GLORY=1 (set by legs/qp/route/existing-lib.ts only): the BANK is the belt helper there, and the
        // bank round trip from the belt needs this glory (sim l2: dropped here -> 'no reachable bank from (2816,2947)' x2)
        if (process.env.LG_B_KEEP_GLORY === '1') { log('415: travel glory kept (F2: the bank trip from the belt needs it)'); return; }
        const guard0 = bot.gloryGuard; bot.gloryGuard = false;
        try {
            for (const g of ['amulet_of_glory_4', 'amulet_of_glory_3', 'amulet_of_glory_2', 'amulet_of_glory_1', 'amulet_of_glory']) {
                for (let k = 0; k < 3 && bot.count(g) > 0; k++) { const n0 = bot.count(g); bot.dropItem(objId(g), bot.slot(g)); bot.queueFlush(); await bot.tick(1); if (bot.count(g) >= n0) break; }
            }
        } finally { bot.gloryGuard = guard0; }
        log(`415: travel glory dropped (${bot.inv().some(sl => /^amulet_of_glory/.test(objDebugName(sl.obj))) ? 'STILL HELD' : 'gone'}); pack ${bot.inv().length}/28`);
    };
    const walk = async (x: number, z: number, near = 0, maxTicks = 400) => {
        const r = await bot.walkTo(x, z, { near, maxTicks });
        if (cheb(me(), { x, z }) > Math.max(near, 1)) log(`walk to ${x},${z} short: ${JSON.stringify(r)}`);
        if (!r.ok && cheb(me(), { x, z }) > Math.max(near, 1)) fail(`walk to ${x},${z}: ${r.message ?? ''}`);
    };
    // chopLine (moved up from the anvil block, same code): fix 415 needs it at the segment entry
    const chopLine = async (label: string, col: number, toZ: number) => {
        const dz = Math.sign(toZ - me().z);
        let blocked = 0;
        for (let k = 0; k < 20 && me().z !== toZ; k++) {
            const p = me(); const nz = p.z + dz;
            const st = locScene.getLocsAt(col, nz, 0, { includeUnnamed: true }).find(l => JUNGLE.has(l.id));
            const live = bot.liveLocs.get(`0,${col},${nz}`);
            if (st && (live === undefined || live === st.id)) {
                const s = bot.tickCount;
                // op1 = start chop (sets the action delay, then p_oploc); re-send if no progress
                await act(`${label}: chop ${col},${nz}`, () => { bot.opLoc(col, nz, st.id, 1); }, () => me().z !== p.z || msgs(s).some(m => /blocked off/.test(m)), 60, 12);
                // 'blocked off' = the landing tile is taken right now (lge3 at 2795,2941: a forester/scorpion on it): wait, retry
                if (msgs(s).some(m => /blocked off/.test(m)) && me().z === p.z) { if (++blocked > 4) fail(`${label}: jungle blocked at ${col},${nz}`); log(`${label}: blocked off at ${col},${nz} - retry ${blocked}`); await bot.tick(4); }
            } else if (st) {
                // a static jungle loc whose live id differs: depleted by our own chop on the way out and maybe respawned out of
                // view (stale liveLocs; lgf2 'jungle in: step to 2816,2939'): chop the static id (resent until it respawns), with a
                // plain step every 3rd send in case the depleted stage is walkable (as seg-c's chopBelt does)
                let n = 0; const s = bot.tickCount;
                await act(`${label}: chop/step ${col},${nz}`, () => { if (++n % 3 === 0) bot.sendRoute([{ x: col, z: nz }], false); else bot.opLoc(col, nz, st.id, 1); },
                    () => me().z !== p.z || msgs(s).some(m => /blocked off/.test(m)), 150, 8);
            } else {
                let moved = false;
                for (let j = 0; j < 5 && !moved; j++) { bot.sendRoute([{ x: col, z: nz }], false); bot.queueFlush(); moved = await bot.until(() => me().z !== p.z, 3); }
                if (!moved) fail(`${label}: step to ${col},${nz}`);
            }
        }
    };
    const held = (o: string) => bot.count(o) > 0;
    /** jungle chops hand out logs (jungle_tree.rs2:131): drop everything that is not ours (keeps the slots for reed/bowl/book) */
    // junk = jungle logs + A's leftovers (papyrus, charcoal) + the tutorial kit. Everything else (quest items, coins) is kept, and
    // so are the tutorial-kit runes the quest kit itself needs (mind, earth): a live trainee may carry the kit in from the start.
    const KIT_NAMES = new Set(SEG_B_RESUPPLY.map(i => i.name));
    const JUNK = [...KIT_JUNK.filter(n => !KIT_NAMES.has(n)), 'logs', 'papyrus', 'charcoal'];
    let junkDropped = false;
    const dropJunk = () => {
        const junk = new Set((junkDropped ? ['logs'] : JUNK).map(objId));
        const n = dropAllOf(bot, [...junk]); junkDropped = true;
        if (n) log(`dropped ${n} junk stacks`);
        return n;
    };
    /** helper mode, at MEET.B (north of the belt, before the anvil): make room (surplus sharks above 3, eaten if hurt), then the helper trades the quest kit */
    const helperKit = async () => {
        const kit = SEG_B_RESUPPLY.map(i => i.name === 'lawrune' ? { ...i, n: SEG_B_HELPER_LAW } : i);
        const miss = () => kit.filter(i => bot.count(i.name) < i.n).map(i => ({ name: i.name, n: i.n - bot.count(i.name) }));
        const slots = () => miss().reduce((n, i) => n + (/rune$/.test(i.name) ? (bot.count(i.name) > 0 ? 0 : 1) : i.n), 0);
        // fix 289 TEST: LG_B_SPARE_ROOM_TEST=1 drops the Sea Slug leftovers + staff first = qx33m's pack (11/28, 4 sharks, none
        // of them held), so the spare-bar shark branch below runs as it would have there
        if (process.env.LG_B_SPARE_ROOM_TEST === '1') {
            for (const n of [...B_ROOM_JUNK, 'staff_of_air']) for (let k = 0; k < 3 && bot.count(n) > 0; k++) { bot.dropItem(objId(n), bot.slot(n)); bot.queueFlush(); await bot.tick(1); }
            log(`289 TEST: leftovers dropped, pack ${bot.inv().length}/28 sharks ${bot.count('shark')}`);
        }
        // fix 315 TEST (LG_B_KIT_TEST=1; run with SR_HELPER_FOOD=8 so the helper holds more sharks than fit): qx71m's pack at
        // the belt = leftovers + staff + ALL sharks gone, one prayer potion kept (7/28): the helper's 'all' sharks + the pot
        // overflow the pack; before fix 315 the trade looped 'timeout' (the pot counted 0 slots)
        if (process.env.LG_B_KIT_TEST === '1') {
            for (const n of [...B_ROOM_JUNK, 'staff_of_air', 'shark']) for (let k = 0; k < 8 && bot.count(n) > 0; k++) { bot.dropItem(objId(n), bot.slot(n)); bot.queueFlush(); await bot.tick(1); }
            log(`315 TEST: pack ${bot.inv().length}/28 sharks ${bot.count('shark')} pots ${bot.inv().filter(x => PRAYER_POTS.includes(x.obj)).length}`);
        }
        for (let k = 0; k < 8 && bot.free() < slots() && bot.count('shark') > 3; k++) {
            const sl = bot.slot('shark');
            if (bot.stat('hitpoints').cur < bot.stat('hitpoints').level - 20) bot.opHeld1(objId('shark'), sl); else bot.dropItem(objId('shark'), sl);
            bot.queueFlush(); await bot.tick(2);
        }
        // session 8 (allchaos fork qt45fm: 'no room for the quest kit at the belt meeting (free 13 < 15)' with jungle logs from
        // the machete hacking still held): drop the junk (logs, papyrus, charcoal...) first, then sharks above 2. LG_B_ROOM=0 reverts.
        if (bot.free() < slots() && process.env.LG_B_ROOM !== '0') {
            await dropJunkSure(); dropJunk(); await bot.tick(2);
            // fork qt45hm: free 14 for 15 with a staff of air held from earlier legs (no Legends step uses a staff)
            for (const n of ['staff_of_air', 'staff_of_water', 'staff_of_earth', 'staff_of_fire', 'staff']) if (bot.free() < slots() && bot.count(n) > 0) { bot.dropItem(objId(n), bot.slot(n)); bot.queueFlush(); await bot.tick(2); }
            for (let k = 0; k < 8 && bot.free() < slots() && bot.count('shark') > 2; k++) { const sl = bot.slot('shark'); bot.dropItem(objId('shark'), sl); bot.queueFlush(); await bot.tick(2); }
            log(`belt meeting room: free ${bot.free()} for ${slots()}`);
        }
        if (bot.free() < slots()) fail(`helper mode: no room for the quest kit at the belt meeting (free ${bot.free()} < ${slots()})`);
        // fix 421 ( acct25, --existing hard-full: B began 'pack 11/28 sharks=3 hp=51 pr=0', no prayer potion;
        // the belt meeting below fits food only in the slots LEFT after the 16-slot quest kit, the spare bars and a 1-slot
        // reserve, capped at B_SHARKS (4) total: 0-1 shark and 0-1 pot came, hp stayed 51, and the 417 check before the dungeon
        // had to restock - a 2nd glory trip, chop out/in). With the BANK as the helper (--existing, LG_B_BANK_KIT=1 from
        // the bank's stock (existing.ts srBankPrep: no pack slot), and the pack takes the fight food FIRST: 1 prayer potion,
        // sharks to B_NEZ_SHARKS, the 2nd potion, then the spare bars (no reserve slot: the bowl frees 3+ slots before anything
        // else needs one). Room: Sea Slug leftovers dropped, the staff orb / E's air runes banked (C's bank meeting fetches both).
        if (process.env.LG_B_BANK_KIT === '1') {
            const potsIn = () => bot.inv().filter(x => PRAYER_POTS.includes(x.obj)).length;
            const potW = Math.max(0, B_POTS - potsIn()), sharkW = Math.max(0, B_NEZ_SHARKS - bot.count('shark'));
            const spareW = Math.max(0, B_SPARE_BARS - Math.max(0, bot.count('gold_bar') - 2));
            const deposit: string[] = [];
            const room = () => bot.free() + deposit.filter(d => bot.count(d) > 0).length - slots();
            for (const n of B_ROOM_JUNK) if (room() < potW + sharkW && bot.count(n) > 0) { bot.dropItem(objId(n), bot.slot(n)); bot.queueFlush(); await bot.tick(1); }
            for (const d of ['stafforb', 'airrune']) if (room() < potW + sharkW && bot.count(d) > 0) deposit.push(d);
            let left = Math.max(0, room());
            const pot1 = Math.min(potW, 1, left); left -= pot1;
            const sharks = Math.min(sharkW, left); left -= sharks;
            const pot2 = Math.min(potW - pot1, left); left -= pot2;
            const spare = Math.min(spareW, left);
            const want = [...miss(), ...(pot1 + pot2 > 0 ? [{ name: '4doseprayerrestore', n: pot1 + pot2 }] : []), ...(sharks > 0 ? [{ name: 'shark', n: sharks }] : [])];
            if (spare > 0) { const g = want.find(i => i.name === 'gold_bar'); if (g) g.n += spare; else want.push({ name: 'gold_bar', n: spare }); }
            const hp0 = bot.stat('hitpoints').cur, pr0 = bot.stat('prayer').cur, hpMax0 = bot.stat('hitpoints').level;
            // the bank visit (existing.ts BankHelper) eats/drinks from the bank first: hp to >= level-10, prayer to >= 45 for the
            // blessing (Gujuo needs 42; a higher prayer fails his roll more often, gujuo.rs2 stat_random(prayer, 80, 250))
            log(`421 B kit plan: room ${room()} after the quest kit (${slots()} slots${deposit.length ? `, banking ${deposit.join(',')}` : ''}): pots +${pot1 + pot2}, sharks +${sharks}, spare bars +${spare}; eat/drink at the bank (hp ${hp0}/${hpMax0} prayer ${pr0})`);
            if (!want.length) return;   // (a resume holding the whole kit: no trip; the 417 check before the dungeon decides)
            (bot as any).srBankPrep = { food: 'shark', heal: 20, hpTo: hpMax0 - 10, prayTo: 45, deposit, label: 'legends B belt' };
            const ok = await ctx.helper!.meet(MEET.B, want, 'legends B belt');
            delete (bot as any).srBankPrep;
            await bot.tick(1);
            log(`B kit: ${ok ? 'OK' : 'FAILED'}; sharks ${bot.count('shark')}/${B_NEZ_SHARKS} pots ${potsIn()}/${B_POTS} hp ${bot.stat('hitpoints').cur}/${hpMax0} (was ${hp0}) prayer ${bot.stat('prayer').cur} (was ${pr0}) gold bars ${bot.count('gold_bar')} pack ${bot.inv().length}/28`);
            if (miss().length) fail(`helper mode: quest kit incomplete at the belt meeting: ${miss().map(i => i.name).join(',')}`);
            return;
        }
        // + sharks up to B_SHARKS in the slots left (lgr2: A's Gujuo fights ate all 4 carried sharks; B then ran on 0 to hp 30)
        // session 11 (sim qv10m DIED to Nezikchened: the bowl blessing drank the only prayer potion, the summon drains prayer to
        // ~0, Protect from Melee was off for the whole fight): a 2nd prayer potion at this meeting, before the sharks.
        // LG_B_PRAYER=0 reverts.
        const potsHeld = () => bot.inv().filter(x => PRAYER_POTS.includes(x.obj)).length;
        // session 11 fix 339 (qx121 forks qzm43 DIED to Nezikchened at prayer 0, qzm49 'prayer below 42 and no prayer potion for
        // the bowl blessing'): a fork/resume is 'retrying' (route.ts:585) and keeps the Sea Slug leftovers + staff, B began 16/28,
        // the belt had free 15 for 15 -> pots 0; the junk drop below made room for the spare bars only, the one pot (4 doses)
        // went on the blessing. Room for the missing pots now comes from the leftovers too (pots before spares). LG_B_POT_ROOM=0 reverts.
        const potRoomOn = process.env.LG_B_POT_ROOM !== '0';
        const potsFit = () => process.env.LG_B_PRAYER === '0' ? 0 : Math.max(0, Math.min(B_POTS - potsHeld(), bot.free() - slots() - 1));
        const pots0 = potsFit(), potWant = process.env.LG_B_PRAYER === '0' ? 0 : Math.max(0, B_POTS - potsHeld());
        // W2: spare gold bars (B_SPARE_BARS) after the pots: room first from the carried leftovers; they may use the 1 spare slot
        // (the bowl frees >= 3: 2 bars + the hammer, and the leftover spares are dropped there)
        const spareWant = Math.max(0, B_SPARE_BARS - Math.max(0, bot.count('gold_bar') - 2));
        const roomTo = potRoomOn ? slots() + potWant + (potWant > 0 ? Math.max(1, spareWant) : spareWant) : slots() + pots0 + spareWant;
        if ((spareWant > 0 || (potRoomOn && potWant > 0)) && bot.free() < roomTo) {
            for (const n of B_ROOM_JUNK) if (bot.free() < roomTo && bot.count(n) > 0) { bot.dropItem(objId(n), bot.slot(n)); bot.queueFlush(); await bot.tick(1); }
        }
        const pots = potRoomOn ? potsFit() : pots0;
        // session 11 fix 289 (LG_B_SPARE_ROOM): qx33m 'B: out of gold bars' with 263b on: 'spare gold bars: +1' only (main
        // arrived with 4 sharks, pack 11/28: kit 15 + 1 pot + 1 spare = 28/28; qx36/qx38 the same +1), the one mistake ate
        // 2 bars (135/256) -> 1 left. CONFIRMED from the log. 3 bars fail ~5%, 4 ~0.7%. Fix: when the spares do not fit, give
        // up sharks above 3 for them (eaten if hurt >= 20, else dropped; qx34m/qx37m ran B on 3 and 1 sharks). LG_B_SPARE_ROOM=0 reverts.
        if (process.env.LG_B_SPARE_ROOM !== '0') {
            for (let k = 0; k < 4 && spareWant > 0 && bot.free() < slots() + pots + spareWant && bot.count('shark') > 3; k++) {
                const sl = bot.slot('shark'), hurt = bot.stat('hitpoints').cur < bot.stat('hitpoints').level - 20;
                if (hurt) bot.opHeld1(objId('shark'), sl); else bot.dropItem(objId('shark'), sl);
                bot.queueFlush(); await bot.tick(2);
                log(`289 spare-bar room: ${hurt ? 'ate' : 'dropped'} a shark (sharks ${bot.count('shark')}, free ${bot.free()})`);
            }
        }
        const spare = Math.max(0, Math.min(spareWant, bot.free() - slots() - pots));
        const sharks = Math.max(0, Math.min(B_SHARKS - bot.count('shark'), bot.free() - slots() - 1 - pots - spare));   // 1 slot spare (lge1 filled 28/28)
        const want = [...miss(), ...(pots > 0 ? [{ name: '4doseprayerrestore', n: pots }] : []), ...(sharks > 0 ? [{ name: 'shark', n: sharks }] : [])];
        if (spare > 0) { const g = want.find(i => i.name === 'gold_bar'); if (g) g.n += spare; else want.push({ name: 'gold_bar', n: spare }); log(`spare gold bars: +${spare}`); }
        if (!want.length) return;
        const ok = await ctx.helper!.meet(MEET.B, want, 'legends B belt');
        await bot.tick(1);
        log(`helper kit at the belt meeting: ${ok ? 'OK' : 'FAILED'}; pack ${bot.inv().length}/28`);
        if (miss().length) fail(`helper mode: quest kit incomplete at the belt meeting: ${miss().map(i => i.name).join(',')}`);
    };
    /** dropJunk until the logs are really gone: a drop sent during a chop's teleport delay is ignored (lgf1: 3 jungle logs
     *  stayed, the pack was 28/28 and the reed could not be cut) */
    const dropJunkSure = async () => {
        const logs = objId('logs');
        for (let k = 0; k < 6 && bot.count(logs) > 0; k++) { dropJunk(); await bot.until(() => bot.count(logs) === 0, 3); }
    };
    // fix 276a: tick of our last attack/eat (each pushes %action_delay forward, which the bullroarer needs 8 t clear of)
    let lastAct = -100;
    const eatIfLow = (lim: number) => { if (bot.stat('hitpoints').cur < lim && held('shark')) { bot.opHeld1(objId('shark'), bot.slot('shark')); bot.queueFlush(); lastAct = bot.tickCount; } };
    // ---- fix 417 helpers (food/prayer floor; see B_SAFE) ----
    const potsHeld = () => bot.inv().filter(x => PRAYER_POTS.includes(x.obj)).length;
    const hpNow = () => bot.stat('hitpoints').cur, hpMax = () => bot.stat('hitpoints').level;
    /** sharks to hold now: the fight reserve + the ones that heal the bot to near full (a shark heals 20) */
    const sharkNeed = () => B_NEZ_SHARKS + Math.ceil(Math.max(0, hpMax() - 18 - hpNow()) / 20);
    /** out of a fight: eat to near full, keeping `keep` sharks */
    const eatUp = async (keep: number, label: string) => {
        const h0 = hpNow(), s0 = bot.count('shark');
        for (let k = 0; k < 10 && hpNow() < hpMax() - 18 && bot.count('shark') > keep; k++) {
            const n0 = bot.count('shark');
            bot.opHeld1(objId('shark'), bot.slot('shark')); bot.queueFlush(); lastAct = bot.tickCount;
            await bot.until(() => bot.count('shark') < n0, 3); await bot.tick(1);
        }
        if (bot.count('shark') < s0) log(`417 ${label}: ate ${s0 - bot.count('shark')} (hp ${h0} -> ${hpNow()}, sharks ${bot.count('shark')})`);
    };
    /** Nezikchened gate: safe to start the fight (hp, food, prayer for Protect from Melee) */
    const nezSafe = () => hpNow() >= Math.max(60, Math.floor(hpMax() * 0.7)) && bot.count('shark') >= 2 && (potsHeld() > 0 || bot.stat('prayer').cur >= 40);
    const stateStr = () => `hp ${hpNow()}/${hpMax()} sharks ${bot.count('shark')} pots ${potsHeld()} prayer ${bot.stat('prayer').cur} free ${bot.free()}`;
    /** helper top-up from INSIDE the jungle (south of the x=COL belt): chop out, meet at MEET.B (--existing: a bank trip), eat
     *  up, chop back in. The chop empties a filled bowl (jungle_tree.rs2:34-49): the caller refills it. */
    const restock = async (label: string) => {
        if (!ctx.helper) fail(`417 ${label}: unsafe (${stateStr()}) and no helper/bank to restock - not starting the fight`);
        await dropJunkSure();
        const potWant = potsHeld() === 0 ? 1 : 0;
        const n = Math.max(1, Math.min(sharkNeed() - bot.count('shark'), bot.free() - 3 - potWant));   // slots kept for the reed, a jungle log, the bank trip's spare glory (existing.ts 417)
        const want = [{ name: 'shark', n }, ...(potWant ? [{ name: '4doseprayerrestore', n: 1 }] : [])];
        log(`417 ${label}: restock ${want.map(i => `${i.name}x${i.n}`).join(',')} (${stateStr()})`);
        await walk(COL, IN_Z); await chopLine(`jungle out (${label})`, COL, OUT_Z); await dropJunkSure();
        await walk(MEET.B.x, MEET.B.z, 1, 60);
        const ok = await ctx.helper!.meet(MEET.B, want, `legends B food (${label})`);
        await bot.tick(1);
        await eatUp(B_NEZ_SHARKS, label);
        log(`417 ${label}: helper ${ok ? 'OK' : 'FAILED'}; ${stateStr()}`);
        await walk(COL, OUT_Z, 0, 500); await chopLine(`jungle in (${label})`, COL, IN_Z); await dropJunkSure();
        mark(`food ${label}`);
    };
    /** per-fight record (proof logs): min hp and sharks left */
    const fightLog = (what: string, t: number, hp0: number, minHp: number, sh0: number) =>
        log(`417 FIGHT ${what}: ${bot.tickCount - t} t, hp ${hp0} -> min ${minHp} -> ${hpNow()}, sharks ${sh0} -> ${bot.count('shark')}, pots ${potsHeld()}`);

    /** Kill the jungle animals (oomlie bird 48, jungle wolf 143, jungle savage 931) next to us. */
    // An animal the bullroarer angered (npc_retaliate) walks up and hits us (all three are melee). Attacker = an animal ADJACENT
    // to us facing a player (faceEntity >= 32768; the face flag is sticky, so distant ones do not count), or - when we took
    // damage in the last 6 t - the nearest animal within 3. Re-attack every 4 t, eat below 50 hp, Protect from Melee while
    // under attack if prayer allows (before the blessing it stays above 45: Gujuo needs >= 42). Ends 8 t after the last hit
    // with no adjacent attacker left.
    const ANIMALS = [48, 143, 931];
    // session 11 fix 353 (qx162m seed 9562 legends 'route: DIED' after a 393,449 t quest): a Jungle Savage stood DIAGONAL to us
    // (npc 931@2797,2925, us 2798,2924, engine optrace 'steps 0 wp true' for ~345,000 t) facing us: no hit either way (hp 99, xp
    // flat). attackers() counts d <= 1 (Chebyshev) + the sticky face, so killAggressors never reached its !a break: 200 t per call
    // (j cap) x30 per swing (summonGujuo's pacing loop) x30 swings x16 bless tries, no total cap. Bless try 7 landed at +391,841 t
    // with the sharks and both prayer pots spent -> Nezikchened at hp 39 / prayer 0 -> dead. 353a: an attacker listed but no
    // damage taken and no xp gained for STALE_T t = a stalemate: that npc is ignored (until we take damage) and the fight ends.
    // 353b: one summonGujuo call gives up after SUMMON_MAX t (fail -> module retry) instead of running unbounded.
    // LG_B_STALE=0 reverts both. TEST: LG_B_STALE_TEST=1 treats the first fight as a stalemate (its progress is ignored).
    const STALE = process.env.LG_B_STALE !== '0', STALE_T = 20, SUMMON_MAX = Number(process.env.LG_B_SUMMON_MAX ?? 2000);
    const staleNpc = new Set<number>();
    let staleTest = process.env.LG_B_STALE_TEST === '1';
    const xpSum = () => bot.xpAll().reduce((s, v) => s + v, 0);
    const attackers = () => npcsOf(bot, ANIMALS).filter(q => q.d <= 1 && !(STALE && staleNpc.has(q.idx)) && ((bot.npcs[q.idx] as any)?.faceEntity ?? -1) >= 32768);
    const killAggressors = async (label = 'animals') => {
        let last = -100, lastDmg = bot.damageTaken, lastHit = bot.tickCount, hits = 0;
        let xpSeen = xpSum(), lastProg = bot.tickCount;   // fix 353a
        const t = bot.tickCount, hp0 = hpNow(), sh0 = bot.count('shark');
        let minHp = hp0;
        const prayFloor = () => (bot.count('goldbowlbless_empty') + bot.count('goldbowlbless_pure') > 0 || held('book_of_binding') ? 1 : 45);
        for (let j = 0; j < 200 && !inDialog(bot); j++) {
            if (bot.damageTaken > lastDmg) { lastHit = bot.tickCount; staleNpc.clear(); }   // fix 353a: a real hit un-ignores
            lastDmg = bot.damageTaken;
            const recent = bot.tickCount - lastHit < 6;
            const a = attackers()[0] ?? (recent ? npcsOf(bot, ANIMALS).filter(q => q.d <= 3)[0] : undefined);
            if (!a && bot.tickCount - lastHit >= 8) break;
            // fix 353a: stalemate (an attacker listed, nothing landing either way for STALE_T t): ignore that npc, end the fight
            const xpNow = xpSum();
            if (xpNow > xpSeen || bot.tickCount === lastHit) { if (!staleTest) lastProg = bot.tickCount; xpSeen = xpNow; }
            if (STALE && a && bot.tickCount - lastProg >= STALE_T) {
                staleNpc.add(a.idx); staleTest = false;
                log(`${label}: fix 353 stalemate with npc ${a.idx} (type ${a.type}) at ${a.x},${a.z} d${a.d}: no hit either way for ${STALE_T} t - ignored`);
                break;
            }
            if (a && bot.tickCount - last >= 4) { bot.opNpc(a.idx, 2); bot.queueFlush(); last = bot.tickCount; lastAct = last; hits++; }
            const pr = bot.stat('prayer').cur, on = bot.isPrayerActive('protectfrommelee');
            if (!on && recent && pr > prayFloor() + 5) { bot.activatePrayer('protectfrommelee'); bot.queueFlush(); }
            else if (on && pr <= prayFloor()) { bot.deactivatePrayer('protectfrommelee'); bot.queueFlush(); }
            eatIfLow(50);
            await bot.tick(1);
            minHp = Math.min(minHp, hpNow());
        }
        if (bot.isPrayerActive('protectfrommelee')) { bot.deactivatePrayer('protectfrommelee'); bot.queueFlush(); }
        if (hits) log(`${label}: fought off the jungle animals in ${bot.tickCount - t} t (sharks ${bot.count('shark')})`);
        if (hits && B_SAFE) fightLog(`animals (${label})`, t, hp0, minHp, sh0);
    };

    // session 11 (audit: a retried B restarted at the cave rocks, and Ungadulu's/Gujuo's lines differ past their stages): on a
    // retry, the stage the quest JOURNAL shows (legends_journal.rs2, first match = latest): 12 = Nezikchened (fire) slain -> B is
    // done; >= 8 (Gujuo asked for the water) -> steps 1-4 are skipped; then the bowl items gate steps 5-7. LG_JOURNAL=0 = as before.
    let jst = 5;
    if (isResuming(bot) && process.env.LG_JOURNAL !== '0') {
        if (bot.chatModalId !== -1) { bot.closeModal(); bot.queueFlush(); await bot.tick(1); }
        jst = await journalStage<number>(bot, 'legends', [
            [/I then slew the demon/i, 12], [/a demon called Nezikchened appeared/i, 11], [/acted strange and mentioned sacred water/i, 8],
            [/acting weird and talking a lot of nonsense/i, 7], [/trapped in a flaming octagon|Yommi tree seeds/i, 6],
        ], 5, log);
        if (jst >= 12) {
            log('resume: the journal shows Nezikchened (fire) slain: segment B done');
            const p0 = bot.pos();
            return { ok: true, ticks: bot.tickCount - t0, marks, resumed: 12, exit: { x: p0.x, z: p0.z, level: p0.level }, inv: bot.inv().map(s => `${locScene.objName(s.obj) || s.obj}x${s.count}`).join(',') };
        }
        if (jst > 5) log(`resume: journal stage ${jst}`);
    }
    const bowlHeld = () => held('goldbowl_empty') || held('goldbowlbless_empty') || held('goldbowlbless_pure');
    // ---- 0. drop A's junk (logs, papyrus, charcoal, tutorial runes, coins...), wield the scimitar (verified), quest-kit hand-off
    if (dropJunk()) await bot.until(() => !bot.inv().some(s => JUNK.map(objId).includes(s.obj)), 6);
    const SCIM = objId('rune_scimitar');
    for (let k = 0; k < 5 && !bot.isWorn(SCIM); k++) {
        if (bot.slot(SCIM) < 0) fail('rune scimitar neither worn nor held (fight-kit hand-off missing?)');
        bot.opHeld2(SCIM, bot.slot(SCIM)); bot.queueFlush(); await bot.until(() => bot.isWorn(SCIM), 3);
    }
    if (!bot.isWorn(SCIM)) fail('could not wield the rune scimitar');
    log(`scimitar worn; pack ${bot.inv().length}/28`);
    // session 11 fix 354 (qx162m: the retry after B's death 'walk to 2816,2936: no route (island) at (2653,2957)' -> ROUTE STOPPED;
    // = qyw01/qx81): a death keeps 3 items (pickaxe/scimitar/axe), the machete, bullroarer, map and the helper's quest kit are
    // gone. Off Karamja resumeHere is false (route-legs), the retry travels to the Legends' Guild, and B - which assumes it stands at
    // A's jungle exit - walks to 2816,2936 inside the belt: an island to the walker (core travel island guard, fix 189), 250 t lost.
    // It could not go on anyway: no machete = no jungle chop (jungle_tree.rs2), no bullroarer = no Gujuo, and the helper bank had
    // no 2nd kit ('bank edgeville lacks gold_bar x3, hammer x1 ...'). Fail at once with the real cause. LG_B_LOST=0 reverts.
    const lostTest = process.env.LG_B_LOST_TEST === '1';
    if (process.env.LG_B_LOST !== '0' && !bowlHeld() && (lostTest || !held('machette') || !held('bullroarer')))
        fail(`cannot go on: machete/bullroarer lost (a death?): machette=${held('machette') && !lostTest} bullroarer=${held('bullroarer')} - the jungle needs the machete, Gujuo the bullroarer, and a 2nd quest kit`);
    const missing = SEG_B_RESUPPLY.filter(i => bot.count(i.name) < i.n).map(i => ({ name: i.name, n: i.n - bot.count(i.name) }));
    // helper mode: the quest kit is first needed at the anvil (step 5, mainland): the helper brings it there (sent ahead now)
    // (a resume with a golden bowl held is past the anvil: the kit was delivered, its gold bars/hammer are spent)
    if (bowlHeld() && jst >= 8) log(`resume past the anvil: no kit (${missing.map(i => i.name).join(',') || '-'} missing)`);
    else if (missing.length && ctx.helper) { ctx.helper.send(MEET.B, missing, 'legends B belt'); log(`helper mode: quest kit at the anvil (${missing.length} kinds)`); }
    else if (missing.length) {
        const slots = missing.reduce((n, i) => n + (/rune$/.test(i.name) ? 1 : i.n), 0);   // gold bars do not stack
        if (bot.inv().length + slots > 28) fail(`no room for the quest kit: pack ${bot.inv().length} + ${slots} slots`);
        if (!ctx.resupply) fail('quest kit missing and no resupply hand-off');
        await ctx.resupply!(missing);
        await bot.tick(1);
        const still = SEG_B_RESUPPLY.filter(i => bot.count(i.name) < i.n).map(i => i.name);
        if (still.length) fail(`quest kit incomplete after hand-off: ${still.join(',')}`);
    }
    log(`kit ready; pack ${bot.inv().length}/28 sharks=${bot.count('shark')} hp=${bot.stat('hitpoints').cur}`);
    // fix 421 TEST (sim only, registered by existing-lib under LG_B_THIN_TEST): the live acct25 start (3 sharks, no potion, low hp)
    if (process.env.LG_B_THIN_TEST && !bowlHeld()) await (globalThis as any).__lgBThinTest?.(bot, log);

    // ---- 1. the cave rocks -> crawl in
    const enterCave = async (label: string) => {
        const rock = loc('caveRock');
        // fix 415: a B that starts OUTSIDE the jungle (a resumed run travels to the Legends' Guild first) has no
        // walk route to the cave or the belt ('no route (island)'): travel to the belt meeting with the route planner (glory, as
        // the helper does), then chop IN through the x=2816 belt, and go on as if standing at A's exit. LG_B_OUTSIDE=0 reverts.
        if (!insideJungle() && process.env.LG_B_OUTSIDE !== '0') { await reachBeltFromOutside(); await walk(COL0, OUT_Z0, 0, 500); await chopLine('jungle in (415)', COL0, IN_Z0); await dropJunkSure(); }
        if (cheb(me(), { x: 2781, z: 2933 }) > 6) await walk(2781, 2933, 1);   // from A's exit (or the pool) to the cave rocks
        if (attackers().length) await killAggressors(label);
        for (let k = 0; k < 4 && !IN_CAVE()(bot); k++) {
            await act(`${label}: search rocks`, () => opLocGo(bot, rock, 1), () => inDialog(bot) || IN_CAVE()(bot), 60, 6, true);
            await dlg(`${label}: crawl`, () => IN_CAVE()(bot), [/^Yes, I'll crawl through/], 30);
            if (!IN_CAVE()(bot)) { dismiss(bot); await bot.tick(1); }
        }
        if (!IN_CAVE()(bot)) fail(`${label}: not in the cavern`);
    };
    if (jst < 6 || (jst === 6 && !IN_CAVE()(bot))) {
    await enterCave('cave1');
    mark('cave1');
    }

    // ---- 2. Ungadulu through the flames: Investigate a fire wall
    if (jst < 7) {
        const fw = loc('fireWall');
        await walk(2787, 9326);
        let asked = false;
        for (let k = 0; k < 3 && !asked; k++) {
            await act('investigate flames', () => opLocGo(bot, fw, 2), () => inDialog(bot), 30, 6, true);
            // mesbox | say | mesbox x2 | chatnpc (stage 7) | multi2 -> "Who are you?" | chatplayer | chatnpc x3 | multi2 -> close
            asked = await dlg('ungadulu', () => { const o = bot.dialogOptions().map(x => x.text); return o.some(t => /^Where do I get pure water from\?$/.test(t)) && !o.some(t => /^Who are you\?$/.test(t)); }, [/^Who are you\?$/], 60);
        }
        if (!asked) fail('ungadulu dialog');
        dismiss(bot); bot.queueFlush(); await bot.tick(1);
        mark('ungadulu');
    }

    // ---- 3. out of the cave
    const leaveCave = async () => {
        const ex = loc('caveExit');
        await act('cave exit', () => opLocGo(bot, ex, 1), () => !IN_CAVE()(bot), 40, 6);
        await bot.until(() => !IN_CAVE()(bot), 6);
    };
    if (jst < 8 || IN_CAVE()(bot)) {
    await leaveCave();
    mark('outside1');
    }

    // ---- 4. Gujuo: summon with the bullroarer, ask for pure water
    /** Swing the bullroarer until Gujuo walks up and opens his dialog. */
    // session 11 fix 276 (qx31 'gujuo bless: no Gujuo' after 20 swings): Gujuo has no spawn condition beyond the roll -
    // bullroarer.rs2 bullroarer_use: inside kharazi_jungle EVERY oomlie bird/jungle savage/jungle wolf within 10 tiles rolls
    // 1/6 to take a dislike (fight, no Gujuo); only then 5/6 Gujuo, else 'nothing much'. At (2800,2926) ~8 animals were in
    // range (12 of 13 real swings angered one), and 7 of the 20 tries were 'too busy' (%action_delay + 8 > map_clock: our
    // last melee hit / auto-retaliate set it, player_melee.rs2:57-59) right after the fight. 276a: before a swing wait until
    // 13 t after our last attack/eat/hit taken; a 'too busy' swing does not count. 276b: 30 real swings (was 20, ~2.4% ->
    // ~0.4% to fail at ~17%/swing). LG_GUJUO_PACE=0 reverts both. LG_GUJUO_TEST_DISLIKE=N (test only): the first N swings
    // are counted as angered (fight + pacing path) without swinging.
    const PACE = process.env.LG_GUJUO_PACE !== '0';
    let testDislike = Number(process.env.LG_GUJUO_TEST_DISLIKE ?? 0) || 0;
    const summonGujuo = async (label: string) => {
        let busy = 0, dmgSeen = bot.damageTaken, lastDmgT = -100;
        const sEnd = bot.tickCount + SUMMON_MAX;   // fix 353b
        for (let k = 0; k < (PACE ? 30 : 20); k++) {
            if (inDialog(bot)) return;
            if (STALE && bot.tickCount > sEnd) fail(`${label}: no Gujuo in ${SUMMON_MAX} t (fix 353b cap, ${k} swings)`);
            if (PACE) {
                for (let w = 0; w < 30 && !inDialog(bot); w++) {
                    if (bot.damageTaken > dmgSeen) { dmgSeen = bot.damageTaken; lastDmgT = bot.tickCount; }
                    if (attackers().length) await killAggressors(label);
                    if (bot.tickCount - Math.max(lastAct, lastDmgT) >= 13) break;
                    await bot.tick(1);
                }
                if (inDialog(bot)) return;
                if (testDislike > 0) {
                    testDislike--; log(`${label}: TEST swing ${k + 1} counted as angered`);
                    lastAct = bot.tickCount; await bot.tick(1); continue;
                }
            }
            if (attackers().length) await killAggressors(label);   // never swing (or stand) while something is hitting us
            if (inDialog(bot)) return;
            // Gujuo already standing somewhere (spawned where he "cannot get to you", or still around from before): talk to him
            const g = npc(bot, GUJUO);
            if (g) {
                await act(`${label}: talk to Gujuo`, () => { const q = npc(bot, GUJUO); if (q) opNpcGo(bot, q, 1); }, () => inDialog(bot) || !npc(bot, GUJUO), 40, 6, true);
                if (inDialog(bot)) return;
            }
            const s = bot.tickCount, d0 = bot.damageTaken;
            bot.opHeld1(objId('bullroarer'), bot.slot('bullroarer')); bot.queueFlush();
            const ok = await bot.until(() => inDialog(bot) || bot.damageTaken > d0 || attackers().length > 0
                || msgs(s).some(m => /nothing much seems to happen|cannot get to you|takes a dislike|too busy/.test(m)), 25);
            if (inDialog(bot)) return;
            const why = msgs(s).filter(m => /nothing much|cannot get|dislike|too busy/.test(m)).join(' | ');
            log(`${label}: bullroarer try ${k + 1} no Gujuo (${ok ? why || 'under attack' : 'timeout'})`);
            if (PACE && /too busy/.test(why) && !/dislike|nothing much|cannot get/.test(why) && busy++ < 20) { lastAct = bot.tickCount; k--; continue; }
            if (/dislike/.test(why) || bot.damageTaken > d0 || attackers().length || !ok) await killAggressors(label);   // fight back first
            await bot.tick(Math.max(0, 9 - (bot.tickCount - s)));   // %action_delay: 8 t between swings
        }
        fail(`${label}: no Gujuo`);
    };
    if (jst < 8) {
        await walk(GUJUO_SPOT.x, GUJUO_SPOT.z, 1);
        let ok = false;
        for (let k = 0; k < 3 && !ok; k++) {
            await summonGujuo('gujuo1');
            const s = bot.tickCount;
            ok = await dlg('gujuo water', () => msgs(s).some(m => /Gujuo disappears/.test(m)) && bot.chatModalId === -1,
                [/^I need some pure water to douse some magic flames\.$/, /^Ok, thanks\.\.\. Goodbye\.$/, /^Ok thanks for your help\.$/], 80);
            // TEST (session 11 proof): SR_FAIL_AT=B:gujuo-cut treats the first finished water talk as cut (as a drop after stage 8)
            if (ok && process.env.SR_FAIL_AT === 'B:gujuo-cut' && !(globalThis as any).__lgGujuoCut) { (globalThis as any).__lgGujuoCut = 1; ok = false; log('TEST: gujuo water talk treated as cut'); }
            if (!ok) { dismiss(bot); bot.queueFlush(); await killAggressors('gujuo1'); }
            // session 11 (audit): a drop/interruption after Gujuo set stage 8 but before 'Gujuo disappears' -> his next talk is a
            // different dialog; the journal line 'Ungadulu acted strange and mentioned sacred water' (stage >= 8) settles it.
            // LG_GUJUO_JOURNAL=0 reverts.
            if (!ok && process.env.LG_GUJUO_JOURNAL !== '0') {
                if (bot.chatModalId !== -1) { bot.closeModal(); bot.queueFlush(); await bot.tick(1); }
                const j = await readJournal(bot, 'legends');
                if (j.ok && /acted strange and mentioned sacred water/i.test(j.text)) { ok = true; log('gujuo water: the journal shows stage 8 (asked) already'); }
            }
        }
        if (!ok) fail('gujuo water dialog');
        mark('stage8');
    }

    // ---- 5. out of the jungle (chop north), anvil, golden bowl
    /** Chop/walk along x=col from the current z to `toZ` (north: toZ > z). Jungle locs on the way are chopped (2-tile hop). */
    // helper mode: out/in through the x=2816 belt (as C does) instead of x=2795: the helper waits at MEET.B (2816,2947), the
    // one helper-safe tile on this edge (scorpions roam the x=2795 exit, snakes + jungle spiders the anvil: they killed the
    // level-3 helper there in lge2/lgd1); +~15 tiles each way to the anvil, 0 detour for the meeting
    const COL = ctx.helper ? 2816 : 2795, IN_Z = ctx.helper ? 2936 : 2938, OUT_Z = ctx.helper ? 2940 : 2943;
    if (!bowlHeld()) {
        // fix 415: B can start OUTSIDE the jungle (a --resume after a stop at the belt meeting:
        // the route travels to the Legends' Guild first). 'walk to 2816,2936' then has no route (island): the walker marched to
        // the Feldip shore (2653,2957) twice, 250 t each, ROUTE STOPPED. When the main is not inside the jungle, skip the
        // walk-in + chop-out and travel to the belt meeting with the route's planner (ships/teleports), as the helper does.
        // LG_B_OUTSIDE=0 reverts.
        if (insideJungle() || process.env.LG_B_OUTSIDE === '0') { await walk(COL, IN_Z); await chopLine('jungle out', COL, OUT_Z); await dropJunkSure(); }
        else { await reachBeltFromOutside(); await dropJunkSure(); }   // fix 415: already outside (resume at journal stage >= 8): straight to the meeting
        mark('jungle out');
        const anvil = loc('anvil');
        if (ctx.helper) { await walk(MEET.B.x, MEET.B.z, 1, 60); await helperKit(); }
        await walk(2790, 3100, 1, 500);
        let s = bot.tickCount;
        // W2: up to 4 tries (4 bars: a failure eats 1 or 2); each try watches its own messages (with one shared watermark a 2nd
        // try saw the 1st try's "mistake" and moved on before its own forge resolved). LG_B_SPARE_BARS=0 = 3 tries, one watermark.
        const tries = B_SPARE_BARS > 0 ? 4 : 3;
        // fix 289 TEST: LG_B_BARS_TEST=<n> drops n gold bars at the anvil (= a 2-bar forge mistake) to prove the spare bars carry
        for (let k = 0; k < Number(process.env.LG_B_BARS_TEST ?? 0) && held('gold_bar'); k++) { bot.dropItem(objId('gold_bar'), bot.slot('gold_bar')); bot.queueFlush(); await bot.tick(1); }
        if (process.env.LG_B_BARS_TEST) log(`289 TEST: dropped bars, ${bot.count('gold_bar')} left`);
        for (let k = 0; k < tries && !held('goldbowl_empty'); k++) {
            const bars0 = bot.count('gold_bar');
            if (B_SPARE_BARS > 0) s = bot.tickCount;
            await act('gold bar on anvil', () => useOnLocGo(bot, 'gold_bar', anvil), () => inDialog(bot) || held('goldbowl_empty'), 30, 6, true);
            await dlg('make bowl', () => held('goldbowl_empty') || (bot.chatModalId === -1 && msgs(s).some(m => /make a mistake/.test(m))), [/^Yes$/], 20);
            if (B_SPARE_BARS > 0) await bot.until(() => held('goldbowl_empty') || bot.count('gold_bar') < bars0, 4);
            if (!held('goldbowl_empty')) log(`bowl try ${k + 1}: mistake, gold bars ${bars0} -> ${bot.count('gold_bar')}`);
            if (!held('goldbowl_empty') && bot.count('gold_bar') < 2) fail('out of gold bars');
        }
        if (!held('goldbowl_empty')) fail('no golden bowl');
        if (ctx.helper && held('hammer')) { bot.dropItem(objId('hammer'), bot.slot('hammer')); bot.queueFlush(); }   // helper mode: the pack is 28/28 after the kit; nothing later uses the hammer
        // W2: unused spare bars are dead weight from here (no later step uses gold): drop them for the reed/book/C kit slots
        if (ctx.helper && B_SPARE_BARS > 0) for (let k = 0; k < 4 && held('gold_bar'); k++) { await bot.tick(1); bot.dropItem(objId('gold_bar'), bot.slot('gold_bar')); bot.queueFlush(); }
        mark('bowl');
    }

    // ---- 6. back into the jungle, Gujuo blesses the bowl
    if (!held('goldbowlbless_empty') && !held('goldbowlbless_pure')) {
        if (me().z > IN_Z) {   // (a resume can stand inside the jungle already)
        await walk(COL, OUT_Z, 0, 500);
        await chopLine('jungle in', COL, IN_Z); await dropJunkSure();
        mark('jungle in');
        }
        await walk(GUJUO_SPOT.x, GUJUO_SPOT.z, 1);
        for (let k = 0; k < 16 && !held('goldbowlbless_empty'); k++) {   // high prayer FAILS the roll ~98%: many tries
            if (bot.stat('prayer').cur < 42) {
                const pp = bot.inv().find(x => PRAYER_POTS.includes(x.obj));
                if (!pp) fail('prayer below 42 and no prayer potion for the bowl blessing');
                bot.opHeld1(pp!.obj, pp!.slot); bot.queueFlush(); await bot.tick(2);
            }
            await summonGujuo('gujuo bless');
            // "Ah I see you have the golden bowl!" -> Yes | meditation (10 t) | fail: "try again?" -> Yes | success -> gujuo_start
            // -> "How goes your quest" multi5 -> "Ok thanks for your help." -> he leaves
            const s = bot.tickCount;
            await dlg('bless', () => (held('goldbowlbless_empty') && bot.chatModalId === -1) || (bot.chatModalId === -1 && msgs(s).some(m => /Prayer level of at least 42/.test(m))),
                [/^Yes, I'd like (you )?to bless my gold bowl\.$/, /^Ok thanks for your help\.$/, /^Ok, thanks\.\.\. Goodbye\.$/], 300);
            log(`bless try ${k + 1}: blessed=${held('goldbowlbless_empty')}`);
        }
        if (!held('goldbowlbless_empty')) fail('bowl not blessed');
        mark('blessed');
    }

    // 318a (qx81m DIED in the dungeon: B began hp 63 / 3 sharks / prayer 0, an 84 t Jungle Savage fight at the Gujuo call
    // ate all 3, the belt meeting was full (spare bars) so the helper fitted only 2, the bless fight ate those; the
    // dungeon from hp 43 on 0 food -> dead, the kit lost, the retry STOPPED): low on food here (before the pure water: a
    // jungle chop with water in the bowl evaporates it, jungle_tree.rs2:34-36) -> out through the belt, the helper tops
    // sharks up at MEET.B, back in. LG_B_FOOD=0 reverts; LG_B_FOOD_TEST=1 forces it.
    // fix 417 (B_SAFE): the floor is B_NEZ_SHARKS + the healing sharks + a prayer potion, and the top-up eats up at the meeting.
    if (B_SAFE && process.env.LG_B_SAFE_TEST === 'food' && held('goldbowlbless_empty')) {
        for (let k = 0; k < 12 && held('shark'); k++) { bot.dropItem(objId('shark'), bot.slot('shark')); bot.queueFlush(); await bot.tick(1); }
        log(`417 TEST food: all sharks dropped (${stateStr()})`);
    }
    if (B_SAFE && process.env.LG_B_FOOD !== '0' && !held('goldbowlbless_pure') && held('goldbowlbless_empty')) {
        // a restock is a ~250 t trip (--existing: glory out + back): only below 3 sharks, or below level + 40 in hp + 20/shark
        // (sim lgxa: hp 99 + 3 sharks, Nezikchened under Protect from Melee cost 10 hp, 0 sharks), or with no prayer potion
        const low = bot.count('shark') < 3 || hpNow() + 20 * bot.count('shark') < hpMax() + 40 || potsHeld() === 0;
        log(`417 food check before the dungeon: ${stateStr()} need sharks ${sharkNeed()} -> ${low ? 'RESTOCK' : 'ok'}`);
        if ((low || process.env.LG_B_FOOD_TEST === '1') && ctx.helper) await restock('dungeon');   // (no helper: the Nezikchened gate decides)
        else await eatUp(B_NEZ_SHARKS, 'dungeon');
    } else if (ctx.helper && process.env.LG_B_FOOD !== '0' && !held('goldbowlbless_pure') && held('goldbowlbless_empty')) {
        const hp = bot.stat('hitpoints'), food = bot.count('shark');
        if (process.env.LG_B_FOOD_TEST === '1' || (food < B_FOOD_MIN && hp.cur < hp.level - 25)) {
            log(`318 food: sharks ${food} hp ${hp.cur}/${hp.level}: helper top-up at the belt before the dungeon`);
            await dropJunkSure();
            // (qzm05: meet() trades where the main STANDS: from the belt edge (2816,2940) the helper had 'no reachable bank'.
            // Send the helper now, chop out, stand on MEET.B as the kit meeting does, then trade)
            const n = Math.max(1, Math.min(B_SHARKS + 1 - food, bot.free() - 3));   // slots kept for the reed + jungle logs
            ctx.helper.send(MEET.B, [{ name: 'shark', n }], 'legends B food');
            await walk(COL, IN_Z); await chopLine('jungle out (food)', COL, OUT_Z); await dropJunkSure();
            await walk(MEET.B.x, MEET.B.z, 1, 60);
            const ok = await ctx.helper.meet(MEET.B, [{ name: 'shark', n }], 'legends B food');
            await bot.tick(1);
            log(`318 food: helper ${ok ? 'OK' : 'FAILED'}; sharks ${bot.count('shark')} hp ${bot.stat('hitpoints').cur}`);
            await walk(COL, OUT_Z, 0, 500); await chopLine('jungle in (food)', COL, IN_Z); await dropJunkSure();
            mark('food');
        }
    }

    // ---- 7. reed + sacred pool -> blessed bowl of pure water (stage 10)
    // (fix 417: a function, the Nezikchened gate's restock refills the bowl the same way)
    const pureWater = async () => {
        const reeds = loc('reeds'), pool = loc('pool');
        // session 11 fix 333 (qx108m + qx118m 'cut reed' x4 then FAILED: the 318 food helper trades ALL its sharks (tradeIn
        // 'all', run-lib.ts:170: 4 asked + its own 3), the pack was 28/28, the one eat below came right after the jungle-in
        // chop and was DISCARDED (ACK-NOACK-EAT-FOOD), and each cut's inv_add overflowed the reed onto the floor (InvOps.ts:
        // 74-79)): while the pack is full, a shark goes out (eaten if hp is down 20+, else dropped) before each cut.
        // LG_B_REED_ROOM=0 reverts. TEST: LG_B_REED_TEST=1 skips the pre-cut junk drop + eat (with LG_B_FOOD_TEST=1).
        const reedRoom = process.env.LG_B_REED_ROOM !== '0', reedTest = process.env.LG_B_REED_TEST === '1';
        if (!reedTest) await dropJunkSure();   // the reed needs a free slot
        if (!reedTest && bot.free() === 0 && bot.count('shark') > 0) { bot.opHeld1(objId('shark'), bot.slot('shark')); bot.queueFlush(); await bot.until(() => bot.free() > 0, 4); }
        await act('cut reed', () => {
            if (reedRoom && bot.free() === 0 && held('shark')) {
                const sl = bot.slot('shark'); log('333 reed: pack full - a shark out first');
                if (bot.stat('hitpoints').cur < bot.stat('hitpoints').level - 20) bot.opHeld1(objId('shark'), sl); else bot.dropItem(objId('shark'), sl);
                return;
            }
            useOnLocGo(bot, 'machette', reeds);
        }, () => held('reed_hollow'), 120, 6);
        await act('fill bowl', () => useOnLocGo(bot, 'reed_hollow', pool), () => held('goldbowlbless_pure'), 30, 6);
        await bot.tick(1); dismiss(bot); bot.queueFlush();
        mark('pure water');
    };
    if (!held('goldbowlbless_pure')) await pureWater();

    // ---- 8. the cave, east tunnel, three trials, jagged wall, marked wall
    await walk(2781, 2933, 1);
    await enterCave('cave2');
    if (!held('goldbowlbless_pure')) fail('the pure water evaporated');
    mark('cave2');
    {
        // bookcase crevice -> (2800,9340)
        const bc = loc('bookcase');
        for (let k = 0; k < 4 && me().x < 2799; k++) {   // agility roll (stat_random 60..254) can fail: "You get stuck", retry
            const cs = bot.tickCount;
            await act("bookcase", () => opLocGo(bot, bc, 2), () => inDialog(bot), 60, 6, true);
            await dlg("crevice", () => me().x >= 2799 || (bot.chatModalId === -1 && msgs(cs).some(m => /back out again/.test(m))), [/^Yes please!$/], 40);
            if (me().x < 2799) { dismiss(bot); bot.queueFlush(); await bot.tick(1); }
        }
        if (me().x < 2799) fail('bookcase crevice');
        mark('east tunnel');
        // lockpick gate (search = pick the lock), walked through by the door script
        const lg = loc('lockGate');
        for (let k = 0; k < 4 && me().z > 9331; k++) {
            await act('lockpick gate', () => opLocGo(bot, lg, 2), () => inDialog(bot) || me().z <= 9331, 40, 8, true);
            await dlg('lockpick', () => me().z <= 9331 && bot.chatModalId === -1, [], 40);
            dismiss(bot); bot.queueFlush(); await bot.tick(1);
        }
        if (me().z > 9331) fail('lockpick gate');
        mark('gate1');
        // three boulders: each smash hops to just south of it
        for (const [k, zz] of [['boulder1', 9326], ['boulder2', 9322], ['boulder3', 9318]] as const) {
            const b = loc(k as keyof typeof L);
            await act(k, () => opLocGo(bot, b, 1), () => me().z <= zz, 60, 6);
            await bot.tick(1);
        }
        mark('boulders');
        // strength gate
        const sg = loc('strGate');
        for (let k = 0; k < 4 && me().z > 9313; k++) {
            await act('strength gate', () => opLocGo(bot, sg, 1), () => inDialog(bot) || me().z <= 9313, 40, 8, true);
            await dlg('force doors', () => me().z <= 9313 && bot.chatModalId === -1, [/^Yes, I'm very strong, I'll force them open\.$/], 40);
            dismiss(bot); bot.queueFlush(); await bot.tick(1);
        }
        if (me().z > 9313) fail('strength gate');
        mark('gate2');
        // jagged wall from the south (fixed start 2790,9295 -> 2789,9296)
        const jw = loc('jagged');
        await walk(2790, 9295);
        await act('jagged wall', () => opLocGo(bot, jw, 2), () => me().z >= 9296, 30, 8);
        await bot.tick(1);
        // marked wall: soul, mind, earth, law, law (in this order), then "Yes, I'll go through!"
        const mw = loc('markIn');
        for (const r of ['soulrune', 'mindrune', 'earthrune', 'lawrune', 'lawrune']) {
            // accepted: the rune leaves the pack + a mesbox; refused: "The rune burns red hot" and it is DROPPED (also leaves the pack)
            const n0 = bot.count(r), s = bot.tickCount;
            await act(`rune ${r}`, () => { if (bot.count(r) >= n0) useOnLocGo(bot, r, mw); }, () => bot.count(r) < n0, 30, 6);
            await bot.tick(1);
            if (msgs(s).some(m => /burns red hot/.test(m))) fail(`rune ${r} refused by the marked wall (${msgs(s).join(' | ')})`);
            await dlg(`rune ${r} box`, () => bot.chatModalId === -1 || bot.dialogOptions().length > 0, [], 10);
            log(`rune ${r} merged`);
        }
        await dlg('marked door', () => me().x <= 2775 && me().z <= 9302, [/^Yes, I'll go through!$/], 20);
        if (!(me().x <= 2775)) fail('marked wall');
        dismiss(bot); bot.queueFlush();
        mark('gem room');
    }

    // ---- 9. gems -> Book of Binding
    {
        for (const [g, x, z] of GEMS) {
            const rock = locAt(2928, x, z, 0);
            await act(`gem ${g}`, () => useOnLocGo(bot, g, rock), () => !held(g), 60, 6);
        }
        const s = bot.tickCount;
        if (!(await bot.until(() => msgs(s - 3).some(m => /book appears/.test(m)) || bot.groundItems.has(`2765,9297,${objId('book_of_binding')}`), 40))) log('no "book appears" message seen; trying the pickup anyway');
        await act('take book', () => { pickupGo(bot, 'book_of_binding', { x: 2765, z: 9297 }); }, () => held('book_of_binding'), 40, 4);
        mark('book');
    }

    // ---- 10. back to the main cave
    {
        const mo = loc('markOut');
        const outDone = () => me().x >= 2780 && me().z >= 9305;
        for (let k = 0; k < 3 && !outDone(); k++) { await act('marked wall out', () => opLocGo(bot, mo, 1), () => inDialog(bot) || outDone(), 40, 6, true); await dlg('marked out box', outDone, [], 15); }
        if (!outDone()) fail('marked wall out');
        dismiss(bot); bot.queueFlush();
        await walk(2789, 9296);
        const jw = loc('jagged');
        await act('jagged wall back', () => opLocGo(bot, jw, 2), () => me().z <= 9295, 30, 8);
        await bot.tick(1);
        const sg = loc('strGate');
        // route runner (fix 105, chaos qrk1m 'strength gate back' after 4 tries): forcing the doors is a strength roll; 10 tries
        for (let k = 0; k < 10 && me().z < 9314; k++) {
            await walk(2809, 9313, 1);
            await act('strength gate back', () => opLocGo(bot, sg, 1), () => inDialog(bot) || me().z >= 9314, 40, 8, true);
            await dlg('force doors back', () => me().z >= 9314 && bot.chatModalId === -1, [/^Yes, I'm very strong, I'll force them open\.$/], 40);
            dismiss(bot); bot.queueFlush(); await bot.tick(1);
        }
        if (me().z < 9314) fail('strength gate back');
        for (const [k, zz] of [['boulder3', 9321], ['boulder2', 9325], ['boulder1', 9329]] as const) {
            const b = loc(k as keyof typeof L);
            await act(`${k} back`, () => opLocGo(bot, b, 1), () => me().z >= zz, 60, 6);
            await bot.tick(1);
        }
        const lg = loc('lockGate');
        for (let k = 0; k < 4 && me().z < 9332; k++) {
            await act('lockpick gate back', () => opLocGo(bot, lg, 1), () => inDialog(bot) || me().z >= 9332, 40, 8, true);
            await dlg('lever', () => me().z >= 9332 && bot.chatModalId === -1, [], 30);
            dismiss(bot); bot.queueFlush(); await bot.tick(1);
        }
        if (me().z < 9332) fail('lockpick gate back');
        const cr = loc('crevice');
        await act('crevice', () => opLocGo(bot, cr, 2), () => inDialog(bot) || me().x <= 2796, 40, 6, true);
        await dlg('crevice squeeze', () => me().x <= 2796, [/^Yes please!$/], 30);
        if (me().x > 2796) fail('crevice back');
        dismiss(bot); bot.queueFlush();
        mark('main cave');
    }

    // ---- 11. into the octagram, the Book of Binding on Ungadulu, Nezikchened
    {
        const fw = loc('fireWall');
        await walk(2787, 9326);
        // session 11 (qv10m entered at hp 60/99 and died): eat up to near full first (keep 2 sharks for the fight). LG_NEZ_EAT=0 reverts.
        for (let k = 0; k < 4 && !B_SAFE && process.env.LG_NEZ_EAT !== '0' && bot.stat('hitpoints').cur < bot.stat('hitpoints').level - 22 && bot.count('shark') > 2; k++) {
            bot.opHeld1(objId('shark'), bot.slot('shark')); bot.queueFlush(); await bot.tick(3);
        }
        // fix 417 hard gate: never START Nezikchened unsafe. Eat up (2 kept for the fight); still unsafe -> out of the cave
        // (the exit is free from the main cave), restock at the belt, refill the bowl (the chop emptied it), back in.
        if (B_SAFE) {
            if (process.env.LG_B_SAFE_TEST === 'nez' && !(globalThis as any).__lg417nez) {
                (globalThis as any).__lg417nez = 1;
                for (let k = 0; k < 12 && bot.count('shark') > 1; k++) { bot.dropItem(objId('shark'), bot.slot('shark')); bot.queueFlush(); await bot.tick(1); }
                log(`417 TEST nez: sharks dropped to ${bot.count('shark')}`);
            }
            await eatUp(2, 'nez gate');
            log(`417 nez gate: ${stateStr()} -> ${nezSafe() ? 'SAFE' : 'NOT SAFE: restock first'}`);
            if (!nezSafe()) {
                if (!ctx.helper) fail(`417 nez gate: unsafe to start Nezikchened (${stateStr()}) and no helper/bank to restock`);
                await leaveCave();
                await restock('nez');
                if (!held('goldbowlbless_pure')) await pureWater();
                await enterCave('cave3');
                if (!held('goldbowlbless_pure')) fail('the pure water evaporated (after the 417 restock)');
                await walk(2787, 9326);
                await eatUp(2, 'nez gate 2');
                if (!nezSafe()) fail(`417 nez gate: still unsafe after the restock (${stateStr()})`);
                log(`417 nez gate after the restock: ${stateStr()} -> SAFE`);
            }
        }
        await act('douse flames', () => useOnLocGo(bot, 'goldbowlbless_pure', fw), () => me().x >= 2789, 30, 6);
        mark('octagram');
        const s = bot.tickCount;
        await act('book on ungadulu', () => {
            const u = npc(bot, UNGADULU); if (!u) return;
            bot.useItemOnNpc(u.idx, objId('book_of_binding'), bot.slot('book_of_binding'));
        }, () => inDialog(bot) || npcsOf(bot, NEZIK).length > 0, 40, 5, true);
        await dlg('binding', () => npcsOf(bot, NEZIK).length > 0 && bot.chatModalId === -1, [], 30);
        mark('nezikchened');
        // prayer: drained to 10% at the summon -> potion, Protect from Melee (he uses magic only from range)
        let lastAtk = -100, lastPot = -100, kills = false, seenNez = -1, jChecks = 0;
        const end = bot.tickCount + 600, nezT = bot.tickCount, nezHp0 = hpNow(), nezSh0 = bot.count('shark');
        let nezMin = nezHp0, protTicks = 0, fightTicks = 0;
        while (bot.tickCount < end && !bot.disposed) {
            nezMin = Math.min(nezMin, hpNow()); fightTicks++; if (bot.isPrayerActive('protectfrommelee')) protTicks++;
            if (msgs(s).some(m => /pile of ashes/.test(m))) { kills = true; break; }
            // session 11 (audit): the kill was known only by the 'pile of ashes' message (lost across a reconnect): once he has been
            // out of view for 12 t, the journal's stage 12 line ('... I then slew the demon') counts too. LG_NEZ_JOURNAL=0 reverts.
            if (npc(bot, NEZIK)) seenNez = bot.tickCount;
            else if (process.env.LG_NEZ_JOURNAL !== '0' && seenNez >= 0 && bot.tickCount - seenNez >= 12 && jChecks < 3 && bot.chatModalId === -1) {
                jChecks++; seenNez = bot.tickCount;
                const j = await readJournal(bot, 'legends');
                log(`Nezikchened out of view: journal ${j.ok ? (/I then slew the demon/i.test(j.text) ? 'stage 12 (slain)' : 'not slain') : 'UNREADABLE'}`);
                if (j.ok && /I then slew the demon/i.test(j.text)) { kills = true; break; }
            }
            if (bot.chatModalId !== -1) { bot.resumeDialogPage(); bot.queueFlush(); }
            const pot = bot.inv().find(x => PRAYER_POTS.includes(x.obj));
            if (bot.stat('prayer').cur < 8 && pot && bot.tickCount - lastPot >= 3) { bot.opHeld1(pot.obj, pot.slot); bot.queueFlush(); lastPot = bot.tickCount; }
            if (bot.stat('prayer').cur > 0 && !bot.isPrayerActive('protectfrommelee')) { bot.activatePrayer('protectfrommelee'); bot.queueFlush(); }
            eatIfLow(process.env.LG_NEZ_EAT === '0' ? 55 : Math.max(55, Math.floor(bot.stat('hitpoints').level * 0.6)));
            const n = npc(bot, NEZIK);
            if (n && !msgs(s).some(m => /I shall return for you/.test(m)) && bot.tickCount - lastAtk >= 5) { bot.opNpc(n.idx, 2); bot.queueFlush(); lastAtk = bot.tickCount; }
            if (bot.tickCount % 20 === 0) log(`fight nez=${n ? `${n.x},${n.z} d${n.d}` : '-'} sharks=${bot.count('shark')}`);
            await bot.tick(1);
        }
        if (bot.isPrayerActive('protectfrommelee')) { bot.deactivatePrayer('protectfrommelee'); bot.queueFlush(); }
        fightLog(`nezikchened (Protect from Melee ${Math.round(100 * protTicks / Math.max(1, fightTicks))}% of ticks)`, nezT, nezHp0, Math.min(nezMin, hpNow()), nezSh0);
        if (!kills) fail('Nezikchened not defeated');
        dismiss(bot); bot.queueFlush(); await bot.tick(1);
        // fix 417: leave B (C starts with jungle walks + Gujuo's animals) near full, the safe octagram is the place to eat
        if (B_SAFE) await eatUp(0, 'B exit');
        mark('stage12');
    }
    const p = bot.pos();
    return {
        ok: true, ticks: bot.tickCount - t0, marks, exit: { x: p.x, z: p.z, level: p.level },
        inv: bot.inv().map(s => `${locScene.objName(s.obj) || s.obj}x${s.count}`).join(','),
    };
}
