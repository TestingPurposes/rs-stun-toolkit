// q-demon-slayer.ts — Demon Slayer (quest_demon), cheat-free. Content: quests/quest_demon/scripts/{demon_slayer,delrith}.rs2,
// configs/demon.constant (talked_aris 1, key_hunt 2, find_bones 3, +1 per bone, got_traiborn_key 28, silverlight 29),
// areas/area_varrock/scripts/{gypsy,sir_prysin,captain_rovin}.rs2, areas/area_draynor/scripts/traiborn.rs2,
// skill_combat/scripts/npc/npc_combat.rs2:174-186 (Delrith: Silverlight worn).
//
// PACK LIMIT drives the order: Traiborn wants 25 UNNOTED bones (inv_total(inv, bones), traiborn.rs2:13/23), and 25 bones +
// the coins, bucket, keys and teleport runes do not fit in 28 slots. So the bones come from a bank on the way (Draynor, between
// the Lumbridge Teleport landing and the Wizards' Tower), Traiborn is visited BEFORE Rovin and the sewer (no keys held yet),
// and a wielded staff of air replaces the air runes (one slot). At Traiborn the pack is exactly law, fire, bucket of water +
// 25 bones = 28.
// Flow (every step gated on an observable):
//  1. Gypsy Aris (npc 882, Varrock square tent (3203,3424)): "Ok, here you go." (1 coin) ... "Who's Delrith?" ...
//     -> %demonstart = 1 + journal colour (gypsy.rs2:159-241). Rest skipped.
//  2. Sir Prysin (883, palace (3204,3473)): "Gypsy Aris said I should come and talk to you." / "I need to find Silverlight." /
//     any / "And why is this a problem?" -> %demonstart = 2 (sir_prysin.rs2:123); observable: the choice3 that follows it
//     ("Can you give me your key?" / "Where does the wizard live?"). Rest skipped.
//  3. Lumbridge Teleport (law, earth; air from the staff) -> Draynor bank: withdraw 25 bones -> Wizards' Tower L1, Traiborn
//     (881, (3112,3162)): "I need to get a key given to you by Sir Prysin." / "Well, have you got any keys knocking around?" /
//     "I'll get the bones for you." -> %demonstart = 3; re-talk: 25 bones, one per p_delay(1) (traiborn.rs2:22-32) ->
//     silverlight_key_1 (:200-211), %demonstart = 28.
//  4. Varrock Teleport (law, fire) -> Captain Rovin (884, palace L2 (3204,3496)): "Yes I know, but this is important." /
//     "There's a demon who wants to invade this city." -> silverlight_key_2 (captain_rovin.rs2:27-45; %demonstart 2..28).
//  5. Drain (loc 2843 questdrain (3225,3495)): use bucket_water (demon_slayer.rs2:22-40, no stage check) -> key 3 obj_add at
//     (3225,9897) in the sewer for 300 t. Manhole 881 (3237,3458) -> sewer, take the key, ladder 1755 (3230,9904) up.
//  6. Sir Prysin: all three keys -> Silverlight (sir_prysin.rs2:64-76).
//  7. Wield Silverlight, attack Delrith (879, stone circle (3229,3369), 7 hp; npc_combat.rs2:174-186 wants it worn). At 0 hp
//     he weakens (delrith.rs2:4-14) and the incantation choice opens on the player: option 4 "Carlem Aber Camerinthum
//     Purchai Gabindo" -> queue(demon_slayer_complete): +3 qp.
import type { SpeedBot } from '../../../core.js';
import { objId } from '../../../core.js';
import { R, M2, M3, M4, npc, tele, locAt, useOnLocGo, msgsSince, type FTok } from '../../q-lib.js';
import { converse, pickup, opLocUntil, useOnLocUntil, mkLog, qp, qStatus, closeChat, pagesUntil, wear, walk, eatWatch, dead, fail, cheb, msgSince,
    type Item, type QuestDef, type Requirements, type RunResult } from './fa-lib.js';

declare const process: { env: Record<string, string | undefined> };

export const QUEST: QuestDef = { name: 'Demon Slayer', dir: 'quest_demon', qp: 3 };
export const REQUIREMENTS: Requirements = {
    quests: [], qp: 0,
    skills: {
        magic: [31, 'Lumbridge Teleport to the Wizards\' Tower and Varrock Teleport back (magic_spells.dbrow levelrequired 31/25)'],
        attack: [20, "Delrith (cl27, def 27, 7 hp) with Silverlight. ALSO COMBAT LEVEL >= 41 (checked in run()): the stone circle's eight dark wizards (cl20/cl7, huntmode ranged = check_nottoostrong outside_wilderness, _unpack/225/all.hunt:2-5) hunt any player of combat <= 40 (engine Npc.ts:1011, > vislevel*2), and while one is on you Delrith cannot be attacked ('I'm already under attack!', fa31-fa33 at cl 30)"],
    },
    start: { x: 3204, z: 3424, level: 0 },   // Varrock square, next to Gypsy Aris' tent
    end: { x: 3227, z: 3370, level: 0 },     // the stone circle south of Varrock
};
export const SUPPLY: Item[] = [
    { name: 'coins', n: 1 },                  // Aris (gypsy.rs2:162-165)
    { name: 'bucket_water', n: 1 },           // the drain (demon_slayer.rs2:24)
    { name: 'lawrune', n: 2 }, { name: 'earthrune', n: 1 }, { name: 'firerune', n: 1 },   // Lumbridge + Varrock Teleport
    { name: 'staff_of_air', n: 1 },           // wielded: the air runes for both teleports, one slot saved
];
/** staged in the bank (Draynor) or handed over by a helper at the Wizards' Tower */
export const SUPPLY_BANK: Item[] = [{ name: 'bones', n: 25 }];
export const DRAYNOR_BANK = { x: 3092, z: 3244 };
const ARIS = 882, PRYSIN = 883, ROVIN = 884, TRAIBORN = 881, DELRITH = 879, DELRITH_WEAK = 880;
const ARIS_AT = { x: 3203, z: 3424 }, PRYSIN_AT = { x: 3204, z: 3473 }, ROVIN_AT = { x: 3204, z: 3496, level: 2 };
const TRAIBORN_AT = { x: 3112, z: 3162, level: 1 }, DELRITH_AT = { x: 3229, z: 3369 };
const DRAIN = { id: 2843, x: 3225, z: 3495 }, MANHOLE_SHUT = { id: 881, x: 3237, z: 3458 }, MANHOLE_OPEN = 882;
const SEWER_LADDER_S = { id: 1755, x: 3237, z: 9858 }, KEY3_AT = { x: 3225, z: 9897 };
type Loc = { id: number; x: number; z: number; level?: number };
const PALACE_SPIRAL0: Loc = { id: 1738, x: 3202, z: 3497 }, PALACE_SPIRAL1: Loc = { id: 1739, x: 3202, z: 3497 }, PALACE_SPIRAL2: Loc = { id: 1740, x: 3203, z: 3497 };
const TOWER_STAIRS0: Loc = { id: 1738, x: 3103, z: 3159 }, TOWER_STAIRS_TOP: Loc = { id: 1739, x: 3103, z: 3159, level: 1 };
const K1 = 'silverlight_key_1', K2 = 'silverlight_key_2', K3 = 'silverlight_key_3', SL = 'silverlight';

/** o.helper: a player who trades the 25 bones at Traiborn's floor (Wizards' Tower L1) instead of the Draynor bank stage */
/** combat level (rev-289 formula: 0.25*(def+hp+floor(prayer/2)) + max(0.325*(att+str), 0.325*floor(1.5*ranged), 0.325*floor(1.5*magic))) */
export function combatLevel(bot: SpeedBot): number {
    const b = (k: string) => bot.stat(k).level;
    return Math.floor(0.25 * (b('defence') + b('hitpoints') + Math.floor(b('prayer') / 2)) + 0.325 * Math.max(b('attack') + b('strength'), Math.floor(1.5 * b('ranged')), Math.floor(1.5 * b('magic'))));
}
export async function run(bot: SpeedBot, o: { log?: boolean; helper?: string } = {}): Promise<RunResult> {
    const t0 = bot.tickCount, qp0 = qp(bot), L = mkLog(bot, 'demon', !!o.log);
    if (combatLevel(bot) < 41) return { ok: false, ticks: 0, msg: `combat level ${combatLevel(bot)} < 41: the stone-circle dark wizards would block Delrith (see REQUIREMENTS)` };
    const stopEat = eatWatch(bot);
    try { return await body(bot, L, t0, qp0, o.helper); }
    finally { stopEat(); }
}

async function body(bot: SpeedBot, L: (s: string) => void, t0: number, qp0: number, helper?: string): Promise<RunResult> {
    const has = (n: string) => bot.count(n) > 0 || bot.isWorn(objId(n));
    const check = () => { if (dead(bot)) fail(bot, 'died'); };
    const st = () => qStatus(bot, 'demon');
    const optsHave = (re: RegExp) => bot.dialogOptions().some(x => re.test(x.text));
    let keyHunt = has(K1) || has(K2) || has(K3) || has(SL);
    const airOk = () => bot.isWorn(objId('staff_of_air'));
    if (bot.count('staff_of_air') > 0) await wear(bot, 'staff_of_air', 4);
    // drop what this quest never uses (the pack must hold 25 bones at Traiborn)
    // route runner: + the travel kit (water runes, glory) so a chained route can teleport on
    const KEEP = ['coins', 'bucket_water', 'lawrune', 'earthrune', 'firerune', 'airrune', 'waterrune', 'amulet_of_glory_1', 'amulet_of_glory_2', 'amulet_of_glory_3', 'amulet_of_glory_4', 'staff_of_air', 'bones', K1, K2, K3, SL, 'lobster', 'shark'];
    const junk = bot.inv().filter(x => !KEEP.map(k => objId(k)).includes(x.obj));
    if (junk.length) { for (const j of junk) bot.dropItem(j.obj, j.slot); bot.queueFlush(); await bot.tick(1); }

    // stairs: L0 spiral (op1 Climb-up) -> L1 middle (op2 Climb-up; op1 is the up/down menu) -> L2; down: L2 top op1, L1 middle op3
    const up = async (s0: Loc, s1: Loc, stand?: { x: number; z: number }) => {
        if (bot.minusedlevel === 0 && !(await opLocUntil(bot, s0, 1, () => bot.minusedlevel === 1, 300, stand))) fail(bot, `stairs up ${s0.x},${s0.z}`);
        if (bot.minusedlevel === 1 && !(await opLocUntil(bot, { ...s1, level: 1 }, 2, () => bot.minusedlevel === 2, 30))) fail(bot, `stairs up L1 ${s1.x},${s1.z}`);
    };
    const down = async (s2: Loc, s1: Loc) => {
        if (bot.minusedlevel === 2 && !(await opLocUntil(bot, { ...s2, level: 2 }, 1, () => bot.minusedlevel === 1, 30))) fail(bot, `stairs down L2 ${s2.x},${s2.z}`);
        if (bot.minusedlevel === 1 && !(await opLocUntil(bot, { ...s1, level: 1 }, 3, () => bot.minusedlevel === 0, 30))) fail(bot, `stairs down L1 ${s1.x},${s1.z}`);
    };
    const inSewer = () => bot.tile().z > 6400;
    const sewer = async (climbOut = true) => {
        // door-aware walk to the drain's interaction tile, then the use (fa61: the plain route stopped at the closed kitchen
        // door 1514 (3224,3493) on a chaos engine)
        const pourTick = bot.tickCount;
        if (bot.slot('bucket_water') < 0) fail(bot, 'no bucket_water');
        await useOnLocUntil(bot, DRAIN, 'bucket_water', () => msgSince(bot, pourTick, /washed the key down/), 400);
        if (!msgSince(bot, pourTick, /washed the key down/)) fail(bot, 'drain pour');
        L('poured');
        if (bot.count('bucket_empty') > 0) { bot.dropItem(objId('bucket_empty'), bot.slot('bucket_empty')); bot.queueFlush(); }   // the slot is needed for the bones
        // manhole: stand north of it, open it (881 -> 882 for 400 t), climb down (882 telejumps +6400). The client's view of
        // the cover can be stale (fa19: a cover left open by an earlier player read as shut and every op was discarded), so
        // the ops alternate between the two ids until we are below
        const mOpen = () => bot.liveLocs.get(`0,${MANHOLE_SHUT.x},${MANHOLE_SHUT.z}`) === MANHOLE_OPEN;
        await walk(bot, { x: MANHOLE_SHUT.x, z: MANHOLE_SHUT.z + 1 }, 0, 'manhole', 400);
        for (let k = 0; k < 12 && !inSewer(); k++) {
            const id = (mOpen() ? k : k + 1) % 2 === 0 ? MANHOLE_OPEN : MANHOLE_SHUT.id;
            closeChat(bot); bot.opLoc(MANHOLE_SHUT.x, MANHOLE_SHUT.z, id, 1); bot.queueFlush();
            await bot.until(() => inSewer() || (id === MANHOLE_SHUT.id && mOpen()), 4);
        }
        if (!inSewer()) fail(bot, 'manhole');
        L('sewer');
        // out by the manhole ladder (3237,9858): the north ladder (3230,9904) is 7 tiles from the key as the crow flies but
        // walled off from it; its reach-aware path is ~150 tiles past four armed zombies (cl24; fa20 died there at def 20 /
        // hp 30). probe-locpath.ts: key -> north ladder 30 corners via (3281,9898); key -> manhole ladder 9 corners.
        if (!(await pickup(bot, K3, KEY3_AT, 200))) fail(bot, 'key 3 in the sewer');
        L('key 3');
        if (!climbOut) return;   // a teleport leaves the sewer
        if (!(await opLocUntil(bot, SEWER_LADDER_S, 1, () => !inSewer(), 200))) fail(bot, 'sewer ladder');
        L('sewer ladder up');
        check();
    };

    // 1. Aris
    if (st() === 'NOT_STARTED' || st() === 'NOT_OBSERVABLE') {
        const ok = await converse(bot, ARIS, {
            plan: [R, M3[0]!, R, R, R, R, R, R, M3[0]!, R, R, M2[0]!, R, R, R, R, R, R, R, M3[1]!, R, R, R, R, R, R],
            stand: ARIS_AT, near: 8, label: 'aris', log: L, maxTicks: 100,
            answers: [/^Ok, here you go\.$/, /^Very interesting/, /^Who's Delrith\?$/, /^Okay, where is he\? I'll kill him for you!$/],
            done: () => st() === 'IN_PROGRESS',
        });
        if (!ok) fail(bot, `Aris: not started (${st()})`);
        closeChat(bot);
        L('aris');
    }
    // 2. Prysin: key hunt
    if (!keyHunt) {
        const ok = await converse(bot, PRYSIN, {
            plan: [R, M3[2]!, R, R, R, M2[0]!, R, R, R, R, M2[0]!, R, R, R, R, R, R, M2[1]!, R, R, R, R],
            stand: PRYSIN_AT, near: 8, label: 'prysin1', log: L, maxTicks: 200,
            answers: [/^Gypsy Aris said I should come and talk to you\.$/, /^I need to find Silverlight\.$/, /^Well, the gypsy's crystal ball/, /^And why is this a problem\?$/],
            done: () => optsHave(/^Where does the wizard live\?$/) && optsHave(/^Can you give me your key\?$/),
        });
        if (!ok) fail(bot, 'Prysin: no key hunt');
        closeChat(bot); keyHunt = true;
        L('prysin1');
    }
    check();
    // 2b. sewer FIRST (default): the drain is 30 tiles from Prysin, and the Lumbridge Teleport leaves straight from the sewer
    // (no ladder). Key 3 takes the slot the bucket frees, so the pack still fits 25 bones at Traiborn (law, fire, key 3 + 25).
    // FA_TRAIBORNFIRST=1 = the old order (Traiborn, Varrock Teleport, sewer, Rovin) for the A/B.
    const sewerFirst = !process.env.FA_TRAIBORNFIRST;
    if (sewerFirst && !has(K3) && !has(SL) && !has(K1)) await sewer(false);
    // 3. Traiborn (Wizards' Tower L1): Lumbridge Teleport when possible, bones from Draynor bank
    if (!has(K1) && !has(SL)) {
        if (!process.env.FA_NOTELE && bot.stat('magic').level >= 31 && bot.count('lawrune') >= 1 && (airOk() || bot.count('airrune') >= 3) && bot.count('earthrune') >= 1) {
            closeChat(bot); const r = await tele(bot, 'lumbridge_teleport'); L(`lumbridge teleport ${r.ok}`);
        }
        if (inSewer() && !(await opLocUntil(bot, SEWER_LADDER_S, 1, () => !inSewer(), 200))) fail(bot, 'sewer ladder (no teleport)');
        // the empty bucket must go before the 25 bones arrive (a drop sent during the drain script's p_delay is ignored)
        for (let k = 0; k < 4 && bot.count('bucket_empty') > 0; k++) { bot.dropItem(objId('bucket_empty'), bot.slot('bucket_empty')); bot.queueFlush(); await bot.tick(1); }
        const towerUp = async () => {   // the tower stairs (3103,3159) by hand: LeanBot's multi-level traveller lost ~40 t here
            if (bot.minusedlevel === 0) { await walk(bot, { x: 3105, z: 3160 }, 1, 'tower stairs', 800); if (!(await opLocUntil(bot, TOWER_STAIRS0, 1, () => bot.minusedlevel === 1, 60))) fail(bot, 'tower stairs up'); }
        };
        if (bot.count('bones') < 25 && helper) {
            // the helper hand-off on Traiborn's floor (a trade: both sides request, the trainee accepts both screens)
            await towerUp();
            await walk(bot, TRAIBORN_AT, 1, 'Traiborn (helper)', 800);
            // route runner (fix 57, qrh7m 'helper: bones 0/25' x2, the trade window stuck on modal 3323): the route's travel kit
            // left 20 free slots and the 25-bone trade could not land. Free the slots with what the rest of the quest never uses
            // (only the Varrock Teleport follows: law + fire + the worn staff of air)
            // glory guard: glories are never dropped. They go last: worn (frees the slot
            // when the neck slot is empty), and if the bones still do not fit, the bank stage below takes over (it deposits them).
            const GLORIES = ['amulet_of_glory', 'amulet_of_glory_1', 'amulet_of_glory_2', 'amulet_of_glory_3', 'amulet_of_glory_4'];
            for (const junk of ['waterrune', ...(bot.gloryGuard ? [] : GLORIES.slice(1)), 'coins', 'earthrune', ...(airOk() ? ['airrune'] : []), ...(bot.count(K3) ? ['bucket_water'] : [])]) {
                if (bot.free() >= 25 - bot.count('bones')) break;
                if (bot.count(junk) > 0) { bot.dropItem(objId(junk), bot.slot(junk)); bot.queueFlush(); await bot.tick(1); }
            }
            if (bot.gloryGuard) for (const g of GLORIES) { if (bot.free() >= 25 - bot.count('bones')) break; if (bot.count(g) > 0) await wear(bot, g, 4); }
            if (bot.free() < 25 - bot.count('bones')) L(`helper: no room for the bones (glories are never dropped; free ${bot.free()}): bank stage instead`);
            else {
                for (let k = 0; k < 3 && bot.count('bones') < 25; k++) { const r = await bot.acceptTradeFrom(helper, { maxTicks: 60, maxDist: 12 }); L(`helper trade ${JSON.stringify(r)}`); }
                if (bot.count('bones') < 25) fail(bot, `helper: bones ${bot.count('bones')}/25`);
            }
        }
        if (bot.count('bones') < 25) {
            // the bank stage: Draynor bank is on the way from the Lumbridge Teleport landing to the tower
            await walk(bot, DRAYNOR_BANK, 3, 'Draynor bank', 600);
            const ob = await bot.openBank({ radius: 12 });
            if (!ob.ok) fail(bot, `Draynor bank: ${ob.message}`);
            const keep = ['lawrune', 'firerune', 'earthrune', 'bucket_water', 'bones', K1, K2, K3, SL, 'staff_of_air'];
            if (bot.count('bucket_empty') > 0) { bot.dropItem(objId('bucket_empty'), bot.slot('bucket_empty')); bot.queueFlush(); }
            const dep = bot.inv().filter(x => !keep.map(k => objId(k)).includes(x.obj));
            if (dep.length) await bot.depositAll(keep);
            if (bot.bankCount('bones') < 25 - bot.count('bones')) fail(bot, `Draynor bank holds ${bot.bankCount('bones')} bones`);
            const r = await bot.withdraw('bones', 25 - bot.count('bones'), { noted: false });
            bot.closeBank(); await bot.tick(1);
            if (bot.count('bones') < 25) fail(bot, `bones ${bot.count('bones')}/25 after the bank (${JSON.stringify(r)})`);
            L('bank: 25 bones');
        }
        await towerUp();
        await walk(bot, TRAIBORN_AT, 1, 'Traiborn', 200);
        L('tower L1');
        let bones = bot.count('bones'), bonesTick = -99;
        const watch = () => { const b = bot.count('bones'); if (b !== bones) { bones = b; bonesTick = bot.tickCount; } };
        const reop: FTok = { fn: () => { const n = npc(bot, TRAIBORN); if (n) bot.opNpc(n.idx, 1); }, cost: 1 };
        const ok = await converse(bot, TRAIBORN, {
            plan: [R, M3[2]!, R, R, M3[2]!, R, R, R, R, R, R, R, M2[1]!, R, R, R], after: [reop],
            stand: TRAIBORN_AT, near: 8, label: 'traiborn', log: L, maxTicks: 300, tries: 6,
            answers: [/^I need to get a key given to you by Sir Prysin\.$/, /^Well, have you got any keys knocking around\?$/, /^I'll get the bones for you\.$/],
            done: () => { watch(); return has(K1); },
            wait: () => { watch(); return bot.tickCount - bonesTick <= 4; },
        });
        if (!ok) fail(bot, `Traiborn: no key (bones left ${bot.count('bones')})`);
        closeChat(bot);
        L('key 1');
    }
    check();
    // 4. Varrock Teleport -> the drain (outside the palace kitchen) -> sewer key -> north sewer ladder (or the manhole ladder)
    if (!process.env.FA_NOTELE && bot.minusedlevel === 1 && bot.tile().x < 3150 && bot.stat('magic').level >= 25 && bot.count('lawrune') >= 1 && (airOk() || bot.count('airrune') >= 3) && bot.count('firerune') >= 1) {
        closeChat(bot); const r = await tele(bot, 'varrock_teleport'); L(`varrock teleport ${r.ok}`);
    }
    if (bot.minusedlevel !== 0) {   // no teleport: down the tower stairs first
        if (!(await opLocUntil(bot, TOWER_STAIRS_TOP, 3, () => bot.minusedlevel === 0, 100))) fail(bot, 'tower stairs down');
    }
    if (!has(K3) && !has(SL)) {
        if (!process.env.FA_ROVINFIRST) await sewer();
    }
    // 5. Rovin (palace L2, spiral stairs (3202,3497))
    if (!has(K2) && !has(SL)) {
        await up(PALACE_SPIRAL0, PALACE_SPIRAL1, { x: 3203, z: 3496 });
        const ok = await converse(bot, ROVIN, {
            plan: [R, M3[2]!, R, R, M3[0]!, R, R, R, R, R, R, R, R],
            stand: ROVIN_AT, near: 8, label: 'rovin', log: L, maxTicks: 100,
            answers: [/^Yes I know, but this is important\.$/, /^There's a demon who wants to invade this city\.$/],
            done: () => has(K2),
        });
        if (!ok) fail(bot, 'Rovin: no key');
        L('rovin key');
        await down(PALACE_SPIRAL2, PALACE_SPIRAL1);
    }
    if (!has(K3) && !has(SL)) await sewer();
    check();
    // 6. Prysin: Silverlight
    if (!has(SL)) {
        if (bot.minusedlevel !== 0) await walk(bot, { ...PRYSIN_AT, level: 0 }, 4, 'Prysin (down)', 800);
        const ok = await converse(bot, PRYSIN, {
            plan: [R, R, R], stand: PRYSIN_AT, near: 8, label: 'prysin2', log: L, maxTicks: 400,
            answers: [],
            done: () => has(SL),
        });
        if (!ok) fail(bot, 'Prysin: no Silverlight');
        L('silverlight');
    }
    // 7. Delrith
    closeChat(bot);
    if (!(await wear(bot, SL, 4))) fail(bot, 'wield Silverlight');
    const done = () => qp(bot) > qp0;
    // eight dark wizards (cl7/cl20, spell casters) stand in the circle; they hunt players of combat <= 40 only (see REQUIREMENTS).
    // (at combat >= 41 the wizards ignore us; Protect from Magic is only a fallback should one still engage)
    const pfm = () => { if (bot.stat('hitpoints').cur < bot.stat('hitpoints').level && bot.stat('prayer').cur >= 1 && bot.stat('prayer').level >= 37 && !bot.isPrayerActive('protectfrommagic')) { bot.activatePrayer('protectfrommagic'); bot.queueFlush(); } };
    await walk(bot, { x: DELRITH_AT.x - 2, z: DELRITH_AT.z + 14 }, 3, 'north of the stone circle', 600);
    pfm();
    // auto-retaliate OFF: a dark wizard's (blocked) spell otherwise turns our attack onto the wizard, and below attack ~40
    // Delrith never died (fa29/fa31: 300 t in the circle, then prayer out and death). Restored after the fight.
    bot.ifButton(151); bot.queueFlush();   // LeanBot.RETALIATE_OFF_BUTTON (controls: %option_nodef)
    await walk(bot, { x: DELRITH_AT.x - 2, z: DELRITH_AT.z + 2 }, 4, 'stone circle', 100);
    L('circle');
    let lastAtk = -99;
    const end = bot.tickCount + 400;
    while (!done() && bot.tickCount < end) {
        check(); pfm();
        if ((bot.tickCount - t0) % 10 === 0) L(`fight: hp ${bot.stat('hitpoints').cur} prayer ${bot.stat('prayer').cur} pfm ${bot.isPrayerActive('protectfrommagic')} delrith ${!!npc(bot, DELRITH)} weak ${!!npc(bot, DELRITH_WEAK)} chat ${bot.chatModalId} worn ${bot.isWorn(objId(SL))} attxp ${bot.stat('attack').xp} d ${npc(bot, DELRITH)?.d} msgs ${JSON.stringify(msgsSince(bot, bot.tickCount - 10))}`);
        if (bot.chatModalId !== -1) {
            // the incantation: chatplayer page, then p_choice4 -> option 4
            if (bot.dialogOptions().length) { if (bot.clickDialogByText(/^Carlem Aber Camerinthum Purchai Gabindo$/) < 0) bot.ifButton(M4[3]!); }
            else bot.resumeDialogPage();
            bot.queueFlush();
        } else if (!npc(bot, DELRITH_WEAK) && bot.tickCount - lastAtk >= 5) {
            const d = npc(bot, DELRITH);
            if (d) { bot.opNpc(d.idx, 2); bot.queueFlush(); lastAtk = bot.tickCount; }
        }
        await bot.tick(1);
    }
    await pagesUntil(bot, done, 10);
    if (!done()) fail(bot, 'Delrith: no quest complete');
    closeChat(bot);
    if (bot.isPrayerActive('protectfrommagic')) { (bot as any).setPrayer('protectfrommagic', false); bot.queueFlush(); }
    bot.ifButton(150); bot.queueFlush();   // auto-retaliate back on
    return { ok: true, ticks: bot.tickCount - t0, msg: `qp ${qp0} -> ${qp(bot)}` };
}
