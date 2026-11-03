/// <reference types="bun" />
// noglory.ts — GLORY-FREE travel switch. SR_NO_GLORY=1 (set by run-route --charger for its own
// process only; unset = today's behaviour everywhere): no charged amulet of glory exists before the first Hero's Quest, so
//   - every module glory helper (sp-lib glory, fb-lib glory, ka-lib rubGlory, fa2-lib gloryTele, south-lib glory) replaces the
//     rub by a route-lib travelTo to the SAME glory landing (spell teleports / walking / Paterdomus; never a glory), then the
//     module goes on exactly as after the rub;
//   - the route runner drops glories from every kit and supply list (route.ts need(), run-route stageList) and the travel
//     planner never prices a glory teleport (route-lib canTele/kitTele).
// Karamja and Al Kharid (before Prince Ali) have no non-glory landing the planner can reach: a hop there FAILS loudly (the
// charger plan excludes Pirate's Treasure and Prince Ali for that reason, plan-route --charger).
import { SpeedBot, cheb } from '../../core.js';

export const NO_GLORY = (): boolean => process.env.SR_NO_GLORY === '1';
export const GLORY_LANDINGS = {   // general/scripts/enchanted_jewellry/amulet_of_glory.rs2:12-34
    edgeville: { x: 3087, z: 3496 }, karamja: { x: 2918, z: 3176 }, draynor: { x: 3105, z: 3251 }, alkharid: { x: 3293, z: 3163 },
} as const;
export type GloryDest = keyof typeof GLORY_LANDINGS;
/** 1 Edgeville, 2 Karamja, 3 Draynor, 4 Al Kharid (the rub's option order) | a name | the option regex modules pass */
export function gloryDestOf(d: number | string | RegExp): GloryDest {
    if (typeof d === 'number') return (['edgeville', 'karamja', 'draynor', 'alkharid'] as const)[d - 1]!;
    const s = typeof d === 'string' ? d : d.source;
    if (/edge/i.test(s)) return 'edgeville';
    if (/karamja/i.test(s)) return 'karamja';
    if (/draynor/i.test(s)) return 'draynor';
    if (/kharid/i.test(s)) return 'alkharid';
    throw new Error(`noglory: unknown glory destination ${s}`);
}
export const NOGLORY_LOG: Array<{ acct: string; label: string; dest: GloryDest; how: string; ticks: number; ok: boolean }> = [];
/** the glory hop without a glory: travel to the glory's landing tile by the route planner (spells, walking). */
export async function noGloryHop(bot: SpeedBot, d: number | string | RegExp, label: string): Promise<boolean> {
    const dest = gloryDestOf(d), to = GLORY_LANDINGS[dest];
    if (cheb(bot.tile(), to) <= 3 && bot.minusedlevel === 0 && bot.tile().z < 6400) return true;
    const { travelTo, DONE_OF } = await import('./route/route-lib.js');
    if (bot.chatModalId !== -1 || bot.mainModalId !== -1) { bot.closeModal(); bot.queueFlush(); await bot.tick(1); }
    // SR_TOLL_HOP=1 (run-route --existing): Al Kharid before Prince Ali = walk to the toll gate (route-lib refuses to
    // plan through it: fix 127), pay 10 gp (border guard p_choice3 "Yes, ok.", border_gate.rs2:5; q-shilo.ts crossToll), then
    // the planner finishes the walk inside. Unset = unchanged.
    const inAk = (t: { x: number; z: number }) => t.x >= 3268 && t.z >= 3150 && t.z <= 3242;
    if (process.env.SR_TOLL_HOP === '1' && dest === 'alkharid' && !inAk(bot.tile()) && !(DONE_OF.get(bot)?.has('prince'))) {
        const { dismiss, npcsOf, opNpcGo } = await import('../q-lib.js');
        const t0 = bot.tickCount, done0 = DONE_OF.get(bot) ?? new Set<string>();
        await travelTo(bot, { x: 3267, z: 3227, level: 0 }, done0, { near: 0, tag: `noglory:${label}:toll` });
        // sim hard2: 60 t of gate ops from (3267,3227) opened no dialog (border_gate.rs2 find_and_talk_to_border_guard wants the
        // same-side guard 925 within 1 tile): alternate the gate op with talking to the west guard itself
        if (bot.count('coins') < 10) console.log(`[noglory] ${bot.loginUser} ${label}: only ${bot.count('coins')} gp held for the 10 gp toll`);
        for (let k = 0, sent = 0; k < 120 && !inAk(bot.tile()); k++) {
            if (bot.dialogOptions().length) { bot.clickDialogByText(/^Yes, ok\./); bot.queueFlush(); }
            else if (bot.chatModalId !== -1) { bot.resumeDialogPage(); bot.queueFlush(); }
            else if (k % 10 === 0) {
                const g = (npcsOf(bot, [925]) as any[]).sort((x, y) => x.d - y.d)[0];
                if (sent++ % 2 === 1 && g) opNpcGo(bot, g, 1); else bot.opLoc(3268, 3227, 2882, 1);
                bot.queueFlush();
            }
            await bot.tick(1);
        }
        dismiss(bot);
        console.log(`[noglory] ${bot.loginUser} ${label}: Al Kharid toll ${inAk(bot.tile()) ? 'paid, inside' : 'NOT crossed'} (${bot.tickCount - t0} t) at ${JSON.stringify(bot.pos())}`);
    }
    const r = await travelTo(bot, { ...to, level: 0 }, DONE_OF.get(bot) ?? new Set<string>(), { near: 3, tag: `noglory:${label}` });
    const ok = r.ok || cheb(bot.tile(), to) <= 4;
    NOGLORY_LOG.push({ acct: bot.loginUser, label, dest, how: r.how, ticks: r.ticks, ok });
    console.log(`[noglory] ${bot.loginUser} ${label}: glory hop to ${dest} replaced by '${r.how}' ${r.ticks} t (est ${r.est}) ok=${ok} at ${JSON.stringify(bot.pos())}`);
    return ok;
}
