// q-goblin-diplomacy.ts — Goblin Diplomacy (5 QP), cheat-free. Lane f2p-b (agent fg). Rebuilt as a speedrun leg (the old
// runner fetched the mail and made the dyes: 2,198 t).
//
// Content (rev 289): quests/quest_gobdip/scripts/quest_gobdip.rs2, goblin_mail.rs2, areas/area_port_sarim/scripts/bartender.rs2,
// areas/area_falador/scripts/goblin_village/general_bentnoze.rs2 + general_wartface.rs2
//   1. Rusty Anchor bartender (npc 734, spawn 3045,3257; m47_50): opnpc1 opens p_choice2 at once; "Not very busy in here
//      today, is it?" -> chatplayer, 2 chatnpc, chatplayer, %goblinquest = 1                      (bartender.rs2:6-21, QG:13-19)
//   2. Dye 2 goblin mail: OPHELDU dye on goblin_armour -> orange / dark blue mail (goblin_mail.rs2:1-12). Orange and blue
//      goblin mail are tradeable=no (quest_gobdip.obj), so the dyes + 3 plain mail are the SUPPLY and we dye them ourselves.
//   3. Generals Bentnoze (296, 2958,3511) / Wartface (297, 2957,3511) (m46_54), either one: every talk = 3 greet pages then
//      the %goblinquest stage reply (QG:85-93):
//        stage 1: p_choice3 -> "Do you want me to pick an armour colour for you?" -> 2 chatplayer, 3 chatnpc, stage 2 (QG:21-27)
//        stage 2: "Oh it you." + hand in orange (mesbox) -> stage 3; stage 3: blue -> 4; stage 4: plain mail -> 5 +
//        queue(goblin_diplomacy_complete_quest): crafting +2000 (x25), gold bar, quest scroll                (QG:29-73, :95-128)
//   Bentnoze adds a p_choice2 first while Dragon Slayer's map hunt is on (general_bentnoze.rs2:21-32): answered by text.
import { SpeedBot, objId } from '../../../core.js';
import { tele, inDialog, npc } from '../../q-lib.js';
import { guard, fail, mkLog, completeCheck, opNpcReach, go, type Item } from './fb-lib.js';
import { talkAll, useOn, hasRunes, monitor } from './fg-lib.js';
import { isResuming, journalStage, failHook } from '../journal.js';

export const QUEST = { name: 'Goblin Diplomacy', dir: 'quest_gobdip', qp: 5 };
export const REQUIREMENTS = {
    quests: [] as string[], qp: 0,
    skills: {} as Record<string, [number, string]>,   // none needed; magic 37 is used for Falador Teleport when the runes are carried
    start: { x: 3045, z: 3255, level: 0 },              // Rusty Anchor, Port Sarim, next to the bartender
    end: { x: 2957, z: 3510, level: 0 },                // goblin village, by the generals
};
export const SUPPLY: Item[] = [
    { name: 'goblin_armour', n: 3 }, { name: 'orangedye', n: 1 }, { name: 'bluedye', n: 1 },
    // Falador Teleport (spell needs magic 37): optional; without it (or below 37) the leg walks
    { name: 'lawrune', n: 1 }, { name: 'airrune', n: 3 }, { name: 'waterrune', n: 1 },
];

/** session 10 resume: the quest JOURNAL (quest_gobdip/scripts/gobdip_journal.rs2) -> %goblinquest, first match wins */
const GD_STAGES: Array<[RegExp, number]> = [
    [/QUEST COMPLETE/i, 6], [/see if they liked the\s+Brown/i, 5], [/original\s+Brown Goblin Armour\s+to try out/i, 4],
    [/bring them some\s+Blue Goblin Armour/i, 3], [/bring the goblins some\s+Orange/i, 2], [/investigate\s+before it turns/i, 1],
];
const BARTENDER = 734, GENERALS = [296, 297];
const BAR_AT = { x: 3045, z: 3257 }, GEN_AT = { x: 2958, z: 3511 };
const FALLY_RUNES = { lawrune: 1, airrune: 3, waterrune: 1 };

export async function run(bot: SpeedBot, o: { log?: boolean } = {}): Promise<{ ok: boolean; ticks: number; msg: string }> {
    bot.holdDialogs = true;
    const log = mkLog(bot, 'gobdip', o.log !== false);
    const qp0 = bot.getVarp(101), done = completeCheck(bot, qp0, QUEST.qp);
    const g = guard(bot);
    const n = (k: string) => bot.count(objId(k));
    try {
        // session 10: on a retry, the journal stage (GD_RESUME=0 = always from the top): skip the bartender, dye and hand in
        // only the colours still asked for, and enter the generals' talk loop at that stage
        let gs = 0;
        if (isResuming(bot) && process.env.GD_RESUME !== '0') {
            if (inDialog(bot)) { bot.closeModal(); bot.queueFlush(); await bot.tick(1); }
            gs = await journalStage(bot, 'gobdip', GD_STAGES, 0, s => console.log(`[gobdip] ${s}`));
            console.log(`[gobdip] resume at stage ${gs} @${JSON.stringify(bot.pos())} mail ${n('goblin_armour')}/${n('goblin_armour_orange')}/${n('goblin_armour_darkblue')}`);
            if (gs >= 6) return { ok: true, ticks: bot.tickCount - log.t0, msg: 'journal: quest complete' };
        }
        const R = gs > 0;
        const needOrange = !R || gs <= 2, needBlue = !R || gs <= 3;
        const mail = () => n('goblin_armour') + n('goblin_armour_orange') + n('goblin_armour_darkblue');
        const mailNeed = !R ? 3 : (needOrange ? 1 : 0) + (needBlue ? 1 : 0) + 1;
        if (mail() < mailNeed) fail(bot, `need ${mailNeed} goblin mail (have ${mail()})`);
        if (!R) {
        // 1. bartender (the started branch offers "Have you heard any more rumours" instead: harmless, one talk)
        const seen = await talkAll(bot, BARTENDER, BAR_AT, [/^Not very busy in here today, is it\?$/, /^Have you heard any more rumours in here\?$/], 'bartender');
        if (process.env.FG_DEBUG) console.log(`[fg] bartender seen ${JSON.stringify(seen)}`);
        if (!seen.some(t => /goblins|rumours/.test(t))) fail(bot, 'bartender: quest start not seen');
        log.split('bartender'); failHook('gobdip:bartender');
        }
        // 2. dye: OPHELDU only clears the interaction + modal, not the walk queue (engine OpHeldUHandler.ts:86 ->
        //    Player.clearPendingAction: clearInteraction + closeModal), so the two dyes can ride the first ticks of the
        //    walk is possible (A/B FG_GD_DYE=walk; default: dye first, then teleport). A teleport delay drops item ops (OpHeldUHandler.ts:16).
        const dyes: Array<[string, string]> = ([['orangedye', 'goblin_armour_orange'], ['bluedye', 'goblin_armour_darkblue']] as Array<[string, string]>)
            .filter(([d]) => d === 'orangedye' ? needOrange : needBlue);
        const dyeAll = async () => {
            for (const [dye, out] of dyes) {
                const t = bot.tickCount;
                while (n(out) === 0) {
                    if (bot.tickCount - t > 8) fail(bot, `dye ${dye} failed`);
                    if ((bot.tickCount - t) % 3 === 0 && !useOn(bot, dye, 'goblin_armour')) fail(bot, `missing ${dye}`);
                    await bot.tick(1);
                }
            }
        };
        const dyeFirst = process.env.FG_GD_DYE !== 'walk';   // A/B: before 89, 86 vs walk 88, 86, 87, 89 (fg8-13): a tie, keep the simpler
        if (dyeFirst) { await dyeAll(); log.split('dyed'); }
        // 3. to the goblin village (Falador Teleport lands at ~2966,3380: 128 tiles south of the generals)
        if (bot.stat('magic').level >= 37 && hasRunes(bot, FALLY_RUNES) && process.env.FG_GD_TELE !== '0') {
            if ((await tele(bot, 'falador_teleport')).ok) log.split('tele Falador');
        }
        const mon = monitor(bot, GENERALS, 'gen');
        let dyeErr: Error | null = null;
        const dyeing = dyeFirst ? Promise.resolve() : dyeAll().catch(e => { dyeErr = e as Error; });
        // 4. the generals: one conversation per stage until the quest completes. The first OPNPC rides the last chunk of
        //    the walk (openNpc -> walkOp); later talks op straight away (we stand next to them).
        const ans = [/^Do you want me to pick an armour colour for you\?$/, /^So how is life for the goblins\?$/];
        const cut = process.env.FG_GD_CUT !== '0';
        const i0 = R ? Math.min(3, gs - 1) : 0;
        // (resume: the cut hand-in loop below assumes we stand by the generals, as the first talk's walk leaves us in a fresh run)
        if (R && i0 >= 1) { const gp = npc(bot, GENERALS); if (!gp || gp.d > 6) await go(bot, GEN_AT, 2, 'generals (resume)', 800); }
        for (let i = i0; !done(); i++) {
            if (i - i0 >= 6) fail(bot, 'generals: no completion after 6 talks');
            if (i === 1) { await dyeing; if (dyeErr) throw dyeErr; }
            // CUT (default): stages 2 and 3 take the mail and advance %goblinquest right after the first player line
            // (QG:31-33, :40-42); the rest is flavour. Once the pack count drops, OPNPC again at once: the engine closes
            // the chat (clearPendingAction) and the new talk is the next stage. Stage 4 is finished normally.
            const it = i === 1 ? 'goblin_armour_orange' : i === 2 ? 'goblin_armour_darkblue' : '';
            if (cut && it && n(it) > 0) {
                const c0 = n(it), t = bot.tickCount;
                let lastOp = -100;
                while (n(it) >= c0) {
                    if (bot.tickCount - t > 30) fail(bot, `generals${i + 1}: ${it} not taken`);
                    if (inDialog(bot)) {
                        if (bot.dialogOptions().length) { for (const re of ans) if (bot.clickDialogByText(re) > 0) break; }
                        else for (let k = 0; k < 4; k++) bot.resumeDialogPage();
                        bot.queueFlush();
                    } else if (bot.tickCount - lastOp >= 4) { const g0 = npc(bot, GENERALS); if (g0) { opNpcReach(bot, g0, 1); lastOp = bot.tickCount; } }
                    await bot.tick(1);
                }
                const g0 = npc(bot, GENERALS);
                if (g0) opNpcReach(bot, g0, 1);   // cut the flavour pages: start the next stage's talk
                log.split(`generals${i + 1}`); failHook(`gobdip:generals${i + 1}`);
                continue;
            }
            const s = await talkAll(bot, GENERALS, GEN_AT, ans, `generals${i + 1}`, { done, keepOpen: cut && i >= 2 });
            if (s.some(t => /goblin armour yet\?/.test(t))) fail(bot, `generals: asked for mail we lack (pack mail ${mail()})`);
            log.split(`generals${i + 1}`); failHook(`gobdip:generals${i + 1}`);
            if (/This is rather nice/.test(s.join('|'))) break;
        }
        mon.stop = true;
        if (!(await bot.until(done, 10))) fail(bot, 'no completion');
        log.split('complete');
        if (g.dead) fail(bot, 'died');
        return { ok: true, ticks: bot.tickCount - log.t0, msg: JSON.stringify(log.splits) };
    } catch (e) {
        return { ok: false, ticks: bot.tickCount - log.t0, msg: (e as Error).message };
    } finally { g.stop = true; bot.holdDialogs = false; }
}
