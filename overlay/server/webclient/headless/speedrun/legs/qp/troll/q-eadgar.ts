// q-eadgar.ts — Eadgar's Ruse (1 QP). CHEAT-FREE. Content: server/content/scripts/quests/quest_eadgar/scripts/*.rs2,
// areas/area_taverly/scripts/sanfew.rs2, quests/quest_troll/scripts/{quest_troll,troll_eadgar,troll_stronghold_camp_guard}.rs2.
// %eadgar_quest stages (quest_eadgar.constant): 10 started, 15 spoken Eadgar first, 20 spoken Burntmeat first, 30 needs
// parrot, 50 explained plan, 60 hid parrot, 70 needs items, 80 needs potion, 85 needs parrot back, 86 got parrot back,
// 87 got fake man, 90 got burnt meat, 100 unlocked storeroom, 110 complete.
//
// Stages (STAGES, in order):
//   zoo       Ardougne zoo: Parroty Pete (1216) "When did you add it?" + "What do you feed them?" set the two dialog bits
//             (eadgar_zoo_keeper_aviary.rs2:205-215) that let pineapple chunks + vodka become alco-chunks (:229-247); use them
//             on the aviary hatch 4043 (2611,3287) -> drunk parrot (:264-289). Allowed before the quest starts (:262).
//   sanfew    Taverley, Sanfew (454, L1): needs Druidic Ritual, Death Plateau, Troll Stronghold and HERBLORE 31 BASE
//             (sanfew.rs2:96-136) -> 10.
//   prison    games necklace -> Burthorpe -> Death Plateau rocks -> troll rocks -> the stronghold's secret door (troll-area.ts).
//             Free Eadgar if he is still locked up: pickpocket prison guard 2 (1129, thieving 30) for his cell key
//             (troll_stronghold_camp_guard.rs2:38-75; "find nothing" = already freed), unlock cell 3765 (quest_troll.rs2:251-336).
//   cook1     Burntmeat (1151, L1 kitchen) first: -> 20 (eadgar_troll_chief_cook.rs2:88-101), so ONE Eadgar talk gives 30.
//   thistle   Trollheim: pick a troll thistle (npc 1214), light logs, dry it on the fire, grind it (pestle and mortar).
//   eadgar1   Eadgar (1113, his home L2): 20 -> 30 (quest_eadgar.rs2:31-67); again with the parrot -> 50 (:69-91).
//   rack1     the torture rack 3821 (2828,10096) in the prison: use the parrot -> 60 (:166-179).
//   eadgar2   -> 70 and hand in the logs, 5 raw chickens, 10 grain (:181-186, :221-359).
//   robe      Taverley: Tegid (1213) "Sanfew won't be happy..." -> dirty robe (eadgar_druid_washing.rs2:1-40; needs 70).
//   eadgar3   robe -> everything -> 80 (:369-386); mix the potion (ranarr + ground thistle, eadgar_troll_thistle.rs2:165-169,
//             needs 80); give it -> 85 (:388-405).
//   rack2     op the rack -> the parrot back, 86 (:147-161).
//   eadgar4   -> fake man, 87 (:413-436).
//   cook2     Burntmeat + fake man -> burnt meat, 90 (eadgar_troll_chief_cook.rs2:66-81); kitchen drawers 3816 (open, then
//             search the open drawer) -> storeroom key (quest_eadgar.rs2:459-486); storeroom door 3810 (2869,10085) -> 100
//             (:488-502); goutweed crate 3822 (:547-555; the sleeping guard then knocks you out: you keep the goutweed).
//   finish    Sanfew with goutweed -> complete (sanfew.rs2:6-7, :158-164; quest_eadgar.rs2:592-598).
import { SpeedBot, objId, objDebugName, cheb, densify } from '../../../core.js';
import { npc, npcsOf, inDialog, sendToks, locAt, opLocGo, opNpcGo, useOnLocGo, dismiss, tele, qp, navSync, msgsSince, R, M2, M3, type FTok, type Tile } from '../../q-lib.js';
import { Ctx, QuestFail, go, walk, converse, sawMsg, dead, eatIfLow, nav, packStr, obstacle, locAny, talkTo, FOODS, type Item } from './lib-troll.js';
import { area, goto, necklaceToBurthorpe, pray, prayOff } from './troll-area.js';
import { isResuming, journalStage, failHook } from '../journal.js';

export const QUEST = { name: "Eadgar's Ruse", dir: 'quest_eadgar', qp: 1 };
export const REQUIREMENTS = {
    quests: ['Druidic Ritual', 'Death Plateau', 'Troll Stronghold', 'Plague City'] as string[],   // Plague City: Ardougne Teleport
    qp: 0,
    skills: {
        herblore: [31, 'BASE level to start (sanfew.rs2:103, stat_base)'],
        thieving: [30, 'pickpocket the prison guard for Eadgar\'s cell key if Troll Stronghold left him locked up (camp_guard.rs2:46)'],
        agility: [15, 'the troll climbing rocks (quest_troll.rs2:6-9)'],
        magic: [51, 'Ardougne Teleport (zoo); Falador Teleport 37 (Taverley)'],
        prayer: [43, 'Protect from Melee on the Death Plateau shelf, the Trollheim paths and the L2 hall (troll-area.ts goto; the shelf still cost 18-24 of 80 hp per crossing in the sim)'],
    } as Record<string, [number, string]>,
    start: { x: 2919, z: 3572, level: 0 },   // Burthorpe, outside Dunstan's house (where Troll Stronghold ends)
    end: { x: 2897, z: 3426, level: 1 },     // Sanfew, Taverley
};
export const SUPPLY: Item[] = [
    { name: 'pineapple_chunks', n: 1 }, { name: 'vodka', n: 1 }, { name: 'logs', n: 2 }, { name: 'raw_chicken', n: 5 }, { name: 'grain', n: 10 },
    { name: 'ranarrvial', n: 1 }, { name: 'pestle_and_mortar', n: 1 }, { name: 'tinderbox', n: 1 }, { name: 'necklace_of_minigames_8', n: 1 },
    { name: 'death_climbingboots', n: 1 }, { name: 'lawrune', n: 5 }, { name: 'waterrune', n: 5 }, { name: 'airrune', n: 9 },   // Ardougne + 3x Falador Teleport
    { name: 'shark', n: 2 },   // the pack is full until Eadgar takes the grain/chickens; trolls on the Trollheim paths hit
];

/** kept in the bank by the route, withdrawn at Falador on the robe trip */
export const BANK_SUPPLY: Item[] = [{ name: 'shark', n: 14 }];
export const STAGES = ['zoo', 'sanfew', 'prison', 'cook1', 'thistle', 'eadgar1', 'rack1', 'eadgar2', 'robe', 'eadgar3', 'rack2', 'eadgar4', 'cook2', 'finish'] as const;
export interface EadgarOpts { log?: boolean; from?: string; to?: string }

const PETE = 1216, SANFEW = 454, TEGID = 1213, EADGAR = 1113, COOK = 1151, GUARD2 = 1129, THISTLE = 1214;
const PARROT = 'eadgar_drunk_parrot';
/** Dialog pages wrap a line over several text components: test the regex against all of them joined with spaces. */
const anyText = (bot: SpeedBot, re: RegExp) => re.test([...bot.ifText.values()].join(' ').replace(/\s+/g, ' '));

/** eadgar_journal.rs2: each stage's open (unstruck) text is unique -> [stage, resume step] (session 10) */
const EADGAR_STAGES: Array<[RegExp, [number, string]]> = [
    [/QUEST COMPLETE/i, [110, 'done']], [/bring this to\s+Sanfew/i, [100, 'finish']], [/sneak in and get some\s+goutweed/i, [100, 'cook2']],
    [/get the\s+key to the storeroom/i, [90, 'cook2']], [/give the fake man to the\s+Troll cook/i, [87, 'cook2']],
    [/I should go tell Eadgar/i, [86, 'eadgar4']], [/fetch the parrot back/i, [85, 'rack2']],
    [/troll truth potion|made the Troll potion\. I should go give/i, [80, 'eadgar3']],
    [/I still need to bring him:.*(Logs|raw chicken|grain)/i, [70, 'eadgar2']], [/I still need to bring him/i, [70, 'robe']],
    [/find out the rest of Mad Eadgar's plan/i, [60, 'eadgar2']], [/hide the parrot/i, [50, 'rack1']],
    [/bring Eadgar a\s+parrot/i, [30, 'eadgar1']], [/get a tasty human/i, [20, 'thistle']], [/I should ask the\s+Troll Cook/i, [15, 'cook1']],
    [/Mad Eadgar\s*may\s+be able to help/i, [10, 'prison']], [/I can start this quest/i, [0, 'zoo']],
];
/** the journal stage a resumed attempt started from (-1 = a fresh attempt): cook2 skips its finished parts */
let RS = -1;

export async function run(bot: SpeedBot, o: EadgarOpts = {}): Promise<{ ok: boolean; ticks: number; msg: string }> {
    const c = new Ctx(bot, 'eadgar', o);
    await nav();
    bot.holdDialogs = true;
    const qp0 = qp(bot);
    RS = -1;
    // session 10 (the runner retries from the top: 'zoo' again with the parrot hidden): on a retry / resume, the step the quest
    // JOURNAL shows. EADGAR_RESUME=0 reverts.
    if (!o.from && isResuming(bot) && process.env.EADGAR_RESUME !== '0') {
        if (bot.chatModalId !== -1 || bot.mainModalId !== -1) { dismiss(bot); await bot.tick(1); }
        const [st, step] = await journalStage<[number, string]>(bot, 'eadgar', EADGAR_STAGES, [-1, 'zoo'], s => c.log(s));
        if (step === 'done') return { ok: true, ticks: c.t, msg: `journal: quest complete (qp ${qp0} -> ${qp(bot)})` };
        let from = step;
        if (from === 'robe' && bot.count('eadgar_dirty_druid_robe') > 0) from = 'eadgar3';
        if (from === 'thistle' && bot.count('eadgar_ground_troll_thistle') > 0) from = bot.count(PARROT) > 0 ? 'eadgar1' : 'zoo';
        if (from === 'eadgar1' && bot.count(PARROT) === 0) from = 'zoo';
        RS = st;
        c.log(`resume: journal stage ${st} -> step '${from}'`);
        o = { ...o, from };
    }
    c.startEater();
    try {
        const from = STAGES.indexOf((o.from ?? 'zoo') as typeof STAGES[number]);
        if (from < 0) c.fail(`unknown stage ${o.from}`);
        for (const st of STAGES.slice(from)) {
            if (dead(bot)) c.fail('died');
            await STEP[st](c);
            c.mark(st);
            failHook(st);
            if (st === o.to) return { ok: false, ticks: c.t, msg: `stopped after ${st} (probe); marks ${JSON.stringify(c.marks)}` };
        }
        const done = () => qp(bot) >= qp0 + QUEST.qp || anyText(bot, /completed[\s\S]*Eadgars Ruse/);
        if (!(await bot.until(done, 20))) c.fail(`no completion observable (qp ${qp0} -> ${qp(bot)})`);
        return { ok: true, ticks: c.t, msg: `qp ${qp0} -> ${qp(bot)}; marks ${JSON.stringify(c.marks)}` };
    } catch (e) {
        if (!(e instanceof QuestFail)) throw e;
        return { ok: false, ticks: c.t, msg: e.message };
    } finally { c.stopEater(); }
}

/** Falador Teleport -> Taverley; climb Sanfew's stairs (1738 @ 2898,3428) when `upstairs`. */
async function toTaverley(c: Ctx, upstairs: boolean): Promise<void> {
    const bot = c.bot;
    const far = () => bot.tile().x > 3000 || bot.tile().x < 2850 || bot.tile().z > 3500 || bot.tile().z < 3350;
    for (let k = 0; k < 3 && far(); k++) {   // (a late knock-out teleport in the storeroom once fooled tele()'s jump check)
        dismiss(bot); await bot.tick(1);
        await tele(bot, 'falador_teleport');
    }
    if (far()) c.fail('falador teleport');
    c.mark('falador');
    if (upstairs && bot.minusedlevel === 0) await sanfewDoor(c);
    if (upstairs && bot.minusedlevel === 0) await obstacle(c, { id: 1738, x: 2898, z: 3428 }, { x: 2900, z: 3428 }, () => bot.minusedlevel === 1, 'Sanfew stairs up');   // stand: q-druidic.ts (the walker opens the house door)
    if (!upstairs && bot.minusedlevel === 1) await obstacle(c, { id: 1740, x: 2898, z: 3428, level: 1 }, { x: 2898, z: 3427 }, () => bot.minusedlevel === 0, 'Sanfew stairs down');
    c.log(`toTaverley: ${bot.minusedlevel === 1 ? 'upstairs' : 'ground'} (${bot.tile().x},${bot.tile().z})`);
}

/** Sanfew's house door (open loc_1531 @ 2901,3428 in the static map) can be CLOSED (loc_1530) on a chaos engine: walkOp
 *  then wedges at (2903,3428) for ~90 ticks before anything opens it (sim seed 6401). Walk to the doorstep, open it if the
 *  zone stream shows it closed, then go on. */
async function sanfewDoor(c: Ctx): Promise<void> {
    const bot = c.bot;
    const closed = () => { for (const [k, id] of bot.liveLocs) { if (id !== 1530) continue; const [lv, x, z] = k.split(',').map(Number); if (lv === 0 && cheb({ x: x!, z: z! }, { x: 2901, z: 3428 }) <= 1) return { x: x!, z: z! }; } return null; };
    await walk(bot, { x: 2903, z: 3428 }, null, () => cheb(bot.tile(), { x: 2903, z: 3428 }) <= 1, { near: 1, maxTicks: 120 });
    for (let k = 0; k < 4; k++) {
        const d = closed(); if (!d) return;
        // a bare OPLOC out of reach is dropped (core.ts opLocReach): step onto the door's tile with MOVE_OPCLICK + op (openDoorNear)
        bot.sendRoute([{ x: d.x, z: d.z }], true); bot.opLoc(d.x, d.z, 1530, 1); bot.queueFlush();
        await bot.until(() => !closed(), 5);
        c.log(`Sanfew door (${d.x},${d.z}) ${closed() ? 'still closed' : 'opened'} from (${bot.tile().x},${bot.tile().z})`);
    }
    if (closed()) c.log('Sanfew door still closed');
}

const STEP: Record<typeof STAGES[number], (c: Ctx) => Promise<void>> = {
    zoo: async c => {
        const bot = c.bot;
        if (bot.count(PARROT) > 0) return;
        dismiss(bot);
        if (!(await tele(bot, 'ardougne_teleport')).ok) c.fail('ardougne teleport (Plague City done? magic 51?)');
        c.mark('ardougne');
        // Pete: chatnpc | p_choice3 opt 2 "When did you add it?" | chatplayer | chatnpc  (then opt 3 "What do you feed them?")
        await talkTo(c, PETE, { x: 2611, z: 3284 }, [R, M3[1]!, R, R], [/^When did you add it\?$/], () => anyText(bot, /Just recently/), 'pete1');
        dismiss(bot); await bot.tick(1);
        await talkTo(c, PETE, { x: 2611, z: 3284 }, [R, M3[2]!, R, R], [/^What do you feed them\?$/], () => anyText(bot, /balanced diet/), 'pete2');
        dismiss(bot); await bot.tick(1);
        for (let k = 0; k < 4 && bot.count('eadgar_alco_chunks') === 0; k++) {
            bot.useItemOnItem(objId('pineapple_chunks'), bot.slot('pineapple_chunks'), objId('vodka'), bot.slot('vodka')); bot.queueFlush();
            await bot.until(() => bot.count('eadgar_alco_chunks') > 0, 3);
        }
        if (bot.count('eadgar_alco_chunks') === 0) c.fail('alco-chunks (Pete\'s two dialog bits?)');
        const hatch = locAt(4043, 2611, 3287, 0);
        for (let k = 0; k < 4 && bot.count(PARROT) === 0; k++) {
            if (!inDialog(bot)) useOnLocGo(bot, 'eadgar_alco_chunks', hatch);
            await converse(bot, () => bot.count(PARROT) > 0, [], 12, 5);
        }
        if (bot.count(PARROT) === 0) c.fail('no parrot from the aviary');
        dismiss(bot);
    },
    sanfew: async c => {
        const bot = c.bot;
        await toTaverley(c, true);
        // chatnpc | multi2 "Have you any more work..." | chatplayer | chatnpc x2 | chatplayer | chatnpc x2 | multi2 "I'll do it." -> 10
        await talkTo(c, SANFEW, null, [R, M2[0]!, R, R, R, R, R, R, M2[0]!, R, R], [/^Have you any more work for me/, /^I'll do it\.$/],
            () => anyText(bot, /Thank you, adventurer!/), 'sanfew-start');
        dismiss(bot);
    },
    prison: async c => {
        const bot = c.bot;
        if (area(bot) === 'other' || (area(bot) === 'south' && bot.tile().z < 3500)) {
            if (bot.minusedlevel === 1) await toTaverley(c, false);
            await necklaceToBurthorpe(c);
        }
        await goto(c, 'prison');
        // free Eadgar if Troll Stronghold left him locked up: the guard's pocket holds his key only while he is jailed
        const KEY = 'troll_key_eadgar';
        const since = bot.tickCount;
        const answered = () => bot.count(KEY) > 0 || sawMsg(bot, /find nothing|fail to pick/, since);
        for (let k = 0; k < 4 && !answered(); k++) {
            const g = npc(bot, GUARD2) ?? (await go(c, { x: 2834, z: 10083 }, 'prison guard 2', { near: 2 }), npc(bot, GUARD2));
            if (!g) c.fail('prison guard 2 not visible');
            opNpcGo(bot, g!, 3);
            await bot.until(answered, 6);
        }
        if (bot.count(KEY) > 0) {
            const cell = locAt(3765, 2832, 10082, 0);
            const s2 = bot.tickCount;
            for (let k = 0; k < 4 && bot.count(KEY) > 0; k++) { useOnLocGo(bot, KEY, cell); await bot.until(() => bot.count(KEY) === 0, 6); }
            if (bot.count(KEY) > 0) c.fail('Eadgar\'s cell door');
            await bot.until(() => sawMsg(bot, /unlock the cell door/, s2), 3);
            dismiss(bot);
            c.mark('freed-eadgar');
        } else c.log(`Eadgar already free (${sawMsg(bot, /find nothing/, since) ? 'pocket empty' : 'no answer'})`);
    },
    cook1: async c => {
        const bot = c.bot;
        await goto(c, 'l1w');
        await talkTo(c, COOK, { x: 2846, z: 10058 }, [R, R, R, R, R, R, R, R, R, R], [], () => anyText(bot, /go fetch that for you then/), 'burntmeat1');
        dismiss(bot);
    },
    thistle: async c => {
        const bot = c.bot;
        await goto(c, 'surface');
        await shortcut(c);
        await go(c, { x: 2889, z: 3676 }, 'thistles', { near: 6, maxTicks: 400 });
        const end = bot.tickCount + 120;
        while (bot.tickCount < end && bot.count('eadgar_troll_thistle') === 0) {
            const t = npc(bot, THISTLE); if (!t) { await bot.tick(1); continue; }
            // the thistle re-spawns at one of 5 spots after each pick (eadgar_troll_thistle.rs2:134-148): walk next to it first
            if (t.d > 1) await walk(bot, { x: t.x, z: t.z }, null, () => (npc(bot, THISTLE)?.d ?? 99) <= 1, { near: 1, maxTicks: 40 });
            const t2 = npc(bot, THISTLE); if (!t2) continue;
            opNpcGo(bot, t2, 1);
            await bot.until(() => bot.count('eadgar_troll_thistle') > 0, 5);
        }
        if (bot.count('eadgar_troll_thistle') === 0) c.fail('troll thistle');
        await dryAndGrind(c);
    },
    eadgar1: async c => {
        const bot = c.bot;
        await toEadgar(c);
        // 20 -> 30 (needs parrot), then the default tree: "No thanks, Eadgar."
        if (bot.count(PARROT) === 0) c.fail('no parrot for Eadgar');
        // 20 -> 30 and, with the parrot held, the next talk -> 50 (talkTo re-talks until the plan's lines were seen)
        await eadgarTalk(c, 'eadgar-30', [/need a parrot/, /At the zoo/, /PARROT/, /Have you got me a parrot/, /That's the plan/, /What should I do with this parrot/]);
        await eadgarTalk(c, 'eadgar-50', [/That's the plan/, /What should I do with this parrot/, /troll prison/]);
    },
    rack1: async c => {
        const bot = c.bot;
        await goto(c, 'prison');
        const rack = locAt(3821, 2828, 10096, 0);
        for (let k = 0; k < 4 && bot.count(PARROT) > 0; k++) { useOnLocGo(bot, PARROT, rack); await bot.until(() => bot.count(PARROT) === 0, 10); }
        if (bot.count(PARROT) > 0) c.fail('hide the parrot');
    },
    eadgar2: async c => {
        const bot = c.bot;
        await toEadgar(c);
        const g0 = bot.count('grain');
        await eadgarTalk(c, 'eadgar-70', [/You now need/], () => bot.count('grain') < g0);
        if (bot.count('grain') >= g0) c.fail('Eadgar took no items (stage 60?)');
    },
    robe: async c => {
        const bot = c.bot;
        await goto(c, 'surface');   // out of the cave (teleport blocks? no: just a cleaner start)
        await toTaverley(c, false);
        // Falador west bank (20 tiles from the teleport): the grain/chickens are gone, so refill with BANK_SUPPLY food - the
        // trolls on the Death Plateau shelf took 13-20 hp per crossing even under Protect from Melee (sim). The detour costs
        // ~20 ticks (Falador TP -> Tegid 113 tiles direct, 24 + 128 via the bank: tool-route.ts), so bank only when the hp +
        // food held is short of what the rest takes (one shelf crossing + Trollheim + the storeroom knock-out: <= ~45 hp in
        // the sim). EADGAR_BANK=1 forces it (A/B), =0 skips it.
        const heal = FOODS.reduce((a, f) => { try { return a + bot.count(f); } catch { return a; } }, 0) * 20, hp = bot.stat('hitpoints').cur;
        const bank = process.env.EADGAR_BANK === '1' || (process.env.EADGAR_BANK !== '0' && hp + heal < 90);
        c.log(`robe: hp ${hp} + food ${heal} -> ${bank ? 'bank' : 'no bank'}`);
        if (bank) try {
            await walk(bot, { x: 2946, z: 3370 }, null, () => cheb(bot.tile(), { x: 2946, z: 3370 }) <= 2, { near: 2, maxTicks: 80 });
            const ob = await bot.openBank({ radius: 10 });
            if (ob.ok && bot.bankCount('shark') > 0) { await bot.withdraw('shark', Math.max(0, bot.free() - 3)); }
            if (ob.ok) { bot.closeBank(); await bot.tick(1); }
            c.log(`bank: sharks ${bot.count('shark')}`);
        } catch (e) { c.log(`bank skipped: ${(e as Error).message}`); }
        await talkTo(c, TEGID, { x: 2912, z: 3416 }, [R, R, R, R, R, R, M3[1]!, R, R], [/^Sanfew won't be happy/], () => bot.count('eadgar_dirty_druid_robe') > 0, 'tegid');
        dismiss(bot);
    },
    eadgar3: async c => {
        const bot = c.bot;
        await necklaceToBurthorpe(c);
        if ((process.env.EADGAR_VIA ?? 'stronghold') === 'arena') await arenaToEadgar(c);
        else await toEadgar(c);
        // robe -> "That's everything!" -> 80 (needs potion)
        await eadgarTalk(c, 'eadgar-80', [/That's everything/, /Troll Thistle/, /dry it in a fire/], () => bot.count('eadgar_dirty_druid_robe') === 0);
        await bot.tick(1);
        const POT = 'eadgar_ground_troll_thistle_potion';
        for (let k = 0; k < 4 && bot.count(POT) === 0; k++) {
            bot.useItemOnItem(objId('eadgar_ground_troll_thistle'), bot.slot('eadgar_ground_troll_thistle'), objId('ranarrvial'), bot.slot('ranarrvial')); bot.queueFlush();
            await bot.until(() => bot.count(POT) > 0, 4);
            if (inDialog(bot)) await converse(bot, () => bot.count(POT) > 0, [/./], 6, 5);
        }
        if (bot.count(POT) === 0) c.fail('troll truth potion (stage 80?)');
        await eadgarTalk(c, 'eadgar-85', [], () => bot.count(POT) === 0);
    },
    rack2: async c => {
        const bot = c.bot;
        await goto(c, 'prison');
        await obstacle(c, { id: 3821, x: 2828, z: 10096 }, null, () => bot.count(PARROT) > 0 || inDialog(bot), 'rack (parrot back)');
        await converse(bot, () => bot.count(PARROT) > 0 && !inDialog(bot), [], 10, 5);
        if (bot.count(PARROT) === 0) c.fail('parrot not back');
        dismiss(bot);
    },
    eadgar4: async c => {
        const bot = c.bot;
        await toEadgar(c);
        // the fake man is queued until the default tree is answered or closed (quest_eadgar.rs2:426-436)
        await eadgarTalk(c, 'eadgar-87', [/bona fide human/, /fake man/i], () => bot.count('eadgar_fake_man') > 0);
        if (bot.count('eadgar_fake_man') === 0) await bot.until(() => bot.count('eadgar_fake_man') > 0, 4);
        if (bot.count('eadgar_fake_man') === 0) c.fail('no fake man');
        dismiss(bot);
    },
    cook2: async c => {
        const bot = c.bot;
        const KEY = 'eadgar_troll_storeroom_key';
        // a resume past the cook (90: burnt meat) / past the storeroom door (100) skips those parts (RS = the journal stage)
        if (RS < 90) {
        await goto(c, 'l1w');
        await talkTo(c, COOK, { x: 2846, z: 10058 }, [], [/^So, where can I get some goutweed\?$/], () => bot.count('burnt_meat') > 0, 'burntmeat2');
        await converse(bot, () => !inDialog(bot), [/^So, where can I get some goutweed\?$/], 10, 5);
        dismiss(bot);
        }
        if (RS < 100) {
        if (bot.count(KEY) === 0) {
        if (RS >= 90) await goto(c, 'l1w');
        // kitchen drawers: open (3816 -> eadgar_kitchen_drawers_open), then search (op2)
        const drawers = { id: 3816, x: 2852, z: 10049, level: 1 };
        await obstacle(c, drawers, null, () => bot.liveLocs.get(`1,${drawers.x},${drawers.z}`) !== undefined && bot.liveLocs.get(`1,${drawers.x},${drawers.z}`) !== drawers.id, 'open the kitchen drawers');
        const openId = bot.liveLocs.get(`1,${drawers.x},${drawers.z}`)!;
        await obstacle(c, { id: openId, x: drawers.x, z: drawers.z, level: 1 }, null, () => bot.count(KEY) > 0, 'search the drawers', 2).catch(async () => {
            // the open drawer is a runtime loc (not in the static scene): send the op directly
            for (let k = 0; k < 4 && bot.count(KEY) === 0; k++) { bot.opLoc(drawers.x, drawers.z, openId, 2); bot.queueFlush(); await bot.until(() => bot.count(KEY) > 0, 4); }
        });
        if (bot.count(KEY) === 0) c.fail('storeroom key');
        }
        await goto(c, 'l0east');
        const since = bot.tickCount;
        await obstacle(c, { id: 3810, x: 2869, z: 10085 }, null, () => bot.count(KEY) === 0 || sawMsg(bot, /You unlock the door/, since), 'storeroom door');
        } else if (bot.count('eadgar_goutweed_herb') === 0) {
            // 100: into the unlocked storeroom (the door 3810 just opens now)
            // session 11 fix 391 (qx317/320/321/323 DIED: the storeroom door (2869,10085) walls its SOUTH edge, so its own tile is
            // still inside; with x<=2868 'door (out)' was done on arrival, before the server ran the door op). EADGAR_DOORTILE=0 reverts.
            const inStore0 = () => { const t = bot.tile(); return bot.minusedlevel === 0 && ((t.x >= 2850 && t.x <= 2868 && t.z >= 10073 && t.z <= 10093) || (process.env.EADGAR_DOORTILE !== '0' && t.x === 2869 && t.z === 10085)); };
            if (!inStore0()) { await goto(c, 'l0east'); await obstacle(c, { id: 3810, x: 2869, z: 10085 }, null, inStore0, 'storeroom door (resume)', 1, 60); }
        }
        const GW = 'eadgar_goutweed_herb';
        // patrolling guards (_troll_sguard ai_timer, quest_eadgar.rs2:510-539) knock you out and move you to (2865,10088):
        // just try again (up to 400 ticks)
        // wait (out of the patrol paths) until no patrolling guard is within 5 tiles of the crate, then go for it
        const GUARDS = [1142, 1143, 1144, 1145, 1146, 1147, 1148, 1149], CRATE = { x: 2857, z: 10074 };
        const crate = locAny(3822, 2857, 10074, 0);
        const gEnd = bot.tickCount + 500;
        let waited = 0, tries = 0;
        if (process.env.EADGAR_CRATE !== 'old') await guardedGoutweed(c);
        while (bot.count(GW) === 0 && bot.tickCount < gEnd) {
            const near = npcsOf(bot, GUARDS).some(g => cheb(g, CRATE) <= 5);
            if (!near) {
                // the walker re-plans around npcs standing in the crate aisles (opLocGo's straight route wedged at 2862,10092)
                if (cheb(bot.tile(), { x: 2858, z: 10074 }) > 0) await walk(bot, { x: 2858, z: 10074 }, null, () => cheb(bot.tile(), { x: 2858, z: 10074 }) === 0 || bot.count(GW) > 0, { near: 0, maxTicks: 40 });
                opLocGo(bot, crate, 1); tries++;
                await bot.until(() => bot.count(GW) > 0 || npcsOf(bot, GUARDS).some(g => cheb(g, CRATE) <= 3), 6);
            }
            else { waited++; await bot.tick(1); }
        }
        if (bot.count(GW) === 0) c.fail('goutweed crate (patrol guards)');
        c.log(`goutweed: ${tries} tries, ${waited} ticks waiting for the patrol, hp ${bot.stat('hitpoints').cur}`);
        // the storeroom guard's knock-out + teleport to (2865,10088) (quest_eadgar.rs2:557-590): wait for it, or the next
        // teleport's position check would take this jump for the cast
        await bot.until(() => cheb(bot.tile(), { x: 2865, z: 10088 }) <= 1, 8);
        await bot.tick(3);
        // out of the storeroom (its door closes itself behind you: open_and_close_door2, quest_eadgar.rs2:504-505), then up to L1
        // away from the patrols before teleporting (a knock-out interrupted the Falador cast, seed 6312)
        // session 11 fix 391 (qx317/320/321/323 DIED: the storeroom door (2869,10085) walls its SOUTH edge, so its own tile is
        // still inside; with x<=2868 'door (out)' was done on arrival, before the server ran the door op). EADGAR_DOORTILE=0 reverts.
        const inStore = () => { const t = bot.tile(); return bot.minusedlevel === 0 && ((t.x >= 2850 && t.x <= 2868 && t.z >= 10073 && t.z <= 10093) || (process.env.EADGAR_DOORTILE !== '0' && t.x === 2869 && t.z === 10085)); };
        if (inStore()) await obstacle(c, { id: 3810, x: 2869, z: 10085 }, null, () => !inStore(), 'storeroom door (out)', 1, 40).catch(() => undefined);
        for (let k = 0; k < 3; k++) {
            try { await goto(c, 'l1w'); break; } catch (e) {
                if (!(e instanceof QuestFail) || k === 2) throw e;
                bot.opLoc(2869, 10085, 3810, 1); bot.queueFlush(); await bot.tick(3);
            }
        }
        dismiss(bot);
    },
    finish: async c => {
        const bot = c.bot;
        // out of the stronghold: the games necklace works from anywhere below wilderness 20; then Falador Teleport to Taverley
        await toTaverley(c, true);
        await talkTo(c, SANFEW, null, [R, R, R, R, R], [], () => bot.count('eadgar_goutweed_herb') === 0, 'sanfew-finish');
        await converse(bot, () => !inDialog(bot), [], 10, 5);
    },
};


/** Talk to Eadgar until one of `marks` has been SEEN (latched every tick: bursts can skip a page) and the dialog is closed.
 *  Choice pages: "No thanks, Eadgar." / "More" (the scarecrow tree). Extra `ok()` = an item-based proof. */
async function eadgarTalk(c: Ctx, label: string, marks: RegExp[], ok: () => boolean = () => false): Promise<void> {
    const bot = c.bot;
    let seen = false;
    const latch = () => (seen ||= marks.some(re => anyText(bot, re)) || ok());
    await talkTo(c, EADGAR, null, [], [/^No thanks, Eadgar\.$/, /^More$/], () => latch() && !inDialog(bot), label);
    dismiss(bot);
}

/** The storeroom patrol (quest_eadgar.npc troll_sguard1-8, patrolN=0_44_157_x_z = (2816+x, 10048+z), timer=1): every tick
 *  each guard hunts its own tile and the next 1-2 tiles toward its patrol destination ([ai_timer,_troll_sguard],
 *  quest_eadgar.rs2:510-528); a player there is knocked out and thrown back to (2865,10088) (:530-590). The patrols are
 *  fixed loops, so the danger tiles are predictable: simulate every guard two ticks ahead and step (the planner's route)
 *  only onto tiles no guard will hunt; hold, or sidestep, otherwise. The stand east of the crate (2858,10074) is out of
 *  every patrol's reach. EADGAR_CRATE=old = the previous "no guard within 5 of the crate" rule (A/B). */
const PATROLS: Record<number, Array<[number, number]>> = {
    1142: [[34, 44], [43, 44], [43, 41], [34, 41]],
    1143: [[34, 41], [34, 38], [39, 38], [39, 41]],
    1144: [[39, 41], [39, 38], [43, 38], [43, 41]],
    1145: [[34, 38], [38, 38], [38, 34], [36, 34], [36, 30], [34, 30]],
    1146: [[45, 32], [47, 32], [44, 29], [45, 29], [48, 32], [48, 37], [45, 37]],
    1147: [[39, 34], [36, 34], [36, 30], [34, 30], [34, 27], [37, 27], [37, 29], [39, 29]],
    1148: [[42, 28], [42, 34], [39, 34], [39, 28]],
    1149: [[48, 37], [48, 32], [45, 29], [44, 29], [47, 32], [45, 32], [45, 37]],
};
const sgn = (v: number) => (v > 0 ? 1 : v < 0 ? -1 : 0);
const wp = (type: number, i: number) => ({ x: 2816 + PATROLS[type]![i]![0], z: 10048 + PATROLS[type]![i]![1] });
type G = { x: number; z: number; type: number; dest: number };   // dest = index into the patrol
/** Which patrol leg is the guard on? The leg whose naive step path contains its tile with a step direction equal to its last
 *  observed move (dx,dz); null if none matches. */
function legOf(type: number, x: number, z: number, dx: number, dz: number): number | null {
    const n = PATROLS[type]!.length;
    for (let i = 0; i < n; i++) {
        const from = wp(type, (i + n - 1) % n), to = wp(type, i);
        let p = { ...from };
        for (let k = 0; k < 20; k++) {
            const nx = { x: p.x + sgn(to.x - p.x), z: p.z + sgn(to.z - p.z) };
            // it moved INTO (x,z) with (dx,dz): (x,z) = nx and p -> nx had that step
            if (nx.x === x && nx.z === z && nx.x - p.x === dx && nx.z - p.z === dz) return i;
            if (nx.x === to.x && nx.z === to.z) break;
            p = nx;
        }
    }
    return null;
}
/** Tiles a guard hunts this tick: its tile, +1, and +2 unless it stands on its destination (it then turns to the next). */
function hunted(g: G, out: Set<string>): void {
    let d = wp(g.type, g.dest);
    if (g.x === d.x && g.z === d.z) d = wp(g.type, (g.dest + 1) % PATROLS[g.type]!.length);
    const dx = sgn(d.x - g.x), dz = sgn(d.z - g.z);
    out.add(`${g.x},${g.z}`); out.add(`${g.x + dx},${g.z + dz}`); out.add(`${g.x + 2 * dx},${g.z + 2 * dz}`);
}
function stepG(g: G): G {
    let dest = g.dest, d = wp(g.type, dest);
    if (g.x === d.x && g.z === d.z) { dest = (dest + 1) % PATROLS[g.type]!.length; d = wp(g.type, dest); }
    return { ...g, x: g.x + sgn(d.x - g.x), z: g.z + sgn(d.z - g.z), dest };
}
/** Walkable one-step neighbours inside the storeroom (x 2849-2868, z 10073-10093), from the rsmod planner (cached). */
const NBR = new Map<string, Array<{ x: number; z: number }>>();
function nbrs(t: { x: number; z: number }): Array<{ x: number; z: number }> {
    const k = `${t.x},${t.z}`; const hit = NBR.get(k); if (hit) return hit;
    const out: Array<{ x: number; z: number }> = [];
    for (let ax = -1; ax <= 1; ax++) for (let az = -1; az <= 1; az++) {
        if (!ax && !az) continue;
        const n = { x: t.x + ax, z: t.z + az };
        if (n.x < 2849 || n.x > 2869 || n.z < 10073 || n.z > 10093) continue;
        try { const p = navSync().findLongPath(0, t.x, t.z, n.x, n.z, 3); if (p.length === 1 && p[0]!.x === n.x && p[0]!.z === n.z) out.push(n); } catch { /* none */ }
    }
    NBR.set(k, out); return out;
}
/** Earliest safe arrival at `goal`: returns the tiles to send this tick (1-2 steps; [me] = wait), or null if none in 30 ticks. */
function spacetimePlan(me: { x: number; z: number }, goal: { x: number; z: number }, gs: G[], unknown: Array<{ x: number; z: number }>, bad: Set<string>): Array<{ x: number; z: number }> | null {
    const H = 30;
    const D: Array<Set<string>> = []; let g = gs;
    for (let k = 0; k <= H + 1; k++) { const s = new Set<string>(); for (const x of g) hunted(x, s); D.push(s); g = g.map(stepG); }
    const ok = (t: { x: number; z: number }, k: number) => !D[k - 1]!.has(`${t.x},${t.z}`) && !D[k]!.has(`${t.x},${t.z}`) && !D[k + 1]!.has(`${t.x},${t.z}`) && !unknown.some(u => cheb(u, t) <= 2);
    type N = { x: number; z: number; k: number; first: Array<{ x: number; z: number }> | null };
    const seen = new Set<string>([`${me.x},${me.z},0`]); let q: N[] = [{ ...me, k: 0, first: null }];
    while (q.length) {
        const nq: N[] = [];
        for (const s of q) {
            if (s.x === goal.x && s.z === goal.z) return s.first ?? [me];
            if (s.k >= H) continue;
            const k = s.k + 1;
            const moves: Array<Array<{ x: number; z: number }>> = [[]];
            for (const a of nbrs(s)) { if (bad.has(`${s.x},${s.z}>${a.x},${a.z}`)) continue; moves.push([a]); for (const b of nbrs(a)) if ((b.x !== s.x || b.z !== s.z) && !bad.has(`${a.x},${a.z}>${b.x},${b.z}`)) moves.push([a, b]); }
            for (const m of moves) {
                const e = m.length ? m[m.length - 1]! : s;
                const key = `${e.x},${e.z},${k}`; if (seen.has(key) || !ok(e, k)) continue;
                seen.add(key); nq.push({ x: e.x, z: e.z, k, first: s.first ?? (m.length ? m : [me]) });
            }
        }
        q = nq;
    }
    return null;
}
const msgsTail = (bot: SpeedBot) => { try { return msgsSince(bot, bot.tickCount - 10); } catch { return []; } };
async function guardedGoutweed(c: Ctx): Promise<void> {
    const bot = c.bot, GW = 'eadgar_goutweed_herb', STAND = { x: 2858, z: 10074 };
    const crate = locAny(3822, 2857, 10074, 0);
    const last = new Map<number, { x: number; z: number; dx: number; dz: number }>(), legs = new Map<number, number>();
    const end = bot.tickCount + 300;
    let knocks = 0, held = 0, lastTile = '', prevTile = '', stall = 0; const ring: string[] = []; const badEdges = new Set<string>(['2862,10092>2861,10092', '2861,10092>2862,10092']);   // refused by the server every time (8/8 runs), though the planner allows it
    let stMove: { from: string; to: string; n: number } | null = null;
    while (bot.count(GW) === 0 && bot.tickCount < end) {
        const me = bot.tile();
        if (me.x === 2865 && me.z === 10088 && lastTile && lastTile !== '2865,10088') { knocks++; if (knocks <= 3) c.log(`KO ${knocks}: ${ring.slice(-5).join(' || ')}`); }
        lastTile = `${me.x},${me.z}`;
        // observe the guards; derive each one's patrol leg from its last move
        const gs: G[] = [], unknown: Array<{ x: number; z: number }> = [];
        for (const n of npcsOf(bot, Object.keys(PATROLS).map(Number))) {
            const p = last.get(n.idx);
            const dx = p ? n.x - p.x : 0, dz = p ? n.z - p.z : 0;
            const moved = (dx || dz) && Math.abs(dx) <= 1 && Math.abs(dz) <= 1;
            const mv = moved ? { dx, dz } : p ? { dx: p.dx, dz: p.dz } : { dx: 0, dz: 0 };
            last.set(n.idx, { x: n.x, z: n.z, ...mv });
            // a guard that did not move this tick (a pause at a waypoint, or a lagging tile read) keeps its last known leg
            const leg = moved ? legOf(n.type, n.x, n.z, dx, dz) : (legs.get(n.idx) ?? null);
            if (leg === null) { legs.delete(n.idx); unknown.push(n); } else { legs.set(n.idx, leg); gs.push({ x: n.x, z: n.z, type: n.type, dest: leg }); }
        }
        if (me.x === STAND.x && me.z === STAND.z) {
            opLocGo(bot, crate, 1);
            await bot.until(() => bot.count(GW) > 0 || bot.tile().x !== me.x || bot.tile().z !== me.z, 4);
            continue;
        }
        // danger over the next two ticks (each guard before and after its moves); a guard whose leg is unknown: 2-tile radius
        const D = new Set<string>();
        const g1 = gs.map(stepG), g2 = g1.map(stepG);
        for (const g of [...gs, ...g1, ...g2]) hunted(g, D);
        ring.push(`t${bot.tickCount} me ${me.x},${me.z} g ${gs.map(g => `${g.type - 1141}@${g.x},${g.z}>${g.dest}`).join(' ')} unk ${unknown.map(u => `${u.x},${u.z}`).join(' ')}`);
        const safe = (t: { x: number; z: number }) => !D.has(`${t.x},${t.z}`) && !unknown.some(u => cheb(u, t) <= 2);
        // space-time plan (EADGAR_CRATE=greedy skips it): BFS over (tile, tick) up to 30 ticks ahead, 0-2 steps per tick, every
        // tile held at the end of tick k clear of what the guards hunt from their tiles at k-1, k and k+1 (a KO was seen from a
        // guard's PRE-move tile against the player's POST-move tile); take the first move of the earliest arrival
        if (process.env.EADGAR_CRATE !== 'greedy') {
            const plan = spacetimePlan(me, STAND, gs, unknown, badEdges);
            if (plan) {
                const want = plan[plan.length - 1]!;
                if (want.x !== me.x || want.z !== me.z) {
                    if (stMove && stMove.from === lastTile && stMove.to === `${want.x},${want.z}` && lastTile === prevTile) { if (++stMove.n >= 3) { badEdges.add(`${lastTile}>${plan[0]!.x},${plan[0]!.z}`); c.log(`goutweed: step ${lastTile} -> ${plan[0]!.x},${plan[0]!.z} refused, avoiding it`); } }
                    else stMove = { from: lastTile, to: `${want.x},${want.z}`, n: 0 };
                    bot.sendRoute(plan); bot.queueFlush();
                } else held++;
                prevTile = lastTile;
                await bot.tick(1);
                continue;
            }
        }
        let pts: Array<{ x: number; z: number }> = [];
        try { pts = densify([me, ...navSync().findLongPath(0, me.x, me.z, STAND.x, STAND.z, 100)]).slice(1); } catch { pts = []; }
        if (!pts.length) { c.log(`goutweed: no path from (${me.x},${me.z})`); return; }
        const cand = [pts[1], pts[0]].filter(Boolean) as Array<{ x: number; z: number }>;
        const next = cand.find(safe);
        if (lastTile === prevTile && next) stall++; else stall = 0;
        prevTile = lastTile;
        if (stall === 3 || stall === 6 || stall === 9) {
            const ll: string[] = []; for (const [k, id] of bot.liveLocs) { const [lv, x, z] = k.split(',').map(Number); if (lv === 0 && cheb({ x: x!, z: z! }, me) <= 2) ll.push(`${id}@${x},${z}`); }
            c.log(`guarded STALL at (${me.x},${me.z}) -> ${JSON.stringify(next)} liveLocs ${ll.join(' ')} npcs ${npcsOf(bot, [...Array(5000).keys()]).filter(n => n.d <= 3).map(n => `${n.type}@${n.x},${n.z}`).join(' ')} delayed=${(bot as any).delayed ?? '?'} msgs ${JSON.stringify(msgsTail(bot))}`);
        }
        if (next && stall >= 3) {   // the server refused the step (seen at (2862,10092) -> west): single tile, then OPCLICK, then the walker
            if (stall >= 9 && stall % 3 === 0) { c.log(`guarded stall ${stall}: walker`); await walk(bot, pts[Math.min(3, pts.length - 1)]!, null, () => cheb(bot.tile(), me) >= 2, { near: 0, maxTicks: 6 }); }
            else { bot.sendRoute([pts[0]!], stall >= 6); bot.queueFlush(); }
        }
        else if (next) { bot.sendRoute(pts.slice(0, pts.indexOf(next) + 1)); bot.queueFlush(); }
        else if (!safe(me)) {   // standing in a lane: any safe walkable neighbour
            let ok: { x: number; z: number } | undefined;
            for (let ax = -1; ax <= 1 && !ok; ax++) for (let az = -1; az <= 1 && !ok; az++) {
                if (!ax && !az) continue;
                const t = { x: me.x + ax, z: me.z + az };
                try { const p = navSync().findLongPath(0, me.x, me.z, t.x, t.z, 3); const e = p[p.length - 1]; if (e && e.x === t.x && e.z === t.z && p.length === 1 && safe(t)) ok = t; } catch { /* none */ }
            }
            if (ok) { bot.sendRoute([ok]); bot.queueFlush(); } else held++;
        } else { bot.sendRoute([me]); bot.queueFlush(); held++; }
        await bot.tick(1);
    }
    c.log(`goutweed (guarded): ${bot.count(GW) ? 'got it' : 'not yet'}, ${knocks} knock-outs, ${held} ticks held`);
}

/** Trollheim mountain shortcut: troll_mountain_shortcut_climbingrocks1 3803 (2885,3683) (m45_57; quest_troll.rs2:136-195:
 *  agility 15, forcemove x+2 east from (2884,3683), a slip puts you back for 5% hp). The walk from the stronghold door
 *  (2840,3690) to the cave mouth (2892,3674) is 174 tiles round the serpentine path; via the rocks 115 + 12 (thistles: 171
 *  vs 115 + 9; tool-route.ts). Outbound it saves nothing (146 vs 25 + 115). EADGAR_SHORTCUT=0 turns it off (A/B). */
async function shortcut(c: Ctx): Promise<void> {
    const bot = c.bot;
    if (process.env.EADGAR_SHORTCUT === '0' || area(bot) !== 'surface' || bot.tile().x > 2884 || bot.tile().z < 3660) return;
    pray(bot, 'protectfrommelee', true, 43);
    try { await obstacle(c, { id: 3803, x: 2885, z: 3683 }, { x: 2884, z: 3683 }, () => bot.tile().x >= 2886, 'mountain shortcut rocks', 1, 200); }
    finally { prayOff(bot); }
}
/** Anywhere in the troll area -> Eadgar's home (L2), over the mountain shortcut when coming from the stronghold. */
async function toEadgar(c: Ctx): Promise<void> {
    if (area(c.bot) !== 'eadgar') { await goto(c, 'surface'); await shortcut(c); }
    await goto(c, 'eadgar');
}

/** Burthorpe / Death Plateau -> Eadgar's cave through the ARENA and the troll pass (the Troll Stronghold quest route, Dad
 *  already beaten) instead of secret door -> prison -> L1 -> L2 hall -> top exit -> 168-tile walk. Transitions (stand tiles
 *  from headless/quest-troll.ts TROLL_T, content quest_troll.rs2): troll_climbingrocks_top 3790 (2859,3626) exactmove x+3
 *  (:17-43), troll_climbingrocks_bottom 3791 (2878,3622) forcemove x+3 (:45-72), arena entrance 3782 (2897,3618) (:74-88),
 *  arena exit 3785 (2916,3629) (opens at >= troll_defeated_dad, :90-106), troll pass 3757 (2903,3644) -> (2907,10019)
 *  (:121-123), pass exit 3758 (2906,10036) -> (2908,3654) (:125-127): 20 tiles from Eadgar's cave (2892,3672). A failed
 *  climb still moves you (top) or puts you back (bottom): obstacle() re-ops until the done-check holds. */
async function arenaToEadgar(c: Ctx): Promise<void> {
    const bot = c.bot, t = () => bot.tile();
    await goto(c, 'band');   // Burthorpe -> Death Plateau rocks -> troll rocks (2856,3612)
    pray(bot, 'protectfrommelee', true, 43);   // the shelf trolls + the mountain trolls past the pass
    try {
        if (t().x <= 2858) await obstacle(c, { id: 3790, x: 2859, z: 3626 }, { x: 2858, z: 3626 }, () => t().x >= 2861 && t().z >= 3613, 'climbing rocks (2859,3626)');
        if (t().x <= 2877) await obstacle(c, { id: 3791, x: 2878, z: 3622 }, { x: 2877, z: 3622 }, () => t().x >= 2880 && t().z >= 3613, 'climbing rocks (2878,3622)');
        if (t().x <= 2896) await obstacle(c, { id: 3782, x: 2897, z: 3618 }, { x: 2896, z: 3618 }, () => t().x >= 2897, 'arena entrance');
        dismiss(bot);   // (a first pass with %troll_told unset: Dad's "No human pass..." line)
        if (t().z <= 3628) await obstacle(c, { id: 3785, x: 2916, z: 3629 }, { x: 2916, z: 3628 }, () => t().z >= 3629, 'arena exit');
        await obstacle(c, { id: 3757, x: 2903, z: 3644 }, { x: 2904, z: 3643 }, () => t().z > 6400, 'troll pass');
        await obstacle(c, { id: 3758, x: 2906, z: 10036 }, { x: 2907, z: 10035 }, () => t().z < 6400, 'troll pass exit');
    } finally { prayOff(bot); }
    await goto(c, 'eadgar');
}

/** Light the spare logs, dry the thistle on the fire, grind it with the pestle and mortar. */
async function dryAndGrind(c: Ctx): Promise<void> {
    const bot = c.bot;
    if (bot.count('eadgar_ground_troll_thistle') > 0) return;
    if (bot.count('eadgar_dried_troll_thistle') === 0) {
        // fire: tinderbox on logs (keeps one log for Eadgar: the pack holds 2)
        let fire: { x: number; z: number; id: number } | null = null;
        const findFire = () => { for (const [k, id] of bot.liveLocs) { if (id !== 2732) continue; const [lv, x, z] = k.split(',').map(Number); if (lv === bot.minusedlevel && cheb({ x: x!, z: z! }, bot.tile()) <= 3) return { x: x!, z: z!, id }; } return null; };
        // one tinderbox-on-logs: the log is dropped and the engine re-attempts on its own (p_opobj(4), 4-tick cycle,
        // stat_random(firemaking, 64, 512): firemaking.rs2:79-117) until it catches; re-send only if that stopped
        // (2886,3676) took a fire in the sim; (2891,3677) did not ("You can't light a fire here": a loc on the tile)
        await go(c, { x: 2886, z: 3676 }, 'fire spot', { near: 0, maxTicks: 60 });
        const logs0 = bot.count('logs');
        let sent = -99, since = bot.tickCount;
        for (let k = 0; k < 80 && !(fire = findFire()); k++) {
            if (sawMsg(bot, /can't light a fire here/, since)) {   // step to a neighbour and retry
                const t = bot.tile(); since = bot.tickCount;
                await walk(bot, { x: t.x - 1, z: t.z }, null, () => bot.tile().x !== t.x || bot.tile().z !== t.z, { near: 0, maxTicks: 6 });
                sent = -99;
            }
            if (bot.count('logs') === logs0 && bot.tickCount - sent >= 6) { bot.useItemOnItem(objId('tinderbox'), bot.slot('tinderbox'), objId('logs'), bot.slot('logs')); bot.queueFlush(); sent = bot.tickCount; }
            await bot.tick(1);
        }
        if (!fire) c.fail('could not light a fire');
        const f = fire!;
        for (let k = 0; k < 4 && bot.count('eadgar_dried_troll_thistle') === 0; k++) {
            bot.useItemOnLoc(f.x, f.z, f.id, objId('eadgar_troll_thistle'), bot.slot('eadgar_troll_thistle')); bot.queueFlush();
            await bot.until(() => bot.count('eadgar_dried_troll_thistle') > 0 || inDialog(bot), 5);
            if (inDialog(bot)) await converse(bot, () => bot.count('eadgar_dried_troll_thistle') > 0, [/./], 6, 5);
        }
        if (bot.count('eadgar_dried_troll_thistle') === 0) c.fail('dry the thistle');
    }
    for (let k = 0; k < 4 && bot.count('eadgar_ground_troll_thistle') === 0; k++) {
        bot.useItemOnItem(objId('pestle_and_mortar'), bot.slot('pestle_and_mortar'), objId('eadgar_dried_troll_thistle'), bot.slot('eadgar_dried_troll_thistle')); bot.queueFlush();
        await bot.until(() => bot.count('eadgar_ground_troll_thistle') > 0, 4);
    }
    if (bot.count('eadgar_ground_troll_thistle') === 0) c.fail('grind the thistle');
}
export { objDebugName, npcsOf, walk, eatIfLow, packStr, locAny, sendToks, opLocGo, M2 };
