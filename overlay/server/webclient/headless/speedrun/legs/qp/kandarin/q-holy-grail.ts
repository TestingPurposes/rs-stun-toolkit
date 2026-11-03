// q-holy-grail.ts — Holy Grail (2 QP), cheat-free. Kandarin lane, max-QP build (rev 289).
//
// Verified flow (paths relative to server/content/scripts/; %grail stages quests/quest_grail/configs/quest_grail.constant):
//   1. King Arthur (251), %arthur = 7 (Merlin's Crystal done): "Tell me of this quest." -> "I'd enjoy trying that." ->
//      %grail 2 (area_camelot/scripts/king_arthur.rs2:41-45,53-68).
//   2. Merlin's workshop door (loc 24, L1 2764,3503) op1 with %grail > 0 adds merlin2 (L1 2767,3500); talk -> 3
//      (quest_grail.rs2:1-14, area_camelot/scripts/merlin.rs2:6-31).
//   3. Entrana: no weapons or armour (area_port_sarim/scripts/monk_of_entrana.rs2:26-53), so they are banked at Draynor
//      (glory). Monk of Entrana (657, Port Sarim) "Yes, okay, I'm ready to go." -> ship (L1 2834,3331); disembark plank
//      loc 2415 (general_use/scripts/gangplank.rs2:28-39). High priest (216, 2851,3349) at %grail 3-7 adds the crone and
//      runs her dialog -> 4 (area_entrana/scripts/high_priest_of_entrana.rs2:1-12, grail_crone.rs2:104-111).
//   4. Camelot teleport off Entrana, Seers bank (withdraw Excalibur + the fight weapon + worn gear), Brother Galahad
//      (218, 2612,3474): "I seek an item from the realm of the Fisher King." -> holy table napkin
//      (area_seers/scripts/brother_galahad.rs2:61-86,126-129).
//   5. Glory to Draynor Village, Draynor Manor L2 whistle door (loc 22, 3106,3361) op1 holding the napkin drops 2 magic
//      whistles at (3107,3359) (quest_grail.rs2:30-35).
//   6. Glory to Karamja, run to the whistle zone (2740-2743,3234-3237), blow -> Fisher realm (2806,4715)
//      (quest_grail.rs2:37-50).
//   7. Fisherman (219, 2802,4706): "Any idea how to get into the castle?" -> grail bell at (2762,4694)
//      (grail_fisherman.rs2:1-13). Black Knight Titan (221, 2791,4722; blockwalk, nomove, 142 hp, crush, attackrate 7,
//      def 91, stab/crush def 18): it must DIE WITH EXCALIBUR WORN, else it heals (black_knight_titan.rs2:10-46); its
//      death teleports you across the river. We fight with the strongest weapon and swap to Excalibur at low hp.
//   8. Bell (opheld1) with a grail maiden within 4 tiles -> inside the castle (2761,4692) (quest_grail.rs2:52-62);
//      Fisher King (220, L1 2762,4688): "You don't look too well." -> 8 (fisher_king.rs2:1-19).
//   9. Whistle back to Karamja, Falador teleport, Goblin Village sacks (loc 23, 2960,3507) op2 at %grail 8 -> Sir
//      Percival: "Your father wishes to speak to you." -> he takes a whistle -> 9 (quest_grail.rs2:20-28,
//      sir_percival.rs2:149-186).
//  10. Glory to Karamja, whistle -> restored realm (2678,4715): Holy Grail obj (L2 2649,4684) (quest_grail.rs2:64-73);
//      whistle back, Camelot teleport, King Arthur -> complete: 2 QP, stat_advance prayer 110000 / defence 153000 (tenths: 11,000 / 15,300 xp, x25 on the demo)
//      (king_arthur.rs2:26-33, quest_grail.rs2:113-119).
import type { SpeedBot } from '../../../core.js';
import { cheb, objId, objDebugName, spellCom } from '../../../core.js';
declare const process: { env: Record<string, string | undefined> };
import { nav, inDialog, locAt, tele, npc, qp, npcsOf, opHeld as qOpHeld } from '../../q-lib.js';
import { wield } from '../../run-lib.js';
import {
    runQuest, talkNpc, chat, heard, fail, checkAlive, dead, opLocUntil, eatIfLow, findLoc, walk, rubGlory, pickup,
    fight, type Item, type RunResult,
} from './ka-lib.js';
import { isResuming, journalStage, failHook } from '../journal.js';

export const QUEST = { name: 'Holy Grail', dir: 'quest_grail', qp: 2 };
export const REQUIREMENTS = {
    quests: ["Merlin's Crystal"], qp: 0,
    skills: {
        attack: [20, "wield Excalibur (levelrequire/scripts/tier20.rs2:16); the fight weapon's own level (dragon longsword 60 + Lost City)"],
        prayer: [43, 'Protect from Melee for the Black Knight Titan (crush-only, max ~13): proven at prayer 47 (Restless Ghost)'],
        magic: [45, 'Camelot (x2) + Falador teleports'],
    } as Record<string, [number, string]>,
    start: { x: 2757, z: 3478, level: 0 },   // Camelot teleport landing (Merlin's Crystal ends at King Arthur)
    end: { x: 2764, z: 3513, level: 0 },
};
/** Excalibur (untradeable, Merlin's Crystal) must be carried or worn too. */
export const SUPPLY: Item[] = [
    { name: 'dragon_longsword', n: 1 },   // Titan: 1.28 dmg/t at att/str 83 vs 0.62 for Excalibur alone (stab vs def 18)
    { name: 'amulet_of_glory_4', n: 1 },  // Draynor x2, Karamja x2
    { name: 'lawrune', n: 3 }, { name: 'airrune', n: 13 }, { name: 'waterrune', n: 1 },   // Camelot x2, Falador
    { name: 'shark', n: 4 },
    { name: 'coins', n: 60 },   // optional: Captain Barnaby x2 when Ardougne Teleport is available (Plague City + magic 51)
];
/** fight weapons in preference order (the first one held is used for the Titan until Excalibur takes over) */
const FIGHT_WEAPONS = ['dragon_longsword', 'dragon_battleaxe', 'dragon_mace', 'rune_scimitar', 'rune_longsword', 'rune_2h_sword'];
/** pack items Entrana allows that the quest needs (everything else is banked at Draynor) */
const KEEP = ['amulet_of_glory_4', 'amulet_of_glory_3', 'amulet_of_glory_2', 'amulet_of_glory_1', 'lawrune', 'airrune', 'waterrune',
    'firerune', 'earthrune', 'shark', 'lobster', 'swordfish', 'coins', '4doseprayerrestore', '3doseprayerrestore', '2doseprayerrestore', '1doseprayerrestore'];
const WORN_KEEP = /amulet|necklace|ring_|_ring|boots|arrow|bolt/;   // not Entrana-restricted (monk_of_entrana.rs2:27-50)

const BARNABY = 381, LADY = 250, ARTHUR = 251, MERLIN2 = 213, PRIEST = 216, GALAHAD = 218, FISHERMAN = 219, FISHER_KING = 220, TITAN = 221, MAIDEN = 210, SHIPMONK = 657;
const ARTHUR_AT = { x: 2764, z: 3513 };
const WHISTLE_ZONE = { x: 2741, z: 3235 };   // 0_42_50_52_34 .. 0_42_50_55_37
const inZone = (t: { x: number; z: number }) => t.x >= 2740 && t.x <= 2743 && t.z >= 3234 && t.z <= 3237;
const inRealm = (t: { x: number; z: number }) => t.x >= 2624 && t.x <= 2815 && t.z >= 4672 && t.z <= 4735;

/** session 10 resume: the quest JOURNAL (quest_grail/scripts/grail_journal.rs2) -> %grail, first match wins (latest first) */
const GR_STAGES: Array<[RegExp, number]> = [
    [/QUEST COMPLETE/i, 10], [/Now I have the\s+Grail|follow him to the\s+Castle/i, 9], [/find his\s+son\s+Sir Percival/i, 8],
    [/find a\s+weapon\s+that can defeat him/i, 7], [/Six Heads/i, 4], [/Speak to\s+Galahad/i, 3], [/start my quest by speaking to\s+Merlin/i, 2],
];
/** inside the Grail castle (the bell drops you at 2761,4692; the stairs are at 2761,4680) */
const inGrailCastle = (b: SpeedBot) => { const t = b.tile(); return inRealm(t) && t.x >= 2750 && t.x <= 2772 && t.z >= 4674 && t.z <= 4692; };

function worn(bot: SpeedBot): number[] {
    const w = (bot as any).invs.get(1688) as { ids: Int32Array } | undefined;
    return w ? [...w.ids].filter(id => id > 0) : [];
}

export async function run(bot: SpeedBot, o: { log?: boolean } = {}): Promise<RunResult> {
    return runQuest(bot, QUEST, async st0 => {
        await nav();
        const st = { ...st0, at: (k: string) => { st0.at(k); failHook(`grail:${k}`); } };
        // session 10: on a retry, resume at the stage the journal shows (GRAIL_RESUME=0 = always from the top); inside a
        // stage by observables (napkin, whistles, realm/castle position, the Grail held)
        let gs = 0;
        if (isResuming(bot) && process.env.GRAIL_RESUME !== '0') {
            if (bot.chatModalId !== -1) { bot.closeModal(); bot.queueFlush(); await bot.tick(1); }
            gs = await journalStage(bot, 'grail', GR_STAGES, 0, s => console.log(`[grail] ${s}`));
            console.log(`[grail] resume at stage ${gs} @${JSON.stringify(bot.pos())} whistles ${bot.count('magic_whistle')} napkin ${bot.count('holy_table_napkin')}`);
            if (gs >= 10) return;
        }
        const R = gs > 0;
        const hasExcal = () => bot.count('excalibur') > 0 || bot.isWorn(objId('excalibur'));
        // session 11 fix 384b TEST (GRAIL_TEST_384B=1, first attempt only): drop Excalibur and fail -> the retry must re-buy it
        if (process.env.GRAIL_TEST_384B === '1' && !isResuming(bot) && bot.slot('excalibur') >= 0) {
            qOpHeld(bot, 'excalibur', 5); bot.queueFlush(); await bot.until(() => bot.count('excalibur') === 0, 5);
            fail(bot, '384b TEST: dropped Excalibur (the retry must buy it back)');
        }
        // session 11 fix 384b (qx299m: a Titan death left Excalibur on the Fisher-realm floor (death.rs2:134; cost 200, not
        // among the 3 kept) and both retries failed here in 3 t -> ROUTE STOPPED). Buy it back: Lady of the Lake (250,
        // 2924,3405) option 3 when ~obj_gettotal(excalibur) = 0 (inv+bank+worn), 500 coins in the pack since %arthur >
        // excalibur_bound (area_taverly/scripts/lady_of_the_lake.rs2:4-35). Falador west bank on the way: a banked
        // Excalibur, or coins. Then back to Camelot. GRAIL_384B=0 reverts.
        if (gs <= 7 && !hasExcal() && process.env.GRAIL_384B !== '0') {
            if (!(await tele(bot, 'falador_teleport')).ok) fail(bot, 'falador teleport (Excalibur re-buy)');
            await walk(bot, { x: 2946, z: 3369 }, null, () => dead(bot), { near: 2, maxTicks: 60 });
            for (let k = 0; k < 3 && !bot.bankOpen(); k++) await bot.openBank({ radius: 12 });
            if (bot.bankOpen()) {
                if (bot.bankCount('excalibur') > 0) await bot.withdraw('excalibur', 1);
                const short = 500 - bot.count('coins');
                if (!hasExcal() && short > 0 && bot.bankCount('coins') >= short) await bot.withdraw('coins', short);
                // (apply380) runes for the re-buy's Camelot plus this quest's own Falador + Camelot 2 later (law 3, air 13,
                // water 1 = SUPPLY): the re-buy spends a Falador + a Camelot out of the retry pack's SUPPLY runes
                for (const [r, n] of [['lawrune', 3], ['airrune', 13], ['waterrune', 1]] as const) { const sh = n - bot.count(r); if (sh > 0 && bot.bankCount(r) > 0) await bot.withdraw(r, Math.min(sh, bot.bankCount(r))); }
                bot.closeBank(); bot.queueFlush();
            }
            if (!hasExcal() && bot.count('coins') >= 500)
                await talkNpc(bot, LADY, { x: 2924, z: 3405 }, [/^I seek the sword Excalibur/], () => bot.count('excalibur') > 0, { label: 'lady-rebuy' });
            console.log(`[grail] 384b Excalibur re-buy: ${hasExcal() ? 'got it' : 'FAILED'} (coins ${bot.count('coins')})`);
            if (hasExcal() && !(await tele(bot, 'camelot_teleport')).ok) fail(bot, 'camelot teleport (after the re-buy)');
        }
        if (gs <= 7 && !hasExcal()) fail(bot, "no Excalibur (Merlin's Crystal reward; 500 gp at the Lady of the Lake)");
        let t = bot.tickCount;
        const wornBanked: number[] = [];
        // 1. King Arthur: start
        if (gs <= 0) {
        if (!(await talkNpc(bot, ARTHUR, ARTHUR_AT, [/^Tell me of this quest/, /^I'd enjoy trying that/], () => heard(bot, /room next to the library/, t), { label: 'arthur1' }))) fail(bot, 'Arthur start');
        st.at('arthur');
        }
        if (gs <= 2) {
        // 2. Merlin's workshop (L1): stairs, door (adds merlin2), talk
        const stairs0 = locAt(1725, 2750, 3510, 0);
        if (!(await opLocUntil(bot, stairs0, 1, () => bot.minusedlevel === 1, { maxTicks: 60 }))) fail(bot, 'Camelot stairs up');
        const wdoor = locAt(24, 2764, 3503, 1);
        // the door walks you through itself (~open_and_close_door): done once we stand inside (east of it)
        if (!(await opLocUntil(bot, wdoor, 1, () => bot.tile().x >= 2765 && bot.minusedlevel === 1, { maxTicks: 60, every: 5 }))) fail(bot, 'workshop door');
        t = bot.tickCount;
        if (!(await talkNpc(bot, MERLIN2, { x: 2767, z: 3500 }, [/^Thank you for the advice/], () => heard(bot, /speak about those experiences cryptically/, t), { label: 'merlin' }))) fail(bot, 'Merlin');
        st.at('merlin');
        }
        if (gs <= 3) {
        // 3. glory -> Draynor, bank every Entrana-restricted item (worn weapon/armour, Excalibur, fight weapon)
        if (bot.chatModalId !== -1) { bot.closeModal(); bot.queueFlush(); }
        if (!(await rubGlory(bot, /^Draynor Village/))) fail(bot, 'glory Draynor 1');
        for (const id of worn(bot)) if (!WORN_KEEP.test(objDebugName(id))) { bot.unequipItem(id); wornBanked.push(id); }
        bot.queueFlush();
        await walk(bot, { x: 3093, z: 3245 }, null, () => dead(bot), { near: 2, maxTicks: 60 });
        if (!(await bot.until(() => wornBanked.every(id => !bot.isWorn(id)), 4))) fail(bot, 'unequip');
        for (let k = 0; k < 3 && !bot.bankOpen(); k++) await bot.openBank({ radius: 12 });
        if (!bot.bankOpen()) fail(bot, 'Draynor bank');
        await bot.depositAll(KEEP);
        if (bot.inv().some(s => !KEEP.includes(objDebugName(s.obj)))) fail(bot, `deposit left ${bot.inv().map(s => objDebugName(s.obj)).join(',')}`);
        bot.closeBank(); bot.queueFlush();
        st.at('banked');
        // Port Sarim monk -> Entrana
        const onShip = () => bot.minusedlevel === 1 && cheb(bot.tile(), { x: 2834, z: 3331 }) <= 4;
        t = bot.tickCount;
        if (!(await talkNpc(bot, SHIPMONK, { x: 3046, z: 3235 }, [/^Yes, okay, I'm ready to go/], () => onShip(), { label: 'shipmonk', maxTicks: 200, closedTicks: 30 }))) fail(bot, 'Entrana boat');
        st.at('entrana-ship');
        const plank = findLoc(2415, 2834, 3333, 1);
        if (!(await opLocUntil(bot, plank, 1, () => bot.minusedlevel === 0, { maxTicks: 20 }))) fail(bot, 'Entrana plank');
        t = bot.tickCount;
        if (!(await talkNpc(bot, PRIEST, { x: 2851, z: 3349 }, [/^Ok, I will go searching/], () => heard(bot, /Good luck with that/, t) && !inDialog(bot), { label: 'priest' }))) fail(bot, 'priest/crone');
        st.at('crone');
        // 4. Camelot teleport, Seers bank (Excalibur, weapon, worn gear back), Galahad
        if (!(await tele(bot, 'camelot_teleport')).ok) fail(bot, 'camelot teleport 1');
        await walk(bot, { x: 2725, z: 3491 }, null, () => dead(bot), { near: 2, maxTicks: 80 });
        for (let k = 0; k < 3 && !bot.bankOpen(); k++) await bot.openBank({ radius: 12 });
        if (!bot.bankOpen()) fail(bot, 'Seers bank');
        const back = [objId('excalibur'), ...FIGHT_WEAPONS.map(n => objId(n)), ...wornBanked];
        for (const id of [...new Set(back)]) if (bot.bankCount(id) > 0 && bot.count(id) === 0) await bot.withdraw(id, 1);
        // session 11 fix 384a (qx299m Titan death: Grand Tree leaves ~10 prayer points): one restore for Protect from Melee
        if (process.env.GRAIL_384A !== '0' && !bot.inv().some(s => /^[1234]doseprayerrestore$/.test(objDebugName(s.obj)))) {
            const pot = ['4doseprayerrestore', '3doseprayerrestore', '2doseprayerrestore'].find(n => bot.bankCount(n) > 0);
            if (pot) await bot.withdraw(pot, 1);
        }
        // session 11 fix 384b (qx299m: the Titan death dropped 3330 coins on the realm floor, leaving 260 < the 500-gp
        // Excalibur re-buy): bank the coins above 60 before the realm (Barnaby needs >= 30)
        if (process.env.GRAIL_384B !== '0' && bot.count('coins') > 560) {
            await bot.depositAll(bot.inv().map(s => objDebugName(s.obj)).filter(n => n !== 'coins'));
            await bot.withdraw('coins', 60);
        }
        bot.closeBank(); bot.queueFlush();
        if (!hasExcal()) fail(bot, 'Excalibur not withdrawn');
        const rewear = wornBanked.filter(id => bot.count(id) > 0).map(id => objDebugName(id));
        if (rewear.length) await wield(bot, rewear);
        st.at('seers-bank');
        }
        // 6. (helpers hoisted above the resume blocks; behaviour unchanged) glory -> Karamja, whistle zone, blow
        const blow = async (label: string, done: () => boolean) => {
            for (let k = 0; k < 3 && !done(); k++) {
                if (bot.chatModalId !== -1) { bot.closeModal(); bot.queueFlush(); }
                bot.opHeld1(objId('magic_whistle'), bot.slot('magic_whistle')); bot.queueFlush();
                await bot.until(() => done(), 6);
            }
            if (!done()) fail(bot, `whistle ${label}`);
        };
        // Karamja: Ardougne Teleport + Captain Barnaby's ship to Brimhaven (36 + 110 tiles + a 7-tick sail, 30 gp) when
        // the account has it (magic 51 and Plague City, skill_magic/scripts/spells/teleport.rs2:22; one try, ~5 ticks if
        // refused), else glory -> Karamja (240 tiles: navgrid path lengths)
        let ardougneOk = process.env.GRAIL_ARDOUGNE !== '0' && bot.stat('magic').level >= 51 && bot.count('coins') >= 30;
        const viaArdougne = async (label: string): Promise<boolean> => {
            if (!ardougneOk) return false;
            const p0 = bot.pos();
            if (bot.chatModalId !== -1 || bot.mainModalId !== -1) { bot.closeModal(); bot.queueFlush(); }
            bot.ifButton(spellCom('ardougne_teleport')); bot.queueFlush();
            if (!(await bot.until(() => cheb(bot.tile(), p0) > 8, 6))) { ardougneOk = false; console.log(`[grail] Ardougne Teleport refused (${label}): glory route`); return false; }
            const onBrimShip = () => bot.minusedlevel === 1 && cheb(bot.tile(), { x: 2775, z: 3234 }) <= 3;
            if (!(await talkNpc(bot, BARNABY, { x: 2679, z: 3275 }, [/^Yes please/], () => onBrimShip(), { label: 'barnaby', maxTicks: 120, closedTicks: 20 }))) fail(bot, `Barnaby ${label}`);
            const plankB = findLoc(2088, 2774, 3234, 1);
            if (!(await opLocUntil(bot, plankB, 1, () => bot.minusedlevel === 0, { maxTicks: 20 }))) fail(bot, `Brimhaven plank ${label}`);
            return true;
        };
        const toZone = async (label: string) => {
            if (!(await viaArdougne(label)) && !(await rubGlory(bot, /^Karamja/))) fail(bot, `glory Karamja ${label}`);
            if (!(await walk(bot, WHISTLE_ZONE, null, () => inZone(bot.tile()) || dead(bot), { near: 0, maxTicks: 400 }))) fail(bot, `walk to the whistle zone ${label}`);
            checkAlive(bot);
        };
        if (gs <= 7) {
        if (!R || (bot.count('holy_table_napkin') === 0 && bot.count('magic_whistle') < 2 && !inRealm(bot.tile()))) {
        if (!(await talkNpc(bot, GALAHAD, { x: 2612, z: 3474 }, [/^I seek an item from the realm of the Fisher King/], () => bot.count('holy_table_napkin') > 0, { label: 'galahad', maxTicks: 300 }))) fail(bot, 'Galahad');
        st.at('napkin');
        }
        if (!R || (bot.count('magic_whistle') < 2 && !inRealm(bot.tile()))) {
        // 5. glory -> Draynor, Draynor Manor L2 whistles
        if (bot.chatModalId !== -1) { bot.closeModal(); bot.queueFlush(); }
        if (!(await rubGlory(bot, /^Draynor Village/))) fail(bot, 'glory Draynor 2');
        const mdoor = locAt(134, 3108, 3353, 0), spooky = locAt(1730, 3108, 3363, 0), spiral1 = locAt(1738, 3104, 3362, 1);
        if (!(await opLocUntil(bot, mdoor, 1, () => bot.tile().z > 3353, { maxTicks: 200, every: 6 }))) fail(bot, 'manor door');
        if (!(await opLocUntil(bot, spooky, 1, () => bot.minusedlevel === 1, { maxTicks: 40 }))) fail(bot, 'manor stairs 1');
        if (!(await opLocUntil(bot, spiral1, 1, () => bot.minusedlevel === 2, { maxTicks: 40 }))) fail(bot, 'manor stairs 2');
        const wsdoor = locAt(22, 3106, 3361, 2);
        const whistleSeen = () => !!bot.findGroundItem(objId('magic_whistle'), 6);
        if (!(await opLocUntil(bot, wsdoor, 1, () => whistleSeen() || bot.tile().z < 3361, { maxTicks: 30, every: 5 }))) fail(bot, 'whistle door');
        // both whistles share one tile (2_48_52_35_31 = 3107,3359) and the client's ground-item map keeps one entry per
        // tile+obj: after the first pickup it forgets the second, so the second OPOBJ is sent blind on the same tile
        const WT = { x: 3107, z: 3359 };
        for (let k = 0; k < 8 && bot.count('magic_whistle') < 2; k++) {
            const n0 = bot.count('magic_whistle');
            if (k === 0 || bot.findGroundItem(objId('magic_whistle'), 8)) await pickup(bot, 'magic_whistle', WT, { maxTicks: 40 });
            else { bot.opObj(WT.x, WT.z, objId('magic_whistle'), 3); bot.queueFlush(); await bot.until(() => bot.count('magic_whistle') > n0, 3); }
            if (bot.count('magic_whistle') === n0 && k >= 3 && bot.tile().z >= 3361) await opLocUntil(bot, wsdoor, 1, () => whistleSeen(), { maxTicks: 10, every: 5 });
        }
        if (bot.count('magic_whistle') < 2) fail(bot, `whistles ${bot.count('magic_whistle')}/2`);
        st.at('whistles');
        }
        if (!R || !inRealm(bot.tile())) {
        await toZone('1');
        st.at('karamja1');
        await blow('to the realm', () => inRealm(bot.tile()));
        st.at('realm1');
        }
        // 7. Titan first: the fisherman (2802,4706) and the castle are across the river; the Titan's death is the crossing
        const weapon = FIGHT_WEAPONS.find(n => bot.count(n) > 0 || bot.isWorn(objId(n)));
        if (weapon && !bot.isWorn(objId(weapon))) await wield(bot, [weapon]);
        // session 11 fix 384a (qx299m DIED, 7 sharks, Protect never on: this gate compared prayer POINTS to the level-43
        // requirement; the Grand Tree demon leaves ~10). Gate on level + points > 0; drink a restore below 10. GRAIL_384A=0 reverts.
        const fix384a = process.env.GRAIL_384A !== '0';
        const prayOk = () => fix384a ? bot.stat('prayer').level >= 43 && bot.stat('prayer').cur > 0 : bot.stat('prayer').cur >= 43;
        if (prayOk() && !bot.isPrayerActive('protectfrommelee')) { bot.activatePrayer('protectfrommelee'); bot.queueFlush(); }
        // swap to Excalibur once the Titan's hp (hitsplat) is within one max hit of the fight weapon (20 for a dragon
        // longsword at str 83, a desk estimate) so the last blow lands with Excalibur worn
        const SWAP_AT = 22;
        const crossed = () => bot.tile().x <= 2790 && inRealm(bot.tile());
        let swapped = !weapon;
        const titanHp = () => { const n = npc(bot, TITAN); const e: any = n ? bot.npcs[n.idx] : null; return e && e.lastHitCycle >= 0 ? e.hpCur : 999; };
        if (!R || !crossed()) {
        if (!(await walk(bot, { x: 2792, z: 4722 }, null, () => dead(bot) || crossed(), { near: 1, maxTicks: 60 }))) fail(bot, 'to the Titan');
        let lastPot = -99, swapSent = -99;
        const tf0 = bot.tickCount, sh0 = bot.count('shark');
        const okTitan = await fight(bot, TITAN, () => {
            if (fix384a) {
                // session 11 fix 384a: resend the Excalibur wield every 3 t until it is worn (an OPHELD sent while eat-delayed is
                // dropped, OpHeldHandler.ts:16, and a Titan killed without it heals to full, black_knight_titan.rs2:30-37);
                // fight() is the only eater (the second eatIfLow here was the ACK-NOACK-EAT-FOOD every run shows)
                if (titanHp() <= SWAP_AT && !bot.isWorn(objId('excalibur')) && bot.slot('excalibur') >= 0 && bot.tickCount - swapSent >= 3) { bot.opHeld2(objId('excalibur'), bot.slot('excalibur')); bot.queueFlush(); swapSent = bot.tickCount; swapped = true; }
                if (bot.stat('prayer').cur < 10 && bot.tickCount - lastPot > 3) { const pot = bot.inv().find(s => /^[1234]doseprayerrestore$/.test(objDebugName(s.obj))); if (pot) { bot.opHeld1(pot.obj, pot.slot); bot.queueFlush(); lastPot = bot.tickCount; } }
                if (prayOk() && !bot.isPrayerActive('protectfrommelee')) { bot.activatePrayer('protectfrommelee'); bot.queueFlush(); }
                return crossed();
            }
            if (!swapped && titanHp() <= SWAP_AT) { bot.opHeld2(objId('excalibur'), bot.slot('excalibur')); bot.queueFlush(); swapped = true; }
            if (bot.stat('prayer').cur === 0 || !bot.isPrayerActive('protectfrommelee')) eatIfLow(bot);
            return crossed();
        }, { maxTicks: 400, reAttack: 8, label: 'titan', ...(fix384a ? { eatReAttack: 2 } : {}) });
        console.log(`[grail] 384a titan: ${bot.tickCount - tf0} t, sharks ${sh0}->${bot.count('shark')}, hp ${bot.stat('hitpoints').cur}, prayer ${bot.stat('prayer').cur}, protect ${bot.isPrayerActive('protectfrommelee')}, excal worn ${bot.isWorn(objId('excalibur'))}`);
        if (!okTitan) fail(bot, `Titan (hp ${titanHp()}, Excalibur worn ${bot.isWorn(objId('excalibur'))})`);
        if (bot.isPrayerActive('protectfrommelee')) { bot.deactivatePrayer('protectfrommelee'); bot.queueFlush(); }
        st.at('titan');
        }
        if (R && bot.isPrayerActive('protectfrommelee')) { bot.deactivatePrayer('protectfrommelee'); bot.queueFlush(); }
        if (!R || (!inGrailCastle(bot) && bot.minusedlevel === 0)) {
        // fisherman (west bank): the bell (500-tick obj) appears by the castle
        t = bot.tickCount;
        if (!R || bot.count('grail_bell') === 0) {
        if (!(await talkNpc(bot, FISHERMAN, { x: 2802, z: 4706 }, [/^Any idea how to get into the castle/], () => heard(bot, /ALWAYS bells there/, t) && !inDialog(bot), { label: 'fisherman' }))) fail(bot, 'fisherman');
        st.at('fisherman');
        // 8. bell, ring by a maiden, Fisher King
        if (!(await pickup(bot, 'grail_bell', { x: 2762, z: 4694 }))) fail(bot, 'bell');
        }
        const inCastle = () => heard(bot, /Somehow you are now inside the castle/, t);
        t = bot.tickCount;
        // session 8 (allchaos qt39m 'bell ring': the maiden stood inside the castle walls, the walk to her tile had no route
        // and wedged on (2758,4692) for 500 t): npc_find only needs her within 4 tiles, walls or not. Wait by the bell spot
        // (2762,4694) ringing whenever one is within 4, up to 150 t, before the old walk-to-maiden loop. GRAIL_BELL_WAIT=0 reverts.
        if (process.env.GRAIL_BELL_WAIT !== '0') {
            if (cheb(bot.tile(), { x: 2762, z: 4694 }) > 1) await walk(bot, { x: 2762, z: 4694 }, null, () => (npcsOf(bot, MAIDEN)[0]?.d ?? 99) <= 4, { near: 1, maxTicks: 30 });
            const w0 = bot.tickCount; let rung = -10;
            while (!inCastle() && bot.tickCount - w0 < 150 && !dead(bot)) {
                const m = npcsOf(bot, MAIDEN).find(q => q.d <= 4);
                if (m && bot.tickCount - rung >= 4) {
                    if (bot.chatModalId !== -1) { bot.closeModal(); bot.queueFlush(); }
                    bot.opHeld1(objId('grail_bell'), bot.slot('grail_bell')); bot.queueFlush(); rung = bot.tickCount;
                    await chat(bot, [], () => inCastle(), { label: 'bell', maxTicks: 6 });
                } else await bot.tick(1);
            }
            console.log(`[grail] bell wait by the castle: ${inCastle() ? 'inside' : 'no maiden within 4'} after ${bot.tickCount - w0} t`);
        }
        for (let k = 0; k < 6 && !inCastle(); k++) {
            const m = npcsOf(bot, MAIDEN).find(q => q.d <= 4);   // npc_find(coord, grail_maiden, 4, 0) (quest_grail.rs2:54)
            if (!m) { const mm = npc(bot, MAIDEN); if (mm) await walk(bot, { x: mm.x, z: mm.z }, null, () => (npcsOf(bot, MAIDEN)[0]?.d ?? 99) <= 3, { near: 2, maxTicks: 30 }); else await bot.tick(1); continue; }
            if (bot.chatModalId !== -1) { bot.closeModal(); bot.queueFlush(); }
            bot.opHeld1(objId('grail_bell'), bot.slot('grail_bell')); bot.queueFlush();
            await chat(bot, [], () => inCastle(), { label: 'bell', maxTicks: 10 });
        }
        if (!inCastle()) fail(bot, 'bell ring');
        if (bot.chatModalId !== -1) { bot.closeModal(); bot.queueFlush(); }
        st.at('castle');
        }
        const cst = locAt(1738, 2761, 4680, 0);
        if (!R || bot.minusedlevel !== 1) if (!(await opLocUntil(bot, cst, 1, () => bot.minusedlevel === 1, { maxTicks: 40 }))) fail(bot, 'castle stairs');
        t = bot.tickCount;
        if (!(await talkNpc(bot, FISHER_KING, { x: 2762, z: 4688 }, [/^You don't look too well/], () => heard(bot, /I shall go and see if I can find him/, t), { label: 'fisherking' }))) fail(bot, 'Fisher King');
        st.at('fisher-king');
        }
        if (gs <= 8) {
        // 9. whistle -> Karamja, Falador teleport, Percival
        if (!R || inRealm(bot.tile())) await blow('back 1', () => inZone(bot.tile()) || cheb(bot.tile(), WHISTLE_ZONE) <= 3);
        if (!(await tele(bot, 'falador_teleport')).ok) fail(bot, 'falador teleport');
        const sacks = locAt(23, 2960, 3507, 0);
        t = bot.tickCount;
        const w0 = bot.count('magic_whistle');
        if (!(await opLocUntil(bot, sacks, 2, () => inDialog(bot), { maxTicks: 200, every: 8 }))) fail(bot, 'sacks');
        if (!(await chat(bot, [/^Your father wishes to speak to you/], () => bot.count('magic_whistle') < w0 && !inDialog(bot), { label: 'percival', maxTicks: 40 }))) fail(bot, 'Percival');
        st.at('percival');
        }
        // 10. glory -> Karamja, whistle -> restored realm, the Grail
        // (resume at 9: out of the old realm first; already in the restored realm (x < 2700): straight to the Grail)
        if (!R || bot.count('holy_grail') === 0) {
        if (R && inRealm(bot.tile()) && bot.tile().x >= 2700) await blow('back (resume)', () => !inRealm(bot.tile()));
        if (!R || !(inRealm(bot.tile()) && bot.tile().x < 2700)) {
        if (!R || !inZone(bot.tile())) await toZone('2');
        await blow('to the realm 2', () => inRealm(bot.tile()));
        st.at('realm2');
        }
        const rs0 = locAt(1738, 2648, 4683, 0), rl1 = locAt(1747, 2651, 4684, 1);
        if (!R || bot.minusedlevel === 0) if (!(await opLocUntil(bot, rs0, 1, () => bot.minusedlevel === 1, { maxTicks: 120 }))) fail(bot, 'grail castle stairs');
        if (!R || bot.minusedlevel === 1) if (!(await opLocUntil(bot, rl1, 1, () => bot.minusedlevel === 2, { maxTicks: 30 }))) fail(bot, 'grail castle ladder');
        if (!(await pickup(bot, 'holy_grail', { x: 2649, z: 4684 }))) fail(bot, 'Holy Grail');
        st.at('grail');
        }
        if (!R || inRealm(bot.tile())) await blow('back 2', () => !inRealm(bot.tile()));
        if (!(await tele(bot, 'camelot_teleport')).ok) fail(bot, 'camelot teleport 2');
        const qp0 = qp(bot);
        if (!(await talkNpc(bot, ARTHUR, ARTHUR_AT, [], () => qp(bot) >= qp0 + QUEST.qp, { label: 'arthur2', closedTicks: 6 }))) fail(bot, 'Arthur reward');
        st.at('done');
    }, o.log !== false);
}
