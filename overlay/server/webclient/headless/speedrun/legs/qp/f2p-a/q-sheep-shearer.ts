// q-sheep-shearer.ts — Sheep Shearer (quest_sheep), cheat-free. Content: areas/area_lumbridge/scripts/fred_the_farmer.rs2,
// quests/quest_sheep/scripts/quest_sheep.rs2, configs/quest_sheep.constant (^sheep_started 1, ^sheep_last_wool 20).
//
// Flow (Farmer Fred, npc 758, spawn (3189,3273) in his farmhouse NW of Lumbridge):
//   talk 1 (%sheep 0): chatnpc (fred_the_farmer.rs2:11) | p_choice3 "I'm looking for a quest." (:12) | chatplayer | 3 chatnpc |
//     multi3 "Yes okay. I can do that." (:18) | chatplayer | chatnpc -> %sheep = 1 (:54)
//   talk 2 (%sheep 1..20): chatnpc | chatplayer "I have some." | chatnpc (:58-61) -> fred_give_wool loop (:68-78): if_close,
//     inv_del 1 ball, %sheep+1, p_delay(1) — 19 times with NO dialog open — then fred_end_giving_wool (:80-85): chatplayer |
//     chatnpc -> queue(sheep_complete): deletes the 20th ball, +60 coins, crafting 1500 tenths base (x25 = 3,750), +1 qp.
// The hand-in loop is engine-paced (p_delay per ball); the driver must not re-talk while it runs (`wait`).
// Completion observable: qp +1.
import type { SpeedBot } from '../../../core.js';
import { R, M3, npc, type FTok } from '../../q-lib.js';
import { converse, mkLog, qp, type Item, type QuestDef, type Requirements, type RunResult } from './fa-lib.js';

export const QUEST: QuestDef = { name: 'Sheep Shearer', dir: 'quest_sheep', qp: 1 };
export const REQUIREMENTS: Requirements = {
    quests: [], qp: 0, skills: {},
    start: { x: 3189, z: 3273, level: 0 },   // inside Farmer Fred's farmhouse
    end: { x: 3189, z: 3273, level: 0 },
};
/** 19 handed in by the loop (fred_the_farmer.rs2:69-75, until %sheep = 20) + 1 at completion (quest_sheep.rs2:3) */
export const SUPPLY: Item[] = [{ name: 'ball_of_wool', n: 20 }];
const FRED = 758;
const FRED_AT = { x: 3189, z: 3273 };

export async function run(bot: SpeedBot, o: { log?: boolean } = {}): Promise<RunResult> {
    const t0 = bot.tickCount, qp0 = qp(bot), L = mkLog(bot, 'sheep', !!o.log);
    if (bot.count('ball_of_wool') < 20) return { ok: false, ticks: 0, msg: `need 20 ball_of_wool, have ${bot.count('ball_of_wool')}` };
    let wool = bot.count('ball_of_wool'), woolTick = -99;
    const watch = () => { const w = bot.count('ball_of_wool'); if (w !== wool) { wool = w; woolTick = bot.tickCount; } };
    const reop: FTok = { fn: () => { const n = npc(bot, FRED); if (n) bot.opNpc(n.idx, 1); }, cost: 1 };
    const plan: FTok[] = [R, R, M3[0]!, R, R, R, R, R, R, M3[0]!, R, R];
    const ok = await converse(bot, FRED, {
        plan, after: [reop], stand: FRED_AT, near: 10, label: 'fred', log: L, maxTicks: 200, tries: 5,
        answers: [/^I'm looking for a quest\.$/, /^Yes okay\. I can do that\.$/],
        done: () => { watch(); return qp(bot) > qp0; },
        wait: () => { watch(); return bot.tickCount - woolTick <= 4; },
    });
    L(`done ok=${ok} qp ${qp0} -> ${qp(bot)} wool left ${bot.count('ball_of_wool')}`);
    return ok ? { ok, ticks: bot.tickCount - t0, msg: `qp ${qp0} -> ${qp(bot)}, crafting ${bot.stat('crafting').level}` }
        : { ok, ticks: bot.tickCount - t0, msg: `Fred did not complete (wool left ${bot.count('ball_of_wool')})` };
}
