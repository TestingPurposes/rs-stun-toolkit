// q-witchs-potion.ts — Witch's Potion (1 QP), cheat-free. Lane f2p-b.
//
// Content (rev 289): areas/area_rimmington/scripts/hetty.rs2, quests/quest_hetty/scripts/quest_hetty.rs2, drop tables/scripts/rat.rs2
//   1. Hetty (npc 307, spawn 2968,3206): chatnpc | p_choice2 "I am in search of a quest." | chatplayer | chatnpc | chatnpc |
//      p_choice3 "Yes help me become one with my darker side." | chatplayer | chatnpc | chatnpc | chatplayer |
//      (%hetty = started, hetty.rs2:80) chatnpc | chatplayer.                                          (hetty.rs2:2-8, :40-83)
//   2. A rat's tail drops from ANY rat (npc 47, 2 hp) only while %hetty is started/objects_given and none is held or banked
//      (rat.rs2:9-12). Rats spawn just west of her house (2953-2960, 3202-3205; m46_50).
//   3. Hetty with onion + rat's tail + burnt meat + eye of newt: chatnpc | chatplayer | chatnpc | mesbox | chatplayer |
//      (items deleted, %hetty = objects_given) chatnpc                                                     (hetty.rs2:13-26)
//   4. Drink from the cauldron (loc 2024 hettycauldron, 2967,3205) op1: mesbox, then queue(hetty_quest_complete) runs once
//      the mesbox is continued: magic +3250 (x25 demo), quest scroll                                  (quest_hetty.rs2:1-13)
import { SpeedBot, objId } from '../../../core.js';
import { M2, M3, R, locAt, opLocGo, inDialog, nav, talk } from '../../q-lib.js';
import { converse, openNpc, killFor, go, guard, fail, mkLog, completeCheck, type Item } from './fb-lib.js';
import { isResuming, journalStage, failHook } from '../journal.js';
/** session 10 resume: the quest JOURNAL (quest_hetty/scripts/hetty_journal.rs2) -> %hetty, first match wins (latest first) */
const WP_STAGES: Array<[RegExp, number]> = [[/QUEST COMPLETE/i, 3], [/drink from the\s+cauldron/i, 2], [/Hetty needs me to bring her/i, 1]];

export const QUEST = { name: "Witch's Potion", dir: 'quest_hetty', qp: 1 };
export const REQUIREMENTS = {
    quests: [] as string[], qp: 0,
    skills: {} as Record<string, [number, string]>,   // a rat has 2 hp: proven at attack/strength 1 (fresh account)
    start: { x: 2964, z: 3212, level: 0 },              // Rimmington, outside Hetty's house
    end: { x: 2966, z: 3206, level: 0 },                // by the cauldron
};
export const SUPPLY: Item[] = [{ name: 'eye_of_newt', n: 1 }, { name: 'onion', n: 1 }, { name: 'burnt_meat', n: 1 }];

const HETTY = 307, RAT = 47;
const HETTY_AT = { x: 2968, z: 3206 }, HETTY_STAND = { x: 2966, z: 3206 } /* inside, east of door 1530 (2965,3206) */, RATS_AT = { x: 2957, z: 3204 };
const TAIL = 'rats_tail';

export async function run(bot: SpeedBot, o: { log?: boolean } = {}): Promise<{ ok: boolean; ticks: number; msg: string }> {
    await nav();
    bot.holdDialogs = true;
    const log0 = mkLog(bot, 'witch', o.log !== false);
    const log = { ...log0, split: (k: string) => { log0.split(k); failHook(`witchpot:${k}`); } } as typeof log0;
    const qp0 = bot.getVarp(101), done = completeCheck(bot, qp0, QUEST.qp);
    const g = guard(bot);
    try {
        // session 10: on a retry, the journal stage (a refilled pack after the hand-in made the old item test restart the
        // quest at Hetty). WP_RESUME=0 = the item checks only, as before
        let ws = 0;
        if (isResuming(bot) && process.env.WP_RESUME !== '0') {
            if (inDialog(bot)) { bot.closeModal(); bot.queueFlush(); await bot.tick(1); }
            ws = await journalStage(bot, 'hetty', WP_STAGES, 0, s => console.log(`[witch] ${s}`));
            console.log(`[witch] resume at stage ${ws} @${JSON.stringify(bot.pos())}`);
            if (ws >= 3) return { ok: true, ticks: bot.tickCount - log.t0, msg: 'journal: quest complete' };
        }
        if (ws <= 1) for (const s of SUPPLY) if (bot.count(s.name) < s.n) fail(bot, `missing ${s.name}`);
        const tail = () => bot.count(TAIL) > 0;
        const handed = () => ws >= 2 || (bot.count('eye_of_newt') === 0 && bot.count('burnt_meat') === 0);
        // 1. start (skipped when the tail is already held: then the quest has started)
        if (ws <= 0 && !tail() && !handed()) {
            await openNpc(bot, HETTY, HETTY_AT, 'hetty1', { stand: HETTY_STAND });
            // whole conversation in one burst (5 pages/tick); default done = the chat closed after the plan
            const r = await talk(bot, HETTY, [R, M2[0]!, R, R, R, M3[0]!, R, R, R, R, R, R],
                { noOp: true, answers: [/^I am in search of a quest\.$/, /^Yes help me become one with my darker side\.$/], maxTicks: 30, label: 'hetty1' });
            if (!r.ok) fail(bot, 'hetty1: conversation did not close');
            log.split('started');
        }
        // 2. rat's tail
        if (!handed()) {
            await killFor(bot, 'rat', [RAT], RATS_AT, [objId(TAIL)], tail, { maxTicks: 300 });
            log.split('tail');
        }
        // 3. hand in
        if (!handed()) {
            await converse(bot, HETTY, HETTY_AT, [R, R, R, R, R, R], () => handed() && !inDialog(bot), [], 'hetty2', { maxTicks: 30, stand: HETTY_STAND });
            log.split('handed');
        }
        // 4. drink
        const cauldron = locAt(2024, 2967, 3205, 0);
        const t4 = bot.tickCount;
        while (!done()) {
            if (bot.tickCount - t4 > 60) fail(bot, 'cauldron: no completion');
            if (bot.chatModalId !== -1) { bot.resumeDialogPage(); bot.queueFlush(); }
            else if ((bot.tickCount - t4) % 6 === 0) opLocGo(bot, cauldron, 1);
            await bot.tick(1);
        }
        log.split('complete');
        if (g.dead) fail(bot, 'died');
        return { ok: true, ticks: bot.tickCount - log.t0, msg: JSON.stringify(log.splits) };
    } catch (e) {
        return { ok: false, ticks: bot.tickCount - log.t0, msg: (e as Error).message };
    } finally { g.stop = true; bot.holdDialogs = false; }
}
export { go };
