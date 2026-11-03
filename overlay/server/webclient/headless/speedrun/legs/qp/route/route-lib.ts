/// <reference types="bun" />
// route-lib.ts — the max-QP route runner's plumbing (phase 2): items, banks, travel (walk / teleports / the Paterdomus
// crossing), the helper hand-off, the Regicide messenger watcher, the progress file and the timeline. Cheat-free except
// the helper STAGING (a helper is filled and positioned by staff cheat in --sim only: the live route needs a walking
// helper there, see STATUS.md "live gaps").
import { mkdirSync, readFileSync, writeFileSync, appendFileSync, existsSync } from 'fs';
import { resolve } from 'path';
import { SpeedBot, objId, objDebugName, cheb, localSetup, initNav, CHEATS, componentId, certOf, stallNote } from '../../../core.js';
import { tele, msgsSince, npc, npcsOf, opNpcGo, opLocGo, rawResume, qp, locAt, walkOp, dismiss, nav as qnav } from '../../q-lib.js';
import { wield, unwieldAll, tradeIn as tradeIn0, enterGnomeStronghold, type Item } from '../../run-lib.js';
import { glory } from '../spine/sp-lib.js';
import { NO_GLORY } from '../noglory.js';
import { rubTele } from '../rebuild/rb-lib.js';
import { trapdoorDown, opUntil } from '../morytania/mo-lib.js';
import * as ls from '../../../../loc-scene.js';

export type { Item };
/** the travel kit carried between quests (teleport runes; + one charged glory); bank visits top it up */
export const KIT: Item[] = [
    { name: 'lawrune', n: 12 }, { name: 'airrune', n: 40 }, { name: 'waterrune', n: 12 }, { name: 'earthrune', n: 6 }, { name: 'firerune', n: 8 },
    { name: 'coins', n: 200 },   // the Al Kharid toll gate (10 gp) and small fares
];
export type Tile = { x: number; z: number; level?: number };
export const HERE = import.meta.dir;
let LOGFILE = '';
export function setLogFile(f: string): void { LOGFILE = f; }
export const say = (tag: string, s: string) => {
    const line = `[${tag}] ${s}`;
    console.log(line);
    if (LOGFILE) { try { appendFileSync(LOGFILE, line + String.fromCharCode(10)); } catch { /* ignore */ } }
};

// ---------------------------------------------------------------------------------------------------------------------
// items
// ---------------------------------------------------------------------------------------------------------------------
const EQUIP = 1688;   // worn container (leanbot)
export function worn(bot: SpeedBot): number[] {
    const w = (bot as any).invs.get(EQUIP) as { ids: Int32Array } | undefined;
    return w ? [...w.ids].filter(id => id > 0) : [];
}
/** pack + worn count of an item */
export function have(bot: SpeedBot, name: string): number { const id = objId(name); return bot.count(id) + (bot.isWorn(id) ? 1 : 0); }
export function merge(items: Item[]): Item[] {
    const out: Item[] = [];
    for (const it of items) { const s = out.find(o => o.name === it.name); if (s) s.n = Math.max(s.n, it.n); else out.push({ name: it.name, n: it.n }); }
    return out;
}
/** sum duplicate entries (two modules' needs for the same stack) */
export function sum(items: Item[]): Item[] {
    const out: Item[] = [];
    for (const it of items) { const s = out.find(o => o.name === it.name); if (s) s.n += it.n; else out.push({ name: it.name, n: it.n }); }
    return out;
}
// fix 85: + swamppaste (stackable=yes, cooking.obj:188; qri2m Mort'ton 'pack too small': 20 pastes counted as 20 slots), darts, bolts
const STACK_RE = /^cert_|(?<!blank)rune$|^coins$|_arrow$|arrowheads$|^feather$|^thread$|_knife$|^nails$|^mcannonball$|^fishing_bait$|^swamppaste$|_dart$|_bolts$/;
export const stackable = (name: string) => STACK_RE.test(name);
export function slots(items: Item[]): number { return items.reduce((a, i) => a + (stackable(i.name) ? 1 : i.n), 0); }
export const packStr = (bot: SpeedBot) => bot.inv().map(s => `${objDebugName(s.obj)}${s.count > 1 ? 'x' + s.count : ''}`).join(',');
export const wornStr = (bot: SpeedBot) => worn(bot).map(objDebugName).join(',');
export function levels(bot: SpeedBot): Record<string, number> {
    const o: Record<string, number> = {};
    for (const s of ['attack', 'strength', 'defence', 'hitpoints', 'ranged', 'prayer', 'magic', 'cooking', 'woodcutting', 'fletching', 'fishing',
        'firemaking', 'crafting', 'smithing', 'mining', 'herblore', 'agility', 'thieving']) o[s] = bot.stat(s).level;
    return o;
}
export function combatLevel(bot: SpeedBot): number {
    const l = (s: string) => bot.stat(s).level;
    const base = 0.25 * (l('defence') + l('hitpoints') + Math.floor(l('prayer') / 2));
    return Math.floor(base + Math.max(0.325 * (l('attack') + l('strength')), 0.325 * Math.floor(l('ranged') * 1.5), 0.325 * Math.floor(l('magic') * 1.5)));
}

// ---------------------------------------------------------------------------------------------------------------------
// travel: teleports (magic_spells.dbrow, amulet_of_glory.rs2, ring_of_dueling.rs2, necklace_of_minigames.rs2)
// ---------------------------------------------------------------------------------------------------------------------
type Runes = Partial<Record<'law' | 'air' | 'water' | 'earth' | 'fire', number>>;
export interface Tele { id: string; to: Tile; magic?: number; runes?: Runes; spell?: string; item?: RegExp; quest?: string; cost: number }
export const TELES: Tele[] = [
    { id: 'varrock', to: { x: 3213, z: 3424 }, magic: 25, runes: { law: 1, air: 3, fire: 1 }, spell: 'varrock_teleport', cost: 5 },
    { id: 'lumbridge', to: { x: 3221, z: 3218 }, magic: 31, runes: { law: 1, air: 3, earth: 1 }, spell: 'lumbridge_teleport', cost: 5 },
    { id: 'falador', to: { x: 2965, z: 3378 }, magic: 37, runes: { law: 1, air: 3, water: 1 }, spell: 'falador_teleport', cost: 5 },
    { id: 'camelot', to: { x: 2757, z: 3478 }, magic: 45, runes: { law: 1, air: 5 }, spell: 'camelot_teleport', cost: 5 },
    { id: 'ardougne', to: { x: 2661, z: 3301 }, magic: 51, runes: { law: 2, water: 2 }, spell: 'ardougne_teleport', quest: 'plague', cost: 5 },
    { id: 'trollheim', to: { x: 2890, z: 3679 }, magic: 61, runes: { law: 2, fire: 2 }, spell: 'trollheim_teleport', quest: 'eadgar', cost: 5 },
    { id: 'glory-edgeville', to: { x: 3087, z: 3496 }, item: /^amulet_of_glory_[1-4]$/, cost: 7 },
    { id: 'glory-karamja', to: { x: 2918, z: 3176 }, item: /^amulet_of_glory_[1-4]$/, cost: 7 },
    { id: 'glory-draynor', to: { x: 3105, z: 3251 }, item: /^amulet_of_glory_[1-4]$/, cost: 7 },
    { id: 'glory-alkharid', to: { x: 3293, z: 3163 }, item: /^amulet_of_glory_[1-4]$/, cost: 7 },
    { id: 'duel-arena', to: { x: 3315, z: 3235 }, item: /^ring_of_dueling_[1-8]$/, cost: 7 },
    { id: 'duel-castlewars', to: { x: 2440, z: 3090 }, item: /^ring_of_dueling_[1-8]$/, cost: 7 },
    { id: 'games-burthorpe', to: { x: 2899, z: 3564 }, item: /^necklace_of_minigames_[1-8]$/, cost: 30 },
];
const RUNE: Record<string, string> = { law: 'lawrune', air: 'airrune', water: 'waterrune', earth: 'earthrune', fire: 'firerune' };
/** the runner's done set per bot (Runner.runOne0 sets it): modules' no-glory hops (noglory.ts) plan with the quest-gated teleports */
export const DONE_OF = new WeakMap<SpeedBot, Set<string>>();
const GLORY_TELE = /^glory-/;
export function canTele(bot: SpeedBot, t: Tele, done: Set<string>): boolean {
    if (t.quest && !done.has(t.quest)) return false;
    if (GLORY_TELE.test(t.id) && NO_GLORY()) return false;   // charger pair: never a glory (noglory.ts)
    if (t.magic && bot.stat('magic').level < t.magic) return false;
    if (t.item) return bot.inv().some(s => t.item!.test(objDebugName(s.obj)));
    const staffAir = bot.isWorn(objId('staff_of_air'));
    for (const [r, n] of Object.entries(t.runes ?? {})) { if (r === 'air' && staffAir) continue; if (bot.count(RUNE[r]!) < n!) return false; }
    return true;
}
export async function castTele(bot: SpeedBot, t: Tele): Promise<boolean> {
    if (bot.chatModalId !== -1 || bot.mainModalId !== -1) { dismiss(bot); await bot.tick(1); }
    if (t.spell) return (await tele(bot, t.spell)).ok;
    if (t.id.startsWith('glory-')) {
        const dest = ({ 'glory-edgeville': 1, 'glory-karamja': 2, 'glory-draynor': 3, 'glory-alkharid': 4 } as const)[t.id as 'glory-edgeville'];
        try { await glory(bot, dest, t.id); return true; } catch (e) { say('travel', `${t.id}: ${(e as Error).message.slice(0, 160)}`); return false; }
    }
    if (t.id === 'duel-arena') return rubTele(bot, t.item!, /Duel Arena/i, 15);
    if (t.id === 'duel-castlewars') return rubTele(bot, t.item!, /Castle Wars/i, 15);
    if (t.id === 'games-burthorpe') {
        if (!(await rubTele(bot, t.item!, /Burthorpe/i, 15))) return false;
        // games room (2207,4940) -> stairs 4622 (2207,4935) -> L1 -> grey stairs 4627 (2205,4935) -> Burthorpe (2899,3564)
        // (stairs.rs2:471-476 board_game_stairs_base 0_34_77_31_7 -> 1_34_77_31_6; :509-515 grey_base2 1_34_77_29_7 -> 0_45_55_19_44).
        // fix 67: the old walkTo from the games room had no navgrid route; the runner then hung in planMultiLevel (qrh7m,
        // watchdog kill). Explicit stairs instead.
        await bot.until(() => bot.tile().z > 4900 && bot.tile().z < 4960 || bot.tile().z < 4000, 8);
        for (let k = 0; k < 4 && bot.minusedlevel === 0 && bot.tile().z > 4900; k++) { opLocGo(bot, locAt(4622, 2207, 4935, 0), 1); bot.queueFlush(); await bot.until(() => bot.minusedlevel === 1, 20); }
        for (let k = 0; k < 4 && bot.minusedlevel === 1 && bot.tile().z > 4900; k++) { opLocGo(bot, locAt(4627, 2205, 4935, 1), 1); bot.queueFlush(); await bot.until(() => bot.tile().z < 4000, 20); }
        if (bot.tile().z > 4000) say('travel', `games room exit failed at ${JSON.stringify(bot.pos())}`);
        return bot.tile().z < 4000;
    }
    return false;
}

/** walk length (tiles) on the surface via the navgrid; Infinity when the navgrid has no route (islands, Morytania, walls) */
const WALK_CACHE = new Map<string, number>();
export async function walkTiles(a: Tile, bIn: Tile): Promise<number> {
    const b = standInOf(bIn);
    const la = a.level ?? 0, lb = b.level ?? 0;
    const under = (t: Tile) => t.z > 6400;
    if (under(a) || under(b)) {
        if (under(a) && under(b) && cheb(a, b) < 80) return cheb(a, b) * 1.4 + (la !== lb ? 10 : 0);
        return underTwin(a, b);
    }
    if (cheb(a, b) <= 3) return cheb(a, b);
    const key = `${a.x},${a.z}>${b.x},${b.z}`;
    const hit = WALK_CACHE.get(key); if (hit !== undefined) return hit + (la !== 0 ? 8 : 0) + (lb !== 0 ? 8 : 0);
    const nav = await initNav();
    // session 11 fix 309c (SR_PLAN_YIELD=0 reverts; SR_STALL_FIX=0 reverts every 309 fix): a plan prices up to ~15 candidates
    // with navgrid queries back to back while every other bot in the process waits; yield one event-loop turn before each
    // uncached query so the others read their tick and ack in between (planning stays one bot's time, not everyone's)
    if (process.env.SR_PLAN_YIELD !== '0' && process.env.SR_STALL_FIX !== '0') await new Promise<void>(r => setImmediate(r));
    let pts: Tile[] = [];
    try { pts = nav.navFindPath(0, a.x, a.z, b.x, b.z); } catch { pts = []; }
    let n = Infinity;
    if (pts.length) {
        n = 0; let p: Tile = a;
        for (const q of pts) { n += cheb(p, q); p = q; }
        if (cheb(p, b) > 3) n = Infinity;   // the planner gave up short
    }
    // an upper floor (Ardougne castle L1 after Underground Pass, sim qrf6m): the L0 tile under it may not be standable for
    // the surface planner; the multi-level walker takes the stairs. Estimate by distance (same zone only).
    // (not across the Gnome Stronghold's scripted gate: the L1 gnome banks looked reachable from Ardougne, sim qrg1m)
    if (n === Infinity && (la !== 0 || lb !== 0) && zone(a) === zone(b) && cheb(a, b) < 200 && inStronghold(a) === inStronghold(b)) n = cheb(a, b) * 1.3 + 16;
    WALK_CACHE.set(key, n);
    return n + (la !== 0 ? 8 : 0) + (lb !== 0 ? 8 : 0);
}
export const walkTicks = (tiles: number) => tiles === Infinity ? Infinity : Math.ceil(tiles / 2 * 1.08 + 2);

/** Morytania east of the Salve (surface): the navgrid has no way in; the mausoleum + holy barrier are the door */
// fix 83 (revised): the holy barrier lands at (3423,3485) (holy_barrier.rs2: p_telejump(0_53_54_31_29)), a strip east of the
// temple that the navgrid connects to the Mort Myre gate and Canifis; (3423,3476) is temple-side mainland (probe-mory.ts)
export const inMorytania = (t: Tile) => t.z < 6400 && t.z >= 3100 && t.z <= 3600 && (t.x >= 3425 || (t.x >= 3421 && t.z >= 3483 && t.z <= 3490));
/** the PiP mausoleum (underground, x 3395-3450, z 9860-9915): reachable from the mainland trapdoor */
const inMausoleum = (t: Tile) => t.z > 9850 && t.z < 9920 && t.x > 3390 && t.x < 3460;

export interface TravelPlan { how: string; est: number; tele?: Tele; via?: 'paterdomus' }
/** cheapest way from `from` to `to` (estimates), given what the bot holds now */
/** coarse zones the walker cannot cross (cheap reachability for ranking; the navgrid decides in the refine step) */
function zone(t: Tile): string {
    if (t.z > 6400) return `u${t.x >> 6},${t.z >> 6}`;
    if (inMorytania(t)) return 'morytania';
    if ((t.x >= 2740 && t.x <= 2990 && t.z >= 2870 && t.z <= 3195) || (t.x >= 2690 && t.x <= 2820 && t.z >= 3140 && t.z <= 3260)) return 'karamja';
    if (t.x >= 2800 && t.x <= 2870 && t.z >= 3320 && t.z <= 3395) return 'entrana';
    if (t.z >= 3800 && t.x >= 2480 && t.x <= 2640) return 'miscellania';
    return 'main';
}
/** a dungeon right under its surface twin (z - 6400): the multi-level walker (LeanBot traveller) climbs out by ladder/stairs
 *  (Grand Tree roots -> the tree -> the gnome bank; sim qre2m had no runes left there) */
function underTwin(a: Tile, b: Tile): number {
    const u = a.z > 6400 ? a : b, s = a.z > 6400 ? b : a;
    if (u.z <= 6400 || s.z > 6400) return Infinity;
    // disabled: sdk/navgrid/levels planMultiLevel never returned for (2607,9453 L0) -> (2613,3092) (Watch Tower enclave ->
    // Yanille bank, sim qre2m: the process spun until the watchdog killed it). Known exits are explicit (Grand Tree cellar).
    void u; void s;
    return Infinity;
}
function quickTiles(a: Tile, b: Tile): number {
    const za = zone(a), zb = zone(b);
    if ((a.z > 6400) !== (b.z > 6400)) return underTwin(a, b);
    if (za !== zb) {
        if (za[0] === 'u' && zb[0] === 'u' && cheb(a, b) < 80) return cheb(a, b) * 1.4;
        return Infinity;
    }
    return cheb(a, b) * 1.3 + ((a.level ?? 0) !== 0 ? 8 : 0) + ((b.level ?? 0) !== 0 ? 8 : 0);
}
/** cheapest way from `from` to `to`, given what the bot holds now. Ranks every option with straight-line estimates, then
 *  prices the best 3 with navgrid walk lengths (planning time is game time: the lockstep sim stops waiting for a busy client). */
export async function planTravel(bot: SpeedBot, from: Tile, to: Tile, done: Set<string>, o: { assumeKit?: boolean; fast?: boolean; kit?: Item[] } = {}): Promise<TravelPlan> {
    // fix 309x: log a slow plan (wall time; its awaits are microtasks except the 309c yields, so ~all of it blocks the loop)
    const t0 = performance.now();
    const p = await planTravelRaw(bot, from, to, done, o);
    stallNote('planTravel(wall)', performance.now() - t0, `${bot.loginUser} ${JSON.stringify(from)}>${JSON.stringify(to)} ${o.fast ? 'fast ' : ''}${p.how} est ${p.est}`);
    return p;
}
async function planTravelRaw(bot: SpeedBot, from: Tile, to: Tile, done: Set<string>, o: { assumeKit?: boolean; fast?: boolean; kit?: Item[] }): Promise<TravelPlan> {
    const legCost = async (a: Tile, b: Tile, fast: boolean) => {
        const W = fast ? async (x: Tile, y: Tile) => quickTiles(x, y) : walkTiles;
        if (inMorytania(b) && !inMorytania(a)) {
            if (!done.has('pip')) return Infinity;
            // mausoleum trapdoor (3405,3507) -> gates -> holy barrier -> (3423,3485)
            const w1 = inMausoleum(a) ? 0 : await W(a, { x: 3405, z: 3506 });
            return walkTicks(w1) + 40 + walkTicks(await W({ x: 3423, z: 3485 }, b));
        }
        if (inMorytania(a) && !inMorytania(b)) return Infinity;   // leave Morytania by teleport only
        // fix 127 (qrp4c: duel-arena ring to the Al Kharid bank, then 2 x 400 t walking into the toll gate 3268,3227): before
        // Prince Ali Rescue the gate needs a pay dialog the walker never does, so no walk crosses it either way
        if (!done.has('prince') && inAlKharid(a) !== inAlKharid(b)) return Infinity;
        if (inGtCellar(b) && !inGtCellar(a)) return walkTicks(await W(a, { x: 2461, z: 3375 })) + 60;   // gnome gate + trunk trapdoor
        if (inMausoleum(b) && !inMausoleum(a)) {
            if (!done.has('pip')) return Infinity;
            return walkTicks(await W(a, { x: 3405, z: 3506 })) + 30;   // trapdoor + gates 1/2 to Drezel's room
        }
        return walkTicks(await W(a, b));
    };
    const cands: Array<{ how: string; tele?: Tele; via?: 'paterdomus'; from: Tile; cost: number; est: number }> = [];
    const pat = inMorytania(to) && !inMorytania(from);
    // walking down from an upper floor goes through the multi-level planner, which hung on the Grand Tree (sim qrh7m, twice):
    // when a teleport is possible, walking from a non-zero level is priced out
    // fix 135 (qrq8m after Upass: King Lathas L1 -> glory to Edgeville -> Catherby bank 367 t, then a 349 t walk to the gnome
    // gate; qrq7m walked down to Ardougne north bank: 214 t + 262 t): Ardougne castle's stairs are a plain multi-level walk
    const ardCastle = from.x >= 2565 && from.x <= 2595 && from.z >= 3283 && from.z <= 3310 && from.z < 6400;
    const upPenalty = !ardCastle && (from.level ?? 0) !== 0 && TELES.some(t => (o.assumeKit ? kitTele(bot, t, done, o.kit) : canTele(bot, t, done))) ? 1000 : 0;
    cands.push({ how: pat ? 'walk + paterdomus' : 'walk', via: pat ? 'paterdomus' : undefined, from, cost: upPenalty, est: upPenalty + await legCost(from, to, true) });
    for (const t of TELES) {
        if (!(o.assumeKit ? kitTele(bot, t, done, o.kit) : canTele(bot, t, done))) continue;
        // fix 114 (partner pre-run qrm1p: glory to Al Kharid, then the walk west wedged at the toll gate 3268,3227 for 1,000 t —
        // the gate wants 10 gp and a dialog until Prince Ali Rescue is done): no Al Kharid landing for a destination west of the gate
        if (t.id === 'glory-alkharid' && !done.has('prince') && to.x < 3268 && to.z < 6400) continue;
        cands.push({ how: `tele ${t.id}${inMorytania(to) ? ' + paterdomus' : ''}`, tele: t, via: inMorytania(to) ? 'paterdomus' : undefined, from: t.to, cost: t.cost, est: t.cost + await legCost(t.to, to, true) });
    }
    cands.sort((a, b) => a.est - b.est);
    if (o.fast) { const c = cands[0]; return c && c.est < Infinity ? { how: c.how, est: c.est, tele: c.tele, via: c.via } : { how: 'none', est: Infinity }; }
    let best: TravelPlan = { how: 'none', est: Infinity };
    for (const c of cands.slice(0, 3)) {
        if (c.est === Infinity) break;
        const real = c.cost + await legCost(c.from, to, false);
        if (real < best.est) best = { how: c.how, est: real, tele: c.tele, via: c.via };
    }
    if (best.est === Infinity) for (const c of cands.slice(3)) {   // the cheap ranking was wrong (maze, walls): try the rest
        const real = c.cost + await legCost(c.from, to, false);
        if (real < Infinity) { best = { how: c.how, est: real, tele: c.tele, via: c.via }; break; }
    }
    return best;
}
/** after a bank visit: the kit (runes + glory + necklace + ring) is assumed available */
function kitTele(bot: SpeedBot, t: Tele, done: Set<string>, kit?: Item[]): boolean {
    if (t.quest && !done.has(t.quest)) return false;
    if (GLORY_TELE.test(t.id) && NO_GLORY()) return false;   // charger pair: never a glory (noglory.ts)
    if (t.magic && bot.stat('magic').level < t.magic) return false;
    // fix 131: with the post-bank pack known, the teleport needs its item / runes in it (qrq4m + qrq6m: MM's exact pack has no
    // travel runes, but the bank was ranked as if Camelot Teleport were held: Edgeville bank, then a 601 t walk to the gate)
    if (kit) {
        if (t.item) return kit.some(i => t.item!.test(i.name));
        const staffAir = bot.isWorn(objId('staff_of_air')) || kit.some(i => i.name === 'staff_of_air');
        for (const [r, n] of Object.entries(t.runes ?? {})) { if (r === 'air' && staffAir) continue; if (kit.filter(i => i.name === RUNE[r]).reduce((a, i) => a + i.n, 0) < n!) return false; }
    }
    return true;
}

/** The Grand Tree cellar (Narnode's roots: GT ends there, MM starts there). Out: ladder_from_cellar 1755 (2463,9897) ->
 *  trunk L0. In: the trunk trapdoor 2446 (2463,3497, quest_grandtree.rs2:1-10, %grandtree complete) -> +6400. */
export const inGtCellar = (t: Tile) => t.z > 9870 && t.z < 9920 && t.x > 2440 && t.x < 2490;
/** Al Kharid east of the toll gate wall (x 3268), incl. the Duel Arena landing: the walker cannot pay the gate (dialog) */
export const inAlKharid = (t: Tile) => (t.level ?? 0) === 0 && t.z < 6400 && t.x >= 3268 && t.x <= 3420 && t.z >= 3115 && t.z <= 3290;
export const inStronghold = (t: Tile) => t.z < 6400 && t.x >= 2370 && t.x <= 2510 && t.z >= 3385 && t.z <= 3520;
export async function leaveGtCellar(bot: SpeedBot): Promise<boolean> {
    await qnav();
    for (let k = 0; k < 4 && bot.tile().z > 6400; k++) {
        if (bot.chatModalId !== -1) dismiss(bot);
        opLocGo(bot, locAt(1755, 2463, 9897), 1); bot.queueFlush();
        await bot.until(() => bot.tile().z < 6400, 15);
    }
    return bot.tile().z < 6400;
}
/** Out of the Gnome Stronghold through its scripted south gate 190 (2459,3383) (run-lib enterGnomeStronghold in reverse) */
export async function leaveStronghold(bot: SpeedBot): Promise<boolean> {
    await qnav();
    // fix 134: (2461,3384) is north of the gate (z 3383) but outside inStronghold (z >= 3385): not out yet
    const north = () => inStronghold(bot.tile()) || (bot.tile().z < 6400 && bot.tile().z >= 3383 && Math.abs(bot.tile().x - 2461) <= 4);
    if (!north()) return true;
    if (inStronghold(bot.tile())) await bot.walkTo(2461, 3386, { near: 1, maxTicks: 300, log: false });
    const gate = locAt(190, 2459, 3383, 0);
    for (let k = 0, last = -100; k < 60 && north(); k++) {
        if (bot.chatModalId !== -1) dismiss(bot);
        if (bot.tickCount - last >= 5) { bot.opLocReach(gate, 1); bot.queueFlush(); last = bot.tickCount; }
        await bot.tick(1);
    }
    return !north();
}
export async function enterGtCellar(bot: SpeedBot, done: Set<string>, tag: string): Promise<boolean> {
    if (inGtCellar(bot.tile())) return true;
    await qnav();
    if (!inStronghold(bot.tile())) {
        await travelTo(bot, { x: 2461, z: 3375 }, done, { near: 3, tag });
        const { enterGnomeStronghold } = await import('../../run-lib.js');
        try { await enterGnomeStronghold(bot); } catch (e) { say(tag, `gnome gate: ${(e as Error).message}`); return false; }
        bot.holdDialogs = true;
    }
    await bot.walkTo(2463, 3496, { near: 1, maxTicks: 200, log: false, closeDoors: true });
    for (let k = 0; k < 5 && bot.tile().z < 6400; k++) {
        if (bot.chatModalId !== -1) dismiss(bot);
        opLocGo(bot, locAt(2446, 2463, 3497), 1); bot.queueFlush();
        await bot.until(() => bot.tile().z > 6400, 10);
    }
    return inGtCellar(bot.tile());
}
/** Into the PiP mausoleum (Drezel's room) from the mainland: trapdoor (3405,3507), gate 1, gate 2. */
export async function enterMausoleum(bot: SpeedBot): Promise<boolean> {
    if (!inMausoleum(bot.tile())) await trapdoorDown(bot, { x: 3405, z: 3507 }, 1568, 1570, { x: 3405, z: 3506 });
    const gate1 = locAt(3444, 3405, 9895, 0), gate2 = locAt(3445, 3431, 9897, 0);
    if (bot.tile().x < 3410 && bot.tile().z >= 9895 && !(await opUntil(bot, gate1, 1, { x: 3405, z: 9895 }, () => bot.tile().z <= 9894, { maxTicks: 40 }))) return false;
    if (bot.tile().x <= 3431 && !(await opUntil(bot, gate2, 1, { x: 3431, z: 9897 }, () => bot.tile().x >= 3432, { maxTicks: 60 }))) return false;
    return true;
}
/** Cross into Morytania from the mainland side: mausoleum trapdoor, gate 1, gate 2, holy barrier (PiP stage 61). */
export async function enterMorytania(bot: SpeedBot): Promise<boolean> {
    if (inMorytania(bot.tile())) return true;
    if (!inMausoleum(bot.tile())) await trapdoorDown(bot, { x: 3405, z: 3507 }, 1568, 1570, { x: 3405, z: 3506 });
    const gate1 = locAt(3444, 3405, 9895, 0), gate2 = locAt(3445, 3431, 9897, 0), barrier = locAt(3443, 3440, 9886, 0);
    if (bot.tile().x < 3410 && bot.tile().z >= 9895 && !(await opUntil(bot, gate1, 1, { x: 3405, z: 9895 }, () => bot.tile().z <= 9894, { maxTicks: 40 }))) return false;
    if (bot.tile().x <= 3431 && !(await opUntil(bot, gate2, 1, { x: 3431, z: 9897 }, () => bot.tile().x >= 3432, { maxTicks: 60 }))) return false;
    return opUntil(bot, barrier, 1, { x: 3440, z: 9887 }, () => bot.tile().z < 6400, { maxTicks: 40 });
}

/** Go to `to` the cheapest way (teleport + walk, the Paterdomus crossing). Returns ticks and the method. */
/** fix 80: quest starts the navgrid cannot reach (an enclosed tile); travel/estimates use a reachable tile next to them and
 *  the module walks the last steps itself. Canifis by Vanstrom (Myreque): every Canifis tile around the tavern reads
 *  unreachable from the Paterdomus barrier exit while (3500,3480) is reachable (probe-mory.ts). */
const WALK_STAND_IN: Array<[Tile, Tile]> = [[{ x: 3503, z: 3475 }, { x: 3500, z: 3480 }]];
export const standInOf = (t: Tile): Tile => { const hit = WALK_STAND_IN.find(([k]) => cheb(k, t) <= 1 && (t.level ?? 0) === 0); return hit ? { ...hit[1], level: 0 } : t; };
export async function travelTo(bot: SpeedBot, toIn: Tile, done: Set<string>, o: { near?: number; tag?: string; maxTicks?: number } = {}): Promise<{ ok: boolean; ticks: number; how: string; est: number }> {
    const to = standInOf(toIn);
    const t0 = bot.tickCount, near = o.near ?? 2, lvl = to.level ?? 0, tag = o.tag ?? 'travel';
    const arrived = () => cheb(bot.tile(), to) <= near && bot.minusedlevel === lvl;
    if (arrived()) return { ok: true, ticks: 0, how: 'here', est: 0 };
    if (bot.chatModalId !== -1 || bot.mainModalId !== -1) { dismiss(bot); await bot.tick(1); }
    if (inGtCellar(bot.tile()) && !inGtCellar(to)) { const okL = await leaveGtCellar(bot); say(tag, `out of the Grand Tree cellar: ${okL}`); }
    if (inStronghold(bot.tile()) && !inStronghold(to) && !inGtCellar(to) && !TELES.some(t => canTele(bot, t, done))) { const okS = await leaveStronghold(bot); say(tag, `out of the Gnome Stronghold: ${okS}`); }
    if (inGtCellar(to) && !inGtCellar(bot.tile())) {
        const okE = await enterGtCellar(bot, done, tag);
        if (okE) await bot.walkTo(to.x, to.z, { near, maxTicks: 60, log: false });
        return { ok: okE && arrived(), ticks: bot.tickCount - t0, how: 'gnome gate + trunk trapdoor', est: 0 };
    }
    // fix 133 (qrq7c: Edgeville -> the trunk door planned 'none (est Infinity)', the gnome-gate walk from Edgeville failed and
    // the helper DIED twice on the way, losing the MM demon kit): into the Stronghold = travel (teleports priced) to the
    // outside of the gate first, then the scripted gate below
    if (inStronghold(to) && !inStronghold(bot.tile()) && bot.tile().z < 6400 && cheb(bot.tile(), { x: 2461, z: 3378 }) > 6) {
        const g = await travelTo(bot, { x: 2461, z: 3378, level: 0 }, done, { near: 3, tag });
        say(tag, `to the gnome gate first: ${g.how} ${g.ticks} t (ok ${g.ok})`);
    }
    // session 11 fix 305b (SR_GATE_NOPLAN; qx66/qx67 Underground Pass rockslide): at the gnome gate with a Stronghold target the
    // plan is always 'none (est Infinity t)' (the scripted gate is a wall to the navgrid) and every candidate's walk query
    // searches the whole reachable map synchronously: ~14 s with the event loop blocked, so every other bot in this process
    // (the main mid-rockslide) missed ~70 ticks (engine 'without an ack (qx66m 71)'). The gate + walk below need no plan:
    // skip it there. =0 reverts.
    const atGate = process.env.SR_GATE_NOPLAN !== '0' && inStronghold(to) && !inStronghold(bot.tile()) && bot.tile().z < 6400 && cheb(bot.tile(), { x: 2461, z: 3378 }) <= 6;
    const pw = Date.now();
    const p: TravelPlan = atGate ? { how: 'gnome gate (no plan)', est: 60 } : await planTravel(bot, bot.pos(), to, done);
    say(tag, `${JSON.stringify(bot.pos())} -> ${JSON.stringify(to)}: ${p.how} (est ${p.est} t; plan ${Date.now() - pw} ms)`);
    if (p.tele && !(await castTele(bot, p.tele))) {
        say(tag, `teleport ${p.tele.id} failed; walking`);
    }
    if (inMausoleum(to) && !inMausoleum(bot.tile()) && !inMorytania(bot.tile())) {
        if (!(await enterMausoleum(bot))) { say(tag, `mausoleum entry failed at ${JSON.stringify(bot.pos())}`); return { ok: false, ticks: bot.tickCount - t0, how: p.how, est: p.est }; }
    }
    if (p.via === 'paterdomus' && !inMorytania(bot.tile())) {
        if (!(await enterMorytania(bot))) { say(tag, `Paterdomus crossing failed at ${JSON.stringify(bot.pos())}`); return { ok: false, ticks: bot.tickCount - t0, how: p.how, est: p.est }; }
    }
    let gated = false;
    if (inStronghold(to) && !inStronghold(bot.tile()) && (bot.tile().z < 6400)) {
        gated = true;
        try { const g = await enterGnomeStronghold(bot); say(tag, `through the gnome gate (${g.ticks} t)`); } catch (e) { say(tag, `gnome gate: ${(e as Error).message.slice(0, 120)}`); }
        bot.holdDialogs = true;
    }
    // fix 80: no navgrid route at all: walking would spin on unreachable navFindPath queries (~4 s each, synchronous: the
    // watchdog killed qri2 at Myreque); leave the last leg to the module
    if (p.est === Infinity && !arrived() && !gated) { say(tag, `no walk route to ${JSON.stringify(to)}: the module walks from ${JSON.stringify(bot.pos())}`); return { ok: false, ticks: bot.tickCount - t0, how: p.how, est: p.est }; }
    for (let k = 0; k < 3 && !arrived(); k++) {
        // fix 99 (chaos qrk1m Cook's Assistant: stuck in the Lumbridge castle hall 2 x 155 t, the kitchen door 1536 open in a
        // non-default state walled the route): closeDoors from the 2nd try (it only acts when the walk ends short)
        const r = await bot.walkTo(to.x, to.z, { level: lvl, near, maxTicks: o.maxTicks ?? Math.min(1500, 120 + 3 * (p.est === Infinity ? 300 : p.est)), log: false, closeDoors: k > 0 });
        if (!r.ok && k < 2) { say(tag, `walk try ${k + 1} ended at ${JSON.stringify(bot.pos())} (${r.message ?? ''})`); await bot.tick(2); }
    }
    return { ok: arrived(), ticks: bot.tickCount - t0, how: p.how, est: p.est };
}

// ---------------------------------------------------------------------------------------------------------------------
// banks: booth clusters from the static loc scene (probe-banks.ts), minus the restricted ones
// ---------------------------------------------------------------------------------------------------------------------
export const BANKS: Array<{ id: string; at: Tile }> = [
    { id: 'varrock-w', at: { x: 3185, z: 3438 } }, { id: 'varrock-e', at: { x: 3253, z: 3421 } }, { id: 'draynor', at: { x: 3092, z: 3244 } },
    { id: 'falador-w', at: { x: 2946, z: 3369 } }, { id: 'falador-e', at: { x: 3013, z: 3356 } }, { id: 'edgeville', at: { x: 3094, z: 3492 } },
    { id: 'alkharid', at: { x: 3270, z: 3167 } }, { id: 'seers', at: { x: 2724, z: 3492 } }, { id: 'catherby', at: { x: 2809, z: 3440 } },
    { id: 'ardougne-n', at: { x: 2615, z: 3333 } }, { id: 'ardougne-s', at: { x: 2655, z: 3284 } }, { id: 'yanille', at: { x: 2613, z: 3092 } },
    { id: 'canifis', at: { x: 3511, z: 3480 } },
    // (the Gnome Stronghold banks are L1 inside the Grand Tree / on a platform: the multi-level walker never reached them,
    //  sims qrg1m/qrg2m/qrh2m; Monkey Madness takes its mid-quest kits by helper instead)
];

export interface BankPlan { bank: typeof BANKS[number]; est: number; toBank: TravelPlan; toDest: TravelPlan }
export async function planBank(bot: SpeedBot, dest: Tile | null, done: Set<string>, kit?: Item[]): Promise<BankPlan | null> {
    const ok = BANKS.filter(b => !(b.id === 'canifis' && !done.has('pip'))
        // the Al Kharid toll gate (border_gate.rs2:5) wants 10 gp unless we teleport in (glory)
        && !(b.id === 'alkharid' && !done.has('prince'))   // fix 127: the toll gate traps a walk out (needs a teleport both ways)
        && !(b.id === 'alkharid' && bot.count('coins') < 10 && !bot.inv().some(s => /^amulet_of_glory_[1-4]$/.test(objDebugName(s.obj)))));
    const ranked: Array<{ b: typeof BANKS[number]; est: number }> = [];
    for (const b of ok) {
        const from0 = inGtCellar(bot.tile()) ? { x: 2465, z: 3494 } : bot.pos();
        const from1 = inStronghold(from0) && !TELES.some(t => canTele(bot, t, done)) ? { x: 2461, z: 3380 } : from0;
        const t1 = await planTravel(bot, from1, b.at, done, { fast: true });
        const t2 = dest ? await planTravel(bot, b.at, dest, done, { assumeKit: true, fast: true, kit }) : { est: 0 };
        ranked.push({ b, est: t1.est + t2.est });
    }
    ranked.sort((x, y) => x.est - y.est);
    let best: BankPlan | null = null;
    for (const r of ranked.slice(0, 4)) {
        const f0 = inGtCellar(bot.tile()) ? { x: 2465, z: 3494 } : bot.pos();
        const toBank = await planTravel(bot, inStronghold(f0) && !TELES.some(t => canTele(bot, t, done)) ? { x: 2461, z: 3380 } : f0, r.b.at, done);
        if (toBank.est === Infinity) continue;
        const toDest = dest ? await planTravel(bot, r.b.at, dest, done, { assumeKit: true, kit }) : { how: '-', est: 0 };
        if (toDest.est === Infinity) continue;
        const est = toBank.est + toDest.est;
        if (!best || est < best.est) best = { bank: r.b, est, toBank, toDest };
    }
    return best;
}

export class StageError extends Error { }
/** retries / resumed quests: a missing item may already be used up by the earlier attempt (dyed goblin armour) */
export const LENIENT = new Set<string>();   // per account (two runners share the module)
/**
 * Bank visit: go to the best bank for `dest`, deposit everything but `keep`, withdraw what `need` still lacks.
 * Worn items are untouched. Throws StageError when the bank lacks an item (the stage is short).
 */

// ---- glory carry cap: no account ever holds (pack + worn, any charge, noted too) more than
// SR_GLORY_MAX_HELD glories (default 3; 0 or 'off' = no cap). A bank withdrawal or a trade that would go over it is trimmed
// and logged '[glory-cap]'. Session-7 ledgers: max held 4 (main Pirate/Rune Mysteries/Fishing Contest/Totem prep, partner
// Prince Ali: used-up + 1-charge glories riding along with a fresh one).
export const GLORY_RE = /^amulet_of_glory(_[1-4])?$/;
export const GLORY_CAP = (): number => { const v = process.env.SR_GLORY_MAX_HELD; if (v === 'off') return Infinity; const n = Number(v ?? 3); return n > 0 ? n : Infinity; };
const GLORY_IDS = (): number[] => ['amulet_of_glory', 'amulet_of_glory_1', 'amulet_of_glory_2', 'amulet_of_glory_3', 'amulet_of_glory_4'].flatMap(n => { const id = objId(n); const c = certOf(id); return c > 0 ? [id, c] : [id]; });
export function gloriesHeld(bot: SpeedBot): number { let n = 0; for (const id of GLORY_IDS()) n += Math.max(0, bot.count(id)) + Math.max(0, bot.ackWornCount(id)); return n; }
const isGloryName = (name: string): boolean => { if (GLORY_RE.test(name)) return true; try { const id = objId(name); return GLORY_IDS().includes(id); } catch { return false; } };
/** trim the glory units of `items` so `bot` stays at or under the cap; logs what the cap blocked */
export function capGlories(bot: SpeedBot, items: Item[], tag: string): Item[] {
    const cap = GLORY_CAP(); if (cap === Infinity || !items.some(i => isGloryName(i.name))) return items;
    let room = Math.max(0, cap - gloriesHeld(bot)); const out: Item[] = []; const blocked: string[] = [];
    for (const i of items) {
        if (!isGloryName(i.name)) { out.push(i); continue; }
        const k = Math.min(i.n, room); room -= k;
        if (k > 0) out.push({ ...i, n: k });
        if (k < i.n) blocked.push(`${i.name} x${i.n - k}`);
    }
    if (blocked.length) say(tag, `[glory-cap] ${bot.loginUser}: holds ${gloriesHeld(bot)} (cap ${cap}): blocked ${blocked.join(', ')}`);
    return out;
}
/** run-lib tradeIn with the glory cap applied to the receiver `t` */
function tradeIn(t: SpeedBot, h: SpeedBot, items: Item[], o: Parameters<typeof tradeIn0>[3] = {}): ReturnType<typeof tradeIn0> {
    return tradeIn0(t, h, capGlories(t, items, 'trade'), o);
}
/** set by Runner.prep: is this bot's glory need the route's travel-kit glory (not the module's own)? */
export const GLORY_KIT = new WeakMap<SpeedBot, boolean>();
export async function bankVisit(bot: SpeedBot, need: Item[], keep: string[], dest: Tile | null, done: Set<string>, tag: string, optional: Set<string> = new Set(), precious: string[] = []): Promise<{ ticks: number; bank: string; how: string }> {
    const t0 = bot.tickCount;
    // fix 422 ( acct25 Legends C: the meeting kit did not fit, the !fits() branch below banked map, machete, rune
    // axe, lockpick, pickaxe ... and C stalled at the belt): a running module may name items no bank visit deposits
    // (bot.srBankPrecious, set by legends seg-c while it runs); they count as kept everywhere below. SR_BANK_PRECIOUS=0 reverts.
    const modP: string[] = process.env.SR_BANK_PRECIOUS !== '0' ? ((bot as any).srBankPrecious ?? []) : [];
    if (modP.length) precious = [...precious, ...modP];
    // session 6 glory economy (SR_GLORY_LEDGER, qt3m: 21 glory_4 withdrawn for 35 rubs by qp 85): the kit asks for
    // 'amulet_of_glory_4' by NAME, so every bank visit deposited the held glory_3/_2 and took a fresh one; the partials piled up
    // in the bank. Now a held glory with >= 2 charges satisfies the need, and the bank's partials go out before a full one.
    // SR_GLORY_PARTIAL=0 reverts.
    // only for the route's KIT glory (Runner.prep sets GLORY_KIT per bot): a module's own glory need (Prince Ali, Family Crest
    // rub several times) keeps asking for a full one.
    const GL = /^amulet_of_glory_[1-4]$/, partial = process.env.SR_GLORY_PARTIAL !== '0' && GLORY_KIT.get(bot) === true && need.some(i => GL.test(i.name));
    const heldG = partial ? ['amulet_of_glory_4', 'amulet_of_glory_3', 'amulet_of_glory_2'].find(n => bot.count(n) > 0) : undefined;
    // fix 178 (allchaos qt18fm 'bank falador-w lacks amulet_of_glory_3 x1' at qp 111: the prefetch merged Rune Mysteries' own
    // glory_4 with the kit glory into glory_4 x2, and 166/171 renamed BOTH to the bank's one glory_3). Only ONE unit (the kit
    // glory) takes the partial's name; the rest keep asking for full ones.
    const renameOne = (lst: Item[], pick: string): Item[] => { let done1 = false; return lst.flatMap(i => {
        if (done1 || !GL.test(i.name) || i.name === pick) return [i];
        done1 = true; return i.n > 1 ? [{ ...i, n: i.n - 1 }, { ...i, name: pick, n: 1 }] : [{ ...i, name: pick }];
    }); };
    const need0 = need;
    if (heldG) need = renameOne(need, heldG);
    // fix 126: no bank is reachable from inside the Gnome Stronghold for the planner: out through the gate first
    if (inStronghold(bot.tile()) && !TELES.some(t => canTele(bot, t, done))) { const okL = await leaveStronghold(bot); say(tag, `out of the Gnome Stronghold for the bank: ${okL}`); }
    // fix 134 (qrq7m + qrq8m MM mid bank: 'no reachable bank from (2461,3384)': the gate tiles are not navgrid-connected for
    // the planner; that tile is still north of the gate): through the gate first
    if (bot.tile().z < 6400 && Math.abs(bot.tile().x - 2461) <= 4 && bot.tile().z >= 3383 && bot.tile().z <= 3386) { const okG = await leaveStronghold(bot); say(tag, `off the gnome gate for the bank: ${okG}`); }
    // the pack after this visit: what it withdraws + what it keeps (fix 131)
    const kit = [...need, ...bot.inv().filter(sl => keep.includes(objDebugName(sl.obj)) || precious.includes(objDebugName(sl.obj))).map(sl => ({ name: objDebugName(sl.obj), n: sl.count }))];
    const plan = await planBank(bot, dest, done, kit);
    if (!plan) throw new StageError(`${tag}: no reachable bank from ${JSON.stringify(bot.pos())}`);
    say(tag, `bank ${plan.bank.id} (est ${plan.toBank.est} + ${plan.toDest.est} t via ${plan.toBank.how})`);
    const tr = await travelTo(bot, plan.bank.at, done, { near: 4, tag });
    const tOpen = bot.tickCount;
    let opened = false;
    for (let k = 0; k < 6 && !opened; k++) {
        if (bot.chatModalId !== -1 || (bot.mainModalId !== -1 && !bot.bankOpen())) { dismiss(bot); await bot.tick(1); }
        // alternate booth / banker npc: a booth whose counter side is not reachable times out (Draynor, sim qrd2p 204 t)
        const r = await bot.openBank({ radius: 16, kind: k % 2 === 0 ? 'npc' : 'any', maxTicks: 15 });
        opened = r.ok;
        if (!opened) { say(tag, `openBank try ${k + 1}: ${r.message ?? ''} ${String((r as any).target ?? '')} at ${JSON.stringify(bot.pos())}`); await bot.walkTo(plan.bank.at.x, plan.bank.at.z, { near: 1, maxTicks: 60, log: false }); }
    }
    say(tag, `bank ${plan.bank.id}: travel ${tr.ticks} t (${tr.how}, ok ${tr.ok}), open ${bot.tickCount - tOpen} t`);
    if (!opened) throw new StageError(`${tag}: could not open the ${plan.bank.id} bank (${JSON.stringify(bot.pos())}, travel ${tr.how} ok=${tr.ok})`);
    await bot.tick(1);
    // fix 171 (qt14m t547 'bank edgeville lacks amulet_of_glory_3': the glory teleport TO the bank spent a charge, glory_3 ->
    // glory_2, so the need still named glory_3, the held glory_2 was deposited as not-kept and the bank had no glory_3).
    // Re-resolve the kit glory against the pack AFTER the trip: a held glory with >= 2 charges is the need; else the bank's
    // partials go out first. SR_GLORY_PARTIAL=0 reverts with 166.
    if (partial) {
        const held2 = ['amulet_of_glory_4', 'amulet_of_glory_3', 'amulet_of_glory_2'].find(n => bot.count(n) > 0);
        const pick = held2 ?? ['amulet_of_glory_3', 'amulet_of_glory_2', 'amulet_of_glory_4'].find(n => bot.bankCount(n) > 0);
        // undo the pre-trip rename, then rename one unit to the post-trip pick (fix 178)
        need = pick ? renameOne(need0, pick) : need0;
        if (pick !== heldG) say(tag, `kit glory: ${heldG ?? 'none held'} -> ${held2 ? `held ${held2}` : `bank ${pick ?? 'none'}`}`);
    }
    // what to keep in the pack: the keep list + needed items already held (up to the need)
    const needIds = new Set(need.map(i => objId(i.name)));
    const keepIds = new Set<number>([...keep.flatMap(n => { try { return [objId(n)]; } catch { return []; } }), ...needIds,
        ...modP.flatMap(n => { try { return [objId(n)]; } catch { return []; } })]);
    // deposit every stack not kept (one burst), then withdraw the shortfall
    const extra = bot.inv().filter(s => !keepIds.has(s.obj));
    if (extra.length) {
        if (!bot.bankOpen() && process.env.SR_BANK_REOPEN !== '0') for (let j = 0; j < 4 && !bot.bankOpen(); j++) await bot.openBank({ radius: 16, kind: j % 2 === 0 ? 'npc' : 'any', maxTicks: 15 });
        // session 11 fix 397 (qx363p murder 'need 6 free slots, have 4' x3: a partition drop right after the Seers bank opened ate
        // this deposit burst; fits() counts only the kit so fix 191 never re-deposited, and excalibur/candle/bones/helm/chainbody
        // went to the quest). Verify the deposit landed; else reopen the bank and deposit again. SR_DEPOSIT_VERIFY=0 reverts.
        // TEST: SR_TEST_397=1 skips the first burst (a lost deposit) - with the fix on the pack must still leave clean.
        if (process.env.SR_TEST_397 === '1') say(tag, `TEST 397: first deposit burst skipped (held ${packStr(bot)})`);
        else { await bot.depositAll([...keepIds]); await bot.tick(1); }
        if (process.env.SR_DEPOSIT_VERIFY !== '0') for (let k = 0; k < 3; k++) {
            if (await bot.until(() => !bot.inv().some(s => !keepIds.has(s.obj)), k === 0 && process.env.SR_TEST_397 !== '1' ? 3 : 1)) break;
            for (let j = 0; j < 4 && !bot.bankOpen(); j++) { if (bot.chatModalId !== -1 || bot.mainModalId !== -1) { dismiss(bot); await bot.tick(1); } await bot.openBank({ radius: 16, kind: j % 2 === 0 ? 'npc' : 'any', maxTicks: 15 }); }
            say(tag, `397 deposit did not land (bank open ${bot.bankOpen()}, try ${k + 1}): depositing again; held ${packStr(bot)}`);
            await bot.depositAll([...keepIds]); await bot.tick(2);
        }
    }
    // over-held needed non-stackables (e.g. 6 sharks held, 3 needed): deposit the surplus later only if space is short
    const short: Array<{ obj: string; n: number }> = [];
    const lacks: string[] = [];
    for (const it of need) {
        const h = have(bot, it.name);
        if (h >= it.n) continue;
        let name = it.name;
        let inBank = bot.bankCount(name);
        // fix 416: a glory NAMED in a supply list (Legends carry-in LG_CARRY_EXTRA=amulet_of_glory_4) is
        // satisfied by any charged glory the bank still holds (the kit-glory rule already works that way for the automatic one);
        // the route may have used up every glory(4) by quest 59. SR_GLORY_ANY=0 reverts.
        if (inBank <= 0 && /^amulet_of_glory_[1-4]$/.test(name) && process.env.SR_GLORY_ANY !== '0') {
            // F3 SR_GLORY_ALT_NET=1 (set only by route/existing.ts; sim exqa1 Prince Ali kit glory_4 + glory_1, bank 1 x glory_4: both
            // picked the same glory_4 -> 'withdraw amulet_of_glory_4 x1 failed (have 1)' STAGE): the alt counts what this kit already takes
            const net = (g: string) => bot.bankCount(g) - (process.env.SR_GLORY_ALT_NET === '1' ? short.filter(w => w.obj === g).reduce((a, w) => a + w.n, 0) : 0);
            const alt = ['amulet_of_glory_4', 'amulet_of_glory_3', 'amulet_of_glory_2', 'amulet_of_glory_1'].find(g => g !== name && net(g) > 0);
            if (alt) { say(tag, `416: bank ${plan.bank.id} has no ${name}: taking ${alt} instead`); name = alt; inBank = net(alt); }
        }
        if (inBank <= 0) { if (!optional.has(it.name)) lacks.push(`${it.name} x${it.n - h}`); continue; }
        short.push({ obj: name, n: Math.min(it.n - h, inBank) });
        // session 11 fix 357 (qx172m STOP 'bank varrock-e lacks druid_pouch x1' at qp 138): Nature Spirit leaves 4-5 pouch charges
        // (each attack by an invisible ghast burns one, ghast.rs2:24-25). Myreque tops the pouch up with the blessed sickle in the
        // swamp and re-checks >= 5 itself (q-in-search-of-the-myreque.ts:122-130). A partial stack is withdrawn whole (short above)
        // and is not a stage shortfall. DP_PARTIAL=0 reverts.
        if (inBank < it.n - h && !optional.has(it.name) && !(process.env.DP_PARTIAL !== '0' && it.name === 'druid_pouch')) lacks.push(`${it.name} x${it.n - h - inBank}`);
    }
    if (lacks.length && !LENIENT.has(bot.loginUser.toLowerCase())) throw new StageError(`${tag}: bank ${plan.bank.id} lacks ${lacks.join(', ')}`);
    if (lacks.length) say(tag, `bank ${plan.bank.id} lacks ${lacks.join(', ')} (resume/retry: continuing; the module re-checks)`);
    const fits = () => {
        let free = bot.free();
        for (const w of short) free -= stackable(w.obj) ? (bot.count(w.obj) > 0 ? 0 : 1) : w.n;
        return free >= 0;
    };
    if (!fits()) {
        // deposit kept items that are not needed (keep list surplus) to make room
        // fix 62: never the King's summons (qrh7m lost it here at the Seers bank before Elemental Workshop, so Regicide waited
        // 2 x 1,500 t for a messenger who never comes again)
        // fix 71: nor the quest's own items a resumed attempt holds (leg.keep; qrh7m deposited Eadgar's drunk parrot here)
        const always = new Set(['regicide_quest_kings_summons', ...precious].flatMap(n => { try { return [objId(n)]; } catch { return []; } }));
        const spare = bot.inv().filter(s => !needIds.has(s.obj) && !always.has(s.obj));
        if (spare.length) { await bot.depositAll([...needIds, ...always]); await bot.tick(1); }
        // fix 92 (qrj3m Eadgar 'free 16': 12 sharks left from Troll Stronghold were kept because the kit needs 2): over-held
        // needed non-stackables are deposited whole and withdrawn to the need
        const over = need.filter(it => !stackable(it.name) && bot.count(it.name) > it.n);
        if (over.length && !fits()) {
            const overIds = new Set(over.map(o => objId(o.name)));
            await bot.depositAll([...[...needIds].filter(id => !overIds.has(id)), ...always]); await bot.tick(1);
            for (const it of over) {
                const n = Math.min(it.n - bot.count(it.name), bot.bankCount(it.name));
                const ex = short.find(w => w.obj === it.name); if (ex) ex.n = n; else if (n > 0) short.push({ obj: it.name, n });
            }
        }
    }
    // fix 74 (qri2m Eadgar: a 28-slot kit and 27 free): trim food from the withdrawal before giving up, and say what is held
    if (!fits()) {
        let deficit = -bot.free(); for (const w of short) deficit += stackable(w.obj) ? (bot.count(w.obj) > 0 ? 0 : 1) : w.n;
        const f = short.find(w => /^(shark|lobster|swordfish|trout|tuna|bass|monkfish)$/.test(w.obj) && w.n > 0);
        if (f && deficit > 0) { const cut = Math.min(f.n, deficit); f.n -= cut; say(tag, `kit ${deficit} slot(s) over: ${f.obj} -${cut} (held: ${packStr(bot)})`); }
    }
    // fix 191 (allchaos qt28m Druidic prep: nothing was deposited, 'pack too small (free 8)'; the fork did not repeat it; a
    // reconnect closes the bank and every deposit after it is ignored): reopen the bank and deposit the non-kit items again
    if (!fits() && process.env.SR_BANK_REOPEN !== '0') {
        for (let k = 0; k < 3 && !bot.bankOpen(); k++) { if (bot.chatModalId !== -1 || bot.mainModalId !== -1) { dismiss(bot); await bot.tick(1); } await bot.openBank({ radius: 16, kind: k % 2 === 0 ? 'npc' : 'any', maxTicks: 15 }); }
        const always = new Set(['regicide_quest_kings_summons', ...precious].flatMap(n => { try { return [objId(n)]; } catch { return []; } }));
        if (bot.bankOpen()) { await bot.depositAll([...needIds, ...always]); await bot.tick(2); }
        say(tag, `bank reopened for the kit: open ${bot.bankOpen()}, free ${bot.free()}`);
    }
    if (!fits()) throw new StageError(`${tag}: pack too small for the kit (bank ${bot.bankItems().filter(x => x.count > 0).length}/288 kinds, bank open ${bot.bankOpen()}; free ${bot.free()}, want ${short.map(w => `${w.obj}x${w.n}`).join(',')}; held ${packStr(bot)})`);
    // glory carry cap: the withdrawal never takes the account over SR_GLORY_MAX_HELD glories
    if (GLORY_CAP() !== Infinity && short.some(w => isGloryName(w.obj))) {
        // first make room: used-up and 1-charge glories nobody needs go into the bank (the kit refuses a 1-charge glory; a
        // retry's keep list holds them as 'quest items' otherwise: qt27p Prince Ali held 2 used-up + withdrew 2 = 4)
        const junkG = ['amulet_of_glory', 'amulet_of_glory_1'].filter(n => bot.count(n) > 0 && !need.some(i => i.name === n));
        const want = short.filter(w => isGloryName(w.obj)).reduce((a, w) => a + w.n, 0);
        if (junkG.length && gloriesHeld(bot) + want > GLORY_CAP() && bot.bankOpen()) {
            const junkIds = new Set(junkG.map(n => objId(n)));
            await bot.depositAll([...new Set(bot.inv().filter(s => !junkIds.has(s.obj)).map(s => s.obj))]); await bot.tick(1);
            say(tag, `[glory-cap] ${bot.loginUser}: banked spent ${junkG.join(',')} to stay under the cap`);
        }
        const capped = capGlories(bot, short.map(w => ({ name: w.obj, n: w.n })), tag);
        for (const w of short) { if (!isGloryName(w.obj)) continue; const c = capped.find(i => i.name === w.obj); w.n = c ? c.n : 0; }
    }
    for (const w of short) {
        if (w.n <= 0) continue;
        const id = objId(w.obj), before = bot.count(id);
        let got = false;
        for (let k = 0; k < 3 && !got; k++) {
            // fix 193 (allchaos qt29m Druidic prep: a drop mid-visit closed the bank, 'withdraw raw_beef x1 failed (have 0)';
            // qt28m the same with the deposits): reopen the bank after a reconnect. SR_BANK_REOPEN=0 reverts with 191.
            if (!bot.bankOpen() && process.env.SR_BANK_REOPEN !== '0') {
                for (let j = 0; j < 4 && !bot.bankOpen(); j++) { if (bot.chatModalId !== -1 || bot.mainModalId !== -1) { dismiss(bot); await bot.tick(1); } await bot.openBank({ radius: 16, kind: j % 2 === 0 ? 'npc' : 'any', maxTicks: 15 }); }
                say(tag, `bank reopened mid-withdrawal (a reconnect?): ${bot.bankOpen()}`); await bot.tick(1);
            }
            // a stack withdrawn with n >= free slots turns into Withdraw-All (core queueWithdraw): note mode keeps it a
            // Withdraw-X (runes have no cert, they come out as runes)
            const r = await bot.withdraw(w.obj, w.n, { noted: stackable(w.obj) });
            got = bot.count(id) >= before + w.n || (!stackable(w.obj) && bot.free() === 0);
            if (!got && !r.ok) await bot.tick(1);
            if (!got && bot.count(id) > before && !stackable(w.obj)) { w.n -= bot.count(id) - before; }
        }
        if (!got && bot.count(id) < before + w.n) throw new StageError(`${tag}: withdraw ${w.obj} x${w.n} failed (have ${bot.count(id)})`);
    }
    // 323a (qx92m entered Regicide at hp 48/99, the Tyras guard + camp took it to 3 with all food gone, DIED): a quest starts
    // from this bank visit hurt -> eat to ~85% here and refill (not for helpers). Pack-neutral (qzm07: the Regicide kit is
    // 28/28, no room to withdraw extra): close, eat held sharks (else withdraw some first), reopen, withdraw what was eaten.
    // SR_PREP_HEAL=0 reverts.
    const hpB = bot.stat('hitpoints'), hpB0 = hpB.cur;
    const healWant = process.env.SR_PREP_HEAL !== '0' && tag !== 'helper' && hpB.level > 0 && hpB.cur < hpB.level * 0.7 && bot.bankOpen()
        ? Math.min(bot.bankCount('shark') + bot.count('shark'), Math.ceil((hpB.level * 0.85 - hpB.cur) / 20)) : 0;
    if (healWant > 0 && bot.count('shark') === 0 && bot.free() > 0) { await bot.withdraw('shark', Math.min(healWant, bot.free())); await bot.tick(1); }
    bot.closeBank(); await bot.tick(1);
    if (healWant > 0 && bot.count('shark') > 0) {
        const s0 = bot.count('shark'); let eaten = 0;
        for (let k = 0; k < healWant + 2 && eaten < healWant && bot.count('shark') > 0 && bot.stat('hitpoints').cur < bot.stat('hitpoints').level * 0.85; k++) {
            const c0 = bot.count('shark'); bot.opHeld1(objId('shark'), bot.slot('shark')); bot.queueFlush(); await bot.tick(3); eaten += Math.max(0, c0 - bot.count('shark'));
        }
        let back = 0;
        if (eaten > 0) {
            const r2 = await bot.openBank({ radius: 16, maxTicks: 15 });
            if (r2.ok && bot.bankCount('shark') > 0) { const c1 = bot.count('shark'); await bot.withdraw('shark', Math.min(s0 - c1, bot.bankCount('shark'), bot.free())); await bot.tick(1); back = bot.count('shark') - c1; }
            bot.closeBank(); await bot.tick(1);
        }
        say(tag, `323a prep heal: hp ${hpB0} -> ${bot.stat('hitpoints').cur}/${hpB.level} (ate ${eaten}, refilled ${back}, sharks ${bot.count('shark')})`);
    }
    return { ticks: bot.tickCount - t0, bank: plan.bank.id, how: plan.toBank.how };
}

/** Wear `names` (from the pack); returns the ones that are worn afterwards */
export async function wearAll(bot: SpeedBot, names: string[]): Promise<void> {
    const todo = names.filter(n => !bot.isWorn(objId(n)) && bot.count(n) > 0);
    if (todo.length) await wield(bot, todo);
}
export async function unwearAll(bot: SpeedBot): Promise<void> { await unwieldAll(bot, /./); }

// ---------------------------------------------------------------------------------------------------------------------
// BankHelper: the cheatless stand-in for the sim helper (partner pre-run, live). A hand-off becomes a mid-quest bank visit
// that keeps everything the account holds (quest items) and comes back to where the module stopped. Lending is a no-op.
// ---------------------------------------------------------------------------------------------------------------------
/** run-lib tradeIn (receiver t, giver h), re-exported for the launcher */
export const tradeInExport = tradeIn0;
export class BankHelper {
    constructor(private bank: (bot: SpeedBot, items: Item[], keep: string[]) => Promise<void>) { }
    lent = new Map<string, Item[]>();
    async handoff(to: SpeedBot, items: Item[], label: string): Promise<boolean> {
        items = items.filter(i => i.n > 0); if (!items.length) return true;
        // fix 417 ( acct9 Legends: B met Nezikchened on 0 sharks; sim lgxt 'restock sharkx1' -> 'helper OK;
        // sharks 3'): callers pass what a HELPER would trade (the shortfall: 'shark x1' = one MORE), but the bank visit reads
        // its list as what the pack must HOLD (bankVisit: withdraw only below have()). Every top-up of a stack the pack already
        // held (sharks, prayer potions, law runes) fetched nothing. Here the shortfall is turned into the total to hold.
        // SR_BANKC_DELTA=0 reverts.
        if (process.env.SR_BANKC_DELTA !== '0') items = items.map(i => ({ ...i, n: i.n + to.count(i.name) }));
        say('bank-helper', `${label}: fetching ${items.map(i => `${i.name}x${i.n}`).join(',')} from the bank${process.env.SR_BANKC_DELTA !== '0' ? ' (pack totals)' : ''}`);
        await this.bank(to, items, to.inv().map(s => objDebugName(s.obj)));
        return items.every(i => to.count(i.name) >= i.n);
    }
    async lend(): Promise<boolean> { return true; }
    async handBack(): Promise<boolean> { return true; }
    async ensure(): Promise<SpeedBot> { throw new Error('no helper bot in a cheatless run (BankHelper)'); }
    lock<T>(fn: () => Promise<T>): Promise<T> { return fn(); }
    log: any[] = [];
    name = 'bank';
    bot: SpeedBot | null = null;
    async close(): Promise<void> { /* nothing */ }
}

// ---------------------------------------------------------------------------------------------------------------------
// helpers: one helper account; --sim STAGING fills it by cheat and puts it next to the trainee, then a real trade
// ---------------------------------------------------------------------------------------------------------------------
export class Helper {
    bot: SpeedBot | null = null;
    log: Array<{ at: number; to: string; label: string; items: Item[]; ticks: number; ok: boolean; pos: Tile }> = [];
    private q: Promise<unknown> = Promise.resolve();
    constructor(readonly name: string) { }
    /** one hand-off at a time (main and partner share the helper) */
    lock<T>(fn: () => Promise<T>): Promise<T> { const p = this.q.then(fn, fn); this.q = p.catch(() => undefined); return p; }
    async ensure(): Promise<SpeedBot> {
        if (this.bot && !this.bot.disposed) return this.bot;
        if (CHEATS.blocked) throw new Error('helper staging is --sim only');
        this.bot = await SpeedBot.create(this.name);
        await this.bot.tick(2);
        return this.bot;
    }
    /** stage `items` on the helper next to `to` and trade them over. Returns trainee ticks. */
    handoff(to: SpeedBot, items: Item[], label: string): Promise<boolean> { return this.lock(() => this.handoff0(to, items, label)); }
    private async handoff0(to: SpeedBot, items: Item[], label: string): Promise<boolean> {
        items = items.filter(i => i.n > 0);
        if (!items.length) { say('helper', `${label}: nothing missing, no hand-off`); return true; }   // a resumed quest already holds its kit
        const c = await this.ensure();
        const t0 = to.tickCount;
        if (c.mainModalId !== -1 || c.chatModalId !== -1) { c.closeModal(); await c.tick(1); }
        if (c.inv().length) await localSetup(c, { clear: true });
        const p = to.pos();
        await localSetup(c, { items: items.map(i => ({ name: i.name, n: i.n })), tele: { x: p.x, z: p.z + (p.z > 6400 ? 0 : 0), level: p.level } });
        await c.tick(1);
        let r: { ok: boolean; ticks: number; message?: string } = { ok: false, ticks: 0 };
        for (let k = 0; k < 3 && !r.ok; k++) {
            r = await tradeIn(to, c, items, { maxTicks: 40 });
            if (!r.ok) { say('helper', `${label} try ${k + 1}: ${r.message?.slice(0, 200)}`); await to.tick(2); }
        }
        this.log.push({ at: t0, to: to.loginUser, label, items, ticks: to.tickCount - t0, ok: r.ok, pos: p });
        say('helper', `${label} -> ${to.loginUser}: ${items.map(i => `${i.name}x${i.n}`).join(',')} ${r.ok ? 'OK' : 'FAILED'} in ${to.tickCount - t0} t`);
        return r.ok;
    }
    /** the trainee hands `items` to the helper to free pack slots (a real trade); `handBack` returns them later. In --sim the
     *  helper's pack is re-staged by cheat between hand-offs, so what it holds is tracked here, not in its pack. */
    lent = new Map<string, Item[]>();
    lend(from: SpeedBot, items: Item[], label: string): Promise<boolean> {
        return this.lock(async () => {
            const c = await this.ensure();
            if (c.mainModalId !== -1 || c.chatModalId !== -1) { c.closeModal(); await c.tick(1); }
            if (c.inv().length) await localSetup(c, { clear: true });
            const p = from.pos();
            await localSetup(c, { tele: { x: p.x, z: p.z, level: p.level } });
            await c.tick(1);
            let r: { ok: boolean; ticks: number; message?: string } = { ok: false, ticks: 0 };
            for (let k = 0; k < 3 && !r.ok; k++) { r = await tradeIn(c, from, items, { maxTicks: 40 }); if (!r.ok) await from.tick(2); }
            if (r.ok) this.lent.set(from.loginUser, [...(this.lent.get(from.loginUser) ?? []), ...items]);
            say('helper', `${label}: ${from.loginUser} lends ${items.map(i => `${i.name}x${i.n}`).join(',')} ${r.ok ? 'OK' : `FAILED (${r.message?.slice(0, 120)})`}`);
            return r.ok;
        });
    }
    async handBack(to: SpeedBot, label: string): Promise<boolean> {
        const items = this.lent.get(to.loginUser); if (!items?.length) return true;
        const ok = await this.handoff(to, items, `${label} (hand back)`);
        if (ok) this.lent.delete(to.loginUser);
        return ok;
    }
    async close(): Promise<void> { if (this.bot && !this.bot.disposed) { try { await this.bot.logout(); } catch { /* gone */ } } }
}

// ---------------------------------------------------------------------------------------------------------------------
// the Regicide messenger watcher (regicide_kings_messenger.rs2): armed by the relog after Underground Pass. The messenger
// spawns next to the player and walks up (ai_opplayer2); his dialogue sets regicide_quest = received_message and gives the
// summons (3206). The watcher pages through his dialogue whenever it is open (modules that hold dialogs would not), and
// between quests it talks to him if he is in view. Regicide's run() starts at once when the summons is held.
// ---------------------------------------------------------------------------------------------------------------------
export const SUMMONS = 'regicide_quest_kings_summons';
const MESSENGER = 1210;
const MSG_RE = /King Lathas sent this message|The messenger gives you a scroll|I take it you are/i;

// ---------------------------------------------------------------------------------------------------------------------
// TravelHelper: a second account that brings the trainee its quest kit. Its BANK is filled by a setup cheat once at the start
// (it walks to Draynor bank itself first). For each hand-off it withdraws the items (plus its own travel jewellery) from its
// bank, travels to the trainee by itself (walk + glory / ring / necklace: a fresh account has magic 1) and trades.
// `dispatch()` sends it ahead to a known meeting tile while the trainee is still busy, so the trade is usually waiting.
// Meeting points the helper cannot reach on a live server (inside
// the Kharazi jungle / Shaman caves) fall back to a trainee bank visit (`fallback`).
// ---------------------------------------------------------------------------------------------------------------------
/** session 9: sharks a helper carries on Karamja jungle trips (and eats at <= 60% hp); SR_HELPER_FOOD=0 = none */
const HELPER_FOOD = Number(process.env.SR_HELPER_FOOD ?? 4);
export const HELPER_TRAVEL: Item[] = [{ name: 'amulet_of_glory_4', n: 1 }, { name: 'ring_of_dueling_8', n: 1 }, { name: 'necklace_of_minigames_8', n: 1 }, { name: 'coins', n: 200 }];
/** travel jewellery is matched by family (charges change the item name: glory_4 -> glory_3; qrn1c re-banked for that) */
// fix 122 (qrn4 + qrp2 watchdog kills: the MM helper spent its last glory charge, then walked from the Grand Tree trunk to
// Edgeville bank and the walker spun): a glory with one charge left counts as missing, so the refill trip still has a teleport
const TRAVEL_FAMILY: Array<[RegExp, string]> = [[/^amulet_of_glory_[2-4]$/, 'amulet_of_glory_4'], [/^ring_of_dueling_[1-8]$/, 'ring_of_dueling_8'], [/^necklace_of_minigames_[1-8]$/, 'necklace_of_minigames_8']];
export const helperUnreachable = (t: Tile): boolean =>
    (t.x >= 2750 && t.x <= 2990 && t.z >= 2870 && t.z <= 2945) ||                          // Kharazi jungle (south of Shilo)
    (t.z > 9200 && t.z < 9420 && t.x >= 2700 && t.x <= 2990) ||                            // Legends / Shilo caves
    (t.z > 6400 && t.x >= 2300 && t.x <= 2500 && t.z >= 9550 && t.z <= 9750);              // Underground Pass
export class TravelHelper extends Helper {
    private stocked = false;
    private known = new Set<string>();
    private pending: Promise<unknown> | null = null;
    constructor(name: string, private stock: Item[], private fallback: (to: SpeedBot, items: Item[]) => Promise<boolean>) { super(name); }
    prestocked = false;
    override async ensure(): Promise<SpeedBot> {
        if (this.bot && !this.bot.disposed) return this.bot;
        this.bot = await SpeedBot.create(this.name);
        await this.bot.tick(2);
        if (!this.stocked) await (this.prestocked || CHEATS.blocked ? this.checkBank() : this.stockBank());
        if (HELPER_FOOD) this.eatWatch(this.bot);
        return this.bot;
    }
    /** session 9 (allchaos qu09c: the level-3 helper DIED 6 x on the Karamja jungle walk to the Legends belt (and qt45c 2 x):
     *  the B kit was lost with it, segment B failed): eat a shark at <= 60% hp (jungle trips carry HELPER_FOOD sharks). */
    private eatWatch(b: SpeedBot): void {
        void (async () => {
            let last = -10;
            while (!b.disposed) {
                try {
                    const hp = b.stat('hitpoints');
                    if (hp.cur > 0 && hp.cur <= Math.ceil(hp.level * 0.6) && b.tickCount - last >= 3 && b.mainModalId === -1) {
                        const sl = b.slot('shark'); if (sl >= 0) { b.opHeld1(objId('shark'), sl); b.queueFlush(); last = b.tickCount; }
                    }
                    await b.tick(1);
                } catch { await new Promise(r => setTimeout(r, 200)); }
            }
        })();
    }
    stockWant(): Item[] {
        const nG = Number(process.env.SR_HELPER_GLORIES ?? 5);
        // SR_HELPER_GLORIES=0: no glory line at all (walk / games necklace / ring)
        // SR_HELPER_JEWELLERY (default 10): rings of dueling / games necklaces per helper; coins stay x10
        const nJ = Number(process.env.SR_HELPER_JEWELLERY ?? 10);
        return sum([...this.stock, ...HELPER_TRAVEL.map(i => ({ ...i, n: /^amulet_of_glory/.test(i.name) ? i.n * nG : /^(ring_of_dueling|necklace_of_minigames)/.test(i.name) ? i.n * nJ : i.n * 10 })), ...(HELPER_FOOD > 0 ? [{ name: 'shark', n: HELPER_FOOD * 5 }] : [])]).filter(i => i.n > 0);
    }
    /** run-route --live (or any cheat-blocked start): the bank is pre-stocked. Walk to Draynor bank, read the bank, log every
     *  missing item as a warning (no abort: a short hand-off falls back to the trainee's bank visit, see handoff()). */
    private async checkBank(): Promise<void> {
        const b = this.bot!;
        const t = await travelTo(b, { x: 3092, z: 3244, level: 0 }, this.known, { near: 3, tag: 'helper' });
        const want = this.stockWant();
        for (let k = 0; k < 6 && !b.bankOpen(); k++) await b.openBank({ radius: 16, kind: k % 2 === 0 ? 'npc' : 'any', maxTicks: 15 });
        if (!b.bankOpen()) { say('helper', `${this.name}: LIVE bank check: bank did not open at ${JSON.stringify(b.pos())} (${t.ticks} t walk); not verified`); this.stocked = true; return; }
        await b.tick(1);
        const short: Item[] = [];
        for (const i of want) { let id = -1; try { id = objId(i.name); } catch { continue; } const n = i.n - b.bankCount(id); if (n > 0) short.push({ name: i.name, n }); }
        b.closeBank(); await b.tick(1);
        for (const i of short) say('helper', `${this.name}: WARNING LIVE bank check: pre-stocked bank lacks ${i.name} x${i.n} (a hand-off needing it falls back to the trainee's bank)`);
        say('helper', `${this.name} at Draynor bank (${t.ticks} t, ok ${t.ok}); LIVE pre-stocked bank checked: ${want.length - short.length}/${want.length} kinds complete${short.length ? `, ${short.length} short` : ''} (no cheat fill)`);
        this.stocked = true;
    }
    private async stockBank(): Promise<void> {
        const b = this.bot!;
        const t = await travelTo(b, { x: 3092, z: 3244, level: 0 }, this.known, { near: 3, tag: 'helper' });
        say('helper', `${this.name} at Draynor bank (${t.ticks} t, ok ${t.ok}); stocking its bank (${this.stock.length} kinds)`);
        // session 7 (glory supply): a helper used <= 5 rubs per one-shot (qt3/qt4/qt18: 2 glories out at most); it is stocked
        // with SR_HELPER_GLORIES (default 5) charged glories, not 10 (the other travel jewellery keeps x10)
        // session 8 (allchaos qt41c: 3 full glories spent by Legends segment C (qp 119), then 'bank edgeville lacks
        // amulet_of_glory_4' and no walk route Edgeville -> Karamja: the belt meeting failed, route STOPPED): 5 each
        const want = this.stockWant();
        let test407b = process.env.SR_TEST_407B === '1';
        const fill = async (queue: Item[]): Promise<void> => {
        while (queue.length) {
            const batch: Item[] = []; let slots = 0;
            while (queue.length && slots < 24) {
                const it = queue.shift()!;
                let id = -1; try { id = objId(it.name); } catch { continue; }
                const cert = certOf(id);
                if (stackable(it.name) || it.n === 1) { batch.push(it); slots++; }
                else if (cert > 0) { batch.push({ name: objDebugName(cert), n: it.n }); slots++; }
                else { const k = Math.min(it.n, 24 - slots); batch.push({ name: it.name, n: k }); slots += k; if (it.n > k) queue.unshift({ name: it.name, n: it.n - k }); }
            }
            if (b.inv().length) await localSetup(b, { clear: true });
            await localSetup(b, { items: batch });
            if (test407b) { test407b = false; say('helper', `TEST 407b: batch 1 not deposited (wiped)`); await localSetup(b, { clear: true }); continue; }
            // fix 125 (qrn6c lacked the demon kit's runes: a batch whose bank did not open was wiped by the next fill)
            for (let k = 0; k < 6 && b.inv().length; k++) {
                const ob = await b.openBank({ radius: 16, kind: k % 2 === 0 ? 'npc' : 'any', maxTicks: 15 });
                if (ob.ok) { await b.depositAll([]); await b.tick(1); b.closeBank(); await b.tick(1); }
                else await b.tick(2);
            }
            if (b.inv().length) say('helper', `${this.name}: could not deposit ${b.inv().map(sl => objDebugName(sl.obj)).join(',')}`);
        }
        };
        await fill(want.map(i => ({ ...i })));
        // session 11 fix 407b (qx510c: a partition drop (ws 1006) at tick 100 mid-stocking lost lockpick, rune_pickaxe, soulrune,
        // opal, jade (+2 law); first seen as 'bank edgeville lacks ...' at Legends' belt meeting 1300 t later -> 'quest kit incomplete',
        // the retry 'no room (free 4 < 5)' -> ROUTE STOPPED qp 119). Verify the bank holds every stocked kind; re-stock the
        // shortfall (3 passes). SR_STOCK_VERIFY=0 reverts. TEST: SR_TEST_407B=1 wipes batch 1 undeposited - the verify must refill it.
        if (process.env.SR_STOCK_VERIFY !== '0') for (let pass = 0; pass < 3; pass++) {
            for (let k = 0; k < 6 && !b.bankOpen(); k++) await b.openBank({ radius: 16, kind: k % 2 === 0 ? 'npc' : 'any', maxTicks: 15 });
            if (!b.bankOpen()) { say('helper', `${this.name}: 407b verify: bank did not open`); break; }
            await b.tick(1);
            const short: Item[] = [];
            for (const i of want) { let id = -1; try { id = objId(i.name); } catch { continue; } const n = i.n - b.bankCount(id); if (n > 0) short.push({ name: i.name, n }); }
            b.closeBank(); await b.tick(1);
            if (!short.length) { if (pass) say('helper', `${this.name}: 407b bank complete after re-stock`); break; }
            say('helper', `${this.name}: 407b bank short after stocking (pass ${pass + 1}): ${short.map(i => `${i.name}x${i.n}`).join(',')} - re-stocking`);
            await fill(short);
        }
        this.stocked = true;
    }
    /** fetch `items` from the helper's bank and travel to `at` (in the background: the trade waits for it) */
    /** where the helper stands ready (set when a dispatch arrived; cleared when it moves on) */
    waitingAt: Tile | null = null;
    isWaitingAt(t: Tile): boolean { return !!this.waitingAt && cheb(this.waitingAt, t) <= 4 && !!this.bot && cheb(this.bot.tile(), t) <= 6; }
    dispatch(at: Tile, items: Item[], label: string): void { this.waitingAt = null; void this.goTo(at, items, label); }
    private goal: Tile | null = null;
    private jungle(t: Tile | null): boolean { return !!t && t.x >= 2740 && t.x <= 2970 && t.z >= 2870 && t.z <= 3240 && t.z < 6400; }
    goTo(at: Tile, items: Item[], label: string): Promise<unknown> {
        if (helperUnreachable(at)) return Promise.resolve();
        this.goal = at;
        return this.pending = this.lock(async () => {
            const c = await this.ensure();
            await this.fetch(c, items);
            const t = await travelTo(c, at, this.known, { near: 2, tag: 'helper' });
            this.waitingAt = cheb(c.tile(), at) <= 4 ? at : null;
            say('helper', `${label}: waiting at ${JSON.stringify(c.pos())} (${t.ticks} t, ${t.how})`);
        }).catch(e => say('helper', `${label}: dispatch failed: ${(e as Error).message.slice(0, 160)}`));
    }
    private async fetch(c: SpeedBot, items: Item[]): Promise<void> {
        const held = (re: RegExp) => c.inv().some(sl => re.test(objDebugName(sl.obj)));
        // SR_HELPER_GLORIES=0: the bank holds no glory, so never fetch one (else every fetch is a bank visit that throws 'lacks')
        const noGlory = Number(process.env.SR_HELPER_GLORIES ?? 5) === 0;
        const travel = TRAVEL_FAMILY.filter(([re, n]) => !held(re) && !(noGlory && /^amulet_of_glory/.test(n))).map(([, n]) => ({ name: n, n: 1 }));
        const food = HELPER_FOOD > 0 && this.jungle(this.goal) && c.count('shark') < HELPER_FOOD ? [{ name: 'shark', n: HELPER_FOOD - c.count('shark') }] : [];
        let need = sum([...items, ...travel, ...(c.count('coins') < 50 ? [{ name: 'coins', n: 200 }] : []), ...food]).filter(i => i.n > 0);
        // keep the jewellery we already hold (any charge)
        let keep = c.inv().map(sl => objDebugName(sl.obj)).filter(n => TRAVEL_FAMILY.some(([re]) => re.test(n)));
        // fix 137 (qrqa: PiP 25-27 essence + glory + ring + necklace + coins = 29-31 slots: 'pack too small for the kit', the
        // helper came empty): a big kit leaves the optional travel items (coins, games necklace, ring) in the bank; glory stays
        for (const opt of [/^shark$/, /^coins$/, /^necklace_of_minigames_\d$/, /^ring_of_dueling_\d$/]) {
            if (slots(need) + keep.length <= 28) break;
            need = need.filter(i => !(opt.test(i.name) && !items.some(x => x.name === i.name)));
            keep = keep.filter(n => !opt.test(n));
        }
        if (need.every(i => c.count(i.name) >= i.n)) return;
        // fix lg-1 (Legends cheatless proof lgr1, C meeting: 'no walk route' after the helper's glory went into the bank): `keep` holds
        // the jewellery NAMES read before the trip to the bank, and the glory teleport TO the bank spends a charge (glory_3 ->
        // glory_2), so the bank visit deposited the glory as not-kept. Keep every charge of a held family.
        const allCharges = (n: string) => { const f = TRAVEL_FAMILY.find(([re]) => re.test(n)); const m = f ? /^(.*_)(\d)$/.exec(n) : null; return m ? Array.from({ length: 8 }, (_, k) => `${m[1]}${k + 1}`) : [n]; };
        await bankVisit(c, need, [...keep.flatMap(allCharges), ...(food.length || c.count('shark') ? ['shark'] : [])], null, this.known, 'helper');
    }
    override handoff(to: SpeedBot, items: Item[], label: string): Promise<boolean> {
        items = items.filter(i => i.n > 0);
        if (!items.length) return Promise.resolve(true);
        if (helperUnreachable(to.pos())) { say('helper', `${label}: ${JSON.stringify(to.pos())} is out of a helper's reach: trainee bank visit`); return this.fallback(to, items); }
        this.goal = to.pos();
        const want = [...items];
        const run = this.lock(async () => {
            const c = await this.ensure();
            const t0 = to.tickCount;
            LENIENT.add(c.loginUser.toLowerCase());
            // fix lg-2 (Legends cheatless proof lgc1, C meeting: the trainee waited 236 t): the helper stood ready at the meeting
            // with every item, but fetch() saw its glory at 1 charge (fix 122 counts that as missing) and went to the bank for a
            // fresh one first. Ready and next to the trainee: trade now (the refill rides on its next bank visit; glory_1 still
            // reaches a bank).
            // session 8 (allchaos qt45m Legends B: the helper waited loaded at the belt (2816,2945), the main asked from the anvil
            // (2858,2922), 47 tiles: not 'ready' -> fetch() re-banked for a fresh glory (its own was at 1 charge), the walk back
            // failed and the kit never came): a loaded helper within 80 tiles on our level just walks over (the glory refill
            // rides on its next bank visit). SR_HELPER_NEAR=0 reverts to 6 tiles.
            const nearR = process.env.SR_HELPER_NEAR === '0' ? 6 : 80;
            const ready = cheb(c.tile(), to.tile()) <= nearR && c.minusedlevel === to.minusedlevel && items.every(i => c.count(i.name) >= i.n);
            try { if (!ready) await this.fetch(c, items); } finally { LENIENT.delete(c.loginUser.toLowerCase()); }
            const missing = items.filter(i => c.count(i.name) < i.n).map(i => ({ name: i.name, n: i.n - c.count(i.name) }));
            items = items.filter(i => c.count(i.name) > 0).map(i => ({ name: i.name, n: Math.min(i.n, c.count(i.name)) }));
            if (missing.length) say('helper', `${label}: ${this.name} is short of ${missing.map(i => `${i.name}x${i.n}`).join(',')}`);
            if (!items.length) return false;
            for (let k = 0; k < 3 && cheb(c.tile(), to.tile()) > 3 || (k < 3 && c.minusedlevel !== to.minusedlevel); k++) await travelTo(c, to.pos(), this.known, { near: 2, tag: 'helper' });
            let r: { ok: boolean; ticks: number; message?: string } = { ok: false, ticks: 0 };
            // session 8 (allchaos qt36m MM phase 2 kit: 3 x both-sides timeout, the trainee just inside the Grand Tree trunk door
            // (2465,3493) and the helper outside (2465,3489) with 'no walk route' in): after a miss the waiting TRAINEE walks to
            // the helper (door-aware walker; only when the helper is within 12 tiles on our level: qt42m walked out of the
            // Kharazi jungle toward a helper stuck at Edgeville), then the trade again; 4 tries. SR_TRADE_MEET=0 reverts.
            const meet = process.env.SR_TRADE_MEET !== '0';
            for (let k = 0; k < (meet ? 4 : 3) && !r.ok; k++) {
                if (meet && k > 0 && c.minusedlevel === to.minusedlevel && cheb(c.tile(), to.tile()) <= 12 && (cheb(c.tile(), to.tile()) > 1 || k > 1)) { const ct = c.tile(); await to.walkTo(ct.x, ct.z, { near: 1, maxTicks: 40, log: false }); say('helper', `${label}: trainee walked to the helper -> ${JSON.stringify(to.tile())} (helper ${JSON.stringify(ct)})`); }
                r = await tradeIn(to, c, items, { maxTicks: 40 }); if (!r.ok) { say('helper', `${label} try ${k + 1}: ${r.message?.slice(0, 160)}`); await to.tick(2); }
            }
            say('helper', `${label} -> ${to.loginUser}: ${items.map(i => `${i.name}x${i.n}`).join(',')} ${r.ok ? 'OK' : 'FAILED'}; trainee waited ${to.tickCount - t0} t`);
            return r.ok && !missing.length;
        });
        // never let a helper problem stop the route: whatever did not arrive comes from the trainee's bank
        return run.catch(e => { say('helper', `${label}: ${(e as Error).message.slice(0, 160)}`); return false; })
            .then(async ok => ok || this.fallback(to, want.filter(i => to.count(i.name) < i.n).map(i => ({ name: i.name, n: i.n - to.count(i.name) }))));
    }
    /** the trainee trades `items` to the helper to free slots (PiP); `handBack` returns them */
    override lend(from: SpeedBot, items: Item[], label: string): Promise<boolean> {
        return this.lock(async () => {
            const c = await this.ensure();
            for (let k = 0; k < 3 && cheb(c.tile(), from.tile()) > 3; k++) await travelTo(c, from.pos(), this.known, { near: 2, tag: 'helper' });
            const r = await tradeIn(c, from, items, { maxTicks: 40 });
            if (r.ok) this.lent.set(from.loginUser, [...(this.lent.get(from.loginUser) ?? []), ...items]);
            say('helper', `${label}: ${from.loginUser} lends ${items.map(i => `${i.name}x${i.n}`).join(',')} ${r.ok ? 'OK' : 'FAILED'}`);
            return r.ok;
        });
    }
    override async handBack(to: SpeedBot, label: string): Promise<boolean> {
        const lent = this.lent.get(to.loginUser); if (!lent?.length) return true;
        let items: Item[] = lent;
        const ok = await this.lock(async () => {
            const c = await this.ensure();
            // session 9 (qt47/qt51 PiP: ~1,400 t of helper travel into the mausoleum gates, then 'holds none of the items': a bank
            // visit had deposited them): nothing to give = no trip
            if (process.env.SR_HANDBACK_HELD !== '0' && !items.some(i => c.count(i.name) > 0)) { say('helper', `${label} (hand back): skipped, ${this.name} holds none of ${items.map(i => i.name).join(',')}`); return false; }
            items = items.filter(i => c.count(i.name) > 0).map(i => ({ name: i.name, n: Math.min(i.n, c.count(i.name)) }));
            for (let k = 0; k < 3 && cheb(c.tile(), to.tile()) > 3; k++) await travelTo(c, to.pos(), this.known, { near: 2, tag: 'helper' });
            // fix 142 (qrqa + qrqc PiP hand back FAILED: the helper stopped at a gate 3407,9899 the trainee had passed): the
            // trainee walks to the helper instead
            if (cheb(c.tile(), to.tile()) > 3 && c.minusedlevel === to.minusedlevel) await to.walkTo(c.tile().x, c.tile().z, { near: 1, maxTicks: 80, log: false });
            const r = await tradeIn(to, c, items, { maxTicks: 40 });
            say('helper', `${label} (hand back): ${r.ok ? 'OK' : `FAILED (${r.message?.slice(0, 120)})`}`);
            return r.ok;
        });
        if (ok) this.lent.delete(to.loginUser);
        return ok;
    }
}

/** Regicide segment progress (read by the regicide adapter in route-legs.ts): mark the messenger segment done */
export function markRegicideMsg(acct: string): void {
    const f = resolve(HERE, 'progress', `${acct.toLowerCase()}-regicide.json`);
    let segs: string[] = []; try { segs = JSON.parse(readFileSync(f, 'utf8')); } catch { /* fresh */ }
    if (!segs.includes('msg')) segs.push('msg');
    try { mkdirSync(resolve(HERE, 'progress'), { recursive: true }); writeFileSync(f, JSON.stringify(segs)); } catch { /* ignore */ }
}
export class MessengerWatcher {
    armed = false; caughtAt = -1; seenAt = -1; pages = 0; private stop = false;
    constructor(private getBot: () => SpeedBot, private tag = 'messenger') { }
    held(): boolean { const b = this.getBot(); return b.count(SUMMONS) > 0; }
    arm(): void {
        if (this.armed) return;
        this.armed = true; this.stop = false;
        void this.loop();
    }
    disarm(): void { this.stop = true; }
    private textNow(b: SpeedBot): boolean {
        for (const v of b.ifText.values()) if (v && MSG_RE.test(v)) return true;
        return false;
    }
    private async loop(): Promise<void> {
        let lastPage = -10;
        while (!this.stop) {
            const b = this.getBot();
            if (b.disposed) { await new Promise(r => setTimeout(r, 200)); continue; }
            try {
                const m = npc(b, MESSENGER);
                if (m && this.seenAt < 0) { this.seenAt = b.tickCount; say(this.tag, `messenger in view at d=${m.d} (${JSON.stringify(b.pos())})`); }
                if (b.chatModalId !== -1 && b.tickCount - lastPage >= 1 && (this.textNow(b) || (m && m.d <= 2 && !b.dialogOptions().length)) && !this.held() || (b.chatModalId !== -1 && this.held() && this.caughtAt < 0 && this.textNow(b))) {
                    rawResume(b); b.queueFlush(); lastPage = b.tickCount; this.pages++;
                }
                if (this.held() && this.caughtAt < 0) { this.caughtAt = b.tickCount; say(this.tag, `summons received (${this.pages} pages paged by the watcher)`); }
                if (this.held() && b.chatModalId === -1) {
                    // fix 69: the summons is flavour (the messenger sets %regicide_quest itself, regicide_kings_messenger.rs2:24-25;
                    // the item only opens a letter, quest_regicide.rs2:1). Record Regicide's 'msg' segment as done and drop it:
                    // it took Priest in Peril's key slot (qri2m 'golden key pickup' with 28/28) and was lost once in a bank.
                    markRegicideMsg(b.loginUser);
                    try { await b.dropAll([objId(SUMMONS)], 4); } catch { /* keep it */ }
                    say(this.tag, `summons ${b.count(SUMMONS) ? 'still held' : 'dropped'}; Regicide 'msg' marked done`);
                    this.stop = true; break;
                }
                await b.tick(1);
            } catch { await new Promise(r => setTimeout(r, 100)); }
        }
        this.armed = false;
    }
    /** between quests: if he is in view, walk up and talk until the summons is held */
    async catchNow(maxTicks = 60): Promise<number> {
        const b = this.getBot(); const t0 = b.tickCount;
        if (this.held()) return 0;
        const m = npc(b, MESSENGER);
        if (!m) return 0;
        say(this.tag, `catching him between quests (d=${m.d})`);
        while (!this.held() && b.tickCount - t0 < maxTicks) {
            const n = npc(b, MESSENGER);
            if (b.chatModalId !== -1) { rawResume(b); b.queueFlush(); }
            else if (n && n.d > 1) opNpcGo(b, n, 1);
            else if (n) { b.opNpc(n.idx, 1); b.queueFlush(); }
            await b.tick(1);
        }
        await b.until(() => b.chatModalId === -1, 6);
        return b.tickCount - t0;
    }
}

// ---------------------------------------------------------------------------------------------------------------------
// progress + timeline (files in this dir: progress/<acct>.json, logs/<run>.jsonl)
// ---------------------------------------------------------------------------------------------------------------------
export interface Progress { acct: string; done: string[]; clock: number; notes: string[] }
export function progPath(acct: string): string { return resolve(HERE, 'progress', `${acct.toLowerCase()}.json`); }
export function readProgress(acct: string): Progress {
    try { if (existsSync(progPath(acct))) return JSON.parse(readFileSync(progPath(acct), 'utf8')); } catch { /* fresh */ }
    return { acct, done: [], clock: 0, notes: [] };
}
export function writeProgress(p: Progress): void {
    mkdirSync(resolve(HERE, 'progress'), { recursive: true });
    writeFileSync(progPath(p.acct), JSON.stringify(p, null, 1));
}
export class Timeline {
    readonly file: string;
    constructor(run: string) { mkdirSync(resolve(HERE, 'logs'), { recursive: true }); this.file = resolve(HERE, 'logs', `${run}.jsonl`); }
    add(rec: Record<string, unknown>): void { appendFileSync(this.file, JSON.stringify({ ...rec, wall: new Date().toISOString() }) + '\n'); }
}
export { qp, msgsSince };

// ---------------------------------------------------------------------------------------------------------------------
// combat style + training inserts
// ---------------------------------------------------------------------------------------------------------------------
/** Defensive style for the worn weapon (in-quest combat xp then trains defence, which the route lacks: the plan's levels are
 *  quest-xp only, Tourist Trap needs combat >= 87). A weapon swap resets com_mode, so this runs before every quest. */
export async function setDefensive(bot: SpeedBot): Promise<boolean> {
    const w = worn(bot).map(objDebugName).join(',');
    const iface = /scimitar|longsword|_sword\b|sickle|excalibur/.test(w) ? 'combat_hacksword' : /staff/.test(w) ? 'combat_staff_2' : /dagger/.test(w) ? 'combat_stabsword'
        : /mace|warhammer/.test(w) ? 'combat_spiked' : /axe|battleaxe/.test(w) ? 'combat_axe' : /bow|crossbow/.test(w) ? '' : 'combat_unarmed';
    if (!iface) return false;
    const want = bot.styleIndexFor(iface, 'defensive');
    for (let k = 0; k < 4 && bot.combatStyle() !== want; k++) { bot.setCombatStyle(iface, 'defensive'); bot.queueFlush(); await bot.tick(1); }
    return bot.combatStyle() === want;
}

/** Fletching: knife on logs -> 15 arrow shafts per log (cut_logs.rs2, skill_multi3 make10) until `to`. */
export async function trainFletch(bot: SpeedBot, to: number): Promise<boolean> {
    const make10 = (() => { try { return componentId('skill_multi3:make10_a'); } catch { return -1; } })();
    for (let k = 0; k < 20 && bot.stat('fletching').level < to && bot.count('logs') > 0; k++) {
        if (bot.chatModalId !== -1 && bot.chatModalId !== 306) { dismiss(bot); await bot.tick(1); }
        const kn = objId('knife'), lg = objId('logs');
        const xp0 = bot.stat('fletching').xp;
        bot.useItemOnItem(kn, bot.slot(kn), lg, bot.slot(lg)); bot.queueFlush();
        if (!(await bot.until(() => bot.chatModalId !== -1, 6))) continue;
        if (make10 > 0) { bot.ifButton(make10); bot.queueFlush(); }
        // each fletching level-up page stops the batch: wait for the xp, then re-use at once
        const n0 = bot.count('logs');
        await bot.until(() => bot.stat('fletching').level >= to || bot.count('logs') < n0, 8);
        await bot.until(() => bot.stat('fletching').level >= to || bot.count('logs') === 0 || bot.chatModalId !== -1 || bot.count('logs') < n0 - 1, 3);
    }
    return bot.stat('fletching').level >= to;
}

/** Defence (or any melee) training on nearby npcs in defensive style until `done()`; eats at 50%. */
export async function trainCombat(bot: SpeedBot, types: number[], anchor: Tile, done: () => boolean, maxTicks = 600): Promise<boolean> {
    await setDefensive(bot);
    const t0 = bot.tickCount;
    let target = -1, atk = -100, xp = 0;
    const cxp = () => ['attack', 'strength', 'defence', 'hitpoints'].reduce((a, s) => a + bot.stat(s).xp, 0);
    let xpAt = bot.tickCount;
    while (!done() && bot.tickCount - t0 < maxTicks) {
        const hp = bot.stat('hitpoints');
        if (hp.cur <= hp.level / 2) { const f = bot.inv().find(s => /^(shark|lobster|swordfish|trout)$/.test(objDebugName(s.obj))); if (f) { bot.opHeld1(f.obj, f.slot); bot.queueFlush(); await bot.tick(2); continue; } }
        if (bot.chatModalId !== -1) { rawResume(bot); bot.queueFlush(); }
        const x = cxp(); if (x !== xp) { xp = x; xpAt = bot.tickCount; }
        const list = npcsOf(bot, types).filter(n => n.d <= 16);
        const alive = list.some(n => n.idx === target);
        if (!alive || (bot.tickCount - atk > 8 && bot.tickCount - xpAt > 8)) {
            const n = list[0];
            if (n) { bot.opNpc(n.idx, 2); bot.queueFlush(); target = n.idx; atk = bot.tickCount; }
            else if (cheb(bot.tile(), anchor) > 3) await bot.walkTo(anchor.x, anchor.z, { near: 2, maxTicks: 60, log: false });
        }
        await bot.tick(1);
    }
    return done();
}

// ---------------------------------------------------------------------------------------------------------------------
// Glory recovery: at the end of a run, a stop or an abort, each of our accounts
// banks ALL its glories (any charge, incl. used-up), worn ones too. Only glories are deposited (a resumed run keeps its pack).
// SR_GLORY_BANK_END=0 skips it.
// ---------------------------------------------------------------------------------------------------------------------
const GLORY_ANY = /^amulet_of_glory(_[1-4])?$/;
export async function bankGlories(bot: SpeedBot | null | undefined, done: Set<string>, tag: string): Promise<string> {
    if (!bot || bot.disposed || process.env.SR_GLORY_BANK_END === '0') return 'skipped';
    try {
        if (bot.chatModalId !== -1 || bot.mainModalId !== -1) { dismiss(bot); await bot.tick(1); }
        const wg = worn(bot).filter(id => GLORY_ANY.test(objDebugName(id)));
        if (wg.length && bot.free() >= wg.length) { bot.burst(wg.map(id => () => bot.unequipItem(id))); await bot.until(() => wg.every(id => !bot.isWorn(id)), 6); }
        const held = () => bot.inv().filter(s => GLORY_ANY.test(objDebugName(s.obj)));
        if (!held().length) { const r = wg.length ? `worn glory could not come off (free ${bot.free()})` : 'none held'; say(tag, `[glory-bank] ${bot.loginUser}: ${r}`); return r; }
        const what = held().map(s => objDebugName(s.obj).replace('amulet_of_', '')).join(',');
        // the designated bank: the nearest by the travel planner (glories may be rubbed for it; the rub is in the ledger)
        const plan = await planBank(bot, null, done, []);
        if (!plan) { say(tag, `[glory-bank] ${bot.loginUser}: NO reachable bank from ${JSON.stringify(bot.pos())} holding ${what}`); return 'no bank'; }
        await travelTo(bot, plan.bank.at, done, { near: 4, tag });
        let opened = false;
        for (let k = 0; k < 6 && !opened; k++) { const r = await bot.openBank({ radius: 16, kind: k % 2 === 0 ? 'npc' : 'any', maxTicks: 15 }); opened = r.ok; if (!opened) await bot.walkTo(plan.bank.at.x, plan.bank.at.z, { near: 1, maxTicks: 60, log: false }); }
        if (!opened) { say(tag, `[glory-bank] ${bot.loginUser}: could not open the ${plan.bank.id} bank, holding ${held().map(s => objDebugName(s.obj)).join(',')}`); return 'bank closed'; }
        await bot.tick(1);
        const keepIds = [...new Set(bot.inv().filter(s => !GLORY_ANY.test(objDebugName(s.obj))).map(s => s.obj))];
        for (let k = 0; k < 3 && held().length; k++) { await bot.depositAll(keepIds); await bot.tick(2); }
        await bot.tick(5);   // the ledger reads the bank while it is open (qt26m: closed 2 t after the deposit, the snapshot missed it)
        const r = held().length ? `FAILED, still holding ${held().map(s => objDebugName(s.obj)).join(',')}` : `deposited ${what} at bank ${plan.bank.id}`;
        bot.closeBank(); await bot.tick(1);
        say(tag, `[glory-bank] ${bot.loginUser}: ${r}`);
        return r;
    } catch (e) { say(tag, `[glory-bank] ${bot.loginUser}: threw ${(e as Error).message.slice(0, 160)}`); return 'threw'; }
}
