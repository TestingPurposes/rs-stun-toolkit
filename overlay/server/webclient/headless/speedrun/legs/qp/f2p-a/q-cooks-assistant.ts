// q-cooks-assistant.ts — Cook's Assistant (quest_cook), cheat-free. Content: quests/quest_cook/scripts/quest_cook.rs2,
// areas/area_lumbridge/scripts/cook.rs2.
//
// Flow (all in the Lumbridge castle kitchen, cook npc 278):
//   talk 1 (%cookquest 0, cook.rs2:7-9): chatnpc "What am I to do?" | p_choice4 "What's wrong?" (quest_cook.rs2:2) |
//     chatplayer | chatnpc | chatnpc | p_choice2 "Yes, I'll help you." (:29) -> %cookquest = 1 (:32) | chatplayer | chatnpc
//   talk 2 (%cookquest 1, cook.rs2:10-11): chatnpc (:43) -> all three held (:45) -> chatplayer | chatplayer | chatnpc |
//     mesbox (:81) -> inv_del egg, bucket_milk, pot_flour (:82-84) -> queue(cooks_quest_complete) (:85): +1 qp, cooking
//     3000 tenths base xp (:89) = 7,500 at x25.
// The two talks are one burst: talk 1's plan ends with a re-OPNPC (the `after` token), so talk 2's first page opens
// without a separate op round trip.
// Completion observable: qp +1 (update_questpoints in send_quest_complete, general/scripts/quests.rs2:25).
import type { SpeedBot } from '../../../core.js';
import { R, M2, M4, npc, type FTok } from '../../q-lib.js';
import { converse, mkLog, qp, type Item, type QuestDef, type Requirements, type RunResult } from './fa-lib.js';

export const QUEST: QuestDef = { name: "Cook's Assistant", dir: 'quest_cook', qp: 1 };
export const REQUIREMENTS: Requirements = {
    quests: [], qp: 0, skills: {},
    start: { x: 3210, z: 3214, level: 0 },   // Lumbridge castle kitchen, next to the cook
    end: { x: 3210, z: 3214, level: 0 },
};
/** quest_cook.rs2:45 checks inv_total > 0 of each, :82-84 deletes one of each */
export const SUPPLY: Item[] = [{ name: 'egg', n: 1 }, { name: 'bucket_milk', n: 1 }, { name: 'pot_flour', n: 1 }];
const COOK = 278;
const KITCHEN = { x: 3209, z: 3214 };

export async function run(bot: SpeedBot, o: { log?: boolean } = {}): Promise<RunResult> {
    const t0 = bot.tickCount, qp0 = qp(bot), L = mkLog(bot, 'cook', !!o.log);
    for (const it of SUPPLY) if (bot.count(it.name) < 1) return { ok: false, ticks: 0, msg: `missing ${it.name}` };
    const done = () => qp(bot) > qp0;
    // talk 1 plan: R | "What's wrong?" | R R R (+pad) | "Yes, I'll help you." | R R (+pad) ; then re-op -> talk 2
    // pages are adaptive: extra R's on a choice page are dropped by the engine
    const reop: FTok = { fn: () => { const n = npc(bot, COOK); if (n) bot.opNpc(n.idx, 1); }, cost: 1 };
    const plan: FTok[] = [R, M4[0]!, R, R, R, R, M2[0]!, R, R, R];
    const ok = await converse(bot, COOK, {
        plan, after: [reop], stand: KITCHEN, near: 10, label: 'cook', log: L, maxTicks: 120, tries: 4,
        answers: [/^What's wrong\?$/, /^Yes, I'll help you\.$/],
        done,
    });
    L(`done ok=${ok} qp ${qp0} -> ${qp(bot)}`);
    return ok ? { ok, ticks: bot.tickCount - t0, msg: `qp ${qp0} -> ${qp(bot)}, cooking ${bot.stat('cooking').level}` }
        : { ok, ticks: bot.tickCount - t0, msg: 'cook did not complete' };
}
