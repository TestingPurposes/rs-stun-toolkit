// q-observatory.ts — Observatory Quest (quest_itgronigen), cheat-free. Max-QP build, ardougne lane.
//
// Content (rev 289, server/content/scripts/quests/quest_itgronigen/scripts/): quest_itgronigen.rs2,
// observatory_professor.rs2. Stage varp %itgronigen (quest_itgronigen.constant; complete = 7,
// general/configs/quest.constant:39), NOT transmitted.
// Order (dungeon FIRST: the keep key chest, the keep gate and the lens-mould sack have no stage checks,
// quest_itgronigen.rs2:85-109,164-172; the lens can be made from the mould and molten glass at any time, :174-185):
//   ladder down (2444,3191) (2 warning pages below stage 7, :1-14) -> (2420,9459)
//   chest (2428,9419): Open, Search -> keep key (:40-42,85-98)
//   key on the keep gate (2390,9457) from the north (:100-150; the goblin guard at 2391,9458 aggroes, :114-116)
//   sack (2389,9454) -> lens mould; molten glass on the mould -> lens (2nd molten glass)
//   gate from inside, ladder up (2420,9460) -> reception
//   professor (2438,3186): "I'd like to have a look through that telescope." / "Sounds interesting, what can I do for
//     you?" -> started; then planks -> bronze -> glass -> mould (needs 1 free slot) -> lens, one conversation per stage
//     (observatory_professor.rs2:5-99)                                                      -> sent_telescope (6)
//   ladder down, dome ladder (2423,9439) -> dome (2440,3165); telescope (2440,3157) with professor2 within 7
//     (:152-162), constellation dialogue (either answer)                                     -> complete (7)
//   Reward: crafting 22,500 tenths + uncut sapphire + a random constellation extra (:220-270).
import { SpeedBot, objId, cheb } from '../../../core.js';
import { qp, inDialog, dismiss, nav, trace, npc, opLocGo, type Tile } from '../../q-lib.js';
import { type Item, type Ctx, ctx, mark, fail, talkTo, finishDialog, opLocUntil, useOnLocUntil, combine, textWatch, deathWatch, walkLive, locAtAny, StepError } from './ar-lib.js';
import { isResuming, journalStage, failHook } from '../journal.js';

export const QUEST = { name: 'Observatory Quest', dir: 'quest_itgronigen', qp: 2 };
export const REQUIREMENTS = {
    quests: [] as string[], qp: 0,
    skills: {} as Record<string, [number, string]>,   // no skill checks (the lens has no crafting check, :174-185)
    start: { x: 2441, z: 3190, level: 0 },              // reception, between the professor and the ladder
    end: { x: 2440, z: 3160, level: 0 },                // observatory dome
};
/** 2 molten glass: one for the professor's stage-3 hand-in, one to cast the lens ourselves in the dungeon (no check). */
export const SUPPLY: Item[] = [{ name: 'woodplank', n: 3 }, { name: 'bronze_bar', n: 1 }, { name: 'molten_glass', n: 2 }];

const PROF = 488, PROF2 = 490;
const PROF_AT = { x: 2438, z: 3186 }, PROF2_AT = { x: 2439, z: 3160 };
const LADDER_DOWN = { id: 2187, x: 2444, z: 3191 }, LADDER_UP = { id: 2188, x: 2420, z: 9460 }, DOME_UP = { id: 2189, x: 2423, z: 9439 };
const KEY_CHEST = { id: 2197, x: 2428, z: 9419 }, KEY_CHEST_OPEN = 2198, KEY_STAND = { x: 2428, z: 9420 };
const GATE = { id: 2200, x: 2390, z: 9457 }, GATE_N = { x: 2390, z: 9458 }, GATE_S = { x: 2390, z: 9457 };
const SACK = { id: 2212, x: 2389, z: 9454 }, TELESCOPE = { id: 2210, x: 2440, z: 3157 };

const under = (b: SpeedBot) => b.tile().z > 9000;
const inKeep = (b: SpeedBot) => { const t = b.tile(); return under(b) && t.z <= 9457 && t.z >= 9450 && t.x <= 2395 && t.x >= 2387; };   // the walled keep (gate on the N edge of 2390-2391,9457)

export async function run(bot: SpeedBot, o: { log?: boolean } = {}): Promise<{ ok: boolean; ticks: number; msg: string; marks?: Record<string, number> }> {
    await nav();
    const c = ctx(bot, o.log ?? true);
    trace(bot, c.t0);
    const qp0 = qp(bot);
    bot.holdDialogs = true;
    const dw = deathWatch(c);
    try {
        await body(c, dw.dead);
        return { ok: true, ticks: bot.tickCount - c.t0, msg: `quest points ${qp0} -> ${qp(bot)}`, marks: c.marks };
    } catch (e) {
        return { ok: false, ticks: bot.tickCount - c.t0, msg: (e as Error).message, marks: c.marks };
    } finally { dw.stop(); bot.holdDialogs = false; }
}

/** itgronigen_journal.rs2 -> %itgronigen step (0 not started .. 6 sent to the dome, 7 complete), latest first (session 10) */
const OBS_STAGES: Array<[RegExp, number]> = [
    [/QUEST COMPLETE/i, 7], [/has gone ahead to the Observatory/i, 6], [/Fine by me!/i, 5], [/1 lens mould/i, 4],
    [/1 molten glass/i, 3], [/1 bronze bar/i, 2], [/3 wooden planks/i, 1], [/I can start this quest/i, 0],
];

async function body(c: Ctx, dead: () => boolean): Promise<void> {
    const bot = c.bot;
    const need = (ok: boolean, label: string) => { if (dead()) fail(c, `${label} (DIED)`); if (!ok) fail(c, label); failHook(label); };
    // session 10: on a retry / resume, the professor's stage from the quest JOURNAL; the hand-ins (and the supply check) behind
    // it are skipped, the dungeon too once the lens is made. 0 on a fresh attempt. OBS_RESUME=0 reverts.
    let st = 0;
    if (isResuming(bot) && process.env.OBS_RESUME !== '0') {
        if (bot.chatModalId !== -1 || bot.mainModalId !== -1) { dismiss(bot); await bot.tick(1); }
        st = await journalStage<number>(bot, 'itgronigen', OBS_STAGES, 0, s => mark(c, s));
        if (st >= 7) return;
    }
    const handed: Record<string, number> = { woodplank: 1, bronze_bar: 2, molten_glass: 3 };   // the stage after which each is handed in
    for (const it of SUPPLY) {
        const want = st === 0 ? it.n : it.name === 'molten_glass' ? (st > 3 ? 0 : 1) + (bot.count('lens') > 0 || st >= 6 ? 0 : 1) : (st > (handed[it.name] ?? 0) ? 0 : it.n);
        if (bot.count(it.name) < want) fail(c, `missing ${it.name} ${bot.count(it.name)}/${want}`);
    }
    if (st === 0 && bot.free() < 3) fail(c, `need 3 free slots (key, mould, glass back), have ${bot.free()}`);
    const lensDone = () => st > 0 && (bot.count('lens') > 0 || st >= 6);

    // 1. dungeon: key, keep gate, mould, lens
    if (lensDone()) {
        // resume with the lens made: just out of the dungeon if still in it
        if (inKeep(bot)) need(await opLocUntil(c, GATE, 1, () => !inKeep(bot), { label: 'keep-out', stand: GATE_S }), 'keep-out');
        if (under(bot) && st < 6) need(await opLocUntil(c, LADDER_UP, 1, () => !under(bot), { label: 'ladder-up' }), 'ladder-up');
    } else {
    need(await opLocUntil(c, LADDER_DOWN, 1, () => under(bot), { label: 'ladder-down', answers: [/.*/], maxTicks: 4 }), 'ladder-down');
    dismiss(bot);
    for (let k = 0; k < 4 && !bot.count('keep_key') && !inKeep(bot); k++) {
        const open = bot.liveLocs.get(`0,${KEY_CHEST.x},${KEY_CHEST.z}`) === KEY_CHEST_OPEN;
        if (!open) await opLocUntil(c, KEY_CHEST, 1, () => bot.liveLocs.get(`0,${KEY_CHEST.x},${KEY_CHEST.z}`) === KEY_CHEST_OPEN, { label: 'key-chest-open', tries: 2 });
        else await opLocUntil(c, { ...KEY_CHEST, id: KEY_CHEST_OPEN }, 2, () => bot.count('keep_key') > 0, { label: 'key-chest-search', tries: 2, answers: [/.*/] });
    }
    need(bot.count('keep_key') > 0 || inKeep(bot), 'keep-key');
    dismiss(bot);
    if (!inKeep(bot)) need(await useOnLocUntil(c, 'keep_key', GATE, () => inKeep(bot), { label: 'keep-gate', stand: GATE_N, answers: [/.*/] }), 'keep-gate');
    dismiss(bot);
    need(await opLocUntil(c, SACK, 1, () => bot.count('lens_mould') > 0, { label: 'mould' }), 'mould');
    await combine(bot, 'molten_glass', 'lens_mould', () => bot.count('lens') > 0);
    need(bot.count('lens') > 0, 'lens'); mark(c, 'lens');
    dismiss(bot);
    need(await opLocUntil(c, GATE, 1, () => !inKeep(bot), { label: 'keep-out', stand: GATE_S }), 'keep-out');
    need(await opLocUntil(c, LADDER_UP, 1, () => !under(bot), { label: 'ladder-up' }), 'ladder-up');
    }
    // 2. the professor: start + 5 hand-ins, one conversation each (the next one opens as soon as the last page closes)
    const started = textWatch(bot, /First I need three planks of wood/i);
    if (st < 1) need(await talkTo(c, PROF, PROF_AT, [/^I'd like to have a look through that telescope\.$/, /^Sounds interesting, what can I do for you\?$/], () => started() && !inDialog(bot), { label: 'prof-start' }), 'prof-start');
    for (const [item, label] of [['woodplank', 'planks'], ['bronze_bar', 'bronze'], ['molten_glass', 'glass']] as Array<[string, string]>) {
        if (st > handed[item]!) continue;
        const n0 = bot.count(item);
        need(await talkTo(c, PROF, PROF_AT, [/.*/], () => bot.count(item) < n0 && !inDialog(bot), { label: `prof-${label}` }), `prof-${label}`);
    }
    // mould: he gives the molten glass back (free slot), keeps the stage at given_mould
    const mouldDone = textWatch(bot, /gives you back the molten glass/i);
    if (st < 5) need(await talkTo(c, PROF, PROF_AT, [/.*/], () => mouldDone() && !inDialog(bot), { label: 'prof-mould' }), 'prof-mould');
    if (st < 6) need(await talkTo(c, PROF, PROF_AT, [/.*/], () => bot.count('lens') === 0 && !inDialog(bot), { label: 'prof-lens' }), 'prof-lens');
    // 3. dome: ladder down, dome ladder up, telescope with professor2 close (a resume already in the dome skips the ladders)
    const inDome = () => !under(bot) && cheb(bot.tile(), TELESCOPE) <= 15;
    if (!(st >= 6 && inDome())) {
    if (!under(bot)) need(await opLocUntil(c, LADDER_DOWN, 1, () => under(bot), { label: 'ladder-down-2', answers: [/.*/], maxTicks: 4 }), 'ladder-down-2');
    dismiss(bot);
    need(await opLocUntil(c, DOME_UP, 1, () => !under(bot), { label: 'dome-up' }), 'dome-up');
    }
    // the telescope only reacts while professor2 (wanders, wanderrange 5) is within 7 tiles of us, else silently nothing
    // (quest_itgronigen.rs2:157): op it only when he is within 6, then give it the 3-tick p_delay(2) + a margin
    const cr0 = bot.stat('crafting').xp;
    const scope = locAtAny(TELESCOPE.id, TELESCOPE.x, TELESCOPE.z, 0);
    for (let k = 0; k < 60 && bot.stat('crafting').xp <= cr0; k++) {
        if (inDialog(bot)) {
            await finishDialog(bot, [/^I can see a constellation\.$/, /.*/], 20, () => bot.stat('crafting').xp > cr0);
            continue;
        }
        // the telescope view (main modal 3702): the constellation dialogue is queued and only runs once it is closed
        if (bot.mainModalId !== -1) { dismiss(bot); await bot.until(() => inDialog(bot) || bot.stat('crafting').xp > cr0, 3); continue; }
        const p2 = npc(bot, PROF2);
        if (!p2) { await bot.tick(1); continue; }
        if (cheb(bot.tile(), p2) > 6) { opLocGo(bot, scope, 1); await bot.tick(1); continue; }   // walk the scope's way; he comes and goes
        opLocGo(bot, scope, 1);
        await bot.until(() => inDialog(bot) || bot.mainModalId !== -1 || bot.stat('crafting').xp > cr0, 5);
    }
    need(bot.stat('crafting').xp > cr0, 'telescope-reward'); mark(c, 'complete');
    dismiss(bot);
    void objId; void PROF2_AT; void KEY_STAND;
}
export { StepError };
