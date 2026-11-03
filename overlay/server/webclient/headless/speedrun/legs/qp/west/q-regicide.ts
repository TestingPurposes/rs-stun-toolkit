// q-regicide.ts — REGICIDE (3 QP), cheat-free. West lane.
//
// Content: ~/sim/rs-qp/server/content/scripts/quests/quest_regicide/** (rev 289). Stage varp %regicide_quest (varp 328) is
// NOT transmitted: steps gate on items, position, dialog text and game messages. Research sheet (content-verified, file:line):
// scratchpad regicide-sheet.md; every step below re-checks the script it relies on.
//
// PRECONDITION (route integrator): Underground Pass complete AND a relog after it: the King's messenger timer is armed only
// at login (login.rs2:74, regicide_kings_messenger.rs2:1-4) and fires 400-1200 t later; it repeats with the same interval until
// the messenger's dialogue runs. run() first waits for the messenger (or starts at once if the summons is already held).
//
// Segments:
//   msg     the King's messenger -> summons (=1)
//   lathas  King Lathas (=2)
//   pass1   back through the Underground Pass (q-underground-pass.ts passToWell, revisit mode) to the Well of Voyage side
//   isafdar Well of Voyage -> cave exit (2312,3216); Idris and the elves scene on the way to pit A (=3)
//   ... (further segments added as built)
import { SpeedBot, objId, objDebugName, cheb } from '../../../core.js';
import { nav, npc, npcsOf, opNpcGo, locAt, msgsSince, opLocGo, trace, navSync, tele, type Tile } from '../../q-lib.js';
import { act, converse, fail, fight, mkLog, wear, eatNow, eatWatch, dead, msgSince, answer, walk, pickup, qp, routeNextTo, foodCount, type Item, type RunResult, type Handoff } from './we-lib.js';
import { passToWell, talkLathas, openDoor, opUntil, useOnLoc, actAt, inBox, has, underground } from './q-underground-pass.js';
import { isResuming, journalStage, failHook, readJournal } from '../journal.js';
declare const process: { env: Record<string, string | undefined> };

export const QUEST = { name: 'Regicide', dir: 'quest_regicide', qp: 3 };
export const SPELL = process.env.REG_SPELL ?? 'fire_wave';
export const REQUIREMENTS = {
    quests: ['Underground Pass (+ a relog after it)', 'Plague City scroll read (Ardougne Teleport)'],
    qp: 0,
    skills: {
        agility: [56, 'dense forest crossings stat(agility) 56 (quest_regicide.rs2:404); logs 45 (:346,:368)'],
        crafting: [10, 'loom: 4 balls of wool -> cloth (quest_regicide.rs2:674)'],
        magic: [75, `${SPELL} on the Tyras guard (110 hp, magicdefence -10); Falador (37) + Ardougne (51) teleports`],
        cooking: [1, 'optional: the lazy guard rabbit is cooked in-quest (cooking_generic.dbrow:518-530, level 1); from 34 it never burns (successchance 128..512), below that a burn costs another rabbit + fire. Sim-proven at 34'],
        firemaking: [1, 'the rabbit fire from normal logs (firemaking.rs2:79-117: stat_random(firemaking, 64, 512) per 4 t)'],
    } as Record<string, [number, string]>,
    start: { x: 2577, z: 3293, level: 1 },   // beside King Lathas (where Underground Pass ends)
    end: { x: 2577, z: 3293, level: 1 },
};
export const SUPPLY: Item[] = [
    // the pass again (x2): bow + arrows + tinderbox for the bridge rope, a rope per swing
    { name: 'shortbow', n: 1 }, { name: 'bronze_arrow', n: 6 }, { name: 'tinderbox', n: 1 }, { name: 'rope', n: 2 }, { name: 'spade', n: 1 },
    { name: 'shark', n: 6 }, { name: 'pestle_and_mortar', n: 1 }, { name: 'pot_empty', n: 1 }, { name: 'ball_of_wool', n: 4 },
    // cooked rabbit for the lazy guard: made in-quest (supply-gap change kill an Isafdar rabbit, cook it on a
    // fire from these logs + the tinderbox); a supplied cooked_rabbit is used instead if held
    { name: 'limestone', n: 1 }, { name: 'logs', n: 1 },
    { name: 'bloodrune', n: 30 }, { name: 'firerune', n: 210 }, { name: 'airrune', n: 150 },
    { name: 'lawrune', n: 5 }, { name: 'waterrune', n: 5 }, { name: 'leather_gloves', n: 1 },
];

export const RESUPPLY_FALADOR: Item[] = [{ name: 'coal', n: 10 }];
let HANDOFF: Handoff | undefined;
export const N = { lathas: 364, messenger: 1210, idris: 1186, iorwerth: 1182, tracker: 1199, oldGuard: 1200, campGuard: 1203, lazyGuard: 1205 } as const;
export const O = { summons: 3206, message: 3207, pendant: 3208, sulphur: 3209, limestone: 3211, quicklime: 3213, quickDust: 3214,
    sulphurDust: 3215, barrel: 3216, bomb: 3218, fused: 3219, tar: 3220, cloth: 3224, rabbit: 3228, book: 3230 } as const;
const RAW_RABBIT = objId('raw_rabbit'), BURNT_MEAT = objId('burnt_meat'), FIRE = 2732;
/** regicide_rabbit / regicide_bunny1 / regicide_bunny2 (pack npc ids; quest_regicide.npc:153-223, all category rabbit) */
const RABBITS = [1192, 1193, 1194];
/** rabbit spawns on the hub walks (maps m34_49 / m35_49): by pit B's south end, and NW of the tracks */
const RABBIT_SPOTS: Tile[] = [{ x: 2207, z: 3197 }, { x: 2241, z: 3163 }];
export const L = {
    well1: { id: 4004, x: 2008, z: 4711 },     // L1: -> (2343,9622) (quest_regicide.rs2:10-17)
    exit: { id: 4007, x: 2312, z: 9623 },      // -> (2312,3216) Isafdar (quest_regicide.rs2:28-29)
} as const;
export const T = { isafdar: { x: 2312, z: 3216 }, pitAnorth: { x: 2267, z: 3206 } } as const;

type Seg = (bot: SpeedBot, log: (s: string) => void) => Promise<void>;

/** the King's messenger: npc_add next to us + ai_opplayer2 opens his dialogue when adjacent; if he lost us, Talk-to him */
const segMsg: Seg = async (bot, log) => {
    if (has(bot, O.summons) || msgSince(bot, 0, /King Lathas sent this message/i)) return;
    // fix 329b (qx98m + fork qzm16m: a relog did not bring him back in 3,000 t): login re-arms his timer only while
    // %regicide_quest = 0 (regicide_kings_messenger.rs2:1-4), and the journal reads 'King Lathas will send word' only then
    // (regicide_journal.rs2:3-6). A readable journal without that line = his dialogue already ran (the summons was lost):
    // go straight on to Lathas. RG_MSG_JOURNAL=0 reverts.
    if (process.env.RG_MSG_JOURNAL !== '0') {
        const j = await readJournal(bot, 'regicide');
        log(`[journal] regicide msg check: ${j.ok ? `'${j.open.slice(0, 120)}'` : 'UNREADABLE'}`);
        if (j.ok && !/will send word/i.test(j.text)) { log('329b: the messenger already came (journal past the start): no wait'); return; }
    }
    const t0 = bot.tickCount;
    log('waiting for the King\'s messenger (400-1200 t after login)');
    const ok = await act(bot, 'messenger', () => { const m = npc(bot, N.messenger); if (!m || m.d <= 1) return false; opNpcGo(bot, m, 1); },
        () => has(bot, O.summons) && bot.chatModalId === -1, { every: 8, max: 1500 });
    if (!ok) fail(bot, 'no King\'s messenger within 1500 t (relogged after Underground Pass?)');
    log(`messenger after ${bot.tickCount - t0} t`);
};
const segLathas: Seg = async (bot, log) => {
    if (underground(bot) || bot.minusedlevel === 1 && bot.tile().x < 2300) return;
    if (bot.minusedlevel !== 1) await walk(bot, { x: 2572, z: 3294, level: 1 }, 3, 'castle stairs');
    const snap = new Map(bot.ifText);
    let saw = false;
    const said = () => { for (const [k, v] of bot.ifText) if (snap.get(k) !== v && /well rewarded|what must I do again/i.test(v)) return true; return false; };
    if (!(await talkLathas(bot, () => { if (said()) saw = true; return saw && bot.chatModalId === -1; }, log))) fail(bot, 'King Lathas (=2)');
    await bot.dropAll([O.summons], 4);
    log('Lathas (=2)');
};
const segPass1: Seg = async (bot, log) => {
    if (bot.minusedlevel === 0 && bot.tile().z < 4000 && bot.tile().x < 2340) return;   // already in Isafdar
    if (bot.minusedlevel === 1 && bot.tile().x < 2100) return;
    await passToWell(bot, log);
};
/** Well of Voyage -> the underground -> cave exit; then Idris (timer 20-30 t after entering 35_49/35_50/36_50, re-armed on
 *  each square entered, idris.rs2:6-24) whose queue needs us within 1 tile (idris.rs2:32-36) */
async function enterIsafdar(bot: SpeedBot, log: (s: string) => void): Promise<void> {
    const inIsafdar = () => bot.minusedlevel === 0 && bot.tile().z < 4000 && bot.tile().x > 2150 && bot.tile().x < 2340;
    if (inIsafdar()) return;
    if (bot.minusedlevel === 1 && !(await opUntil(bot, 'well of voyage', L.well1, 1, () => bot.minusedlevel === 0, { level: 1, every: 6, max: 60 }))) fail(bot, 'Well of Voyage');
    if (!(await opUntil(bot, 'cave exit', L.exit, 1, inIsafdar, { stand: { x: 2314, z: 9623 }, every: 6, max: 80 }))) fail(bot, 'Isafdar cave exit');
    log('in Isafdar');
}
const segIsafdar: Seg = async (bot, log) => {
    // session 11 (fork qyb03: a retry of this segment from the Ardougne castle threw 'Well of Voyage': enterIsafdar assumes the
    // well's L1 room): from anywhere else outside, back through the pass to the well first. RG_ISAF_PASS=0 reverts.
    if (process.env.RG_ISAF_PASS !== '0') {
        const t = bot.tile(), lv = bot.minusedlevel;
        const inIsaf = lv === 0 && t.z < 4000 && t.x > 2150 && t.x < 2340, atWell = lv === 1 && t.x < 2100, inCave = lv === 0 && t.z > 9000 && t.x >= 2290 && t.x <= 2350 && t.z >= 9590 && t.z <= 9650;
        if (!inIsaf && !atWell && !inCave) { log(`segment isafdar from outside ${JSON.stringify(bot.pos())}: through the pass first`); await passToWell(bot, log); }
    }
    await enterIsafdar(bot, log);
    const scouts = () => msgSince(bot, 0, /speak with Lord Iorwerth|expecting you/i) || [...bot.ifText.values()].some(v => /speak with Lord Iorwerth/i.test(v));
    if (scouts()) return;
    // session 11: a retry reads the journal first (regicide_journal.rs2: 'met a elvish scout party' = stage >= 3)
    if (isResuming(bot) && process.env.RG_JOURNAL !== '0' && (await journalStage(bot, 'regicide', [[/met a elvish scout party/i, 3]], 2, log)) >= 3) return;
    const t0 = bot.tickCount;
    let walking = true;
    // session 11 (audit): a drop during the scene closes Idris's page and kills his script; the spawn timer (idris.rs2:6-24) is
    // set only on ENTERING 35_49/35_50/36_50 (music/move.rs2 mapzone). No page for 40 t: walk across the 35_50/36_50 line
    // (cave exit <-> pit A north) to re-arm it. RG_IDRIS_REARM=0 reverts (150 t, no re-arm).
    const rearm = process.env.RG_IDRIS_REARM !== '0';
    let target: Tile = T.pitAnorth, sq = (bot.tile().x >> 6) * 1000 + (bot.tile().z >> 6), lastAct = t0;
    while (!scouts() && bot.tickCount - t0 < (rearm ? 260 : 150) && !dead(bot)) {
        const idris = npc(bot, N.idris);
        const sq1 = (bot.tile().x >> 6) * 1000 + (bot.tile().z >> 6);
        if (sq1 !== sq) { sq = sq1; lastAct = bot.tickCount; }
        // TEST mark (session 11 proof): the first scene page is closed (as a drop would) and the attempt throws
        if (bot.chatModalId !== -1 && process.env.SR_FAIL_AT === 'rg-idris-page' && !(globalThis as any).__rgIdrisFail) { (globalThis as any).__rgIdrisFail = 1; bot.closeModal(); bot.queueFlush(); await bot.tick(1); failHook('rg-idris-page'); }
        if (bot.chatModalId !== -1) { answer(bot, [], 0); walking = false; lastAct = bot.tickCount; }
        else if (rearm && bot.tickCount - lastAct > 40) {
            target = target === T.pitAnorth ? T.isafdar : T.pitAnorth; walking = true; lastAct = bot.tickCount;
            log(`Idris: no scene page for 40 t: re-arming his timer (walk to ${target.x},${target.z})`);
        }
        else if (idris && !(rearm && walking && target === T.isafdar)) walking = false;   // stand still: the scene needs us next to him
        if (bot.chatModalId === -1 && walking && cheb(bot.tile(), target) > 1) { void bot.walkTo(target.x, target.z, { maxTicks: 3, log: false }); }
        await bot.tick(1);
    }
    if (!scouts()) fail(bot, 'Idris scene (=3) did not happen');
    log(`elves met (=3) after ${bot.tickCount - t0} t`);
};

// ---- Isafdar movement: walk regions joined by scripted obstacles (probe-regions.ts on the 289 collision) -------------
const REG = {
    exitN: { x: 2312, z: 3216 },   // cave exit, pit A north
    midS: { x: 2267, z: 3201 },    // pit A south, woodspring east, forest-3192 west end
    e3192: { x: 2274, z: 3192 },   // forest-3192 east end, pit C north
    hub: { x: 2257, z: 3149 },     // tracker, tracks, tar, sulphur, pit B south, pit C south, woodspring west, forest-3148 east
    pitBN: { x: 2209, z: 3205 },   // pit B north, log 1 east
    iorw: { x: 2205, z: 3252 },    // Iorwerth, loom, log 1 west
    oldcamp: { x: 2231, z: 3149 }, // west of forest-3148 (the old-camp guard spawn), tripwire south
    tripN: { x: 2220, z: 3155 },   // tripwire north, forest-2216 south end
    campN: { x: 2188, z: 3171 },   // forest-2216 north end, lazy guard, catapult, camp crossing north
    tyras: { x: 2188, z: 3162 },   // inside the Tyras camp (furnace 2193,3146)
} as const;
type Reg = keyof typeof REG;
type Hop = { stand: Tile; loc: { id: number; x: number; z: number }; land: Tile };
type Edge = { a: Reg; b: Reg; hops: Hop[]; cost: number; forest?: boolean; camp?: boolean };
/** forest crossings (quest_regicide.rs2:430-462): angle 1/3 cross E-W along z+1 (start x-1 / x+2), angle 0/2 cross N-S along
 *  x+1 (start z-1 / z+2); a chain of 3 locs is crossed one after another. Locs listed W..E / S..N. */
function forestChain(locs: Array<{ id: number; x: number; z: number }>, ew: boolean, forward: boolean): Hop[] {
    const ordered = forward ? locs : [...locs].reverse();
    return ordered.map(l => ew
        ? (forward ? { stand: { x: l.x - 1, z: l.z + 1 }, loc: l, land: { x: l.x + 2, z: l.z + 1 } } : { stand: { x: l.x + 2, z: l.z + 1 }, loc: l, land: { x: l.x - 1, z: l.z + 1 } })
        : (forward ? { stand: { x: l.x + 1, z: l.z - 1 }, loc: l, land: { x: l.x + 1, z: l.z + 2 } } : { stand: { x: l.x + 1, z: l.z + 2 }, loc: l, land: { x: l.x + 1, z: l.z - 1 } }));
}
const F3148 = [{ id: 3937, x: 2232, z: 3148 }, { id: 3938, x: 2235, z: 3148 }, { id: 3939, x: 2238, z: 3148 }];
const F2216 = [{ id: 3939, x: 2216, z: 3161 }, { id: 3938, x: 2216, z: 3164 }, { id: 3939, x: 2216, z: 3167 }];
const F3192 = [{ id: 3938, x: 2266, z: 3191 }, { id: 3939, x: 2269, z: 3191 }, { id: 3937, x: 2272, z: 3191 }];
const FCAMP = [{ id: 3999, x: 2187, z: 3163 }, { id: 3939, x: 2187, z: 3166 }, { id: 3998, x: 2187, z: 3169 }];
const PIT = 3925, WOOD = 3922, TRIP = 3921, LOG1 = 3931;
const EDGES: Edge[] = [
    { a: 'exitN', b: 'midS', cost: 8, hops: [{ stand: { x: 2267, z: 3205 }, loc: { id: PIT, x: 2267, z: 3204 }, land: { x: 2267, z: 3201 } }] },
    { a: 'midS', b: 'exitN', cost: 8, hops: [{ stand: { x: 2267, z: 3201 }, loc: { id: PIT, x: 2267, z: 3202 }, land: { x: 2267, z: 3205 } }] },
    // woodspring (width 3, angle 0): op from (2238,3181) -> (2234,3181); its trigger tiles are (2236-2237,3181) (regicide_zones.rs2:61:
    // standing there = instant fail); a failed roll (30/155, quest_regicide.rs2:31-35) knocks us back to (2238,3181) for 8 hp
    { a: 'midS', b: 'hub', cost: 30, hops: [{ stand: { x: 2238, z: 3181 }, loc: { id: WOOD, x: 2235, z: 3181 }, land: { x: 2234, z: 3181 } }] },
    { a: 'hub', b: 'midS', cost: 30, hops: [{ stand: { x: 2234, z: 3181 }, loc: { id: WOOD, x: 2235, z: 3181 }, land: { x: 2238, z: 3181 } }] },
    { a: 'hub', b: 'pitBN', cost: 8, hops: [{ stand: { x: 2209, z: 3201 }, loc: { id: PIT, x: 2209, z: 3202 }, land: { x: 2209, z: 3205 } }] },
    { a: 'pitBN', b: 'hub', cost: 8, hops: [{ stand: { x: 2209, z: 3205 }, loc: { id: PIT, x: 2209, z: 3204 }, land: { x: 2209, z: 3201 } }] },
    { a: 'pitBN', b: 'iorw', cost: 10, hops: [{ stand: { x: 2202, z: 3237 }, loc: { id: LOG1, x: 2201, z: 3237 }, land: { x: 2196, z: 3237 } }] },
    { a: 'iorw', b: 'pitBN', cost: 10, hops: [{ stand: { x: 2196, z: 3237 }, loc: { id: LOG1, x: 2197, z: 3237 }, land: { x: 2202, z: 3237 } }] },
    { a: 'e3192', b: 'hub', cost: 8, hops: [{ stand: { x: 2274, z: 3176 }, loc: { id: PIT, x: 2274, z: 3175 }, land: { x: 2274, z: 3172 } }] },
    { a: 'hub', b: 'e3192', cost: 8, hops: [{ stand: { x: 2274, z: 3172 }, loc: { id: PIT, x: 2274, z: 3173 }, land: { x: 2274, z: 3176 } }] },
    { a: 'midS', b: 'e3192', cost: 18, forest: true, hops: forestChain(F3192, true, true) },
    { a: 'e3192', b: 'midS', cost: 18, forest: true, hops: forestChain(F3192, true, false) },
    { a: 'hub', b: 'oldcamp', cost: 18, forest: true, hops: forestChain(F3148, true, false) },
    { a: 'oldcamp', b: 'hub', cost: 18, forest: true, hops: forestChain(F3148, true, true) },
    { a: 'oldcamp', b: 'tripN', cost: 8, hops: [{ stand: { x: 2220, z: 3152 }, loc: { id: TRIP, x: 2220, z: 3153 }, land: { x: 2220, z: 3155 } }] },
    { a: 'tripN', b: 'oldcamp', cost: 8, hops: [{ stand: { x: 2220, z: 3155 }, loc: { id: TRIP, x: 2220, z: 3153 }, land: { x: 2220, z: 3152 } }] },
    { a: 'tripN', b: 'campN', cost: 18, forest: true, hops: forestChain(F2216, false, true) },
    { a: 'campN', b: 'tripN', cost: 18, forest: true, hops: forestChain(F2216, false, false) },
    { a: 'campN', b: 'tyras', cost: 18, forest: true, camp: true, hops: forestChain(FCAMP, false, false) },
    { a: 'tyras', b: 'campN', cost: 18, forest: true, camp: true, hops: forestChain(FCAMP, false, true) },
];
const REG_CACHE = new Map<string, Reg | null>();
function region(bot: SpeedBot): Reg | null {
    if (bot.minusedlevel !== 0 || bot.tile().z > 4000) return null;
    const me = bot.tile(), k = `${me.x},${me.z}`;
    if (REG_CACHE.has(k)) return REG_CACHE.get(k)!;
    const reach = (a: Tile, b: Tile) => { let p: Tile[] = []; try { p = navSync().findLongPath(0, a.x, a.z, b.x, b.z, 4000); } catch { p = []; } const e = p[p.length - 1]; return !!e && e.x === b.x && e.z === b.z; };
    let hit: Reg | null = null;
    for (const [name, t] of Object.entries(REG) as Array<[Reg, Tile]>) if ((me.x === t.x && me.z === t.z) || reach(me, t) || reach(t, me)) { hit = name; break; }
    REG_CACHE.set(k, hit);
    return hit;
}
/** cheapest edge sequence (Dijkstra: edge cost + walking from the entry tile to each edge's first stand tile) */
function isafPlan(from: Reg, at: Tile, to: Reg, o: { forest: boolean; camp: boolean }): Edge[] {
    const dist = new Map<Reg, number>([[from, 0]]), pos = new Map<Reg, Tile>([[from, at]]), prev = new Map<Reg, Edge>();
    const open = new Set<Reg>([from]); const done = new Set<Reg>();
    while (open.size) {
        let c: Reg | null = null; for (const r of open) if (c === null || dist.get(r)! < dist.get(c)!) c = r;
        open.delete(c!); done.add(c!);
        if (c === to) break;
        for (const e of EDGES) {
            if (e.a !== c || done.has(e.b) || (e.forest && !o.forest) || (e.camp && !o.camp)) continue;
            const d = dist.get(c)! + Math.ceil(cheb(pos.get(c)!, e.hops[0]!.stand) / 2) + e.cost;
            if (d < (dist.get(e.b) ?? Infinity)) { dist.set(e.b, d); pos.set(e.b, e.hops[e.hops.length - 1]!.land); prev.set(e.b, e); open.add(e.b); }
        }
    }
    const out: Edge[] = [];
    for (let c: Reg = to; c !== from;) { const e = prev.get(c); if (!e) return []; out.unshift(e); c = e.a; }
    return out;
}
/** cross Isafdar to region `to`. forest = stage >= 8 (dense-forest crossings), camp = stage >= 9 (the camp crossing). */
/** session 8 (allchaos qt25fm: after '-> hub' the bot stood at (2313,9656), the 'SEALED POCKET'): a failed pit jump drops
 *  the player on the spikes under Isafdar (regicide_pitfall_falldown, quest_regicide.rs2:283-310) next to hand holds
 *  (loc 3927 regicide_trap_hand_holds, 2x2 per pit) whose op1 puts him back up beside the pit (quest_regicide.rs2:318-339).
 *  The navgrid has no path out of those pockets. Climb out; true = back on the surface. RG_PIT_CLIMB=0 reverts. */
const HAND_HOLDS = [[2313, 9656], [2314, 9656], [2313, 9657], [2314, 9657], [2336, 9656], [2337, 9656], [2336, 9657], [2337, 9657],
    [2354, 9656], [2355, 9656], [2354, 9657], [2355, 9657], [2354, 9643], [2355, 9643], [2354, 9644], [2355, 9644]] as const;
const inPit = (bot: SpeedBot) => bot.minusedlevel === 0 && inBox(bot, 2310, 9640, 2358, 9660);
export async function climbOutOfPit(bot: SpeedBot, log: (s: string) => void): Promise<boolean> {
    if (process.env.RG_PIT_CLIMB === '0' || !inPit(bot)) return false;
    const from = { ...bot.tile() };
    for (let k = 0; k < 6 && inPit(bot) && !dead(bot); k++) {
        const me = bot.tile();
        const [hx, hz] = [...HAND_HOLDS].sort((a, b) => cheb(me, { x: a[0], z: a[1] }) - cheb(me, { x: b[0], z: b[1] }))[0]!;
        if (cheb(me, { x: hx, z: hz }) > 1) await bot.walkTo(hx, hz, { near: 1, maxTicks: 20, log: false });
        if (bot.chatModalId !== -1 || bot.mainModalId !== -1) { bot.closeModal(); bot.queueFlush(); }
        bot.opLoc(hx, hz, 3927, 1); bot.queueFlush();
        await bot.until(() => !inPit(bot), 6);
    }
    log(`fell into a pit at ${from.x},${from.z}: climbed out ${!inPit(bot)} -> ${JSON.stringify(bot.tile())}`);
    return !inPit(bot);
}
async function goIsaf(bot: SpeedBot, to: Reg, log: (s: string) => void, o: { forest: boolean; camp?: boolean }): Promise<void> {
    for (let guard = 0; guard < 14; guard++) {
        if (inPit(bot) && !(await climbOutOfPit(bot, log))) fail(bot, `goIsaf(${to}): stuck in a pit at ${bot.tile().x},${bot.tile().z}`);
        const cur = region(bot);
        if (cur === to) return;
        if (!cur) fail(bot, `goIsaf(${to}): not in a known Isafdar region`);
        const plan = isafPlan(cur!, bot.tile(), to, { forest: o.forest, camp: !!o.camp });
        if (!plan.length) fail(bot, `goIsaf: no route ${cur} -> ${to}`);
        const e = plan[0]!;
        for (const h of e.hops) {
            for (let tries = 0; tries < 6 && cheb(bot.tile(), h.land) > 0; tries++) {
                await actAt(bot, `cross ${h.loc.x},${h.loc.z}`, h.stand, () => { if (cheb(bot.tile(), h.stand) > 0) return false; bot.opLoc(h.loc.x, h.loc.z, h.loc.id, 1); bot.queueFlush(); },
                    () => cheb(bot.tile(), h.land) === 0, { every: 6, max: 24 });
                if (dead(bot)) return;
            }
            if (cheb(bot.tile(), h.land) > 0) fail(bot, `obstacle ${h.loc.id}@${h.loc.x},${h.loc.z} (stand ${h.stand.x},${h.stand.z})`);
        }
        log(`-> ${e.b}`);
    }
    fail(bot, `goIsaf(${to}): too many hops`);
}

// ---- entry 1: Iorwerth, the tracker, the old camp, the guard, the camp, back to Iorwerth (=11) ------------------------
const LR = {
    tracks: { id: 3941, x: 2240, z: 3150 }, tar: { id: 3975, x: 2263, z: 3127 }, loom: { id: 787, x: 2198, z: 3249 },
    sulphur: { id: 3963, x: 2261, z: 3130 },   // regicide_sulphar2 (L0; the one at 2265,3128 is on L1)
} as const;
/** talk to an npc until a page whose text matches `re` has been seen and the chat is closed */
async function talkUntil(bot: SpeedBot, type: number, re: RegExp, label: string, o: { done?: () => boolean; stand?: Tile; maxTicks?: number } = {}): Promise<void> {
    const snap = new Map(bot.ifText);
    let saw = false;
    const said = () => { if (saw) return true; for (const [k, v] of bot.ifText) if (snap.get(k) !== v && re.test(v)) { saw = true; return true; } return false; };
    let ok = await converse(bot, type, { done: () => (o.done?.() ?? false) || (said() && bot.chatModalId === -1), stand: o.stand, near: 6, maxTicks: o.maxTicks ?? 150, label });
    // session 8 (allchaos qt43m 'tracker 1' x2 at (2313,9656): the walk to the tracker crossed pit B and fell onto the spikes,
    // twice): out of the pit, back to the npc's region, talk again. RG_PIT_CLIMB=0 reverts.
    for (let k = 0; k < 2 && !ok && inPit(bot) && process.env.RG_PIT_CLIMB !== '0'; k++) {
        if (!(await climbOutOfPit(bot, s => console.log(`[regicide] ${label}: ${s}`)))) break;
        const reg: Reg = type === N.tracker ? 'hub' : 'iorw';
        await goIsaf(bot, reg, s => console.log(`[regicide] ${label}: ${s}`), { forest: false });
        ok = await converse(bot, type, { done: () => (o.done?.() ?? false) || (said() && bot.chatModalId === -1), stand: o.stand, near: 6, maxTicks: o.maxTicks ?? 150, label });
    }
    if (!ok) fail(bot, `${label}: no "${re.source}"`);
}
const TRK = { x: 2256, z: 3150 }, IOR = { x: 2205, z: 3250 };

/** Supply-gap change: the lazy guard wants a COOKED rabbit (raw is refused: regicide_tyras_lazy_guard.rs2:30-43).
 *  Kill an Isafdar rabbit (5 hp; the drop is raw_rabbit, "drop tables/scripts/rabbit.rs2:1-7", hero only), light the supplied
 *  logs (firemaking.rs2:79-128, fire loc 2732) and cook it (cooking_generic.dbrow:518-530: level 1, successchance 128..512 =
 *  never burns from cooking 34; a burn -> burnt_meat -> another rabbit). `must` = walk to the known spawns if none is in view;
 *  otherwise only a rabbit within 12 tiles is taken. True = a cooked rabbit is held. */
async function getRabbit(bot: SpeedBot, log: (s: string) => void, must: boolean): Promise<boolean> {
    const t0 = bot.tickCount;
    for (let tries = 0; tries < 5 && !has(bot, O.rabbit); tries++) {
        if (dead(bot)) return false;
        if (has(bot, BURNT_MEAT)) await bot.dropAll([BURNT_MEAT], 4);
        if (!has(bot, RAW_RABBIT)) {
            const near = () => npcsOf(bot, RABBITS).filter(n => n.d <= 12).sort((a, b) => a.d - b.d);
            if (!near().length) {
                if (!must) return false;
                const spot = RABBIT_SPOTS.slice().sort((a, b) => cheb(a, bot.tile()) - cheb(b, bot.tile())).find(t => region(bot) === 'hub' && cheb(t, bot.tile()) > 4) ?? RABBIT_SPOTS[0]!;
                await walk(bot, spot, 2, 'rabbit spawn');
                if (!(await bot.until(() => near().length > 0, 60))) continue;
            }
            const g0 = (): { x: number; z: number } | undefined => bot.findGroundItem(RAW_RABBIT, 12);
            await fight(bot, RABBITS, { max: 60, label: 'rabbit', pick: l => l.filter(n => n.d <= 14).sort((a, b) => a.d - b.d)[0] ?? null, done: () => !!g0() || has(bot, RAW_RABBIT) });
            const g = g0();
            if (g && !has(bot, RAW_RABBIT)) await pickup(bot, RAW_RABBIT, g, 30);
            if (!has(bot, RAW_RABBIT)) continue;
            log(`raw rabbit (${bot.tickCount - t0} t)`);
        }
        // a fire: reuse a live one within 6 tiles, else tinderbox on the logs (the engine retries every 4 t until it catches)
        // 267 (qx13m: 'raw rabbit' at (2205,3198), 80 t with no fire seen, the logs gone from the pack; the retry threw 'no logs
        // left for a fire' in 4 t and the ROUTE STOPPED at qp 87). Tinderbox-on-logs DROPS the log first (firemaking.rs2
        // light_logs_inv: inv_dropslot, then p_opobj(4) relights it from the ground every 4 t); anything that cuts that
        // interaction leaves the log on the ground and nothing ever relights it. Fix: fire search 10 tiles (12 once 'The
        // fire catches' is seen), relight a log lying within 3 tiles with op4 'Light' (opobj4,_category_22 -> light_logs_ground)
        // after 12 t without progress, a retry with no log held takes a dropped one back (10 tiles) before giving up.
        // RG_FIRE_FIX=0 reverts. TEST: RG_FIRE_TEST=drop drops the log before lighting (the ground relight path);
        // RG_FIRE_TEST=fail drops it and throws once per process (the retry's ground pickup path).
        const fix267 = process.env.RG_FIRE_FIX !== '0', LOGS = objId('logs'), fireT0 = bot.tickCount;
        const findFire = () => {
            const r = !fix267 ? 6 : msgSince(bot, fireT0, /fire catches/i) ? 12 : 10;
            let best: { x: number; z: number; id: number } | null = null, bd = 99;
            for (const [k, id] of bot.liveLocs) { if (id !== FIRE) continue; const [lv, x, z] = k.split(',').map(Number); const d = cheb({ x: x!, z: z! }, bot.tile()); if (lv === bot.minusedlevel && d <= r && d < bd) { best = { x: x!, z: z!, id }; bd = d; } }
            return best;
        };
        const fireDiag = () => { const fires = [...bot.liveLocs].filter(([, id]) => id === FIRE).map(([k]) => k); const g = bot.findGroundItem(LOGS, 12); return `fires [${fires.join(' ')}] groundLogs ${g ? `${g.x},${g.z}` : '-'} held ${bot.count(LOGS)} msgs ${JSON.stringify(msgsSince(bot, fireT0).slice(-6))} me{anim ${(bot as any).localPlayer?.primaryAnim} face ${(bot as any).localPlayer?.faceEntity} hit ${(bot as any).localPlayer?.combatCycle} hp ${bot.stat('hitpoints').cur}} rabbits ${JSON.stringify(npcsOf(bot, RABBITS).map(n => [n.idx, n.x, n.z, n.d]))}`; };
        let fire = findFire();
        if (!fire) {
            const test = process.env.RG_FIRE_TEST;
            if ((test === 'drop' || test === 'fail') && !(globalThis as any).__rgFireTest && has(bot, LOGS)) {
                (globalThis as any).__rgFireTest = 1; await bot.dropAll([LOGS], 4); log(`TEST ${test}: logs dropped (${fireDiag()})`);
                if (test === 'fail') fail(bot, 'rabbit: TEST fire fail (log dropped)');
            }
            if (fix267 && !has(bot, LOGS)) {
                const g = bot.findGroundItem(LOGS, 10);
                if (g && cheb(g, bot.tile()) > 3) { await pickup(bot, LOGS, g, 40); log(`rabbit: took a dropped log back (${has(bot, LOGS)})`); }
                else if (g) log(`rabbit: a log lies at ${g.x},${g.z}: relight it`);
            }
            if (!has(bot, LOGS) && !(fix267 && bot.findGroundItem(LOGS, 3))) fail(bot, `rabbit: no logs left for a fire (${fireDiag()})`);
            let logs0 = bot.count(LOGS), sent = -99, since = bot.tickCount, relit = 0;
            // qyk01 (fork of qx13) reproduced it: one 'You attempt to light the logs.', then 70 t of nothing and 6 op4 relights
            // in place without an answer (cause NOT found: no script error, no fire loc, the log stays on the ground; the
            // retry ~40 t later relit the same log in place). Every 2nd stall: step off one tile (a MOVE clears whatever holds
            // the player), take the log back (op3) and light it from the pack again on the new tile. 120 t budget.
            for (let k = 0; k < (fix267 ? 120 : 80) && !(fire = findFire()); k++) {
                if (msgSince(bot, since, /can't light a fire here/i)) {
                    const t = bot.tile(); since = bot.tickCount; bot.sendRoute([{ x: t.x + (k % 2 ? 1 : -1), z: t.z }]); await bot.tick(2); sent = -99;
                }
                if (process.env.RG_FIRE_TEST === 'stall' && !(globalThis as any).__rgFireStall && logs0 > 0 && bot.count(LOGS) < logs0) {
                    // TEST: cut the lighting right after the log hits the ground (a MOVE off the tile)
                    (globalThis as any).__rgFireStall = 1; const t = bot.tile(); bot.sendRoute([{ x: t.x + 1, z: t.z }]); bot.queueFlush(); await bot.tick(2);
                    log(`TEST stall: lighting cut by a step (${fireDiag()})`);
                }
                if (bot.count(LOGS) === logs0 && logs0 > 0 && bot.tickCount - sent >= 6) { const tb = objId('tinderbox'); bot.useItemOnItem(tb, bot.slot(tb), LOGS, bot.slot(LOGS)); bot.queueFlush(); sent = bot.tickCount; }
                else if (fix267 && bot.count(LOGS) < Math.max(1, logs0) && bot.tickCount - sent >= 12 && !msgSince(bot, bot.tickCount - 12, /attempt to light|fire catches/i)) {
                    const g = bot.findGroundItem(LOGS, 3);
                    if (!g) { await bot.tick(1); continue; }
                    relit++;
                    if (bot.chatModalId !== -1) { bot.closeModal(); bot.queueFlush(); }
                    // TEST: RG_FIRE_TEST=stall skips the in-place relight (forces the step-off path)
                    if (relit % 2 === 1 && process.env.RG_FIRE_TEST !== 'stall') {
                        // the log is on the ground and nobody is lighting it: op4 'Light' it where it lies
                        bot.opObj(g.x, g.z, LOGS, 4); bot.queueFlush(); sent = bot.tickCount;
                        log(`rabbit: relight the log on the ground at ${g.x},${g.z} (#${relit}; ${fireDiag()})`);
                    } else {
                        const me = bot.tile();
                        for (const dx of [-1, 1]) { if (cheb(bot.tile(), me) > 0) break; bot.sendRoute([{ x: me.x + dx, z: me.z }]); bot.queueFlush(); await bot.tick(3); }
                        const got = await pickup(bot, LOGS, g, 20);
                        log(`rabbit: stalled: stepped ${me.x},${me.z} -> ${bot.tile().x},${bot.tile().z}, log taken back ${got} (#${relit}; ${fireDiag()})`);
                        logs0 = bot.count(LOGS); sent = -99;
                        if (got && cheb(bot.tile(), g) === 0) { bot.sendRoute([{ x: g.x + (relit % 4 === 0 ? 1 : -1), z: g.z }]); bot.queueFlush(); await bot.tick(2); }
                    }
                }
                await bot.tick(1);
            }
            if (!fire) fail(bot, `rabbit: could not light a fire (${fireDiag()})`);
            log(`rabbit: fire at ${fire!.x},${fire!.z} (${bot.tickCount - fireT0} t${relit ? `, ${relit} relights` : ''})`);
        }
        const f = fire!;
        await bot.tick(1);   // the lighter steps off the fire tile
        for (let k = 0; k < 8 && has(bot, RAW_RABBIT); k++) {
            // the firemaking level-up page blocks the op (x25 xp): close every page first
            if (bot.chatModalId !== -1) { answer(bot, [], 0); await bot.tick(1); continue; }
            if (cheb(bot.tile(), f) > 1) routeNextTo(bot, { x: f.x, z: f.z } as any);
            bot.useItemOnLoc(f.x, f.z, f.id, RAW_RABBIT, bot.slot(RAW_RABBIT)); bot.queueFlush();
            await bot.until(() => !has(bot, RAW_RABBIT) || bot.chatModalId !== -1, 8);
        }
        if (has(bot, RAW_RABBIT)) fail(bot, 'rabbit: not cooked on the fire');
        await bot.until(() => has(bot, O.rabbit) || has(bot, BURNT_MEAT), 4);
        log(has(bot, O.rabbit) ? `cooked rabbit (${bot.tickCount - t0} t)` : 'rabbit burnt');
    }
    return has(bot, O.rabbit);
}
const segIsaf1: Seg = async (bot, log) => {
    // book held = this segment is done, UNLESS the tar chain is gone ( a failed still used up the tar and left the
    // barrel EMPTY; the only tar is the hub pit here). Then it runs on: cloth/tar/sulphur/rabbit steps are each guarded by has().
    // Same for the cloth and the sulphur dust: 'outside' fuses with the cloth and mixes
    // the dust in, and both are made only here; a lost one runs the segment on (each step below is has()-guarded).
    // tarOk/clothOk/sulphurOk = the product or something made from it is held (the steps below skip those too).
    const later = (...ids: number[]) => ids.some(o => has(bot, o));
    const tarOk = () => later(O.tar, 3221, 3222, 3223, O.bomb, O.fused), clothOk = () => later(O.cloth, O.fused);
    const sulphurOk = () => later(O.sulphurDust, 3222, O.bomb, O.fused);
    if (has(bot, O.book) && tarOk() && clothOk() && sulphurOk()) return;
    // session 8 (allchaos qt25fm retry: segment 'iorw' resumed from Ardougne castle L1 -> 'goIsaf: not in a known Isafdar
    // region'): a retry re-enters Isafdar the way segIsaf2 does (pit -> climb out; mainland -> Ardougne tele if far, the
    // pass to the Well of Voyage, the cave exit). RG_REENTER=0 reverts.
    if (process.env.RG_REENTER !== '0') {
        await climbOutOfPit(bot, log);
        const inIsafdar = () => bot.minusedlevel === 0 && bot.tile().z < 3300 && bot.tile().x > 2150 && bot.tile().x < 2340;
        if (!inIsafdar() && !region(bot)) {
            if (!underground(bot) && (bot.tile().x > 2600 || bot.tile().z < 3280)) {
                const r = await tele(bot, 'ardougne_teleport');
                if (!r.ok) fail(bot, 'Ardougne teleport (re-entry)');
            }
            log(`re-entering Isafdar from ${JSON.stringify(bot.pos())}`);
            await passToWell(bot, log);
            await enterIsafdar(bot, log);
        }
    }
    // session 11 (audit: the retry replayed from Iorwerth 1, whose lines differ once the quest is past =4): on a retry, the
    // stage the JOURNAL shows (regicide_journal.rs2; first match = latest). RG_JOURNAL=0 = from the top as before.
    const st = isResuming(bot) && process.env.RG_JOURNAL !== '0' ? await journalStage<number>(bot, 'regicide', [
        [/found the camp of King Tyras/i, 10], [/encountered\s+a soldier/i, 9], [/told me of signs to\s+look for/i, 8],
        [/found some tracks leading off/i, 7], [/search\s+the\s+west\s+side/i, 6],
        [/didn't trust me|given me his pendant as proof/i, 5], [/offered the help of one of his\s+trackers/i, 4],
    ], 3, log) : 3;
    if (st > 3) log(`resume from the journal: stage ${st}`);
    const forest = st >= 8;
    // Iorwerth (=4)
    if (st < 4 || !clothOk() || (!has(bot, O.barrel) && !tarOk())) await goIsaf(bot, 'iorw', log, { forest, camp: st >= 10 });
    if (st < 4) {
    await talkUntil(bot, N.iorwerth, /I shall return|tracker|Good day, .* How may I help you now/i, 'iorwerth 1', { stand: IOR });
    log('Iorwerth (=4)');
    }
    // cloth from the loom (crafting 10, 4 wool) and the empty barrel ground spawn (2205,3257) while here
    if (!clothOk()) {
        if (!(await useOnLoc(bot, 'loom', objId('ball_of_wool'), LR.loom, () => has(bot, O.cloth), { every: 6, max: 40 }))) fail(bot, 'loom (cloth)');
        log('cloth');
    }
    if (!has(bot, O.barrel) && !tarOk()) {
        if (!(await pickup(bot, O.barrel, { x: 2205, z: 3257 }, 40))) fail(bot, 'empty barrel');
    }
    // tracker without the pendant (=5), Iorwerth's pendant, the tracker again (=6)
    if (st < 9) await goIsaf(bot, 'hub', log, { forest });
    if (st < 5) {
    if (!has(bot, O.rabbit)) await getRabbit(bot, log, false);   // pit B's landing has 3 rabbit spawns (2206-2208,3195-3198)
    await talkUntil(bot, N.tracker, /no time for brigands|Well\.\.\. err\.\.\. No/i, 'tracker 1', { stand: TRK });
    log('tracker (=5)');
    }
    if (st < 6) {
    if (!has(bot, O.pendant)) {
    await goIsaf(bot, 'iorw', log, { forest: false });
    await talkUntil(bot, N.iorwerth, /he will recognise this|crystal pendant/i, 'iorwerth pendant', { stand: IOR, done: () => has(bot, O.pendant) && bot.chatModalId === -1 });
    log('pendant');
    await goIsaf(bot, 'hub', log, { forest: false });
    }
    await talkUntil(bot, N.tracker, /tell me if you find anything|west end of the camp/i, 'tracker 2', { stand: TRK });
    log('pendant shown (=6)');
    }
    // the tracks (=7), the tracker (=8)
    if (st < 7) {
    const t7 = bot.tickCount;
    if (!(await opUntil(bot, 'tracks', LR.tracks, 1, () => msgSince(bot, t7, /follow the foot prints|lead into impassable/i), { every: 5, max: 40 }))) fail(bot, 'tracks (=7)');
    log('tracks (=7)');
    }
    if (st < 8) {
    await talkUntil(bot, N.tracker, /no trouble following the tracks/i, 'tracker 3', { stand: TRK });
    log('tracker (=8)');
    }
    await bot.dropAll([O.pendant], 4);
    // a resume past =8 away from the hub with the tar, sulphur or rabbit still missing: back to the hub for them
    if (st >= 9 && (!tarOk() || (!sulphurOk() && !has(bot, O.sulphur)) || !has(bot, O.rabbit))) await goIsaf(bot, 'hub', log, { forest: true, camp: st >= 10 });
    // coal tar + ground sulphur (the tar pit and the sulphur rocks are 2-5 tiles apart)
    if (!tarOk()) {
        // stand by the pit first: useOnLoc's 40 t window includes the walk, and a resume from the hub ran out of it while walking
        // (sim rgcf 7108: 'coal tar' at (2257,3136) twice; from (2263,3128) the barrel filled in 7 t)
        if (cheb(bot.tile(), { x: 2263, z: 3128 }) > 2) await walk(bot, { x: 2263, z: 3128 }, 1, 'tar pit');
        if (!(await useOnLoc(bot, 'tar', O.barrel, LR.tar, () => has(bot, O.tar), { every: 5, max: 40 }))) fail(bot, 'coal tar');
    }
    if (!sulphurOk()) {
        // (loc-scene does not index the sulphur formations: op them raw from the next tile)
        if (!has(bot, O.sulphur) && !(await actAt(bot, 'sulphur', { x: 2262, z: 3130 }, () => { bot.opLoc(LR.sulphur.x, LR.sulphur.z, LR.sulphur.id, 1); bot.queueFlush(); }, () => has(bot, O.sulphur), { every: 4, max: 40 }))) fail(bot, 'sulphur');
        const p = objId('pestle_and_mortar');
        bot.useItemOnItem(O.sulphur, bot.slot(O.sulphur), p, bot.slot(p)); bot.queueFlush();
        if (!(await bot.until(() => has(bot, O.sulphurDust), 6))) fail(bot, 'grind sulphur');
    }
    log('tar + sulphur dust');
    // last hub visit of entry 1: the rabbit for the lazy guard (entry 2) is made now at the latest
    if (!has(bot, O.rabbit) && !(await getRabbit(bot, log, true))) fail(bot, 'no cooked rabbit');
    // west through the forest: landing on (2231,3149) at =8 spawns the old-camp guard (quest_regicide.rs2:464-466,602-610)
    if (st < 9) {
    // session 11 fix 398b (qx372m 'died in isaf1' 1393 t: forest tripwire poison (quest_regicide.rs2:190-226) ate all 5 sharks
    // by the hub (hp 65 -> 30), the Tyras guard then killed us at hp 35 with no food, and the retry had no arrows (lost on
    // death) -> 'no arrows left' -> partner heros 'main did not arrive'): low hp and < 2 food before the guard -> Falador
    // tele + bank heal (falHeal), then back in the way the retry does (Ardougne tele, the pass, the cave exit; arrows still
    // held). RG_GUARD_HEAL=0 reverts; RG_GUARD_HP=<fraction> (0.6). TEST: RG_GUARD_TEST=1 forces the trip.
    // fix 398e: 398b is OPT-IN (RG_GUARD_HEAL=1): forced trips (g398a/b) ran short of law runes on the Ardougne teleport back
    // ('Ardougne teleport' at 2205,3251 -> STOPPED), worse than the rare guard death it guards against.
    if (process.env.RG_GUARD_HEAL === '1' && (process.env.RG_GUARD_TEST === '1' || (foodCount(bot) < 2 && bot.stat('hitpoints').cur < bot.stat('hitpoints').level * Number(process.env.RG_GUARD_HP ?? 0.6)))) {
        log(`398b: hp ${bot.stat('hitpoints').cur}, food ${foodCount(bot)} before the Tyras guard: Falador heal + re-enter`);
        if (!(await tele(bot, 'falador_teleport')).ok) fail(bot, 'Falador teleport (398b)');
        await falHeal(bot, log);
        // fix 398d (proof398 t398b: the extra pass burnt the rope segIsaf2 needs -> 'no rope for the swing' at 2442,9716): take
        // spare ropes here (the bank holds them; the retry prep withdrew 2) so the later pass still has one.
        if (bot.count('rope') < 2) {
            const b = await bot.openBank({ radius: 30 });
            if (b.ok) { if (bot.bankCount('rope') > 0) { await bot.withdraw('rope', 2 - bot.count('rope')); await bot.tick(1); } bot.closeBank(); await bot.tick(1); }
            if (bot.count('rope') < 2) log(`398d: only ${bot.count('rope')} rope(s) after the bank: the 2nd pass may fail`);
        }
        if (!(await tele(bot, 'ardougne_teleport')).ok) fail(bot, 'Ardougne teleport (398b)');
        await passToWell(bot, log);
        await enterIsafdar(bot, log);
    }
    const tg = bot.tickCount;
    await goIsaf(bot, 'oldcamp', log, { forest: true });
    if (!msgSince(bot, tg, /Kill|defeated/i)) {
        await bot.until(() => !!npc(bot, N.oldGuard), 6);
        if (npc(bot, N.oldGuard)) {
            log('fighting the Tyras guard');
            await fight(bot, N.oldGuard, { max: 400, spell: SPELL || undefined });
            if (dead(bot)) return;
        }
    }
    log('guard down (=9)');
    }
    // the camp crossing at =9 sets =10 (quest_regicide.rs2:467-471), then back north to Iorwerth (=11, the book)
    if (st < 10) {
    await goIsaf(bot, 'tyras', log, { forest: true, camp: true });
    log('camp entered (=10)');
    }
    await goIsaf(bot, 'iorw', log, { forest: true, camp: true });
    await talkUntil(bot, N.iorwerth, /book useful|working on it/i, 'iorwerth book', { stand: IOR, done: () => has(bot, O.book) && bot.chatModalId === -1 });
    log('book (=11)');
};

// ---- outside: Falador furnace (quicklime), pestle + pot (dust), Rimmington still (naphtha), the bomb ------------------
const VARP_STILL_TOTAL = 330, VARP_STILL_SETTINGS = 331;   // regicide_still_total / _settings (transmitted)
const STILL = { id: 4026, x: 2927, z: 3212 }, FURNACE = { id: 2781, x: 2975, z: 3368 };
const NAPHTHA = 3221, MIX_Q = 3223, MIX_S = 3222;
/** coal for the still: live acct9 used 5 and stalled at total 22/26; want 10, never start with fewer than 7 */
const STILL_COAL_WANT = 10, STILL_COAL_MIN = 7;
const STILL_COAL = 5061, STILL_VALVE_UP = 6174, STILL_TAR_UP = 6176, STILL_CLOSE = 5030;
/** heat needle = (set bit in 13-25) - 13 (regicide_fractionalizing_still.rs2:160-180) */
function heat(bot: SpeedBot): number { const v = bot.getVarp(VARP_STILL_SETTINGS); for (let b = 13; b <= 25; b++) if (v & (1 << b)) return b - 13; return -1; }
/** the still: pressure valve up once + tar valve up twice keeps pressure flat; feed coal on the heat needle (h <= 7, at most
 *  every 2 cycles, 2 coal when h <= 3); progress +2 per cycle while tar is full and h is 6..11; done at 26 (13 good cycles) */
async function runStill(bot: SpeedBot, log: (s: string) => void): Promise<void> {
    const open = () => bot.mainModalId !== -1;
    if (!open()) fail(bot, 'still interface not open');
    bot.burst([() => bot.ifButton(STILL_VALVE_UP), () => bot.ifButton(STILL_TAR_UP), () => bot.ifButton(STILL_TAR_UP)]);
    await bot.tick(1);
    let lastCoal = -100, coal = 0;
    const t0 = bot.tickCount;
    while (bot.getVarp(VARP_STILL_TOTAL) < 26 && open() && bot.tickCount - t0 < 120) {
        const h = heat(bot);
        if (h >= 0 && h <= 7 && bot.tickCount - lastCoal >= 4 && bot.count('coal') > 0) {
            const n = h <= 3 ? 2 : 1;
            bot.burst(Array.from({ length: n }, () => () => bot.ifButton(STILL_COAL)));
            lastCoal = bot.tickCount; coal += n;
        }
        await bot.tick(1);
    }
    const total = bot.getVarp(VARP_STILL_TOTAL);
    log(`still: total ${total} after ${bot.tickCount - t0} t, ${coal} coal`);
    if (total < 26) fail(bot, `still not finished (total ${total}, coal left ${bot.count('coal')})`);
    bot.ifButton(STILL_CLOSE); bot.queueFlush();
    if (!(await bot.until(() => has(bot, NAPHTHA), 6))) fail(bot, 'no naphtha after closing the still (free slot?)');
}
/** the Falador bank heal (session 8): withdraw sharks, eat to >= 85%, carry up to 4 (see the call sites) */
async function falHeal(bot: SpeedBot, log: (s: string) => void): Promise<void> {
    const hpL = bot.stat('hitpoints');
    if (process.env.RG_HEAL !== '0' && !HANDOFF && (hpL.cur < hpL.level * 0.7 || bot.count('shark') < 2)) {
        let b = await bot.openBank({ radius: 30 });
        for (let k = 1; k < 4 && !b.ok; k++) { await bot.walkTo(2946, 3369, { near: 1, maxTicks: 40, log: false, closeDoors: true }); b = await bot.openBank({ radius: 16, kind: k % 2 === 0 ? 'npc' : 'any', maxTicks: 15 } as any); }
        if (b.ok && bot.bankCount('shark') > 0) {
            const want = Math.min(bot.bankCount('shark'), Math.max(0, bot.free() - 2), 4 + Math.ceil(Math.max(0, hpL.level * 0.85 - hpL.cur) / 20));
            if (want > 0) { await bot.withdraw('shark', want); await bot.tick(1); }
            bot.closeBank(); await bot.tick(1);
            for (let k = 0; k < 10 && bot.stat('hitpoints').cur < bot.stat('hitpoints').level * 0.85 && bot.count('shark') > 0; k++) {
                const sl = bot.slot('shark'); bot.opHeld1(objId('shark'), sl); bot.queueFlush(); await bot.tick(3);
            }
        } else if (b.ok) bot.closeBank();
        log(`healed at the Falador bank: hp ${bot.stat('hitpoints').cur}/${bot.stat('hitpoints').level}, sharks ${bot.count('shark')}`);
    }
}

const segOutside: Seg = async (bot, log) => {
    if (has(bot, O.fused)) return;
    if (bot.tile().z < 3300 && bot.tile().x < 2340) {   // still in Isafdar (teleports work there: teleport.rs2 has no block)
        const r = await tele(bot, 'falador_teleport');
        if (!r.ok) fail(bot, 'Falador teleport');
        log('Falador');
    }
    // fix 330 (fork qzm17m DIED: the Tyras guard + poison left hp 6 with no sharks; the Falador heal ran only AFTER the
    // furnace and its ~8 hp burn killed us): under 50% hp before the quicklime, heal at the Falador bank first (the later
    // call then sees hp >= 70% and skips). RG_HEAL_PRE=0 reverts; RG_HEAL_PRE_AT=<fraction> sets the bar (test: 0.9).
    if (process.env.RG_HEAL_PRE !== '0' && !has(bot, O.quicklime) && !has(bot, O.quickDust) && bot.stat('hitpoints').cur < bot.stat('hitpoints').level * Number(process.env.RG_HEAL_PRE_AT ?? 0.5)) {
        log(`330: hp ${bot.stat('hitpoints').cur} before the furnace: Falador bank heal first`);
        await falHeal(bot, log);
    }
    // 323b (qx92m retry: the traveller climbed the furnace house stairs to L1 (2973,3370) and 'quicklime' useOnLoc'd the
    // furnace from upstairs, 80 t, STOPPED): upstairs in that house -> down the stairstop (1723 at 2971,3371, map m46_52).
    // RG_FURNACE_DOWN=0 reverts.
    // 323b TEST: RG_FURNACE_TEST=1 walks into the house and up the stairs (1722 at 2971,3370) first
    if (process.env.RG_FURNACE_TEST === '1' && !has(bot, O.quicklime) && !has(bot, O.quickDust)) {
        await bot.walkTo(2972, 3371, { closeDoors: true, maxTicks: 200, log: false });
        for (let k = 0; k < 4 && bot.minusedlevel === 0; k++) { bot.opLoc(2971, 3370, 1722, 1); bot.queueFlush(); await bot.until(() => bot.minusedlevel === 1, 10); }
        log(`323b TEST: upstairs L${bot.minusedlevel} at ${JSON.stringify(bot.tile())}`);
    }
    if (process.env.RG_FURNACE_DOWN !== '0' && bot.minusedlevel === 1 && cheb(bot.tile(), { x: 2973, z: 3372 }) <= 8) {
        for (let k = 0; k < 4 && bot.minusedlevel === 1; k++) { bot.opLoc(2971, 3371, 1723, 1); bot.queueFlush(); await bot.until(() => bot.minusedlevel === 0, 10); }
        log(`323b furnace house: down the stairs: L${bot.minusedlevel}`);
    }
    // quicklime at the Falador furnace (stage >= 11, gloves worn or 8 hp: quest_regicide.rs2:649-670)
    // 323c (qzm07/qzm08: hp 31->23 and 34->27 at the furnace = the 8 hp burn: the gloves worn at the module start were off
    // by here): wear them again right before. RG_GLOVES_FURNACE=0 reverts.
    if (process.env.RG_GLOVES_FURNACE !== '0' && has(bot, 'leather_gloves') && !bot.isWorn(objId('leather_gloves')) && !has(bot, O.quicklime) && !has(bot, O.quickDust)) {
        await wear(bot, 'leather_gloves'); log(`323c gloves worn for the furnace: ${bot.isWorn(objId('leather_gloves'))}`);
    }
    if (!has(bot, O.quicklime) && !has(bot, O.quickDust)) {
        // stand inside first: the house door loc_1531 (west edge of 2971,3376) can stand open with its leaf walling the way in
        // (chaos door states): walkTo with closeDoors shuts a blocking open leaf and re-plans (core.ts walkTo)
        if (cheb(bot.tile(), { x: 2974, z: 3370 }) > 0) {
            await walk(bot, { x: 2971, z: 3377 }, 0, 'furnace house door');
            for (let k = 0; k < 3 && bot.tile().z > 3376; k++) {   // op the door (open it if shut) and step through
                bot.opLoc(2971, 3376, 1531, 1); bot.queueFlush(); await bot.tick(2);
                bot.sendRoute([{ x: 2971, z: 3375 }]); await bot.until(() => bot.tile().z <= 3375, 4);
            }
            await bot.walkTo(2974, 3370, { closeDoors: true, maxTicks: 120, log: false });
        }
        if (!(await useOnLoc(bot, 'furnace', O.limestone, FURNACE, () => has(bot, O.quicklime), { stand: { x: 2974, z: 3370 }, every: 6, max: 80 }))) fail(bot, 'quicklime');
    }
    if (!has(bot, O.quickDust)) {
        const p = objId('pestle_and_mortar');
        bot.useItemOnItem(O.quicklime, bot.slot(O.quicklime), p, bot.slot(p)); bot.queueFlush();
        if (!(await bot.until(() => has(bot, O.quickDust), 8))) fail(bot, 'quicklime dust (pot?)');
    }
    log('quicklime dust');
    // session 8 (allchaos qt37m DIED after Tyras: hp 57 -> 36 at the old-camp guard, then down to 7 by Ardougne with no food
    // left, and entry 2 crossed the pass and the camp at hp 1-13): heal at the Falador bank on the way south (we pass it for
    // the coal anyway): withdraw sharks, eat to >= 85%, carry up to 4. RG_HEAL=0 reverts.
    await falHeal(bot, log);
    // coal for the still: a helper hand-off, else the Falador bank (2946,3368), on the way south
    if (bot.count('coal') < STILL_COAL_MIN && !has(bot, NAPHTHA) && !has(bot, O.bomb)) {
        // route session 5 (allchaos qs6m: the route's bigger pack left < 5 free slots, the hand-off's 'withdraw 7' failed:
        // 'not enough inventory space'): make room by dropping sharks beyond 2, then ask only for what fits (>= 5 coal total)
        const needC = Math.max(0, STILL_COAL_MIN - bot.count('coal'));
        for (let k = 0; k < 8 && bot.free() < needC && bot.count('shark') > 2; k++) { const sl = bot.slot('shark'); if (sl < 0) break; bot.dropItem(objId('shark'), sl); bot.queueFlush(); await bot.tick(1); }
        if (HANDOFF) await HANDOFF('falador', [{ name: 'coal', n: Math.max(needC, Math.min(STILL_COAL_WANT - bot.count('coal'), bot.free())) }]);
        else {
            let b = await bot.openBank({ radius: 30 });
            // fix 190 (allchaos qt26m 'bank open false' at (2949,3368), one try): up to 6 tries, booth/banker alternating, a walk
            // to the Falador West booths between (as route-lib bankVisit). RG_BANK_RETRY=0 reverts.
            for (let k = 1; k < 6 && !b.ok && process.env.RG_BANK_RETRY !== '0'; k++) {
                if (bot.chatModalId !== -1) { bot.closeModal(); await bot.tick(1); }
                await bot.walkTo(2946, 3369, { near: 1, maxTicks: 40, log: false, closeDoors: true });
                b = await bot.openBank({ radius: 16, kind: k % 2 === 0 ? 'npc' : 'any', maxTicks: 15 } as any);
                console.log(`[regicide] Falador bank try ${k + 1}: ${b.ok} at ${JSON.stringify(bot.tile())}`);
            }
            // route runner (fix 141, qrqa/qrqc: 4 coal already held + a near-full pack: 'withdraw 7' -> 'not enough inventory
            // space', and the bank check wanted 5 in the bank regardless of the pack): top up to 7 as far as the pack allows
            const want = Math.max(0, STILL_COAL_WANT - bot.count('coal')), min = Math.max(0, STILL_COAL_MIN - bot.count('coal'));
            if (!b.ok || bot.bankCount('coal') < min) fail(bot, `need ${STILL_COAL_MIN}+ coal at Falador (bank or helper): bank open ${b.ok}, bank coal ${bot.bankCount('coal')}, held ${bot.count('coal')}`);
            const n = Math.min(want, bot.bankCount('coal'), bot.free());
            if (n > 0) { await bot.withdraw('coal', n); await bot.tick(1); }
            bot.closeBank();
        }
        if (bot.count('coal') < STILL_COAL_MIN) fail(bot, `coal hand-off failed (pack full?): ${bot.count('coal')} < ${STILL_COAL_MIN}`);
    }
    // the still in Rimmington
    if (!has(bot, NAPHTHA) && !has(bot, MIX_Q) && !has(bot, MIX_S) && !has(bot, O.bomb)) {
        await walk(bot, { x: 2928, z: 3213 }, 3, 'Rimmington still', 600);
        if (!(await useOnLoc(bot, 'still', O.tar, STILL, () => bot.mainModalId !== -1, { every: 5, max: 40 }))) fail(bot, 'tar into the still');
        await runStill(bot, log);
    }
    // the bomb: quicklime dust + sulphur dust on the naphtha (any order), then the cloth fuse (quest_regicide.rs2:717-788)
    const mix = async (a: number, b: number, done: () => boolean, what: string) => {
        if (done()) return;
        bot.useItemOnItem(b, bot.slot(b), a, bot.slot(a)); bot.queueFlush();
        if (!(await bot.until(done, 6))) fail(bot, what);
    };
    if (!has(bot, O.bomb)) {
        await mix(NAPHTHA, O.quickDust, () => has(bot, MIX_Q) || has(bot, O.bomb), 'naphtha + quicklime');
        await mix(MIX_Q, O.sulphurDust, () => has(bot, O.bomb), 'mix + sulphur');
    }
    await mix(O.bomb, O.cloth, () => has(bot, O.fused), 'fuse');
    log('fused barrel bomb');
};

// ---- entry 2: Ardougne, the pass again, the lazy guard's rabbit, the catapult (=12), Iorwerth's message (=13) ---------
const CATAPULT = { id: 3976, x: 2185, z: 3183 };
const segIsaf2: Seg = async (bot, log) => {
    if (has(bot, O.message)) return;
    const inIsafdar = () => bot.minusedlevel === 0 && bot.tile().z < 3300 && bot.tile().x > 2150 && bot.tile().x < 2340;
    // session 8 (allchaos qt37m: died after Tyras (=12), the retry resumed here at Lumbridge without the bomb and threw
    // 'goIsaf(iorw): not in a known Isafdar region'): re-enter whenever we are out of Isafdar (and out of a pit first).
    if (process.env.RG_REENTER !== '0') await climbOutOfPit(bot, log);
    if (!inIsafdar() && (has(bot, O.fused) || (process.env.RG_REENTER !== '0' && !region(bot)))) {
        if (!underground(bot) && bot.tile().x > 2600 || bot.tile().z < 3280) {
            const r = await tele(bot, 'ardougne_teleport');
            if (!r.ok) fail(bot, 'Ardougne teleport');
            log('Ardougne');
        }
        await passToWell(bot, log);
        await enterIsafdar(bot, log);
    }
    if (has(bot, O.fused)) {
        // session 11 (audit: guard/rabbit gap): a retry after the rabbit was eaten (given_rabbit set, regicide_tyras_lazy_guard
        // .rs2:12-15 'This is delicious ... finish it off') goes straight to the catapult; a rabbit lost otherwise is made again
        // at the hub (getRabbit). RG_RABBIT_RESUME=0 reverts (the old fail).
        let alreadyFed = false;
        if (!has(bot, O.rabbit) && process.env.RG_RABBIT_RESUME !== '0') {
            await goIsaf(bot, 'campN', log, { forest: true, camp: true });
            if (!npc(bot, N.lazyGuard) || npc(bot, N.lazyGuard)!.d > 8) await walk(bot, { x: 2184, z: 3182 }, 2, 'catapult');
            const snapT = new Map(bot.ifText);
            let saw = false;
            const said = () => { if (saw) return true; for (const [k, v] of bot.ifText) if (snapT.get(k) !== v && /delicious|finish it off/i.test(v)) { saw = true; return true; } return false; };
            await converse(bot, N.lazyGuard, { done: () => said() && bot.chatModalId === -1, near: 8, maxTicks: 40, label: 'lazy guard (fed?)' });
            if (bot.chatModalId !== -1) { bot.closeModal(); bot.queueFlush(); await bot.tick(1); }
            alreadyFed = said();
            log(`lazy guard already fed: ${alreadyFed}`);
            if (!alreadyFed) {
                await goIsaf(bot, 'hub', log, { forest: true, camp: true });
                if (!(await getRabbit(bot, log, true))) fail(bot, 'no cooked rabbit (remade)');
            }
        }
        if (!alreadyFed) {
        if (!has(bot, O.rabbit)) fail(bot, 'no cooked rabbit for the lazy guard (made in entry 1, segIsaf1)');
        // the lazy guard eats the rabbit (bit given_rabbit); any later forest crossing landing in 34_49 clears it, so feed him last
        await goIsaf(bot, 'campN', log, { forest: true, camp: true });
        if (!npc(bot, N.lazyGuard) || npc(bot, N.lazyGuard)!.d > 8) await walk(bot, { x: 2184, z: 3182 }, 2, 'catapult');
        const t0 = bot.tickCount;
        const fed = () => msgSince(bot, t0, /rabbit|tasty|scoff|eat/i) && !has(bot, O.rabbit);
        const ok = await act(bot, 'lazy guard', () => {
            const g = npc(bot, N.lazyGuard); const sl = bot.slot(O.rabbit); if (!g || sl < 0) return false;
            routeNextTo(bot, g); bot.useItemOnNpc(g.idx, O.rabbit, sl); bot.queueFlush();
        }, () => !has(bot, O.rabbit), { every: 6, max: 60 });
        if (!ok) fail(bot, `lazy guard rabbit (${fed()})`);
        log('rabbit given');
        failHook('rg-rabbit');
        }
        const tc = bot.tickCount;
        const fired = () => !has(bot, O.fused);
        if (!(await useOnLoc(bot, 'catapult', O.fused, CATAPULT, fired, { stand: { x: 2185, z: 3182 }, every: 8, max: 60 }))) fail(bot, `catapult (${msgsSince(bot, tc).slice(-2).join(' | ')})`);
        // the cutscene teleports us away and back to (2183,3185) ~20 t later (quest_regicide.rs2:512-597)
        await bot.until(() => cheb(bot.tile(), { x: 2183, z: 3185 }) <= 2 && bot.tickCount - tc > 10, 40);
        log('Tyras is dead (=12)');
    }
    await goIsaf(bot, 'iorw', log, { forest: true, camp: true });
    await talkUntil(bot, N.iorwerth, /pass through Arandar|Not yet, my lord/i, 'iorwerth message', { stand: IOR, done: () => has(bot, O.message) && bot.chatModalId === -1 });
    log('message (=13)');
};
/** Ardougne teleport, the castle bridge zone (x 2584-2591, z 3296-3303) runs Arianwyn's scene (=14, quest_regicide.rs2:792-830;
 *  its scroll page must be closed), then King Lathas takes the message (king_lathas.rs2:7-20) */
const segFinish: Seg = async (bot, log) => {
    const q0 = qp(bot);
    if (bot.tile().x < 2340 || underground(bot)) {
        const r = await tele(bot, 'ardougne_teleport');
        if (!r.ok) fail(bot, 'Ardougne teleport');
    }
    const zone = () => bot.minusedlevel === 0 && inBox(bot, 2584, 3296, 2591, 3303);
    const t0 = bot.tickCount;
    const sceneDone = () => msgSince(bot, t0, /Arianwyn/i) && bot.tickCount - t0 > 30 && bot.chatModalId === -1 && bot.mainModalId === -1 && !npc(bot, 1202);
    if (bot.minusedlevel === 0) {
        await walk(bot, { x: 2588, z: 3300 }, 2, 'castle bridge (Arianwyn)');
        // stay in the zone (within 5 tiles of Arianwyn) while the 16 queued pages run; close the scroll page when it opens
        const s0 = bot.tickCount;
        let seen = false;
        // the last page sets =14 (quest_regicide.rs2:820-823): "Deliver your message, act normal. We'll be in touch."
        const last = () => [...bot.ifText.values()].some(v => /act normal\. We'll be in touch/i.test(v));
        let lastAt = -1;
        while (bot.tickCount - s0 < 120) {
            if (npc(bot, 1202)) seen = true;
            if (last() && lastAt < 0) lastAt = bot.tickCount;
            if (bot.mainModalId !== -1) { bot.closeModal(); bot.queueFlush(); }
            else if (bot.chatModalId !== -1) answer(bot, [], 0);
            else if (lastAt >= 0 && bot.tickCount - lastAt >= 1) break;
            await bot.tick(1);
        }
        log(`Arianwyn scene (${bot.tickCount - s0} t, seen ${seen})`);
    }
    void sceneDone; void zone;
    // the castle's double door (west edges of 2576,3298-3299) then the stairs (L0 2571,3295) by hand
    if (bot.minusedlevel === 0 && bot.tile().x >= 2576) await openDoor(bot, { id: 2546, x: 2576, z: 3298 }, { x: 2576, z: 3298 }, 0);
    // up the castle stairs (L0 2571,3295) by hand: the multi-level planner sometimes stops short on L0
    if (bot.minusedlevel === 0 && !(await opUntil(bot, 'castle stairs up', { id: 1722, x: 2571, z: 3295 }, 1, () => bot.minusedlevel === 1, { stand: { x: 2572, z: 3298 }, every: 5, max: 80 }))) fail(bot, 'castle stairs');
    const done = () => qp(bot) >= q0 + QUEST.qp || msgSince(bot, t0, /completed the|Regicide/i) && !has(bot, O.message);
    if (!(await talkLathas(bot, done, log)) && !(await bot.until(done, 10))) fail(bot, 'King Lathas: Regicide not completed');
    log(`QUEST COMPLETE (qp ${q0} -> ${qp(bot)})`);
};

export const SEGMENTS: Array<[string, Seg]> = [['msg', segMsg], ['lathas', segLathas], ['pass1', segPass1], ['isafdar', segIsafdar], ['isaf1', segIsaf1], ['outside', segOutside], ['isaf2', segIsaf2], ['finish', segFinish]];

export async function run(bot: SpeedBot, o: { log?: boolean; from?: string; handoff?: Handoff } = {}): Promise<RunResult> {
    await nav();
    HANDOFF = o.handoff;
    bot.holdDialogs = true;
    const log0 = mkLog(bot, 'regicide', o.log !== false);
    // failHook (resume proofs): SR_FAIL_AT=rg<n> throws once after the '(=<n>)' stage mark, rg-<seg> after a segment
    const log = (s: string) => { log0(s); const mm = /\(=(\d+)\)/.exec(s); if (mm) failHook(`rg${mm[1]}`); };
    const t0 = bot.tickCount, splits: Record<string, number> = {};
    trace(bot, t0);
    const stopEat = eatWatch(bot, 0.5);
    const qp0 = qp(bot);
    if (has(bot, 'leather_gloves') && !bot.isWorn(objId('leather_gloves'))) await wear(bot, 'leather_gloves');   // quicklime burns bare hands (8 hp)
    let started = !o.from;
    try {
        for (const [name, seg] of SEGMENTS) {
            if (!started && name === o.from) started = true;
            if (!started) continue;
            const s0 = bot.tickCount;
            await seg(bot, log);
            if (dead(bot)) return { ok: false, ticks: bot.tickCount - t0, msg: `died in ${name}`, splits };
            splits[name] = bot.tickCount - s0;
            log(`== ${name} done in ${splits[name]} t`);
            failHook(`rg-${name}`);
            if (process.env.REG_TO === name) return { ok: false, ticks: bot.tickCount - t0, msg: `stopped after ${name} (REG_TO)`, splits };
        }
    } finally { stopEat(); }
    const ok = qp(bot) >= qp0 + QUEST.qp;
    return { ok, ticks: bot.tickCount - t0, msg: ok ? 'King Lathas: Regicide complete' : 'not finished', splits };
}
