/// <reference types="bun" />
// q-family-crest.ts — FAMILY CREST (members, 1 QP), cheat-free. Lane spine.
//
// Verified against the rev-289 content (paths relative to server/content/scripts):
//   stages   quests/quest_crest/configs/quest_crest.constant (1 Dimintheis, 2 Caleb, 3 fish given, 4 told of Avan, 5 gem
//            trader, 6 Avan, 7 Boot, 8 jewellery to Avan, 9 Johnathon, 10 cured, 11 complete).
//   Dimintheis  crest_dimintheis.rs2:29-62 (accept -> 1); hand-in :20-23/:81-94 (family_crest -> queue crest_complete).
//   Caleb    crest_caleb.rs2:16-62 (-> 2), :64-80 (5 cooked fish -> avan_crest, 3), :29-42 ("what happened to the rest" -> 4).
//   gem trader areas/area_alkharid/scripts/gem_trader.rs2:3-25 (-> 5). Avan crest_man.rs2:17-43 (-> 6), :51-63 (perfect ruby
//            ring + necklace -> caleb_crest, 8). Boot crest_boot.rs2:1-21 (-> 7).
//   perfect gold  the Witchaven dungeon gold room; mining.rs2:164-169 turns gold ore into perfect gold ore while the PLAYER
//            stands in x2736-2740 z9684-9693 (quest_crest.constant crest_perfect_mine_*). The room is behind four lever
//            doors (quest_crest.rs2:13-87; probe-rooms.ts regions). Lever sequence used: north up -> south room (g2h1) ->
//            south up -> out (h2) -> north down -> north room (h2g1) -> north-room lever up -> out (h2g1) -> north up ->
//            south room (h2) -> south down -> out (g2h1) -> gold room (i2h1 needs north up, south down, north-room up).
//   jewellery  a perfect gold ore on a furnace smelts a perfect bar (smelting.rs2:21-27 category_91); a perfect bar on a
//            furnace opens crafting_jewelry; the ruby ring/necklace become perfect ones (jewellery.rs2:228-240; crafting 34/40).
//   Johnathon crest_johnathon.rs2 (intro -> 9; any antipoison dose on him -> 10).
//   Chronozon crest_chronozon.rs2: each successful wind/water/earth/fire BLAST sets one bit (player_magic.rs2:223-224,
//            "Chronozon weakens..."); at 0 hp he regenerates until all four bits are set, then dies and drops
//            johnathon_crest (stage 10). The bits are NOT cleared by a regeneration. He is in the Edgeville dungeon
//            Wilderness (3087,9937).
import { wildStash } from '../glory-wild.js';
import { isResuming, journalStage } from '../journal.js';
import { SpeedBot, objId, objDebugName, cheb, componentId } from '../../../core.js';
import { nav, inDialog, npc, npcsOf, dismiss, msgsSince } from '../../q-lib.js';
import {
    mkLog, fail, go, locHere, chat, converse, byText, textWatch, clearModals, useItemOnItem, useOnNpc, pickup, glory, teleSpell,
    guard, castKill, opLocUntil, npcIdOf, startWarningCloser, textLog, untilChat, retaliateOff, spTrace, type Item, type Log, type Tile,
    prayKeep, hasMsg, breakCombatLock, lockAttackers, facingNear,
} from './sp-lib.js';

export const QUEST = { name: 'Family Crest', dir: 'quest_crest', qp: 1 };
export const REQUIREMENTS = {
    quests: ['Plague City + scroll read (Ardougne teleport; optional: walk otherwise)'] as string[],
    qp: 0,
    skills: {
        magic: [59, 'fire blast on Chronozon, magic_combat_spells.dbrow fire_blast levelrequired 59 (+ wind/water/earth blast 41/47/53)'],
        mining: [40, 'perfect gold ore (gold rocks, mine.dbrow)'],
        crafting: [40, 'perfect ruby necklace (ring 34), jewellery.struct'],
        smithing: [40, 'smelt the perfect gold bars, skill_smithing/configs/smelting/smelting.struct:117-123'],
        prayer: [43, 'Protect from Melee vs Chronozon and the Edgeville dungeon'],
    } as Record<string, [number, string]>,
    start: { x: 3279, z: 3405, level: 0 },   // next to Dimintheis's house (Varrock, door 3278,3404)
    end: { x: 3279, z: 3405, level: 0 },
};
function fcRunes(plus: boolean, fold: boolean, death10: boolean): Item[] {
    // + 10 fire blasts for poison spiders next to Chronozon (in the base 102 fire / 29 death)
    // FC_DEATH10: one poison-spider lock costs ~10-13 death runes, so +10 death
    // runes, in the BASE entry (merge() keeps the larger count of a duplicate name, so a separate entry would never arrive).
    // Crest pack death 35 -> 45; the main's bank total follows (136 -> 146). FC_DEATH10=0 reverts.
    // FC_AIR40 ('chronozon: out of blast runes' at air 2: spider locks eat air first, and the extra
    // death runes need air too): air 121 -> 161 (FC_AIR40=0 reverts).
    const base: Item[] = [{ name: 'lawrune', n: 6 }, { name: 'airrune', n: process.env.FC_AIR40 === '0' ? 121 : 161 }, { name: 'waterrune', n: 12 }, { name: 'earthrune', n: 12 }, { name: 'firerune', n: 102 }, { name: 'deathrune', n: 29 + (death10 ? 10 : 0) }];
    const more: Item[] = plus ? [{ name: 'deathrune', n: 6 }, { name: 'earthrune', n: 12 }, { name: 'airrune', n: 18 }, { name: 'firerune', n: 10 }] : [];
    if (!fold) return [...base, ...more];
    return base.map(i => ({ ...i, n: i.n + more.filter(m => m.name === i.name).reduce((a, m) => a + m.n, 0) }));
}
export const SUPPLY: Item[] = [
    { name: 'swordfish', n: 1 }, { name: 'bass', n: 1 }, { name: 'tuna', n: 1 }, { name: 'salmon', n: 1 }, { name: 'shrimp', n: 1 },
    { name: '1doseantipoison', n: 1 }, { name: 'ruby', n: 2 }, { name: 'ring_mould', n: 1 }, { name: 'necklace_mould', n: 1 },
    { name: 'rune_pickaxe', n: 1 }, { name: 'amulet_of_glory_4', n: 1 },   // Al Kharid x2, Edgeville
    // Camelot (law 1, air 5), Falador (law 1, air 3, water 1), Ardougne (law 2, water 2), Varrock x2 (law 1, air 3, fire 1);
    // Chronozon: wind/water/earth blast x3 each + fire blast x10 (death 1 each)
    // session 10 (qu23m ran out of fire runes in the kill): +6 blasts of margin (the kill falls back to earth/water/wind)
    // fix 303c (CONFIRMED: route.ts need() merge()s duplicate names by MAX, so the separate +6 entries never arrived: every
    // crest pack in qx60/qx65 held deathrune 29, not 35): fold the margin into the base counts. FC_RUNES_FOLD=0 reverts.
    ...fcRunes(process.env.FC_RUNES_PLUS !== '0', process.env.FC_RUNES_FOLD !== '0', process.env.FC_DEATH10 !== '0'),
    { name: 'shark', n: 6 }, { name: '4doseprayerrestore', n: 1 },
];

const N = {
    dimintheis: npcIdOf('dimintheis'), caleb: npcIdOf('caleb_fitzharmon'), gemTrader: npcIdOf('gem_trader'), avan: npcIdOf('avan'),
    boot: npcIdOf('boot_the_dwarf'), johnathon: npcIdOf('johnathon_fitzharmon'), chronozon: npcIdOf('chronozon'),
};
const O = {
    avanCrest: objId('avan_crest'), calebCrest: objId('caleb_crest'), johnCrest: objId('johnathon_crest'), crest: objId('family_crest'),
    ore: objId('perfect_gold_ore'), bar: objId('perfect_gold_bar'), ring: objId('perfect_ruby_ring'), necklace: objId('perfect_ruby_necklace'),
    antipoison: objId('1doseantipoison'),
};
const T = {
    dimintheis: { x: 3279, z: 3404 }, caleb: { x: 2819, z: 3451 }, gemTrader: { x: 3288, z: 3212 }, avan: { x: 3295, z: 3285 },
    boot: { x: 2965, z: 9811 }, faladorMine: { id: 1733, x: 3059, z: 3376 }, witchLadder: { id: 1754, x: 2696, z: 3282 },
    witchUp: { id: 1755, x: 2696, z: 9682 }, furnace: { id: 2781, x: 3272, z: 3185 }, joStairs: { id: 1725, x: 3285, z: 3493 },
    johnathon: { x: 3279, z: 3503 }, edgeTrap: { x: 3097, z: 3468 }, chronozon: { x: 3087, z: 9937 },
};
export const PHASES = ['dimintheis', 'caleb', 'gem', 'avan', 'boot', 'gold', 'jewellery', 'avan2', 'johnathon', 'chronozon', 'finish'] as const;
export type Phase = typeof PHASES[number];

function pray(bot: SpeedBot, name: string, on: boolean): void { prayKeep(bot, on ? name : null); }
/** Quest door (open_and_close_door2) from an exact tile (see q-heros-quest.ts doorFrom). */
async function doorFrom(bot: SpeedBot, door: { id: number; x: number; z: number }, stand: Tile, through: () => boolean, label: string): Promise<void> {
    if (through()) return;
    const loc = locHere(door.id, door.x, door.z, bot.minusedlevel);
    for (let k = 0; k < 4 && !through(); k++) {
        if (bot.chatModalId !== -1) dismiss(bot);
        if (cheb(bot.tile(), stand) > 1) await go(bot, stand, 0, label, 200).catch(() => undefined);   // door-aware walk first
        if (bot.tile().x !== stand.x || bot.tile().z !== stand.z) await bot.stepTo(stand.x, stand.z, 30);
        bot.opLoc(loc.x, loc.z, loc.id, 1); bot.queueFlush();
        await bot.until(through, 6);
    }
    if (!through()) fail(bot, `${label}: not through (door locked? levers wrong)`);
}
/** Pull a lever (the loc swaps between its down/up ids for 500 t: crest_toggle_lever quest_crest.rs2:31-46). */
async function pull(bot: SpeedBot, down: number, up: number, x: number, z: number, wantUp: boolean, stand: Tile, label: string): Promise<void> {
    const cur = () => bot.liveLocs.get(`0,${x},${z}`) ?? down;
    // the visible state can revert after 500 t while the bit stays: we only ever pull within that window
    if ((cur() === up) === wantUp) return;
    const id = cur();
    const loc = { ...locHere(down, x, z, 0), id };
    const seen = textWatch(bot);
    // levers are wall decorations on their own tile's wall: stand ON the lever tile and op it directly (probe-op: toggles
    // from (2722,9710); routing to the rsmod reach tile never fired in the run, sim spc3/spc4)
    void stand; void seen;
    const target = wantUp ? up : down;
    for (let k = 0; k < 6 && cur() !== target; k++) {
        if (bot.chatModalId !== -1) dismiss(bot);
        if (bot.tile().x !== x || bot.tile().z !== z) { if (cheb(bot.tile(), { x, z }) > 1) await go(bot, { x, z }, 0, label, 200).catch(() => undefined); await bot.stepTo(x, z, 20); }
        bot.opLoc(x, z, cur(), 1); bot.queueFlush();
        await bot.until(() => cur() === target, 5);
    }
    if (cur() !== target) fail(bot, `${label}: lever did not move (live ${cur()})`);
    void loc;
}

async function dimintheis(bot: SpeedBot, log: Log): Promise<void> {
    let ok = false;
    await converse(bot, N.dimintheis, T.dimintheis, (o) => {
        const a = o.findIndex(t => /Ok, I will help you/i.test(t)); if (a >= 0) { ok = true; return a; }
        const b = o.findIndex(t => /where is this crest/i.test(t)); if (b >= 0) return b;
        return o.findIndex(t => /nobleman live in a dump/i.test(t));
    }, () => ok && bot.chatModalId === -1, 'dimintheis', { maxTicks: 60, stand: { x: 3279, z: 3403 } });
    log.split('dimintheis');
}

async function caleb(bot: SpeedBot, log: Log): Promise<void> {
    await clearModals(bot);
    await teleSpell(bot, 'camelot_teleport', 'camelot tele');
    log.split('tele-camelot');
    // session 11 fix 406a (qx499m 'caleb 2: npc 666 not opened at (2815,3449)', 662 t, eng-qx499 t37907-38686): Caleb wanders
    // out of his alley (spawn 2819,3451) to (2821,3449..3454)/(2820,3448); our OPNPC route left through door 1530@2815,3449 and
    // round the outside, openNpc's stand return (2818,3451, 5 t) + walkTo(spawn) pulled us back through his house: the fix-359
    // loop (dialogs opened at t37962/t37989 were cut by the walk back). roam: chase him in view. FC_CALEB_ROAM=0 reverts.
    // The retry (journal 'caleb' = stage 1-3) re-ran caleb 1 at stage 2: crest_caleb.rs2:64-80 takes the fish at once and asks
    // 'what happened to the rest of it? | Thank you' (stage 3 :91-93 asks it too) -> 'caleb 1: unplanned choice'. caleb 1 takes
    // that answer as well and caleb 2 is then skipped by its done(). FC_CALEB_RESUME=0 reverts.
    // TEST (sim): FC_TEST406=1 fails the quest once right after caleb 1, so the retry resumes at stage 2.
    const roam406 = process.env.FC_CALEB_ROAM !== '0', resume406 = process.env.FC_CALEB_RESUME !== '0';
    let will = false, rest = false;
    await converse(bot, N.caleb, T.caleb, (o) => {
        const a = o.findIndex(t => /Ok, I will get those/i.test(t)); if (a >= 0) { will = true; return a; }
        const b = o.findIndex(t => /So can I have your bit/i.test(t)); if (b >= 0) return b;
        const c = resume406 ? o.findIndex(t => /what happened to the rest of it/i.test(t)) : -1; if (c >= 0) { will = true; rest = true; return c; }
        return o.findIndex(t => /Are you Caleb Fitzharmon/i.test(t));
    }, () => will && bot.chatModalId === -1, 'caleb 1', { maxTicks: 60, stand: { x: 2818, z: 3451 }, roam: roam406 });
    if (process.env.FC_TEST406 === '1' && !(globalThis as any).__fc406) { (globalThis as any).__fc406 = 1; fail(bot, 'caleb 406 TEST: forced fail after caleb 1'); }
    // fix 419 (piece re-get): Caleb's piece lost at stage 3/4 -> his 'pieces' talk offers "I have lost the piece you gave me."
    // (crest_caleb.rs2:104-126; stage 4 reaches it through caleb_fitzharmon_avan :99-102)
    await converse(bot, N.caleb, T.caleb, (o) => {
        const l = REGAIN ? o.findIndex(t => /lost the piece you gave me/i.test(t)) : -1; if (l >= 0) { rest = true; return l; }
        const i = o.findIndex(t => /what happened to the rest of it/i.test(t)); if (i >= 0) rest = true; return i;
    },
        () => rest && bot.count(O.avanCrest) > 0 && bot.chatModalId === -1, 'caleb 2', { maxTicks: 60, stand: { x: 2818, z: 3451 }, roam: roam406 });
    log.split('caleb');
}

async function gemTrader(bot: SpeedBot, log: Log): Promise<void> {
    await clearModals(bot);
    await glory(bot, 4, 'glory al kharid');
    log.split('tele-alkharid');
    let asked = false;
    await converse(bot, N.gemTrader, T.gemTrader, (o) => { const i = o.findIndex(t => /search of a man named Avan/i.test(t)); if (i >= 0) asked = true; return i; },
        () => asked && bot.chatModalId === -1, 'gem trader', { maxTicks: 60 });
    log.split('gem-trader');
}

async function avan1(bot: SpeedBot, log: Log): Promise<void> {
    let asked = false;
    await converse(bot, N.avan, T.avan, (o) => { const i = o.findIndex(t => /looking for a man named Avan/i.test(t)); if (i >= 0) asked = true; return i; },
        () => asked && bot.chatModalId === -1, 'avan 1', { maxTicks: 80 });
    log.split('avan');
}

async function boot(bot: SpeedBot, log: Log): Promise<void> {
    await clearModals(bot);
    if (bot.tile().z < 6400) {
        await teleSpell(bot, 'falador_teleport', 'falador tele');
        log.split('tele-falador');
        // stairs_cellar forceapproach=north (stairs.loc:43-51) at angle 1 = from the EAST: stand (3062,3377) inside the house
        await go(bot, { x: 3062, z: 3377 }, 0, 'falador mine', 300);
        await opLocUntil(bot, locHere(T.faladorMine.id, T.faladorMine.x, T.faladorMine.z, 0), 1, () => bot.tile().z > 6400, 'falador mine stairs', { stand: { x: 3062, z: 3377 }, maxTicks: 30, every: 5 });
        log.split('mine-in');
    }
    let asked = false;
    await converse(bot, N.boot, T.boot, (o) => { const i = o.findIndex(t => /very high quality gold/i.test(t)); if (i >= 0) asked = true; return i; },
        () => asked && bot.chatModalId === -1, 'boot', { maxTicks: 60 });
    log.split('boot');
}

async function gold(bot: SpeedBot, log: Log, g: ReturnType<typeof guard>): Promise<void> {
    await clearModals(bot);
    if (bot.count(O.ore) + bot.count(O.bar) + bot.count(O.ring) + bot.count(O.necklace) >= 2) return;
    await teleSpell(bot, 'ardougne_teleport', 'ardougne tele');
    log.split('tele-ardougne');
    await goldRoom(bot, 2 - bot.count(O.ore));
    await go(bot, { x: 2697, z: 3282 }, 1, 'witchaven ladder', 300);
    await opLocUntil(bot, locHere(T.witchLadder.id, T.witchLadder.x, T.witchLadder.z, 0), 1, () => bot.tile().z > 6400, 'witchaven ladder', { maxTicks: 30, every: 5 });
    log.split('dungeon');
    pray(bot, 'protectfrommelee', true);   // ogres all over the dungeon (sim spc5: hp 75 -> 39)
    // regions with the four quest doors shut (probe-rooms.ts): A main (x2693-2727 z9672-9710), C north room (lever i),
    // D south room (lever h), E gold room. Lever g (north) stands in A at (2722,9710), used from (2722,9709).
    const inD = () => bot.tile().z <= 9671 && bot.tile().x >= 2715 && bot.tile().x <= 2724;
    const inC = () => bot.tile().z >= 9711 && bot.tile().x >= 2715 && bot.tile().x <= 2725;
    const inE = () => bot.tile().x >= 2728 && bot.tile().z >= 9682 && bot.tile().z <= 9695;
    const G = { s: { x: 2722, z: 9709 } }, H = { s: { x: 2724, z: 9670 } }, I = { s: { x: 2722, z: 9717 } };
    await pull(bot, 2421, 2422, 2722, 9710, true, G.s, 'north lever up');
    await doorFrom(bot, { id: 2429, x: 2722, z: 9671 }, { x: 2722, z: 9672 }, inD, 'door g2h1 in');
    await pull(bot, 2423, 2424, 2724, 9669, true, H.s, 'south lever up');
    await doorFrom(bot, { id: 2427, x: 2719, z: 9671 }, { x: 2719, z: 9671 }, () => !inD(), 'door h2 out');
    await pull(bot, 2421, 2422, 2722, 9710, false, G.s, 'north lever down');
    await doorFrom(bot, { id: 2431, x: 2723, z: 9711 }, { x: 2723, z: 9710 }, inC, 'door h2g1 in');
    await pull(bot, 2425, 2426, 2722, 9718, true, I.s, 'north-room lever up');
    await doorFrom(bot, { id: 2431, x: 2723, z: 9711 }, { x: 2723, z: 9711 }, () => !inC(), 'door h2g1 out');
    await pull(bot, 2421, 2422, 2722, 9710, true, G.s, 'north lever up 2');
    await doorFrom(bot, { id: 2427, x: 2719, z: 9671 }, { x: 2719, z: 9672 }, inD, 'door h2 in');
    await pull(bot, 2423, 2424, 2724, 9669, false, H.s, 'south lever down');
    await doorFrom(bot, { id: 2429, x: 2722, z: 9671 }, { x: 2722, z: 9671 }, () => !inD(), 'door g2h1 out');
    await doorFrom(bot, { id: 2430, x: 2727, z: 9690 }, { x: 2727, z: 9690 }, inE, 'door i2h1 (gold room)');
    log.split('levers');
    // TEST (sim): FC_FAIL_TEST=gold fails the quest here, inside the gold room next to the hellhounds (the Runner's fail-safe proof)
    if (process.env.FC_FAIL_TEST === 'gold') fail(bot, 'FC_FAIL_TEST=gold: forced fail in the gold room');
    if (!GOLD_FIX) {
        // mine 2 perfect gold ores standing inside x2736-2740 z9684-9693 (the rocks at 2737,9689 / 2738,9693 / 2740,9684)
        const rocks = [{ x: 2737, z: 9689, s: { x: 2736, z: 9689 } }, { x: 2738, z: 9693, s: { x: 2738, z: 9692 } }, { x: 2740, z: 9684, s: { x: 2739, z: 9684 } }];
        const t0 = bot.tickCount; let r = 0;
        while (bot.count(O.ore) < 2 && !g.dead) {
            if (bot.tickCount - t0 > 400) fail(bot, `perfect gold ${bot.count(O.ore)}/2`);
            const rk = rocks[r % rocks.length]!;
            const live = bot.liveLocs.get(`0,${rk.x},${rk.z}`);
            if (live !== undefined && live !== 2099) { r++; await bot.tick(1); continue; }   // depleted
            const c0 = bot.count(O.ore);
            await opLocUntil(bot, locHere(2099, rk.x, rk.z, 0), 1, () => bot.count(O.ore) > c0 || (bot.liveLocs.get(`0,${rk.x},${rk.z}`) ?? 2099) !== 2099, 'mine perfect gold', { stand: rk.s, maxTicks: 60, every: 6 }).catch(() => { r++; });
        }
    } else await mineGold(bot, g, 2);
    pray(bot, 'protectfrommelee', false);
    log.split('perfect-gold');
}

//  acct25 crest attempt 2 ('perfect gold 1/2 at 2739,9684 | modal -1/356', ~400 t at the rocks, then the
// hellhounds killed the idle bot): interface 356 = message1 (pack/interface.pack), the ONE-line mesbox
// "Your inventory is too full to hold any more gold." (skill_mining/scripts/mining.rs2:51-55 firstswing, :93-97 continue;
// the pickaxe message is two lines = message2, the level one is moot after an ore). The pack had 1 free slot: ore 1 took it,
// every later swing opened that box. The old loop only saw 'no ore yet' and cycled 3 rocks for 400 t. Also: the room has FOUR
// gold rocks (maps/m42_151.jm2 LOC '0 49 19/49 25/50 29/52 20: 2099' = 2737,9683 / 2737,9689 / 2738,9693 / 2740,9684), the
// old list missed 2737,9683; and two hellhounds (npc 49, NPC '0 46 24/46 29' = 2734,9688/9693) live in it.
// Fix (FC_GOLD_FIX=0 reverts): (a) goldRoom(): before the ladder, free the slots the ores need: eat spare fish/food, drop
// junk; still short = deposit what Crest never uses at Ardougne south bank (the Runner's next prep withdraws it again);
// (b) mineGold(): all four rocks, a depleted rock is skipped and re-tried after its respawn (gold: 200 t scaled by player
// count, mine.dbrow gold_rock_table), the full-pack box is read (message1 text) and answered by making room in place, one
// op per ore (re-op only after 15 t without the ore: a re-op restarts the swing timer, mining.rs2:72-76).
const GOLD_FIX = process.env.FC_GOLD_FIX !== '0';
const GOLD_ROCKS = [
    { x: 2737, z: 9689, s: { x: 2736, z: 9689 } }, { x: 2738, z: 9693, s: { x: 2738, z: 9692 } },
    { x: 2740, z: 9684, s: { x: 2739, z: 9684 } }, { x: 2737, z: 9683, s: { x: 2737, z: 9684 } },
];
/** what the rest of Crest uses (never eaten, dropped or deposited by roomFor) */
function crestKeeps(n: string): boolean {
    return /rune$|_pickaxe$|^amulet_of_glory|ruby|mould$|gold_bar$|^perfect_|crest|antipoison|prayerrestore|^regicide_quest/.test(n);
}
const SPARE_FOOD = ['shrimp', 'salmon', 'tuna', 'bass', 'swordfish', 'trout', 'lobster', 'cake', 'bread'];
const JUNK = /^uncut_(sapphire|emerald|ruby|diamond)$|^gold_ore$|^vial$|^jug$|^bones$|^ashes$|^burnt_|^pot$|^bucket$/;
/** free `n` slots without leaving the spot: spare food eaten (fish left from Caleb), junk dropped, sharks eaten down to 3 */
async function roomFor(bot: SpeedBot, n: number, why: string, sharks = true): Promise<boolean> {
    const free0 = bot.free(); const did: string[] = [];
    for (let k = 0; k < 28 && bot.free() < n; k++) {
        if (bot.chatModalId !== -1 || bot.mainModalId !== -1) { bot.closeModal(); bot.queueFlush(); await bot.tick(1); }
        const inv = bot.inv().map(s => ({ ...s, name: objDebugName(s.obj) }));
        const junk = inv.find(s => JUNK.test(s.name));
        if (junk) { bot.dropItem(junk.obj, junk.slot); bot.queueFlush(); did.push(`drop ${junk.name}`); await bot.tick(1); continue; }
        const food = inv.find(s => SPARE_FOOD.includes(s.name)) ?? (sharks && bot.count(objId('shark')) > 3 ? inv.find(s => s.name === 'shark') : undefined);
        if (food) { bot.opHeld1(food.obj, food.slot); bot.queueFlush(); did.push(`eat ${food.name}`); await bot.tick(3); continue; }
        break;
    }
    console.log(`[fc] room for ${n} (${why}): free ${free0} -> ${bot.free()}${did.length ? ` (${did.join(', ')})` : ''}`);
    return bot.free() >= n;
}
/** goldRoom() part (a): at Ardougne, before the dungeon. Short of slots after roomFor = deposit the non-Crest items. */
async function goldRoom(bot: SpeedBot, need: number): Promise<void> {
    if (!GOLD_FIX || bot.free() >= need + 1) return;
    if (await roomFor(bot, need + 1, 'before the dungeon', false)) return;
    const out = bot.inv().filter(s => !crestKeeps(objDebugName(s.obj)) && objDebugName(s.obj) !== 'shark');
    console.log(`[fc] pack full (free ${bot.free()}, need ${need + 1}): deposit at Ardougne south bank: ${[...new Set(out.map(s => objDebugName(s.obj)))].join(',')}`);
    await go(bot, { x: 2655, z: 3286 }, 2, 'ardougne south bank', 200);
    const ob = await bot.openBank({ radius: 16, maxTicks: 30 });
    if (ob.ok) {
        const keep = [...new Set(bot.inv().map(s => s.obj).filter(o => crestKeeps(objDebugName(o)) || objDebugName(o) === 'shark'))];
        await bot.depositAll(keep); await bot.tick(1); bot.closeBank(); await bot.tick(1);
    }
    if (bot.free() < need) fail(bot, `perfect gold: pack full (free ${bot.free()}, need ${need}; bank ${ob.ok ? 'ok' : ob.message})`);
}
/** goldRoom() part (b): mine until `want` perfect gold ores, all four rocks, full-pack box answered */
async function mineGold(bot: SpeedBot, g: ReturnType<typeof guard>, want: number): Promise<void> {
    const t0 = bot.tickCount, max = Number(process.env.FC_GOLD_TICKS ?? 600);
    const depleted = (rk: { x: number; z: number }) => { const l = bot.liveLocs.get(`0,${rk.x},${rk.z}`); return l !== undefined && l !== 2099; };
    let r = 0, full = 0;
    console.log(`[fc] mineGold: want ${want}, have ${bot.count(O.ore)}, free ${bot.free()}`);
    while (bot.count(O.ore) < want && !g.dead) {
        if (bot.tickCount - t0 > max) fail(bot, `perfect gold ${bot.count(O.ore)}/${want} after ${max} t (free ${bot.free()}, rocks ${GOLD_ROCKS.map(k => depleted(k) ? 'x' : 'o').join('')})`);
        if (bot.free() < 1 || /too full to hold/i.test(bot.ifText.get(componentOf356()) ?? '')) {
            if (++full > 4 || !(await roomFor(bot, 1, 'full-pack box'))) fail(bot, `perfect gold ${bot.count(O.ore)}/${want}: pack full, nothing to eat or drop (${bot.inv().map(s => objDebugName(s.obj)).join(',')})`);
        }
        if (bot.chatModalId !== -1) { bot.closeModal(); bot.queueFlush(); await bot.tick(1); }
        const open = GOLD_ROCKS.map((k, i) => ({ k, i })).filter(x => !depleted(x.k));
        if (!open.length) { await bot.tick(2); continue; }   // all four depleted: wait for a respawn in place (prayer on)
        const rk = (open.find(x => x.i === r % GOLD_ROCKS.length) ?? open[0]!).k;
        const c0 = bot.count(O.ore), g0 = bot.count(objId('gold_ore'));
        await opLocUntil(bot, locHere(2099, rk.x, rk.z, 0), 1, () => bot.count(O.ore) > c0 || depleted(rk) || bot.chatModalId === 356 || bot.count(objId('gold_ore')) > g0, 'mine perfect gold', { stand: rk.s, maxTicks: 90, every: 15 }).catch(() => undefined);
        if (bot.count(objId('gold_ore')) > g0) console.log(`[fc] plain gold ore mined at ${JSON.stringify(bot.pos())} (outside x2736-2740 z9684-9693): dropped next round`);
        if (bot.count(O.ore) === c0) r++;
    }
}
/** message1's text component (interface 356, the one-line mesbox) */
function componentOf356(): number { try { return componentId('message1:com_0'); } catch { return 357; } }

async function jewellery(bot: SpeedBot, log: Log): Promise<void> {
    await clearModals(bot);
    if (bot.count(O.ring) > 0 && bot.count(O.necklace) > 0) return;
    await glory(bot, 4, 'glory al kharid 2');
    log.split('tele-alkharid2');
    const fur = locHere(T.furnace.id, T.furnace.x, T.furnace.z, 0);
    // the glory lands inside a building with shut doors: walk (door-aware) next to the furnace first
    await go(bot, { x: 3275, z: 3186 }, 1, 'furnace', 200);
    const { useOnLocUntil } = await import('./sp-lib.js');
    while (bot.count(O.ore) > 0) {
        const c0 = bot.count(O.bar);
        await useOnLocUntil(bot, O.ore, fur, () => bot.count(O.bar) > c0, 'smelt perfect gold', { maxTicks: 30, every: 6 });
    }
    log.split('smelt');
    const RINGS = 4233, NECKS = 4239, IRING = objId('invis_ring3'), INECK = objId('invis_necklace3');
    for (const [want, com, slotObj, slot] of [[O.ring, RINGS, IRING, 3], [O.necklace, NECKS, INECK, 3]] as const) {
        for (let k = 0; k < 4 && bot.count(want) === 0; k++) {
            if (bot.mainModalId !== 4161) await useOnLocUntil(bot, O.bar, fur, () => bot.mainModalId === 4161, 'jewellery menu', { maxTicks: 20, every: 6 });
            bot.invButton(1, slotObj, slot, com); bot.queueFlush();
            await bot.until(() => bot.count(want) > 0, 8);
        }
        if (bot.count(want) === 0) fail(bot, `${objDebugName(want)} not made`);
    }
    await clearModals(bot);
    log.split('jewellery');
}

/** FC_REGAIN=1 (set only by legs/qp/route/existing.ts; a resume at 'chronozon' without Caleb's /
 *  Avan's pieces failed with 'crest did not combine'): a lost piece is handed over again. Caleb gives avan_crest on "I have lost the
 *  piece you gave me." while the account owns none (crest_caleb.rs2:110-126), Avan gives caleb_crest on "I have lost the fragment
 *  that you gave me..." (crest_man.rs2:86-101); Johnathon's comes from Chronozon again (crest_chronozon.rs2:4-6). The bank copy
 *  counts as owned: the route's resume pulls the pieces from the bank first (leg.keep). */
// fix 419 ( acct25: died in the gold room at stage 7 and lost avan_crest = CALEB's piece (the obj names are
// swapped: Caleb hands out avan_crest, Avan hands out caleb_crest). The retry resumed at 'gold', and the regain above was gated
// on from > 'avan2', so it never ran: 'crest did not combine at (3084,9935)' with caleb_crest + johnathon_crest held).
// Content (quest_crest scripts): NO piece costs the kit again.
//   avan_crest (Caleb)  stage >= 4: opnpc1 default/caleb_where -> caleb_fitzharmon_pieces (crest_caleb.rs2:7-9,99-111): offered
//                       only while pack AND bank hold none (:110); "I have lost the piece you gave me." -> inv_add (:120-126).
//                       Stage 3 shows the salad talk (:6, no 'lost'); "what happened to the rest" moves it to 4 (:29-42).
//   caleb_crest (Avan)  stage >= 9: default -> avan_pieces (crest_man.rs2:13,80-87), same pack+bank rule (:86); "I have lost the
//                       fragment you gave me." -> inv_add (:96-101). Stage 8 = avan_where, NOT re-obtainable (:11,:69-72)
//                       until Johnathon's intro (crest_johnathon.rs2:31-35 -> 9).
//   johnathon_crest     Chronozon again: dropped on his death while stage = 10 (crest_chronozon.rs2:1-6); the four blast bits
//                       are never cleared before completion, so any kill drops it.
// Now (FC_REGAIN=0 reverts to off; '1' was existing.ts only): every run checks the pieces up front (pack + bank, a banked one
// is pulled back), and before Chronozon / the combine re-gets each missing piece whose giver is past its stage.
const REGAIN = process.env.FC_REGAIN !== '0';
const PIECES = () => [['avan_crest', O.avanCrest], ['caleb_crest', O.calebCrest], ['johnathon_crest', O.johnCrest]] as const;
function piecesStr(bot: SpeedBot): string {
    return PIECES().map(([n, id]) => `${n} ${bot.count(id)}${bot.bankItems().length ? `/bank ${bot.bankCount(id)}` : ''}`).join(', ') + (bot.count(O.crest) ? ', family_crest 1' : '');
}
/** a missing piece the bank holds (the givers refuse while the bank has one): withdraw it, depositing nothing */
async function pullBanked(bot: SpeedBot, why: string): Promise<void> {
    if (bot.count(O.crest) > 0) return;
    const banked = PIECES().filter(([, id]) => bot.count(id) === 0 && bot.bankCount(id) > 0).map(([n]) => ({ name: n, n: 1 }));
    if (!banked.length) return;
    console.log(`[fc] ${why}: ${banked.map(i => i.name).join(',')} in the bank: pulling it back`);
    try {
        const { bankVisit } = await import('../route/route-lib.js');
        await bankVisit(bot, banked, [...new Set(bot.inv().map(s => objDebugName(s.obj)))], null, new Set(), 'fc:pieces');
        if (bot.bankOpen()) { bot.closeBank(); await bot.tick(1); }
    } catch (e) { console.log(`[fc] ${why}: bank pull failed: ${(e as Error).message.slice(0, 160)}`); }
}
async function regainPieces(bot: SpeedBot, log: Log): Promise<void> {
    if (bot.count(O.crest) > 0) return;
    await pullBanked(bot, 'regain');
    if (bot.count(O.avanCrest) > 0 && bot.count(O.calebCrest) > 0) return;
    console.log(`[fc] regain: ${piecesStr(bot)}`);
    // sim r3: the resumed kit (fish set, rubies, moulds, pickaxe: phases already done) filled the pack, so Caleb's re-issued
    // piece (inv_add) fell to the floor, x3. Those phase items are dead weight past 'avan2': drop them to keep 3 slots free.
    const DEAD = ['swordfish', 'bass', 'tuna', 'salmon', 'shrimp', '1doseantipoison', 'ruby', 'ring_mould', 'necklace_mould', 'rune_pickaxe', 'gold_bar', 'perfect_gold_bar', 'perfect_ruby_ring', 'perfect_ruby_necklace'];
    const room = async () => {
        for (const n of DEAD) { const id = objId(n); for (let k = 0; k < 4 && bot.free() < 3 && bot.count(id) > 0; k++) { bot.dropItem(id, bot.slot(id)); bot.queueFlush(); await bot.tick(1); } }
        if (bot.free() < 3) console.log(`[fc] regain: only ${bot.free()} free slot(s)`);
    };
    await room();
    if (bot.count(O.avanCrest) === 0) {
        await clearModals(bot);
        await teleSpell(bot, 'camelot_teleport', 'camelot tele (regain)');
        await converse(bot, N.caleb, T.caleb, (o) => { const i = o.findIndex(t => /lost the piece you gave me/i.test(t)); return i; },
            () => bot.count(O.avanCrest) > 0 && bot.chatModalId === -1, 'caleb regain', { maxTicks: 80, stand: { x: 2818, z: 3451 }, roam: true });
        log.split('regain-caleb');
    }
    if (bot.count(O.calebCrest) === 0) {
        await clearModals(bot);
        await glory(bot, 4, 'glory al kharid (regain)');
        await converse(bot, N.avan, T.avan, (o) => o.findIndex(t => /lost the fragment/i.test(t)),
            () => bot.count(O.calebCrest) > 0 && bot.chatModalId === -1, 'avan regain', { maxTicks: 100 });
        log.split('regain-avan');
    }
    if (bot.count(O.avanCrest) === 0 || bot.count(O.calebCrest) === 0) fail(bot, `regain: pieces still missing (${piecesStr(bot)})`);
}

/** the journal -> phase table (crest_journal.rs2) */
const JOURNAL: Array<[RegExp, string]> = [
    [/QUEST COMPLETE/i, 'done'], [/lost his piece of the family crest to a demon/i, 'chronozon'],
    [/looking very ill at the\s+Jolly Boar Inn$|final crest piece is with their brother/i, 'johnathon'],
    [/will give me his crest piece if I can bring him a ruby/i, 'gold'], [/find a dwarf named Boot/i, 'boot'],
    [/Gem Trader told me that Avan/i, 'avan'], [/told me his brother Avan/i, 'gem'],
    [/one crest piece, I need to find the other|will let me have his piece|find his son Caleb/i, 'caleb'],
];
/** fix 419 (LIVE acct25 attempt 2: '[safety] bank lacks swordfish x1, 1doseantipoison x1, ruby x1' after attempt 1 had
 *  used them): the kit items that only DONE phases consume, by the journal (+ the held pieces/jewellery). A lost piece never
 *  needs them again (see fix 419 above). existing.ts prep: a resumed Crest lacking only these runs lenient. */
export async function doneKit(bot: SpeedBot): Promise<string[]> {
    const st = await journalStage<string>(bot, 'crest', JOURNAL, 'dimintheis', s => console.log(`[fc] doneKit ${s}`));
    const has = (n: string) => bot.count(objId(n)) > 0 || bot.bankCount(objId(n)) > 0;
    if (st === 'done') return SUPPLY.map(i => i.name);
    const i = PHASES.indexOf(st as Phase), out: string[] = [];
    if (i > PHASES.indexOf('caleb') || has('avan_crest')) out.push('swordfish', 'bass', 'tuna', 'salmon', 'shrimp');            // stage >= 3
    if (i >= PHASES.indexOf('johnathon') || has('caleb_crest') || (has('perfect_ruby_ring') && has('perfect_ruby_necklace')))   // stage >= 8
        out.push('ruby', 'ring_mould', 'necklace_mould', 'rune_pickaxe');
    if (st === 'chronozon' || has('johnathon_crest')) out.push('1doseantipoison');                                              // stage 10
    // Chronozon is dead (his piece is owned): the blast runes, the fight food and the restore are done-phase too. Only the
    // teleports remain (Camelot law 1 air 5, Varrock law 1 air 3 fire 1, a no-glory Lumbridge hop law 1 air 3 earth 1): the
    // lenient prep still withdraws every rune the bank has; the module warns below 3 law / 11 air.
    if (has('johnathon_crest') || has('family_crest')) out.push('deathrune', 'waterrune', 'earthrune', 'airrune', 'firerune', 'lawrune', 'shark', '4doseprayerrestore');
    return out;
}

async function avan2(bot: SpeedBot, log: Log): Promise<void> {
    await converse(bot, N.avan, T.avan, () => -1, () => bot.count(O.calebCrest) > 0 && bot.chatModalId === -1, 'avan 2', { maxTicks: 60 });
    log.split('avan2');
}

async function johnathon(bot: SpeedBot, log: Log): Promise<void> {
    await clearModals(bot);
    await teleSpell(bot, 'varrock_teleport', 'varrock tele');
    log.split('tele-varrock');
    if (bot.minusedlevel === 0) {
        await go(bot, { x: 3284, z: 3494 }, 2, 'jolly boar', 300);
        await opLocUntil(bot, locHere(T.joStairs.id, T.joStairs.x, T.joStairs.z, 0), 1, () => bot.minusedlevel === 1, 'jolly boar stairs', { maxTicks: 30, every: 5 });
    }
    const seen = textWatch(bot);
    // his room door (3277,3501 a0) may be shut (chaos seed 4202): walk in first, the npc op never opens doors
    // session 11 fix 359 (FC_JOHN_ROAM; qx167m 'johnathon 1: npc 668 not opened at (3277,3501,L1)', 606 t): he wanders out of his
    // room (x 3276-3280, z 3502-3506) through the corridor into the EAST room (x 3281-3286, door 3284,3501; m51_54.jm2 L1); our
    // OPNPC route left the room, openNpc's stand return (5 t) and walkTo(spawn) (15 t) pulled us back: a 12 t loop
    // (3277,3502)->(3284,3500)->(3279,3504), eng-qx167 t39672-40278; the retry looped too until he stepped onto (3284,3501).
    // roam: chase him in view with the door-aware op only. =0 reverts.
    await converse(bot, N.johnathon, T.johnathon, () => -1, () => seen(/Sweat is pouring/i) || seen(/poison.. it is all/i), 'johnathon 1', { maxTicks: 40, stand: { x: 3279, z: 3502 }, roam: process.env.FC_JOHN_ROAM !== '0' });
    await untilChat(bot, () => bot.chatModalId === -1, 10);
    for (let k = 0; k < 4 && bot.count(O.antipoison) > 0; k++) {
        const n = npc(bot, N.johnathon); if (!n) { await go(bot, T.johnathon, 2, 'johnathon', 60); continue; }
        useOnNpc(bot, O.antipoison, n);
        await bot.until(() => bot.count(O.antipoison) === 0 || inDialog(bot), 10);
    }
    let bye = false;
    await chat(bot, (o) => {
        const a = o.findIndex(t => /I will be on my way now/i.test(t)); if (a >= 0) { bye = true; return a; }
        return o.findIndex(t => /Where can I find Chronozon/i.test(t));
    }, () => bye && bot.chatModalId === -1, 'johnathon cured', 40);
    log.split('johnathon');
}

async function chronozon(bot: SpeedBot, log: Log, g: ReturnType<typeof guard>): Promise<void> {
    await clearModals(bot);
    if (bot.tile().z < 6400) {
        await glory(bot, 1, 'glory edgeville');
        log.split('tele-edgeville');
        await wildStash(bot, 'crest chronozon');   // SR_GLORY_WILD=0: no glory into the dungeon's wilderness part (Varrock tele out)
        await go(bot, { x: 3097, z: 3469 }, 1, 'edgeville trapdoor', 200);
        for (let k = 0; k < 4 && bot.tile().z < 6400; k++) {
            const live = bot.liveLocs.get(`0,${T.edgeTrap.x},${T.edgeTrap.z}`) ?? 1568;
            const loc = { ...locHere(1568, T.edgeTrap.x, T.edgeTrap.z, 0), id: live };
            await opLocUntil(bot, loc, 1, () => bot.tile().z > 6400 || (live === 1568 && bot.liveLocs.get(`0,${T.edgeTrap.x},${T.edgeTrap.z}`) === 1570), 'edgeville trapdoor', { maxTicks: 15, every: 5 }).catch(() => undefined);
        }
        if (bot.tile().z < 6400) fail(bot, 'edgeville trapdoor');
        log.split('edge-dungeon');
    }
    // his lair gate (chronodoorl/r 3089-3090,9945 a1, category double_door_open_and_close_left: a teleport door): from
    // the north tile (3089,9946) one op lands ON the gate tile = inside (sim spc7: the walker sat 250 t at the shut gate)
    await go(bot, { x: 3089, z: 9946 }, 0, 'chronozon gate', 400);
    await doorFrom(bot, { id: 2432, x: 3089, z: 9945 }, { x: 3089, z: 9946 }, () => bot.tile().z <= 9945 && bot.tile().z > 6400, 'chronozon gate');
    pray(bot, 'protectfrommelee', true);
    await go(bot, { x: 3089, z: 9938 }, 3, 'chronozon', 100);
    log.split('chronozon-lair');
    // fix 301: SR_LOCK_FIX=0 reverts to the session-10 'nearest spider' handling below
    const LOCK = process.env.SR_LOCK_FIX !== '0';
    // fix 303a: the spider clears never fight Chronozon to break a lock (he holds it = our cast at him is allowed)
    const AVOID = [N.chronozon];
    // fix 303b (CONFIRMED qx65m: '[fc] wind_blast lock: attacker 134@3089,9940 still alive in 40 t' twice, 11 WIND blasts per
    // round on one poison spider (64 hp; engine [optrace] t39755-39825 + t39854-39929, all ACCEPT on 134@3089,9940), 22 death
    // runes gone and the spider alive, then 'out of blast runes (deathrune 0)'): break a spider lock with the strongest blast
    // the runes allow after reserving one cast of every weakening blast still needed, and stay on it up to FC_LOCK_TICKS
    // (default 90) so the spider dies in one go. FC_LOCK_STRONG=0 reverts (wind blast, 40 t).
    const STRONG = process.env.FC_LOCK_STRONG !== '0';
    const LOCK_TICKS = STRONG ? Number(process.env.FC_LOCK_TICKS ?? 90) : undefined;
    // fix 326 (qx60m/qx82m 'fire_blast: never landed on Chronozon', 'not enough Fire Runes'): the adjacent-spider kill below
    // cast a hard-coded fire_blast with no reserve (fire 97 -> 2 during the WIND phase, qx82m), and one reserved cast per
    // weaken blast left nothing for a splash. Now that kill uses lockSpell too, and the reserve is FC_LOCK_RESERVE (default 3)
    // casts of every weakening blast still needed. FC_RESERVE=0 reverts both.
    const RESERVE = process.env.FC_RESERVE !== '0';
    const RES_N = RESERVE ? Number(process.env.FC_LOCK_RESERVE ?? 3) : 1;
    const lockSpell = (still: string[]): string => {
        if (!STRONG) return 'wind_blast';
        const res: Record<string, number> = {};
        for (const s0 of still) for (const [r, n] of Object.entries(BLAST_RUNES[s0]!)) res[r] = (res[r] ?? 0) + n * RES_N;
        const ok = (s0: string) => Object.entries(BLAST_RUNES[s0]!).every(([r, n]) => bot.count(r) - (res[r] ?? 0) >= n);
        return ['fire_blast', 'earth_blast', 'water_blast', 'wind_blast'].find(ok) ?? 'wind_blast';
    };
    // session 11 fix 351 (qx150m seed 9550 'earth_blast: never landed on Chronozon': the reserve picked the lock spell ONCE per call and
    // castKill / breakCombatLock then cast it for up to 60/90 t: fire 87 -> 2 in the wind/water phases, earth 25 -> 1 on one
    // 90 t spider lock, so the earth weaken had no runes): re-pick before every cast. FC_LIVE_RES=0 reverts (one pick per call).
    const LIVE_RES = process.env.FC_LIVE_RES !== '0';
    const lockPick = (still: string[]): string | (() => string) => LIVE_RES ? () => lockSpell(still) : lockSpell(still);
    // fix 301 TEST (FC_LOCK_TEST=1): hit the nearest poison spider once so it swings back = a real single-way lock
    if (process.env.FC_LOCK_TEST === '1') {
        const sp = npcsOf(bot, [134])[0];
        if (sp) { const { spellCom } = await import('../../../core.js'); bot.opNpcT(sp.idx, spellCom('wind_blast')); bot.queueFlush(); await bot.until(() => lockAttackers(bot, [N.chronozon]).length > 0, 15); }
        console.log(`[fc] FC_LOCK_TEST: provoked spider ${sp ? `${sp.x},${sp.z} d${sp.d}` : 'none in view'}`);
    }
    // fix 303a TEST (FC_AVOID_TEST=1): make CHRONOZON hold the lock (one wind blast at him, he swings back), then run the
    // pre-cast spider clear with lockAvoid: it must stop at once instead of blasting him (qx60m)
    if (process.env.FC_AVOID_TEST === '1') {
        const c0 = npc(bot, N.chronozon), sp = npcsOf(bot, [134]).sort((a, b) => a.d - b.d)[0];
        if (c0) { const { spellCom } = await import('../../../core.js'); bot.opNpcT(c0.idx, spellCom('wind_blast')); bot.queueFlush(); await bot.until(() => facingNear(bot, [N.chronozon], 3).length > 0, 20); }
        const r0 = bot.tickCount, f0 = bot.count('firerune');
        if (sp) await castKill(bot, [134], 'fire_blast', 'poison spider', { done: () => !npcsOf(bot, [134]).some(q => q.idx === sp.idx), dead: () => g.dead, maxTicks: 60, range: 8, lockAvoid: AVOID }).catch(() => undefined);
        console.log(`[fc] FC_AVOID_TEST: chronozon ${c0 ? 'provoked' : 'not in view'}, chronozon facing+next to us ${facingNear(bot, [N.chronozon], 3).length > 0}, spider ${sp ? `${sp.x},${sp.z}` : 'none'}: clear ran ${bot.tickCount - r0} t, fire runes ${f0} -> ${bot.count('firerune')}`);
    }
    // one SUCCESSFUL hit of each blast ("Chronozon weakens..."), then kill him
    let locks = 0;
    const WEAKEN = ['wind_blast', 'water_blast', 'earth_blast', 'fire_blast'];
    // session 11 fix 392a (qx319m retry: the weaken bits survive a failed attempt (crest_chronozon.rs2:34), so on the retry a weaken
    // blast KILLED him (ai_queue3: crest dropped, no 'weakens' message, npc gone) and the loop failed 'fire_blast: never landed on
    // Chronozon' with his crest on the floor): stop weakening once he is gone and the crest lies there. FC_DEAD_STOP=0 reverts.
    const DEAD_STOP = process.env.FC_DEAD_STOP !== '0';
    const crestDrop = () => bot.findGroundItem(O.johnCrest, 12) !== undefined || bot.count(O.johnCrest) > 0;
    // fix 392a TEST (FC_DEADSTOP_TEST=1): play the qx319m retry: weaken AND kill him before the loop, so the loop starts with
    // Chronozon dead and his crest on the floor: it must break (DONE), not fail 'wind_blast: never landed' (FC_DEAD_STOP=0)
    if (process.env.FC_DEADSTOP_TEST === '1') {
        for (const s0 of WEAKEN) { const t1 = bot.tickCount; await castKill(bot, [N.chronozon], s0, 'chronozon', { done: () => msgsSince(bot, t1).some(t => /Chronozon weakens/.test(t)), dead: () => g.dead, maxTicks: 60, anchor: T.chronozon, lockSpell: lockPick([s0]), lockTicks: LOCK_TICKS }).catch(() => undefined); }
        await castKill(bot, [N.chronozon], () => BLASTS.find(([, need]) => Object.entries(need).every(([r, n]) => bot.count(r) >= n))?.[0] ?? 'wind_blast', 'chronozon', { done: crestDrop, dead: () => g.dead, maxTicks: 300, anchor: T.chronozon }).catch(() => undefined);
        console.log(`[fc] FC_DEADSTOP_TEST: chronozon ${npc(bot, N.chronozon) ? 'alive' : 'gone'}, crest on the floor ${crestDrop()}`);
    }
    for (const spell of WEAKEN) {
        if (DEAD_STOP && crestDrop()) break;
        let weakened = false;
        for (let k = 0; k < 5 && !weakened && !(DEAD_STOP && crestDrop()); k++) {
            const since = bot.tickCount;
            let c = npc(bot, N.chronozon); if (!c) { if (DEAD_STOP && await bot.until(crestDrop, 5)) break; await go(bot, T.chronozon, 4, 'chronozon', 60); continue; }
            // close in first: from 7 tiles with spiders around the casts never went out (sim spc9, runes unspent)
            if (c.d > 4) { await go(bot, { x: c.x, z: c.z }, 3, 'chronozon', 40).catch(() => undefined); c = npc(bot, N.chronozon) ?? c; }
            // poison spiders next to us: their hits seem to cancel the queued cast (sims spc10/spfc1: runes never spent)
            if (npcsOf(bot, [134]).some(q => q.d <= 1)) await castKill(bot, [134], RESERVE ? lockPick(WEAKEN.slice(WEAKEN.indexOf(spell))) : 'fire_blast', 'poison spider', { done: () => !npcsOf(bot, [134]).some(q => q.d <= 1), dead: () => g.dead, maxTicks: 60, range: 4, lockAvoid: AVOID, lockSpell: lockPick(WEAKEN.slice(WEAKEN.indexOf(spell))), lockTicks: LOCK_TICKS }).catch(() => undefined);
            c = npc(bot, N.chronozon) ?? c;
            bot.closeModal();   // clear any server-side suspended dialog (see sp-lib castKill)
            const { spellCom } = await import('../../../core.js');
            bot.opNpcT(c.idx, spellCom(spell)); bot.queueFlush();
            await bot.until(() => msgsSince(bot, since).some(t => /Chronozon weakens/.test(t)) || g.dead, 8);
            weakened = msgsSince(bot, since).some(t => /Chronozon weakens/.test(t));
            if (!weakened) console.log(`[fc] ${spell} try ${k + 1}: chronozon d${c.d} deathrunes ${bot.count('deathrune')} hp ${bot.stat('hitpoints').cur} pr ${bot.stat('prayer').cur} modal ${bot.mainModalId}/${bot.chatModalId} msgs ${JSON.stringify(msgsSince(bot, since).slice(-3))}`);
            // session 10 (qu23m): a spider out of reach still holds us in combat (single-way): kill the nearest one
            if (!weakened && LOCK && msgsSince(bot, since).some(t => /already under attack/i.test(t))) {
                console.log(`[fc] ${spell} lock: ${await breakCombatLock(bot, lockPick(WEAKEN.slice(WEAKEN.indexOf(spell))), 'chronozon', { notTypes: [N.chronozon], dead: () => g.dead, maxTicks: LOCK_TICKS })}`);
                k--;   // a refused cast spends no rune and is not a miss: the 5 tries count real casts (bounded by the 4 x 40 t below)
                if (++locks > 6) fail(bot, `${spell}: combat lock not broken after 6 tries`);
            } else if (!weakened && process.env.FC_KILL_SEG !== '0' && msgsSince(bot, since).some(t => /already under attack/i.test(t))) {
                const sp2 = npcsOf(bot, [134]).sort((a, b) => a.d - b.d)[0];
                if (sp2 && sp2.d <= 8) await castKill(bot, [134], spell, 'poison spider', { done: () => !npcsOf(bot, [134]).some(q => q.idx === sp2.idx), dead: () => g.dead, maxTicks: 40, range: 5 }).catch(() => undefined);
            }
            if (g.dead) fail(bot, 'died to Chronozon');
        }
        if (!weakened && !(DEAD_STOP && crestDrop())) fail(bot, `${spell}: never landed on Chronozon`);
    }
    log.split('blasts');
    const crestDone = () => bot.findGroundItem(O.johnCrest, 12) !== undefined || bot.count(O.johnCrest) > 0;
    if (process.env.FC_KILL_SEG === '0') await castKill(bot, [N.chronozon], 'fire_blast', 'chronozon', { done: crestDone, dead: () => g.dead, maxTicks: 300, anchor: T.chronozon });
    else {
        // session 10 (allchaos qu23m: 'I'm already under attack!' from poison spiders, then OUT OF FIRE RUNES after 10 fire
        // blasts, 'spell kill not done'): the kill in 60 t segments; each picks the strongest blast the runes still allow
        // (all four bits are set, any blast hurts him) and first kills a spider that holds us in combat (single-way zone)
        const tEnd = bot.tickCount + 420;
        while (!crestDone() && bot.tickCount < tEnd && !g.dead) {
            const sp = BLASTS.find(([, need]) => Object.entries(need).every(([r, n]) => bot.count(r) >= n));
            if (!sp) fail(bot, `chronozon: out of blast runes (${['firerune', 'earthrune', 'waterrune', 'airrune', 'deathrune'].map(r => `${r} ${bot.count(r)}`).join(', ')})`);
            const since = bot.tickCount;
            await castKill(bot, [N.chronozon], sp[0], 'chronozon', { done: () => crestDone() || (!LOCK && hasMsg(bot, since, /already under attack/i)), dead: () => g.dead, maxTicks: 60, anchor: T.chronozon, lockSpell: STRONG ? sp[0] : undefined, lockTicks: LOCK_TICKS }).catch(() => undefined);
            if (!LOCK && hasMsg(bot, since, /already under attack/i)) {
                const sp2 = npcsOf(bot, [134]).sort((a, b) => a.d - b.d)[0];
                console.log(`[fc] chronozon kill: under attack, spider ${sp2 ? `${sp2.x},${sp2.z} d${sp2.d}` : 'none in view'} (${sp[0]})`);
                if (sp2 && sp2.d <= 8) { const s0 = bot.tickCount; await castKill(bot, [134], sp[0], 'poison spider', { done: () => !npcsOf(bot, [134]).some(q => q.idx === sp2.idx), dead: () => g.dead, maxTicks: 40, range: 5 }).catch(() => undefined); console.log(`[fc] spider fight ${bot.tickCount - s0} t`); }
                else await bot.tick(4);
            }
        }
        if (!crestDone()) fail(bot, 'chronozon: spell kill not done');
    }
    if (bot.count(O.johnCrest) === 0) await pickup(bot, O.johnCrest, 'johnathon crest');
    pray(bot, 'protectfrommelee', false);
    log.split('chronozon');
}

// blast rune costs (fire 5+4 air, earth 4+3 air, water 3+3 air, wind 3 air; 1 death each), strongest first
const BLAST_RUNES: Record<string, Record<string, number>> = { fire_blast: { firerune: 5, airrune: 4, deathrune: 1 }, earth_blast: { earthrune: 4, airrune: 3, deathrune: 1 },
    water_blast: { waterrune: 3, airrune: 3, deathrune: 1 }, wind_blast: { airrune: 3, deathrune: 1 } };
const BLASTS: Array<[string, Record<string, number>]> = Object.entries(BLAST_RUNES);

async function finish(bot: SpeedBot, log: Log): Promise<boolean> {
    await clearModals(bot);
    // fix 419: never combine short (quest_crest.rs2:117-125 needs all three in the pack): re-get Caleb's / Avan's piece first
    if (REGAIN && bot.count(O.crest) === 0 && (bot.count(O.avanCrest) === 0 || bot.count(O.calebCrest) === 0)) await regainPieces(bot, log);
    if (bot.count(O.crest) === 0 && bot.count(O.johnCrest) === 0) fail(bot, `crest: johnathon_crest missing at the combine (${piecesStr(bot)}): Chronozon again`);
    if (bot.count(O.crest) === 0) {
        useItemOnItem(bot, O.avanCrest, O.calebCrest);
        await bot.until(() => bot.count(O.crest) > 0, 6);
        if (bot.count(O.crest) === 0) { useItemOnItem(bot, O.johnCrest, O.avanCrest); await bot.until(() => bot.count(O.crest) > 0, 6); }
        if (bot.count(O.crest) === 0) fail(bot, 'crest did not combine');
    }
    await teleSpell(bot, 'varrock_teleport', 'varrock tele 2');
    // Dimintheis's house (door 3278,3404 on its south side) is reached only through Varrock's east gate (guidorgatelclosed
    // 3264,3405, area_varrock/scripts/east_gate.rs2 _varrock_gate: a members teleport gate the walker does not open; sims
    // spc8/spc12 wedged 120-160 t there). Op it from the west tile (3263,3405).
    await go(bot, { x: 3263, z: 3405 }, 0, 'varrock east gate', 200);
    const gate = locHere(2050, 3264, 3405, 0);
    for (let k = 0; k < 5 && bot.tile().x < 3264; k++) { bot.opLoc(gate.x, gate.z, gate.id, 1); bot.queueFlush(); await bot.until(() => bot.tile().x >= 3264, 6); }
    if (bot.tile().x < 3264) fail(bot, "varrock east gate");   // a0 = west edge of x3264: x3264 is through
    const seen = textWatch(bot);
    const done = () => seen(/completed the.*Family Crest/is) || seen(/Family Crest Quest/i) || bot.mainModalId === 297;
    await converse(bot, N.dimintheis, T.dimintheis, () => -1, () => done() || (bot.count(O.crest) === 0 && bot.chatModalId === -1), 'dimintheis finish', { maxTicks: 60, stand: { x: 3279, z: 3403 } });
    await bot.until(done, 20);
    log.split('finish');
    return done();
}

export async function run(bot: SpeedBot, o: { log?: boolean; from?: Phase } = {}): Promise<{ ok: boolean; ticks: number; msg: string }> {
    await nav();
    bot.holdDialogs = true;
    const log = mkLog(bot, 'fc', o.log !== false);
    const t0 = bot.tickCount;
    const g = guard(bot, 0.5);
    startWarningCloser(bot); textLog(bot); spTrace(bot, 'C'); retaliateOff(bot);
    // session 10 (allchaos qu23m: the retry restarted at Dimintheis -> 'dimintheis: chat not done'): on a retry, the phase
    // the quest JOURNAL shows (crest_journal.rs2; FC_RESUME=0 = from the top)
    let jFrom: Phase | undefined;
    if (!o.from && isResuming(bot) && process.env.FC_RESUME !== '0') {
        await clearModals(bot);
        const has = (n: string) => bot.count(objId(n)) > 0;
        const st = await journalStage<string>(bot, 'crest', JOURNAL, 'dimintheis', s => console.log(`[fc] ${s}`));
        if (st === 'done') return { ok: true, ticks: bot.tickCount - t0, msg: 'journal: quest complete' };
        // fix 419: up front, which pieces are held (pack / bank as last seen); a banked one comes back now
        if (REGAIN) { console.log(`[fc] pieces at resume (${st}): ${piecesStr(bot)}`); await pullBanked(bot, 'resume'); }
        if (REGAIN && (bot.count('lawrune') < 3 || bot.count('airrune') < 11)) console.log(`[fc] WARNING resume: teleport runes low (law ${bot.count('lawrune')}, air ${bot.count('airrune')}, fire ${bot.count('firerune')}, earth ${bot.count('earthrune')})`);
        jFrom = st === 'chronozon' && (bot.count(O.johnCrest) > 0 || bot.count(O.crest) > 0) ? 'finish'
            : st === 'gold' && has('perfect_ruby_ring') && has('perfect_ruby_necklace') ? 'avan2'
            : st === 'gold' && bot.count(objId('perfect_gold_bar')) >= 2 ? 'jewellery' : st as Phase;
        console.log(`[fc] resume from phase ${jFrom}`);
    }
    const from = PHASES.indexOf(o.from ?? jFrom ?? 'dimintheis');
    const doPh = (p: Phase) => PHASES.indexOf(p) >= from;
    try {
        if (doPh('dimintheis')) await dimintheis(bot, log);
        if (doPh('caleb')) await caleb(bot, log);
        if (doPh('gem')) await gemTrader(bot, log);
        if (doPh('avan')) await avan1(bot, log);
        if (doPh('boot')) await boot(bot, log);
        if (doPh('gold')) await gold(bot, log, g);
        if (doPh('jewellery')) await jewellery(bot, log);
        if (doPh('avan2')) await avan2(bot, log);
        if (doPh('johnathon')) await johnathon(bot, log);
        // fix 419: every run, whatever phase it resumed at (was: only from > 'avan2' -> acct25 resumed at 'gold' never asked
        // Caleb). Here the stage is >= 9 (Johnathon spoken), so both givers offer 'lost'. TEST FC_TEST419=avan|caleb|both drops
        // that piece right before (sim: the live state of a piece lost after it was handed over).
        if (process.env.FC_TEST419) for (const [n, id] of PIECES()) if (process.env.FC_TEST419 === 'both' ? n !== 'johnathon_crest' : n === `${process.env.FC_TEST419}_crest`) {
            if (bot.count(id) > 0 && !(globalThis as any).__fc419) { bot.dropItem(id, bot.slot(id)); bot.queueFlush(); await bot.tick(2); console.log(`[fc] FC_TEST419: dropped ${n} (held ${bot.count(id)})`); }
        }
        (globalThis as any).__fc419 = 1;
        if (REGAIN) await regainPieces(bot, log);
        if (doPh('chronozon') || (REGAIN && bot.count(O.johnCrest) === 0 && bot.count(O.crest) === 0)) await chronozon(bot, log, g);
        if (!(await finish(bot, log))) fail(bot, 'quest not complete after the hand-in');
        return { ok: true, ticks: bot.tickCount - t0, msg: `splits ${JSON.stringify(log.splits)} ate ${g.ate}` };
    } catch (e) {
        return { ok: false, ticks: bot.tickCount - t0, msg: `${(e as Error).message} | splits ${JSON.stringify(log.splits)}` };
    } finally { g.stop = true; }
}
