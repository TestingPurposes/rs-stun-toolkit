// q-elemental-workshop.ts — Elemental Workshop (1 QP), cheat-free. Kandarin lane, max-QP build (rev 289).
//
// Verified flow (quests/quest_elemental_workshop/scripts/quest_elemental_workshop.rs2 unless noted; progress is a bit
// field %elemental_workshop_bits, quest_elemental_workshop.constant):
//   1. Bookcase (loc 3389, Seers 2716,3481) op1 -> battered book (:1-12). Read it (opheld1) -> bit 1; use a knife on it
//      -> battered key, bit 2 (elemental_workshop_shield_book.rs2:1-24).
//   2. Odd wall (loc 3391/3390, 2709-2710,3495): use the key -> it opens (:14-34); staircase (loc 3415, 2710,3497) ->
//      workshop (2716,9888), bit 13 (:36-41).
//   3. Valve 1 (2726,9908) while valve 2 is off -> bit 4; valve 2 (2713,9908) -> bit 3; water lever (2722,9906) with
//      bits 3+4 -> water flowing, bit 5 (:79-130).
//   4. Box 1 (2717,9894) -> stone bowl (:46-52). Needle + leather are carried (boxes 2 and 4 give them once, :54-68).
//   5. Bellows (2734,9882) with needle, leather, thread, crafting 20 -> bit 6 (:164-183); air lever (2734,9887) with
//      bits 5+6 -> bit 9 (:132-148).
//   6. Elemental rock (mining 20 + a pickaxe) spawns an earth elemental (35 hp); its death drops the elemental ore
//      (:185-206, elemental_earth.rs2:1-7).
//   7. Bowl on a lava trough -> full; on the furnace (2724,9874) -> lit, bit 7 (:150-162,208-221); ore on the furnace
//      with 4 coal and air blowing -> elemental bar (:226-244).
//   8. Bar on a workbench (2717/2722,9887) with a hammer, smithing 20 and the book -> elemental shield, quest complete:
//      stat_advance crafting + smithing 50000 each (tenths: 5,000 xp, x25 on the demo) (:246-278).
import type { SpeedBot } from '../../../core.js';
import { objId } from '../../../core.js';
import { nav, locAt, npc, opLocGo } from '../../q-lib.js';
import { wield } from '../../run-lib.js';
import { runQuest, fail, checkAlive, npcId, opLocUntil, useOnLocUntil, walk, fight, pickup, heard, standFor, dead, type Item, type RunResult } from './ka-lib.js';
import { isResuming, readJournal, failHook } from '../journal.js';

export const QUEST = { name: 'Elemental Workshop', dir: 'quest_elemental_workshop', qp: 1 };
export const REQUIREMENTS = {
    quests: [] as string[], qp: 0,
    skills: {
        crafting: [20, 'bellows (quest_elemental_workshop.rs2:172, stat(): boostable)'],
        mining: [20, 'elemental rock (:186)'],
        smithing: [20, 'workbench (:252)'],
        attack: [40, 'earth elemental (35 hp): proven at att/str 83, def 1, hp 72 with a rune scimitar'],
    } as Record<string, [number, string]>,
    start: { x: 2757, z: 3478, level: 0 },   // Camelot teleport landing
    end: { x: 2720, z: 9888, level: 0 },     // workbench, Elemental Workshop (underground)
};
export const SUPPLY: Item[] = [
    { name: 'knife', n: 1 },            // cut the book's spine (shield_book.rs2:13)
    { name: 'thread', n: 1 }, { name: 'needle', n: 1 }, { name: 'leather', n: 1 },   // bellows (skips boxes 2 + 4)
    { name: 'coal', n: 4 },             // smelting the ore (:231)
    { name: 'hammer', n: 1 },           // workbench (:248)
    { name: 'bronze_pickaxe', n: 1 },   // elemental rock: any pickaxe the account can use (~pickaxe_checker; a rune pickaxe needs mining 41)
    { name: 'rune_scimitar', n: 1 },    // earth elemental (wielded by run())
];

const EARTH_ROCK = 3403;   // elemental_workshop_rock
export async function run(bot: SpeedBot, o: { log?: boolean } = {}): Promise<RunResult> {
    return runQuest(bot, QUEST, async st0 => {
        await nav();
        const st = { ...st0, at: (k: string) => { st0.at(k); failHook(`elemental:${k}`); } };
        const has = (n: string) => bot.count(n) > 0;
        // session 10: on a retry, the journal (quest_elemental_workshop/scripts/elemental_workshop_journal.rs2) shows the
        // book/key/entered stage and the water/bellows/furnace parts; the rest by items (EW_RESUME=0 = always from the top)
        let js: { stage: 'read' | 'slashed' | 'entered'; water: boolean; bellows: boolean; furnace: boolean } | null = null;
        if (isResuming(bot) && process.env.EW_RESUME !== '0') {
            if (bot.chatModalId !== -1 || bot.mainModalId !== -1) { bot.closeModal(); bot.queueFlush(); await bot.tick(1); }
            const j = await readJournal(bot, 'elemental_workshop');
            if (j.ok && /QUEST COMPLETE/i.test(j.text)) { console.log('[elemental] [journal] QUEST COMPLETE'); return; }
            const stage = !j.ok ? null : /secret door in the Seers Village smithy/i.test(j.text) ? 'entered' : /found a key hidden/i.test(j.text) ? 'slashed'
                : /battered book in a house/i.test(j.text) ? 'read' : null;
            if (stage) js = { stage, water: /waterwheel in the northern water/i.test(j.text), bellows: /bellows in the eastern air area are now fixed/i.test(j.text), furnace: /lit the furnace with lava/i.test(j.text) };
            console.log(`[elemental] [journal] elemental_workshop: ${j.ok ? `${JSON.stringify(js)} | open '${j.open.slice(0, 120)}'` : 'UNREADABLE'} (${j.ticks} t) @${JSON.stringify(bot.pos())}`);
        }
        const R = !!js;
        if (!R && bot.free() < 4) fail(bot, `need 4 free slots (book, key, bowl, ore/bar), have ${bot.free()}`);
        if (bot.count('rune_scimitar') > 0 && !bot.isWorn(objId('rune_scimitar'))) await wield(bot, ['rune_scimitar']);
        const inWorkshop = () => bot.tile().z > 6400;
        if (!R || (js!.stage !== 'entered' && !has('elemental_workshop_key'))) {
        // 1. book, read, cut
        const bookcase = locAt(3389, 2716, 3481, 0);
        if (!has('elemental_workshop_shield_book')) if (!(await opLocUntil(bot, bookcase, 1, () => has('elemental_workshop_shield_book'), { maxTicks: 120, every: 6 }))) fail(bot, 'bookcase');
        st.at('book');
        const book = objId('elemental_workshop_shield_book');
        let t = bot.tickCount;
        for (let k = 0; k < 3 && !heard(bot, /flip the book open/, t); k++) { bot.opHeld1(book, bot.slot(book)); bot.queueFlush(); await bot.until(() => heard(bot, /flip the book open/, t), 3); }
        if (bot.mainModalId !== -1) { bot.closeModal(); bot.queueFlush(); }
        for (let k = 0; k < 3 && !has('elemental_workshop_key'); k++) {
            bot.useItemOnItem(book, bot.slot(book), objId('knife'), bot.slot('knife')); bot.queueFlush();
            await bot.until(() => has('elemental_workshop_key'), 3);
        }
        if (!has('elemental_workshop_key')) fail(bot, 'battered key');
        st.at('key');
        }
        let t = bot.tickCount;
        if (!R || !inWorkshop()) {
        // 2. odd wall (key), staircase down
        const wall = locAt(3391, 2709, 3495, 0), stairs = locAt(3415, 2710, 3497, 0);
        if (!R || bot.tile().z < 3496) if (!(await useOnLocUntil(bot, 'elemental_workshop_key', wall, () => bot.tile().z >= 3496, { maxTicks: 120, every: 6 }))) fail(bot, 'odd wall');
        if (!(await opLocUntil(bot, stairs, 1, () => bot.tile().z > 6400, { maxTicks: 30 }))) fail(bot, 'workshop stairs');
        st.at('workshop');
        }
        // session 12 single-send helpers (EW_VALVE_COUNT, see the valve comment in step 3): the valves AND both levers are
        // toggles (quest_elemental_workshop.rs2:79-148), so opLocUntil's 6 t re-send after a late reply turns them back
        // off live. Walk to the stand tile with NO op, ONE op from there, read the result, re-op only when it toggled back.
        const VALVE_COUNT = process.env.EW_VALVE_COUNT !== '0', TEST_DOUBLE = process.env.EW_TEST_DOUBLE === '1';
        const chatSince = (since: number) => ((bot as any).getChat({ types: [0], limit: 0, includeSelf: true }) as any[]).filter(m => m.tick >= since).map(m => m.text as string);
        const toStand = async (l: ReturnType<typeof locAt>) => {
            const stand = standFor(bot, l);
            if (stand && (bot.tile().x !== stand.x || bot.tile().z !== stand.z)) await walk(bot, stand, null, () => dead(bot), { near: 0, maxTicks: 60 });
            checkAlive(bot);
            const me = bot.tile();
            return `@(${me.x},${me.z}) stand ${stand ? `(${stand.x},${stand.z})` : 'none'}`;
        };
        /** One lever pull from its stand tile, judged by the LAST result message after a 4 t settle: 'on' / 'other' (the
         *  lever did not switch on: gates reset, nothing happens) are final; 'off' (pulled twice: on, then off) or no reply
         *  -> pull once more (max 4). TEST double: a 2nd pull 4 t after the first reply (the lever is loc_change'd to its
         *  pulled form for 3 t, an op on it then would be dropped). */
        const pullLever = async (lv: ReturnType<typeof locAt>, label: string, L: { on: RegExp; off: RegExp; other: RegExp }, double: boolean): Promise<'on' | 'other' | 'none'> => {
            const where = await toStand(lv), tv = bot.tickCount;
            const res = () => chatSince(tv).filter(m => L.on.test(m) || L.off.test(m) || L.other.test(m));
            for (let k = 0; k < 4; k++) {
                const c0 = res().length;
                opLocGo(bot, lv, 1);
                await bot.until(() => res().length > c0, 15);
                if (double && k === 0 && res().length > c0) {
                    await bot.tick(4);
                    console.log(`[elemental] TEST EW_TEST_DOUBLE: ${label} pulled a second time`);
                    opLocGo(bot, lv, 1); await bot.until(() => res().length > c0 + 1, 15);
                }
                await bot.tick(4);
                const r = res(), m = r[r.length - 1];
                const kind = !m ? 'none' : L.on.test(m) ? 'on' : L.off.test(m) ? 'off' : 'other';
                console.log(`[elemental] ${label} ${where}: pull ${k + 1} -> [${r.join(' | ')}] (${kind}) +${bot.tickCount - tv} t`);
                if (kind === 'on' || kind === 'other') return kind;
            }
            return 'none';
        };
        const WATER = { on: /water wheel starting up/, off: /water wheel coming to a standstill/, other: /flow gates resetting/ };
        const AIR = { on: /bellows pump air/, off: /bellows stop pumping/, other: /Nothing happens; the lever resets/ };
        // 3-4. stone bowl, valves, water lever
        const box1 = locAt(3394, 2717, 9894, 0);
        if (!R || (!js!.furnace && !has('elemental_workshop_lava_bowl') && !has('elemental_workshop_lava_bowl_full')))
            if (!(await opLocUntil(bot, box1, 1, () => has('elemental_workshop_lava_bowl'), { maxTicks: 40 }))) fail(bot, 'stone bowl');
        if (!R || !js!.water) {
        t = bot.tickCount;
        const v1 = locAt(3404, 2726, 9908, 0), v2 = locAt(3405, 2713, 9908, 0), wlever = locAt(3406, 2722, 9906, 0);
        const turnedSince = (n: number) => () => { let c = 0; for (const m of msgsSinceT()) if (/You turn the handle/.test(m)) c++; return c >= n; };
        const msgsSinceT = () => (bot as any).getChat({ types: [0], limit: 0, includeSelf: true }).filter((m: any) => m.tick >= t).map((m: any) => m.text as string);
        // (resume: the valve bits are unknown: one lever pull either starts the wheel or resets both gates, elemental_workshop.rs2:107-130)
        let wheel = false;
        if (R) {
            const tr = bot.tickCount;
            if (VALVE_COUNT) wheel = (await pullLever(wlever, 'water lever (resume)', WATER, false)) === 'on';
            else {
            await opLocUntil(bot, wlever, 1, () => heard(bot, /water wheel starting up|flow gates resetting/, tr), { maxTicks: 40 });
            wheel = heard(bot, /water wheel starting up/, tr);
            }
            t = bot.tickCount;
        }
        // session 11 fix 344 (EW_GATE_REDO): qx134m 'water lever (You pull the lever. | ...flow gates resetting.)': a 1012 sim
        // drop mid-valves; the in-flight valve op ran server-side with its 'You turn the handle' lost, the post-reconnect resend
        // toggled it back and its message satisfied turnedSince(2): the lever saw one gate open and reset both
        // (quest_elemental_workshop.rs2:117-130). A reset leaves both gates known-closed: turn both again, re-pull, once.
        // EW_GATE_REDO=0 = the old single pass. EW_TEST_GATEFLIP=1 (TEST) turns valve 2 a third time on pass 0 to force it.
        // session 12 fix (EW_VALVE_COUNT; live 2/2 on the demo, never in the sim): the valves are TOGGLES
        // (quest_elemental_workshop.rs2:79-105, one 'You turn the handle' per turn). opLocUntil re-sent valve 1's op after
        // 6 t because its message arrived late under real latency: it turned on, then off, and that 2nd message satisfied
        // turnedSince(2), so valve 2 was never turned, the lever reset the gates and the redo pass failed the same way.
        // Now per valve: walk to its stand tile with NO op, ONE op from there, wait for its message + 4 t for a late one,
        // count THIS valve's messages: odd = open, even = toggled back (or none landed) -> op once more (max 4 ops).
        // EW_VALVE_COUNT=0 = the old turnedSince path. EW_TEST_DOUBLE=1 (TEST) re-ops valve 1 on pass 0 right after its
        // first message lands (the live double toggle).
        const handles = (since: number) => chatSince(since).filter(m => /You turn the handle/.test(m)).length;
        const vc: Record<string, number> = {};
        const turnValve = async (v: typeof v1, label: string, double: boolean): Promise<void> => {
            const where = await toStand(v), tv = bot.tickCount;
            for (let k = 0; k < 4; k++) {
                const c0 = handles(tv);
                opLocGo(bot, v, 1);
                await bot.until(() => handles(tv) > c0, 15);
                if (double && k === 0 && handles(tv) > c0) {
                    console.log(`[elemental] TEST EW_TEST_DOUBLE: ${label} op'd a second time`);
                    opLocGo(bot, v, 1); await bot.until(() => handles(tv) > c0 + 1, 15);
                }
                await bot.tick(4);
                vc[label] = handles(tv);
                console.log(`[elemental] ${label} ${where}: op ${k + 1} -> ${vc[label]} 'You turn the handle' (${vc[label]! % 2 ? 'open' : 'toggled back'}) +${bot.tickCount - tv} t`);
                if (vc[label]! % 2 === 1) return;
            }
            fail(bot, `${label} never left open: handle counts ${JSON.stringify(vc)}`);
        };
        for (let pass = 0; !wheel; pass++) {
        const dbl = TEST_DOUBLE && pass === 0;
        if (VALVE_COUNT) { await turnValve(v1, 'valve 1', dbl); await turnValve(v2, 'valve 2', false); }
        else {
        if (!(await opLocUntil(bot, v1, 1, turnedSince(1), { maxTicks: 40 }))) fail(bot, 'valve 1');
        if (dbl) { console.log(`[elemental] TEST EW_TEST_DOUBLE: valve 1 op'd a second time (old path)`); opLocGo(bot, v1, 1); await bot.until(turnedSince(2), 15); }
        if (!(await opLocUntil(bot, v2, 1, turnedSince(2), { maxTicks: 40 }))) fail(bot, 'valve 2');
        }
        if (process.env.EW_TEST_GATEFLIP === '1' && pass === 0) await opLocUntil(bot, v2, 1, turnedSince(3), { maxTicks: 40 });
        const tv = t, redo = process.env.EW_GATE_REDO !== '0' && pass === 0;
        let reset: boolean;
        if (VALVE_COUNT) { const r = await pullLever(wlever, 'water lever', WATER, dbl); wheel = r === 'on'; reset = r === 'other'; }
        else {
        await opLocUntil(bot, wlever, 1, () => heard(bot, redo ? /water wheel starting up|flow gates resetting/ : /water wheel starting up/, tv), { maxTicks: 40 });
        wheel = heard(bot, /water wheel starting up/, tv); reset = heard(bot, /flow gates resetting/, tv);
        }
        if (!wheel && !(redo && reset)) fail(bot, `water lever (${msgsSinceT().slice(-2).join(' | ')})`);
        if (!wheel) { console.log(`[elemental] water lever reset the gates (pass ${pass}): valves again`); t = bot.tickCount; }
        }
        st.at('water');
        }
        // (A/B: the rock BEFORE the water lever measured 199/195 t vs 191 lever-first: kept lever-first)
        // 6. earth elemental from a rock -> ore
        const rock = locAt(EARTH_ROCK, 2706, 9904, 0);   // the elemental rock nearest the water lever
        const elemental = objId('elemental_workshop_ore');
        const EARTH = npcId('earth_elemental_rock_version');
        if (!R || (!has('elemental_workshop_ore') && !has('elemental_workshop_bar'))) {
        t = bot.tickCount;
        if (!(await opLocUntil(bot, rock, 1, () => !!npc(bot, EARTH) || heard(bot, /Ge'roff my rock/, t), { maxTicks: 60 }))) fail(bot, 'elemental rock');
        if (!(await fight(bot, EARTH, () => !npc(bot, EARTH) || !!bot.findGroundItem(elemental, 6), { maxTicks: 120, label: 'earth' }))) fail(bot, 'earth elemental');
        const g = await bot.until(() => !!bot.findGroundItem(elemental, 8), 6) ? bot.findGroundItem(elemental, 8)! : null;
        if (!g || !(await pickup(bot, elemental, { x: g.x, z: g.z }))) fail(bot, 'elemental ore');
        st.at('ore');
        }
        if (!R || !has('elemental_workshop_bar')) {
        // 5. bellows + air lever (resume: the air bit is not in the journal and the lever toggles: pull until it pumps)
        const bellows = locAt(3410, 2734, 9882, 0), alever = locAt(3409, 2734, 9887, 0);
        t = bot.tickCount;
        if (!R || !js!.bellows) if (!(await opLocUntil(bot, bellows, 1, () => heard(bot, /stitch the leather/, t), { maxTicks: 60 }))) fail(bot, 'bellows');
        if (VALVE_COUNT) { const ta = bot.tickCount; if ((await pullLever(alever, 'air lever', AIR, TEST_DOUBLE)) !== 'on') fail(bot, `air lever (${chatSince(ta).slice(-2).join(' | ')})`); }
        else if (!(await opLocUntil(bot, alever, 1, () => heard(bot, /bellows pump air/, t), { maxTicks: 30 }))) fail(bot, 'air lever');
        st.at('air');
        }
        // 7. lava, furnace (lit, then the ore)
        const trough = locAt(3414, 2714, 9871, 0), furnace = locAt(3413, 2724, 9874, 0);
        // explicit stand tile: the trough is 1x5 at angle 1 (x 2714-2718, z 9871) but the planner's reach test placed us at
        // (2715,9875), 4 tiles off, and the OPLOCU was dropped (loc-scene/rsmod rotation mismatch for this loc)
        if (!R || !has('elemental_workshop_bar')) {
        if (!R || !js!.furnace) {
        if (!has('elemental_workshop_lava_bowl_full')) if (!(await useOnLocUntil(bot, 'elemental_workshop_lava_bowl', trough, () => has('elemental_workshop_lava_bowl_full'), { maxTicks: 60, stand: { x: 2715, z: 9872 } }))) fail(bot, 'lava');
        t = bot.tickCount;
        await useOnLocUntil(bot, 'elemental_workshop_lava_bowl_full', furnace, () => heard(bot, /bursts in to life/, t), { maxTicks: 40, every: 8 });
        // the bowl empties at once, the furnace lights after p_delay(4) (quest_elemental_workshop.rs2:211-220)
        if (!(await bot.until(() => heard(bot, /bursts in to life/, t), 8))) fail(bot, 'furnace lit');
        }
        if (!(await useOnLocUntil(bot, elemental, furnace, () => has('elemental_workshop_bar'), { maxTicks: 30, every: 8 }))) fail(bot, 'elemental bar');
        st.at('bar');
        }
        // 8. workbench
        const bench = locAt(3402, 2722, 9887, 0);
        if (!(await useOnLocUntil(bot, 'elemental_workshop_bar', bench, () => has('elemental_shield'), { maxTicks: 40, every: 8 }))) fail(bot, 'workbench');
        checkAlive(bot);
        st.at('done');
    }, o.log !== false);
}
