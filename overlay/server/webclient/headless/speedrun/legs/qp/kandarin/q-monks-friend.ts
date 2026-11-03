// q-monks-friend.ts — Monk's Friend (1 QP), cheat-free. Kandarin lane, max-QP build (rev 289).
//
// Verified flow (paths relative to server/content/scripts/):
//   1. Brother Omad (npc 279, spawn 2604,3209 L0, Ardougne monastery): "Why can't you sleep, what's wrong?" ->
//      "Can I help at all?" -> %drunkmonkquest = 10 and settimer(blanket_ladder, 1)
//      (areas/area_ardougne_east/scripts/brother_omad.rs2:12-38).
//   2. The timer adds a ladder (loc 1765 wildymirrorladdertop1) at 0_40_50_1_22 = (2561,3222) while we stand within
//      2 tiles (quests/quest_drunkmonk/scripts/quest_drunkmonk.rs2:1-6). Climb-down -> (2561,9621)
//      (ladders+stairs/scripts/ladders.rs2:104-110).
//   3. Child's blanket: ground spawn (2570,9604) (maps/m40_150.jm2). The thieves there are huntmode=cowardly.
//   4. Up the ladder_from_cellar (2561,9622), back to Omad: blanket handed over -> 20 (brother_omad.rs2:40-51).
//   5. Omad again: "Who's Brother Cedric?" -> "Where should I look?" -> 30 (brother_omad.rs2:56-84).
//   6. Brother Cedric (npc 280, spawn 2614,3259): talk -> 40; talk with a jug of water -> 50 -> "Yes, I'd be happy
//      to!" -> 60; talk with logs -> 70 (areas/area_ardougne_east/scripts/brother_cedric.rs2:21-70).
//   7. Omad: party -> queue(drunkmonk_complete): 1 QP, 8 law runes, stat_advance woodcutting 20000 (tenths: 2,000 xp) (brother_omad.rs2:108-115,
//      quest_drunkmonk.rs2:84-89).
import type { SpeedBot } from '../../../core.js';
import { nav, inDialog, routeToLoc, walkOp } from '../../q-lib.js';
import { runQuest, talkNpc, heard, pickup, fail, checkAlive, dead, type Item, type RunResult } from './ka-lib.js';
import { isResuming, journalStage, failHook } from '../journal.js';
/** session 10 resume: the quest JOURNAL (quest_drunkmonk/scripts/drunkmonk_journal.rs2) -> %drunkmonkquest, first match wins */
const MF_STAGES: Array<[RegExp, number]> = [
    [/QUEST COMPLETE/i, 99], [/tell\s+Brother Omad\s+that/i, 70], [/needs some\s+wood/i, 50], [/take him a\s+jug of water/i, 40],
    [/agreed to find\s+Brother Cedric/i, 30], [/gave back the blanket/i, 20], [/recover a\s+child's blanket/i, 10],
];

export const QUEST = { name: "Monk's Friend", dir: 'quest_drunkmonk', qp: 1 };
export const REQUIREMENTS = {
    quests: [] as string[], qp: 0,
    skills: {} as Record<string, [number, string]>,   // none: no skill check anywhere in the quest
    start: { x: 2605, z: 3211, level: 0 }, end: { x: 2604, z: 3209, level: 0 },   // start inside Omad's hall (2604,3212 is a walled garden: +12 t detour)
};
/** jug of water (Cedric, brother_cedric.rs2:32) + plain logs (brother_cedric.rs2:62) */
export const SUPPLY: Item[] = [{ name: 'jug_water', n: 1 }, { name: 'logs', n: 1 }];

const OMAD = 279, CEDRIC = 280;
const OMAD_AT = { x: 2604, z: 3209 }, CEDRIC_AT = { x: 2614, z: 3259 };
const CIRCLE = { x: 2561, z: 3222 }, BLANKET_AT = { x: 2570, z: 9604 };
const LADDER_ID = 1765, UP_LADDER = { id: 1755, x: 2561, z: 9622 };

export async function run(bot: SpeedBot, o: { log?: boolean } = {}): Promise<RunResult> {
    return runQuest(bot, QUEST, async st0 => {
        await nav();
        const st = { ...st0, at: (k: string) => { st0.at(k); failHook(`monks:${k}`); } };
        // session 10: on a retry, the journal stage gates each step (MF_RESUME=0 = always from the top)
        let ms = 0;
        if (isResuming(bot) && process.env.MF_RESUME !== '0') {
            if (inDialog(bot)) { bot.closeModal(); bot.queueFlush(); await bot.tick(1); }
            ms = await journalStage(bot, 'drunkmonk', MF_STAGES, 0, s => console.log(`[monks] ${s}`));
            console.log(`[monks] resume at stage ${ms} @${JSON.stringify(bot.pos())} blanket ${bot.count('childs_blanket')}`);
            if (ms >= 99) return;
        }
        const RS = ms > 0;
        // 1. Omad: start
        let t = bot.tickCount;
        if (ms <= 0) {
        if (!(await talkNpc(bot, OMAD, OMAD_AT, [/^Why can't you sleep/, /^Can I help at all/], () => heard(bot, /secret cave in the forest/, t), { label: 'omad1' }))) fail(bot, 'Omad start');
        st.at('omad-start');
        }
        if (ms <= 10) {
        // 2. stone circle: walk within 2 tiles, the ladder appears (timer, every tick), climb down
        const ladderUp = () => bot.liveLocs.get(`0,${CIRCLE.x},${CIRCLE.z}`) === LADDER_ID;
        const fake = { id: LADDER_ID, x: CIRCLE.x, z: CIRCLE.z, width: 1, length: 1, angle: 0, shape: 10, level: 0 } as any;
        const down = () => bot.tile().z > 6400;
        const ladderOp = () => { if (!ladderUp()) return false; routeToLoc(bot, fake); bot.opLoc(CIRCLE.x, CIRCLE.z, LADDER_ID, 1); return true; };
        if (!RS || !bot.count('childs_blanket')) {
        if (!(await walkOp(bot, { x: CIRCLE.x + 1, z: CIRCLE.z }, ladderOp, () => down() || dead(bot), { near: 2, maxTicks: 300 }))) fail(bot, 'ladder down');
        checkAlive(bot);
        st.at('cave');
        // 3. blanket
        if (!(await pickup(bot, 'childs_blanket', BLANKET_AT))) fail(bot, 'blanket');
        st.at('blanket');
        }
        // 4. up + Omad hand-in
        const up = { ...UP_LADDER, width: 1, length: 1, angle: 0, shape: 10, level: 0 } as any;
        if (!RS || down()) if (!(await walkOp(bot, { x: UP_LADDER.x, z: UP_LADDER.z - 1 }, () => { routeToLoc(bot, up); bot.opLoc(UP_LADDER.x, UP_LADDER.z, UP_LADDER.id, 1); }, () => bot.tile().z < 6400 || dead(bot), { near: 1, maxTicks: 80 }))) fail(bot, 'ladder up');
        checkAlive(bot);
        st.at('surface');
        if (!(await talkNpc(bot, OMAD, OMAD_AT, [], () => bot.count('childs_blanket') === 0 && !inDialog(bot), { label: 'omad2' }))) fail(bot, 'Omad blanket');
        st.at('omad-blanket');
        }
        if (ms <= 20) {
        t = bot.tickCount;
        if (!(await talkNpc(bot, OMAD, OMAD_AT, [/^Who's Brother Cedric/, /^Where should I look/], () => heard(bot, /go and find him/, t), { label: 'omad3' }))) fail(bot, 'Omad party talk');
        st.at('omad-cedric');
        }
        // 6. Cedric x3
        if (ms <= 30) {
        t = bot.tickCount;
        if (!(await talkNpc(bot, CEDRIC, CEDRIC_AT, [], () => heard(bot, /find me a jug of water/, t), { label: 'cedric1' }))) fail(bot, 'Cedric 1');
        st.at('cedric1');
        }
        if (ms <= 40) {
        t = bot.tickCount;
        if (!(await talkNpc(bot, CEDRIC, CEDRIC_AT, [/^Yes, I'd be happy to/], () => bot.count('jug_water') === 0 && heard(bot, /I just need some wood/, t), { label: 'cedric2' }))) fail(bot, 'Cedric 2');
        st.at('cedric2');
        }
        if (ms <= 50) {
        t = bot.tickCount;
        // (resume at 50/60 read the same: at 50 Cedric asks again first, brother_cedric.rs2:21-70)
        if (!(await talkNpc(bot, CEDRIC, CEDRIC_AT, RS ? [/^Yes, I'd be happy to/] : [], () => bot.count('logs') === 0 && heard(bot, /see you later/, t), { label: 'cedric3' }))) fail(bot, 'Cedric 3');
        st.at('cedric3');
        }
        // 7. Omad: party (p_delays) -> quest complete
        const law0 = bot.count('lawrune');
        if (!(await talkNpc(bot, OMAD, OMAD_AT, [], () => bot.count('lawrune') >= law0 + 8, { label: 'omad4', closedTicks: 30 }))) fail(bot, 'Omad party');
        st.at('done');
    }, o.log !== false);
}
