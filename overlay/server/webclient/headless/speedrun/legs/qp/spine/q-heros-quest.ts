/// <reference types="bun" />
// q-heros-quest.ts — HERO'S QUEST (members, 1 QP), cheat-free, TWO accounts in one world: one Phoenix Gang member and one
// Black Arm Gang member (each finished Shield of Arrav in a different gang). Lane spine.
//
// Verified against the rev-289 content (paths relative to server/content/scripts):
//   gates    quests/quest_hero/scripts/quest_hero.rs2:1-7 (qp >= 55, Lost City, Dragon Slayer, Merlin's Crystal, Arrav either
//            gang); stages quest_hero.constant (1 started; Phoenix 2 Straven, 3 Alfonse, 4 Charlie, 5 Grip killed, 6 armband;
//            Black Arm 7 Katrine, 8 Grubor, 9 ID papers, 10 Garv, 11 papers to Grip, 12 chest looted, 13 armband).
//   Achietties  areas/areas_heroes_guild/scripts/achietties.rs2 (start :38-44; hand-in of hot_feather + lava_eel +
//            master_thief_armband :12-21 -> queue hero_quest_complete).
//   Ice Queen  her death_drop is ice_gloves (_unpack/225/all.npc [ice_queen]); ice_gloves are tradeable=no and have no
//            armour category, so Entrana's ban (area_port_sarim/scripts/monk_of_entrana.rs2:26-53) does not apply to them.
//            Her lair is reached by the ladder at (2859,3519) only (probe-region.ts: the other ladders lead elsewhere).
//   feather   drop tables/scripts/entrana_firebird.rs2:9-11 (hot_feather while %heroquest < complete); picking it up needs the
//            ice gloves WORN (quests/quest_hero/scripts/objs/fire_feather.rs2:6). Entrana bans weapons and armour in the pack
//            or worn (monk_of_entrana.rs2:26-53): this leg fights with spells only.
//   eel       Gerrant's slime (areas/area_port_sarim/scripts/gerrant.rs2:20-35, needs a free slot) + harralander potion (unf)
//            = blamish oil (herblore 25, skill_herblore/configs/brewing/brew_potion.struct [blamish_oil]); oil on a fishing
//            rod = oily rod (objs/oily_fishing_rod.rs2:4-13); fish the Taverley lava (skill_fishing/scripts/fishing_spots/
//            lavafish.rs2: fishing 53, oily rod, bait); cook (cooking 53, never burns: cooking_generic.dbrow:105-112).
//            raw_lava_eel and lava_eel are tradeable=no, so each account makes its own.
//   Phoenix   Straven (areas/area_varrock/scripts/straven.rs2:152-159 -> 2), Alfonse (area_brimhaven/scripts/
//            alfonse_the_waiter.rs2 -> 3), Charlie (npcs/charlie_the_cook.rs2 -> 4), Grip may only be attacked by a Phoenix
//            member at >= 4 (npcs/grip.rs2:59-65, npc_combat.rs2:148/235); his death sets 5 (drop tables/scripts/grip.rs2).
//            Straven gives the armband for a candlestick only at stage 5 (straven.rs2:95-101/139-149).
//   Black Arm Katrine (areas/area_varrock/scripts/katrine.rs2:117-133 -> 7), Grubor's door password "Four leaved clover"
//            (npcs/grubor.rs2:22-29 -> 8), Trobert (npcs/trobert.rs2 -> id_papers, 9), Garv with full black armour worn +
//            papers (npcs/garv.rs2:39-57 -> 10), Grip takes the papers (npcs/grip.rs2:3-17 -> 11) and gives the misc_key on
//            "Anything I can do now?" (:48-56); grip_keys open the treasure door only at >= 11 (locs/
//            brimhaven_scarface_mansion.rs2:61-72); the chest gives 2 candlesticks (:79-93 -> 12); Katrine's armband needs 12.
//   Mansion   probe-rooms.ts with the quest doors shut: Grip's hall (x2759-2781 z3188-3199) holds Grip (2774,3192) and the
//            cabinet summon tile (2777,3198); the treasure room is x2764-2772 z3196-3199 (door 2764,3197 from the hall side
//            x2763); the side room (x2780-2782 z3197-3198) opens from Olbors' garden only with the misc_key; Grip is summoned
//            next to it by the drinks cabinet (brimhaven_scarface_mansion.rs2:9-35), so the Phoenix member hits him with spells.
//   Doors     open_and_close_door teleports (doors/scripts/open_and_close_doors.rs2:9-38): ON the door's own tile you go to
//            the far side, from anywhere else you land ON the door tile. So every quest door is used from an exact tile.
import { SpeedBot, objId, objDebugName, cheb } from '../../../core.js';
import * as ls from '../../../../loc-scene.js';
import { nav, inDialog, npc, npcsOf, dismiss, msgsSince } from '../../q-lib.js';
import {
    mkLog, fail, go, locHere, openNpc, chat, converse, byText, textWatch, clearModals, useItemOnItem, pickup, glory, teleSpell,
    wieldAll, guard, castKill, opLocUntil, npcIdOf, startWarningCloser, textLog, untilChat, retaliateOff, opHeldN, spTrace, type Item, type Log, type Tile,
    prayKeep, hasMsg, lockAttackers,
} from './sp-lib.js';
import { failHook } from '../journal.js';

export type Gang = 'phoenix' | 'blackarm';
export const QUEST = { name: "Hero's Quest", dir: 'quest_hero', qp: 1 };
export const REQUIREMENTS = {
    quests: ["Shield of Arrav (one account per gang)", 'Lost City', 'Dragon Slayer', "Merlin's Crystal",
        'Plague City (+ scroll read: Ardougne teleport, skill_magic/scripts/spells/teleport.rs2:22-35)'],
    qp: 55,
    skills: {
        magic: [59, 'fire blast vs the Ice Queen and Grip (no weapons: Entrana), magic_combat_spells.dbrow fire_blast levelrequired 59; Ardougne teleport 51'],
        fishing: [53, 'lava eel, lavafish.rs2:84'],
        cooking: [53, 'lava eel, cooking_generic.dbrow:110'],
        herblore: [25, 'blamish oil, brew_potion.struct [blamish_oil]'],
        prayer: [43, 'Protect from Melee in the Ice Queen lair and Taverley dungeon'],
        mining: [50, 'the hero rockslide on White Wolf Mountain, the only way to the Ice Queen (white_wolf_mountain.rs2:20)'],
    } as Record<string, [number, string]>,
    start: { x: 2904, z: 3510, level: 0 },    // Achietties, outside the Heroes' Guild door (herodoor 2902,3510 a0)
    end: { x: 2904, z: 3510, level: 0 },
};
const COMMON: Item[] = [
    { name: 'fishing_rod', n: 1 }, { name: 'fishing_bait', n: 5 }, { name: 'harralandervial', n: 1 },
    { name: 'tinderbox', n: 1 }, { name: 'logs', n: 2 }, { name: 'coins', n: 100 },   // 2 logs: a second try if the first fire is lost;                     // ship Ardougne -> Brimhaven 30
    { name: 'amulet_of_glory_4', n: 1 },                                                                    // Draynor (-> Port Sarim)
    // runes: Varrock tele x2 (law 1, air 3, fire 1), Ardougne tele (law 2, water 2), Falador tele x2 (law 1, air 3, water 1),
    // fire blast (death 1, fire 5, air 4) x55 (sim sph12: the Black Arm Ice Queen fight alone took ~38): Ice Queen (104 hp), Jailer, Grip (25 hp), the firebird (5 hp)
    // fix 188 (route qt21hp: the Black Arm Ice Queen fight took 51 casts, death runes 55 -> 4; charger cgw1 ran OUT): 100 casts
    // (runes stack: no slot). HQ_RUNES=55 = the old amounts.
    { name: 'lawrune', n: 6 }, { name: 'waterrune', n: 4 }, { name: 'deathrune', n: process.env.HQ_RUNES === '55' ? 55 : 100 }, { name: 'firerune', n: process.env.HQ_RUNES === '55' ? 277 : 520 },
    { name: 'airrune', n: process.env.HQ_RUNES === '55' ? 232 : 450 },
    { name: 'shark', n: 8 }, { name: '4doseprayerrestore', n: 2 },   // full run sph10: prayer and food ran out at the Ice Queen
    { name: 'bronze_pickaxe', n: 1 },   // the hero rockslide (white_wolf_mountain.rs2:14-23: any pickaxe + mining 50); dropped after
];
export const SUPPLY: Record<Gang, Item[]> = {
    phoenix: COMMON,
    // + Camelot teleport (law 1, air 5) to the rockslide after the armband, + a third Falador teleport (eel first)
    blackarm: [...COMMON.map(i => i.name === 'lawrune' ? { ...i, n: i.n + 2 } : i.name === 'airrune' ? { ...i, n: i.n + 8 } : i.name === 'waterrune' ? { ...i, n: i.n + 1 } : i),
        { name: 'black_full_helm', n: 1 }, { name: 'black_platebody', n: 1 }, { name: 'black_platelegs', n: 1 }]
        // fix 270b (qyf02/qx08p: the Black Arm member's prayer hit 0 during the ~50-cast fight, Protect from Melee off, the
        // ice warriors hit through): a 3rd prayer potion. HQ_BA_PRAY=0 reverts.
        .map(i => i.name === '4doseprayerrestore' && process.env.HQ_BA_PRAY !== '0' ? { ...i, n: i.n + 1 } : i)
        // session 11 fix 377a (qx268p 'ice queen: out of blast runes', deathrune 0: 100 = 13 on the way + 38 on ice warriors in
        // two fix-270 recoveries + 49 on her, still alive; the in-place retries then had 0): fire blast x150, +50 death,
        // +250 fire, +200 air (runes stack: no slot; the charger's Math.max keeps it). HQ_BA_RUNES=0 reverts.
        .map(i => process.env.HQ_BA_RUNES === '0' ? i : i.name === 'deathrune' ? { ...i, n: i.n + 50 } : i.name === 'firerune' ? { ...i, n: i.n + 250 } : i.name === 'airrune' ? { ...i, n: i.n + 200 } : i),
};

const N = {
    achietties: npcIdOf('achietties'), iceQueen: npcIdOf('ice_queen'), straven: npcIdOf('straven'), katrine: npcIdOf('katrine'),
    barnaby: npcIdOf('captain_barnaby'), alfonse: npcIdOf('alfonse_the_waiter'), charlie: npcIdOf('charlie_the_cook'),
    grubor: npcIdOf('grubor'), trobert: npcIdOf('trobert'), garv: npcIdOf('garv'), grip: npcIdOf('grip'),
    gerrant: npcIdOf('gerrant'), shipmonk: npcIdOf('shipmonk'), shipmonk2: npcIdOf('shipmonk2'), firebird: npcIdOf('fire_bird'),
    lavafish: npcIdOf('0_45_152_lavafish'),
};
const O = {
    gloves: objId('ice_gloves'), feather: objId('hot_feather'), eel: objId('lava_eel'), rawEel: objId('raw_lava_eel'),
    armband: objId('master_thief_armband'), candle: objId('petecandlestick'), miscKey: objId('misc_key'), gripKeys: objId('grip_keys'),
    papers: objId('id_papers'), slime: objId('blamish_snail_slime'), oil: objId('blamish_oil'), oilyRod: objId('oily_fishing_rod'),
    rod: objId('fishing_rod'), harra: objId('harralandervial'), coins: objId('coins'), logs: objId('logs'), tinderbox: objId('tinderbox'),
};
const BLACK = ['black_full_helm', 'black_platebody', 'black_platelegs'];
const T = {
    achietties: { x: 2903, z: 3510 }, iceLadder: { id: 1759, x: 2859, z: 3519 }, iceLadderUp: { id: 1755, x: 2859, z: 9919 },
    iceQueen: { x: 2866, z: 9952 }, katrine: { x: 3186, z: 3385 }, phoenixLadder: { id: 1754, x: 3244, z: 3383 },
    phoenixUp: { id: 2405, x: 3244, z: 9783 }, straven: { x: 3246, z: 9780 }, barnaby: { x: 2679, z: 3275 },
    brimPlank: { id: 2088, x: 2774, z: 3234 }, alfonse: { x: 2793, z: 3188 }, charlie: { x: 2790, z: 3191 },
    kitchenDoor: { id: 2628, x: 2788, z: 3189 }, panel: { id: 2629, x: 2787, z: 3190 }, sideDoor: { id: 2622, x: 2781, z: 3197 },
    gruborDoor: { id: 2626, x: 2811, z: 3170 }, trobert: { x: 2806, z: 3174 }, garvDoor: { id: 2627, x: 2774, z: 3187 },
    grip: { x: 2774, z: 3192 }, cabinet: { id: 2635, x: 2775, z: 3196 }, treasureDoor: { id: 2621, x: 2764, z: 3197 },
    chest: { id: 2632, x: 2766, z: 3199 }, meet: { x: 2774, z: 3185 }, gerrant: { x: 3013, z: 3225 }, monks: { x: 3046, z: 3235 },
    entranaPlank: { id: 2415, x: 2834, z: 3333 }, sarimPlank: { id: 2413, x: 3048, z: 3232 }, firebird: { x: 2847, z: 3386 },
    taverleyLadder: { id: 1759, x: 2884, z: 3397 }, lavaStand: { x: 2890, z: 9767 },
};
export const PHASES = ['start', 'icequeen', 'gang', 'brim', 'pair', 'armband', 'icequeen2', 'entrana', 'gerrant', 'eel', 'finish'] as const;
export type Phase = typeof PHASES[number];
/** Both accounts fight the same Ice Queen (respawn 100 t, _unpack/225/all.npc [ice_queen] respawnrate): the Phoenix member
 *  goes first (from the guild), the Black Arm member after the armband ('icequeen2'), which also gets it to Brimhaven first. */
const ORDER: Record<Gang, Phase[]> = {
    // the Phoenix member waited ~267 t at the misc-key meet (sim c11): it takes the Entrana feather on the way instead
    // (HQ_P_ORDER=late keeps the old order, A/B)
    phoenix: process.env.HQ_P_ORDER === 'late'
        ? ['start', 'icequeen', 'gang', 'brim', 'pair', 'armband', 'entrana', 'gerrant', 'eel', 'finish']
        : ['start', 'icequeen', 'gang', 'entrana', 'brim', 'pair', 'armband', 'gerrant', 'eel', 'finish'],
    // the Black Arm member reaches the misc-key meet ~350 t before the Phoenix member (sim sph13): it makes its eel first
    // (Gerrant + Taverley) and goes to Brimhaven after. HQ_BA_ORDER=late keeps the old order (A/B).
    blackarm: process.env.HQ_BA_ORDER === 'late'
        ? ['start', 'gang', 'brim', 'pair', 'armband', 'icequeen2', 'entrana', 'gerrant', 'eel', 'finish']
        : ['start', 'gang', 'gerrant', 'eel', 'brim', 'pair', 'armband', 'icequeen2', 'entrana', 'finish'],
};

function pray(bot: SpeedBot, name: string, on: boolean): void { prayKeep(bot, on ? name : null); }
/** Cross a quest door (open_and_close_door) from an exact tile: ON the door tile = to the far side; next to it = onto it. */
async function doorFrom(bot: SpeedBot, door: { id: number; x: number; z: number }, stand: Tile, through: () => boolean, label: string, key?: number): Promise<void> {
    if (through()) return;
    const loc = locHere(door.id, door.x, door.z, bot.minusedlevel);
    for (let k = 0; k < 5 && !through(); k++) {
        if (bot.chatModalId !== -1) dismiss(bot);
        if (cheb(bot.tile(), stand) > 1) await go(bot, stand, 0, label, 200).catch(() => undefined);   // door-aware walk first
        if (bot.tile().x !== stand.x || bot.tile().z !== stand.z) await bot.stepTo(stand.x, stand.z, 30);
        if (key !== undefined) { const s = bot.slot(key); if (s < 0) fail(bot, `${label}: ${objDebugName(key)} not held`); bot.useItemOnLoc(loc.x, loc.z, loc.id, key, s); }
        else bot.opLoc(loc.x, loc.z, loc.id, 1);
        bot.queueFlush();
        await bot.until(() => through() || bot.chatModalId !== -1, 6);
        if (bot.chatModalId !== -1 && !through()) return;   // a dialog (Grubor, Garv) answers the op: the caller handles it
    }
    if (!through()) fail(bot, `${label}: not through`);
}

/** Hand `n` of one obj from `a` to `b` (both bots in this process): `a` steps next to `b`, then both trade screens. */
async function tradeOne(a: SpeedBot, b: SpeedBot, obj: number, n: number, label: string): Promise<void> {
    const want = b.count(obj) + n;
    // session 8 (allchaos qt34: 3 x both-sides 'timeout' with the pair DIAGONAL (3213,3425)/(3212,3426), no trade screen ever
    // opened): a cardinal neighbour only, and after a failed try the receiver steps to a fresh tile (up to 6 tries).
    // HQ_TRADE_CARDINAL=0 reverts.
    const card = process.env.HQ_TRADE_CARDINAL !== '0';
    const tries = card ? 6 : 3;
    for (let k = 0; k < tries && b.count(obj) < want; k++) {
        if (card && k > 0) {
            const bt0 = b.tile();
            for (const [dx, dz] of [[2, 0], [-2, 0], [0, 2], [0, -2]]) { const r = await b.stepTo(bt0.x + dx!, bt0.z + dz!, 12); if (r.ok) break; }
            await b.tick(1 + k);
        }
        const bt = b.tile();
        const adj = card ? Math.abs(a.tile().x - bt.x) + Math.abs(a.tile().z - bt.z) === 1 : cheb(a.tile(), bt) === 1;
        if (!adj || a.minusedlevel !== b.minusedlevel) {
            const nb = [[1, 0], [-1, 0], [0, 1], [0, -1]].map(([dx, dz]) => ({ x: bt.x + dx!, z: bt.z + dz! }));
            let okStep = false;
            for (const t of nb) { const r = await a.stepTo(t.x, t.z, 30); if (r.ok) { okStep = true; break; } }
            if (!okStep) await go(a, bt, 1, label, 60);
        }
        if (a.mainModalId !== -1 || a.chatModalId !== -1) a.closeModal();
        if (b.mainModalId !== -1 || b.chatModalId !== -1) b.closeModal();
        const [g, r] = await Promise.all([a.giveTo(b.loginUser, [{ obj, n }], { maxTicks: 60 }), b.acceptTradeFrom(a.loginUser, { maxTicks: 60, maxDist: 2 })]);
        if (!g.ok || !r.ok) console.log(`[hero] ${label}: trade try ${k + 1} failed give=${JSON.stringify(g)} accept=${JSON.stringify(r)}`);
    }
    if (b.count(obj) < want) fail(a, `${label}: ${objDebugName(obj)} not traded`);
}

/** Shared state for the two accounts (one process). */
export class Pair {
    flags = new Set<string>();
    names: Record<Gang, string> = { phoenix: '', blackarm: '' };
    bots: Partial<Record<Gang, SpeedBot>> = {};
    set(k: string): void { this.flags.add(k); console.log(`[hero pair] ${k}`); }
    has(k: string): boolean { return this.flags.has(k); }
    async wait(bot: SpeedBot, k: string, maxTicks: number, label: string): Promise<void> {
        if (!(await bot.until(() => this.flags.has(k) || this.flags.has('abort'), maxTicks)) || this.flags.has('abort')) fail(bot, `${label}: partner never reached '${k}'`);
    }
}

// ---- per-account phases --------------------------------------------------------------------------------------------------
async function start(bot: SpeedBot, log: Log): Promise<void> {
    let applied = false, closing = false;
    const pick = (opts: string[]) => {
        const a = opts.findIndex(t => /I'm a hero, may I apply/i.test(t)); if (a >= 0) { applied = true; return a; }
        const b = opts.findIndex(t => /start looking for all those/i.test(t)); if (b >= 0) { closing = true; return b; }
        return -1;
    };
    await converse(bot, N.achietties, T.achietties, pick, () => applied && closing && bot.chatModalId === -1, 'achietties start');
    log.split('start');
}

/**
 * Ice Queen. Her lair (x2857-2877 z9917-9964) is the end of White Wolf Mountain's ladder maze; solved offline
 * (probe-ladders.ts, probe-rooms.ts): west of the hero rockslide (2838,3517) -> Mine the rockslide (mining 50 + any
 * pickaxe; white_wolf_mountain.rs2:14-40 forcemoves you east) -> ladder down (2848,3513) -> underground west to the ladder
 * up at (2824,9907) -> ladder down (2827,3510) -> underground east to the ladder up at (2857,9917) (into the sealed nook
 * x2853-2861 z3516-3521) -> ladder down (2859,3519) -> the lair. Each climb keeps your tile (+-6400 z), so the stand
 * tiles below are the ones the probe linked.
 */
/**
 * session 11 fix 259a (from-zero qx04p 'ice queen: spell kill not done', fork qyf01 with SP_CASTLOG: the Black Arm member
 * (magic ~65-70, cb 106) needs ~55 Fire Blasts against her (defence 95, 104 hp: most casts splash) where the Phoenix
 * member (cb 120) needed 13; one castKill of 400 t at a 7 t cast rhythm ran out with her still alive, qyf01 made it at 396 t):
 * the kill in 60 t segments up to HQ_ICE_TICKS (default 1100) total, casting every 5 t (every:4; an early click is re-queued
 * by the server, player_magic.rs2 action_delay), each segment with the strongest blast the runes still allow, and an ice
 * warrior/giant/spider that holds us in combat ('I'm already under attack!', single-way lair) killed first. Waits out her
 * 100 t respawn on its own (castKill idles at the anchor while she is absent). HQ_ICE_SEG=0 reverts to the one 400 t castKill.
 */
async function iceQueenKill(bot: SpeedBot, g: ReturnType<typeof guard>, gang: Gang): Promise<void> {
    const got = () => bot.findGroundItem(O.gloves, 12) !== undefined || bot.count(O.gloves) > 0;
    // TEST mark (session 11 proof): the Black Arm member's fight, before the first cast
    if (gang === 'blackarm') failHook('hb-ice-queen');
    if (process.env.HQ_ICE_SEG === '0') {
        await castKill(bot, [N.iceQueen], 'fire_blast', 'ice queen', { done: got, dead: () => g.dead, maxTicks: 400, anchor: T.iceQueen });
        return;
    }
    const BLASTS: Array<[string, Record<string, number>]> = [['fire_blast', { firerune: 5, airrune: 4, deathrune: 1 }], ['earth_blast', { earthrune: 4, airrune: 3, deathrune: 1 }],
        ['water_blast', { waterrune: 3, airrune: 3, deathrune: 1 }], ['wind_blast', { airrune: 3, deathrune: 1 }]];
    const ADDS = [npcIdOf('icewarrior_queen'), npcIdOf('icewarrior'), npcIdOf('icegiant'), npcIdOf('ice_spider')];
    const t0 = bot.tickCount, tEnd = t0 + Number(process.env.HQ_ICE_TICKS ?? 1100);
    const every = Number(process.env.HQ_ICE_EVERY ?? 4);
    let seg = 0, stalls = 0;
    const fix270 = process.env.HQ_ICE_STALL !== '0';
    // session 11 fix 377a TEST: HQ_ICE_DRAIN_TEST=<n> counts n death runes as already spent on the Black Arm side (qx268p lost 51)
    const drain = gang === 'blackarm' ? Number(process.env.HQ_ICE_DRAIN_TEST ?? 0) : 0;
    while (!got() && bot.tickCount < tEnd && !g.dead) {
        const sp = BLASTS.find(([, need]) => Object.entries(need).every(([r, n]) => bot.count(r) - (r === 'deathrune' ? drain : 0) >= n));
        if (!sp) fail(bot, `ice queen: out of blast runes (${['firerune', 'earthrune', 'waterrune', 'airrune', 'deathrune'].map(r => `${r} ${bot.count(r)}`).join(', ')})`);
        const since = bot.tickCount, d0 = bot.count('deathrune');
        // fix 270: a segment in which the queen is in view but no cast lands for 20 t ends early (see iceStall)
        const stalled = () => fix270 && bot.tickCount - since >= 20 && bot.count('deathrune') === d0 && npcsOf(bot, [N.iceQueen]).length > 0;
        await castKill(bot, [N.iceQueen], sp[0], 'ice queen', { done: () => got() || hasMsg(bot, since, /already under attack/i) || stalled(), dead: () => g.dead, maxTicks: 60, anchor: T.iceQueen, every }).catch(() => undefined);
        seg++;
        const q = npcsOf(bot, [N.iceQueen])[0];
        const qe = q ? (bot as any).npcs?.[q.idx] : undefined;
        console.log(`[hero] ice queen (${gang}) seg ${seg} +${bot.tickCount - t0} t: ${sp[0]} casts ${d0 - bot.count('deathrune')}, queen ${q ? `${q.x},${q.z} d${q.d} hp ${qe?.health ?? '?'}/${qe?.totalHealth ?? '?'}` : 'not in view'}, me hp ${bot.stat('hitpoints').cur} pr ${bot.stat('prayer').cur} death ${bot.count('deathrune')}`);
        if (hasMsg(bot, since, /already under attack/i)) {
            const add = npcsOf(bot, ADDS).sort((a, b) => a.d - b.d)[0];
            console.log(`[hero] ice queen: under attack, add ${add ? `${add.type}@${add.x},${add.z} d${add.d}` : 'none in view'}`);
            if (add && add.d <= 8) await castKill(bot, [add.type], sp[0], 'ice add', { done: () => !npcsOf(bot, ADDS).some(a => a.idx === add.idx), dead: () => g.dead, maxTicks: 40, range: 5, every }).catch(() => undefined);
            else await bot.tick(4);
        } else if (fix270 && !got() && !g.dead && npcsOf(bot, [N.iceQueen]).length > 0 && (d0 === bot.count('deathrune') || (process.env.HQ_ICE_STALL_TEST === '1' && seg === 1))) {
            stalls++;
            await iceStall(bot, g, stalls, sp[0], ADDS, every);
            if (stalls >= 3 && d0 === bot.count('deathrune')) fail(bot, `ice queen: casts discarded after ${stalls} recoveries (not waiting to die)`);
        } else if (d0 !== bot.count('deathrune')) stalls = 0;
    }
    if (g.dead) fail(bot, 'ice queen: died');
    if (!got()) fail(bot, `ice queen: spell kill not done in ${bot.tickCount - t0} t (${seg} segments)`);
}

/**
 * session 11 fix 270 HQ_ICE_STALL (from-zero qx08p: the Black Arm member stood at (2870,9956) with the queen 'in view' at
 * (2870,9959) d3 for 2,500 t: 1 cast landed, then every OPNPCT (npc slot 4123, com 1181) was DISCARDED by the server (the
 * ack detector: no message, no rune/xp/modal change), the queen never moved or hit back, an Ice warrior beat us from hp 74
 * to 0 through 3 attempts. OpNpcTHandler drops a cast silently only when the npc slot is gone / not in our server-side npc
 * list / delayed, or the spell com is not visible; eating still worked, so the player side was fine. INFERRED: the client
 * npc entry was stale (a queen the server no longer tracked for us). Recovery when no cast lands for 20 t with her in view:
 * close modals, kill any add within 8 tiles first, then walk out of view (the lair's ladder end, ~38 tiles) and back, which
 * rebuilds the npc list on both sides; after 3 fruitless recoveries fail (the in-module retry) instead of dying in place.
 * HQ_ICE_STALL=0 reverts. TEST: HQ_ICE_STALL_TEST=1 forces one recovery after the first segment.
 */
async function iceStall(bot: SpeedBot, g: ReturnType<typeof guard>, n: number, spell: string, ADDS: number[], every: number): Promise<void> {
    const q = npcsOf(bot, [N.iceQueen])[0];
    const adds = npcsOf(bot, ADDS).sort((a, b) => a.d - b.d);
    console.log(`[hero] fix 270 ice stall #${n}: no cast landed; queen ${q ? `#${q.idx}@${q.x},${q.z} d${q.d}` : '-'}, me ${JSON.stringify(bot.pos())} hp ${bot.stat('hitpoints').cur} pr ${bot.stat('prayer').cur}, modal ${bot.chatModalId}/${bot.mainModalId}, adds ${adds.slice(0, 4).map(a => `${a.type}#${a.idx}@${a.x},${a.z} d${a.d}`).join(' ') || 'none'}, msgs ${JSON.stringify(msgsSince(bot, bot.tickCount - 25).slice(-3))}`);
    if (bot.chatModalId !== -1 || bot.mainModalId !== -1) { dismiss(bot); bot.queueFlush(); await bot.tick(1); }
    // 1) the adds that beat on us (single-way lair: an add in combat with us can also block the queen)
    for (let k = 0; k < 3 && !g.dead; k++) {
        const add = npcsOf(bot, ADDS).sort((a, b) => a.d - b.d)[0];
        if (!add || add.d > 8) break;
        const d0 = bot.count('deathrune');
        await castKill(bot, [add.type], spell, 'ice add', { done: () => !npcsOf(bot, ADDS).some(a => a.idx === add.idx), dead: () => g.dead, maxTicks: 40, range: 5, every }).catch(() => undefined);
        console.log(`[hero] fix 270 ice add ${add.type}#${add.idx}: casts ${d0 - bot.count('deathrune')}, ${npcsOf(bot, ADDS).some(a => a.idx === add.idx) ? 'still there' : 'gone'}`);
        if (d0 === bot.count('deathrune')) break;   // the adds refuse casts too: the view resync below
    }
    if (g.dead) return;
    // 2) out of view and back: the lair's ladder end (2860,9921) is ~38 tiles from her spot
    const q2 = npcsOf(bot, [N.iceQueen])[0];
    const d0 = bot.count('deathrune');
    if (q2) {
        const away = { x: 2860, z: 9921 };
        await go(bot, away, 1, 'ice resync away', 120).catch(() => undefined);
        await bot.tick(3);
        console.log(`[hero] fix 270 resync: at ${JSON.stringify(bot.pos())}, queen ${npcsOf(bot, [N.iceQueen]).map(x => `#${x.idx}@${x.x},${x.z} d${x.d}`).join(' ') || 'out of view'}`);
        await go(bot, T.iceQueen, 3, 'ice resync back', 120).catch(() => undefined);
        console.log(`[hero] fix 270 back: queen ${npcsOf(bot, [N.iceQueen]).map(x => `#${x.idx}@${x.x},${x.z} d${x.d}`).join(' ') || 'not in view'} (was #${q2.idx}@${q2.x},${q2.z}), casts meanwhile ${d0 - bot.count('deathrune')}`);
    }
}

/** session 11: in the Ice Queen's lair (underground x2850-2880 z9915-9965): a retry starts the fight in place */
const inIceLair = (bot: SpeedBot) => { const t = bot.tile(); return t.x >= 2850 && t.x <= 2880 && t.z >= 9915 && t.z <= 9965; };
async function iceQueen(bot: SpeedBot, log: Log, g: ReturnType<typeof guard>, gang: Gang = 'phoenix'): Promise<void> {
    await clearModals(bot);
    // session 11 fix 259c: a retry that already stands in the lair skips the rockslide + ladder maze (HQ_ICE_RESUME=0 reverts)
    if (!bot.isWorn(O.gloves) && bot.count(O.gloves) === 0 && process.env.HQ_ICE_RESUME !== '0' && inIceLair(bot)) {
        console.log(`[hero] ice queen (${gang}): already in the lair at ${JSON.stringify(bot.pos())}: fight in place`);
        pray(bot, 'protectfrommelee', true);
        await iceQueenKill(bot, g, gang);
        if (bot.count(O.gloves) === 0) await pickup(bot, O.gloves, 'ice gloves');
        pray(bot, 'protectfrommelee', false);
        log.split('ice-queen');
    }
    if (!bot.isWorn(O.gloves) && bot.count(O.gloves) === 0) {
        const under = () => bot.tile().z > 6400;
        const climb = async (id: number, x: number, z: number, stand: Tile, label: string) => {
            const wasUnder = under();
            await go(bot, stand, 0, label, 400);
            await opLocUntil(bot, locHere(id, x, z, 0), 1, () => under() !== wasUnder, label, { stand, maxTicks: 30, every: 5 });
        };
        // stage by stage (the regions overlap as boxes, so position alone cannot tell where we are): only skip the
        // rockslide when already east of it on the surface
        if (!(bot.tile().z < 6400 && bot.tile().x >= 2839 && bot.tile().x <= 2852 && bot.tile().z >= 3512 && bot.tile().z <= 3521)) {
            await go(bot, { x: 2837, z: 3517 }, 0, 'rockslide', 400);
            const rs = locHere(2634, 2838, 3517, 0);
            await opLocUntil(bot, rs, 2, () => bot.tile().x >= 2839, 'rockslide', { maxTicks: 30, every: 6 });
            log.split('rockslide');
        }
        // ice giants / spiders / warriors attack on sight underground (sim sph2: hp 75 -> 48)
        pray(bot, 'protectfrommelee', true);
        await climb(1759, 2848, 3513, { x: 2849, z: 3513 }, 'ladder 2848,3513');   // -> underground R4
        await climb(1755, 2824, 9907, { x: 2825, z: 9907 }, 'ladder 2824,9907');   // -> surface R2 (x2800-2828)
        await climb(1759, 2827, 3510, { x: 2828, z: 3510 }, 'ladder 2827,3510');   // -> underground R5
        await climb(1755, 2857, 9917, { x: 2858, z: 9917 }, 'ladder 2857,9917');   // -> surface nook (x2853-2861)
        await climb(1759, 2859, 3519, { x: 2860, z: 3519 }, 'ladder 2859,3519');   // -> the lair
        log.split('ice-lair');
        await go(bot, T.iceQueen, 3, 'ice queen', 200);
        await iceQueenKill(bot, g, gang);
        if (bot.count(O.gloves) === 0) await pickup(bot, O.gloves, 'ice gloves');
        pray(bot, 'protectfrommelee', false);
        log.split('ice-queen');
    }
    await wieldAll(bot, ['ice_gloves']);
    if (!bot.isWorn(O.gloves)) fail(bot, 'ice gloves not worn');
    // the pickaxe is banned on Entrana (weapon_pickaxe, monk_of_entrana.rs2:40): leave it here
    const picks = bot.inv().filter(s => /pickaxe/.test(objDebugName(s.obj))).map(s => s.obj);
    if (picks.length) await bot.dropAll(picks);
}

async function gangStart(bot: SpeedBot, gang: Gang, log: Log): Promise<void> {
    await clearModals(bot);
    await teleSpell(bot, 'varrock_teleport', 'varrock tele');
    log.split('tele-varrock');
    if (gang === 'blackarm') {
        let asked = false;
        const pick = (opts: string[]) => { const i = opts.findIndex(t => /rank of master thief/i.test(t)); if (i >= 0) asked = true; return i; };
        await converse(bot, N.katrine, T.katrine, pick, () => asked && bot.chatModalId === -1, 'katrine', { maxTicks: 60 });
    } else {
        if (bot.tile().z < 6400) {
            // the ladder room (x3242-3244 z3380-3383) is behind the door at (3241,3382): walk in (walkOp opens it) first
            await go(bot, { x: 3243, z: 3383 }, 0, 'phoenix ladder', 200);
            await opLocUntil(bot, locHere(T.phoenixLadder.id, T.phoenixLadder.x, T.phoenixLadder.z, 0), 1, () => bot.tile().z > 6400, 'phoenix ladder', { stand: { x: 3243, z: 3383 }, maxTicks: 30, every: 5 });
        }
        const seen = textWatch(bot);
        await converse(bot, N.straven, T.straven, () => -1, () => seen(/secret word 'gherkin'/i) && bot.chatModalId === -1, 'straven', { maxTicks: 60 });
    }
    log.split('gang');
}

async function toBrimhaven(bot: SpeedBot, log: Log): Promise<void> {
    await clearModals(bot);
    if (bot.tile().z > 6400) {   // Phoenix basement: Ardougne teleport works from there
    }
    await teleSpell(bot, 'ardougne_teleport', 'ardougne tele');
    log.split('tele-ardougne');
    const c0 = bot.count(O.coins);
    const onShip = () => bot.minusedlevel === 1 && cheb(bot.tile(), { x: 2775, z: 3234 }) <= 6;
    await converse(bot, N.barnaby, T.barnaby, byText(/^Yes please/i), () => onShip() || (bot.count(O.coins) <= c0 - 30 && bot.mainModalId !== -1), 'barnaby', { maxTicks: 60 });
    if (!(await bot.until(onShip, 40))) fail(bot, 'not on the Brimhaven ship');
    await clearModals(bot);
    await opLocUntil(bot, locHere(T.brimPlank.id, T.brimPlank.x, T.brimPlank.z, 1), 1, () => bot.minusedlevel === 0, 'brimhaven plank', { maxTicks: 30, every: 5 });
    log.split('brimhaven');
}

async function armband(bot: SpeedBot, gang: Gang, log: Log): Promise<void> {
    await clearModals(bot);
    if (bot.count(O.armband) > 0) return;
    if (gang === 'blackarm') {
        await converse(bot, N.katrine, T.katrine, byText(/I have a candlestick now/i), () => bot.count(O.armband) > 0, 'katrine armband', { maxTicks: 60 });
    } else {
        if (bot.tile().z < 6400) {
            // the ladder room (x3242-3244 z3380-3383) is behind the door at (3241,3382): walk in (walkOp opens it) first
            await go(bot, { x: 3243, z: 3383 }, 0, 'phoenix ladder', 200);
            await opLocUntil(bot, locHere(T.phoenixLadder.id, T.phoenixLadder.x, T.phoenixLadder.z, 0), 1, () => bot.tile().z > 6400, 'phoenix ladder', { stand: { x: 3243, z: 3383 }, maxTicks: 30, every: 5 });
        }
        await converse(bot, N.straven, T.straven, () => -1, () => bot.count(O.armband) > 0, 'straven armband', { maxTicks: 60 });
    }
    await chat(bot, () => -1, () => bot.chatModalId === -1, 'armband pages', 20).catch(() => undefined);
    log.split('armband');
}

/**
 * session 11 fix 272a HQ_BIRD_SEG (from-zero qx23m 'phoenix firebird: spell kill not done' at (2861,3376): the Entrana Fire
 * Bird (npc slot 2147) was in view, but every OPNPCT fire_blast was DISCARDED by the server for 570 t (6 x ACK-NOACK-CAST-SPELL,
 * no message, death runes 86 -> 86, no move), then the single 600 t castKill ran out, heros is NO_RETRY and both accounts
 * stopped. Same signature as the Ice Queen stall of fix 270 (INFERRED: a stale client npc entry, OpNpcTHandler's silent
 * drops); fork qyn01 (seed 9423) did not reproduce it): the kill in 60 t segments up to HQ_BIRD_TICKS (default 900), each with
 * the strongest blast the runes allow (the bird has 5 hp: any blast kills), and when no cast lands for 20 t with the bird in
 * view: close modals, walk out of view (the Entrana landing, ~50 tiles) and back, which rebuilds the npc list on both sides;
 * 3 fruitless recoveries -> fail (the in-module retry, 272b). HQ_BIRD_SEG=0 reverts to the one 600 t castKill.
 * TEST: HQ_BIRD_STALL_TEST=1 runs one recovery before the first cast.
 */
async function firebirdKill(bot: SpeedBot, g: ReturnType<typeof guard>): Promise<void> {
    const got = () => bot.findGroundItem(O.feather, 14) !== undefined || bot.count(O.feather) > 0;
    failHook('h-firebird');   // TEST mark (session 11 proof): before the first cast
    if (process.env.HQ_BIRD_SEG === '0') {
        await castKill(bot, [N.firebird], 'fire_blast', 'firebird', { done: got, dead: () => g.dead, maxTicks: 600, anchor: T.firebird, range: 6 });   // route runner (fix 102): 200 -> 600 t (chaos qrk1p 'firebird: spell kill not done'; both sides hunt the one firebird, a kill by the other side drops nothing for us and the bird must respawn)
        return;
    }
    const BLASTS: Array<[string, Record<string, number>]> = [['fire_blast', { firerune: 5, airrune: 4, deathrune: 1 }], ['earth_blast', { earthrune: 4, airrune: 3, deathrune: 1 }],
        ['water_blast', { waterrune: 3, airrune: 3, deathrune: 1 }], ['wind_blast', { airrune: 3, deathrune: 1 }]];
    const t0 = bot.tickCount, tEnd = t0 + Number(process.env.HQ_BIRD_TICKS ?? 900);
    let seg = 0, stalls = 0;
    if (process.env.HQ_BIRD_STALL_TEST === '1') await birdResync(bot, 0);
    while (!got() && bot.tickCount < tEnd && !g.dead) {
        const sp = BLASTS.find(([, need]) => Object.entries(need).every(([r, n]) => bot.count(r) >= n));
        if (!sp) fail(bot, `firebird: out of blast runes (${['firerune', 'earthrune', 'waterrune', 'airrune', 'deathrune'].map(r => `${r} ${bot.count(r)}`).join(', ')})`);
        const since = bot.tickCount, d0 = bot.count('deathrune');
        const inView = () => npcsOf(bot, [N.firebird]).length > 0;
        const stalled = () => bot.tickCount - since >= 20 && bot.count('deathrune') === d0 && inView();
        await castKill(bot, [N.firebird], sp[0], 'firebird', { done: () => got() || stalled(), dead: () => g.dead, maxTicks: 60, anchor: T.firebird, range: 6 }).catch(() => undefined);
        seg++;
        const b = npcsOf(bot, [N.firebird])[0];
        console.log(`[hero] firebird seg ${seg} +${bot.tickCount - t0} t: ${sp[0]} casts ${d0 - bot.count('deathrune')}, bird ${b ? `#${b.idx}@${b.x},${b.z} d${b.d}` : 'not in view'}, me ${JSON.stringify(bot.pos())} hp ${bot.stat('hitpoints').cur} death ${bot.count('deathrune')}, feather ${got()}`);
        if (got() || g.dead) break;
        if (inView() && d0 === bot.count('deathrune')) {
            stalls++;
            await birdResync(bot, stalls);
            if (stalls >= 3 && d0 === bot.count('deathrune')) fail(bot, `firebird: casts discarded after ${stalls} recoveries`);
        } else if (d0 !== bot.count('deathrune')) stalls = 0;
    }
    if (g.dead) fail(bot, 'firebird: died');
    if (!got()) fail(bot, `firebird: spell kill not done in ${bot.tickCount - t0} t (${seg} segments)`);
}
/** fix 272a recovery: close modals, out of the bird's view (the landing, ~50 tiles south of its spot) and back */
async function birdResync(bot: SpeedBot, n: number): Promise<void> {
    console.log(`[hero] fix 272 firebird stall #${n}${n === 0 ? ' (HQ_BIRD_STALL_TEST)' : ''}: no cast landed; bird ${npcsOf(bot, [N.firebird]).map(x => `#${x.idx}@${x.x},${x.z} d${x.d}`).join(' ') || '-'}, modal ${bot.chatModalId}/${bot.mainModalId}, msgs ${JSON.stringify(msgsSince(bot, bot.tickCount - 25).slice(-3))}`);
    if (bot.chatModalId !== -1 || bot.mainModalId !== -1) { dismiss(bot); bot.queueFlush(); await bot.tick(1); }
    await go(bot, { x: 2834, z: 3338 }, 2, 'firebird resync away', 150).catch(() => undefined);
    await bot.tick(3);
    console.log(`[hero] fix 272 resync: at ${JSON.stringify(bot.pos())}, bird ${npcsOf(bot, [N.firebird]).map(x => `#${x.idx}@${x.x},${x.z} d${x.d}`).join(' ') || 'out of view'}`);
    await go(bot, T.firebird, 4, 'firebird resync back', 150).catch(() => undefined);
}
/** session 11 fix 272c: on Entrana's ground floor (off the ship) a retry starts at the bird */
const onEntrana = (bot: SpeedBot) => { const t = bot.tile(); return (bot.minusedlevel ?? 0) === 0 && t.x >= 2795 && t.x <= 2880 && t.z >= 3325 && t.z <= 3400; };
async function entrana(bot: SpeedBot, log: Log, g: ReturnType<typeof guard>): Promise<void> {
    await clearModals(bot);
    // session 11 fix 272c HQ_BIRD_RESUME: a retry already on Entrana skips the drop/teleport/ship; one with the feather already
    // held and off the island has nothing left to do here. HQ_BIRD_RESUME=0 reverts.
    if (process.env.HQ_BIRD_RESUME !== '0' && bot.count(O.feather) > 0 && !onEntrana(bot) && (bot.minusedlevel ?? 0) === 0) { console.log(`[hero] entrana: feather held at ${JSON.stringify(bot.pos())}: done`); return; }
    if (process.env.HQ_BIRD_RESUME !== '0' && onEntrana(bot)) {
        console.log(`[hero] entrana: already on the island at ${JSON.stringify(bot.pos())}: resume in place (feather ${bot.count(O.feather) > 0})`);
        if (bot.count(O.feather) === 0) {
            await go(bot, T.firebird, 4, 'firebird', 300);
            await firebirdKill(bot, g);
            if (bot.count(O.feather) === 0) await pickup(bot, O.feather, 'hot feather', { radius: 14 });
        }
        log.split('feather');
        return entranaBack(bot, log);
    }
    // Entrana bans weapons and armour in the pack too (monk_of_entrana.rs2:26-53): drop the black armour (worn or held)
    const worn = BLACK.filter(b => bot.isWorn(objId(b)));
    if (worn.length) { bot.burst(worn.map(b => () => bot.unequipItem(objId(b)))); await bot.until(() => worn.every(b => !bot.isWorn(objId(b))), 6); }
    const held = BLACK.filter(b => bot.count(b) > 0).map(b => objId(b));
    held.push(...bot.inv().filter(x => /pickaxe/.test(objDebugName(x.obj))).map(x => x.obj));   // weapon_pickaxe is banned too
    if (held.length) await bot.dropAll([...new Set(held)]);
    // session 11 fix 313 TEST (HQ_GLORY_TEST=1): in the Ice Queen lair wait (<= 60 t) until an npc stands next to us swinging
    // (lockAttackers) before the rub, = qx69p's state (sp-lib glory 313b SR_GLORY_HIT handles the rub; =0 is the control).
    if (process.env.HQ_GLORY_TEST === '1' && inIceLair(bot)) {
        const tw = bot.tickCount; await bot.until(() => lockAttackers(bot).length > 0, 60);
        console.log(`[hero] 313 TEST: rub with swingers ${lockAttackers(bot).map(a => `${a.type}@${a.x},${a.z}`).join(' ') || 'none'} after ${bot.tickCount - tw} t, hp ${bot.stat('hitpoints').cur}`);
    }
    await glory(bot, 3, 'glory draynor');
    log.split('tele-draynor');
    const onShip = () => bot.minusedlevel === 1 && cheb(bot.tile(), { x: 2834, z: 3331 }) <= 6;
    await converse(bot, N.shipmonk, T.monks, byText(/I'm ready to go/i), () => onShip(), 'entrana monk', { maxTicks: 80 });
    await clearModals(bot);
    await opLocUntil(bot, locHere(T.entranaPlank.id, T.entranaPlank.x, T.entranaPlank.z, 1), 1, () => bot.minusedlevel === 0, 'entrana plank', { maxTicks: 30, every: 5 });
    log.split('entrana');
    await go(bot, T.firebird, 4, 'firebird', 300);
    await firebirdKill(bot, g);   // fix 272a (was one 600 t castKill, fix 102)
    if (bot.count(O.feather) === 0) await pickup(bot, O.feather, 'hot feather', { radius: 14 });
    log.split('feather');
    await entranaBack(bot, log);
}
async function entranaBack(bot: SpeedBot, log: Log): Promise<void> {
    const back = () => bot.minusedlevel === 1 && cheb(bot.tile(), { x: 3048, z: 3231 }) <= 6;
    await converse(bot, N.shipmonk2, { x: 2835, z: 3336 }, byText(/I'm ready to go/i), back, 'entrana monk back', { maxTicks: 80 });
    await clearModals(bot);
    await opLocUntil(bot, locHere(T.sarimPlank.id, T.sarimPlank.x, T.sarimPlank.z, 1), 1, () => bot.minusedlevel === 0, 'sarim plank', { maxTicks: 30, every: 5 });
    log.split('port-sarim');
}

async function gerrant(bot: SpeedBot, log: Log): Promise<void> {
    await clearModals(bot);
    if (bot.count(O.eel) > 0 || bot.count(O.oilyRod) > 0) return;
    if (cheb(bot.tile(), T.gerrant) > 60 || bot.tile().z > 6400) { await glory(bot, 3, 'glory draynor (gerrant)'); log.split('tele-draynor-g'); }
    // fix 182 (allchaos qt21hm 'phoenix gerrant: chat not done' with free=0: Gerrant's slime needs a free slot,
    // gerrant.rs2:20-35): make one by eating a shark (else a herring / any food). HQ_GERRANT_SLOT=0 reverts.
    if (process.env.HQ_GERRANT_SLOT !== '0' && bot.free() === 0 && bot.count(O.slime) === 0 && bot.count(O.oil) === 0) {
        const food = ['shark', 'swordfish', 'lobster', 'herring', 'trout', 'salmon'].map(n => objId(n)).find(id => bot.count(id) > 0);
        for (let k = 0; k < 3 && food !== undefined && bot.free() === 0; k++) { bot.opHeld1(food, bot.slot(food)); bot.queueFlush(); await bot.until(() => bot.free() > 0, 4); }
        console.log(`[heros] gerrant: pack was full, freed a slot: ${bot.free() > 0}`);
    }
    if (bot.count(O.oilyRod) === 0 && bot.count(O.oil) === 0 && bot.count(O.slime) === 0) {
        await converse(bot, N.gerrant, T.gerrant, byText(/catch a lava eel/i), () => bot.count(O.slime) > 0, 'gerrant', { maxTicks: 60 });
        await clearModals(bot);
    }
    if (bot.count(O.oilyRod) === 0 && bot.count(O.oil) === 0) {
        useItemOnItem(bot, O.slime, O.harra);
        if (!(await untilChat(bot, () => bot.count(O.oil) > 0, 8))) fail(bot, 'no blamish oil');
    }
    if (bot.count(O.oilyRod) === 0) {
        useItemOnItem(bot, O.oil, O.rod);
        if (!(await untilChat(bot, () => bot.count(O.oilyRod) > 0, 8))) fail(bot, 'no oily rod');
    }
    // the empty vials take slots the dusty key / eel need later (sim sphc10: full pack, Velrak's key never arrived)
    const vial = objId('vial_empty'); if (bot.count(vial) > 0) await bot.dropAll([vial]);
    log.split('oily-rod');
}

/**
 * Lava eel. The lava spot (2890,9767) is in the Taverley deep dungeon, behind the dusty-key gate (deepdungeondoor
 * 2924,9803; probe-region: its other exits are an island ladder at the Obelisk of Water and the Scorpion Catcher secret
 * room). Dusty key (tradeable=no): kill the Jailer (drop tables/scripts/jailer.rs2: jail_key always, 100 t on the
 * ground), open Velrak's cell with it (area_taverly/dungeon/scripts/jail_doors.rs2:1-35), Velrak gives it
 * (velrak_the_explorer.rs2:8-18). All these doors are open_and_close_door2: used from the exact tiles below.
 */
async function eel(bot: SpeedBot, log: Log, g: ReturnType<typeof guard>): Promise<void> {
    await clearModals(bot);
    if (bot.count(O.eel) > 0) return;
    const DUSTY = objId('dusty_key'), JAILKEY = objId('jail_key');
    // the deep dungeon and the entrance area interleave as boxes: track the gate crossing instead of guessing from the tile
    let deep = false;
    const inDeep = () => deep;
    if (bot.tile().z < 6400) {
        await teleSpell(bot, 'falador_teleport', 'falador tele');
        log.split('tele-falador');
        await go(bot, { x: 2884, z: 3398 }, 1, 'taverley ladder', 400);
        await opLocUntil(bot, locHere(T.taverleyLadder.id, T.taverleyLadder.x, T.taverleyLadder.z, 0), 1, () => bot.tile().z > 6400, 'taverley ladder', { maxTicks: 30, every: 5 });
        log.split('taverley');
    }
    pray(bot, 'protectfrommelee', true);
    if (bot.count(DUSTY) === 0 && !inDeep()) {
        const JAILER = npcIdOf('jailer'), VELRAK = npcIdOf('velrak_the_explorer');
        if (bot.count(JAILKEY) === 0) {
            await go(bot, { x: 2933, z: 9695 }, 3, 'jailer', 500);
            await castKill(bot, [JAILER], 'fire_blast', 'jailer', { done: () => bot.findGroundItem(JAILKEY, 12) !== undefined || bot.count(JAILKEY) > 0, dead: () => g.dead, maxTicks: 200, anchor: { x: 2933, z: 9695 } });
            if (bot.count(JAILKEY) === 0) await pickup(bot, JAILKEY, 'jail key');
            log.split('jail-key');
        }
        const inCell = () => bot.tile().z <= 9689 && bot.tile().z >= 9683 && Math.abs(bot.tile().x - 2931) <= 3;
        await doorFrom(bot, { id: 2631, x: 2931, z: 9690 }, { x: 2931, z: 9690 }, inCell, 'jail door', JAILKEY);
        if (bot.free() < 1) { const sh = objId('shark'); if (bot.count(sh) > 0) { bot.dropItem(sh, bot.slot(sh)); bot.queueFlush(); await bot.tick(1); } }   // room for the key
        let yes = false;
        // session 9 (allchaos qu06p: 'velrak: chat not done (options [])' right after the jailer kill, one shot, the pair then
        // aborted Hero's for both): up to 4 talks, every blocking page (the kill's level-ups) paged first. HQ_VELRAK_RETRY=0 reverts.
        const velrakTalk = () => converse(bot, VELRAK, { x: 2931, z: 9685 }, (o) => {
            const a = o.findIndex(t => /^Yes please/i.test(t)); if (a >= 0) { yes = true; return a; }
            return o.findIndex(t => /anywhere good to explore/i.test(t));
        }, () => (yes || process.env.HQ_VELRAK_RETRY !== '0') && bot.count(DUSTY) > 0, 'velrak', { maxTicks: 40 });
        if (process.env.HQ_VELRAK_RETRY === '0') await velrakTalk();
        else for (let k = 0; bot.count(DUSTY) === 0; k++) {
            for (let i = 0; i < 10 && bot.blockingPageOpen(); i++) { bot.resumeDialogPage(); bot.queueFlush(); await bot.tick(1); }
            try { await velrakTalk(); }
            catch (e) { if (k >= 3) throw e; console.log(`[hero] velrak talk ${k + 1}: ${(e as Error).message.slice(0, 100)} | chat ${bot.chatModalId} hp ${bot.stat('hitpoints').cur}: again`); await clearModals(bot); }
        }
        await untilChat(bot, () => bot.chatModalId === -1, 6);
        log.split('dusty-key');
        await doorFrom(bot, { id: 2631, x: 2931, z: 9690 }, { x: 2931, z: 9689 }, () => bot.tile().z >= 9690, 'jail door out');
    }
    if (!inDeep()) {
        await go(bot, { x: 2924, z: 9803 }, 0, 'deep gate', 400);
        await doorFrom(bot, { id: 2623, x: 2924, z: 9803 }, { x: 2924, z: 9803 }, () => bot.tile().x <= 2923 && bot.tile().z > 6400, 'deep gate', DUSTY);
        deep = true;
        log.split('deep-gate');
    }
    await go(bot, T.lavaStand, 1, 'lava', 300);
    log.split('lava');
    // the eel needs a free slot ("You can't carry any more eels", lavafish.rs2:101-105): with the early Black Arm order the
    // pack was full (black armour, keys, pickaxe; sims sph c2/c3). Drop the used jail key and the empty vials.
    const junk = [JAILKEY, objId('vial_empty')].filter(i => bot.count(i) > 0);
    if (junk.length) await bot.dropAll(junk);
    if (bot.free() < 1) { const sh = objId('shark'); if (bot.count(sh) > 0) { bot.dropItem(sh, bot.slot(sh)); bot.queueFlush(); await bot.tick(1); } }
    let last = -100; const t0 = bot.tickCount;
    // session 11 fix 405a (qx479m 'no eel' at 2891,9767: 346 t at the lava, 40 fire blasts at baby blue dragons, bait never used,
    // then the 300 t cap; heros is NO_RETRY -> ROUTE STOPPED qp 95; r-qx305-484 eels: median 37 t, max 247): 600 t.
    // HQ_EEL405=0 reverts; HQ_EEL405_TEST=1 logs each dragon round.
    const EEL405 = process.env.HQ_EEL405 !== '0', EEL405_TEST = process.env.HQ_EEL405_TEST === '1';
    while (bot.count(O.rawEel) === 0 && !g.dead) {
        // baby blue dragons attack at the spot and every hit restarts the 5-tick fishing roll (lavafish.rs2:46-67): in
        // sims sph(c1,c2) the bait was never used with one standing next to us. Kill any within 3 tiles first.
        const bb = npcsOf(bot, [52]).filter(q => q.d <= 3);
        if (bb.length) {
            if (EEL405_TEST) console.log(`[hero] 405a TEST eel +${bot.tickCount - t0}: dragons ${bb.map(q => `${q.x},${q.z} d${q.d}`).join(' ')}, death ${bot.count('deathrune')}`);
            await castKill(bot, [52], 'fire_blast', 'baby blue dragon', { done: () => !npcsOf(bot, [52]).some(q => q.d <= 3), dead: () => g.dead, maxTicks: 120, range: 6 }).catch(() => undefined);
            await go(bot, T.lavaStand, 1, 'lava', 60).catch(() => undefined); last = -100; continue;
        }
        if (bot.tickCount - last >= 8) {
            const f = npc(bot, N.lavafish); if (!f) fail(bot, 'no lava fishing spot');
            bot.closeModal();   // clear any server-side suspended dialog (see sp-lib castKill; sim sphc1: bait never used)
            const { opNpcReach } = await import('./sp-lib.js');
            opNpcReach(bot, f, 1); last = bot.tickCount;
        }
        await bot.tick(1);
        if (bot.tickCount - t0 > (EEL405 ? 600 : 300)) fail(bot, 'no eel');   // session 11 fix 405a
    }
    log.split('raw-eel');
    pray(bot, 'protectfrommelee', false);
    // cook outside: baby blue dragons attack at the lava and prayer is empty by now (sim sph5: the fire never lit there).
    // Falador teleport (we teleport out anyway), light the log at the landing, cook, then walk to the guild.
    await teleSpell(bot, 'falador_teleport', 'falador tele (eel)');
    log.split('tele-falador-eel');
    for (let k = 0; k < 4 && bot.count(O.eel) === 0; k++) {
        if (bot.chatModalId !== -1) dismiss(bot);
        const fireAt = bot.tile(); const since = bot.tickCount;
        useItemOnItem(bot, O.tinderbox, O.logs);
        const logs0 = bot.count(O.logs);
        // a fire is a live loc named "Fire" on or next to the tile we lit on (sim sphc7: the exact-tile check missed it)
        const findFire = () => { for (const [k, id] of bot.liveLocs) { const [l, x, z] = k.split(',').map(Number); if (l === bot.minusedlevel && Math.abs(x! - fireAt.x) <= 1 && Math.abs(z! - fireAt.z) <= 1 && /^fire$/i.test(ls.locName(id))) return { x: x!, z: z!, id }; } return null; };
        const lit = await bot.until(() => bot.count(O.logs) < logs0 && findFire() !== null, 20);
        if (!lit) {
            console.log(`[hero] fire not lit at (${fireAt.x},${fireAt.z}): ${msgsSince(bot, since).slice(-3).join(' | ')}`);
            if (process.env.HQ_EEL_FIRE !== '0') {
                // session 11 fix 367 (HQ_EEL_FIRE; qx198m/qx199m 'phoenix eel not cooked at (2967,3376)'): the first log caught
                // after the 20 t wait and the only recovery step was x+1 = (2968,3376), a diagonal fence (loc 980 shape 9,
                // m46_52) -> never moved, and 3 more tinderbox uses got "You can't light a fire here." (firemaking.rs2:88-90:
                // a loc on our tile) while a fire may already burn there. Cook on any fire within 1 tile first; else step to
                // the first walkable neighbour (E, W, N, S, then the landing centre) and relight there. =0 reverts.
                if (findFire() === null && bot.count(O.logs) > 0) {
                    const here = bot.tile();
                    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1], [2965 - here.x, 3378 - here.z]] as Array<[number, number]>) {
                        if (dx === 0 && dz === 0) continue;
                        const r = await bot.stepTo(here.x + dx, here.z + dz, 6).catch(() => undefined);
                        if (r?.ok) break;
                    }
                    continue;
                }
                if (findFire() === null) continue;   // no logs and no fire: the loop ends -> 'eel not cooked'
            } else if (bot.count(O.logs) > 0) { await bot.stepTo(fireAt.x + 1, fireAt.z, 6).catch(() => undefined); continue; }
        }
        const fire = findFire();
        if (!fire) continue;
        const fireId = fire.id; fireAt.x = fire.x; fireAt.z = fire.z;
        for (let j = 0; j < 3 && bot.count(O.eel) === 0; j++) {
            if (bot.chatModalId !== -1) dismiss(bot);
            bot.useItemOnLoc(fireAt.x, fireAt.z, fireId, O.rawEel, bot.slot(O.rawEel)); bot.queueFlush();
            await untilChat(bot, () => bot.count(O.eel) > 0, 10);
        }
    }
    if (bot.count(O.eel) === 0) fail(bot, 'eel not cooked');
    log.split('eel');
}

async function finish(bot: SpeedBot, log: Log): Promise<boolean> {
    await clearModals(bot);
    if (bot.tile().z > 6400 || cheb(bot.tile(), T.achietties) > 150) await teleSpell(bot, 'falador_teleport', 'falador tele 2');
    const seen = textWatch(bot);
    const done = () => seen(/completed the Heroes Quest/i) || bot.mainModalId === 297 || seen(/Quest complete/i);
    await converse(bot, N.achietties, T.achietties, () => -1, () => done() || bot.count(O.feather) === 0, 'achietties finish', { maxTicks: 80 });
    await bot.until(done, 20);
    log.split('finish');
    return done();
}

// ---- the pair phase (Brimhaven) ------------------------------------------------------------------------------------------
async function pairPhoenix(bot: SpeedBot, pair: Pair, log: Log, g: ReturnType<typeof guard>, helper = false): Promise<void> {
    await clearModals(bot);
    // kitchen door 2788,3189 a1 (north edge): from the restaurant side stand next to it -> onto the door tile -> again -> through
    const inKitchen = () => bot.tile().z >= 3190 && bot.tile().x >= 2787 && bot.tile().x <= 2799;
    if (helper) {
        // helper (a Phoenix member that FINISHED Hero's serves a Black Arm member): the kitchen door (>= talked_alfonse
        // & phoenixgang complete, brimhaven_restaurant.rs2:1-5), the panel (>= talked_charlie :8-12) and Grip's attack check
        // (>= talked_charlie & phoenixgang complete, grip.rs2 grip_attack) all pass at %heroquest 15: no Alfonse, no Charlie
        await doorFrom(bot, T.kitchenDoor, { x: 2788, z: 3189 }, inKitchen, 'kitchen door (helper)');
        log.split('helper-kitchen');
    } else {
    // Alfonse: "Do you sell Gherkins?" (-> 3), then the kitchen door (opens at >= 3 for Phoenix members) and Charlie (-> 4)
    let gherkin = false;
    await converse(bot, N.alfonse, T.alfonse, (o) => { const i = o.findIndex(t => /sell Gherkins/i.test(t)); if (i >= 0) gherkin = true; return i; }, () => gherkin && bot.chatModalId === -1, 'alfonse');
    log.split('alfonse');
    await doorFrom(bot, T.kitchenDoor, { x: 2788, z: 3189 }, inKitchen, 'kitchen door');
    let candles = false;
    await converse(bot, N.charlie, T.charlie, (o) => {
        const i = o.findIndex(t => /steal Scarface Pete's candlesticks/i.test(t)); if (i >= 0) { candles = true; return i; }
        return o.findIndex(t => /looking for a gherkin/i.test(t));
    }, () => candles && bot.chatModalId === -1, 'charlie', { maxTicks: 60 });
    log.split('charlie');
    }
    pair.set('p-charlie');
    // the misc_key from the Black Arm member, traded outside Garv's door
    if (bot.count(O.miscKey) === 0) {
        await doorFrom(bot, T.kitchenDoor, { x: 2788, z: 3190 }, () => bot.tile().z <= 3189, 'kitchen door out');
        await go(bot, T.meet, 1, 'meet', 200);
        pair.set('p-at-meet');
        await bot.until(() => bot.count(O.miscKey) > 0 || pair.has('abort'), 600);
        if (bot.count(O.miscKey) === 0) fail(bot, 'no misc_key from the partner');
        log.split('misc-key');
        await go(bot, { x: 2788, z: 3188 }, 1, 'kitchen', 200);
        await doorFrom(bot, T.kitchenDoor, { x: 2788, z: 3189 }, inKitchen, 'kitchen door 2');
    }
    // secret panel 2787,3190 a0 (west edge; opens at >= 4): from the kitchen ON the panel tile -> garden
    const inGarden = () => bot.tile().x <= 2786 && bot.tile().z >= 3188 && bot.tile().z <= 3199;
    await doorFrom(bot, T.panel, { x: 2787, z: 3190 }, inGarden, 'panel');
    // side door 2781,3197 a3 with the misc_key from the garden tile (2781,3196) -> onto the door tile = the side room
    const inSide = () => bot.tile().z >= 3197 && bot.tile().x >= 2780 && bot.tile().x <= 2782;
    await doorFrom(bot, T.sideDoor, { x: 2781, z: 3196 }, inSide, 'side door', O.miscKey);
    log.split('side-room');
    pair.set('p-ready');
    // Grip walks to (2777,3198) when the partner opens his drinks cabinet; hit him with spells through the side room wall
    await bot.stepTo(2780, 3198, 10).catch(() => undefined);   // the side-room tile nearest Grip's summon tile (2777,3198)
    await pair.wait(bot, 'b-cabinet', 600, 'cabinet');
    // the only line of fire is the arrow slit in the snipable wall on the WEST edge of (2780,3198) (probe-find): stand ON
    // (2780,3198) and cast only while Grip stands in that row (z 3198). A cast at Grip elsewhere makes the engine walk us
    // toward him, off the slit tile, and every later cast is dropped silently (SP_CASTLOG sim sph16).
    {
        const com = (await import('../../../core.js')).spellCom('fire_blast');
        const t0 = bot.tickCount; let last = -100;
        const dead = () => pair.has('grip-dead') || (pair.has('b-cabinet') && !npcsOf(bot, [N.grip]).length && bot.findGroundItem(O.gripKeys, 14) !== undefined);
        while (!dead() && bot.tickCount - t0 < 400 && !g.dead) {
            if (bot.tile().x !== 2780 || bot.tile().z !== 3198) await bot.stepTo(2780, 3198, 6).catch(() => undefined);
            const gr = npcsOf(bot, [N.grip])[0];
            if (gr && gr.z === 3198 && gr.x >= 2774 && gr.x <= 2779 && bot.tickCount - last >= 3) {
                bot.opNpcT(gr.idx, com); bot.queueFlush(); last = bot.tickCount;
            }
            await bot.tick(1);
        }
        if (!dead()) fail(bot, 'grip not killed from the side room');
    }
    pair.set('grip-dead');
    log.split('grip');
}

async function pairBlackArm(bot: SpeedBot, pair: Pair, log: Log, helper = false, side = false): Promise<void> {
    await clearModals(bot);
    // helper (a Black Arm member that FINISHED Hero's serves a Phoenix member): Garv's door opens at >= mansion_unlocked
    // & blackarmgang complete (brimhaven_scarface_mansion.rs2:1-7), Grip skips the papers at >= id_papers_given and hands the
    // misc_key while the account owns none (grip.rs2:1-17, :48-56), the treasure door needs >= id_papers_given (:61-72) and the
    // chest gives 2 candlesticks while the account owns none (:79-93; Katrine took its own, katrine.rs2:142): no Grubor, Trobert,
    // black armour or Garv talk at %heroquest 15 (Garv's talk would not say 'Grip will want to talk to you', garv.rs2:7-10)
    // Grubor's door (2811,3170 a0 = west edge: the HQ is EAST, x>=2811 (probe-rooms.ts); outside tile (2810,3170)). Before the
    // password the op talks to Grubor through it (grubor.rs2:5-35): "Four leaved clover" -> 8; then the op opens it.
    const inHq = () => (bot.tile().x >= 2811 && bot.tile().x <= 2815 && bot.tile().z >= 3167 && bot.tile().z <= 3178)
        || (bot.tile().x >= 2805 && bot.tile().x <= 2810 && bot.tile().z >= 3171 && bot.tile().z <= 3178);
    if (!helper && bot.count(O.papers) === 0) {
        await go(bot, { x: 2810, z: 3170 }, 0, 'grubor door', 300);
        let pw = false;
        const door = locHere(T.gruborDoor.id, T.gruborDoor.x, T.gruborDoor.z, 0);
        for (let k = 0; k < 6 && !inHq(); k++) {
            if (bot.tile().x !== 2810 || bot.tile().z !== 3170) await bot.stepTo(2810, 3170, 20);
            bot.opLoc(door.x, door.z, door.id, 1); bot.queueFlush();
            await bot.until(() => inHq() || inDialog(bot), 8);
            if (inDialog(bot)) await chat(bot, (o) => { const i = o.findIndex(t => /Four leaved clover/i.test(t)); if (i >= 0) pw = true; return i; }, () => pw && bot.chatModalId === -1, 'grubor', 30).catch(() => undefined);
        }
        if (!inHq()) fail(bot, 'not into the Black Arm hideout');
        log.split('grubor');
        let vol = false;
        await converse(bot, N.trobert, T.trobert, (o) => {
            const i = o.findIndex(t => /I volunteer/i.test(t)); if (i >= 0) { vol = true; return i; }
            return o.findIndex(t => /help me get Scarface Pete's candlesticks/i.test(t));
        }, () => vol && bot.count(O.papers) > 0 && bot.chatModalId === -1, 'trobert', { maxTicks: 60 });
        log.split('trobert');
        await go(bot, { x: 2811, z: 3170 }, 0, 'grubor door (inside)', 100);
        await doorFrom(bot, T.gruborDoor, { x: 2811, z: 3170 }, () => !inHq(), 'grubor door out');
    }
    const inMansion = () => bot.tile().z >= 3188 && bot.tile().x >= 2759 && bot.tile().x <= 2781;
    if (!helper) {
    await wieldAll(bot, BLACK);
    if (!BLACK.every(b => bot.isWorn(objId(b)))) fail(bot, 'black armour not worn');
    // Garv (unlock_brimhaven_mansion, garv.rs2:39-57): talk to him with the papers + black armour -> 10; then the door
    const seen = textWatch(bot);
    await converse(bot, N.garv, { x: 2776, z: 3186 }, () => -1, () => seen(/Grip will want to talk to you/i) && bot.chatModalId === -1, 'garv', { maxTicks: 40 });
    }
    await doorFrom(bot, T.garvDoor, { x: 2774, z: 3187 }, inMansion, 'garv door');
    log.split('garv');
    // Grip: papers (-> 11), "So what do my duties involve?", then "Anything I can do now?" -> misc_key
    await converse(bot, N.grip, T.grip, (o) => {
        const a = o.findIndex(t => /Anything I can do now/i.test(t)); if (a >= 0) return a;
        return o.findIndex(t => /what do my duties involve/i.test(t));
    }, () => bot.count(O.miscKey) > 0 && bot.chatModalId === -1, 'grip', { maxTicks: 60 });
    await chat(bot, () => -1, () => bot.chatModalId === -1, 'grip pages', 10).catch(() => undefined);
    log.split('grip-papers');
    // the key to the Phoenix member outside (Garv's door from the inside: next to it -> onto the door tile = outside)
    await doorFrom(bot, T.garvDoor, { x: 2774, z: 3188 }, () => bot.tile().z <= 3187, 'garv door out');
    // F2: a Phoenix member that already owns a misc_key (a helper that kept its own, or a resumed side) goes straight to the
    // side door and never comes to the meet: no trade then
    const pHas = () => !!side && (pair.bots.phoenix?.count(O.miscKey) ?? 0) > 0 && !pair.has('p-at-meet');
    if (side) { if (!(await bot.until(() => pair.has('p-at-meet') || pHas() || pair.has('abort'), 600)) || pair.has('abort')) fail(bot, "phoenix at the meet tile: partner never reached 'p-at-meet'"); }
    else await pair.wait(bot, 'p-at-meet', 600, 'phoenix at the meet tile');
    if (pHas()) log.split('key-not-needed');
    else { await tradeOne(bot, pair.bots.phoenix!, O.miscKey, 1, 'misc_key'); log.split('key-traded'); }
    await doorFrom(bot, T.garvDoor, { x: 2774, z: 3187 }, inMansion, 'garv door 2');
    await pair.wait(bot, 'p-ready', 600, 'phoenix in the side room');
    // drinks cabinet (2775,3196 1x2): a pirate guard within 4 tiles asks; "He won't notice..." sends Grip to (2777,3198)
    let lured = 0;
    while (!pair.has('grip-dead') && lured < 6) {
        const cb = locHere(T.cabinet.id, T.cabinet.x, T.cabinet.z, 0);
        const live = bot.liveLocs.get(`0,${cb.x},${cb.z}`);
        const loc = live === 2636 ? { ...cb, id: 2636 } : cb;
        let asked = false;
        // inner doors can be shut (chaos seed 4404: the door at 2777,3195 kept us from the cabinet): walk (door-aware) to
        // its south tile (2775,3195) first
        // the cabinet is only reachable from its NORTH tile (2775,3197) (probe-op: "I can't reach that!" from the south), and
        // the summon needs a pirate guard within 4 tiles of US (brimhaven_scarface_mansion.rs2:18); guards wander (chaos
        // 4505/4606: none in range). Walk there door-aware (inner doors can be shut, chaos 4404) and wait for a guard.
        const st = { x: 2775, z: 3197 };
        await go(bot, st, 0, 'cabinet', 100).catch(() => undefined);
        await bot.until(() => npcsOf(bot, [799]).some(q => cheb(q, st) <= 3), 60);
        await opLocUntil(bot, loc, 1, () => inDialog(bot), 'cabinet', { stand: st, maxTicks: 30, every: 5 }).catch(() => undefined);
        if (inDialog(bot)) await chat(bot, (o) => { const i = o.findIndex(t => /won't notice me/i.test(t)); if (i >= 0) asked = true; return i; }, () => asked && bot.chatModalId === -1, 'cabinet chat', 20).catch(() => undefined);
        lured++;
        pair.set('b-cabinet');
        await bot.until(() => pair.has('grip-dead'), 40);
    }
    if (!pair.has('grip-dead')) fail(bot, 'Grip not killed');
    // F2 (sim h3c: a resumed side held its kit + kept quest items, 0 free: 'grip_keys not picked up'): keys + 2 candlesticks
    // need 3 slots: eat sharks (keep 2) first
    if (side) for (let k = 0; k < 6 && bot.free() < 3 && bot.count('shark') > 2; k++) { const sl = bot.slot('shark'); bot.opHeld1(objId('shark'), sl); bot.queueFlush(); await bot.tick(2); }
    await pickup(bot, O.gripKeys, 'grip keys', { radius: 14, maxTicks: 40 });
    log.split('grip-keys');
    // treasure door 2764,3197 a0 from the hall side (2763,3197) with Grip's keys -> onto the door tile = the treasure room
    const inTreasure = () => bot.tile().x >= 2764 && bot.tile().x <= 2772 && bot.tile().z >= 3196;
    await go(bot, { x: 2763, z: 3197 }, 0, 'treasure door', 100);
    await doorFrom(bot, T.treasureDoor, { x: 2763, z: 3197 }, inTreasure, 'treasure door', O.gripKeys);
    for (let k = 0; k < 6 && bot.count(O.candle) < 2; k++) {
        const live = bot.liveLocs.get(`0,${T.chest.x},${T.chest.z}`);
        const loc = { ...locHere(T.chest.id, T.chest.x, T.chest.z, 0), id: live === 2633 ? 2633 : 2632 };
        await opLocUntil(bot, loc, 1, () => bot.count(O.candle) >= 2 || bot.chatModalId !== -1 || (loc.id === 2632 && bot.liveLocs.get(`0,${T.chest.x},${T.chest.z}`) === 2633), 'candle chest', { maxTicks: 12, every: 4 }).catch(() => undefined);
        if (bot.chatModalId !== -1) await untilChat(bot, () => bot.count(O.candle) >= 2, 6);
    }
    if (bot.count(O.candle) < 2) fail(bot, `candlesticks ${bot.count(O.candle)}/2`);
    await clearModals(bot);
    log.split('candlesticks');
    pair.set('b-candles');
}

/** Varrock square: the Black Arm member hands one candlestick to the Phoenix member. */
async function candleHandoff(p: SpeedBot, b: SpeedBot, pair: Pair): Promise<void> {
    const meet = { x: 3212, z: 3426 };
    await Promise.all([go(p, meet, 2, 'varrock meet', 200), go(b, meet, 2, 'varrock meet', 200)]);
    await tradeOne(b, p, O.candle, 1, 'candlestick');
    pair.set('candle-traded');
}

// ---- runners -------------------------------------------------------------------------------------------------------------
export interface HeroResult { ok: boolean; ticks: number; msg: string }
/** What one side runs (only legs/qp/route/existing-lib.ts passes this; a from-zero run never does).
 *  skip = nothing (the side is complete and not needed); only = this side's own remaining phases (in ORDER, 'finish' always
 *  runs after them); helper = first serve the OTHER side's pair phase (Brimhaven; at %heroquest >= the gates, see pairPhoenix /
 *  pairBlackArm), then the own remaining phases, if any (a complete side has none: no hand-in). */
export interface SideOpt { skip?: boolean; only?: Phase[]; helper?: boolean; pairFast?: boolean }
// pairFast (F2 per-side resume from the journal): this side's OWN pair phase starts past the talks it already did (Phoenix at
// >= talked_charlie: no Alfonse/Charlie; Black Arm at >= id_papers_given: no Grubor/Trobert/Garv), i.e. the helper's route
/** F2 (sim h3d: a resumed Black Arm side held kit + kept quest items + the spare candlestick, 0 free: 'ice_gloves not picked
 *  up'): before each phase of an F2 side keep `n` slots free: drop what no later phase needs (the spare candlestick, black
 *  armour, the mansion keys/papers once the armband is held), then eat sharks down to 3. */
async function roomF2(bot: SpeedBot, n: number): Promise<void> {
    if (bot.free() >= n) return;
    const band = bot.count(O.armband) > 0;
    const junk = [O.gripKeys, ...(band ? [O.candle, O.miscKey, O.papers, ...BLACK.map(b => objId(b))] : [])];
    for (const j of junk) {
        for (let k = 0; k < 3 && bot.free() < n && bot.count(j) > 0; k++) { bot.dropItem(j, bot.slot(j)); bot.queueFlush(); await bot.tick(1); }
    }
    for (let k = 0; k < 6 && bot.free() < n && bot.count('shark') > 3; k++) { bot.opHeld1(objId('shark'), bot.slot('shark')); bot.queueFlush(); await bot.tick(2); }
    if (bot.free() < n) console.log(`[hero] ${bot.loginUser}: only ${bot.free()} free slot(s) before the next phase`);
}
/** a side's phases in run order (the per-side resume in existing-lib.ts infers which are done) */
export const sidePhases = (gang: Gang): readonly Phase[] => ORDER[gang];
/** One account's run up to (and after) the Brimhaven pair phase. `partner` work is coordinated through `pair`. */
async function runOne(bot: SpeedBot, gang: Gang, pair: Pair, o: { log?: boolean; from?: Phase; side?: SideOpt; onPhase?: (gang: Gang, ph: Phase) => void }): Promise<HeroResult> {
    const side = o.side;
    if (side?.skip) return { ok: true, ticks: 0, msg: `${gang}: nothing to do (side skip)` };
    await nav();
    bot.holdDialogs = true;
    const log = mkLog(bot, gang === 'phoenix' ? 'hP' : 'hB', o.log !== false);
    const t0 = bot.tickCount;
    const g = guard(bot, 0.5);
    startWarningCloser(bot); textLog(bot); spTrace(bot, gang === 'phoenix' ? 'P' : 'B'); retaliateOff(bot);
    const order = ORDER[gang];
    const fromI = o.from ? Math.max(0, order.indexOf(o.from === 'icequeen' && gang === 'blackarm' ? 'icequeen2' : o.from)) : 0;
    let todo: Phase[] = order.slice(fromI);
    let helperLeft = false, handIn = true;
    if (side && (side.only || side.helper)) {
        const own = order.filter(p => p !== 'finish' && (side.only ?? []).includes(p));
        helperLeft = !!side.helper;
        todo = side.helper ? ['brim', 'pair', ...own.filter(p => p !== 'brim' && p !== 'pair')] : own;
        handIn = !side.helper || own.length > 0;
        console.log(`[hero] ${gang} ${bot.loginUser}: side ${side.helper ? 'HELPER + ' : ''}phases [${todo.join(',')}]${handIn ? ' + finish' : ' (no hand-in)'}`);
    }
    try {
        for (const ph of todo) {
            if (ph === 'finish') break;
            const asHelper = helperLeft && (ph === 'brim' || ph === 'pair');
            if (side) await roomF2(bot, 2);
            if (ph === 'pair') helperLeft = false;
            const fastPair = asHelper || (ph === 'pair' && !!side?.pairFast);
            if (ph === 'start') await start(bot, log);
            else if (ph === 'icequeen' || ph === 'icequeen2') {
                // session 11 fix 259b (qx04p: one failed Ice Queen fight ended the Black Arm side and the partner's route,
                // heros is NO_RETRY): the ice phase retries in-module up to HQ_ICE_RETRIES (default 2) times, unless dead.
                // The retry fights in place when still in the lair (259c), walks on from the mountain, else teleports again
                // (the Black Arm kit carries +2 law). HQ_ICE_RETRIES=0 = the old single attempt.
                const tries = 1 + Number(process.env.HQ_ICE_RETRIES ?? 2);
                for (let k = 0; ; k++) {
                    try {
                        const t = bot.tile();
                        const nearMtn = inIceLair(bot) || (t.z < 6400 && cheb(t, { x: 2838, z: 3517 }) <= 40) || (t.z > 9880 && t.z < 9970 && t.x >= 2800 && t.x <= 2880);
                        if (ph === 'icequeen2' && !(k > 0 && nearMtn && process.env.HQ_ICE_RESUME !== '0')) { await clearModals(bot); await teleSpell(bot, 'camelot_teleport', 'camelot tele (ice)'); log.split('tele-camelot-ice'); }
                        await iceQueen(bot, log, g, gang);
                        break;
                    } catch (e) {
                        if (k + 1 >= tries || g.dead || bot.disposed) throw e;
                        console.log(`[hero] ${gang} ${ph} attempt ${k + 1} failed: ${(e as Error).message.slice(0, 160)} | at ${JSON.stringify(bot.pos())} hp ${bot.stat('hitpoints').cur} death ${bot.count('deathrune')}: retry`);
                        await clearModals(bot).catch(() => undefined);
                    }
                }
            }
            else if (ph === 'gang') await gangStart(bot, gang, log);
            else if (ph === 'brim') {
                // F2 helper (sim h3: the Phoenix helper reached the misc-key meet ~600 t before the Black Arm member, who makes its
                // eel first, and gave up after 600 t): the helper leaves for Brimhaven only once the other side leaves for it
                if (asHelper) {
                    const o = gang === 'phoenix' ? 'blackarm' : 'phoenix';
                    await pair.wait(bot, `${o}-brim`, Number(process.env.HQ_HELPER_WAIT ?? 4000), `helper: ${o} leaving for Brimhaven`);
                    log.split('helper-wait');
                } else if (side) pair.set(`${gang}-brim`);
                await toBrimhaven(bot, log);
            }
            else if (ph === 'pair') {
                if (gang === 'phoenix') await pairPhoenix(bot, pair, log, g, fastPair); else await pairBlackArm(bot, pair, log, fastPair, !!side);
                if (asHelper && gang === 'phoenix') {
                    // F2: a finished Phoenix helper needs no candlestick (the Black Arm member keeps both)
                    log.split('helper-done');
                } else {
                // both: Varrock (armband); the candlestick changes hands there
                await clearModals(bot);
                await teleSpell(bot, 'varrock_teleport', 'varrock tele 2');
                log.split('tele-varrock2');
                pair.set(`${gang}-varrock`);
                if (gang === 'blackarm' && pair.has('helper-phoenix')) { /* F2: the Phoenix helper takes no candlestick */ }
                else if (gang === 'blackarm') {
                    await pair.wait(bot, 'phoenix-varrock', 400, 'phoenix in Varrock');
                    await candleHandoff(pair.bots.phoenix!, bot, pair);
                } else await pair.wait(bot, 'candle-traded', 400, 'candlestick');
                log.split('candle');
                }
            }
            else if (ph === 'armband') await armband(bot, gang, log);
            else if (ph === 'entrana') {
                // session 11 fix 272b (qx23m: one failed firebird fight stopped both accounts, heros is NO_RETRY): the Entrana
                // phase retries in-module up to HQ_BIRD_RETRIES (default 2) times unless dead, in place on the island (272c).
                // HQ_BIRD_RETRIES=0 = the old single attempt.
                const tries = 1 + Number(process.env.HQ_BIRD_RETRIES ?? 2);
                for (let k = 0; ; k++) {
                    try { await entrana(bot, log, g); break; } catch (e) {
                        if (k + 1 >= tries || g.dead || bot.disposed) throw e;
                        console.log(`[hero] ${gang} entrana attempt ${k + 1} failed: ${(e as Error).message.slice(0, 160)} | at ${JSON.stringify(bot.pos())} hp ${bot.stat('hitpoints').cur} death ${bot.count('deathrune')}: retry`);
                        await clearModals(bot).catch(() => undefined);
                    }
                }
            }
            else if (ph === 'gerrant') await gerrant(bot, log);
            else if (ph === 'eel') await eel(bot, log, g);
            if (!asHelper) o.onPhase?.(gang, ph);
        }
        if (!handIn) return { ok: true, ticks: bot.tickCount - t0, msg: `helper done, splits ${JSON.stringify(log.splits)}` };
        const ok = await finish(bot, log);
        if (!ok) fail(bot, 'quest not complete after the hand-in');
        return { ok: true, ticks: bot.tickCount - t0, msg: `splits ${JSON.stringify(log.splits)} ate ${g.ate}` };
    } catch (e) {
        pair.set('abort');
        return { ok: false, ticks: bot.tickCount - t0, msg: `${(e as Error).message} | splits ${JSON.stringify(log.splits)}` };
    } finally { g.stop = true; }
}

/** Run both accounts (one process, one world). Each returns its own result; the quest is complete for both on success. */
export async function runPair(phoenix: SpeedBot, blackarm: SpeedBot, o: { log?: boolean; from?: Phase; sides?: Partial<Record<Gang, SideOpt>>; onPhase?: (gang: Gang, ph: Phase) => void } = {}): Promise<{ phoenix: HeroResult; blackarm: HeroResult }> {
    const pair = new Pair();
    pair.names = { phoenix: phoenix.loginUser, blackarm: blackarm.loginUser };
    pair.bots = { phoenix, blackarm };
    for (const gg of ['phoenix', 'blackarm'] as const) if (o.sides?.[gg]?.helper) pair.set(`helper-${gg}`);
    const [p, b] = await Promise.all([runOne(phoenix, 'phoenix', pair, { ...o, side: o.sides?.phoenix }), runOne(blackarm, 'blackarm', pair, { ...o, side: o.sides?.blackarm })]);
    return { phoenix: p, blackarm: b };
}
/** F2: one side alone (its remaining phases need no partner: no 'pair' left) */
export async function runSide(bot: SpeedBot, gang: Gang, o: { log?: boolean; side: SideOpt; onPhase?: (gang: Gang, ph: Phase) => void }): Promise<HeroResult> {
    const pair = new Pair();
    pair.bots = { [gang]: bot }; pair.names = { phoenix: '', blackarm: '', [gang]: bot.loginUser };
    return runOne(bot, gang, pair, o);
}
/** Contract shape: `run` needs the partner, so it is the pair runner bound to one account. */
export async function run(bot: SpeedBot, o: { log?: boolean; partner?: SpeedBot; gang?: Gang } = {}): Promise<{ ok: boolean; ticks: number; msg: string }> {
    if (!o.partner || !o.gang) return { ok: false, ticks: 0, msg: "Hero's Quest needs both accounts: use runPair(phoenix, blackarm)" };
    const r = o.gang === 'phoenix' ? await runPair(bot, o.partner, o) : await runPair(o.partner, bot, o);
    const me = o.gang === 'phoenix' ? r.phoenix : r.blackarm, other = o.gang === 'phoenix' ? r.blackarm : r.phoenix;
    return { ok: me.ok && other.ok, ticks: Math.max(me.ticks, other.ticks), msg: `${o.gang}: ${me.msg} | partner: ${other.msg}` };
}
