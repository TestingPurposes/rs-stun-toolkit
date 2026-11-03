// q-fight-arena.ts — Fight Arena (quest_arena), cheat-free. Max-QP build, ardougne lane.
//
// Content (rev 289, server/content/scripts/quests/quest_arena/scripts/): quest_arena.rs2, lady_servil.rs2,
// khazard_guard.rs2, khazard_barman.rs2, jeremy_servil.rs2, hengrad.rs2, general_khazard.rs2, khazard_ogre.rs2,
// khazard_scorpion.rs2, bouncer.rs2. Stage varp %arenaquest (quest_arena.constant:1-13; complete = 14,
// general/configs/quest.constant:3), NOT transmitted.
// Flow (file:line):
//   Lady Servil (2566,3199) "Can I help you?"                                              -> started (1)  lady_servil.rs2:30-43
//   chest (2613,3189): Open, Search -> Khazard helmet + platemail (worn from here on)      -> obtained_armour (2) quest_arena.rs2:1-30
//   west door (2585,3141) from outside, guard within 5 -> in (quest_arena.rs2:32-55)
//   drunk guard (2615,3141), armour worn                                                  -> spoken_drunkguard (3) khazard_guard.rs2:98-105
//   out of the west door, barman (2566,3140) "I'd like a Khali brew please." (5 gp)        khazard_barman.rs2:1-37
//   back in; drunk guard with the brew -> cell keys                                        -> given_khali_brew (5) khazard_guard.rs2:110-125
//   Jeremy (2616,3168) with the keys (apnpc, range 2) -> freed, p_delay, into the arena    -> entered_ogre_fight (6) jeremy_servil.rs2:1-12,57-93
//   kill the Khazard Ogre (cl 63) -> the General's talk, jail cell (2600,3142)              -> sent_jail (9)  general_khazard.rs2:35-79
//   Hengrad (2598,3142) -> cutscene back into the arena, the scorpion (cl 44) attacks        hengrad.rs2:1-70
//   kill it -> Bouncer (cl 137, 116 hp, max 13) is released; kill it                       -> freed_servils (12) general_khazard.rs2:81-103
//   arena door (2606,3152) opens at stage 12 (quest_arena.rs2:124-136); west door out; the General need not be killed
//   Lady Servil                                                                             -> complete (14) quest_arena.rs2:267-274
//   Kills only count while not busy (bouncer.rs2:5-12): never sit in a dialog during a fight.
import { SpeedBot, cheb, objId } from '../../../core.js';
import { qp, inDialog, dismiss, nav, trace, npc, npcsOf, opNpcGo, type Tile } from '../../q-lib.js';
import { type Item, type Ctx, ctx, mark, fail, talkTo, finishDialog, opLocUntil, wear, textWatch, deathWatch, walkLive, walkShort, StepError } from './ar-lib.js';
import { isResuming, journalStage, failHook } from '../journal.js';

export const QUEST = { name: 'Fight Arena', dir: 'quest_arena', qp: 2 };
export const REQUIREMENTS = {
    quests: [] as string[], qp: 0,
    skills: {} as Record<string, [number, string]>,   // no skill checks; three mandatory fights (Ogre 63, Scorpion 44, Bouncer 137)
    start: { x: 2567, z: 3197, level: 0 },              // next to Lady Servil, north of the arena
    end: { x: 2567, z: 3197, level: 0 },
};
export const SUPPLY: Item[] = [{ name: 'coins', n: 5 }, { name: 'shark', n: 12 }];

const SERVIL = 264, JEREMY_ARENA = 266, GUARD2 = 254, BARMAN = 259, JEREMY = 265, HENGRAD = 263, OGRE = 270, SCORPION = 271, BOUNCER = 269;
const SERVIL_AT = { x: 2566, z: 3199 }, GUARD2_AT = { x: 2615, z: 3141 }, BARMAN_AT = { x: 2566, z: 3140 }, JEREMY_AT = { x: 2616, z: 3168 }, HENGRAD_AT = { x: 2598, z: 3142 };
const CHEST = { id: 75, x: 2613, z: 3189 }, CHEST_OPEN = 76;
const DOOR1 = { id: 81, x: 2585, z: 3141 }, DOOR1_OUT = { x: 2584, z: 3141 }, DOOR1_IN = { x: 2585, z: 3141 }, DOOR2 = { id: 82, x: 2606, z: 3152 };

const inJail = (b: SpeedBot) => { const t = b.tile(); return t.x >= 2585 && t.x <= 2622 && t.z >= 3137 && t.z <= 3171; };
const inArena = (b: SpeedBot) => { const t = b.tile(); return t.x >= 2581 && t.x <= 2606 && t.z >= 3151 && t.z <= 3171; };   // quest_arena.constant:15-16
// session 11 fix 383 (qx298m: a 1012 drop during the arena-door op left us on (2606,3151): inside the inArena box (z >= 3151)
// but on the door's OUTSIDE (fightarena_door2: x > 2606 | z < 3152 = outside, quest_arena.rs2:94), where at stage 12 the door
// is "locked" or a guard attacks (quest_arena.rs2:95-101) -> 'arena-door-out' in 13 t on every retry). Past the arena door =
// off the box, or within 2 of the door on its outside side. AR_DOOR383=0 reverts.
const AR_DOOR383 = () => process.env.AR_DOOR383 !== '0';
const pastArenaDoor = (b: SpeedBot) => { const t = b.tile(); return !inArena(b) || (AR_DOOR383() && cheb(t, DOOR2) <= 2 && (t.x > DOOR2.x || t.z < DOOR2.z)); };
let doorTestFired = false;
// session 11 fix 399a (spawns m40_49.jm2: jeremy_servil_arena 266 at 2602,3154; general_khazard 258 at 2606,3154)
const GENERAL = 258, JEREMY_ARENA_AT = { x: 2602, z: 3154 };
let st8TestFired = false;

export async function run(bot: SpeedBot, o: { log?: boolean } = {}): Promise<{ ok: boolean; ticks: number; msg: string; marks?: Record<string, number> }> {
    await nav();
    const c = ctx(bot, o.log ?? true);
    trace(bot, c.t0);
    const qp0 = qp(bot);
    bot.holdDialogs = true;
    const dw = deathWatch(c);
    try {
        await body(c, dw.dead);
        return { ok: true, ticks: bot.tickCount - c.t0, msg: `quest points ${qp0} -> ${qp(bot)}`, marks: c.marks };
    } catch (e) {
        return { ok: false, ticks: bot.tickCount - c.t0, msg: (e as Error).message, marks: c.marks };
    } finally { dw.stop(); bot.holdDialogs = false; }
}

/** Attack the nearest npc of `type` until it is gone (re-attack every 4 ticks; dialogs that pop up are driven so the
 *  kill is not lost to "busy"). Returns true when it has been seen and then vanished. */
async function kill(c: Ctx, type: number, dead: () => boolean, label: string, maxTicks = 400, fightable: () => boolean = () => true,
    onDialog?: () => boolean): Promise<boolean> {
    const bot = c.bot, t0 = bot.tickCount;
    let seen = false, lastOp = -10;
    while (bot.tickCount - t0 < maxTicks) {
        if (dead()) fail(c, `${label} (DIED)`);
        if (inDialog(bot) && !(onDialog?.())) { await finishDialog(bot, [/.*/], 10); continue; }
        const n = npc(bot, type);
        if (!n) { if (seen) { mark(c, label); return true; } await bot.tick(1); continue; }
        if (!seen && !fightable()) { await bot.tick(1); continue; }
        seen = true;
        if (bot.tickCount - lastOp >= 4) { opNpcGo(bot, n, 2); lastOp = bot.tickCount; }
        await bot.tick(1);
    }
    return false;
}

/** session 10 resume: the quest JOURNAL (quest_arena/scripts/arena_journal.rs2) -> %arenaquest, first match wins (latest first) */
const AR_STAGES: Array<[RegExp, number]> = [
    [/QUEST COMPLETE/i, 14], [/tell\s+Lady Servil\s+the good news/i, 12], [/I can stay to fight him, or I can run/i, 11],
    [/fight his pet,\s+Bouncer/i, 10], [/have to fight in the Arena!/i, 9], [/talk to\s+Jeremy\s+in the\s+Fight Arena/i, 8],
    [/protect\s+Jeremy and his father/i, 6], [/got the keys I should try to rescue/i, 5], [/really likes\s+Khali Brew/i, 3],
    [/found some\s+Khazard armour\s+in a chest/i, 2], [/go to the\s+Fight Arena\s+and try to find/i, 1],
];
/** fix 312: qx74m 'servil-complete failed' x2. CONFIRMED: an engine-restart drop (ws 1012 at engine t17158, re-attached
 *  after 38 t) covered the Bouncer's death (optrace 'target cleared' on npc 269 at t17182); defeat_arena_bouncer set 11 and
 *  opened the General's talk while we were offline (bouncer.rs2:14-22), the client never saw it, and (INFERRED) the
 *  arena-door op 7 t later dropped it before general_khazard_attack set 12; the retries' journal read 'stage 11 | ... I can stay to fight
 *  him, or I can run away', Lady Servil gives nothing at 11 (lady_servil.rs2), and the st=11 resume only talked to Jeremy
 *  when already in the arena (it was not) -> the same wall every try. */
const STAGE12_FIX = () => process.env.AR_STAGE12 !== '0';
let genTestFired = false;
/** Khazard armour held or worn */
const armour = (b: SpeedBot) => ['khazard_helmet', 'khazard_platemail'].every(n => b.count(n) > 0 || b.isWorn(objId(n)));

async function body(c: Ctx, dead: () => boolean): Promise<void> {
    const bot = c.bot;
    const need = (ok: boolean, label: string) => { if (dead()) fail(c, `${label} (DIED)`); if (!ok) fail(c, label); failHook(`arena:${label}`); };
    // session 10: on a retry, resume at the stage the journal shows (AR_RESUME=0 = always from the top)
    let st = 0;
    if (isResuming(bot) && process.env.AR_RESUME !== '0') {
        dismiss(bot);
        st = await journalStage(bot, 'arena', AR_STAGES, 0, s => console.log(`[arena] ${s}`));
        console.log(`[arena] resume at stage ${st} @${JSON.stringify(bot.pos())} armour ${armour(bot)} brew ${bot.count('khali_brew')} keys ${bot.count('khazard_cellkeys')}`);
        if (st >= 14) return;
    }
    const R = st > 0;
    if ((!R || (st <= 3 && !bot.count('khali_brew'))) && bot.count('coins') < 5) fail(c, 'need 5 coins for the Khali brew');
    const enterWest = async (label: string) => need(await opLocUntil(c, DOOR1, 1, () => inJail(bot), { label, stand: DOOR1_OUT, answers: [/.*/] }), label);
    const leaveWest = async (label: string) => need(await opLocUntil(c, DOOR1, 1, () => !inJail(bot), { label, stand: DOOR1_IN }), label);
    /** fix 312 (AR_STAGE12=0 reverts): read the journal after Bouncer; at stage 11 (the General's talk lost) get the agreement
     *  from Jeremy in the arena (jeremy_servil.rs2:35-38 -> general_khazard_agreement -> 12), re-entering by the west door
     *  first when outside (at 11 its guard says "back for more" -> arena_enter, quest_arena.rs2 fightarena_door1; the arena
     *  door itself only refuses from outside). */
    const ensureStage12 = async (): Promise<void> => {
        await finishDialog(bot, [/.*/], 30);
        const log = (s: string) => console.log(`[arena] ${s}`);
        let s = await journalStage(bot, 'arena', AR_STAGES, -1, log);
        if (s !== 11) return;   // 12+ = the talk ran; -1 = unreadable (the old path)
        if (process.env.AR_GEN_TEST === '2' && !R) { log('AR_GEN_TEST=2: leaving the arena at stage 11 (the retry must re-enter)'); return; }
        for (let k = 0; k < 2 && s === 11; k++) {
            if (!inArena(bot)) {
                log(`stage 11 outside the arena @${JSON.stringify(bot.tile())}: back in by the west door`);
                if (inJail(bot)) { await walkLive(bot, DOOR1_IN, { near: 0, maxTicks: 120 }); await leaveWest('door-out-reenter'); }
                await opLocUntil(c, DOOR1, 1, () => inArena(bot), { label: 'door-reenter', stand: DOOR1_OUT, answers: [/.*/] });
                await bot.until(() => inArena(bot) && !inDialog(bot), 12);
                need(inArena(bot), 'stage11-reenter'); mark(c, 'arena-reenter');
            }
            const agreed = textWatch(bot, /pleasure of killing you myself/i);
            await talkTo(c, JEREMY_ARENA, null, [/.*/], () => agreed() && !inDialog(bot), { label: 'jeremy-agreement', maxTicks: 60 }).catch(() => false);
            await finishDialog(bot, [/.*/], 20);
            s = await journalStage(bot, 'arena', AR_STAGES, -1, log);
        }
        need(s !== 11, 'stage12-agreement'); mark(c, 'stage-12');
    };

    if (st <= 0) {
    // 1. Lady Servil
    const started = textWatch(bot, /Can I help you\?/i);
    need(await talkTo(c, SERVIL, SERVIL_AT, [/^Can I help you\?$/], () => started() && !inDialog(bot), { label: 'servil-start' }), 'servil-start');
    }
    if (st <= 5 && !(R && armour(bot))) {
    // 2. the guard's chest: Open, Search, wear both
    for (let k = 0; k < 5 && !(bot.count('khazard_helmet') && bot.count('khazard_platemail')); k++) {
        const open = bot.liveLocs.get(`0,${CHEST.x},${CHEST.z}`) === CHEST_OPEN;
        if (!open) await opLocUntil(c, CHEST, 1, () => bot.liveLocs.get(`0,${CHEST.x},${CHEST.z}`) === CHEST_OPEN, { label: 'chest-open', tries: 2 });
        else await opLocUntil(c, { ...CHEST, id: CHEST_OPEN }, 1, () => bot.count('khazard_helmet') > 0 && bot.count('khazard_platemail') > 0, { label: 'chest-search', tries: 2 });
    }
    need(bot.count('khazard_helmet') > 0 && bot.count('khazard_platemail') > 0, 'armour');
    dismiss(bot);
    }
    // (resume: the armour stays worn from here on; wearing is a no-op when it already is)
    if (st <= 5) need(await wear(bot, ['khazard_helmet', 'khazard_platemail']), 'wear-armour');
    if (st <= 2) {
    // 3. in by the west door, the drunk guard
    await enterWest('door-in-1');
    dismiss(bot);
    const drunk = textWatch(bot, /too much Khali brew and I'll fall asleep/i);
    need(await talkTo(c, GUARD2, GUARD2_AT, [/.*/], () => drunk(), { label: 'guard2-1' }), 'guard2-1');
    dismiss(bot);
    }
    if (st <= 3) {
    // 4. out, the barman's Khali brew, back in, the guard takes it -> keys
    if (!R || !bot.count('khali_brew')) {
    if (!R || inJail(bot)) await leaveWest('door-out-1');
    need(await talkTo(c, BARMAN, BARMAN_AT, [/^I'd like a Khali brew please\.$/], () => bot.count('khali_brew') > 0, { label: 'barman' }), 'barman');
    dismiss(bot);
    }
    if (!R || !inJail(bot)) await enterWest('door-in-2');
    dismiss(bot);
    need(await talkTo(c, GUARD2, GUARD2_AT, [/.*/], () => bot.count('khazard_cellkeys') > 0, { label: 'guard2-keys' }), 'guard2-keys');
    dismiss(bot);
    }
    if (st <= 5) {
    // 5. Jeremy (apnpc range 2 with the keys) -> the arena; the ogre
    if (R && !inJail(bot)) await enterWest('door-in-3');
    need(await talkTo(c, JEREMY, JEREMY_AT, [/.*/], () => inArena(bot), { label: 'jeremy-freed', maxTicks: 200 }), 'jeremy-freed');
    }
    if (st <= 6) {
    // (resume at 6, in the arena: Jeremy there re-spawns the ogre, jeremy_servil.rs2:57-60)
    if (R && !npc(bot, OGRE)) await talkTo(c, JEREMY_ARENA, null, [/.*/], () => !!npc(bot, OGRE) && !inDialog(bot), { label: 'jeremy-ogre', maxTicks: 60 }).catch(() => false);
    // fix 399a TEST only (proof399: kill() played the General's post-ogre talk -> jail = stage 9 before the TEST could fire):
    // under AR_ST8_TEST hold that dialog open so the TEST below cuts it at stage 8.
    const st8Hold = () => (process.env.AR_ST8_TEST === '1' || process.env.AR_ST8_TEST === '2') && !R && !st8TestFired && !npc(bot, OGRE);   // only once the ogre is dead (level-up pages mid-fight must still close)
    need(await kill(c, OGRE, dead, 'ogre', 400, undefined, st8Hold), 'ogre');
    }
    if (st <= 8) {
    // the General's dialogue chain, then the jail cell (resume at 8: Jeremy in the arena starts it, jeremy_servil.rs2:52-56)
    // session 11 fix 399a (qx375m + qx208m: a 1012 drop at the ogre's death lost the post-ogre talk (stage stays 8) -> 'jail'
    // failed, then every stage-8 retry in 23 t: talkTo(JEREMY_ARENA, null) threw 'npc 266 not in view' (Jeremy at 2602,3154 is
    // 13 > 10 tiles from the ogre-fight tile 2603,3167; with no `at` talkTo cannot walk, ar-lib.ts:47-49) and .catch hid it).
    // Walk toward Jeremy and accept the General as well (opnpc1 general_khazard at defeated_ogre -> belong_nobody -> jail,
    // general_khazard.rs2:17-20). Also on a first attempt when no talk came 20 t after the kill. AR_ST8_399=0 reverts.
    const ST8 = process.env.AR_ST8_399 !== '0';
    const genText = () => inDialog(bot) && /property|belong/i.test(String([...bot.ifText.values()].join(' ')));
    const genTalk = () => talkTo(c, ST8 ? [JEREMY_ARENA, GENERAL] : JEREMY_ARENA, ST8 ? JEREMY_ARENA_AT : null, [/.*/], genText, { label: 'jeremy-general', maxTicks: ST8 ? 120 : 60 }).catch(() => false);
    if (R && st === 8 && !inDialog(bot)) await genTalk();
    // session 11 fix 399a TEST (once per process, first attempt only): close the post-ogre talk (the qx375m state: stage 8,
    // no modal) and park on 2603,3167 (13 tiles from Jeremy). =1: fail, so the retry resumes at stage 8; =2: carry on (inline recovery)
    if ((process.env.AR_ST8_TEST === '1' || process.env.AR_ST8_TEST === '2') && !R && !st8TestFired) {
        st8TestFired = true;
        await bot.until(() => inDialog(bot), 20);
        console.log(`[arena] 399a TEST: closing the post-ogre talk (open ${inDialog(bot)}) @${JSON.stringify(bot.tile())}`);
        bot.closeModal(); bot.queueFlush(); await bot.tick(1);
        const ok = await walkShort(bot, { x: 2603, z: 3167 });
        console.log(`[arena] 399a TEST: parked at ${JSON.stringify(bot.tile())} (walk ok ${ok})`);
        if (process.env.AR_ST8_TEST === '1') fail(c, 'AR_ST8_TEST');
    }
    await bot.until(() => inDialog(bot) || (bot.tile().z <= 3143 && bot.tile().x <= 2602), 20);
    if (ST8 && !inDialog(bot) && bot.tile().z > 3143) { console.log(`[arena] 399a: no General's talk @${JSON.stringify(bot.tile())} (R ${R}): asking Jeremy / the General`); await genTalk(); }
    await finishDialog(bot, [/.*/], 60, () => bot.tile().z <= 3143 && bot.tile().x <= 2602 && !inDialog(bot));
    need(bot.tile().z <= 3143, 'jail'); mark(c, 'jail');
    }
    if (st <= 9 && !(R && inArena(bot))) {
    // 6. Hengrad -> cutscene -> the scorpion, then Bouncer
    const freed = textWatch(bot, /guard is coming|Good luck friend/i);
    need(await talkTo(c, HENGRAD, HENGRAD_AT, [/.*/], () => freed() || inArena(bot), { label: 'hengrad' }), 'hengrad');
    // the guard's cutscene: p_delay(9), forcemoves along the corridor, the arena door, a mesbox (hengrad.rs2:20-66): ~30 t
    for (let k = 0; k < 90 && !(inArena(bot) && !inDialog(bot) && !!npc(bot, SCORPION)); k++) {
        if (inDialog(bot)) bot.resumeDialogPage();
        await bot.tick(1);
    }
    need(inArena(bot), 'arena-2'); mark(c, 'arena-2');
    }
    // Protect from Melee for the scorpion + Bouncer when available (prayer 43): arfar1 (att/str/def/hp 70, no prayer) ate all
    // 8 sharks and died to Bouncer (max 13)
    const pray = (on: boolean) => {
        if (bot.stat('prayer').level < 43) return;
        if (on && bot.stat('prayer').cur > 0 && !bot.isPrayerActive('protectfrommelee')) { bot.activatePrayer('protectfrommelee'); bot.queueFlush(); }
        if (!on && bot.isPrayerActive('protectfrommelee')) { bot.deactivatePrayer('protectfrommelee'); bot.queueFlush(); }
    };
    // session 9 (allchaos qu19m: a server drop during Hengrad's cutscene, the scorpion never spawned: 400 t standing in the arena,
    // retries not re-entrant): Jeremy in the arena re-releases it while %arenaquest = sent_jail (jeremy_servil.rs2:43); after
    // 40 t without a scorpion talk to him, twice (AR_SCORP_JEREMY=0 reverts)
    if (st <= 9) {
    if (process.env.AR_SCORP_JEREMY !== '0') {
        for (let k = 0; k < 2 && !(await bot.until(() => !!npc(bot, SCORPION), 40)); k++) {
            const j = npc(bot, JEREMY_ARENA);
            console.log(`[arena] no scorpion after 40 t (try ${k + 1}): Jeremy ${j ? `${j.x},${j.z} d${j.d}` : 'not visible'} me ${JSON.stringify(bot.tile())}`);
            if (j) await talkTo(c, JEREMY_ARENA, { x: j.x, z: j.z }, [/.*/], () => !!npc(bot, SCORPION) && !inDialog(bot), { label: 'jeremy-scorpion' }).catch(() => false);
        }
    }
    need(await kill(c, SCORPION, dead, 'scorpion'), 'scorpion');   // scorpion max 5: no prayer (43 points last ~130 t of Protect)
    }
    if (st <= 10) {
    // Bouncer is released only if the General stands within 15 of (our x+8) when the scorpion dies
    // (khazard_scorpion.rs2:15-20); otherwise Jeremy in the arena releases him (jeremy_servil.rs2:39-44). A caged
    // Bouncer (x >= 2607, behind the gates at x 2606) is visible but cannot be fought.
    const released = () => { const b = npc(bot, BOUNCER); return !!b && b.x <= 2606; };
    for (let k = 0; k < 12 && !released(); k++) { if (inDialog(bot)) bot.resumeDialogPage(); await bot.tick(1); }
    // session 11 fix 399a (latent sibling, diag399: with `at` null and Jeremy > 10 tiles away talkTo threw 'npc 266 not in
    // view', uncaught): walk toward his spawn. AR_ST8_399=0 reverts.
    if (!released()) await talkTo(c, JEREMY_ARENA, process.env.AR_ST8_399 !== '0' ? JEREMY_ARENA_AT : null, [/.*/], () => released(), { label: 'jeremy-bouncer', maxTicks: 60 });
    pray(true);
    // fix 312 TEST (AR_GEN_TEST=1|2, once per process): drop the General's post-Bouncer talk like the qx74m outage did
    // (close it at its first page, so the door op later kills the suspended script before %arenaquest = 12)
    const genTest = !genTestFired && (process.env.AR_GEN_TEST === '1' || process.env.AR_GEN_TEST === '2');
    const genDrop = () => {
        if (!genTest || genTestFired || !/Nooooo! Bouncer|underestimated you|false promises/i.test([...bot.ifText.values()].join(' '))) return false;
        genTestFired = true; console.log(`[arena] AR_GEN_TEST=${process.env.AR_GEN_TEST}: closing the General's talk (stage stays 11)`);
        bot.closeModal(); bot.queueFlush(); return true;
    };
    need(await kill(c, BOUNCER, dead, 'bouncer', 600, released, genDrop), 'bouncer');
    pray(false);
    }
    // after Bouncer: the General talks, then attacks (stage 12). Out by the arena door and the west door.
    // (resume at 11: Jeremy in the arena runs the General's agreement -> 12, jeremy_servil.rs2:35-38)
    if (STAGE12_FIX() && st <= 11) await ensureStage12();
    else if (R && st === 11 && inArena(bot)) {
        const agreed = textWatch(bot, /pleasure of killing you myself/i);
        await talkTo(c, JEREMY_ARENA, null, [/.*/], () => agreed(), { label: 'jeremy-agreement', maxTicks: 60 }).catch(() => false);
    }
    if (st <= 11 || !pastArenaDoor(bot)) {   // session 11 fix 383 (was inArena: (2606,3151) is outside the door)
    await finishDialog(bot, [/.*/], 30);
    need(await opLocUntil(c, DOOR2, 1, () => pastArenaDoor(bot), { label: 'arena-door-out', answers: [/.*/] }), 'arena-door-out');
    dismiss(bot);
    // session 11 fix 383 TEST (AR_DOOR_TEST=1, once per process, first attempt only): park on (2606,3151) (the qx298m tile:
    // stage 12, closed door, outside its side) and fail, so the retry resumes there
    if (process.env.AR_DOOR_TEST === '1' && !R && !doorTestFired) {
        doorTestFired = true;
        const ok = await walkShort(bot, { x: DOOR2.x, z: DOOR2.z - 1 });
        console.log(`[arena] AR_DOOR_TEST: parked at ${JSON.stringify(bot.tile())} (walk ok ${ok}); failing so the retry resumes at stage 12 outside the door`);
        fail(c, 'AR_DOOR_TEST');
    }
    }
    if (st <= 11 || inJail(bot)) {
    await walkLive(bot, DOOR1_IN, { near: 0, maxTicks: 120 });
    await leaveWest('door-out-2');
    }
    // 7. Lady Servil (completion observable: the reward attack xp, quest_arena.rs2:271)
    const att0 = bot.stat('attack').xp;
    need(await talkTo(c, SERVIL, SERVIL_AT, [/.*/], () => bot.stat('attack').xp > att0, { label: 'servil-complete' }), 'servil-complete');
    dismiss(bot);
    void cheb; void objId; void npcsOf; void walkShort;
}
export { StepError };
