// q-romance.ts — Troll Romance (2 QP). CHEAT-FREE. Content: server/content/scripts/quests/quest_troll_love/scripts/*.rs2,
// quests/quest_death/scripts/{death_sherpa,death_smithy}.rs2. %troll_love (quest_troll_love.constant): 5 started, 10 Aga wants
// Trollweiss, 15 learnt about it (Tenzing), 20 bring Dunstan materials, 22 sled made, 25 waxed, 30 picked, 35 dispose of
// Arrg, 40 defeated Arrg, 45 complete.
// Stages:
//   ug1       Ug (1553, stronghold L1 2827,10064): needs Troll Stronghold complete (ug.rs2:29-60) -> 5.
//   aga       Aga (1554, L1 2828,10104): "So... how's your... um... love life?" -> 10 (aga.rs2:136-166).
//   burthorpe out through the prison and Death Plateau; Tenzing "Do you know where I can find Trollweiss?" + "What would I
//             need to make such a sled?" -> 15 (death_sherpa.rs2:43-72); Dunstan "I need a sled!!" -> 20, talk again with maple
//             logs + iron bar + rope -> toboggan, 22 (death_smithy.rs2:91-101, :213-258); swamp tar on the bucket of wax with a
//             cake tin -> sled wax, wax on the toboggan -> waxed, 25 (quest_troll_love.rs2:67-98).
//   flower    Trollheim -> the ice cave entrance 5007 (2820,3743) -> crevasse 5025 (2772,10233) -> Trollweiss (2778,3869);
//             wield the waxed sled, op the piste barrier 5015 (agility 28) -> ride (:1-16, :131-223) -> pick Trollweiss
//             (5006, op2) -> 30 (:47-57).
//   ug2       Trollheim Teleport (Eadgar's Ruse) -> stronghold -> Ug with the flower -> 35 (ug.rs2:90-102).
//   arrg      Arrg (1555, L1 2828,10095) "I am here to kill you!" -> teleported to the arena (2914,3611), Arrg (1556, 140 hp,
//             defence 40, melee + poison rocks) -> 40 (arrg.rs2:199-306).
//   ug3       arena exit -> troll pass -> stronghold -> Ug -> complete (ug.rs2:108-116, quest_troll_love.rs2:296-306).
import { SpeedBot, objId, objDebugName, cheb } from '../../../core.js';
import { npc, npcsOf, inDialog, locAt, opLocGo, opNpcGo, useOnLocGo, dismiss, tele, qp, type Tile } from '../../q-lib.js';
import { Ctx, QuestFail, go, walk, converse, sawMsg, dead, eatIfLow, nav, packStr, obstacle, talkTo, openDoorNear, type Item } from './lib-troll.js';
import { area, goto, prayOff, pray } from './troll-area.js';
import { wield } from '../../run-lib.js';
import { isResuming, journalStage, failHook } from '../journal.js';

export const QUEST = { name: 'Troll Romance', dir: 'quest_troll_love', qp: 2 };
export const REQUIREMENTS = {
    quests: ['Troll Stronghold', 'Death Plateau', "Eadgar's Ruse"] as string[],   // Eadgar's Ruse: Trollheim Teleport (teleport.rs2:30)
    qp: 0,
    skills: {
        agility: [28, 'ride the sled (quest_troll_love.rs2:2-5); 15 for the troll rocks'],
        magic: [61, 'Trollheim Teleport (magic_spells.dbrow levelrequired 61)'],
        prayer: [43, 'Protect from Missiles/Melee on the Death Plateau shelf and in the stronghold L2 hall'],
    } as Record<string, [number, string]>,
    start: { x: 2899, z: 3564, level: 0 },    // Burthorpe (the games-necklace landing outside the games room)
    end: { x: 2827, z: 10064, level: 1 },     // Ug
};
export const SUPPLY: Item[] = [
    { name: 'maple_logs', n: 1 }, { name: 'iron_bar', n: 1 }, { name: 'rope', n: 1 }, { name: 'bucket_wax', n: 1 }, { name: 'swamp_tar', n: 1 },
    { name: 'cake_tin', n: 1 }, { name: 'death_climbingboots', n: 1 }, { name: 'firerune', n: 2 }, { name: 'lawrune', n: 2 }, { name: 'shark', n: 12 },
    { name: '4doseprayerrestore', n: 2 },   // Protect from Melee for Arrg after the shelf / L2 prayers drained it
];
export const STAGES = ['ug1', 'aga', 'burthorpe', 'flower', 'ug2', 'arrg', 'ug3'] as const;
export interface RomanceOpts { log?: boolean; from?: string; to?: string }

const UG = 1553, AGA = 1554, ARRG = 1555, ARRG_FIGHT = 1556, TENZING = 1071, DUNSTAN = 1082;
const anyText = (bot: SpeedBot, re: RegExp) => re.test([...bot.ifText.values()].join(' ').replace(/\s+/g, ' '));
async function latchTalk(c: Ctx, type: number, stand: Tile | null, answers: RegExp[], marks: RegExp[], ok: () => boolean, label: string): Promise<void> {
    const bot = c.bot; let seen = false;
    const latch = () => (seen ||= marks.some(re => anyText(bot, re)) || ok());
    await talkTo(c, type, stand, [], answers, () => latch() && !inDialog(bot), label);
    dismiss(bot);
}

/** troll_love_journal.rs2 open lines -> [%troll_love, STAGES step], latest first (session 10) */
const ROMANCE_STAGES: Array<[RegExp, [number, string]]> = [
    [/QUEST COMPLETE/i, [45, 'done']], [/talk to Ug to get my reward/i, [40, 'ug3']], [/have to defeat Arrg/i, [35, 'arrg']],
    [/give the Trollweiss to Ug/i, [30, 'ug2']], [/get the Trollweiss from the plateau/i, [25, 'flower']],
    [/to make some\s+sled wax/i, [22, 'burthorpe']], [/maple logs, an iron bar and rope/i, [20, 'burthorpe']],
    [/talk to Dunstan about the sled/i, [15, 'burthorpe']], [/ask someone about Trollweiss/i, [10, 'burthorpe']],
    [/I should speak to Aga/i, [5, 'aga']], [/I can start this quest/i, [0, 'ug1']],
];
/** the %troll_love a resumed attempt read from the journal (-1 = a fresh attempt): 'burthorpe' skips its finished talks */
let RS = -1;

export async function run(bot: SpeedBot, o: RomanceOpts = {}): Promise<{ ok: boolean; ticks: number; msg: string }> {
    const c = new Ctx(bot, 'romance', o);
    await nav();
    bot.holdDialogs = true;
    const qp0 = qp(bot);
    RS = -1;
    // session 10 (the route passed a fixed from 'ug1'): on a retry / resume, the step the quest JOURNAL shows. ROMANCE_RESUME=0 reverts.
    if ((!o.from || o.from === 'ug1') && isResuming(bot) && process.env.ROMANCE_RESUME !== '0') {
        if (bot.chatModalId !== -1 || bot.mainModalId !== -1) { dismiss(bot); await bot.tick(1); }
        const [st, step] = await journalStage<[number, string]>(bot, 'troll_love', ROMANCE_STAGES, [-1, o.from ?? 'ug1'], s => c.log(s));
        if (step === 'done') return { ok: true, ticks: c.t, msg: `journal: quest complete (qp ${qp0} -> ${qp(bot)})` };
        RS = st;
        // the waxed sled already made: straight to the flower
        const from = step === 'burthorpe' && bot.count('trollromance_toboggon_waxed') > 0 ? 'flower' : step;
        c.log(`resume: journal stage ${st} -> step '${from}'`);
        o = { ...o, from };
    }
    c.startEater();
    try {
        const from = STAGES.indexOf((o.from ?? 'ug1') as typeof STAGES[number]);
        if (from < 0) c.fail(`unknown stage ${o.from}`);
        for (const st of STAGES.slice(from)) {
            if (dead(bot)) c.fail('died');
            await STEP[st](c);
            c.mark(st);
            failHook(st);
            if (st === o.to) return { ok: false, ticks: c.t, msg: `stopped after ${st} (probe); marks ${JSON.stringify(c.marks)}` };
        }
        const done = () => qp(bot) >= qp0 + QUEST.qp || bot.count('uncut_diamond') > 0;
        if (!(await bot.until(done, 20))) c.fail(`no completion observable (qp ${qp0} -> ${qp(bot)})`);
        return { ok: true, ticks: c.t, msg: `qp ${qp0} -> ${qp(bot)}; marks ${JSON.stringify(c.marks)}` };
    } catch (e) {
        if (!(e instanceof QuestFail)) throw e;
        return { ok: false, ticks: c.t, msg: e.message };
    } finally { c.stopEater(); prayOff(bot); }
}

const STEP: Record<typeof STAGES[number], (c: Ctx) => Promise<void>> = {
    ug1: async c => {
        await goto(c, 'l1w');
        await latchTalk(c, UG, { x: 2828, z: 10066 }, [/^Awww, you poor troll/, /^Don't worry now, I'll see what I can do\.$/],
            [/You help Ug\?/, /I will go and talk to Aga/], () => false, 'ug-start');
    },
    aga: async c => {
        await goto(c, 'l1w');
        await latchTalk(c, AGA, { x: 2828, z: 10102 }, [/^So\.\.\. how's your\.\.\. um\.\.\. love life\?$/, /^Errr\.\.\. I've got to go\.$/],
            [/he will get Trollweiss/, /flower Trollweiss/], () => false, 'aga');
    },
    burthorpe: async c => {
        const bot = c.bot;
        await goto(c, 'south');
        pray(bot, 'protectfrommelee', true, 43);   // Death Plateau shelf: 14 melee trolls, 6 throwers (sim: -26..-35 hp to Tenzing's door)
        // Tenzing's hut: the door (death_sherpa_door 3745 @ 2822,3555) teleports you in (quest-troll.ts doBuyBoots)
        const inHut = () => { const t = bot.tile(); return bot.minusedlevel === 0 && t.x >= 2819 && t.x <= 2822 && t.z >= 3554 && t.z <= 3557; };
        // a resume (RS = the journal's %troll_love) skips the talks already done: Tenzing (15), the sled ask (20), the sled (22)
        if (RS < 15) {
        for (let k = 0; k < 4 && !inHut(); k++) await obstacle(c, { id: 3745, x: 2822, z: 3555 }, { x: 2823, z: 3555 }, inHut, 'Tenzing\'s door');
        await latchTalk(c, TENZING, null, [/^Do you know where I can find Trollweiss\?$/, /^What would I need to make such a sled\?$/],
            [/ask Dunstan/, /helped me with my spiked boots/], () => false, 'tenzing');
        for (let k = 0; k < 4 && inHut(); k++) await obstacle(c, { id: 3745, x: 2822, z: 3555 }, null, () => !inHut(), 'Tenzing\'s door (out)');
        }
        // Dunstan: "I need a sled!!" -> 20; again with the materials -> the toboggan (22)
        if (RS < 20) await latchTalk(c, DUNSTAN, { x: 2919, z: 3576 }, [/^I need a sled!!$/, /^Yes\.$/], [/yew or maple logs/, /bar of iron and some rope/], () => false, 'dunstan-sled');
        if (RS < 22 && bot.count('trollromance_toboggon') === 0) await latchTalk(c, DUNSTAN, { x: 2919, z: 3576 }, [/^See you!$/, /^Where can I get wax from\?$/], [], () => bot.count('trollromance_toboggon') > 0, 'dunstan-make');
        prayOff(bot);
        // wax: swamp tar on the bucket of wax (cake tin held) -> sled wax; wax on the toboggan -> waxed
        for (let k = 0; k < 3 && bot.count('trollromance_wax') === 0; k++) {
            bot.useItemOnItem(objId('swamp_tar'), bot.slot('swamp_tar'), objId('bucket_wax'), bot.slot('bucket_wax')); bot.queueFlush();
            await bot.until(() => bot.count('trollromance_wax') > 0, 3);
        }
        for (let k = 0; k < 3 && bot.count('trollromance_toboggon_waxed') === 0; k++) {
            bot.useItemOnItem(objId('trollromance_toboggon'), bot.slot('trollromance_toboggon'), objId('trollromance_wax'), bot.slot('trollromance_wax')); bot.queueFlush();
            await bot.until(() => bot.count('trollromance_toboggon_waxed') > 0, 3);
        }
        if (bot.count('trollromance_toboggon_waxed') === 0) c.fail('waxed sled');
    },
    flower: async c => {
        const bot = c.bot;
        await goto(c, 'surface');
        await go(c, { x: 2821, z: 3741 }, 'ice cave entrance', { near: 2, maxTicks: 400 });
        await obstacle(c, { id: 5007, x: 2820, z: 3743 }, { x: 2822, z: 3743 }, () => area(bot) === 'icecave', 'ice cave');
        await go(c, { x: 2773, z: 10233 }, 'crevasse', { near: 2, maxTicks: 300 });
        await obstacle(c, { id: 5025, x: 2772, z: 10233 }, null, () => area(bot) === 'trollweiss', 'crevasse');
        await go(c, { x: 2772, z: 3837 }, 'piste top', { near: 1, maxTicks: 200 });
        const SLED = objId('trollromance_toboggon_waxed');
        for (let k = 0; k < 3 && !bot.isWorn(SLED); k++) { bot.opHeld2(SLED, bot.slot(SLED)); bot.queueFlush(); await bot.until(() => bot.isWorn(SLED), 3); }
        if (!bot.isWorn(SLED)) c.fail('wield the sled (in the sled zone?)');
        await obstacle(c, { id: 5015, x: 2772, z: 3835 }, null, () => bot.tile().z <= 3800, 'sled ride');
        await bot.until(() => cheb(bot.tile(), { x: 2790, z: 3794 }) <= 2, 30);
        const FLOWER = 'trollromance_rare_flower';
        await obstacle(c, { id: 5006, x: 2779, z: 3784 }, null, () => bot.count(FLOWER) > 0, 'Trollweiss', 2);
    },
    ug2: async c => {
        const bot = c.bot;
        dismiss(bot);
        if (!(await tele(bot, 'trollheim_teleport')).ok) c.fail('trollheim teleport (Eadgar\'s Ruse, magic 61, 2 fire + 2 law)');
        c.mark('trollheim');
        await goto(c, 'l1w');
        await latchTalk(c, UG, { x: 2828, z: 10066 }, [], [/I suppose I am a bit of a legend/], () => bot.count('trollromance_rare_flower') === 0, 'ug-flower');
    },
    arrg: async c => {
        const bot = c.bot;
        await goto(c, 'l1w');
        // Arrg's room is behind troll_stronghold_interior_door 3776 (2828,10091, L1): talkTo's route does not open doors
        if (bot.tile().z <= 10091 && bot.tile().x <= 2836) {
            await walk(bot, { x: 2828, z: 10090 }, null, () => cheb(bot.tile(), { x: 2828, z: 10090 }) === 0 || bot.tile().z >= 10092, { near: 0, maxTicks: 200 });
            // a plain door (category door_closed): op1 opens it (the leaf moves, the player does not), then walk through
            for (let k = 0; k < 5 && bot.tile().z < 10092; k++) {
                await walk(bot, { x: 2828, z: 10093 }, null, () => bot.tile().z >= 10092, { near: 0, maxTicks: k ? 12 : 30 });
                if (bot.tile().z >= 10092) break;
                // closed (the door tracker / runtime locs know a chaos-closed leaf; else the static closed door)
                if (!openDoorNear(bot, 2)) { bot.opLoc(2828, 10091, 3776, 1); bot.queueFlush(); }
                await bot.tick(2);
            }
            if (bot.tile().z < 10092) c.fail('door to Arrg (3776 @ 2828,10091)');
        }
        await latchTalk(c, ARRG, { x: 2828, z: 10093 }, [/^I am here to kill you!$/], [], () => area(bot) === 'arena' || npcsOf(bot, [ARRG_FIGHT]).length > 0, 'arrg-talk');
        // the fight (arena, 2914,3611): melee with Protect from Melee (Arrg: melee max ~38, or a poisoned rock)
        let seen = false, lastAtk = -99;
        const end = bot.tickCount + 600;
        while (bot.tickCount < end) {
            if (dead(bot)) c.fail('died (Arrg)');
            if (inDialog(bot)) { bot.resumeDialogPage(); bot.queueFlush(); }
            eatIfLow(bot, 0.65);   // Arrg hits up to ~38 + poison: eat early (two sim deaths eating at 50%)
            if (bot.stat('prayer').cur < 10) {
                const pp = bot.inv().find(x => /^[1234]doseprayerrestore$/.test(objDebugName(x.obj)));
                if (pp) { bot.opHeld1(pp.obj, pp.slot); bot.queueFlush(); }
            }
            if (bot.stat('prayer').level >= 43 && bot.stat('prayer').cur > 0 && !bot.isPrayerActive('protectfrommelee')) { bot.activatePrayer('protectfrommelee'); bot.queueFlush(); }
            const a = npcsOf(bot, [ARRG_FIGHT])[0];
            if (a) { seen = true; if (bot.tickCount - lastAtk >= 4) { bot.opNpc(a.idx, 2); bot.queueFlush(); lastAtk = bot.tickCount; } }
            else if (seen) break;
            await bot.tick(1);
        }
        prayOff(bot);
        if (!seen || npcsOf(bot, [ARRG_FIGHT]).length > 0) c.fail('Arrg not killed');
    },
    ug3: async c => {
        const bot = c.bot;
        await goto(c, 'l1w');
        await latchTalk(c, UG, { x: 2828, z: 10066 }, [], [/pretty rocks/, /Ug go to Aga now/], () => bot.count('uncut_diamond') > 0, 'ug-done');
    },
};
export { objDebugName, locAt, opLocGo, opNpcGo, useOnLocGo, walk, converse, sawMsg, eatIfLow, packStr, wield };
