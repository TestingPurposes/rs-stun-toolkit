// =====================================================================================================
// legs/legends/seg-c.ts — LEGENDS' QUEST segment C: stage 12 (Nezikchened/fire defeated) -> 20 (received the dagger)
// =====================================================================================================
// CHEATLESS: no cheat/localSetup/setvar here. Gates on observables only (items, position, live locs, dialog text).
//
// ROUTE (content: quest_legends.rs2, ungadulu.rs2, gujuo.rs2, jungle_tree.rs2, quest_junglepotion.rs2, legends_boulder.rs2,
//        echned_zekin.rs2, san_tojalon/irvig_senay/ranalph_devere.rs2):
//  1  Ungadulu (inside the fire octagram): "I need to collect some Yommi tree seeds" -> 3 yommi seeds
//  2  seeds on the blessed golden bowl of pure water -> germinated (stage 13; the bowl empties)
//  3  out through the fire wall (free since stage 12), out of the cave (shaman_entrance -> 2781,2934)
//  4  machete on the tall reeds -> hollow reed; reed on the sacred pool (2837,2915) -> the pool dries (stage 14)
//  5  walk to (2815,2935) (inside the kharazi_jungle zone, ~no hostiles within 10), bullroarer -> Gujuo: pool dried ->
//     source -> "If I went, could you help me?" -> recipe (stage 15). An attacker ("takes a dislike") is killed first.
//  6  chop north through the jungle belt at x 2816 (2 chops: 2816,2937 + 2816,2939; machete + axe + map)
//  7  snake vine (2760,3014) Search -> unid snake weed; ardrigal palm (2870,3115) Search -> unid ardrigal
//     (the Jungle Potion pick scripts only need %junglepotion past those steps: a finished prerequisite quest)
//  8  identify both, snake weed + vial of water -> snakeweed mixture, ardrigal on it -> bravery potion (needs stage
//     15), drink it (legends_bits drank_bravery_potion)
//  9  chop back south through the belt, search the cave rocks (2781,2936) -> crawl in (2773,9341)
// 10  bookcase crevice (2795,9339) -> lockpick gate (2810,9332) -> 3 mining-trial boulders (2809,9327/9323/9319)
//     -> strength-trial gates (2810,9314) -> crumbled wall (2789,9295) -> rune wall door (2779,9305; B set the runes)
//     -> charge water orb on the magic-trial gate (2762,9313) -> winch room
// 11  rope on the winch (2759,9329), climb down (bravery: stage 16) -> Viyeldi caves (2377,4712)
// 12  rocky ledges + climbing rocks (2377,4717 / 2377,4728 / 2382,4729 / 2387,4728 / 2390,4724 / 2390,4718)
// 13  kill one San Tojalon, one Irvig Senay, one Ranalph Devere (protect from melee) -> 3 crystal pieces
// 14  pieces into the furnace (2426,4726) -> heart crystal (stage 17); heart on the mossy rock (2410,4715) -> glowing;
//     glowing heart into the recess (2422,4691) (stage 18); walk through the barrier (2421,4690)
// 15  push a boulder (2386,4689) -> Echned Zekin: Er... me? / I need it for my quest / What can I do about that? /
//     I'll do what I must -> the BLACK DAGGER (stage 19 -> 20); "Ok, I'll do it." (the spirit leaves)
//
// EXIT STATE (for segment D): next to the boulder in the south cave of the Viyeldi caves (~2386,4690, L0), stage 20,
//   deathdagger 746 in the pack, legends_bits += drank_bravery_potion(25) tied_rope_winch(24) smelting chunk/hunk/lump
//   (26-28); golden bowl EMPTY (goldbowlbless_empty 722); Viyeldi NOT stabbed. Pack keeps machete, rune axe, map,
//   bullroarer, lockpick, rune pickaxe, coins, rune scimitar (worn), sharks, prayer potion, empty vial, hollow reed (~16/28).
// HAND-OFF: supply [] (B leaves 28/28); C drops B/A junk (book of binding, hammer, air runes...), then ONE ctx.resupply of
//   SEG_C_KIT (rope, unpowered orb, water runes to 30, 3 cosmic, vial of water) + sharks up to 3 if short.
import { SpeedBot, objId, objDebugName, cheb, spellCom, densify } from '../../core.js';
import { ClientProt } from '#/io/ClientProt.js';
import { PREREQ, MEET, type Seg, type SimState, type LegHelper } from './common.js';
import { nav, npc, npcsOf, opNpcGo, walkOp, routeToLoc, locAt, dismiss, log, msgsSince, dropAllExcept, dropAllOf, turning, QLIB, type Tile } from '../q-lib.js';
import { isResuming, failHook, journalStage } from '../qp/journal.js';

const UNGADULU = 929, BOULDER = 939, SAN = 936, IRVIG = 937, RANALPH = 938;
const O = {
    seeds: 735, germ: 736, bowlPure: 726, bowlEmpty: 722, reed: 727, machete: 975, bullroarer: 716,
    unidSnake: 1525, unidArd: 1527, snake: 1526, ard: 1528, vialWater: 227, vialEmpty: 229, snakeSol: 737, ardSol: 738, brave: 739,
    rope: 954, crystalA: 741, crystalB: 742, crystalC: 743, heart: 744, heartGlow: 745, dagger: 746, scimitar: 1333, shark: 385,
};
// locs
const L = {
    firewallN: [2908, 2795, 9333], caveExit: [2904, 2772, 9342], reeds: [2944, 2836, 2916], pool: [2942, 2837, 2915],
    beltS: [2892, 2816, 2937], beltN: [2893, 2816, 2939], vine: [2575, 2760, 3014], palm: [2577, 2870, 3115],
    caveRock: [2900, 2781, 2936], bookcase: [2911, 2795, 9339], lockGate: [2912, 2810, 9332],
    boulder1: [2919, 2809, 9327], boulder2: [2920, 2809, 9323], boulder3: [2921, 2809, 9319], strGate: [2922, 2810, 9314],
    crumbled: [2926, 2789, 9295], runeDoor: [2927, 2779, 9305], magicGate: [2930, 2762, 9313], winch: [2934, 2759, 9329], winchRope: [2935, 2759, 9329],
    ledge0: [2959, 2377, 4717], ledge1: [2960, 2377, 4728], ledge2: [2961, 2382, 4729], rock1: [2962, 2387, 4728], rock2: [2963, 2390, 4724], rock3: [2964, 2390, 4718],
    furnace: [2966, 2426, 4726], eyeRock: [2965, 2410, 4715], recess: [2969, 2422, 4691], barrier: [2971, 2421, 4690],
} as const;
type LocKey = keyof typeof L;
export const PHASES = ['', 'gate', 'winch', 'ledges', 'heroes', 'furnace', 'boulder'] as const;
export type Phase = typeof PHASES[number];

// B's real exit (seg-b.ts EXIT STATE, chain abc1253): inside the octagram next to Ungadulu, pack FULL (28/28): Radimus notes
// (map), machete, rune axe, bullroarer, blessed bowl of pure water (bowl uses = 1), book of binding, hammer, lockpick, rune
// pickaxe, A's coins + air/water runes, left-over sharks + prayer potion; rune scimitar WORN.
// legends_bits: 0-2 (jungle mapped), 4-5 (asked where/who), 7-11 (the five rune bits), bowl uses 1 (bits 19-23).
// The standalone stand-in reproduces that pack (incl. junk C drops; the scimitar is held, C wields it).
const PRE_BITS = 0b111 | (1 << 4) | (1 << 5) | (0b11111 << 7) | (1 << 19);
const PRE: SimState = {
    ...PREREQ,
    clear: true,
    varps: { ...(PREREQ.varps ?? {}), legendsquest: 12, legends_bits: PRE_BITS, junglepotion: 12 },
    items: [
        { name: 'thkaramjamap', n: 1 }, { name: 'machette', n: 1 }, { name: 'rune_axe', n: 1 }, { name: 'bullroarer', n: 1 },
        { name: 'goldbowlbless_pure', n: 1 }, { name: 'book_of_binding', n: 1 }, { name: 'hammer', n: 1 }, { name: 'lockpick', n: 1 },
        { name: 'rune_pickaxe', n: 1 }, { name: 'coins', n: 500 }, { name: 'airrune', n: 20 }, { name: 'waterrune', n: 10 },
        { name: 'shark', n: 4 }, { name: '3doseprayerrestore', n: 1 }, { name: 'rune_scimitar', n: 1 },
    ],
    tele: { x: 2792, z: 9330 },
};
/** Everything C keeps from B's pack (the rest - book of binding, hammer, gold bars, gems, air runes ... - is dropped). */
const KEEP = ['thkaramjamap', 'thkaramjamapcomp', 'machette', 'rune_axe', 'bullroarer', 'goldbowlbless_pure', 'goldbowlbless_empty',
    'lockpick', 'rune_pickaxe', 'coins', 'shark', '4doseprayerrestore', '3doseprayerrestore', '2doseprayerrestore', '1doseprayerrestore',
    'rune_scimitar', 'waterrune', 'cosmicrune', 'rope', 'stafforb', 'vial_water'];
/** The ONE hand-off C needs (ctx.resupply after the junk drop; 5 slots, water runes topped up to 30). All tradeable. */
export const SEG_C_KIT = [
    { name: 'rope', n: 1 }, { name: 'stafforb', n: 1 }, { name: 'waterrune', n: 30 }, { name: 'cosmicrune', n: 3 }, { name: 'vial_water', n: 1 },
    // the hero fights start at prayer ~0 (B's Nezikchened drains it): Protect from Melee drains ~0.2/tick, 3 fights ~100-280 t
    // each -> up to ~100 points; one dose restores 7 + level/4 = 31 -> 2 x 4 doses = 248 (2x margin)
    { name: '4doseprayerrestore', n: 2 },
];
export const MIN_SHARKS = 6;
/** fix 422: C's tools + quest items: never banked by a mid-quest bank trip while C runs (route-lib bankVisit srBankPrecious) */
export const C_PRECIOUS = ['thkaramjamap', 'thkaramjamapcomp', 'machette', 'rune_axe', 'bullroarer', 'lockpick', 'rune_pickaxe',
    'goldbowlbless_pure', 'goldbowlbless_empty', 'yommiseeds', 'yommiseeds_germ', 'rune_scimitar', 'heartcrystal_sectiona',
    'heartcrystal_sectionb', 'heartcrystal_sectionc', 'heartcrystal', 'heartcrystal_glow', 'deathdagger'];
/** fix 422: tools by job ([what to fetch, what counts as held]); the belt needs map + axe + machete (jungle_tree.rs2:8-23),
 *  the catacombs the lockpick (lockpick gate) and a pickaxe (boulders) */
const AXES = ['rune_axe', 'adamant_axe', 'mithril_axe', 'black_axe', 'steel_axe', 'iron_axe', 'bronze_axe'];
const PICKS = ['rune_pickaxe', 'adamant_pickaxe', 'mithril_pickaxe', 'steel_pickaxe', 'iron_pickaxe', 'bronze_pickaxe'];
const TOOLS_BELT: Array<[string, string[]]> = [['thkaramjamapcomp', ['thkaramjamapcomp', 'thkaramjamap']], ['rune_axe', AXES], ['machette', ['machette']]];
const TOOLS_CAVE: Array<[string, string[]]> = [...TOOLS_BELT, ['lockpick', ['lockpick']], ['rune_pickaxe', PICKS]];
/** HELPER MODE (route): the kit C takes at MEET.C (north of the belt, on the way to the herbs), carried into the caves: C's own
 *  quest items + the prayer/boost kit for C AND D (D never leaves the jungle/caves; its old hand-offs are off). Sized from the
 *  route-stats sim lgb1: C used 3 prayer doses, D 5, ~1 shark in all; 3 potions + B's leftover dose(s) ~ 2x that. Sharks are
 *  topped up to MIN_SHARKS on top of this list. Pack peak (herb trip) ~26/28. */
export const SEG_C_MEET = [
    { name: 'rope', n: 1 }, { name: 'stafforb', n: 1 }, { name: 'waterrune', n: 30 }, { name: 'cosmicrune', n: 3 }, { name: 'vial_water', n: 1 },
    { name: '4doseprayerrestore', n: 3 }, { name: '4dose2attack', n: 1 }, { name: '4dose2strength', n: 1 },
];
const POTS = ['1doseprayerrestore', '2doseprayerrestore', '3doseprayerrestore', '4doseprayerrestore'].map(n => objId(n));
let test385 = process.env.LG_C_385_TEST === '1';   // session 11 fix 385a TEST: once per process (the retry must not re-fire)

export const SEG_C: Seg = {
    id: 'C', title: 'seeds, dried pool, bravery, lower dungeon, crystal heart, boulder, the dagger', fromStage: 12, toStage: 20,
    pre: PRE,
    supply: [],   // nothing BEFORE the segment: B leaves the pack full; the kit comes via ctx.resupply after the drop
    async run(bot, ctx) { return withSafety(bot, () => segC(bot, ctx.verbose, '', ctx.resupply, ctx.helper)); },
};

/** `from` (debug harness c-dbg.ts only): start at a later phase; the account must already be in that phase's state. */
// session 11 fix 391: 385a (walkOp GAMECLICK: a walk breaks off a fight, qx312 Gujuo retry) is scoped to segment C; as a
// global default it lost door ops in Eadgar (4 deaths in qx315-324). LG_C_WALK_CLEAR=0 turns it off here too.
export async function segC(bot: SpeedBot, verbose: boolean, from: Phase = '', resupply?: (items: Array<{ name: string; n: number }>) => Promise<void>, helper?: LegHelper): Promise<Record<string, unknown>> {
    const wc0 = QLIB.walkClear;
    if (process.env.LG_C_WALK_CLEAR !== '0') QLIB.walkClear = true;
    // fix 422 ( acct25: the C meeting's bank-helper visit could not fit the kit and its !fits() branch banked every
    // held item the kit did not name - map, machete, rune axe, lockpick, pickaxe, bowl, seeds - then 'belt south 1: not done after
    // 181 t', msgs=[] (jungle_tree.rs2 says 'you need ...' in a MESBOX)): while C runs, bankVisit treats C's tools as precious
    // (route-lib.ts bot.srBankPrecious). LG_C_TOOLS=0 reverts.
    const pr0 = (bot as any).srBankPrecious;
    if (process.env.LG_C_TOOLS !== '0') (bot as any).srBankPrecious = C_PRECIOUS;
    try { return await segC0(bot, verbose, from, resupply, helper); } finally { QLIB.walkClear = wc0; (bot as any).srBankPrecious = pr0; }
}

async function segC0(bot: SpeedBot, verbose: boolean, from: Phase = '', resupply?: (items: Array<{ name: string; n: number }>) => Promise<void>, helper?: LegHelper): Promise<Record<string, unknown>> {
    const meetWant = () => [...SEG_C_MEET, { name: 'shark', n: MIN_SHARKS }];
    const meetMissing = () => meetWant().filter(i => bot.count(i.name) < i.n).map(i => ({ name: i.name, n: i.n - bot.count(i.name) }));
    const phase = (k: Phase) => PHASES.indexOf(start) <= PHASES.indexOf(k);   // (293b: `start` = from, or a resume phase)
    const navN = await nav();
    bot.holdDialogs = true;
    // Resume (LG_C_OUTSIDE=1, set only by legs/qp/route/existing-lib.ts; a C resumed at the Legends' Guild failed
    // 'ungadulu seeds: not done'): a resumed C that starts OUTSIDE the Kharazi/Shilo overworld box and outside the caves first
    // travels to the belt meeting (route planner: glory to Karamja + walk, as fix 415 does for B). From there the 293b overworld
    // resume takes over when the germinated seeds are held; at stage 12 (no seeds yet) the out12 path below goes in: chop south
    // (the chop empties the blessed bowl, jungle_tree.rs2:28-49), refill it at the pool with a hollow reed (quest_legends.rs2
    // oplocu sacred_water: goldbowlbless_empty -> _pure below germinated), the cave rocks, then the octagram's fire wall, which
    // walks you through from stage 12 on (legends_touch_fire_wall), to Ungadulu.
    let out12 = false, early417 = false;
    if (process.env.LG_C_OUTSIDE === '1' && from === '' && isResuming(bot)) {
        const t = bot.tile(), lv = bot.minusedlevel;
        const inCat0 = lv === 0 && t.x >= 2740 && t.x <= 2840 && t.z >= 9270 && t.z <= 9360;
        const inViy0 = t.x >= 2350 && t.x <= 2440 && t.z >= 4670 && t.z <= 4745;
        const inOw0 = lv === 0 && t.x >= 2740 && t.x <= 2900 && t.z >= 2880 && t.z <= 3130;
        if (!inCat0 && !inViy0 && !inOw0) {
            const { travelTo } = await import('../qp/route/route-lib.js');
            console.log(`[segC] F3: C resumed outside the jungle/caves at ${JSON.stringify(bot.pos())}: travel to the belt meeting ${MEET.C.x},${MEET.C.z}`);
            const r = await travelTo(bot, { x: MEET.C.x, z: MEET.C.z, level: 0 }, new Set<string>(), { near: 2, tag: 'legends-C', maxTicks: 900 });
            console.log(`[segC] F3: travel ${r.ok ? 'OK' : 'short'} (${r.how}, ${r.ticks} t) -> ${JSON.stringify(bot.pos())}`);
            if (cheb(bot.tile(), MEET.C) > 3) throw new Error(`segC: F3 travel to the belt meeting failed (${r.how}, ${r.ticks} t, at ${JSON.stringify(bot.pos())})`);
        }
        const t2 = bot.tile();
        const octagram = t2.x >= 2789 && t2.x <= 2796 && t2.z >= 9325 && t2.z <= 9332;
        out12 = !octagram && bot.count(O.germ) === 0 && bot.count(O.seeds) === 0 && (bot.count(O.bowlPure) > 0 || bot.count(O.bowlEmpty) > 0)
            && (bot.minusedlevel === 0 && t2.x >= 2740 && t2.x <= 2900 && t2.z >= 2880 && t2.z <= 3130 || (t2.z > 9000 && t2.z >= 9334));
        if (out12) console.log(`[segC] F3 out12: stage-12 resume outside the octagram at ${JSON.stringify(t2)} (bowl ${bot.count(O.bowlPure) ? 'pure' : 'empty'})`);
    }
    // session 11 T3 (qx02: the retry after 'lockpick gate' restarted at Ungadulu's seeds at the lockpick gate and its junk drop
    // threw away the germinated seeds + D's boost potions): a RETRY keeps C's own quest items, and one that is past the
    // bookcase crevice (x >= 2799 or south of the strength gate, in the catacombs) holding the germinated seeds goes on at the
    // lockpick gate (every catacomb step is gated on position, so passed ones finish at once); in the shaman cave north part
    // (z >= 9334) with the seeds and no bullroarer (helper mode drops it after the belt = herbs + bravery done) it goes on at
    // the bookcase. No helper dispatch, no kit check on a resume. LG_C_RESUME=0 reverts.
    const tr = bot.tile(), inCat = bot.minusedlevel === 0 && tr.x >= 2740 && tr.x <= 2840 && tr.z >= 9270 && tr.z <= 9360;
    const germHeld = bot.count(O.germ) > 0;
    const rp: '' | 'bookcase' | 'lockgate' = process.env.LG_C_RESUME === '0' || from !== '' || !isResuming(bot) || !inCat || !germHeld ? ''
        : (tr.x >= 2799 || tr.z <= 9313) ? 'lockgate' : (tr.z >= 9334 && helper && bot.count(O.bullroarer) === 0) ? 'bookcase' : '';
    if (rp && verbose) console.log(`[segC] resume at the ${rp} from ${JSON.stringify(tr)} (germinated seeds held)`);
    // session 11 fix 293b (qx44m + qyu09m 'gujuo' retry and qyu11m 'boulder/echned' retry: all three failed in 31 t at 'fire
    // wall' because T3 only resumes INSIDE the catacombs; anywhere else a retry restarted at step 1, whose seeds/germinate
    // checks pass at once, and then op'd the octagram's fire wall from the Kharazi jungle or the Viyeldi caves; also the winch
    // room (north of the magic gate) fell through T3): resume by where the bot is.
    //  - overworld (Kharazi/Shilo, germinated seeds held): the JOURNAL stage (13 germinated / 14 pool dried / 15 Gujuo told
    //    us the recipe) + position (north/south of the x=2816 belt) + the bravery items decide the first step;
    //  - catacombs west of the strength gate: the gem room / magic gate -> 'gate', the winch room -> 'winch';
    //  - Viyeldi caves: past the barrier -> 'boulder', heart / glowing heart / all 3 crystals -> 'furnace', main cave
    //    reachable -> 'heroes', else 'ledges'.
    // LG_C_RESUME2=0 reverts.
    let ow = 0, start: Phase = from;
    const holds = (o: number) => bot.count(o) > 0;
    if (process.env.LG_C_RESUME2 !== '0' && from === '' && !rp && isResuming(bot) && bot.minusedlevel === 0) {
        const inViy = tr.x >= 2350 && tr.x <= 2440 && tr.z >= 4670 && tr.z <= 4745;
        const inOw = tr.x >= 2740 && tr.x <= 2900 && tr.z >= 2880 && tr.z <= 3130;
        if (inViy) {
            const MAINC = { x: 2395, z: 4712 };
            let p: Tile[] = []; try { p = navN.findLongPath(0, tr.x, tr.z, MAINC.x, MAINC.z, 500); } catch { p = []; }
            const pe = p[p.length - 1], main = (tr.x === MAINC.x && tr.z === MAINC.z) || (!!pe && cheb(pe, MAINC) <= 1);
            start = tr.z <= 4690 && tr.x >= 2375 ? 'boulder'
                : holds(O.heart) || holds(O.heartGlow) || (holds(O.crystalA) && holds(O.crystalB) && holds(O.crystalC)) ? 'furnace'
                : main ? 'heroes' : 'ledges';
        } else if (inCat && tr.x <= 2770 && tr.z >= 9314) start = 'winch';
        else if (inCat && tr.x <= 2790 && tr.z <= 9313) start = 'gate';
        else if (inOw && germHeld) {
            if (bot.chatModalId !== -1) { bot.closeModal(); bot.queueFlush(); await bot.tick(1); }
            ow = await journalStage<number>(bot, 'legends', [[/Viyeldi/i, 15], [/some more .{0,16}sacred water/i, 14], [/germinated .{0,16}Yommi/i, 13]], 13,
                s => console.log(`[segC] ${s}`));
        }
        if (start !== '' || ow) console.log(`[segC] 293b resume from ${JSON.stringify(tr)}: ${start ? `phase '${start}'` : `overworld, journal stage ${ow}`}`);
    }
    // session 11 fix 361b (qx175m: DIED at Gujuo, then the retry stood at Camelot and 'segC ungadulu seeds: not done after 61 t at
    // (2728,3346)' -> ROUTE STOPPED): a death keeps 3 items. The blessed bowl, germinated seeds, machete, bullroarer, map, lockpick and
    // book of binding are gone. Steps 1-2 need the blessed bowl of pure water (germinate) or the germinated seeds, and a new
    // bowl = B again (gold bars + hammer from a 2nd helper kit, Gujuo's blessing): no recovery on the route. Fail at once with the
    // real cause, as 354 does for B. LG_C_LOST=0 reverts; TEST: LG_C_LOST_TEST=1.
    if (process.env.LG_C_LOST !== '0' && from === '' && !rp && start === '' && !ow && !out12
        && (process.env.LG_C_LOST_TEST === '1' || (!germHeld && !holds(O.bowlPure))))
        throw new Error(`segC: cannot go on: blessed bowl + germinated seeds lost (a death?): bowlPure=${holds(O.bowlPure)} germ=${germHeld} machete=${holds(O.machete)} - a new bowl needs B's kit again`);
    // overworld stage 15: which of belt-north / herbs+bravery / belt-south / cave rocks are still to do
    const northOfBelt = () => bot.tile().z >= 2940;
    const preDrink = () => [O.vialWater, O.snakeSol, O.brave, O.unidSnake, O.snake, O.unidArd, O.ard].some(holds) || (!!helper && holds(O.bullroarer));
    // ---- 0. drop what C does not need, wield the scimitar, then the kit hand-off --------------------------------------
    {
        // helper mode keeps E's Camelot runes (law + air) too
        // Glory kept (LG_B_KEEP_GLORY=1, existing-lib.ts only; the glory guard refuses the drop ('segC: could not drop 1706')
        // and the bank-as-helper needs the glory for C's belt trip too): the travel glory is kept
        const GLK = process.env.LG_B_KEEP_GLORY === '1' ? ['amulet_of_glory_4', 'amulet_of_glory_3', 'amulet_of_glory_2', 'amulet_of_glory_1', 'amulet_of_glory'] : [];
        const KEEP1 = helper ? [...KEEP, 'lawrune', 'airrune', ...GLK] : [...KEEP, ...GLK];
        // (T3) a retry keeps what C (and, helper mode, D) already has: seeds, herbs/mixes, crystals, the dagger, D's boosts
        const KEEP2 = process.env.LG_C_RESUME !== '0' && isResuming(bot) ? [...KEEP1, 'yommiseeds', 'yommiseeds_germ', 'reed_hollow', 'snake_weed',
            'ardrigal', 'snakeweed_sol', 'ardrigal_sol', 'bravery_pot', 'heartcrystal_sectiona', 'heartcrystal_sectionb', 'heartcrystal_sectionc',
            'heartcrystal', 'heartcrystal_glow', 'deathdagger', 'vial_empty',
            ...[1, 2, 3, 4].flatMap(n => [`${n}dose2attack`, `${n}dose2strength`])] : KEEP1;
        const keep = new Set(KEEP2.map(objId));
        for (let k = 0; k < 4 && bot.inv().some(s => !keep.has(s.obj)); k++) { dropAllExcept(bot, KEEP2); await bot.tick(2); }
        if (bot.inv().some(s => !keep.has(s.obj))) throw new Error(`segC: could not drop ${bot.inv().filter(s => !keep.has(s.obj)).map(s => s.obj).join(',')}`);
        const SCIM = O.scimitar;
        for (let k = 0; k < 5 && !bot.isWorn(SCIM) && bot.slot(SCIM) >= 0; k++) { bot.opHeld2(SCIM, bot.slot(SCIM)); bot.queueFlush(); await bot.until(() => bot.isWorn(SCIM), 3); }
        if (!bot.isWorn(SCIM)) throw new Error('segC: rune scimitar neither worn nor held');
        // helper mode: no hand-off here (inside the caves); the kit comes at MEET.C (step 6), the helper is sent ahead now
        if (helper && from === '' && !rp && start === '' && (!ow || bot.count(O.bullroarer) > 0)) { const mm = meetMissing(); if (mm.length) helper.send(MEET.C, mm, 'legends C belt'); }
        const want = from === '' && !helper && !rp && start === '' && !ow ? [...SEG_C_KIT, { name: 'shark', n: MIN_SHARKS }] : [];
        const missing = want.filter(i => bot.count(i.name) < i.n).map(i => ({ name: i.name, n: i.n - bot.count(i.name) }));
        if (missing.length) {
            const slots = missing.reduce((n, i) => n + (/rune$/.test(i.name) && bot.count(i.name) > 0 ? 0 : /rune$/.test(i.name) ? 1 : i.n), 0);
            if (bot.free() < slots) throw new Error(`segC: no room for the kit: ${bot.free()} free < ${slots}`);
            if (!resupply) throw new Error(`segC: kit missing (${missing.map(i => i.name).join(',')}) and no resupply hand-off`);
            await resupply(missing); await bot.tick(1);
            const still = want.filter(i => bot.count(i.name) < i.n).map(i => i.name);
            if (still.length) throw new Error(`segC: kit incomplete after hand-off: ${still.join(',')}`);
        }
        if (verbose) console.log(`[segC] kit ready: pack ${bot.inv().length}/28, free ${bot.free()}, sharks ${bot.count('shark')}`);
    }
    const t0 = bot.tickCount, m: Record<string, unknown> = {};
    // failHook (resume proofs): SR_FAIL_AT=C:<mark> throws once right after that mark
    const at = (k: string) => { m[k] = bot.tickCount - t0; if (verbose) log(bot, t0, `${k} pos=${JSON.stringify(bot.pos())} hp=${bot.stat('hitpoints').cur}`); failHook(`C:${k}`); };
    const fail = (s: string): never => { throw new Error(`segC ${s} at ${JSON.stringify(bot.pos())} msgs=${JSON.stringify(msgsSince(bot, bot.tickCount - 30).slice(-5))}`); };
    const has = (o: number) => bot.count(o) > 0;
    const tile = () => bot.tile();
    // winchRope (2935) only exists live (lg_winchdown_norope loc_changes to it): the static scene has 2934 there
    const loc = (k: LocKey) => { const [id, x, z] = L[k]; return k === 'winchRope' ? { ...locAt(2934, x, z, 0), id } : locAt(id, x, z, 0); };
    const textSeen = (re: RegExp) => [...bot.ifText.values()].some(v => re.test(v));
    const eat = () => { const h = bot.stat('hitpoints'); if (h.cur <= Math.floor(h.level * 0.5) && has(O.shark)) { bot.opHeld1(O.shark, bot.slot(O.shark)); bot.queueFlush(); } };
    const pot = () => bot.inv().find(s => POTS.includes(s.obj));
    /** Before a fight: eat to >= hpFrac and drink prayer restores to >= prFrac of the levels. */
    const topUp = async (hpFrac: number, prFrac: number) => {
        for (let k = 0; k < 10; k++) {
            const h = bot.stat('hitpoints'), pr = bot.stat('prayer');
            const e = h.cur < h.level * hpFrac && has(O.shark), p = pr.cur < pr.level * prFrac ? pot() : undefined;
            if (!e && !p) break;
            if (e) bot.opHeld1(O.shark, bot.slot(O.shark)); else if (p) bot.opHeld1(p.obj, p.slot);
            bot.queueFlush(); await bot.tick(3);
        }
        if (verbose) console.log(`[segC] top-up: hp ${bot.stat('hitpoints').cur} pray ${bot.stat('prayer').cur} sharks ${bot.count(O.shark)} pots ${bot.inv().filter(s => POTS.includes(s.obj)).length}`);
    };

    // generic step: (walk to `stand`, op on arrival), then keep re-sending `op` every `every` ticks while no dialog is open;
    // answer choice pages by text, continue other pages; until done().
    const step = async (label: string, op: () => void, done: () => boolean, o: { stand?: Tile; near?: number; answers?: RegExp[]; maxTicks?: number; every?: number; walkTicks?: number; tick?: () => void; extra?: () => number } = {}) => {
        const s0 = bot.tickCount, max = o.maxTicks ?? 60, every = o.every ?? 4;
        if (done()) return;
        if (o.stand) await walkOp(bot, o.stand, op, () => done() || bot.chatModalId !== -1, { near: o.near ?? 0, maxTicks: o.walkTicks ?? 400 });
        else { op(); bot.queueFlush(); }
        let last = bot.tickCount, lastSig = '', lastClick = -99;
        // session 11 T1 (qx02 'lockpick gate' + qx03 seg D strength gate): a plain page (message1 356, 'CLICK!') stayed open for
        // 61 t while we resumed it every tick: the engine refuses RESUME_PAUSEBUTTON while a stale resume-button list from an
        // earlier choice is registered (ResumePauseButtonHandler; a choice that left without IF_BUTTON / with modalState NONE
        // keeps it). CLOSE_MODAL on the suspended page clears activeScript + resumeButtons (Player.closeModal), then the op is
        // re-sent (the lockpick/strength roll just runs again). A page is stale when no new chat/modal packet (ackRevs Modal)
        // came for 5 t of resumes. LG_C_STALE=0 reverts.
        let pageRev = -1, pageT = bot.tickCount;
        const modalRev = () => Number((bot as any).ackRevs?.[5] ?? 0);   // Rev.Modal (interaction-ack.ts)
        const s1 = bot.tickCount;
        // fix 422: interface text set during this step (a MESBOX 'You need an axe ...' is no chat message: msgs=[] hid it)
        // (recorded only while a chat modal is open; the rest of ifText is music/sidebar noise, sim lgc2 'modal="Fanfare3"')
        const tx0 = new Map(bot.ifText), seenTxt: string[] = [];
        const noteTxt = () => { for (const [c, v] of bot.ifText) { if (!v || !v.trim() || tx0.get(c) === v) continue; tx0.set(c, v); const t = v.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim(); if (t && !seenTxt.includes(t)) seenTxt.push(t); } };
        const stepTxt = () => seenTxt.length ? ` modal=${JSON.stringify(seenTxt.slice(-4).join(' | ').slice(0, 240))}` : '';
        while (!done()) {
            if (bot.tickCount - s1 - (o.extra?.() ?? 0) > max) fail(`${label}: not done after ${bot.tickCount - s0} t${process.env.LG_C_TOOLS !== '0' ? stepTxt() : ''}`);   // fix 385b: extra
            if (bot.chatModalId !== -1) noteTxt(); else for (const [c, v] of bot.ifText) tx0.set(c, v);
            eat(); o.tick?.();   // session 11 fix 361: per-tick hook (gujuo: Protect from Melee while a jungle animal fights us)
            if (bot.chatModalId !== -1) {
                const opts = bot.dialogOptions();
                if (opts.length) {
                    const sig = opts.map(x => x.text).join('|');
                    if (sig !== lastSig || bot.tickCount - lastClick >= 4) {
                        let hit = -1;
                        for (const re of o.answers ?? []) { hit = bot.clickDialogByText(re); if (hit > 0) break; }
                        // session 11 T2 (qx02 cave rocks: Gujuo's menu [Where can I get more water ...|Ok thanks for your help.]
                        // came up, was CLOSED, and the next plain page at the lockpick gate never resumed): leave an unplanned
                        // menu through its own exit option (IF_BUTTON ends the script and clears its resume buttons); close
                        // only if it has none. LG_C_CHOICE_EXIT=0 reverts.
                        if (hit < 0 && process.env.LG_C_CHOICE_EXIT !== '0') {
                            hit = bot.clickDialogByText(/^(Ok,? thanks?|Thanks|Goodbye|Bye|No,? thanks|Nothing|Never ?mind|No, I'm having second thoughts|I'll be going)/i);
                            if (hit > 0) console.log(`[segC] ${label}: unplanned choice [${sig}] -> exit option`);
                        }
                        if (hit < 0) { console.log(`[segC] ${label}: unplanned choice [${sig}]`); bot.closeModal(); }
                        lastSig = sig; lastClick = bot.tickCount;
                    }
                } else {
                    const r = modalRev();
                    if (r !== pageRev) { pageRev = r; pageT = bot.tickCount; }
                    if (process.env.LG_C_STALE !== '0' && bot.tickCount - pageT >= 5) {
                        console.log(`[segC] ${label}: page ${bot.chatModalId} not resuming for ${bot.tickCount - pageT} t (stale resume buttons?) -> close + re-op`);
                        dismiss(bot); pageRev = -1; pageT = bot.tickCount;
                    } else bot.resumeDialogPage();
                }
                bot.queueFlush(); last = bot.tickCount;
            } else if (bot.tickCount - last >= every) { op(); bot.queueFlush(); last = bot.tickCount; }
            await bot.tick(1);
        }
        if (verbose) log(bot, t0, `${label} done in ${bot.tickCount - s0} t`);
    };
    const opL = (k: LocKey, op = 1) => () => { const l = loc(k); routeToLoc(bot, l); bot.opLoc(l.x, l.z, l.id, op); };
    const useL = (obj: number, k: LocKey) => () => { const l = loc(k); const s = bot.slot(obj); if (s < 0) return; routeToLoc(bot, l); bot.useItemOnLoc(l.x, l.z, l.id, obj, s); };
    const useOn = (useObj: number, target: number) => () => { const a = bot.slot(target), b = bot.slot(useObj); if (a >= 0 && b >= 0) bot.useItemOnItem(target, a, useObj, b); };
    const held1 = (obj: number) => () => { const s = bot.slot(obj); if (s >= 0) bot.opHeld1(obj, s); };
    const opLocT = (k: LocKey, spell: string) => () => {
        const l = loc(k);
        const out = (bot as any).out; out.p1Enc(ClientProt.OPLOCT); out.p2(l.x); out.p2(l.z); out.p2(l.id); out.p2(spellCom(spell));
    };
    const walk = async (label: string, dest: Tile, near = 1, maxTicks = 400) => {
        if (!(await walkOp(bot, dest, null, () => false, { near, maxTicks }))) fail(`walk ${label} (${dest.x},${dest.z})`);
    };
    const close = () => { dismiss(bot); bot.queueFlush(); };

    // free-slot guard before a step that RECEIVES an item: make room by dropping coins, then sharks beyond 1 (eat first if hurt)
    const room = async (n: number, label: string) => {
        for (let k = 0; k < 6 && bot.free() < n; k++) {
            const c = bot.slot('coins'), sh = bot.slot(O.shark);
            if (c >= 0) bot.dropItem(objId('coins'), c);
            else if (sh >= 0 && bot.count(O.shark) > 1) { if (bot.stat('hitpoints').cur < bot.stat('hitpoints').level - 20) bot.opHeld1(O.shark, sh); else bot.dropItem(O.shark, sh); }
            else break;
            bot.queueFlush(); await bot.tick(2);
        }
        if (bot.free() < n) fail(`${label}: pack full (${bot.free()} free, need ${n})`);
    };
    // ---- F3 out12: from the overworld (or the main cave) back into the octagram at stage 12 --------------------------------
    if (out12) {
        if (bot.minusedlevel === 0 && tile().z < 9000) {
            if (northOfBelt()) { await chopBelt('south'); at('F3 belt-south'); }
            if (!has(O.bowlPure)) {
                await room(1, 'F3 reed');
                await step('F3 cut reed', useL(O.machete, 'reeds'), () => has(O.reed) || has(O.bowlPure), { stand: { x: 2836, z: 2917 }, near: 2, every: 4, maxTicks: 30 });
                await step('F3 refill bowl', useL(O.reed, 'pool'), () => has(O.bowlPure), { every: 4, maxTicks: 30 });
                close(); at('F3 bowl refilled');
            }
            await step('F3 cave rocks', opL('caveRock'), () => tile().z > 9000, { stand: { x: 2781, z: 2935 }, near: 1, answers: [/crawl through/i], every: 6, maxTicks: 90 });
            at('F3 cave-in');
        }
        await walk('F3 to the fire wall', { x: 2795, z: 9334 }, 0, 200);
        await step('F3 fire wall in', opL('firewallN'), () => tile().z <= 9332, { every: 4, maxTicks: 30 });
        close(); at('F3 octagram');
    }
    if (phase('') && start === '') {
    if (!rp) {
    if (!ow) {   // (293b: an overworld resume skips steps 1-3)
    // ---- 1. seeds from Ungadulu --------------------------------------------------------------------
    await room(1, 'seeds');
    await step('ungadulu seeds', () => { const n = npc(bot, UNGADULU); if (n) opNpcGo(bot, n, 1); }, () => has(O.seeds) || has(O.germ),
        { answers: [/Yommi tree seeds for Gujuo/i], every: 6, maxTicks: 60 });
    close(); at('seeds');
    // ---- 2. germinate ----------------------------------------------------------------------------------
    await step('germinate', useOn(O.seeds, O.bowlPure), () => has(O.germ), { every: 4, maxTicks: 20 });
    close(); at('germinated');
    // ---- 3. out of the octagram and the cave -----------------------------------------------------------
    await step('fire wall', opL('firewallN'), () => tile().z >= 9334, { every: 4, maxTicks: 30 });
    await step('cave exit', opL('caveExit'), () => tile().z < 4000, { stand: { x: 2773, z: 9341 }, near: 1, every: 5, maxTicks: 30 });
    at('outside');
    }
    if (ow < 14) {   // (293b: journal stage 14 = the pool is dry already)
    // ---- 4. reed + the pool -----------------------------------------------------------------------------
    await room(1, 'reed');
    await step('cut reed', useL(O.machete, 'reeds'), () => has(O.reed), { stand: { x: 2836, z: 2917 }, near: 2, every: 4, maxTicks: 30 });
    await step('pool dries', useL(O.reed, 'pool'), () => textSeen(/pool has dried up/i), { every: 4, maxTicks: 30 });
    close(); at('pool-dried');
    }
    if (ow < 15) {   // (293b: journal stage 15 = Gujuo gave the recipe)
    // fix 417 ( acct9: B left Nezikchened at hp 25 with no sharks and C walked the jungle at hp 20; its first
    // food was MEET.C, after Gujuo, whose bullroarer angers jungle savages (lvl 90; fix 361 qx175m died there)): with hp + 20 x
    // sharks below hp level + 10, take MEET.C's kit now (the bowl is empty since the germination, a chop is harmless), eat up,
    // and chop back in for Gujuo; step 6 then meets again only for what is still missing (sharks only when below 3).
    // LG_C_SAFE=0 reverts. TEST: LG_C_SAFE_TEST=1 drops all sharks first.
    if (helper && process.env.LG_C_SAFE !== '0' && process.env.LG_B_SAFE !== '0') {
        if (process.env.LG_C_SAFE_TEST === '1') { for (let k = 0; k < 12 && has(O.shark); k++) { bot.dropItem(O.shark, bot.slot(O.shark)); bot.queueFlush(); await bot.tick(1); } }
        const h = bot.stat('hitpoints'), eff = h.cur + 20 * bot.count(O.shark);
        console.log(`[segC] 417 food check before Gujuo: hp ${h.cur}/${h.level} sharks ${bot.count(O.shark)} pots ${bot.inv().filter(s => POTS.includes(s.obj)).length} -> ${eff < h.level + 10 ? 'EARLY MEET' : 'ok'}`);
        if (eff < h.level + 10) {
            await chopBelt('north');
            for (let k = 0; k < 6 && bot.count('logs') > 0; k++) { dropAllOf(bot, ['logs']); await bot.until(() => bot.count('logs') === 0, 3); }
            await walk('helper meet (417)', MEET.C, 1, 40);
            // food only (sharks to MIN_SHARKS, a prayer potion if none), 3 slots kept: the jungle chop needs a free slot for its
            // logs (sim lgxv: the whole C kit + 6 sharks filled the pack 28/28 and 'belt south 1' did nothing for 85 t x3); the
            // C kit still comes at step 6, after the bullroarer/reed drop
            const nPot = bot.inv().some(s => POTS.includes(s.obj)) ? 0 : 1;
            const nSh = Math.max(0, Math.min(MIN_SHARKS - bot.count(O.shark), bot.free() - 3 - nPot));   // (3: a chop log + the bank trip's spare glory, existing.ts 417)
            const mm = [...(nSh > 0 ? [{ name: 'shark', n: nSh }] : []), ...(nPot ? [{ name: '4doseprayerrestore', n: 1 }] : [])];
            const ok = mm.length ? await helper.meet(MEET.C, mm, 'legends C food (417 early)') : true;
            await bot.tick(1);
            await topUp(0.85, 0);
            console.log(`[segC] 417 early meet ${ok ? 'OK' : 'FAILED'}: hp ${bot.stat('hitpoints').cur} sharks ${bot.count(O.shark)} pots ${bot.inv().filter(s => POTS.includes(s.obj)).length}`);
            early417 = true;
            await chopBelt('south');
            at('417 early meet');
        }
    }
    // ---- 5. Gujuo ------------------------------------------------------------------------------------------
    // bullroarer.rs2: 1 in 6 a nearby oomlie bird / jungle savage / jungle wolf attacks instead; while fighting, every swing
    // re-arms %action_delay and the bullroarer only says "too busy": kill the attacker first, then swing again
    const HOSTILE = [48, 143, 931];
    // (only fight after "takes a dislike" since the last swing: attacking a passing bird unprovoked just starts a fight)
    // AND every hostile within 10 tiles gets its own 1/6 roll first: at the pool ~10 savages/wolves/birds stand within 10,
    // so ~84% of swings start a fight. At the belt crossing (2815,2935) usually none are in range (probe c-npcs.ts).
    // (kharazi_jungle zone = x 2757-2974, z 2882-2935: the belt tile 2816,2936 is just outside it, so 2815,2935)
    // session 11 fix 293a (CONFIRMED qx44m + qyu09m 'gujuo: not done after 301 t' at (2815,2936): every swing there said
    // 'Nothing much seems to happen though.' = bullroarer.rs2 [queue,bullroarer_out_jungle]: (2815,2936) is ONE tile north of
    // the kharazi_jungle zone (legends_zones.dbrow 0_43_45_5_2..0_46_45_30_55 = x 2757-2974, z 2882-2935). The walk reached
    // 2815,2935, then fighting an angry animal ('takes a dislike', attack xp in both logs) or walking to a Gujuo moved the bot
    // off it, and every later swing (300 t) was outside the zone): swing only from inside the zone; off it, step back to the
    // spot first. LG_C_GUJUO_ZONE=0 reverts. TEST: LG_C_GUJUO_TEST=1 walks to (2815,2936) first (the qx44 tile).
    const GSPOT = { x: 2815, z: 2935 };
    const inJungle = (t: Tile) => t.x >= 2757 && t.x <= 2974 && t.z >= 2882 && t.z <= 2935;
    const gujuoTest = process.env.LG_C_GUJUO_TEST === '1';
    await walk('gujuo spot', gujuoTest ? { x: 2815, z: 2936 } : GSPOT, 0, 120);
    if (test385) {   // session 11 fix 385a TEST: start a fight off the spot, then fail; the retry's walk must break off the fight
        test385 = false;
        const a = npcsOf(bot, HOSTILE).filter(q => q.d >= 3 && q.d <= 12).sort((x, y) => x.d - y.d)[0];
        if (a) { console.log(`[segC] 385 TEST: attacking npc ${a.type} at ${a.x},${a.z} d${a.d}`); opNpcGo(bot, a, 2); bot.queueFlush(); }
        for (let k = 0; k < 30 && !npcsOf(bot, HOSTILE).some(q => q.d <= 1); k++) await bot.tick(1);
        await bot.tick(4); fail('385 TEST: forced gujuo fail in a fight');
    }
    let swingT = bot.tickCount, offZone = 0;
    // session 11 fix 361 (qx175m DIED here: C began hp 56 / 2 sharks / prayer 25 (A's + B's savage fights ate the rest; helper
    // mode tops sharks up only at MEET.C, after Gujuo); at the gujuo spot 3 Jungle Savages (npc 931: lvl 90, 90 hp, ~70 t a kill)
    // took a dislike to the bullroarer one after another (engine optrace t62181-62387, 2813-2817,2933-2935): hp 57 -> 36 -> 15
    // -> 3 -> dead, Protect from Melee off the whole time (B's killAggressors prays, this step never did). Now: pray melee while a
    // jungle animal stands next to us facing a player (seg-b attackers()), a prayer potion below 10 points (MEET.C right after
    // restocks 3 x 4-dose: SEG_C_MEET counts 4-dose only, so a 2/3-dose spent here is free). LG_C_GUJUO_PRAY=0 reverts.
    // TEST: LG_C_GUJUO_PRAY_TEST=1 attacks the nearest jungle animal (<= 12 tiles) once before the first swing.
    const prayOn = process.env.LG_C_GUJUO_PRAY !== '0';
    let prayTest = process.env.LG_C_GUJUO_PRAY_TEST === '1', fightT = -99, potT = -99, prayLog = 0;
    // session 11 fix 385b (qx312m 'gujuo: not done after 301 t': 5 jungle animals in a row took a dislike (engine optrace: savage
    // 56 t, savage 57 t, savage 57 t, wolf 37 t, savage 44+ t = 248 of 301 t fighting; the chases (opNpcGo to d<=4) dragged the bot
    // 8 tiles east to (2823,2926), into more animals): a fight tick no longer counts against the 300 t Gujuo budget (up to +300 t),
    // only an animal NEXT to us facing a player is fought (it walks up to us by itself), and a fight with no prayer left (pr 0,
    // no pot, hp < 40) fails at once: a death loses the bowl (361b). LG_C_GUJUO_FIGHTBUDGET=0 reverts.
    const fb385 = process.env.LG_C_GUJUO_FIGHTBUDGET !== '0';
    let fightTicks = 0;
    const gujuoPray = () => {
        if (!prayOn) return;
        if (npcsOf(bot, HOSTILE).some(q => q.d <= 1 && ((bot.npcs[q.idx] as any)?.faceEntity ?? -1) >= 32768)) fightT = bot.tickCount;
        const fighting = bot.tickCount - fightT < 8, on = bot.isPrayerActive('protectfrommelee'), pr = bot.stat('prayer').cur;
        if (fb385 && fighting) {   // fix 385b
            fightTicks = Math.min(300, fightTicks + 1);
            if (pr === 0 && !pot() && bot.stat('hitpoints').cur < 40) fail(`gujuo: out of prayer in a fight (hp ${bot.stat('hitpoints').cur}, sharks ${bot.count(O.shark)})`);
        }
        if (fighting && pr < 10 && bot.tickCount - potT >= 3 && bot.chatModalId === -1) { const p = pot(); if (p) { bot.opHeld1(p.obj, p.slot); bot.queueFlush(); potT = bot.tickCount; return; } }
        if (fighting && !on && pr > 0) {
            bot.activatePrayer('protectfrommelee'); bot.queueFlush();
            if (prayLog++ < 6) console.log(`[segC] 361 gujuo: Protect from Melee ON (hp ${bot.stat('hitpoints').cur} pray ${pr} sharks ${bot.count(O.shark)})`);
        } else if (!fighting && on) { (bot as any).setPrayer('protectfrommelee', false); bot.queueFlush(); }
    };
    await step('gujuo', () => {
        if (prayTest) { prayTest = false; const a = npcsOf(bot, HOSTILE).filter(q => q.d <= 12).sort((x, y) => x.d - y.d)[0]; if (a) { console.log(`[segC] 361 TEST: attacking npc ${a.type} at ${a.x},${a.z} d${a.d}`); opNpcGo(bot, a, 2); return; } }   // fix 361 TEST
        const angry = msgsSince(bot, swingT).some(t => /takes a dislike/i.test(t));
        const h = fb385 ? npcsOf(bot, HOSTILE).find(q => q.d <= 1 && ((bot.npcs[q.idx] as any)?.faceEntity ?? -1) >= 32768)   // fix 385b
            : angry ? npcsOf(bot, HOSTILE).find(q => q.d <= 4) : undefined;
        // a Gujuo already in view (his walk-up can stall, or one is left from B's summon): talk to him instead of swinging
        const g = npc(bot, 928);
        const me = tile();
        if (h) opNpcGo(bot, h, 2); else if (g && g.d <= 15) opNpcGo(bot, g, 1);
        else if (process.env.LG_C_GUJUO_ZONE !== '0' && !inJungle(me)) {
            let p: Tile[] = []; try { p = navN.findLongPath(0, me.x, me.z, GSPOT.x, GSPOT.z, 500); } catch { p = []; }
            const dense = densify([me, ...p]).slice(1);
            console.log(`[segC] 293a gujuo: (${me.x},${me.z}) is outside the kharazi_jungle zone (off-zone #${++offZone}: a swing would do nothing) -> back to ${GSPOT.x},${GSPOT.z}${dense.length ? '' : ' (NO PATH)'}`);
            if (dense.length) bot.sendRoute(turning(me, dense), true);
        } else { swingT = bot.tickCount; held1(O.bullroarer)(); }
    }, () => bot.dialogOptions().some(x => /Where can I find Snake weed/i.test(x.text)),
        { answers: [/water pool has dried up/i, /Where is the source of the spring/i, /If I went, could you help me/i], every: 9, maxTicks: 300, tick: gujuoPray, extra: () => fightTicks });   // fix 385b
    if (bot.isPrayerActive('protectfrommelee')) { (bot as any).setPrayer('protectfrommelee', false); bot.queueFlush(); }   // fix 361
    close(); at('gujuo');
    }
    // (293b) overworld stage 15: north/south of the belt + whether the bravery items are still held (= not drunk yet)
    const n15 = ow === 15 && northOfBelt(), pd15 = ow === 15 && preDrink();
    const doHerbs = ow < 15 || pd15;
    if (ow === 15) console.log(`[segC] 293b stage 15: ${n15 ? 'north' : 'south'} of the belt, bravery ${pd15 ? 'not drunk yet' : 'drunk'}`);
    if (ow < 15 || (!n15 && pd15)) {
    // ---- 6. chop north through the belt -------------------------------------------------------------------
    await chopBelt('north');
    at('belt-north');
    }
    // (293b) a stage-15 resume past the helper meet (bullroarer dropped) does not wait for a helper that was never sent
    if (helper && doHerbs && (ow < 15 || bot.count(O.bullroarer) > 0)) {
        // helper mode: the bullroarer (Gujuo is done with it: D's Gujuo walks up by himself), the hollow reed and the belt's
        // logs go; walk out of the helper-unreachable strip and take the C+D kit
        // (re-sent: a drop sent during the chop's teleport delay is ignored, lgr1)
        const spare = () => bot.count('logs') + bot.count(O.reed) + bot.count(O.bullroarer);
        for (let k = 0; k < 6 && spare() > 0; k++) { dropAllOf(bot, ['bullroarer', 'reed_hollow', 'logs']); await bot.until(() => spare() === 0, 3); }
        const mm = meetMissing().filter(i => !(early417 && i.name === 'shark' && bot.count(O.shark) >= 3));   // fix 417
        const slotsNeed = mm.reduce((a, i) => a + (/rune$/.test(i.name) ? (bot.count(i.name) > 0 ? 0 : 1) : i.n), 0);
        // fix 417 (sim lgxx 'no room for the C+D kit (free 9 < 10)' after the early food meet): sharks above 3 go first (eaten
        // if hp is down 20+, else dropped)
        for (let k = 0; k < 6 && early417 && mm.length && bot.free() < slotsNeed && bot.count(O.shark) > 3; k++) {
            const sl = bot.slot(O.shark), n0 = bot.count(O.shark);
            if (bot.stat('hitpoints').cur < bot.stat('hitpoints').level - 20) bot.opHeld1(O.shark, sl); else bot.dropItem(O.shark, sl);
            bot.queueFlush(); await bot.until(() => bot.count(O.shark) < n0, 3);
        }
        if (mm.length) {
            if (bot.free() < slotsNeed) fail(`helper mode: no room for the C+D kit (free ${bot.free()} < ${slotsNeed}; pack ${bot.inv().map(s => s.obj).join(',')})`);
            await walk('helper meet', MEET.C, 1, 40);
            const ok = await helper.meet(MEET.C, mm, 'legends C belt');
            await bot.tick(1);
            const crit = SEG_C_MEET.filter(i => /^(rope|stafforb|waterrune|cosmicrune|vial_water)$/.test(i.name) && bot.count(i.name) < i.n);
            if (verbose) log(bot, t0, `helper kit at the belt: ${ok ? 'OK' : 'FAILED'}; pack ${bot.inv().length}/28 sharks ${bot.count(O.shark)} pots ${bot.inv().filter(s => POTS.includes(s.obj)).length}`);
            if (crit.length) fail(`helper mode: C kit incomplete: ${crit.map(i => i.name).join(',')}`);
        }
        at('helper-kit');
    }
    if (doHerbs) {
    // ---- 7. herbs ----------------------------------------------------------------------------------------------
    await room(1, 'snake weed');
    await step('snake vine', opL('vine', 2), () => has(O.unidSnake) || has(O.snake) || has(O.snakeSol) || has(O.brave), { stand: { x: 2761, z: 3013 }, near: 3, every: 5, maxTicks: 40 });
    close();
    await step('id snake', held1(O.unidSnake), () => has(O.snake) || has(O.snakeSol) || has(O.brave), { every: 3, maxTicks: 15 });
    close();
    await step('snake mix', useOn(O.snake, O.vialWater), () => has(O.snakeSol) || has(O.brave), { every: 4, maxTicks: 20 });
    close(); at('snakeweed');
    await room(1, 'ardrigal');
    await step('ardrigal palm', opL('palm', 2), () => has(O.unidArd) || has(O.ard) || has(O.brave), { stand: { x: 2869, z: 3115 }, near: 3, every: 5, maxTicks: 40 });
    close();
    await step('id ardrigal', held1(O.unidArd), () => has(O.ard) || has(O.brave), { every: 3, maxTicks: 15 });
    close();
    // ---- 8. bravery potion -------------------------------------------------------------------------------------
    await step('bravery mix', useOn(O.ard, O.snakeSol), () => has(O.brave), { every: 4, maxTicks: 20 });
    close();
    await step('drink bravery', held1(O.brave), () => !has(O.brave) && bot.chatModalId === -1, { answers: [/bravely drink/i], every: 6, maxTicks: 30 });
    at('bravery');
    }
    if (ow < 15 || n15) {
    // ---- 9. back south, into the cave ----------------------------------------------------------------------------
    await chopBelt('south');
    at('belt-south');
    }
    // session 11 T2b (fork qye01: Gujuo's menu + one failed crawl roll ('you get cramped', 5 p_delay) ran the 40 t budget out
    // while the 2nd crawl was mid-way): room for ~3 crawl attempts. LG_C_CHOICE_EXIT=0 reverts to 40.
    await step('cave rocks', opL('caveRock'), () => tile().z > 9000, { stand: { x: 2781, z: 2935 }, near: 1, answers: [/crawl through/i], every: 6, maxTicks: process.env.LG_C_CHOICE_EXIT !== '0' ? 90 : 40 });
    at('cave-in');
    }
    // ---- 10. the catacombs to the winch room -----------------------------------------------------------------------
    // F3 (LG_C_OUTSIDE=1, existing-lib only; sim l31b: 2 crevice rolls failed ('You get stuck ... takes you a while to get back
    // out'), 41 t > the 40 t budget, route stopped): room for ~4 squeeze attempts, as T2b gave the cave rocks
    if (rp !== 'lockgate') await step('bookcase', opL('bookcase', 2), () => tile().x >= 2799 && tile().z >= 9336, { answers: [/^Yes please/i], every: 8, maxTicks: process.env.LG_C_OUTSIDE === '1' ? 100 : 40 });
    // session 11 fix 293c (qyu13m + qx02m 'lockpick gate: not done after 61 t', no thieving xp in segment C: quest_legends.rs2
    // search_outer_ancient_gate rolls stat_random(thieving, 0, 255) = 216/256 at thieving 84; a success takes 28 t, a failed
    // roll 19 t + the 8 t re-op, so 60 t fit only 2 rolls (sim logs: 37x 28 t, 4x 47 t, 4x failed at 61 t): 7 rolls.
    // LG_C_LOCK_TICKS=0 reverts to 60.
    await step('lockpick gate', opL('lockGate', 2), () => tile().z <= 9331, { every: 8, maxTicks: process.env.LG_C_LOCK_TICKS === '0' ? 60 : Number(process.env.LG_C_LOCK_TICKS ?? 200) });
    at('lockgate');
    await step('boulder 1', opL('boulder1'), () => tile().z <= 9326, { every: 6, maxTicks: 40 });
    await step('boulder 2', opL('boulder2'), () => tile().z <= 9322, { every: 6, maxTicks: 40 });
    await step('boulder 3', opL('boulder3'), () => tile().z <= 9318, { every: 6, maxTicks: 40 });
    at('boulders');
    await step('strength gate', opL('strGate'), () => tile().z <= 9313, { answers: [/very strong/i], every: 8, maxTicks: 60 });
    at('strgate');
    await step('crumbled wall', opL('crumbled', 2), () => tile().x <= 2789 && tile().z >= 9296, { stand: { x: 2790, z: 9294 }, near: 2, every: 8, maxTicks: 40 });
    await step('rune door', opL('runeDoor'), () => cheb(tile(), { x: 2774, z: 9301 }) <= 1, { stand: { x: 2780, z: 9305 }, near: 2, every: 8, maxTicks: 30 });
    at('gem-room');
    }
    if (phase('gate')) {
    const gateT = bot.tickCount;
    await step('magic gate', opLocT('magicGate', 'water_orb'), () => tile().z >= 9320, { stand: { x: 2763, z: 9312 }, every: 6, maxTicks: 30 });
    if (verbose) console.log(`[segC] magic gate msgs: ${JSON.stringify(msgsSince(bot, gateT))}`);
    at('winch-room');
    }
    if (phase('winch')) {
    await step('rope on winch', useL(O.rope, 'winch'), () => !has(O.rope) || bot.liveLocs.get(`0,2759,9329`) === 2935, { every: 4, maxTicks: 20 });
    await step('climb down', opL('winchRope'), () => tile().x < 2500, { answers: [/shimmy down/i], every: 8, maxTicks: 40 });
    close(); at('viyeldi-caves');
    }
    if (phase('ledges')) {
    // ---- 12. ledges and rocks -------------------------------------------------------------------------------------------
    const OBST = [/nothing more exciting/i, /want to climb over/i];
    // A failed climb over rocks 1-3 throws the player down the cliff (quest_legends.rs2 viycaves_climbrock*): rock 1 drops
    // you at (2385,4730), which the top corridor joins to the main cave; rocks 2/3 drop you into the main cave. So before
    // each obstacle (and when one does not finish) check whether the main cave is already walkable from here.
    const MAIN = { x: 2395, z: 4712 };
    const inMain = () => { const me = tile(); let p: Tile[] = []; try { p = navN.findLongPath(0, me.x, me.z, MAIN.x, MAIN.z, 500); } catch { p = []; } const e = p[p.length - 1]; return (me.x === MAIN.x && me.z === MAIN.z) || (!!e && cheb(e, MAIN) <= 1); };
    const obstacles: Array<[string, LocKey, () => boolean, Tile | null]> = [
        ['ledge 0', 'ledge0', () => tile().x <= 2376, null],
        ['ledge 1', 'ledge1', () => tile().x >= 2378 && tile().z >= 4728, { x: 2377, z: 4727 }],
        ['ledge 2', 'ledge2', () => tile().z <= 4728 && tile().x >= 2382, { x: 2382, z: 4730 }],
        ['rock 1', 'rock1', () => tile().x >= 2388, null],
        ['rock 2', 'rock2', () => tile().z <= 4723, null],
        ['rock 3', 'rock3', () => tile().z <= 4717, null],
    ];
    for (const [label, k, done, stand] of obstacles) {
        if (k !== 'ledge0' && inMain()) { console.log(`[segC] ${label}: main cave already reachable from ${JSON.stringify(bot.pos())} - skipping the rest`); break; }
        try {
            if (stand) await walk(`${label} stand`, stand, 0, 60);
            await step(label, opL(k), done, { answers: OBST, every: 8, maxTicks: 40 });
        } catch (e) {
            close(); await bot.tick(1);
            if (inMain()) { console.log(`[segC] ${label}: fell into the main cave at ${JSON.stringify(bot.pos())} - skipping the rest`); break; }
            throw e;
        }
    }
    close(); at('ledges');
    }
    if (phase('heroes')) {
    // ---- 13. the three heroes ----------------------------------------------------------------------------------------
    for (const [type, crystal, home] of [[SAN, O.crystalA, { x: 2386, z: 4707 }], [IRVIG, O.crystalB, { x: 2402, z: 4706 }], [RANALPH, O.crystalC, { x: 2409, z: 4699 }]] as const) {
        await room(1, 'crystal');
        await topUp(0.8, 0.6);
        await fight(type, crystal, home);
        at(`hero-${type}`);
    }
    if (bot.isPrayerActive('protectfrommelee')) { (bot as any).setPrayer('protectfrommelee', false); bot.queueFlush(); }
    }
    if (phase('furnace')) {
    // ---- 14. furnace, dragon's eye, recess, barrier ----------------------------------------------------------------------
    for (const c of [O.crystalA, O.crystalB, O.crystalC]) {
        await step(`furnace ${c}`, useL(c, 'furnace'), () => !has(c), { stand: { x: 2425, z: 4725 }, near: 3, every: 5, maxTicks: 30 });
        if (c !== O.crystalC) close();
    }
    await step('heart', () => { /* the last piece's dialog pages run on */ }, () => has(O.heart) || has(O.heartGlow), { every: 99, maxTicks: 20 });
    close(); at('heart');
    await step('dragons eye', useL(O.heart, 'eyeRock'), () => has(O.heartGlow), { stand: { x: 2409, z: 4716 }, near: 2, every: 5, maxTicks: 30 });
    close();
    await step('recess', useL(O.heartGlow, 'recess'), () => !has(O.heartGlow), { stand: { x: 2421, z: 4692 }, near: 2, every: 5, maxTicks: 30 });
    close(); at('recess');
    await step('barrier', opL('barrier'), () => tile().z <= 4690, { every: 5, maxTicks: 20 });
    at('barrier');
    }
    // ---- 15. boulder -> Echned Zekin -> the dagger ------------------------------------------------------------------------
    await room(1, 'dagger');
    // session 11 fix 293d (qyu11m 'boulder/echned: not done after 134 t' at (2421,4690), the barrier's landing tile: the walk
    // to the boulder had both first steps refused (8 t / 12 t still) while hp fell 95 -> 73 (INFERRED: a hero or other npc
    // hitting us across the barrier, the combat holding us), walled both, 'no route', and gave up; the step then only op'd a
    // boulder IN VIEW and the boulder (2386,4689) is 35 tiles west: nothing was ever sent again): while no boulder is in view
    // the op re-routes toward the stand (fresh plan each time). LG_C_BOULDER_WALK=0 reverts. TEST: LG_C_BOULDER_TEST=1 skips
    // the stand walk (as if it had failed at once).
    // session 11 fix 331 (qx101m: the 293d freeze explained): a lesser demon (m37_73.jm2:8259-8263, size 2, huntrange 2) stood
    // at 2420,4688; its hit made auto-retaliate p_opnpc(2) (auto_retaliate.rs2:7,25) and the melee loop (player_melee.rs2:8-9)
    // clears our waypoints every tick (Player.ts:1224). MOVE_OPCLICK keeps the interaction (MoveClickHandler.ts:30): engine
    // t65251-65347 'npc 82@2420,4688 target kept steps 0 wp false', hp 94->55. A plain MOVE clears it; while walking, busy2
    // blocks a new retaliation. LG_C_BOULDER_FREE=0 reverts. TEST: LG_C_BOULDER_DEMON=1 attacks the nearest demon first.
    const BSTAND = { x: 2388, z: 4690 }, bWalk = process.env.LG_C_BOULDER_WALK !== '0', bFree = process.env.LG_C_BOULDER_FREE !== '0';
    if (process.env.LG_C_BOULDER_DEMON === '1') { const d = npcsOf(bot, 82)[0]; if (d) { bot.opNpc(d.idx, 2); bot.queueFlush(); await bot.tick(6); } }
    let bRe = 0;
    await step('boulder/echned', () => {
        const n = npcsOf(bot, BOULDER).find(b => b.z <= 4692);
        if (n) { opNpcGo(bot, n, 1); return; }
        if (!bWalk) return;
        const me = tile(); let p: Tile[] = []; try { p = navN.findLongPath(0, me.x, me.z, BSTAND.x, BSTAND.z, 500); } catch { p = []; }
        const dense = densify([me, ...p]).slice(1);
        console.log(`[segC] 293d boulder not in view from (${me.x},${me.z}) -> re-route #${++bRe} toward ${BSTAND.x},${BSTAND.z}${dense.length ? ` (${dense.length} tiles)` : ' (NO PATH)'}`);
        if (dense.length) bot.sendRoute(turning(me, dense), !bFree);
    },
        () => has(O.dagger) && bot.chatModalId === -1,
        { stand: process.env.LG_C_BOULDER_TEST === '1' ? undefined : BSTAND, near: 3, answers: [/^Er\.\.\. me/i, /need it for my quest/i, /What can I do about that/i, /do what I must/i, /^Ok, I'll do it/i], every: 10, maxTicks: 120 });
    at('dagger');
    m.ok = true; m.ticks = bot.tickCount - t0; m.pos = bot.pos();
    return m;

    // ===== helpers that need the closure ===================================================================================
    async function chopBelt(dir: 'north' | 'south') {
        // the belt at x 2816: (2816,2936) | jungle bush 2816,2937 | 2816,2938 (jungle) | jungle bush 2816,2939 | (2816,2940)
        // jungle_tree.rs2: a depleting chop p_teleports the player 2 tiles on in the chop direction.
        const [firstK, secondK, from, mid, to] = dir === 'north'
            ? ['beltS', 'beltN', { x: 2816, z: 2936 }, 2938, 2940] as const
            : ['beltN', 'beltS', { x: 2816, z: 2940 }, 2938, 2936] as const;
        // fix 422: the tools must be in the pack before every chop (south = into the caves: + lockpick + pickaxe)
        await needTools(dir === 'south' ? TOOLS_CAVE : TOOLS_BELT, `belt ${dir}`);
        // (a depleting chop gives logs: one free slot; sim lgc1 kept the tools and met the belt at 28/28: 'belt south 1' 103 t)
        if (process.env.LG_C_TOOLS !== '0' && bot.free() < 1) await room(1, `belt ${dir}`);
        // fix 417 (sim lgxu: the early meeting chopped north, came back ~250 t later and 'belt south 1: not done after 85 t' at
        // (2816,2940), no message at all x2): our own chop had left the belt loc in its depleted stage (a different live id), and
        // an op on the static id does nothing. As seg-b's chopLine: while the live id differs, every 3rd send is a plain step
        // onto the tile (the depleted stage can be walkable), the others op the live id. LG_C_BELT_LIVE=0 reverts.
        let sends = 0;
        const chopAt = (k: LocKey) => () => {
            const [id, x, z] = L[k];
            const live = process.env.LG_C_BELT_LIVE === '0' ? undefined : bot.liveLocs.get(`0,${x},${z}`) as number | undefined;
            if (live === undefined || live === id) { bot.opLoc(x, z, id, 1); return; }
            if (++sends % 3 === 0 || live < 0) { console.log(`[segC] 417 belt ${dir}: live loc ${live} at ${x},${z} (static ${id}) - step`); bot.sendRoute([{ x, z }, { x, z: z + (dir === 'north' ? 1 : -1) }], false); }
            else bot.opLoc(x, z, live, 1);
        };
        await step(`belt ${dir} 1`, chopAt(firstK), () => tile().x === 2816 && (dir === 'north' ? tile().z >= mid : tile().z <= mid),
            { stand: from, every: 20, maxTicks: 80 });
        await step(`belt ${dir} 2`, chopAt(secondK), () => tile().x === 2816 && (dir === 'north' ? tile().z >= to : tile().z <= to),
            { every: 20, maxTicks: 80 });
    }

    /** fix 422: every tool of `list` held (or worn); else fetch the missing ones from the bank through the helper (route: the
     *  BankHelper trip goes to the bank and comes back here) - only from the mainland north of the belt, where a bank trip can
     *  come back on foot. LG_C_TOOLS=0 = off. TEST: LG_C_TOOLS_TEST=<names,...> banks those (by the helper's bank visit) once
     *  at the first check. */
    async function needTools(list: Array<[string, string[]]>, label: string) {
        if (process.env.LG_C_TOOLS === '0') return;
        const heldAny = (alts: string[]) => alts.some(n => { try { const id = objId(n); return bot.count(id) > 0 || bot.isWorn(id); } catch { return false; } });
        const miss = () => list.filter(([, alts]) => !heldAny(alts));
        // north of the belt on the surface (a bank trip comes back from there; not from the jungle south of it or the caves)
        const t = tile(), mainland = bot.minusedlevel === 0 && t.z < 4000 && !(t.x >= 2740 && t.x <= 2980 && t.z < 2940);
        if (process.env.LG_C_TOOLS_TEST && mainland && !(globalThis as any).__lgCToolsTest) {
            (globalThis as any).__lgCToolsTest = true;
            const names = process.env.LG_C_TOOLS_TEST.split(',');
            const { bankVisit } = await import('../qp/route/route-lib.js');
            const pr = (bot as any).srBankPrecious; (bot as any).srBankPrecious = [];
            try { await bankVisit(bot, [{ name: 'amulet_of_glory_4', n: 1 }], bot.inv().map(s => objDebugName(s.obj)).filter(n => !names.includes(n)), bot.pos(), new Set<string>(), 'legends-C 422 TEST'); }
            finally { (bot as any).srBankPrecious = pr; }
            const { travelTo } = await import('../qp/route/route-lib.js');
            await travelTo(bot, { x: MEET.C.x, z: MEET.C.z, level: 0 }, new Set<string>(), { near: 2, tag: 'legends-C 422 TEST', maxTicks: 900 });
            console.log(`[segC] 422 TEST: banked ${names.join(',')}; back at ${JSON.stringify(bot.pos())} pack ${bot.inv().length}/28`);
        }
        const m0 = miss();
        if (!m0.length) return;
        console.log(`[segC] 422 ${label}: tools missing ${m0.map(([n]) => n).join(',')} at ${JSON.stringify(bot.pos())}${helper && mainland ? ' -> fetch from the bank' : ''}`);
        if (!helper) fail(`${label}: tools missing (${m0.map(([n]) => n).join(',')}) and no helper/bank to fetch them`);
        if (!mainland) fail(`${label}: tools missing (${m0.map(([n]) => n).join(',')}) south of the belt / in the caves: no walk back from a bank`);
        // the bank's variant (as last seen) when it holds one: the complete map, another axe/pickaxe
        const want = m0.map(([n, alts]) => ({ name: alts.find(a => { try { return bot.bankCount(a) > 0; } catch { return false; } }) ?? n, n: 1 }));
        await room(want.length, `${label} tools`);
        const ok = await helper!.meet(MEET.C, want, `legends C tools (${label})`);
        await bot.tick(1);
        if (cheb(tile(), MEET.C) > 40) {
            const { travelTo } = await import('../qp/route/route-lib.js');
            const r = await travelTo(bot, { x: MEET.C.x, z: MEET.C.z, level: 0 }, new Set<string>(), { near: 2, tag: 'legends-C 422', maxTicks: 900 });
            console.log(`[segC] 422 ${label}: back to the belt meeting ${r.ok ? 'OK' : 'short'} (${r.how}, ${r.ticks} t) -> ${JSON.stringify(bot.pos())}`);
        }
        const m1 = miss();
        console.log(`[segC] 422 ${label}: tool fetch ${ok ? 'OK' : 'FAILED'}; still missing ${m1.map(([n]) => n).join(',') || '-'}; pack ${bot.inv().length}/28 at ${JSON.stringify(bot.pos())}`);
        if (m1.length) fail(`${label}: tools still missing after the bank fetch: ${m1.map(([n]) => n).join(',')}`);
    }

    async function fight(type: number, crystal: number, home: Tile) {
        const s0 = bot.tickCount;
        let lastAtk = -99, target = -1, lastDrink = -9;
        while (!has(crystal)) {
            if (bot.tickCount - s0 > 400) fail(`hero ${type}: no crystal after 400 t`);
            // prayer only while a hero is close (off on the walks between fights); drink below 20 points
            const near = npcsOf(bot, [SAN, IRVIG, RANALPH]).some(q => q.d <= 3);
            if (near && bot.stat('prayer').cur < 20 && bot.tickCount - lastDrink >= 3) { const p = pot(); if (p) { bot.opHeld1(p.obj, p.slot); bot.queueFlush(); lastDrink = bot.tickCount; } }
            if (near && bot.stat('prayer').cur > 0 && !bot.isPrayerActive('protectfrommelee')) { bot.activatePrayer('protectfrommelee'); bot.queueFlush(); }
            eat();
            if (bot.chatModalId !== -1) { bot.resumeDialogPage(); bot.queueFlush(); await bot.tick(1); continue; }
            // lock onto ONE instance (there are 4 of each hero; re-targeting the nearest every tick never finishes a kill)
            const all = npcsOf(bot, type);
            let n = all.find(q => q.idx === target) ?? null;
            if (!n) n = all[0] ?? null;
            if (!n) { target = -1; await walkOp(bot, home, null, () => npcsOf(bot, type).some(q => q.d <= 10), { near: 2, maxTicks: 60 }); await bot.tick(1); continue; }
            // San Tojalon (wanderrange 10) walks back toward its spawn and the player drops the fight: re-attack quickly
            // whenever the target is not adjacent, otherwise only every 20 t
            if (n.idx !== target || bot.tickCount - lastAtk >= (n.d > 1 ? 4 : 20)) { opNpcGo(bot, n, 2); target = n.idx; lastAtk = bot.tickCount; }
            if (verbose && (bot.tickCount - s0) % 20 === 0) { const e: any = bot.npcs[n.idx]; console.log(`[segC] fight ${type} t+${bot.tickCount - s0} idx=${n.idx} d=${n.d} npcHp=${e?.health}/${e?.totalHealth} me=${JSON.stringify(bot.pos())} hp=${bot.stat('hitpoints').cur} pray=${bot.stat('prayer').cur} prot=${bot.isPrayerActive('protectfrommelee')}`); }
            await bot.tick(1);
        }
        await bot.tick(1); close();
        if (bot.isPrayerActive('protectfrommelee')) { (bot as any).setPrayer('protectfrommelee', false); bot.queueFlush(); }
        if (verbose) log(bot, t0, `hero ${type} crystal in ${bot.tickCount - s0} t hp=${bot.stat('hitpoints').cur}`);
    }
}

/** Whole-segment safety net (as seg-d.ts): eat a shark at <= 50% hp (pages only interrupted when critical), and a death
 *  watcher: "Oh dear, you are dead!" or a jump to the Lumbridge respawn makes every later bot.tick throw "DIED" at once. */
export async function withSafety<T>(bot: SpeedBot, body: () => Promise<T>): Promise<T> {
    const shark = objId('shark');
    let on = true, lastEat = -9, dead = '';
    const tick0 = bot.tick.bind(bot), since = bot.tickCount;
    (bot as any).tick = async (n = 1) => { await tick0(n); if (dead) throw new Error(dead); };
    (async () => {
        while (on && !bot.disposed) {
            const t = bot.tile();
            if (!dead && (msgsSince(bot, since).some(m => /Oh dear,? you are dead/i.test(m)) || (t.x >= 3200 && t.x <= 3245 && t.z >= 3195 && t.z <= 3240 && bot.minusedlevel === 0)))
                dead = `legends-C: DIED (respawned at ${t.x},${t.z}) - check food/prayer for the hero fights`;
            const hp = bot.stat('hitpoints'), critical = hp.cur <= Math.max(20, Math.floor(hp.level * 0.3));
            if (hp.cur <= Math.floor(hp.level * 0.5) && (critical || bot.chatModalId === -1) && bot.tickCount - lastEat >= 3 && bot.count(shark) > 0) {
                bot.opHeld1(shark, bot.slot(shark)); bot.queueFlush(); lastEat = bot.tickCount;
            }
            await tick0(1);
        }
    })();
    try { return await body(); }
    catch (e) { if (dead) throw new Error(dead); throw e; }
    finally { on = false; (bot as any).tick = tick0; }
}
