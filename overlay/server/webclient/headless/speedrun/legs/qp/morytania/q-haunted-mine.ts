// q-haunted-mine.ts — Haunted Mine (rev 289), cheat-free quest code. Content: quests/quest_hauntedmine/scripts/*.rs2.
//
// Stages (hauntedmine.constant) and what sets each:
//   1   the Saradominist zealot (3444,3258): "I follow the path of Saradomin." / "I come seeking challenges and quests." /
//       "What quest is that then?" (history: stage 1) / "Is there any other way into the mines?" (heard-about-key bit)
//       (zealot.rs2:1-201); then pickpocket him (op3, no roll) for the lift key (zealot.rs2:287-304)
//   3   any cart tunnel (secondary 4913 3440,3232 / back 4914, 4915) (hauntedmine_locs.rs2:5-27)
//   -   the mine has separate regions joined only through the surface; the glowing fungus crumbles in sunlight
//       (hauntedmine_fungus.rs2), so it must ride the puzzle cart from region A (fungus pool, begin cart 2778,4506, all
//       8 point levers) to region C (end cart 2774,4537), which connects underground to region B (the lift).
//       Points puzzle: the 8 lever bits start random(256) (hauntedmine_points.rs2:1-5,139-143, non-transmitted varp);
//       success needs b=1, d=0, a=1, c=0, j=0 (:18-30). Each test run without fungus shows WHERE the cart sinks (a
//       flooded cart loc_add at that coord) or "come right back": we fix one lever per test, then send the fungus.
//   4/5 lift key on the valve (2808,4496), then the lift (2807,4493) (hauntedmine_lift.rs2)
//   6/7 the dark stairs (2746,4436) WITH the fungus -> the boss level (hauntedmine_darkstairs.rs2)
//   8/9 take the key (npc 1543, 2788,4455): Treus Dayth appears; kill him (hauntedmine_boss_ghost.rs2)
//   10  take the key again, through the reward doors (2772/2773,4450)
//   done cut a crystal with a chisel (hauntedmine_crystals.rs2:1-55)
import { SpeedBot, objId, cheb, densify, spellCom } from '../../../core.js';
import { nav, talk, npcsOf, inDialog, levelUpOpen, walkOp, locAt, dismiss, waitText, msgsSince, navSync, turning, withNpcBlocks, R, M2, M3, M4, qp, type FTok } from '../../q-lib.js';
import { talkAt, fail, has, stamp, withSafety, opUntil, opLocReach, useOnLocUntil, routeNextTo, attackFrom, pickup, FOODS, type Item, type QuestMeta, type Reqs, type RunResult } from './mo-lib.js';
import { prayGuard } from './q-shades-of-mortton.js';
import { isResuming, journalStage, failHook } from '../journal.js';

export const QUEST: QuestMeta = { name: 'Haunted Mine', dir: 'quest_hauntedmine', qp: 2 };
export const REQUIREMENTS: Reqs = {
    quests: ['Priest in Peril (Morytania access, holy_barrier.rs2:2)'], qp: 0,
    skills: {
        attack: [85, 'Treus Dayth (def 100, 100 hp; hops away after half the hits; room hazards hit up to 10-15): sim-proven at 85 with 15 sharks (7 eaten)'],
        prayer: [43, 'Protect from Melee for the mine monsters'],
    },
    start: { x: 3444, z: 3256, level: 0 },   // next to the zealot, south of Mort'ton
    end: { x: 2790, z: 4430, level: 0 },     // the crystal cave
};
export const SUPPLY: Item[] = [{ name: 'chisel', n: 1 }, { name: '4doseprayerrestore', n: 2 }, { name: 'shark', n: 15 }];
export const WEAR = ['rune_scimitar'];

const ZEALOT = 1528, BOSS = [1540, 1541], BOSS_KEY = 1543;
const CONTROLS = 11485, TEST_BUTTON = 11708;
/** lever k (1-8) = loc 4949+k toggles bit k: 1 b, 2 a, 3 c, 4 d, 5 e, 6 i, 7 j, 8 k */
const LEVERS: Record<number, { x: number; z: number }> = {
    1: { x: 2785, z: 4517 }, 2: { x: 2784, z: 4517 }, 3: { x: 2786, z: 4517 }, 4: { x: 2786, z: 4515 },
    5: { x: 2785, z: 4515 }, 6: { x: 2768, z: 4533 }, 7: { x: 2769, z: 4533 }, 8: { x: 2770, z: 4533 },
};
const B = 1, A = 2, C = 3, D = 4, J = 7;
/** where the cart sinks (0_43_70_x_z, hauntedmine_points.rs2:21-28) -> what it tells */
const SINKS: Record<string, string> = { '2790,4522': 'b0', '2789,4527': 'b0', '2791,4530': 'b0', '2787,4539': 'd1|j1', '2790,4524': 'c1' };
const seenText = (bot: SpeedBot, re: RegExp) => { const v = [...bot.ifText.values()]; return v.some(x => re.test(x)) || re.test(v.join(' ')); };

export interface HmOpts { log?: boolean; sim?: boolean; from?: string }

export async function run(bot: SpeedBot, o: HmOpts = {}): Promise<RunResult> {
    await nav();
    bot.holdDialogs = true;
    const t0 = bot.tickCount, qp0 = qp(bot), v = o.log !== false;
    const at = (k: string) => { stamp(bot, t0, k, v); failHook(k); };
    let done = false;
    // session 10: on a retry / resume, the phase from the quest JOURNAL (hauntedmine_journal.rs2) and what we hold, over the
    // persisted phase mark (route-legs phaseRun). HM_RESUME=0 = the phase mark only, as before.
    if (isResuming(bot) && process.env.HM_RESUME !== '0') {
        const jf = await hmResumeFrom(bot, o.from);
        if (jf === 'done') return { ok: true, ticks: bot.tickCount - t0, msg: `journal: quest complete (qp ${qp0} -> ${qp(bot)})` };
        if (jf !== o.from) console.log(`[hm] resume from phase '${jf}' (phase mark '${o.from ?? '-'}')`);
        o = { ...o, from: jf };
    }
    // auto retaliate OFF (controls:com_3): the mine's pickaxes/miners/carts would otherwise pull us off every op
    // (auto_retaliate.rs2:7); back ON at the end (controls:com_2)
    bot.ifButton(151); bot.queueFlush(); await bot.tick(1);
    try { await withSafety(bot, 'haunted-mine', async () => { done = await body(bot, o, at); }); }
    catch (e) { bot.ifButton(150); bot.queueFlush(); return { ok: false, ticks: bot.tickCount - t0, msg: (e as Error).message }; }
    bot.ifButton(150); bot.queueFlush();
    return { ok: done, ticks: bot.tickCount - t0, msg: `qp ${qp0} -> ${qp(bot)}${done ? ', quest complete scroll seen' : ''}` };
}

/** Haunted Mine journal stages, latest first (hauntedmine_journal.rs2; stage 2 is unused, 7 and 8 read the same). */
const HM_STAGES: Array<[RegExp, number]> = [
    [/QUEST COMPLETE/i, 11], [/make use of them/i, 10], [/find where to use this key/i, 9],
    [/I had to use a glowing fungus/i, 8], [/too dark\s+to\s+navigate/i, 6], [/Now I can continue my search for the crystals/i, 5],
    [/requires a key\s+to be started/i, 4], [/lower levels where apparently/i, 3], [/other than the sealed main entrance/i, 1], [/I can start this quest/i, 0],
];
/** Resume phase for a retry: the journal stage + position + held items; `mark` is the persisted phase mark (phaseRun). */
async function hmResumeFrom(bot: SpeedBot, mark: string | undefined): Promise<string | undefined> {
    if (bot.chatModalId !== -1 || bot.mainModalId !== -1) { bot.closeModal(); bot.queueFlush(); await bot.tick(1); }
    const st = await journalStage(bot, 'hauntedmine', HM_STAGES, -1, s => console.log(`[hm] ${s}`));
    if (st < 0) return mark;   // unreadable: the phase mark
    const fungus = has(bot, 'glowing_fungus');
    const bossLevel = inBox(bot, 2752, 4416, 2815, 4479), liftLevel = inBox(bot, 2688, 4416, 2751, 4479);
    if (st >= 11) return 'done';
    if (st === 10) return bossLevel && bot.tile().z < 4450 ? 'crystal' : 'reward';
    if (st === 9) return 'reward';
    // 7/8: down the dark stairs (8: the key taken, Treus Dayth up); off the boss level, the stairs again (from stage 8 no fungus)
    if (st >= 7) return bossLevel ? 'boss' : 'stairs';
    // 3-6: the fungus must reach the dark stairs; it crumbles on the surface (hauntedmine_fungus.rs2)
    if (st >= 3) {
        if (fungus) return liftLevel && st >= 5 ? 'stairs' : 'lift';
        if (mark === 'toC' || mark === 'puzzle') return mark;   // the fungus rides the cart / the puzzle half done
        return 'toA';
    }
    if (st >= 1) return has(bot, 'hauntedmine_lift_key') ? (mark ?? 'toA') : 'zealot';
    return 'zealot';
}

// region tests
const reg = (b: SpeedBot) => { const t = b.tile(); return { x: t.x, z: t.z, l: b.minusedlevel }; };
const surface = (b: SpeedBot) => b.tile().z < 4000;
const inBox = (b: SpeedBot, x0: number, z0: number, x1: number, z1: number) => { const t = b.tile(); return t.x >= x0 && t.x <= x1 && t.z >= z0 && t.z <= z1; };
const in53W = (b: SpeedBot) => inBox(b, 3392, 9600, 3455, 9663) && b.tile().x >= 3405 && b.tile().z <= 9628;
const in53 = (b: SpeedBot) => inBox(b, 3392, 9600, 3455, 9663);
const in4371 = (b: SpeedBot) => inBox(b, 2752, 4544, 2815, 4607);
const in4270 = (b: SpeedBot) => inBox(b, 2688, 4480, 2751, 4543);
const in4370 = (b: SpeedBot) => inBox(b, 2752, 4480, 2815, 4543);

/** Track carts (npcs 1545-1548) shuttle 1 tile/tick and block the single-file corridor; whoever stands right in front of
 *  one is pushed a tile along (+0-2 damage half the time; hauntedmine_cart.rs2). Cart 1545 runs x=2727, z 4491..4509
 *  (measured: period ~38 t, pauses at both ends), and the corridor (the only way to region A) has three side alcoves
 *  (probe-side.ts): (2728,4503), (2726,4502), (2726,4496); the ends are (2728,4510) and (2726,4489). We hop alcove to
 *  alcove: a hop is safe when the cart is behind us (we run 2 tiles/tick, it walks 1), or beyond the hop's end and either
 *  moving away or too far to meet us. */
const CORRIDOR = [{ x: 2726, z: 4489 }, { x: 2726, z: 4496 }, { x: 2728, z: 4503 }, { x: 2728, z: 4510 }];
async function crossCorridor(bot: SpeedBot, south: boolean): Promise<void> {
    const stops = south ? CORRIDOR.slice().reverse() : CORRIDOR.slice();
    // walk to the start end
    await walkOp(bot, stops[0]!, null, () => false, { maxTicks: 120 });
    let prev = -1;
    for (let i = 1; i < stops.length; i++) {
        const from = stops[i - 1]!, to = stops[i]!, s = south ? -1 : 1;
        const need = Math.ceil(Math.abs(to.z - from.z) / 2) + 2;
        for (let k = 0; k < 120; k++) {
            const c = npcsOf(bot, 1545)[0];
            if (!c) break;
            const dir = prev < 0 ? 0 : Math.sign(c.z - prev); prev = c.z;
            const behind = (c.z - from.z) * s < 0;
            const beyond = (c.z - to.z) * s > 0;
            const away = dir === s;
            if (k > 0 && (behind || (beyond && (away || (c.z - to.z) * s >= need + 1)))) break;
            await bot.tick(1);
        }
        const r = await walkOp(bot, to, null, () => false, { maxTicks: 30 });
        if (!r && cheb(bot.tile(), to) > 0) { i = Math.max(0, i - 2); continue; }   // pushed back: retry from the stop before
    }
}
/** Cart 1548 shuttles x=2739, z 4528..4531 (period ~12 t, measured) across the way from 42_70 north (2733,4535) to the
 *  ladder down to region B (2732,4529); (2739,4530) has no side exit. Wait off the track at (2738,4533) until the cart
 *  heads south at z 4529 (it then pauses at 4528), and run 4532 -> 4529 -> (2738,4528) behind it. */
async function passCart1548(bot: SpeedBot): Promise<void> {
    const past = () => bot.tile().z <= 4528 && bot.tile().x <= 2738;
    for (let attempt = 0; attempt < 6 && !past(); attempt++) {
        await walkOp(bot, { x: 2738, z: 4533 }, null, () => false, { maxTicks: 60 });
        let prev = -1;
        for (let k = 0; k < 40; k++) {
            const c = npcsOf(bot, 1548)[0]; if (!c) break;
            if (prev === 4530 && c.z === 4529) break;
            prev = c.z; await bot.tick(1);
        }
        bot.sendRoute([{ x: 2739, z: 4532 }, { x: 2739, z: 4529 }, { x: 2738, z: 4528 }], false);
        await bot.until(past, 8);
    }
    if (!past()) fail(bot, 'cart 1548 corridor');
}
async function climb(bot: SpeedBot, id: number, x: number, z: number, done: () => boolean, label: string): Promise<void> {
    const l = locAt(id, x, z, 0);
    if (!(await opLocReach(bot, l, 1, done, { maxTicks: 300, every: 8 }))) fail(bot, label);
    if (bot.chatModalId !== -1 && !inDialog(bot)) dismiss(bot);
}

async function body(bot: SpeedBot, o: HmOpts, at: (k: string) => void): Promise<boolean> {
    let skipping = !!o.from;
    const P = (name: string) => { if (skipping && name === o.from) skipping = false; return !skipping; };
    const obstacle = locAt(4918, 3445, 3236, 0);
    // the cart barrier: climbing from the east side (3446,3236) lands west (3444,3236), next to the secondary entrance
    // (hauntedmine_locs.rs2:1-4: two tiles in the direction player -> cart)
    const southOfCarts = () => surface(bot) && inBox(bot, 3436, 3229, 3444, 3238);
    const overCarts = async () => { if (surface(bot) && !southOfCarts()) { if (!(await opLocReach(bot, obstacle, 1, southOfCarts, { maxTicks: 120, every: 6 }))) fail(bot, 'obstacle cart'); } };

    if (P('zealot')) {
        const r = [R, R, M4[0]!, R, R, M3[0]!, R, R, M2[0]!, R, ...Array(11).fill(R), M4[0]!, R, R, R] as FTok[];
        await talkAt(bot, ZEALOT, { x: 3444, z: 3257 }, r, {
            done: () => bot.dialogOptions().some(x => /Can I borrow your key/.test(x.text)),
            answers: [/^I follow the path of Saradomin/, /^I come seeking challenges/, /^What quest is that then/, /^Is there any other way into the mines/], maxTicks: 40, label: 'zealot',
        });
        if (!bot.dialogOptions().some(x => /Can I borrow your key/.test(x.text))) fail(bot, 'zealot: key not heard about');
        dismiss(bot); await bot.tick(1);
        for (let k = 0; k < 4 && !has(bot, 'hauntedmine_lift_key'); k++) {
            const n = npcsOf(bot, ZEALOT)[0]; if (!n) fail(bot, 'zealot gone');
            routeNextTo(bot, n); bot.opNpc(n.idx, 3); bot.queueFlush();
            await bot.until(() => has(bot, 'hauntedmine_lift_key'), 8);
        }
        if (!has(bot, 'hauntedmine_lift_key')) fail(bot, 'no lift key');
        at('stage1 key');
    }
    if (P('toA')) {
        // surface -> back entrance 2 (3429,3225) -> 53_150 west -> 43_71 (2782,4569) -> 42_70 S -> region A (2789,4486)
        // the back-entrance area is not walkable from the zealot side: secondary entrance -> 53_150 east -> crawl out at
        // back entrance 1 (3404,9631 -> 3429,3233) -> crawl in at back entrance 2 (3429,3225 -> 3409,9623) -> 53_150 west
        await overCarts();
        if (surface(bot)) await climb(bot, 4913, 3440, 3232, () => in53(bot), 'secondary entrance');
        if (in53(bot) && !in53W(bot)) await climb(bot, 4921, 3404, 9631, () => surface(bot), 'back entrance 1 out');
        if (surface(bot)) await climb(bot, 4915, 3429, 3225, () => in53(bot), 'back entrance 2');
        if (in53(bot)) await climb(bot, 4965, 3422, 9625, () => in4371(bot), 'ladder 53_150 west');
        if (in4371(bot)) await climb(bot, 4969, 2798, 4567, () => in4270(bot), 'ladder 43_71 west');
        if (in4270(bot)) { await crossCorridor(bot, true); await climb(bot, 4967, 2725, 4486, () => in4370(bot), 'ladder 42_70 south'); }
        at('regionA');
    }
    if (P('puzzle')) {
        await solvePoints(bot, at);
        at('fungus sent');
    }
    if (P('toC')) {
        // A -> up to 53_150 west -> crawl out (back entrance 2) -> crawl in back entrance 1 (3430,3233) -> 53_150 east
        // -> 43_71 (2773,4577) -> 42_70 N (2733,4535) -> region C (2774,4540)
        if (in4370(bot)) await climb(bot, 4968, 2789, 4486, () => in4270(bot), 'ladder A up');
        if (in4270(bot)) { await crossCorridor(bot, false); await climb(bot, 4970, 2734, 4503, () => in4371(bot), 'ladder 42_70 S up'); }
        if (in4371(bot)) await climb(bot, 4966, 2782, 4569, () => in53(bot), 'ladder 43_71 W up');
        if (in53(bot)) await climb(bot, 4922, 3408, 9623, () => surface(bot), 'back entrance 2 out');
        if (surface(bot)) await climb(bot, 4914, 3430, 3233, () => in53(bot), 'back entrance 1');
        if (in53(bot)) await climb(bot, 4965, 3413, 9633, () => in4371(bot), 'ladder 53_150 east');
        if (in4371(bot)) await climb(bot, 4969, 2797, 4599, () => in4270(bot), 'ladder 43_71 east');
        if (in4270(bot)) await climb(bot, 4967, 2710, 4540, () => in4370(bot), 'ladder to C');
        at('regionC');
        const end = locAt(4974, 2774, 4537, 0);
        for (let k = 0; k < 4 && !has(bot, 'glowing_fungus'); k++) {
            if (!(await opLocReach(bot, end, 1, () => inDialog(bot) || has(bot, 'glowing_fungus'), { maxTicks: 30 }))) continue;
            await talk(bot, [], [M2[0]!], { noOp: true, done: () => has(bot, 'glowing_fungus'), answers: [/^Take it/], maxTicks: 10, label: 'end cart' });
        }
        if (!has(bot, 'glowing_fungus')) fail(bot, 'no fungus in the end cart');
        dismiss(bot);
        at('fungus');
    }
    if (P('lift')) {
        // C -> 42_70 N -> region B (2796,4529) -> valve (key) -> lift
        if (in4370(bot) && inBox(bot, 2765, 4534, 2785, 4543)) await climb(bot, 4968, 2774, 4540, () => in4270(bot), 'ladder C up');
        if (in4270(bot)) { if (bot.tile().z > 4528) await passCart1548(bot); await climb(bot, 4967, 2732, 4529, () => in4370(bot), 'ladder to B'); }
        const valve = locAt(4924, 2808, 4496, 0);
        const since = bot.tickCount;
        const opened = () => msgsSince(bot, since).some(m => /You open the valve|already open/.test(m));
        for (let k = 0; k < 4 && !opened(); k++) {
            dismiss(bot);
            const go = () => { const s = bot.slot('hauntedmine_lift_key'); if (s < 0) return false; bot.useItemOnLoc(valve.x, valve.z, valve.id, objId('hauntedmine_lift_key'), s); };
            await walkOp(bot, { x: 2808, z: 4495 }, go, opened, { maxTicks: 200 });
        }
        if (!opened()) fail(bot, 'valve');
        at('valve');
        const lift = locAt(4937, 2807, 4494, 0);
        if (!(await opLocReach(bot, lift, 1, () => inBox(bot, 2688, 4416, 2751, 4479), { maxTicks: 60 }))) fail(bot, 'lift');
        at('lift');
    }
    if (P('stairs')) {
        dismiss(bot);
        const stairs = locAt(4971, 2746, 4436, 0);
        // forceapproach=north rotates with the loc (angle 1 -> from the EAST): stand at (2750,4437)
        if (!(await opUntil(bot, stairs, 1, { x: 2750, z: 4437 }, () => inBox(bot, 2752, 4416, 2815, 4479), { maxTicks: 200 }))) fail(bot, 'dark stairs');
        if (seenText(bot, /kind of dark down here/)) fail(bot, 'dark stairs without light (fungus lost?)');
        at('boss level');
    }
    let stop: (() => void) | null = null;
    if (P('boss')) {
        // the room's pickaxe attack is the only hazard a prayer softens: Protect from Missiles caps it at 10 instead of 15
        // (hauntedmine_boss_ghost.rs2 boss_pickaxe_attack)
        // TEST (fix 282b proof): HM_TEST_BAIL=1 drops every food before the fight -> the bail at <= 50% hp, alive
        if (process.env.HM_TEST_BAIL === '1') { const f = FOODS.filter(x => has(bot, x)); if (f.length) { await bot.dropAll(f); console.log(`[hm] TEST bail: dropped ${f.join(',')}`); } }
        stop = prayGuard(bot, 'protectfrommissiles');
        try { await bossFight(bot, at); } finally { stop(); }
    }
    if (P('reward')) {
        const keyNpc = () => npcsOf(bot, BOSS_KEY)[0];
        // session 11 fix 274 (qx26 'no reward key' x2 at 2794,4462): the boss died with us NORTH of the key's crate
        // (2788,4462); routeNextTo plans to the crate tile itself (blocked), the route ended at 2794,4462 and the server's
        // naive opnpc approach never got adjacent: 6 + 6 tries without one op landing. Walk to the proven stand tile SOUTH
        // of the crate (2788,4454, where the take that started the fight stands) with a full walkOp first, then op.
        // HM_KEY_STAND=0 reverts; HM_TEST_NORTH=1 (test only) walks to 2794,4462 first to reproduce the qx26 spot.
        const STAND = { x: 2788, z: 4454 };
        if (process.env.HM_TEST_NORTH === '1' && !has(bot, 'hauntedmine_reward_key')) {
            await walkOp(bot, { x: 2794, z: 4462 }, null, () => cheb(bot.tile(), { x: 2794, z: 4462 }) === 0, { maxTicks: 40 });
            console.log(`[hm] TEST: at ${bot.tile().x},${bot.tile().z} before the reward key`);
        }
        // fix 274b (fork qyo02, pack 28/28: every take showed the 'You take the key' page 356 and no key): with a full pack
        // inv_add drops the key on the floor (InvOps INV_ADD overflow -> addObj, 200 t) and npc_del + respawnrate=1 puts the
        // key npc straight back, so the loop took 6 keys onto the floor. Free a slot first (eat a shark when hurt, else drop
        // mortton leftovers/junk, else a shark) and pick up a reward key lying near us. HM_KEY_SLOT=0 reverts.
        const SLOT = process.env.HM_KEY_SLOT !== '0';
        const freeSlot = async () => {
            if (!SLOT || bot.free() > 0) return;
            const hp = bot.stat('hitpoints');
            if (has(bot, 'shark') && hp.cur < hp.level - 20) { bot.opHeld1(objId('shark'), bot.slot('shark')); bot.queueFlush(); await bot.until(() => bot.free() > 0, 3); }
            const junk = ['rotten_food', 'vial_empty', 'damp_tinderbox', 'serum_book', 'ashes', 'tarrominvial', 'shade_bones1', 'shark'].find(x => has(bot, x));
            if (bot.free() === 0 && junk) { await bot.dropAll([junk]); console.log(`[hm] pack full: dropped ${junk} for the reward key (free ${bot.free()})`); }
        };
        // the 'You take the key' mesbox (356) opens a tick AFTER the key lands (p_delay(0)); until continued, the suspended
        // script swallows inventory ops (a drop right after the take was discarded twice): wait for it, then continue it
        const settlePage = async () => {
            await bot.until(() => bot.chatModalId !== -1, 3);
            for (let j = 0; j < 4 && bot.chatModalId !== -1; j++) { if (inDialog(bot)) bot.resumeDialogPage(); else dismiss(bot); bot.queueFlush(); await bot.tick(1); }
        };
        const floorKey = async () => {
            if (!SLOT || has(bot, 'hauntedmine_reward_key') || !bot.findGroundItem(objId('hauntedmine_reward_key'), 6)) return;
            // the 'You take the key' page (356) blocks every op until continued
            await settlePage();
            await freeSlot(); await pickup(bot, 'hauntedmine_reward_key', 6, 12);
            console.log(`[hm] reward key from the floor: ${has(bot, 'hauntedmine_reward_key')}`);
        };
        await floorKey();
        for (let k = 0; k < 6 && !has(bot, 'hauntedmine_reward_key'); k++) {
            dismiss(bot);
            await freeSlot();
            const n = keyNpc(); if (!n) { await walkOp(bot, STAND, null, () => !!keyNpc(), { near: 2, maxTicks: 40 }); await bot.tick(1); continue; }
            if (process.env.HM_KEY_STAND !== '0' && cheb(bot.tile(), STAND) > 0 && Math.abs(bot.tile().x - n.x) + Math.abs(bot.tile().z - n.z) !== 1) {
                await walkOp(bot, STAND, null, () => cheb(bot.tile(), STAND) === 0, { maxTicks: 40 });
            }
            routeNextTo(bot, n); bot.opNpc(n.idx, 1); bot.queueFlush();
            const tk = bot.tickCount;
            await bot.until(() => has(bot, 'hauntedmine_reward_key') || inDialog(bot), 10);
            if (!has(bot, 'hauntedmine_reward_key')) console.log(`[hm] reward key try ${k}: key npc ${n.x},${n.z} d${n.d} me ${bot.tile().x},${bot.tile().z} chat ${bot.chatModalId} msgs ${msgsSince(bot, tk).join(' / ').slice(0, 160)}`);
            if (inDialog(bot)) { bot.resumeDialogPage(); bot.queueFlush(); await bot.tick(1); }
            await floorKey();
        }
        // TEST (fix 274b proof): HM_TEST_FLOOR=1 drops the taken key once (as the full-pack overflow leaves it) -> floorKey
        if (process.env.HM_TEST_FLOOR === '1' && has(bot, 'hauntedmine_reward_key')) {
            await settlePage();
            await bot.dropAll(['hauntedmine_reward_key']); await bot.tick(2);
            console.log(`[hm] TEST: reward key dropped (held ${has(bot, 'hauntedmine_reward_key')})`);
            await floorKey();
        }
        if (!has(bot, 'hauntedmine_reward_key')) fail(bot, 'no reward key');
        at('reward key');
        // the reward doors face the WEST landing, which the boss room does not reach: out the boss door, up the east light
        // stairs (2812,4452 -> 2750,4437), along the flooded level to the west dark stairs (2692,4436; forceapproach rotates
        // to west: stand 2691,4437; no fungus needed from stage 8, darkstairs.rs2:1-12) -> (2758,4454)
        const boss = locAt(4962, 2799, 4453, 0);
        if (bot.tile().x >= 2775 && bot.tile().z > 4416 && bot.tile().z < 4480) {
            // the boss door may stand open (another leaf id): walk through first, op it only if that fails
            if (bot.tile().x <= 2798) await walkOp(bot, { x: 2801, z: 4453 }, null, () => bot.tile().x >= 2799, { maxTicks: 40 });
            if (bot.tile().x <= 2798 && !(await opLocReach(bot, boss, 1, () => bot.tile().x >= 2799, { maxTicks: 60 }))) fail(bot, 'boss door (out)');
            const up = locAt(4973, 2812, 4452, 0);
            if (!(await opLocReach(bot, up, 1, () => inBox(bot, 2688, 4416, 2751, 4479), { maxTicks: 60 }))) fail(bot, 'east light stairs');
        }
        if (inBox(bot, 2688, 4416, 2751, 4479)) {
            const west = locAt(4971, 2692, 4436, 0);
            if (!(await opUntil(bot, west, 1, { x: 2691, z: 4437 }, () => inBox(bot, 2752, 4416, 2815, 4479), { maxTicks: 200 }))) fail(bot, 'west dark stairs');
        }
        at('west landing');
        const door = locAt(4963, 2773, 4450, 0);
        if (!(await opLocReach(bot, door, 1, () => bot.tile().z < 4450, { maxTicks: 80 }))) fail(bot, 'reward door');
        at('stage10');
    }
    // the crystal
    // fix 274c (a full pack fails with 'crystal not cut'): the cut needs a free slot for the crystal piece (hauntedmine_crystals.rs2
    // :44-47 'not enough inventory space', a game message the cut predicate never sees). Free one first. HM_KEY_SLOT=0 reverts.
    if (process.env.HM_KEY_SLOT !== '0' && bot.free() === 0) {
        const junk = ['rotten_food', 'vial_empty', 'damp_tinderbox', 'serum_book', 'ashes', 'tarrominvial', 'shade_bones1', 'hauntedmine_lift_key', 'shark'].find(x => has(bot, x));
        if (junk) { await bot.dropAll([junk]); console.log(`[hm] pack full: dropped ${junk} for the crystal (free ${bot.free()})`); }
    }
    const crystal = locAt(4928, 2788, 4428, 0);
    if (!(await opLocReach(bot, crystal, 1, () => seenText(bot, /Haunted Mine Quest/), { maxTicks: 120, every: 6 }))) fail(bot, 'crystal not cut');
    at('complete');
    void reg; void in53W; void waitText;
    return seenText(bot, /Haunted Mine Quest/);
}

/** The points puzzle: test without the fungus, fix one lever per outcome, then send the fungus. */
async function solvePoints(bot: SpeedBot, at: (k: string) => void): Promise<void> {
    const info = locAt(4949, 2769, 4522, 0), cart = locAt(4974, 2778, 4506, 0);
    let sinkAt = '';
    const prev = bot.onLocZoneChange;
    bot.onLocZoneChange = (level, x, z, locId) => { prev?.(level, x, z, locId); if (locId === 4945) sinkAt = `${x},${z}`; };
    const openControls = async () => {
        if (bot.mainModalId === CONTROLS) return;
        dismiss(bot);
        if (!(await opLocReach(bot, info, 1, () => bot.mainModalId === CONTROLS, { maxTicks: 120 }))) fail(bot, 'points controls');
    };
    const pull = async (k: number) => {
        const c = LEVERS[k]!; const l = { ...locAt(4949 + k, c.x, c.z, 0) };
        const since = bot.tickCount;
        if (bot.mainModalId !== -1) { bot.closeModal(); bot.queueFlush(); await bot.tick(1); }
        if (!(await opLocReach(bot, l, 1, () => msgsSince(bot, since).some(m => /You pull the lever/.test(m)), { maxTicks: 120 }))) fail(bot, `lever ${k}`);
    };
    /** run the cart once: 'success' | 'returned' | a SINKS key */
    const test = async (): Promise<string> => {
        await openControls();
        sinkAt = ''; const since = bot.tickCount;
        bot.ifButton(TEST_BUTTON); bot.queueFlush();
        await bot.until(() => msgsSince(bot, since).some(m => /sunk|come right back/.test(m)) || bot.tickCount - since > 16, 18);
        const m = msgsSince(bot, since).join(' | ');
        if (/come right back/.test(m)) return 'returned';
        if (/sunk/.test(m)) return SINKS[sinkAt] ?? `sink?${sinkAt}`;
        return 'success';
    };
    // the fungus first (the pool is next to the ladder): it is only put in the cart once the route is right
    if (!has(bot, 'glowing_fungus')) {
        // the pool's edge fungi (2792,4494)/(2793,4494) answer from region A (2792,4495); picked ones respawn later
        for (const c of [{ id: 4933, x: 2792, z: 4494 }, { id: 4932, x: 2793, z: 4494 }, { id: 4932, x: 2793, z: 4493 }]) {
            if (has(bot, 'glowing_fungus')) break;
            const live = bot.liveLocs.get(`0,${c.x},${c.z}`); if (live !== undefined && live !== c.id) continue;
            let l; try { l = locAt(c.id, c.x, c.z, 0); } catch { continue; }
            await opLocReach(bot, l, 1, () => has(bot, 'glowing_fungus'), { maxTicks: 40 });
        }
        if (!has(bot, 'glowing_fungus')) fail(bot, 'no glowing fungus');
    }
    at('fungus picked');
    // candidate states over the 5 bits that matter (b, a, c, d, j); every outcome prunes them, then we flip the levers
    // that turn the first remaining candidate into the target (b1 d0 a1 c0 j0)
    type St = { b: number; a: number; c: number; d: number; j: number };
    const outcome = (x: St) => !x.b ? 'b0' : x.d ? 'd1|j1' : !x.a ? 'returned' : x.c ? 'c1' : x.j ? 'd1|j1' : 'success';
    let cands: St[] = [];
    for (let m = 0; m < 32; m++) cands.push({ b: m & 1, a: (m >> 1) & 1, c: (m >> 2) & 1, d: (m >> 3) & 1, j: (m >> 4) & 1 });
    const target: St = { b: 1, a: 1, c: 0, d: 0, j: 0 };
    const leverOf: Record<keyof St, number> = { b: B, a: A, c: C, d: D, j: J };
    let tests = 0;
    for (;;) {
        if (++tests > 10) fail(bot, 'points puzzle: no solution after 10 tests');
        const r = await test();
        cands = cands.filter(x => outcome(x) === r);
        console.log(`[hm] points test ${tests}: ${r} (${cands.length} states left)`);
        if (r === 'success') break;
        if (!cands.length) fail(bot, `points: no state explains ${r}`);
        const c0 = cands[0]!;
        const flips = (Object.keys(target) as Array<keyof St>).filter(k => c0[k] !== target[k]);
        // pull in a short walking order: the lever-5 group first (b, a, c, d), then j at the far group
        for (const k of flips) await pull(leverOf[k]);
        cands = cands.map(x => { const y = { ...x }; for (const k of flips) y[k] ^= 1; return y; });
    }
    // send the fungus
    bot.closeModal(); bot.queueFlush(); await bot.tick(1);
    if (!(await useOnLocUntil(bot, 'glowing_fungus', cart, { x: 2778, z: 4505 }, () => !has(bot, 'glowing_fungus'), { maxTicks: 60 }))) fail(bot, 'fungus into the cart');
    const r = await test();
    if (r !== 'success') fail(bot, `points: the fungus run gave ${r}`);
    for (let k = 0; k < 4 && inDialog(bot); k++) { bot.resumeDialogPage(); bot.queueFlush(); await bot.tick(1); }
    bot.closeModal(); bot.queueFlush(); await bot.tick(1);
    bot.onLocZoneChange = prev;
    at(`points solved in ${tests} tests`);
}

/** Take the key: Treus Dayth appears and moves between room sections (faded = unattackable); attack him whenever he
 *  is solid. Room hazards (carts, cranes, pickaxes) hit up to 10-15 a third of the time; eat at 50%. */
async function bossFight(bot: SpeedBot, at: (k: string) => void): Promise<void> {
    const door = locAt(4962, 2799, 4453, 0);
    // session 11 fix 282b (qyo09 / qyr05 seed 10305: the first attempt burned 12 sharks in 900 t, the retry started in the
    // room at 47 hp with 3 and DIED): the room hazards only hurt inside the fight zone (hauntedmine_damage_queue returns
    // unless ~hauntedmine_in_bossfight = x 2775..2798), so leave through the boss door (x > 2798) before failing: out of
    // food at <= 50% hp, or the time cap. A retry with no food and < 60% hp fails at the door instead of walking in to
    // die. HM_BAIL=0 reverts.
    const BAIL = process.env.HM_BAIL !== '0';
    const food = () => FOODS.reduce((s, f) => { try { return s + bot.count(f); } catch { return s; } }, 0);
    const hpPct = () => { const h = bot.stat('hitpoints'); return h.cur / Math.max(1, h.level); };
    const bail = async (why: string): Promise<never> => {
        console.log(`[hm] bail out of Treus's room (${why}): hp ${bot.stat('hitpoints').cur}, food ${food()}`);
        if (bot.tile().x <= 2798) {
            dismiss(bot);
            if (!(await opLocReach(bot, door, 1, () => bot.tile().x > 2798, { maxTicks: 60 }))) await walkOp(bot, { x: 2801, z: 4453 }, null, () => bot.tile().x > 2798, { maxTicks: 40 });
        }
        return fail(bot, `${why} (bailed out alive at ${bot.tile().x},${bot.tile().z}, hp ${bot.stat('hitpoints').cur}, food ${food()})`);
    };
    if (BAIL && food() === 0 && hpPct() < 0.6) {
        if (bot.tile().x <= 2798 && inBox(bot, 2775, 4439, 2798, 4470)) await bail('Treus: no food and hp < 60%');
        fail(bot, `Treus: no food and hp ${bot.stat('hitpoints').cur} < 60%: not entering`);
    }
    if (bot.tile().x > 2798) { if (!(await opLocReach(bot, door, 1, () => bot.tile().x <= 2798, { maxTicks: 60 }))) fail(bot, "boss door"); }
    const t0 = bot.tickCount;
    // "As you make the killing strike, the machinery|within the room falls silent." is a mesbox wrapped over lines
    // (hauntedmine_boss_ghost.rs2 boss_death): match either half
    const dead = () => msgsSince(bot, t0).some(m => /machinery|killing strike/i.test(m)) || seenText(bot, /falls silent|killing strike/);
    // start: take the key
    for (let k = 0; k < 4 && !npcsOf(bot, BOSS).length && !dead(); k++) {
        const n = npcsOf(bot, BOSS_KEY)[0];
        if (!n) { await walkOp(bot, { x: 2788, z: 4454 }, null, () => npcsOf(bot, BOSS_KEY).length > 0, { near: 2, maxTicks: 40 }); await bot.tick(1); continue; }
        dismiss(bot); routeNextTo(bot, n); bot.opNpc(n.idx, 1); bot.queueFlush();
        await bot.until(() => npcsOf(bot, BOSS).length > 0 || inDialog(bot), 10);
        for (let j = 0; j < 6 && inDialog(bot); j++) { bot.resumeDialogPage(); bot.queueFlush(); await bot.tick(1); }
    }
    at('boss');
    let target = -1, last = -99, lastSeen = bot.tickCount, lastProbe = -99, lastMove = bot.tickCount, lastTile = '';
    // session 11 fix 400a (probe gate, see the probe line): ctrT = the last tick we were NOT at the centre with Treus unseen
    const PROBE_CTR = process.env.HM_PROBE_CTR !== '0', PROBE_CTR_TEST = process.env.HM_PROBE_CTR_TEST === '1';
    let ctrT = bot.tickCount;
    // session 11 fix 380 (qx247m / qx284m 'Treus Dayth not dead after 900 t'; 23/211 r-qx fights had Treus vanish with no kill
    // text and the probe's key op respawn him at 100 hp (boss_key opnpc1: stage still boss_found, boss gone -> npc_add): those
    // fights ran 583-989 t vs ~430, and all 6 'not dead after 900 t' fails are among them): a hit queues his ai_queue1 hop (50%,
    // boss_move: changetype_keepall to hauntedmine_boss_ghost_faded for the run) and our next cast, fired 1-2 t later (5 t
    // cadence, 3-4 t flight), lands while he is faded; if it kills, ai_queue3 runs for the FADED type = the default npc_death
    // (only [ai_queue3,hauntedmine_boss_ghost] queues boss_death): no stage 9, no mesbox. 380: once his hitsplat hp is <= one
    // hit, hold attacks until 3 t after his last hit and his last move / type change (a move click drops a queued cast), so
    // the kill lands while he stands solid; gone at lethal hp -> probe after 4 t. HM_FADE=0 reverts; HM_FADE_TEST=1 holds at
    // any hp and logs every cast against his last hit / move.
    const FADE = process.env.HM_FADE !== '0', FADE_TEST = process.env.HM_FADE_TEST === '1';
    let fIdx = -1, fHits = 0, fHitT = -99, fKey = '', fKeyT = -99, fHp = -1, fHold = false, fXp = -1;
    // session 11 fix 403 (zombie discipline, the gate after the 380 hold): state + the safe spots 4 / 5 = boss_move ends
    // map_findsquare_inzone(0_43_69_27_38, 0_43_69_29_38) and (0_43_69_35_27, 0_43_69_35_29) (hauntedmine_boss_ghost.rs2:330-341)
    const ZOMB = process.env.HM_ZOMBIE403 !== '0', ZOMB_TEST = process.env.HM_ZOMBIE403_TEST === '1';
    const Z403C = ZOMB && process.env.HM_ZOMBIE403C !== '0', Z403C_TEST = process.env.HM_ZOMBIE403C_TEST === '1';
    const Z403D = ZOMB && process.env.HM_ZOMBIE403D !== '0';   // session 11 fix 403d (REACH not wiped by 403 waits)
    let zT = -1, zLast = -99, zKeyT = -99, zHops = 0, zStop = false, zGo = true;
    const hmSafe = (x: number, z: number) => (x >= 2778 && x <= 2782 && z >= 4453 && z <= 4455) || (x >= 2786 && x <= 2788 && z >= 4442 && z <= 4445);
    // second proof: once he is gone for 30 t, try the key (stage >= 9 hands it over; alive he refuses: boss_key opnpc1)
    // fix 282c (fork qyr13 seed 10603: Treus died unnoticed (no 'killing strike' text seen), then ~450 t idle at the centre
    // probing the key every 20 t: INFERRED pack 28/28, each take dropped the key on the floor (fix 274b); the retry took it
    // in 11 t): before a probe, free a slot (eat when hurt, else drop junk; never a shark here: he may still be up) and pick
    // up a reward key lying near us. HM_PROBE=0 reverts.
    const PROBE = process.env.HM_PROBE !== '0';
    const probeKey = async () => {
        if (PROBE) {
            console.log(`[hm] probe key: unseen ${bot.tickCount - lastSeen} t, free ${bot.free()}, floor key ${!!bot.findGroundItem(objId('hauntedmine_reward_key'), 6)}, me ${bot.tile().x},${bot.tile().z}, msgs ${msgsSince(bot, bot.tickCount - 20).slice(-2).join(' / ').slice(0, 120)}`);
            if (bot.chatModalId !== -1) { if (inDialog(bot)) bot.resumeDialogPage(); else dismiss(bot); bot.queueFlush(); await bot.tick(1); }
            if (bot.free() === 0) {
                const h = bot.stat('hitpoints'), f = FOODS.find(x => has(bot, x));
                if (f && h.cur < h.level - 20) { bot.opHeld1(objId(f), bot.slot(f)); bot.queueFlush(); await bot.until(() => bot.free() > 0, 3); }
                const junk = ['rotten_food', 'vial_empty', 'damp_tinderbox', 'serum_book', 'ashes', 'tarrominvial', 'shade_bones1'].find(x => has(bot, x));
                if (bot.free() === 0 && junk) { await bot.dropAll([junk]); console.log(`[hm] probe: pack full, dropped ${junk}`); }
            }
            if (bot.free() > 0 && bot.findGroundItem(objId('hauntedmine_reward_key'), 6)) {
                await pickup(bot, 'hauntedmine_reward_key', 6, 12);
                console.log(`[hm] probe: reward key from the floor: ${has(bot, 'hauntedmine_reward_key')}`);
                if (has(bot, 'hauntedmine_reward_key')) return;
            }
        }
        const k = npcsOf(bot, BOSS_KEY)[0]; if (!k) return; routeNextTo(bot, k); bot.opNpc(k.idx, 1); bot.queueFlush();
    };
    // session 11 fix 282a (qyo09 / qyr05 seed 10305 'Treus Dayth not dead after 900 t': from +420 t to the cap he stood at
    // 2793,4452 (spot 0, on the cart track x=2793) with us at 2793,4454, d2, no combat xp for 480 t): attackFrom always
    // picks the SHORTEST cardinal neighbour, (2793,4453), which a mine cart (hauntedmine_boss_cart, blockwalk=all) holds
    // (INFERRED there; fork qyr06 logged a cart on 2793,4453 at the next stall) ; the step is refused, the OPNPC2 approach
    // never completes, and he only moves when hit (ai_queue1). 282a:
    // no combat xp and he has not moved for 16 t while he is within 2 -> walk to another cardinal neighbour no npc stands
    // on (path planned with the npcs as blockers), tried ones rested 60 t. HM_REACH=0 reverts.
    const REACH = process.env.HM_REACH !== '0';
    const cxp = () => ['attack', 'strength', 'defence', 'hitpoints', 'magic'].reduce((s, k) => s + bot.stat(k as any).xp, 0);
    let progXp = cxp(), progT = bot.tickCount, progKey = '';
    const tried = new Map<string, number>();
    while (!dead() && !has(bot, 'hauntedmine_reward_key')) {
        { const k = `${bot.tile().x},${bot.tile().z}`; if (k !== lastTile) { lastTile = k; lastMove = bot.tickCount; } }
        if (npcsOf(bot, BOSS).length || cheb(bot.tile(), { x: 2788, z: 4456 }) > 2) ctrT = bot.tickCount;
        if (npcsOf(bot, BOSS).length) lastSeen = bot.tickCount;
        // session 11 fix 380 (gone at a lethal hp = died, solid (key) or faded (respawn): probe after 4 t, not 30)
        // session 11 fix 400a (qx403m: probes 1-2 fired while Treus was ALIVE out of our 15-tile view (hp 14 / 3, back with the
        // same hp 16 t later); the key's ~hauntedmine_boss_find looks only 10 tiles round 2788,4454, so with him on 2787,4443
        // (spot 5) a probe npc_adds a second 100-hp Treus): probe only after 3 t at the centre (2788,4456 +-2: every spot in
        // view) with him unseen (the centre walk below takes us there); 60 t unseen anywhere still probes. HM_PROBE_CTR=0 reverts.
        else if (bot.tickCount - lastSeen > (FADE && fHp >= 0 && fHp <= 35 ? 4 : 30) && bot.tickCount - lastProbe > 20
            && (!PROBE_CTR || bot.tickCount - ctrT >= 3 || bot.tickCount - lastSeen > 60)) { lastProbe = bot.tickCount; console.log(`[hm] 380: Treus gone ${bot.tickCount - lastSeen} t, last hp ${fHp}${PROBE_CTR ? `, 400a: centre ${bot.tickCount - ctrT} t` : ''}`); await probeKey(); }
        else if (PROBE_CTR_TEST && bot.tickCount - lastSeen === 5) console.log(`[hm] 400a TEST: probe deferred, me ${bot.tile().x},${bot.tile().z}, centre ${bot.tickCount - ctrT} t`);
        if (bot.tickCount - t0 > 900) { if (BAIL) await bail('Treus Dayth not dead after 900 t'); fail(bot, 'Treus Dayth not dead after 900 t'); }
        if (BAIL && food() === 0 && hpPct() <= 0.5) await bail('Treus: out of food');
        const lvl = levelUpOpen(bot);
        if (bot.chatModalId !== -1 && !lvl) { if (inDialog(bot) && !bot.dialogOptions().length) bot.resumeDialogPage(); else dismiss(bot); bot.queueFlush(); }
        const g = npcsOf(bot, 1540)[0];
        // session 11 fix 380 (his hitsplats / tile / type, solid or faded)
        const gb = npcsOf(bot, BOSS)[0];
        if (gb) {
            const e: any = (bot as any).npcs[gb.idx];
            if (gb.idx !== fIdx) { fIdx = gb.idx; fHits = e?.hitCount ?? 0; fKey = ''; fHp = -1; }
            // session 11 fix 403c (qx468m 900-t bail with 403 on: '403 zombie' re-fired at +326 with Treus still on spot 4
            // 2780,4454, no hop and no death = no real hit; he had been out of our view (> 15 tiles, rsbuf info.ts:310) and
            // came back: the client re-acquires the slot (LeanNpc.reset: hitCount 0, lastHitCycle -1), 0 !== fHits counted as a
            // fresh hp-0 splat, restarted 403's age (40 t of free attacks) and opened the 3-8 t gap before the gate; a cast
            // knocked him off spot 4, and the chain ran to a zombie-hit deletion (+576), a respawn and the cap. Same in qx471m
            // +241.) A count that DROPS with no splat seen is a view re-entry, not a hit: resync, keep fHitT (right after a
            // probe it is the probe's 100-hp npc_add: forget fHp). HM_ZOMBIE403C=0 reverts; HM_ZOMBIE403C_TEST=1 logs it.
            if (e && e.hitCount !== fHits) {
                const reent = Z403C && e.hitCount < fHits && e.lastHitCycle < 0;
                if (reent && bot.tickCount - lastProbe <= 15) fHp = -1;
                if (Z403C_TEST && reent) console.log(`[hm] 403c TEST +${bot.tickCount - t0}: Treus back in view at ${gb.x},${gb.z} (hits ${fHits} -> ${e.hitCount}): not a hit${fHp < 0 ? ' (after a probe: hp reset)' : ''}`);
                fHits = e.hitCount; if (!reent) fHitT = bot.tickCount;
            }
            if (e && e.lastHitCycle >= 0) fHp = e.hpCur;
            const k = `${gb.x},${gb.z},${gb.type}`; if (k !== fKey) { fKey = k; fKeyT = bot.tickCount; }
        }
        if (REACH && g && g.d <= 2) {
            const xp = cxp(), key = `${g.idx}@${g.x},${g.z}`;
            if (xp !== progXp || key !== progKey) { progXp = xp; progKey = key; progT = bot.tickCount; }
            else if (bot.tickCount - progT >= 16) {
                const me = bot.tile();
                const occ = new Set<string>(); for (let i = 0; i < bot.npcCount; i++) { const q = bot.npcs[bot.npcIndices[i]!]; if (q) { const p = bot.npcTileOf(q); occ.add(`${p.x},${p.z}`); } }
                const opts = [[1, 0], [-1, 0], [0, 1], [0, -1]].map(([dx, dz]) => ({ x: g.x + dx!, z: g.z + dz! }))
                    .filter(t => !(t.x === me.x && t.z === me.z) && !occ.has(`${t.x},${t.z}`) && (tried.get(`${t.x},${t.z}`) ?? -99) < bot.tickCount - 60)
                    .map(t => { let p: Array<{ x: number; z: number }> = []; try { p = withNpcBlocks(bot, bot.minusedlevel, () => navSync().findLongPath(bot.minusedlevel, me.x, me.z, t.x, t.z, 60)); } catch { p = []; } const e = p[p.length - 1]; return { t, n: e && e.x === t.x && e.z === t.z ? p.length : 999 }; })
                    .filter(o => o.n < 999).sort((a, b) => a.n - b.n);
                console.log(`[hm] Treus at ${g.x},${g.z} d${g.d}: no hit / move for 16 t from ${me.x},${me.z}; npcs on ${[...occ].filter(k => { const [x, z] = k.split(',').map(Number); return cheb({ x: x!, z: z! }, g) <= 1; }).join(' ') || '-'}; reach ${opts.map(o => `${o.t.x},${o.t.z}(${o.n})`).join(' ') || 'none'}`);
                const pick = opts[0];
                if (pick) {
                    tried.set(`${pick.t.x},${pick.t.z}`, bot.tickCount);
                    await walkOp(bot, pick.t, () => { const q = npcsOf(bot, 1540)[0]; if (q) bot.opNpc(q.idx, 2); }, () => !npcsOf(bot, 1540).length || cxp() !== progXp, { maxTicks: 20 });
                }
                progT = bot.tickCount; target = -1; await bot.tick(1); continue;
            }
        }
        if (process.argv.includes("--laps") && (bot.tickCount - t0) % (bot.tickCount - t0 < 160 ? 2 : 15) === 0) console.log(`[boss +${bot.tickCount - t0}] ghost ${npcsOf(bot, BOSS).map(q => q.type + '@' + q.x + ',' + q.z + ' d' + q.d).join(' ')} me ${JSON.stringify(bot.pos())} hp ${bot.stat("hitpoints").cur} sharks ${bot.count("shark")} att ${bot.stat("attack").xp} msgs ${msgsSince(bot, bot.tickCount - 15).slice(-2).join(" / ")}`);
        // Crumble Undead (magic 39) hits him from range and almost always (magicdefence -5, undead=true;
        // crumble_undead.rs2), so no chasing after every hop; melee is the fallback
        const canCast = bot.stat('magic').cur >= 39 && bot.count('chaosrune') >= 1 && bot.count('earthrune') >= 2 && bot.count('airrune') >= 2;
        // session 11 fix 380 (the hold: one more hit may kill him -> only while he stands solid and still; 15 = crumble max, 35 melee)
        if (FADE_TEST) { const mx = bot.stat('magic').xp; if (fXp >= 0 && mx !== fXp) console.log(`[hm] 380 TEST cast +${bot.tickCount - t0}: Treus ${fKey} hp ${fHp}, since hit ${bot.tickCount - fHitT} t, since move ${bot.tickCount - fKeyT} t`); fXp = mx; }
        if (FADE && gb && (FADE_TEST || (fHp >= 0 && fHp <= (canCast ? 15 : 35))) && bot.tickCount - Math.max(fHitT, fKeyT) < 3) {
            if (!fHold) { fHold = true; bot.sendRoute([bot.tile()]); bot.queueFlush(); if (FADE_TEST || fHp <= 15) console.log(`[hm] 380 hold +${bot.tickCount - t0}: Treus ${fKey} hp ${fHp}`); }
            target = -1; await bot.tick(1); continue;
        }
        fHold = false;
        // session 11 fix 403 (qx403m / qx432m / qx445m 900-t bails + the qx445m retry DIED): a fatal hit that hops (ai_queue1 runs
        // before the damage) dies as the faded type (npc_default_death) and boss_move's next npc_delay overwrites that death
        // script's suspension: a ZOMBIE Treus, alive at hp 0; npc_default_damage ignores every hit at hp 0 (npc_combat.rs2:80)
        // until his +1 hp regen (Npc.processRegen, 100 undelayed turns), so our casts only burn runes and hop him, and the first
        // hit after the regen is a new lethal hit (~half die faded again). r-qx305-463: 39 zombie lives in 121 fights, 7 of the
        // 17 respawns (100 hp, +339 t) came from such a zombie hit; fatal splats on spots 4/5 gave stage 9 21/22 times
        // (spots 0-3: 49/93). 403: still up 8 t after an hp-0 splat, no kill text = zombie: off spots 4/5 attack as before for
        // 40 t (free hops), then a 4-t attack window per 15 t; on spot 4/5 hold until the regen is certain (110 t + 5 t per hop),
        // then strike; free after 260 t. HM_ZOMBIE403=0 reverts; HM_ZOMBIE403_TEST=1 logs every attack / wait switch.
        // session 11 fix 403c (2/2): an hp-0 splat on spot 4/5 -> the gate from 3 t, not 8 (in qx468m's 3-8 t gap a cast hopped
        // him off spot 4): by then he is dying (kill text ends the loop), deleted, or a zombie that a hit can only move away
        if (ZOMB && gb && fHp === 0 && fHitT >= 0 && bot.tickCount - fHitT >= (Z403C && hmSafe(gb.x, gb.z) ? 3 : 8) && !dead()) {
            if (zT !== fHitT) { zT = fHitT; zLast = -99; zKeyT = fKeyT; zHops = 0; zGo = true; console.log(`[hm] 403 zombie +${bot.tickCount - t0}: Treus ${fKey} still up ${bot.tickCount - fHitT} t after an hp-0 splat`); }
            if (fKeyT !== zKeyT) { zKeyT = fKeyT; zHops++; }
            const a = bot.tickCount - zT, safe = hmSafe(gb.x, gb.z);
            let go = a >= 260 || (safe ? a >= 110 + 5 * zHops : a < 40);
            if (!go && !safe) { const s = bot.tickCount - zLast; if (s >= 15) zLast = bot.tickCount; go = s >= 15 || s < 4; }
            if (ZOMB_TEST && go !== zGo) console.log(`[hm] 403 TEST +${bot.tickCount - t0}: ${go ? 'attack' : 'wait'} (age ${a} t, hops ${zHops}, Treus ${fKey}, safe ${safe})`);
            zGo = go;
            if (!go) {
                if (!zStop) { zStop = true; bot.sendRoute([bot.tile()]); bot.queueFlush(); }
                // fix 403d (proof404 z404b: 11 off-spot windows +434..+602 with 0 casts, REACH silent until the gate freed at 260 t):
                // a wait tick must neither count as 'no progress' nor wipe it -> shift progT, so REACH sees only window ticks.
                progT = Z403D ? progT + 1 : bot.tickCount; target = -1; await bot.tick(1); continue;
            }
            zStop = false;
        }
        if (g && canCast && (lvl || g.idx !== target || bot.tickCount - last >= 2)) { if (lvl) bot.resumeDialogPage(); bot.opNpcT(g.idx, spellCom(process.argv.includes('--blast') ? 'fire_blast' : 'crumble_undead')); bot.queueFlush(); target = g.idx; last = bot.tickCount; }
        // the boss timer if_close()s us every 5 t (hauntedmine_boss_ghost.rs2 boss_timer), which drops our attack: re-send often
        // far and not closing in (cart obstacles in the room): a full walkOp to his tile first
        else if (g && g.d > 2 && bot.tickCount - lastMove > 4) { await walkOp(bot, { x: g.x, z: g.z }, null, () => (npcsOf(bot, 1540)[0]?.d ?? 99) <= 1 || !npcsOf(bot, 1540).length, { near: 1, maxTicks: 20 }); lastMove = bot.tickCount; }
        else if (g && !canCast && (lvl || g.idx !== target || bot.tickCount - last >= 2)) { if (lvl) bot.resumeDialogPage(); attackFrom(bot, g); target = g.idx; last = bot.tickCount; }
        // he runs to one of six spots up to ~12 tiles from the room centre (hauntedmine_boss_ghost.rs2 boss_move): out of
        // view from a corner, so wait at the centre (2788,4456) whenever he is not in view
        else if (!npcsOf(bot, BOSS).length && cheb(bot.tile(), { x: 2788, z: 4456 }) > 2 && bot.tickCount - lastSeen > 4) {
            // carts can push us into side pockets: a full walkOp (re-plans around the npcs) back to the centre
            await walkOp(bot, { x: 2788, z: 4456 }, null, () => npcsOf(bot, BOSS).length > 0, { near: 2, maxTicks: 25 });
            last = bot.tickCount;
        }
        await bot.tick(1);
    }
    for (let j = 0; j < 4 && inDialog(bot); j++) { bot.resumeDialogPage(); bot.queueFlush(); await bot.tick(1); }
    at('stage9');
}
