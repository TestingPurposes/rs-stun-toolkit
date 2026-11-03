// =====================================================================================================
// legs/legends/seg-d.ts — LEGENDS' QUEST segment D: stage 20 (received_dagger) -> 45 (got_gilded_totem). rig.
// =====================================================================================================
// ROUTE (content: quest_legends/scripts/*.rs2, maps m37_73 / m43_145 / m43_45):
//   The two ways to reveal Nezikchened at Echned Zekin's boulder:
//     (a) stab Viyeldi with the dark dagger (viyeldi.rs2 opnpcu) -> glowing dagger -> give it to Echned (echned_zekin.rs2
//         echned_glowing_dagger) -> sets legends_killed_viyeldi, so the FINAL fight first summons the three dead heroes
//         San Tojalon / Irvig Senay / Ranalph Devere (nezikchened.rs2 summon_nezi_part3), then Nezikchened.
//     (b) take the dagger to Ungadulu for the Holy Force spell, read it next to Echned: no heroes in the final fight.
//   (b) costs two extra full transits of the Shaman caves (rope room -> magic gate -> marked wall -> crumbled wall ->
//   strength gate -> mining trial -> lockpick gate -> Ungadulu, and back down the winch): far more than the 3 hero fights,
//   which deal 0 damage under Protect from Melee (all three are melee-only). So (a). The hat sits 2 tiles from the rope
//   landing, which D passes anyway on the way out (only the chain back down is extra).
//   D1  cavern (C left us at a boulder) -> force barrier (north) -> the 6-obstacle chain (climbrock3/2/1, ledge2/1, ledge;
//       every one on its no-roll 'easy' side this way) -> rope landing
//   D2  take Viyeldi's hat (2379,4712) -> Viyeldi appears -> use the dark dagger on him DURING his speech (the speech ends
//       with npc_del) -> glowing dagger (deathdaggerdone)
//   D3  the chain back (hard sides: dialog + agility roll; a fall re-classifies the pocket and carries on) -> barrier -> boulder:
//       Push -> Echned -> takes the glowing dagger -> Nezikchened (cl187, 150 hp, -18 prayer) -> kill (stage 22)
//   D4  boulder Push (from the EAST side, legends_boulder.rs2:18) -> sparkling pool -> blessed bowl -> pure sacred water
//       (stage 25)
//   D5  out: barrier, chain, Climbing rope (2377,4711) -> Shaman caves rope room (2760,9328) -> magic-trial gate (one-way
//       N->S, 2762,9317) -> marked wall (2776,9303, needs legends_law_rune_2_used from B) -> crumbled wall jump (agility 50)
//       -> strength-trial gate (str 50, brute force) -> mining-trial boulder 3 from the south WITHOUT a pickaxe = "climb out"
//       teleport past all three boulders (-2 hp) -> lockpick gates from inside (lever) -> crevice (Search, 2799,9341) -> cave entrance -> jungle 2781,2934
//       (auto-retaliate OFF for this stretch: Death wings would retarget us and swallow the loc ops)
//   D6  fertile soil 2778,2916: plant a germinated seed (herblore 45, wc 50, pure water in pack; stat_random(herblore,40,243)
//       per seed) -> water the sapling (51 t timer) -> rune axe x3 (fell, trim, carve; each stage rots after 51 t) -> take
//       the totem (stage 30)
//   D7  evil totem pole 2793,2908: use the totem -> San -> Irvig -> Ranalph -> Nezikchened (prayer -75%) -> kill (stage 35)
//   D8  use the totem again (stage 40) -> Gujuo walks up and talks -> gilded totem pole (stage 45)
// EXIT (for E): Kharazi jungle next to the replaced totem pole (~2792,2909, level 0), holding thtotempolegift + the
//   blessed golden bowl (empty) + rune axe + leftover food/pots; legendsquest 45. The yommi seeds left over are taken by
//   Gujuo. Radimus also needs the completed Kharazi map (thkaramjamapcomp) from A — D never touches it.
// ⛔ CHEATLESS: no cheat/setvar/localSetup here. Gates on observables (items, npcs, position, messages).
import { SpeedBot, objId, cheb } from '../../core.js';
import { nav, npc, npcsOf, dropAllExcept, trace, opNpcGo, locAt, opLocGo, routeToLoc, pickupGo, inDialog, levelUpOpen, msgsSince, log, type Tile, type NpcRef } from '../q-lib.js';
import { wield } from '../run-lib.js';
import type * as locScene from '../../../loc-scene.js';
import { PREREQ, type Seg, type SegCtx } from './common.js';

// ---- ids (content/pack/*.pack) ----
const NPC = { nezi: 934, viyeldi: 935, san: 936, irvig: 937, ranalph: 938, echned: 940, boulder: 939, gujuo: 928 };
const LOC = {
    barrier: 2971, ledge: 2959, rope: 2958,                                    // m37_73 (Viyeldi caves / source cavern)
    magicGate: 2930, markedWall: 2927, crumbled: 2926, strGateR: 2923, strGateL: 2922, trialBoulder3: 2921,
    lockGateR: 2913, lockGateL: 2912, caveExitR: 2903, caveExitL: 2904,         // m43_145 (Shaman caves)
    soil: 2956, sapling: 2946, adult: 2948, felled: 2950, trimmed: 2952, totem: 2954, pole: 2936, pool: 2941,
};
const O = {
    dagger: objId('deathdagger'), glowDagger: objId('deathdaggerdone'), hat: objId('viyeldihat'),
    bowlEmpty: objId('goldbowlbless_empty'), bowlPure: objId('goldbowlbless_pure'), seed: objId('yommiseeds_germ'),
    axe: objId('rune_axe'), totem: objId('thtotempole'), gift: objId('thtotempolegift'),
    shark: objId('shark'),
};
const POTS = ['1doseprayerrestore', '2doseprayerrestore', '3doseprayerrestore', '4doseprayerrestore'].map(n => objId(n));
const SUPER_ATT = [1, 2, 3, 4].map(d => objId(`${d}dose2attack`)), SUPER_STR = [1, 2, 3, 4].map(d => objId(`${d}dose2strength`));
const HEROES = [NPC.san, NPC.irvig, NPC.ranalph];
const KEEP: Array<number | string> = ['deathdagger', 'deathdaggerdone', 'goldbowlbless_empty', 'goldbowlbless_pure', 'yommiseeds_germ', 'yommiseeds', 'rune_axe',
    ...(process.env.LG_D_YOMMI !== '0' ? ['reed_hollow'] : []),   // session 11 fix 373 (the re-get path refills the bowl with it)
    'rune_scimitar', 'shark', ...POTS, ...SUPER_ATT, ...SUPER_STR, 'thkaramjamap', 'thkaramjamapcomp',
    'machette', 'coins', 'rune_pickaxe', 'thtotempole', 'thtotempolegift', 'holyforce',
    'airrune', 'waterrune', 'earthrune', 'firerune', 'mindrune', 'bodyrune', 'lawrune', 'cosmicrune', 'naturerune', 'chaosrune', 'deathrune', 'bloodrune', 'soulrune'];
if (process.env.LG_B_KEEP_GLORY === '1') KEEP.push('amulet_of_glory_4', 'amulet_of_glory_3', 'amulet_of_glory_2', 'amulet_of_glory_1', 'amulet_of_glory');
const KEEP_IDS = new Set(KEEP.map(k => objId(k)));
/** hand-off 2 (ctx.resupply in the jungle, before the final summon): the heroes + final Nezikchened (-75% prayer). */
export const RESUPPLY = [{ name: '4doseprayerrestore', n: 2 }, { name: 'shark', n: 8 }];
/** hand-off 1 (ctx.resupply at the start, after the junk drop): prayer for Nezikchened (water) from ZERO + super att/str. */
export const HANDOFF1 = [{ name: '4doseprayerrestore', n: 2 }, { name: '4dose2attack', n: 1 }, { name: '4dose2strength', n: 1 }, { name: 'shark', n: 6 }];

// ---- places ----
const BARRIER = { x: 2421, z: 4690 };                  // force barrier wall (52-53,18 of m37_73); south = cavern
const BARRIER_S = { x: 2421, z: 4690 }, BARRIER_N = { x: 2421, z: 4691 };
const HAT = { x: 2379, z: 4712 }, ROPE = { x: 2377, z: 4711 };
const inCavern = (t: Tile) => t.x >= 2368 && t.x <= 2431 && t.z >= 4672 && t.z <= 4690;
// The Viyeldi caves between the rope landing and the main cave are a chain of pockets joined by one obstacle each
// (quest_legends.rs2:1634-1892; static collision m37_73 + probed in the sim). Towards the landing every obstacle is the
// script's "easy" branch (no dialog, no roll); towards the cave the "hard" one (dialog + stat_random(agility,110,250)).
//   C main cave (north of the barrier) | I 2390-91,4719-23 | H 2388-91,4725-30 | F 2382-87,4726-28 | E 2378-82,4728-30
//   K corridor x2376-77,4717-27 | A rope landing 2378-80,4711-17
type Pocket = 'A' | 'K' | 'E' | 'F' | 'H' | 'I' | 'C';
const pocketOf = (t: Tile): Pocket => {
    if (t.z < 4691 || t.z > 4740 || t.x < 2368 || t.x > 2431) return 'C';
    if (t.x >= 2378 && t.x <= 2380 && t.z >= 4711 && t.z <= 4717) return 'A';
    if (t.x >= 2375 && t.x <= 2377 && t.z >= 4717 && t.z <= 4727) return 'K';
    if ((t.x === 2378 && t.z >= 4728 && t.z <= 4730) || (t.x >= 2379 && t.x <= 2382 && t.z >= 4729 && t.z <= 4730)) return 'E';
    if ((t.x >= 2382 && t.x <= 2384 && t.z === 4728) || (t.x >= 2384 && t.x <= 2387 && t.z >= 4726 && t.z <= 4727)) return 'F';
    if (t.x >= 2388 && t.x <= 2391 && t.z >= 4725 && t.z <= 4730) return 'H';
    if (t.x >= 2390 && t.x <= 2391 && t.z >= 4719 && t.z <= 4723) return 'I';
    return 'C';
};
type Step = { id: number; at: Tile; stand: Tile; next: Pocket };
const CHAIN: Record<'landing' | 'cave', Partial<Record<Pocket, Step>>> = {
    landing: {
        C: { id: 2964, at: { x: 2390, z: 4718 }, stand: { x: 2390, z: 4717 }, next: 'I' },   // viycaves_climbrock3
        I: { id: 2963, at: { x: 2390, z: 4724 }, stand: { x: 2390, z: 4723 }, next: 'H' },   // viycaves_climbrock2
        H: { id: 2962, at: { x: 2387, z: 4728 }, stand: { x: 2388, z: 4728 }, next: 'F' },   // viycaves_climbrock1
        F: { id: 2961, at: { x: 2382, z: 4729 }, stand: { x: 2382, z: 4728 }, next: 'E' },   // rocky_ledge2
        E: { id: 2960, at: { x: 2377, z: 4728 }, stand: { x: 2378, z: 4728 }, next: 'K' },   // rocky_ledge1
        K: { id: 2959, at: { x: 2377, z: 4717 }, stand: { x: 2376, z: 4717 }, next: 'A' },   // rocky_ledge
    },
    cave: {
        A: { id: 2959, at: { x: 2377, z: 4717 }, stand: { x: 2378, z: 4717 }, next: 'K' },
        K: { id: 2960, at: { x: 2377, z: 4728 }, stand: { x: 2377, z: 4727 }, next: 'E' },
        E: { id: 2961, at: { x: 2382, z: 4729 }, stand: { x: 2382, z: 4730 }, next: 'F' },
        F: { id: 2962, at: { x: 2387, z: 4728 }, stand: { x: 2387, z: 4727 }, next: 'H' },
        H: { id: 2963, at: { x: 2390, z: 4724 }, stand: { x: 2390, z: 4725 }, next: 'I' },
        I: { id: 2964, at: { x: 2390, z: 4718 }, stand: { x: 2390, z: 4719 }, next: 'C' },
    },
};
const ROPE_TOP = { x: 2760, z: 9328 };
const MAGIC_GATE = { x: 2762, z: 9317 }, MAGIC_GATE_N = { x: 2762, z: 9318 };
const MARKED_WALL = { x: 2776, z: 9303 };
const CRUMBLED = { x: 2789, z: 9295 }, CRUMBLED_STAND = { x: 2789, z: 9296 };
let test336b = process.env.LG_D_RESUME_TEST === '1';   // session 11 fix 336b TEST: module scope = fires once (import cached)
let test373 = process.env.LG_D_YOMMI_TEST ?? '';       // session 11 fix 373 TEST: module scope = fires once (import cached)
const STR_GATE = { x: 2810, z: 9314 }, STR_GATE_S = { x: 2810, z: 9313 };   // the LEFT leaf: an op on the right one (2809) is silently ignored (sim-probed)
const TRIAL_B3 = { x: 2809, z: 9319 }, TRIAL_B3_S = { x: 2809, z: 9318 };
const LOCK_GATE = { x: 2810, z: 9332 }, LOCK_GATE_S = { x: 2810, z: 9331 };
const CAVE_EXIT = { x: 2773, z: 9342 }, JUNGLE_IN = { x: 2781, z: 2934 };
const SOIL = { x: 2778, z: 2916 };                     // fertilesoil 3x3 (43_45_26_36), nearest to the cave mouth
const POLE = { x: 2793, z: 2908 };                     // lg_ord_totem_pole (43_45_41_28), nearest to the soil

/** A loc that only exists live (loc_change): same tile, its own id/size. */
const dynLoc = (id: number, x: number, z: number, size = 3): locScene.SceneLoc =>
    ({ id, x, z, level: 0, width: size, length: size, angle: 0, shape: 10, name: '', options: [] } as unknown as locScene.SceneLoc);

export const SEG_D: Seg = {
    id: 'D', title: 'Nezikchened (water), sacred water, yommi totem, heroes + final Nezikchened, gilded totem',
    fromStage: 20, toStage: 45,
    pre: {
        ...PREREQ,
        // legendsquest 20 = received_dagger. legends_bits: the wall runes 7-11 (B: the marked wall stays open on bit 11),
        // rope tied 24, bravery potion 25, the three smelted crystal pieces 26-28 (C). No killed_viyeldi (29) yet.
        varps: { ...(PREREQ.varps ?? {}), legendsquest: 20, legends_bits: (0b11111 << 7) + (0b11111 << 24) },
        // C ends at the boulder where Echned handed over the dagger: the boulder at 2392,4678 (nearest the barrier),
        // standing on its east side.
        tele: { x: 2394, z: 4678, level: 0 },
        clear: true,   // sim: drop the tutorial kit first, or the supplies do not fit (28 slots)
        // C's real exit (chain full1258): ~16/28 - coins, sharks, map, machete, rune axe, bullroarer, bowl, lockpick, rune
        // pickaxe, reed, vial, dagger; scimitar worn; prayer ~0, hp ~56. The stand-in carries the same kind of leftovers
        // (D drops the junk itself).
        items: [
            { name: 'deathdagger', n: 1 }, { name: 'goldbowlbless_empty', n: 1 }, { name: 'yommiseeds_germ', n: 3 },
            { name: 'rune_scimitar', n: 1 }, { name: 'rune_axe', n: 1 }, { name: 'machette', n: 1 }, { name: 'thkaramjamapcomp', n: 1 },
            { name: 'bullroarer', n: 1 }, { name: 'lockpick', n: 1 }, { name: 'rune_pickaxe', n: 1 }, { name: 'coins', n: 500 },
            { name: 'reed_hollow', n: 1 }, { name: 'vial_empty', n: 1 },
        ],
    },
    // both hand-offs go through ctx.resupply AFTER D drops C's junk (C can leave the pack too full for a before-D hand-off):
    // HANDOFF1 at the start, RESUPPLY in the jungle before the final summon
    supply: [],
    run: (bot, ctx) => runD(bot, ctx),
};

/** Whole-segment safety net: eat when hp <= 50% (Death wings in the Shaman caves, jungle aggressors, the summon chants
 *  hit outside the fights). Pages are only interrupted when hp is critical (an OPHELD closes the dialog). */
async function runD(bot: SpeedBot, ctx: SegCtx): Promise<Record<string, unknown>> {
    const shark = objId('shark');
    let on = true, lastEat = -9, dead = '';
    const tick0 = bot.tick.bind(bot);
    // DEATH: "Oh dear, you are dead!" or a jump to the Lumbridge respawn -> every later bot.tick throws at once (no 20-min
    // "no target" loop in Lumbridge)
    const deathSince = bot.tickCount;
    (bot as any).tick = async (n = 1) => { await tick0(n); if (dead) throw new Error(dead); };
    (async () => {
        while (on && !bot.disposed) {
            const t = bot.tile();
            if (!dead && (msgsSince(bot, deathSince).some(m => /Oh dear,? you are dead/i.test(m)) || (t.x >= 3200 && t.x <= 3245 && t.z >= 3195 && t.z <= 3240 && bot.minusedlevel === 0)))
                dead = `legends-D: DIED (respawned at ${t.x},${t.z}) - check food/prayer for the fights`;
            const hp = bot.stat('hitpoints'), critical = hp.cur <= Math.max(20, Math.floor(hp.level * 0.3));
            if (hp.cur <= Math.floor(hp.level * 0.5) && (critical || bot.chatModalId === -1) && bot.tickCount - lastEat >= 3 && bot.count(shark) > 0) {
                bot.opHeld1(shark, bot.slot(shark)); bot.queueFlush(); lastEat = bot.tickCount;
            }
            await tick0(1);
        }
    })();
    try { return await runBody(bot, ctx); }
    catch (e) { if (dead) throw new Error(dead); throw e; }
    finally { on = false; (bot as any).tick = tick0; }
}

async function runBody(bot: SpeedBot, ctx: SegCtx): Promise<Record<string, unknown>> {
    await nav();
    bot.holdDialogs = true;
    const t0 = bot.tickCount, marks: Record<string, number> = {};
    trace(bot, t0);   // QTRACE=1 only
    const say = (s: string) => { if (ctx.verbose) log(bot, t0, s); };
    const at = (s: string) => { marks[s] = bot.tickCount - t0; say(`== ${s} pos=${JSON.stringify(bot.pos())} hp=${bot.stat('hitpoints').cur} pray=${bot.stat('prayer').cur}`); };
    const fail = (s: string): never => { throw new Error(`legends-D: ${s} at ${JSON.stringify(bot.pos())} msgs ${JSON.stringify(msgsSince(bot, bot.tickCount - 8).slice(-4))}`); };
    const me = () => bot.tile();

    // ------------------------------------------------------------------------------------------------ helpers
    const walk = async (to: Tile, label: string, near = 0, maxTicks = 300) => {
        const r = await bot.walkTo(to.x, to.z, { near, maxTicks, level: 0 });
        if (cheb(me(), to) > Math.max(near, 0) + 1) fail(`walk ${label} ${JSON.stringify(r)}`);
    };
    /** Answer whatever chat page is open: a choice by the first matching regex, else continue. */
    // session 11 T4 (qx03: strength gate, a plain page 356 sat open while we resumed it every tick): the engine refuses
    // RESUME_PAUSEBUTTON while a stale resume-button list from an earlier choice is registered; CLOSE_MODAL on the suspended
    // page clears it (Player.closeModal) and the caller re-sends its op. Stale = no new chat/modal packet (ackRevs Modal)
    // for 5 t of resumes. LG_D_STALE=0 reverts.
    let pageRev = -1, pageT = 0;
    const answer = (answers: RegExp[]) => {
        if (bot.chatModalId === -1) return;
        if (bot.dialogOptions().length) { for (const re of answers) if (bot.clickDialogByText(re) > 0) break; }
        else {
            const r = Number((bot as any).ackRevs?.[5] ?? 0);   // Rev.Modal (interaction-ack.ts)
            if (r !== pageRev) { pageRev = r; pageT = bot.tickCount; }
            if (process.env.LG_D_STALE !== '0' && bot.tickCount - pageT >= 5) {
                say(`page ${bot.chatModalId} not resuming for ${bot.tickCount - pageT} t (stale resume buttons?) -> close`);
                bot.closeModal(); bot.chatModalId = -1; bot.mainModalId = -1; pageRev = -1;
            } else bot.resumeDialogPage();
        }
        bot.queueFlush();
    };
    /** Op a (static or live) loc until done(), answering pages on the way. Re-sends the op every `every` ticks. */
    const opUntil = async (loc: locScene.SceneLoc, op: number, done: () => boolean, label: string, o: { answers?: RegExp[]; maxTicks?: number; stand?: Tile; every?: number; use?: number } = {}) => {
        const end = bot.tickCount + (o.maxTicks ?? 60); let last = -99;
        while (!done()) {
            if (bot.tickCount > end) fail(`${label}: not done`);
            if (bot.chatModalId !== -1) answer(o.answers ?? []);
            else if (bot.tickCount - last >= (o.every ?? 6)) {
                if (o.use !== undefined) {
                    const slot = bot.slot(o.use); if (slot < 0) fail(`${label}: item ${o.use} not held`);
                    routeToLoc(bot, loc, o.stand); if (levelUpOpen(bot)) bot.resumeDialogPage();
                    bot.useItemOnLoc(loc.x, loc.z, loc.id, o.use, slot); bot.queueFlush();
                } else opLocGo(bot, loc, op, o.stand);
                last = bot.tickCount;
            }
            await bot.tick(1);
        }
    };
    // ---- combat: Protect from Melee, eat, restore prayer, attack the nearest of `types` ----
    let lastEat = -9, lastPot = -9;
    const sustain = () => {
        const hp = bot.stat('hitpoints'), pr = bot.stat('prayer');
        if (hp.cur <= Math.max(25, Math.floor(hp.level * 0.5)) && bot.tickCount - lastEat >= 3 && bot.count(O.shark) > 0) { bot.opHeld1(O.shark, bot.slot(O.shark)); lastEat = bot.tickCount; }
        if (pr.cur < 20 && bot.tickCount - lastPot >= 3) { const p = bot.inv().find(s => POTS.includes(s.obj)); if (p) { bot.opHeld1(p.obj, p.slot); lastPot = bot.tickCount; } }
        if (!bot.isPrayerActive('protectfrommelee') && pr.cur > 0) bot.activatePrayer('protectfrommelee');
        // keep the super attack/strength boost up (re-dose when it has decayed below +8)
        for (const [skill, ids] of [['attack', SUPER_ATT], ['strength', SUPER_STR]] as const) {
            const s = bot.stat(skill); if (s.cur - s.level >= 8 || bot.tickCount - lastPot < 2) continue;
            const p = bot.inv().find(x => ids.includes(x.obj)); if (p) { bot.opHeld1(p.obj, p.slot); lastPot = bot.tickCount; }
        }
        bot.queueFlush();
    };
    const prayOff = () => { if (bot.isPrayerActive('protectfrommelee')) { bot.deactivatePrayer('protectfrommelee'); bot.queueFlush(); } };
    /** Fight whatever of `types` shows up until done(). Pages (the summon chants are game messages, but level-ups and
     *  the odd mesbox are pages) are continued. */
    const fight = async (types: number[], done: () => boolean, label: string, maxTicks = 900) => {
        const end = bot.tickCount + maxTicks; let lastOp = -99, lastIdx = -1, lastLog = bot.tickCount;
        while (!done()) {
            if (bot.tickCount > end) fail(`${label}: fight timed out`);
            if (bot.chatModalId !== -1) { bot.resumeDialogPage(); bot.queueFlush(); }
            sustain();
            const t = npc(bot, types);
            if (t && (t.idx !== lastIdx || bot.tickCount - lastOp >= 10)) { opNpcGo(bot, t, 2); lastOp = bot.tickCount; lastIdx = t.idx; }
            if (ctx.verbose && bot.tickCount - lastLog >= 20) {
                lastLog = bot.tickCount; const n = t ? bot.npcs[t.idx] as any : null;
                say(`${label}: ${t ? `${t.type}@${t.x},${t.z} d${t.d} hp ${n?.hpCur}/${n?.hpMax}` : 'no target'} me hp ${bot.stat('hitpoints').cur} pray ${bot.stat('prayer').cur} sharks ${bot.count(O.shark)}`);
            }
            await bot.tick(1);
        }
    };
    const sawMsg = (re: RegExp, since: number) => msgsSince(bot, since).some(m => re.test(m));
    /** Before a fight: eat to >= hpFrac and drink prayer restores to >= prFrac of the level (C leaves prayer ~0, hp ~56). */
    const topUp = async (hpFrac: number, prFrac: number) => {
        for (let k = 0; k < 8; k++) {
            const hp = bot.stat('hitpoints'), pr = bot.stat('prayer');
            const eat = hp.cur < hp.level * hpFrac && bot.count(O.shark) > 0;
            const pot = pr.cur < pr.level * prFrac ? bot.inv().find(s => POTS.includes(s.obj)) : undefined;
            if (!eat && !pot) break;
            if (eat) bot.opHeld1(O.shark, bot.slot(O.shark));
            else if (pot) bot.opHeld1(pot.obj, pot.slot);
            bot.queueFlush(); await bot.tick(3);
        }
        say(`top-up: hp ${bot.stat('hitpoints').cur} pray ${bot.stat('prayer').cur} sharks ${bot.count(O.shark)} pots ${bot.inv().filter(s => POTS.includes(s.obj)).length}`);
    };

    // C's (and B's/A's) leftovers D never uses (bullroarer, lockpick, reed, vials, rope, orb, hammer, book, tutorial kit...)
    // out of the pack: room for the hand-offs and the totem pole. KEEP = what D or E needs + valuables (coins, runes,
    // pickaxe, machete for the jungle, the Kharazi map Radimus wants).
    const dropJunk = async () => {
        if (dropAllExcept(bot, KEEP) > 0) await bot.until(() => bot.inv().every(s => KEEP_IDS.has(s.obj)), 4);
    };
    /** A helper hand-off via ctx.resupply: junk out first, then give what fits (sharks trimmed first, never the pots). */
    const handOff = async (list: Array<{ name: string; n: number }>, label: string) => {
        await dropJunk();
        // helper mode (route): no hand-off in the caves/jungle; C brought D's prayer/boost kit (seg-c SEG_C_MEET)
        if (ctx.helper) { say(`${label}: helper mode - none (C brought the kit): sharks ${bot.count(O.shark)} pots ${bot.inv().filter(s => POTS.includes(s.obj)).length} free ${bot.free()}`); return; }
        if (!ctx.resupply) { say(`${label}: no resupply hook - skipped`); return; }
        const want = list.map(i => ({ ...i }));
        const slots = () => want.reduce((a, i) => a + (i.n > 0 ? (/rune$|^coins$/.test(i.name) ? 1 : i.n) : 0), 0);
        const sh = want.find(i => i.name === 'shark');
        while (sh && slots() > bot.free() && sh.n > 0) sh.n--;
        if (slots() > bot.free()) fail(`no room for ${label} (free ${bot.free()}, need ${slots()})`);
        say(`${label}: ${want.map(i => `${i.name} x${i.n}`).join(', ')} (free ${bot.free()})`);
        await ctx.resupply(want.filter(i => i.n > 0)); await bot.tick(1);
    };
    await handOff(HANDOFF1, 'hand-off 1');
    await wield(bot, ['rune_scimitar']);
    // Echned's boulder: the one C used (nearest our start); the three spawns of boulder_legends in m37_73
    const BOULDERS: Tile[] = [{ x: 2373, z: 4692 }, { x: 2386, z: 4689 }, { x: 2392, z: 4678 }];
    const BOULDER = [...BOULDERS].sort((a, b) => cheb(a, me()) - cheb(b, me()))[0]!;
    // session 11 fix 336b (qx121m retry 'no dark dagger (C should leave it)'): D's dagger went to Echned in D3; a retry
    // restarts D at D1. The pure bowl exists only from D4 (stage 25) until D6 waters the sapling: holding it = resume at D5
    // (no rope from the shaman caves; the walls skipped when past the crumbled wall). LG_D_RESUME=0 reverts.
    // TEST: LG_D_RESUME_TEST=1 fails once at the first strength-gate try.
    // session 11 fix 373 (qx239m retry 'walk pocket C stand ... no route (island)' in 20 t): a retry after D6 stands in the
    // Kharazi jungle (z < 4000) but the 336b resume assumed the caves (D5 toLanding -> traverse from a jungle tile). On the
    // surface D5 is skipped; a surface start with no dagger (Echned has it since D3) and no totem is a resume even with the
    // bowl empty (the re-get below empties it while germinating). LG_D_YOMMI=0 reverts.
    const yommi = process.env.LG_D_YOMMI !== '0';
    const resume = process.env.LG_D_RESUME !== '0' && (bot.count(O.bowlPure) > 0 || (yommi && me().z < 4000
        && bot.count(O.glowDagger) === 0 && bot.count(O.dagger) === 0 && bot.count(O.totem) === 0 && bot.count(O.gift) === 0));
    const surf = yommi && resume && me().z < 4000;
    if (resume) log(bot, t0, `336b: resume at D5 from ${JSON.stringify(me())}`);
    if (!resume && bot.count(O.glowDagger) === 0 && bot.count(O.dagger) === 0) fail('no dark dagger (C should leave it)');

    // ================================================================ D1 cavern -> rope landing
    const barrier = locAt(LOC.barrier, BARRIER.x, BARRIER.z);
    const toNorth = async () => {
        if (!inCavern(me())) return;
        await walk(BARRIER_S, 'barrier south', 0);
        await opUntil(barrier, 1, () => me().z >= 4691, 'barrier north', { stand: BARRIER_S });
    };
    /** Walk the Viyeldi-caves obstacle chain (any start pocket; a fall re-classifies and carries on). */
    const traverse = async (dir: 'landing' | 'cave') => {
        const goal: Pocket = dir === 'landing' ? 'A' : 'C';
        const end = bot.tickCount + 400;
        while (pocketOf(me()) !== goal) {
            if (bot.tickCount > end) fail(`traverse ${dir}`);
            const p = pocketOf(me());
            const step = CHAIN[dir][p];
            if (!step) fail(`traverse ${dir}: no step from pocket ${p}`);
            const s = step!;
            if (cheb(me(), s.stand) > 0) await walk(s.stand, `pocket ${p} stand`, 0, 120);
            // done on the expected next pocket; a fall (or anything else) = a stable different pocket, off the obstacle tile
            let stableKey = '', stable = 0;
            const moved = () => {
                const t = me(), q = pocketOf(t);
                if (q === s.next) return true;
                const k = `${t.x},${t.z}`; stable = k === stableKey ? stable + 1 : 0; stableKey = k;
                return q !== p && cheb(t, s.at) > 1 && stable >= 4 && bot.chatModalId === -1;
            };
            await opUntil(locAt(s.id, s.at.x, s.at.z), 1, moved, `${dir} ${p} op ${s.id}`, { stand: s.stand, answers: [/nothing more exciting|want to climb over/], every: 10, maxTicks: 60 });
            say(`traverse ${dir}: ${p} -> ${pocketOf(me())} at ${JSON.stringify(me())}`);
        }
    };
    const toLanding = async () => { await toNorth(); await traverse('landing'); };
    const toCavern = async () => {
        if (pocketOf(me()) !== 'C') await traverse('cave');
        await walk(BARRIER_N, 'barrier north', 0, 300);
        await opUntil(barrier, 1, () => me().z <= 4690, 'barrier south', { stand: BARRIER_N });
    };
    if (resume) { /* 336b: D1-D4 done */ } else if (bot.count(O.glowDagger) === 0) {
        await toLanding();
        at('landing');
        // ============================================================ D2 Viyeldi
        const end = bot.tickCount + 60; let lastTake = -99, lastStab = -99;
        while (bot.count(O.glowDagger) === 0) {
            if (bot.tickCount > end) fail('stab Viyeldi');
            const v = npc(bot, NPC.viyeldi);
            if (v && bot.count(O.dagger) > 0 && bot.tickCount - lastStab >= 3) {
                // interrupting his speech keeps him in the world (the speech ends with npc_del)
                bot.useItemOnNpc(v.idx, O.dagger, bot.slot(O.dagger)); bot.queueFlush(); lastStab = bot.tickCount;
            } else if (!v && bot.chatModalId !== -1) { bot.resumeDialogPage(); bot.queueFlush(); }
            else if (!v && bot.tickCount - lastTake >= 6) { pickupGo(bot, O.hat, HAT); lastTake = bot.tickCount; }
            await bot.tick(1);
        }
        await bot.until(() => npc(bot, NPC.viyeldi) === null, 12);   // "...crumples to the floor" (p_delays) before we move
        at('viyeldi');
        await toCavern();
    } else if (!inCavern(me())) await toCavern();
    at('cavern');

    // ================================================================ D3 Echned -> Nezikchened (water)
    const nearestBoulder = (): NpcRef => { const b = npcsOf(bot, NPC.boulder).filter(q => cheb(q, BOULDER) <= 3)[0]; if (!b) fail('Echned boulder not in view'); return b!; };
    const pushStand = (b: Tile): Tile => ({ x: b.x + 2, z: b.z });   // size 2: east side is x >= b.x+2
    if (!resume) {
        const b = { x: BOULDER.x, z: BOULDER.z };
        await walk(pushStand(b), 'boulder east', 0, 200);
        await topUp(0.7, 0.5);   // Echned's reveal costs 18 prayer; the fight runs ~110 t under Protect from Melee
        const end = bot.tickCount + 60; let last = -99;
        while (!npc(bot, NPC.nezi)) {
            if (bot.tickCount > end) fail('Echned: no Nezikchened');
            if (bot.chatModalId !== -1) answer([]);
            else if (bot.tickCount - last >= 8) { const bb = nearestBoulder(); bot.opNpc(bb.idx, 1); bot.queueFlush(); last = bot.tickCount; }
            await bot.tick(1);
        }
        if (bot.count(O.glowDagger) > 0) fail('Echned did not take the glowing dagger');
        at('nezi-water spawned');
        const s0 = bot.tickCount;
        await fight([NPC.nezi], () => sawMsg(/falls to the floor in a pile of ashes/, s0), 'nezi-water');
        prayOff();
        at('nezi-water dead');   // stage 22
    }

    // ================================================================ D4 the sacred pool
    if (!resume) {
        const end = bot.tickCount + 80; let lastPush = -99, lastUse = -99, poolAt: Tile | null = null;
        while (bot.count(O.bowlPure) === 0) {
            if (bot.tickCount > end) fail('sacred water');
            if (bot.chatModalId !== -1) { answer([]); await bot.tick(1); continue; }
            if (!poolAt && bot.tickCount - lastPush >= 6) {
                const b = BOULDER; const st = pushStand(b);
                if (cheb(me(), st) > 0) await walk(st, 'boulder east (push)', 0, 60);
                const since = bot.tickCount;
                bot.opNpc(nearestBoulder().idx, 1); bot.queueFlush(); lastPush = bot.tickCount;
                if (await bot.until(() => sawMsg(/push the boulder out of the way|already/, since), 6)) poolAt = { x: b.x, z: b.z };
                continue;
            }
            if (poolAt && bot.tickCount - lastUse >= 4) {
                const pool = dynLoc(LOC.pool, poolAt.x, poolAt.z, 1);
                routeToLoc(bot, pool); bot.useItemOnLoc(pool.x, pool.z, pool.id, O.bowlEmpty, bot.slot(O.bowlEmpty)); bot.queueFlush(); lastUse = bot.tickCount;
            }
            await bot.tick(1);
        }
        await bot.until(() => bot.chatModalId !== -1, 2); answer([]);
        at('sacred water');   // stage 25
    }

    // ================================================================ D5 out of the caves
    if (surf) say('373: resume on the surface - D5 skipped');
    else {   // session 11 fix 373 (D5 only from the caves)
    if (!resume || me().z < 9000) {
        await toLanding();
        const rope = locAt(LOC.rope, ROPE.x, ROPE.z);
        await opUntil(rope, 1, () => me().z > 9000, 'climb rope', { maxTicks: 30 });
    }
    at('shaman caves');
    const past = resume && me().x >= 2791 && me().z <= 9313;   // 336b: on the strength-gate side of the crumbled wall
    if (!past) {
    await walk(MAGIC_GATE_N, 'magic gate north', 0, 60);
    await opUntil(locAt(LOC.magicGate, MAGIC_GATE.x, MAGIC_GATE.z), 1, () => me().z <= 9313, 'magic gate', { stand: MAGIC_GATE_N, every: 8 });
    await walk({ x: MARKED_WALL.x - 1, z: MARKED_WALL.z }, 'marked wall', 1, 120);
    await opUntil(locAt(LOC.markedWall, MARKED_WALL.x, MARKED_WALL.z), 1, () => me().x >= 2778, 'marked wall', { every: 8 });
    // Death wings (aggressive) fly from here to the lockpick gates: auto-retaliate would retarget us onto them and drop
    // every loc op (leanbot.ts AUTO-RETALIATE; the strength gate then never answers). Off for the transit, on again after.
    }
    // session 11 fix 336a (qx121m 'strength gate': engine t64770-64866 'npc 79@2810,9311 target kept', one-tick gaps = our
    // ops): the press below lands in enter_marked_wall's p_delay(1) (quest_legends.rs2:740) -> p_finduid false -> dropped
    // (player_controls.rs2:14-20; as 297a), so auto-retaliate stays on and a Death wing hit closes every gate page.
    // Re-send until varp 172 = 1. LG_D_RETAL=0 reverts. TEST: LG_D_RETAL_TEST=1 skips the first press (the qx121 state).
    const retal = process.env.LG_D_RETAL !== '0';
    if (process.env.LG_D_RETAL_TEST !== '1') { bot.ifButton(151); bot.queueFlush(); }
    if (retal) {
        const end = bot.tickCount + 12; let n = 0;
        while (bot.getVarp(172) !== 1 && bot.tickCount < end) { await bot.tick(1); if (bot.getVarp(172) !== 1 && bot.chatModalId === -1) { bot.ifButton(151); bot.queueFlush(); n++; } }
        log(bot, t0, `336a: retaliate ${bot.getVarp(172) === 1 ? 'off' : 'STILL ON'} (${n} re-sends)`);
    }
    if (!past) {
    await walk(CRUMBLED_STAND, 'crumbled wall', 0, 120);
    await opUntil(locAt(LOC.crumbled, CRUMBLED.x, CRUMBLED.z), 2, () => me().z <= 9295, 'crumbled wall', { stand: CRUMBLED_STAND, every: 10 });
    }
    // strength-trial gates (auto-closing double door): op from the south = brute force (str 50). A leaf left open by
    // another player swallows the op silently (no loc of that id): then just walk through.
    {
        let end = bot.tickCount + 120, k = 0, wingT = 0;
        const gateNear = () => { const m = me(), o: string[] = []; for (let i = 0; i < bot.npcCount; i++) { const n = bot.npcs[bot.npcIndices[i]!] as any; if (!n) continue; const t = bot.npcTileOf(n); if (cheb(t, m) <= 6) o.push(`${n.typeId}@${t.x},${t.z}f${n.faceEntity}`); } return o.join(' ') || '-'; };   // 336c diag
        // session 11 fix 336c (qx121 forks qzm30/qzm41 'strength gate' with 336a working, ret 1): a Death wing at 2810,9311
        // faced us (npc faceEntity >= 32768) and hit every 2-4 t; every NPC melee hit runs if_close (npc_combat_melee.rs2:36,
        // even a 0), so each brute-force page closed 2 t after it opened ('gate page closed', hp 75 -> 49, 45 tries). Kill
        // a Death wing that is on us before the op (80 hp, respawn 70 t; huntrange 2). LG_D_WING=0 reverts.
        const wingOn = () => process.env.LG_D_WING === '0' ? null : npcsOf(bot, 79).find(q => q.d <= 3 && q.z < 9314 && Number((bot.npcs[q.idx] as any)?.faceEntity ?? -1) >= 32768) ?? null;
        while (me().z < 9314) {
            if (bot.tickCount > end) fail('strength gate');
            let w = wingOn();
            if (w) {
                const t1 = bot.tickCount; let lastOp = -99, lastIdx = -1;
                say(`336c: Death wing on us at ${w.x},${w.z} (hp ${bot.stat('hitpoints').cur}) -> kill`);
                while (w && bot.tickCount - t1 < 60) {
                    if (bot.chatModalId !== -1) { bot.resumeDialogPage(); bot.queueFlush(); }   // a level-up page
                    if (w.idx !== lastIdx || bot.tickCount - lastOp >= 8) { opNpcGo(bot, w, 2); lastOp = bot.tickCount; lastIdx = w.idx; }
                    await bot.tick(1); w = wingOn();
                }
                const dt = bot.tickCount - t1; if (wingT < 120) { end += Math.min(dt, 120 - wingT); wingT += dt; }
                say(`336c: Death wing ${w ? 'STILL on us' : 'gone'} after ${dt} t (hp ${bot.stat('hitpoints').cur})`);
                continue;
            }
            if (cheb(me(), STR_GATE_S) > 1) await walk(STR_GATE_S, 'strength gate', 0, 200);
            const since = bot.tickCount;
            if (k++ % 2 === 0) {
                if (test336b) { test336b = false; fail('strength gate (TEST 336b)'); }
                if (retal && bot.getVarp(172) !== 1 && bot.chatModalId === -1) { bot.ifButton(151); bot.queueFlush(); }   // 336a
                say(`strength gate try ${k} at ${JSON.stringify(me())} modal ${bot.mainModalId}/${bot.chatModalId} hold ${JSON.stringify((bot as any).doorHold)} ret ${bot.getVarp(172)} tick ${bot.tickCount} str ${bot.stat('strength').cur} hp ${bot.stat('hitpoints').cur} near ${gateNear()}`);
                opLocGo(bot, locAt(LOC.strGateL, STR_GATE.x, STR_GATE.z), 1, STR_GATE_S);
                const opened = await bot.until(() => bot.chatModalId !== -1 || me().z >= 9314, 4);
                // drive the brute-force pages (mesbox, choice, 4 mesboxes) without any MOVE in between: a MOVE kills them
                let quiet = 0;
                while (opened && me().z < 9314 && quiet < 6 && bot.tickCount < end) {
                    if (bot.chatModalId !== -1) { quiet = 0; answer([/very strong/]); } else { if (quiet === 0) say(`gate page closed: hp ${bot.stat('hitpoints').cur} str ${bot.stat('strength').cur} near ${gateNear()} msgs ${JSON.stringify(msgsSince(bot, bot.tickCount - 3).slice(-2))}`); quiet++; }
                    await bot.tick(1);
                }
                if (opened) k = 0;   // the op works: keep using it (a failed strength roll just retries)
                // (T4) qx03: with a page open at tickCount === end neither wait ran, and the loop re-sent the op ~700 times in
                // one tick until the out buffer overflowed (RangeError in p2). Every round now waits >= 1 tick. LG_D_STALE=0 reverts.
                if (process.env.LG_D_STALE !== '0' && bot.tickCount === since) await bot.tick(1);
            } else await bot.walkTo(STR_GATE.x, STR_GATE.z + 2, { maxTicks: 8, level: 0 });
        }
    }
    // mining trial: without a pickaxe the first boulder offers "climb out" = straight past all three (-2 hp); with one
    // (and mining 52) each op mines the boulder ahead and moves us 2 tiles north: op the next one until z >= 9330
    {
        const TRIAL = [{ id: 2921, x: 2809, z: 9319 }, { id: 2920, x: 2809, z: 9323 }, { id: 2919, x: 2809, z: 9327 }];
        const end = bot.tickCount + 150;
        while (me().z < 9328) {
            if (bot.tickCount > end) fail('mining trial');
            const b = TRIAL.find(q => q.z > me().z)!;
            const stand = { x: b.x, z: b.z - 1 };
            if (cheb(me(), stand) > 0) await walk(stand, 'mining trial', 0, 30);
            const z0 = me().z;
            await opUntil(locAt(b.id, b.x, b.z), 1, () => me().z >= 9328 || me().z > z0 + 1, `mining trial ${b.id}`, { stand, answers: [/try to climb out/], every: 8, maxTicks: 60 });
            await bot.until(() => bot.chatModalId === -1 && !(me().z > b.z - 1 && me().z <= b.z), 4);
        }
    }
    await walk(LOCK_GATE_S, 'lockpick gate', 0, 30);
    await opUntil(locAt(LOC.lockGateL, LOCK_GATE.x, LOCK_GATE.z), 1, () => me().z >= 9332, 'lockpick gate', { stand: LOCK_GATE_S, every: 8 });
    // the room past the lockpick gates connects to the entrance cave only through the crevice (Search -> squeeze)
    await walk({ x: 2800, z: 9340 }, 'crevice', 1, 60);
    await opUntil(locAt(2918, 2799, 9341), 2, () => me().x <= 2798, 'crevice', { answers: [/Yes please/], every: 8 });
    await walk({ x: CAVE_EXIT.x, z: CAVE_EXIT.z - 1 }, 'cave exit', 1, 200);
    await opUntil(locAt(LOC.caveExitR, CAVE_EXIT.x, CAVE_EXIT.z), 1, () => me().z < 4000, 'cave exit', { every: 8 });
    bot.ifButton(150); bot.queueFlush();   // auto-retaliate back on
    }   // session 11 fix 373 (end of the D5 'else')
    at('jungle');

    // ================================================================ D6 the yommi tree -> totem
    // session 11 fix 373 (qx239m 'every yommi seed withered (herblore roll)' at 2779,2919: quest_legends.rs2:1144 kills a
    // seed on stat_random(herblore, 40, 243) = false (PlayerOps.ts:591: herblore 85 -> 214/256 = 83.6% a seed, all 3 lost =
    // 0.44%; 234 earlier logs planted). Re-get: Ungadulu gives 3 raw seeds again at stage 22-29 when none are held or banked
    // (ungadulu.rs2:137 + 284-293; fire walls free since stage 12, quest_legends.rs2:197-206); raw seeds on the pure bowl
    // germinate and EMPTY it (quest_legends.rs2:1386-1403); the reed on the jungle pool refills it (quest_legends.rs2:995-1002,
    // as seg-b step 7). ~140 t. LG_D_YOMMI=0 reverts. TEST: LG_D_YOMMI_TEST=1 drops the germinated seeds once at the soil;
    // =2 drops them and fails D once (the qx239 retry state: surface, pure bowl, no seeds).
    const SEEDS = objId('yommiseeds'), REED = objId('reed_hollow'), MACHETE = objId('machette');
    const pageOut = async () => { for (let k = 0; k < 8 && bot.chatModalId !== -1; k++) { answer([]); await bot.tick(1); } };
    const pureBowl = async () => {
        if (bot.count(O.bowlPure) > 0) return;
        if (bot.count(O.bowlEmpty) === 0) fail('373: no golden bowl');
        if (bot.count(REED) === 0) {
            if (bot.free() === 0) await dropJunk();
            if (bot.free() === 0 && bot.count(O.shark) > 0) { bot.opHeld1(O.shark, bot.slot(O.shark)); bot.queueFlush(); await bot.until(() => bot.free() > 0, 4); }
            await walk({ x: 2836, z: 2917 }, 'tall reeds', 2, 150);
            await opUntil(locAt(2944, 2836, 2916), 0, () => bot.count(REED) > 0, '373 cut reed', { use: MACHETE, every: 6, maxTicks: 40 });
        }
        await opUntil(locAt(2942, 2837, 2915), 0, () => bot.count(O.bowlPure) > 0, '373 fill bowl', { use: REED, every: 6, maxTicks: 40 });
        await bot.until(() => bot.chatModalId !== -1, 2); await pageOut();
    };
    const reGet = async () => {
        if (bot.count(O.seed) === 0 && bot.count(SEEDS) === 0) {
            say('373: no yommi seed left -> Ungadulu');
            if (me().z < 4000) {
                await walk({ x: 2781, z: 2933 }, 'cave rocks', 1, 150);
                await opUntil(locAt(2902, 2782, 2935), 1, () => me().z > 9000, '373 cave rocks', { answers: [/^Yes, I'll crawl through/], every: 8, maxTicks: 60 });
            }
            await walk({ x: 2787, z: 9326 }, 'fire wall west', 0, 120);
            await opUntil(locAt(2908, 2788, 9326), 1, () => me().x >= 2789, '373 into the octagram', { every: 6, maxTicks: 30 }); // 373b (proof372: stand 2787,9326 -> "I can't reach that!"; default approach as seg-b)
            const end = bot.tickCount + 60; let last = -99;
            while (bot.count(SEEDS) === 0) {
                if (bot.tickCount > end) fail('373: ungadulu seeds');
                if (bot.chatModalId !== -1) answer([/I need more Yommi tree seeds/]);
                else if (bot.tickCount - last >= 8) { const u = npc(bot, 929); if (u) { opNpcGo(bot, u, 1); last = bot.tickCount; } }
                await bot.tick(1);
            }
            await pageOut();
            await opUntil(locAt(2908, 2795, 9333), 1, () => me().z >= 9334, '373 out of the octagram', { every: 4, maxTicks: 30 });
            await walk({ x: CAVE_EXIT.x, z: CAVE_EXIT.z - 1 }, 'cave exit', 1, 200);
            await opUntil(locAt(LOC.caveExitR, CAVE_EXIT.x, CAVE_EXIT.z), 1, () => me().z < 4000, '373 cave exit', { every: 8 });
        }
        if (bot.count(O.seed) === 0) {   // germinate: raw seeds on the pure bowl (the bowl empties)
            await pureBowl();
            const end = bot.tickCount + 20; let last = -99;
            while (bot.count(O.seed) === 0) {
                if (bot.tickCount > end) fail('373: germinate');
                if (bot.chatModalId !== -1) answer([]);
                else if (bot.tickCount - last >= 4) { bot.useItemOnItem(O.bowlPure, bot.slot(O.bowlPure), SEEDS, bot.slot(SEEDS)); bot.queueFlush(); last = bot.tickCount; }
                await bot.tick(1);
            }
            await pageOut();
        }
        await pureBowl();
        say(`373: re-got seeds x${bot.count(O.seed)}, pure bowl ${bot.count(O.bowlPure)}`);
    };
    {
        if (yommi && (bot.count(O.seed) === 0 || bot.count(O.bowlPure) === 0)) await reGet();   // 373: a resume after a wither
        await walk({ x: SOIL.x + 1, z: SOIL.z + 3 }, 'fertile soil', 1, 120);
        if (test373 === '1' || test373 === '2') {   // 373 TEST: every seed "withered"
            const t = test373; test373 = '';
            bot.dropItem(O.seed, bot.slot(O.seed)); bot.queueFlush(); await bot.until(() => bot.count(O.seed) === 0, 4);
            if (t === '2') fail('373 TEST: every yommi seed withered (herblore roll)');
        }
        const soil = dynLoc(LOC.soil, SOIL.x, SOIL.z);
        let planted = false, reGets = 0;
        while (!planted) {
            if (bot.count(O.seed) === 0) {
                if (!yommi || ++reGets > 2) fail('every yommi seed withered (herblore roll)');
                await reGet(); await walk({ x: SOIL.x + 1, z: SOIL.z + 3 }, 'fertile soil', 1, 120);
            }
            const since = bot.tickCount;
            await opUntil(soil, 0, () => sawMsg(/plant the Yommi tree seed|withers and dies/, since) || bot.chatModalId !== -1, 'plant', { use: O.seed, every: 8, maxTicks: 30 });
            await bot.until(() => sawMsg(/plant the Yommi tree seed/, since) || bot.chatModalId !== -1, 3);
            planted = sawMsg(/plant the Yommi tree seed/, since);
            if (bot.chatModalId !== -1) { answer([]); await bot.tick(1); }
        }
        await bot.until(() => sawMsg(/needs to be watered/, bot.tickCount - 6), 5);
        at('planted');
        // each stage: the op is accepted when its first message shows (never re-send into the script's p_delays), then
        // wait for its last message (the loc has changed by then)
        const stage = async (locId: number, item: number, startRe: RegExp, endRe: RegExp, label: string) => {
            const since = bot.tickCount;
            await opUntil(dynLoc(locId, SOIL.x, SOIL.z), 0, () => sawMsg(startRe, since), label, { use: item, every: 8, maxTicks: 40 });
            if (!(await bot.until(() => sawMsg(endRe, since), 8))) fail(`${label}: no "${endRe.source}"`);
        };
        await stage(LOC.sapling, O.bowlPure, /water the Yommi tree/, /tall enough now/, 'water');
        await stage(LOC.adult, O.axe, /prepare to chop/, /chop the Yommi tree down/, 'fell');
        await stage(LOC.felled, O.axe, /professionally wield/, /trim the branches/, 'trim');
        await stage(LOC.trimmed, O.axe, /professionally wield/, /carve a wonderful totem pole/, 'carve');
        // the totem needs a free slot: a leftover germinated seed is useless now (Gujuo takes them at stage 45)
        if (bot.free() === 0 && bot.count(O.seed) > 0) { bot.dropItem(O.seed, bot.slot(O.seed)); bot.queueFlush(); await bot.until(() => bot.free() > 0, 3); }
        if (bot.free() === 0) fail('no free slot for the totem pole');
        await opUntil(dynLoc(LOC.totem, SOIL.x, SOIL.z), 1, () => bot.count(O.totem) > 0, 'take totem', { every: 5, maxTicks: 30 });
        at('totem');   // stage 30
    }

    // ================================================================ D7 replace the evil totem: heroes + Nezikchened
    const pole = locAt(LOC.pole, POLE.x, POLE.z);
    // hand-off 2 (live: the helper trades here, out in the jungle; junk + empty vials dropped first), then top up: the chants
    // + 3 heroes + Nezikchened run back to back with no break to eat
    await handOff(RESUPPLY, 'hand-off 2');
    await topUp(0.8, 0.7);
    {
        const since = bot.tickCount;
        await opUntil(pole, 0, () => sawMsg(/defile my sanctuary/, since), 'summon', { use: O.totem, every: 8, maxTicks: 120 });
        at('final summoned');
        const s0 = bot.tickCount;
        await fight([NPC.nezi, ...HEROES], () => sawMsg(/Heard it all before|final killing blow/, s0), 'final', 1500);
        prayOff();
        at('nezi-final dead');   // stage 35
    }

    // ================================================================ D8 the totem, Gujuo, the gilded totem
    {
        await bot.until(() => sawMsg(/Heard it all before/, bot.tickCount - 10), 8);
        const since = bot.tickCount;
        await opUntil(pole, 0, () => sawMsg(/Kharazi Jungle were sighing/, since) || bot.count(O.totem) === 0, 'replace totem', { use: O.totem, every: 8, maxTicks: 40 });
        at('totem replaced');   // stage 40
        const end = bot.tickCount + 150; let lastTalk = -99;
        while (bot.count(O.gift) === 0) {
            if (bot.tickCount > end) fail('Gujuo: no gilded totem');
            if (bot.chatModalId !== -1) answer([]);
            else if (bot.tickCount - lastTalk >= 10) { const g = npc(bot, NPC.gujuo); if (g) { opNpcGo(bot, g, 1); lastTalk = bot.tickCount; } }
            await bot.tick(1);
        }
        // the rest of his speech (seeds, "I must go and hunt now") — continue it so E starts with no page open
        for (let k = 0; k < 20 && bot.chatModalId !== -1; k++) { answer([]); await bot.tick(1); }
        at('gilded totem');   // stage 45
    }
    return { ok: true, ticks: bot.tickCount - t0, marks, pos: bot.pos(), gift: bot.count(O.gift), hp: bot.stat('hitpoints').cur };
}
