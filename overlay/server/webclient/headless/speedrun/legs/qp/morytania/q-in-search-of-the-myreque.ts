// q-in-search-of-the-myreque.ts — In Search of the Myreque (rev 289), cheat-free quest code. Content:
// quests/quest_routequest/scripts/{quest_routequest,routequest_vanstorm,routequest_morton,routequest_hollow,
// routequest_myreque,route_cutscene}.rs2.
//
// Stages (quest_routequest.constant) and what sets each:
//   5   Vanstrom Klause (Canifis tavern, 3503,3477): "Why do they need help?" / "Perhaps I could help you out here." /
//       "Yes, I'll do it!" (routequest_vanstorm.rs2:42-120). The gate is %druidspirit >= 4 (:46): Nature Spirit STARTED
//       (5) is enough, a content bug: the druid pouch (Cyreg) is what really needs Nature Spirit >= 75.
//   10/15/20 Cyreg Paddlehorn (Mort'ton dock, 3522,3284) with the 6 steel weapons, then the persuasion chain
//       "...die without weapons" / "Resourceful enough..." / "...deaths are on your head!" / "What kind of a man...", a druid
//       pouch with >= 5 charges and 3 planks (given) (routequest_morton.rs2:57-221)
//   25  his rowboat (5051, 3523,3284) to the hollows (3498,3380) (routequest_morton.rs2:1-55; the 10 gp is checked, not taken)
//   -   the rotten bridge (3502,3428..3430): 3 rungs, each a plank + 10 steel nails + hammer, op5 "Repair" from the rung
//       before (routequest_hollow.rs2:126-184); never op1 a broken rung (it collapses for 200 t, :102-107)
//   55  Curpile Fyod (3508,3440): "I've come to help...", three random questions (routequest_hollow.rs2:236-396)
//   60  the wooden doors (3509/3510,3447) -> underground (3500,9811) (routequest_hollow.rs2:1-29)
//   -   the stalagmite (3492,9824) op2 "Squeeze-past", agility 25 stat() -> the hideout, level 3 (routequest_myreque.rs2:118-135)
//   65  Veliaf (routequest_myreque.rs2:409-416); the 5 others: talking sets their bit at once (:160-410)
//   70/80 Veliaf takes the weapons -> cutscene -> the Skeleton Hellhound attacks (route_cutscene.rs2:1-189)
//   85  the hellhound dies (routequest_myreque.rs2:598-615)
//   90  Veliaf: "How do I get out of here?" (routequest_myreque.rs2:467-517)
//   95/97 the false wall (3480,9837) and the basement ladder (3477,9846) -> Canifis (routequest_myreque.rs2:43-112)
//   100 the stranger (ex-Vanstrom) -> queue complete (routequest_vanstorm.rs2:8-38, quest_routequest.rs2:24-32)
import { SpeedBot, objId, cheb } from '../../../core.js';
import { nav, talk, npcsOf, inDialog, levelUpOpen, walkOp, locAt, opLocGo, dismiss, waitText, msgsSince, R, M2, M4, M5, qp, type FTok } from '../../q-lib.js';
import { talkAt, harvestPears, opLocReach, leaveFillimanCamp, fail, has, stamp, withSafety, opUntil, kill, useOnNpcUntil, type Item, type QuestMeta, type Reqs, type RunResult } from './mo-lib.js';
import { isResuming, journalStage, failHook } from '../journal.js';

export const QUEST: QuestMeta = { name: 'In Search of the Myreque', dir: 'quest_routequest', qp: 2 };
export const REQUIREMENTS: Reqs = {
    quests: ['Nature Spirit (a druid pouch with >= 5 charges; the Nature Spirit script leaves 5-6)', 'Priest in Peril (Morytania access)'], qp: 0,
    skills: {
        prayer: [10, 'the blessed sickle drains 1-7 prayer per bloom when the pouch needs a top-up (3 casts)'],
        agility: [25, 'the stalagmite squeeze into the hideout, stat(agility) >= 25 (routequest_myreque.rs2:125)'],
        attack: [70, 'the Skeleton Hellhound (att 70, def 100, str 110, 55 hp, size 2); sim-proven level'],
        defence: [70, 'the Skeleton Hellhound hits hard (str 110): sim-proven level, with sharks'],
    },
    start: { x: 3503, z: 3475, level: 0 },   // Canifis, next to Vanstrom Klause (Hair of the Dog tavern)
    end: { x: 3494, z: 3466, level: 0 },     // Canifis, south of the tavern (the basement ladder), stage 100 -> complete
};
export const WEAPONS: Item[] = [{ name: 'steel_longsword', n: 1 }, { name: 'steel_sword', n: 2 }, { name: 'steel_dagger', n: 1 }, { name: 'steel_mace', n: 1 }, { name: 'steel_warhammer', n: 1 }];
export const SUPPLY: Item[] = [...WEAPONS, { name: 'woodplank', n: 6 }, { name: 'nails', n: 30 }, { name: 'hammer', n: 1 }, { name: 'coins', n: 10 }, { name: 'shark', n: 6 }];
/** untradeable, carried over from Nature Spirit */
export const KEEP: Item[] = [{ name: 'druid_pouch', n: 5 }, { name: 'silver_sickle_blessed', n: 1 }];
export const WEAR = ['rune_scimitar'];

const VANSTROM = 1577, STRANGER = 1576, CYREG = 1567, CURPILE = 1568, VELIAF = 1569, HOUND = 1575;
const MEMBERS = [1570, 1571, 1572, 1573, 1574];   // Sani, Harold, Radigad, Polmafi, Ivan
const VANSTROM_AT = { x: 3503, z: 3476 }, CYREG_AT = { x: 3521, z: 3285 }, CURPILE_AT = { x: 3508, z: 3441 };
const ANSWERS: Array<[RegExp, RegExp]> = [
    [/youngest/i, /^Ivan Strom$/], [/only female/i, /^Sani Piliu$/], [/leader/i, /^Veliaf Hurtz$/],
    [/scholar/i, /^Polmafi Ferdygris$/], [/boatman/i, /^Cyreg Paddlehorn$/], [/family/i, /^Drakan$/],
];
const seenText = (bot: SpeedBot, re: RegExp) => { const v = [...bot.ifText.values()]; return v.some(x => re.test(x)) || re.test(v.join(' ')); };
/** the hideout: level 3 before the ambush (the squeeze lands on 3_54_153_49_40), level 0 after the cutscene */
const hideout = (b: SpeedBot) => { const t = b.tile(); return t.x >= 3498 && t.x <= 3520 && t.z >= 9828 && t.z <= 9848; };
const basement = (b: SpeedBot) => { const t = b.tile(); return b.minusedlevel === 0 && t.x >= 3470 && t.x <= 3488 && t.z >= 9837 && t.z <= 9848; };
const under = (b: SpeedBot) => b.tile().z > 9700;

export interface MyrOpts { log?: boolean; sim?: boolean; from?: string; resumed?: boolean }

/** routequest_journal.rs2 texts -> the phase to resume at, latest stage first (session 10) */
const MYR_STAGES: Array<[RegExp, string]> = [
    [/QUEST COMPLETE/i, 'done'], [/climbed out of the basement/i, 'stranger'], [/find a way up to the surface/i, 'ladder'],
    [/secret wall/i, 'wall'], [/killed the hell hound/i, 'exit'], [/kill the hell hound/i, 'hound'], [/less\s+busy/i, 'cutscene'],
    [/introduced myself to all the members now/i, 'cutscene'], [/introduce myself to the\s+other/i, 'members'],
    [/look for the members/i, 'intros'], [/unlock the door for me now/i, 'enter'], [/Curpile/i, 'curpile'],
    [/travelled to the 'Hollows'/i, 'bridge'], [/I can use his\s+boat/i, 'boat'], [/asked me to take some weapons/i, 'cyreg'], [/I can start this quest/i, 'vanstrom'],
];

/** Stage 5 only (Vanstrom in Canifis). Exported so a route can start the quest early (any Nature Spirit stage >= 5). */
export async function startAtVanstrom(bot: SpeedBot): Promise<void> {
    await talkAt(bot, VANSTROM, VANSTROM_AT, [R, R, R, M4[1]!, R, R, R, R, R, R, R, M5[3]!, R, R, M5[3]!, R, R], {
        done: () => seenText(bot, /additional hero/) && !inDialog(bot),
        answers: [/^Why do they need help/, /^Perhaps I could help you out here/, /^Yes, I'll do it/], maxTicks: 40, label: 'vanstrom',
    });
    if (!seenText(bot, /additional hero/)) fail(bot, 'Vanstrom: quest not started (Nature Spirit started? %druidspirit >= 4)');
    dismiss(bot);
}

export async function run(bot: SpeedBot, o: MyrOpts = {}): Promise<RunResult> {
    await nav();
    bot.holdDialogs = true;
    const t0 = bot.tickCount, qp0 = qp(bot), v = o.log !== false;
    const at = (k: string) => { stamp(bot, t0, k, v); failHook(k); };
    let done = false;
    // session 10: on a retry / resume, the phase from the quest JOURNAL over the persisted phase mark. MYR_RESUME=0 reverts.
    if (isResuming(bot) && process.env.MYR_RESUME !== '0') {
        if (bot.chatModalId !== -1 || bot.mainModalId !== -1) { bot.closeModal(); bot.queueFlush(); await bot.tick(1); }
        let jf = await journalStage<string | undefined>(bot, 'routequest', MYR_STAGES, o.from, s => console.log(`[myreque] ${s}`));
        if (jf === 'done') return { ok: true, ticks: bot.tickCount - t0, msg: `journal: quest complete (qp ${qp0} -> ${qp(bot)})` };
        if (jf === 'ladder' && !basement(bot)) jf = 'wall';
        if (jf !== o.from) console.log(`[myreque] resume from phase '${jf ?? 'vanstrom'}' (phase mark '${o.from ?? '-'}')`);
        o = { ...o, from: jf, resumed: true };
    }
    try { await withSafety(bot, 'myreque', async () => { done = await body(bot, o, at); }); }
    catch (e) { return { ok: false, ticks: bot.tickCount - t0, msg: (e as Error).message }; }
    return { ok: done, ticks: bot.tickCount - t0, msg: `qp ${qp0} -> ${qp(bot)}${done ? ', quest complete scroll seen' : ''}` };
}

async function body(bot: SpeedBot, o: MyrOpts, at: (k: string) => void): Promise<boolean> {
    let skipping = !!o.from;
    const P = (name: string) => { if (skipping && name === o.from) skipping = false; return !skipping; };
    const gate = locAt(3507, 3443, 3458, 0), boat = locAt(5051, 3523, 3284, 0), doorL = locAt(5060, 3510, 3447, 0), stalagmite = locAt(5050, 3492, 9824, 0);
    const wall = locAt(5052, 3480, 9837, 0), ladder = locAt(5054, 3477, 9846, 0);
    const rungs = [locAt(5002, 3502, 3427, 0), locAt(5002, 3502, 3428, 0), locAt(5002, 3502, 3429, 0), locAt(5002, 3502, 3430, 0)];

    if (P('vanstrom')) {
        await startAtVanstrom(bot);
        at('stage5');
    }
    if (P('cyreg')) {
        for (const w of WEAPONS) if (bot.count(w.name) < w.n) fail(bot, `need ${w.n} ${w.name} in the pack (Cyreg, Curpile and Veliaf check the inventory)`);
        if (bot.count('druid_pouch') < 5 && !has(bot, 'silver_sickle_blessed')) fail(bot, `druid pouch ${bot.count('druid_pouch')}/5 charges and no blessed sickle to refill it (Cyreg refuses, routequest_morton.rs2:197)`);
        // Canifis -> Mort'ton is through Mort Myre (the only walkable way, ~440 tiles): the scripted gate is not a door the
        // walker opens. Invisible ghasts use up a pouch charge whenever they attack (ghast.rs2:24-26): top the pouch up with
        // the blessed sickle at the pear tile on the way (3 pears = +9) so Cyreg still sees >= 5.
        const inSwamp = () => { const t = bot.tile(); return t.x >= 3392 && t.x <= 3519 && t.z >= 3328 && t.z <= 3457; };
        await leaveFillimanCamp(bot);   // when the route comes straight from Nature Spirit's grotto (quest started earlier)
        if (bot.tile().z > 3457 && !(await opUntil(bot, gate, 1, { x: 3443, z: 3458 }, () => inSwamp(), { maxTicks: 300 }))) fail(bot, 'Mort Myre gate');
        at('swamp');
        if (bot.count('druid_pouch') < 10 && has(bot, 'silver_sickle_blessed')) {
            await harvestPears(bot);
            const n0 = bot.count('druid_pouch');
            const pouch = has(bot, 'druid_pouch') ? 'druid_pouch' : 'druid_pouch_empty';
            bot.opHeld1(objId(pouch), bot.slot(pouch)); bot.queueFlush();
            await bot.until(() => bot.count('druid_pouch') > n0, 6);
            at(`pouch ${bot.count('druid_pouch')}`);
        }
        if (bot.count('druid_pouch') < 5) fail(bot, `druid pouch ${bot.count('druid_pouch')}/5 charges after the swamp`);
        await talkAt(bot, CYREG, CYREG_AT, [R, R, R, R, R, R, R, M5[1]!, R, R, R, R, M5[1]!, R, R, M5[2]!, R, R, M5[2]!, R, R, R, R, R, R, R, R, R, M2[0]!, R, R], {
            done: () => seenText(bot, /unusual tree/), walkTicks: 600, maxTicks: 60, label: 'cyreg',
            answers: [/die without weapons/, /^Resourceful enough/, /deaths are on your head/, /^What kind of a man are you/, /^Give wooden planks/],
        });
        if (!seenText(bot, /unusual tree/)) fail(bot, 'Cyreg: stage 20 not reached');
        at('stage20');
        dismiss(bot);
    }
    if (P('boat')) {
        // the boat: 1 page, "Yes, I'll pay ten gold.", 1 page, then a 13-tick journey (routequest_morton.rs2:9-55)
        const inHollows = () => cheb(bot.tile(), { x: 3498, z: 3380 }) <= 6;
        for (let k = 0; k < 3 && !inHollows(); k++) {
            // the 3x3 boat: route to an interaction-valid side (rsmod findPathToLoc) + OPLOC in one tick (q-lib opLocGo)
            dismiss(bot); opLocGo(bot, boat, 1);
            if (!(await bot.until(() => inDialog(bot) || inHollows(), 30))) continue;
            await talk(bot, [], [R, M2[0]!, R], { noOp: true, done: () => inHollows(), answers: [/^Yes, I'll pay ten gold/], maxTicks: 30, label: 'boat' });
        }
        if (!inHollows()) fail(bot, 'boat to the hollows');
        dismiss(bot);
        at('stage25');
    }
    if (P('bridge')) {
        // climb the south tree (3502,3426, op1 -> 3502,3427 on the bridge), op5 "Repair" the 3 broken rungs ahead (each moves
        // us onto it), climb down the north tree (3502,3431, op2 -> 3503,3432) (routequest_hollow.rs2:48-97,126-184)
        const treeS = locAt(5005, 3502, 3426, 0), treeN = locAt(5005, 3502, 3431, 0);
        const onBridge = () => bot.tile().x === 3502 && bot.tile().z >= 3427 && bot.tile().z <= 3430;
        if (bot.tile().z < 3427 && !(await opUntil(bot, treeS, 1, { x: 3501, z: 3426 }, onBridge, { maxTicks: 80 }))) fail(bot, 'bridge: south tree');
        for (let i = 1; i <= 3; i++) {
            const r = rungs[i]!;
            for (let k = 0; k < 4 && bot.tile().z < r.z; k++) {
                dismiss(bot);
                bot.opLoc(r.x, r.z, r.id, 5); bot.queueFlush();
                await bot.until(() => bot.tile().z >= r.z, 6);
            }
            if (bot.tile().z < r.z) fail(bot, `bridge rung ${i + 1} (planks ${bot.count('woodplank')}, nails ${bot.count('nails')})`);
        }
        for (let k = 0; k < 4 && onBridge(); k++) { dismiss(bot); bot.opLoc(treeN.x, treeN.z, treeN.id, 2); bot.queueFlush(); await bot.until(() => !onBridge(), 6); }
        if (onBridge()) fail(bot, 'bridge: north tree');
        at('bridge');
    }
    if (P('curpile')) {
        // session 11 fix 406b (qx500m 'Curpile: stage 55 not reached' x2, 408 t + 87 t -> route STOPPED at qp 138): a Hollows
        // ghast attacked (ghast.rs2:1-37: if_close; the druid pouch makes it visible: pouch 10 -> 8, ghast_vis 1053 aggressive
        // for 500 t) and every npc melee hit closes the chat (npc_combat_melee.rs2:36): Curpile's dialog (eng-qx500 t69607,
        // retry t69679) was cut, nothing re-opened it, the loop idled 60 t; hp 99->95->91, the logout after the STOP was refused
        // 30+ times (combat_preventlogout). Kill a visible ghast near us first, and re-open Curpile when the dialog is gone (his
        // questions start over, routequest_hollow.rs2:356). MYR_CURPILE_GHAST=0 reverts.
        // TEST (sim): MYR_TEST406=1 uses the pouch on an invisible ghast in view before the first talk (makes it visible + hostile).
        const f406 = process.env.MYR_CURPILE_GHAST !== '0', GHAST_VIS = 1053, GHAST_INVIS = 1052;
        if (process.env.MYR_TEST406 === '1') { const v = await useOnNpcUntil(bot, 'druid_pouch', GHAST_INVIS, () => npcsOf(bot, GHAST_VIS).length > 0, 40); console.log(`[myreque] 406 TEST: pouch on a ghast -> visible ${v}`); }
        for (let a = 0; a < (f406 ? 4 : 1) && !seenText(bot, /unlock it for you/); a++) {
            if (f406 && npcsOf(bot, GHAST_VIS).some(n => cheb(n, bot.tile()) <= 10)) {
                dismiss(bot);
                const k = await kill(bot, GHAST_VIS, { maxTicks: 80, label: 'curpile ghast', pick: n => cheb(n, bot.tile()) <= 10 });
                console.log(`[myreque] 406b: visible ghast at Curpile, killed ${k} (try ${a + 1})`);
            }
            // the opening (2 pages + choice + 7 pages), then three random questions answered by their header text
            await talkAt(bot, CURPILE, CURPILE_AT, [R, M5[0]!, R, R, R, R, R, R, R, R], { done: () => bot.dialogOptions().length > 0 && !!questionText(bot), answers: [/^I've come to help the Myreque/], maxTicks: 20, label: 'curpile' });
            const t1 = bot.tickCount; let lastSig = '', gone = 0;
            while (!seenText(bot, /unlock it for you/) && bot.tickCount - t1 < 60) {
                if (msgsSince(bot, t1).some(m => /got them all wrong|only got/.test(m))) fail(bot, 'Curpile: a question was answered wrong (knocked out)');
                const opts = bot.dialogOptions();
                if (opts.length) {
                    const q = questionText(bot) ?? '';
                    const sig = q + '|' + opts.map(x => x.text).join('|');
                    const ans = ANSWERS.find(([qre]) => qre.test(q));
                    if (ans && sig !== lastSig) { if (bot.clickDialogByText(ans[1]) > 0) lastSig = sig; }
                    else if (!ans && sig !== lastSig) console.log(`[myreque] unknown question header '${q}'`);
                } else if (inDialog(bot)) bot.resumeDialogPage();
                // 406b: the chat is gone (cut by a hit) for 3 t: kill the ghast and re-open
                if (f406 && !opts.length && !inDialog(bot)) { if (++gone >= 3) { console.log(`[myreque] 406b: Curpile chat cut at +${bot.tickCount - t1} t, re-opening`); break; } } else gone = 0;
                bot.queueFlush();
                await bot.tick(1);
            }
        }
        if (!seenText(bot, /unlock it for you/)) fail(bot, 'Curpile: stage 55 not reached');
        at('stage55');
        dismiss(bot);
    }
    if (P('enter')) {
        if (!under(bot) && !(await opLocReach(bot, doorL, 1, () => under(bot), { maxTicks: 60 }))) fail(bot, 'the wooden doors');
        at('stage60');
        if (bot.stat('agility').cur < 25) fail(bot, `agility ${bot.stat('agility').cur}/25 for the stalagmite`);
        if (!hideout(bot) && !(await opLocReach(bot, stalagmite, 2, () => hideout(bot) && bot.minusedlevel === 3, { maxTicks: 80 }))) fail(bot, 'stalagmite squeeze');
        at('hideout');
    }
    if (P('intros')) {
        await talkAt(bot, VELIAF, { x: 3506, z: 9837 }, [R, R, R, R, M5[4]!, R], { done: () => !inDialog(bot) && seenText(bot, /introduce yourself to the others/), answers: [/^Ok, thanks/], maxTicks: 20, label: 'veliaf65', level: 3 });
        dismiss(bot);
        at('stage65');
    }
    if (P('members')) {
        // each member sets its bit before its first page (routequest_myreque.rs2:164-165...): op, wait for the page, close
        for (const m of MEMBERS) {
            for (let k = 0; k < 3; k++) {
                const n = npcsOf(bot, m)[0]; if (!n) fail(bot, `member ${m} not in view`);
                const go = () => { const q = npcsOf(bot, m)[0]; if (!q) return false; (bot as any).opNpc(q.idx, 1); bot.queueFlush(); return true; };
                if (await walkOp(bot, { x: n.x, z: n.z }, go, () => inDialog(bot), { near: 1, maxTicks: 30, level: 3 })) break;
            }
            dismiss(bot); await bot.tick(1);
        }
        at('intros');
    }
    if (P('cutscene') && o.resumed && !has(bot, 'steel_warhammer')) {
        // resume at stage 70 (weapons handed in, the cutscene cut off): Veliaf runs the cutscene again (routequest_myreque.rs2:463)
        const go = () => { const q = npcsOf(bot, VELIAF)[0]; if (!q) return false; (bot as any).opNpc(q.idx, 1); bot.queueFlush(); return true; };
        await walkOp(bot, { x: 3506, z: 9837 }, go, () => npcsOf(bot, HOUND).length > 0, { near: 1, maxTicks: 60, level: bot.minusedlevel });
        if (!(await bot.until(() => npcsOf(bot, HOUND).length > 0, 150))) fail(bot, 'no hellhound after the cutscene (resume)');
        at('stage80');
    } else if (P('cutscene')) {
        // Veliaf takes the weapons (70) -> cutscene (~50 t of p_delays) -> the Skeleton Hellhound attacks (80)
        await talkAt(bot, VELIAF, { x: 3506, z: 9837 }, [R, R], { done: () => !has(bot, 'steel_warhammer'), maxTicks: 20, label: 'veliaf70', level: 3 });
        if (has(bot, 'steel_warhammer')) fail(bot, 'Veliaf did not take the weapons (introduced to all 5?)');
        at('stage70');
        if (!(await bot.until(() => npcsOf(bot, HOUND).length > 0, 150))) fail(bot, 'no hellhound after the cutscene');
        at('stage80');
    }
    if (P('hound')) {
        const since = bot.tickCount; let lastAtk = -99, target = -1;
        // death proof: it drops 4 big bones + 2 uncut rubies on its tiles (routequest_myreque.rs2:598-610); "gone from the
        // npc list" alone is not (seen: declared dead while it was alive, then 200 t and 40 hp lost at Veliaf)
        const bones = objId('big_bones');
        const dead = () => !npcsOf(bot, HOUND).length && !!bot.findGroundItem(bones, 12);
        // resume at stage 80 with no hound in view (it despawned over the drop): the squeeze past the stalagmite summons it
        // again while %routequest = 80 (routequest_myreque.rs2:137-157): out through the hideout tunnel, squeeze back in
        if (o.resumed && !(await bot.until(() => npcsOf(bot, HOUND).length > 0 || dead(), 8)) && !dead()) {
            console.log(`[myreque] no hellhound in view at ${JSON.stringify(bot.pos())}: out and back past the stalagmite`);
            if (hideout(bot)) { const tun = locAt(5046, 3505, 9831, bot.minusedlevel); await opLocReach(bot, tun, 1, () => !hideout(bot), { maxTicks: 40 }); }
            if (!(await opLocReach(bot, stalagmite, 2, () => hideout(bot) || npcsOf(bot, HOUND).length > 0, { maxTicks: 80 }))) fail(bot, 'stalagmite squeeze (hound respawn)');
            await bot.until(() => npcsOf(bot, HOUND).length > 0, 10);
        }
        while (!dead()) {
            if (bot.tickCount - since > 400) fail(bot, 'hellhound not dead after 400 t');
            const lvl = levelUpOpen(bot);
            if (bot.chatModalId !== -1 && !lvl) dismiss(bot);
            const h = npcsOf(bot, HOUND)[0];
            // size 2: a bare OPNPC (the engine walks to a valid side); re-attack after a level-up page
            if (h && (lvl || h.idx !== target || bot.tickCount - lastAtk >= 16)) { if (lvl) bot.resumeDialogPage(); bot.opNpc(h.idx, 2); bot.queueFlush(); target = h.idx; lastAtk = bot.tickCount; }
            await bot.tick(1);
        }
        at('stage85');
        await bot.tick(2);
    }
    if (P('exit')) {
        // Veliaf: 4 pages, "How do I get out of here?" (3 pages -> 90), "Ok, thanks."
        await talkAt(bot, VELIAF, { x: 3506, z: 9837 }, [R, R, R, R, M5[2]!, R, R, R, M5[4]!, R], {
            done: () => seenText(bot, /Hair of the Dog/) && !inDialog(bot), answers: [/^How do I get out of here/, /^Ok, thanks/], maxTicks: 30, label: 'veliaf90', level: 3,
        });
        if (!seenText(bot, /Hair of the Dog/)) fail(bot, 'Veliaf: stage 90 not reached');
        dismiss(bot);
        at('stage90');
    }
    if (P('wall')) {
        if (hideout(bot)) {
            const tun = locAt(5046, 3505, 9831, bot.minusedlevel);
            if (!(await opLocReach(bot, tun, 1, () => !hideout(bot), { maxTicks: 40 }))) fail(bot, 'hideout tunnel');
        }
        if (!basement(bot) && !(await opUntil(bot, wall, 1, { x: 3480, z: 9836 }, () => basement(bot), { maxTicks: 80 }))) fail(bot, 'false wall');
        at('stage95');
    }
    if (P('ladder')) {
        if (!(await opLocReach(bot, ladder, 1, () => !under(bot), { maxTicks: 60 }))) fail(bot, 'basement ladder');
        at('stage97');
    }
    // the stranger (the sitting Vanstrom turns into him at >= 80): 4 pages -> 100 -> 2 pages -> complete
    for (let k = 0; k < 3 && !seenText(bot, /Search of the Myreque' completed/); k++) {
        const t = npcsOf(bot, [STRANGER, VANSTROM])[0]?.type ?? VANSTROM;
        await talkAt(bot, t, VANSTROM_AT, [R, R, R, R, R, R], { done: () => seenText(bot, /Search of the Myreque' completed/), maxTicks: 30, label: 'stranger' });
        await waitText(bot, /Search of the Myreque' completed/, 10);
        dismiss(bot);
    }
    at('complete');
    return seenText(bot, /Search of the Myreque' completed/);
}

/** The header of a choice5_header page (multi5:com_0): Curpile's question. */
function questionText(bot: SpeedBot): string | null {
    const t = bot.ifText.get(2493);
    return t && !/^Select an Option$/.test(t) ? t : null;
}
