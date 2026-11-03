/// <reference types="bun" />
// q-knights-sword.ts — The Knight's Sword (1 QP; smithing +127,250 at x25 ~ level 82), cheat-free. Lane f2p-b.
//
// Content (rev 289; quests/quest_squire/scripts/quest_squire.rs2 = QS, areas/area_falador/scripts/squire.rs2,
// areas/area_port_sarim/scripts/thurgo.rs2, general_use/scripts/cupboards.rs2). %squire stages: started 1, spoken_reldo 2,
// given_pie 3, spoken_thurgo 4, looking_portrait 5, looking_blurite 6 (quest_squire.constant).
//   1. Squire (606; 2977,3342): "And how is life as a squire?" / "I can make a new sword if you like..." / "So would these
//      dwarves make another one?" / "Ok, I'll give it a go." -> started (QS:1-64).
//   2. Reldo (647; Varrock palace) "What do you know about the Imcando dwarves?" -> spoken_reldo (QS:113-123; reldo.rs2:6-9).
//   3. Thurgo (604; 3001,3144): "Would you like a redberry pie?" -> given_pie (QS:125-152); again: "Can you make me a special
//      sword?" path -> spoken_thurgo (QS:154-161).
//   4. Blurite ore: the Asgarnian Ice Dungeon under the cliff (ladder 1759 at 3008,3150 -> 3008,9550; blurite rocks 2110 at
//      3049,9566 / 3059,9564 / 3067,9581-2; mining 10, skill_mining/configs/mine.dbrow:164-173). Not stage-gated: mined on
//      the first Port Sarim visit.
//   5. Squire: status -> looking_portrait (QS:72-77). Sir Vyvin's cupboard 2271/2272 (Falador castle L2 2984,3336): open,
//      search with Vyvin NOT within 1 tile of you -> knights_portrait (cupboards.rs2:18-33, QS:209-217).
//   6. Thurgo: portrait -> looking_blurite (QS:172-183); again with blurite + 2 iron bars -> faladian_sword (QS:188-197).
//   7. Squire: hand the sword over -> queue(squire_complete) (QS:95-101, :219-223).
// TRAVEL: Varrock Teleport (Reldo), glory -> Draynor Village (then walk to Thurgo), Falador Teleport (squire), all optional:
//   each falls back to walking when the runes/charges are missing.
import { SpeedBot, objId } from '../../../core.js';
import { M2, M3, R, locAt, opLocGo, inDialog, nav, npc, tele, type Tile } from '../../q-lib.js';
import { openNpc, converse, chat, go, guard, fail, mkLog, completeCheck, answerUntil, glory, syncLeaves, packStr, setRetaliate, GLORIES, type Item } from './fb-lib.js';
import { mkLogE, climb } from './fk-lib.js';
import { isResuming, journalStage, failHook } from '../journal.js';
/** session 10 resume: the quest JOURNAL (quest_squire/scripts/squire_journal.rs2) -> %squire, first match wins (latest first) */
const KS_STAGES: Array<[RegExp, number]> = [
    [/QUEST COMPLETE/i, 7], [/smithed me a replica|need\s+two\s+Iron Bars/i, 6], [/portrait\s+of Sir Vyvin's father/i, 5],
    [/needs a\s+picture of the sword/i, 4], [/gained his trust through\s+pie/i, 3], [/LOVE\s+redberry pies/i, 2], [/speak to\s+Reldo/i, 1],
];

export const QUEST = { name: "The Knight's Sword", dir: 'quest_squire', qp: 1 };
export const REQUIREMENTS = {
    quests: [] as string[], qp: 0,
    skills: {
        mining: [10, 'blurite rock level 10 (mine.dbrow:170); with a rune pickaxe mining 41 is needed to use it'],
        magic: [37, 'Falador Teleport (Varrock Teleport 25); optional: the code walks without the runes'],
        hitpoints: [10, 'ice warriors/giants on the way to the blurite: auto-retaliate off, never eaten; chaos-proven at hp 40/def 40 (fk13/15/17) AND at hp 10/def 1 (fk22 504 t, fk23 seed 304 492 t); 4 lobsters carried as insurance'],
    } as Record<string, [number, string]>,
    start: { x: 2977, z: 3343, level: 0 },   // the squire, Falador castle courtyard
    end: { x: 2977, z: 3343, level: 0 },
};
export const SUPPLY: Item[] = [
    { name: 'redberry_pie', n: 1 }, { name: 'iron_bar', n: 2 }, { name: 'rune_pickaxe', n: 1 },
    { name: 'amulet_of_glory_4', n: 1 },                    // 2 Draynor hops (Port Sarim visits)
    { name: 'lawrune', n: 3 }, { name: 'airrune', n: 9 }, { name: 'firerune', n: 1 }, { name: 'waterrune', n: 2 },   // Varrock + 2 Falador teleports
    { name: 'lobster', n: 4 },
];

const N = { squire: 606, reldo: 647, thurgo: 604, vyvin: 605 };
const T = { squire: { x: 2977, z: 3342 }, reldo: { x: 3209, z: 3495 }, thurgo: { x: 3001, z: 3144 } };
const LADDER_DOWN = { id: 1759, x: 3008, z: 3150 }, LADDER_UP = { id: 1755, x: 3008, z: 9550 };
const BLURITE = [{ x: 3049, z: 9566 }, { x: 3059, z: 9564 }, { x: 3067, z: 9581 }, { x: 3067, z: 9582 }];
const CUPBOARD = { shut: 2271, open: 2272, x: 2984, z: 3336, level: 2 };
type Res = { ok: boolean; ticks: number; msg: string };

const runes = (bot: SpeedBot, need: Record<string, number>) => Object.entries(need).every(([k, n]) => bot.count(k) >= n);
async function toFalador(bot: SpeedBot, log: ReturnType<typeof mkLog>): Promise<void> {
    if (bot.stat('magic').level >= 37 && runes(bot, { lawrune: 1, airrune: 3, waterrune: 1 }) && Math.max(Math.abs(bot.tile().x - T.squire.x), Math.abs(bot.tile().z - T.squire.z)) > 40) {
        if ((await tele(bot, 'falador_teleport')).ok) { log.split('tele Falador'); return; }
    }
}
async function toThurgo(bot: SpeedBot, log: ReturnType<typeof mkLog>): Promise<void> {
    // F3 (sim exqa1/exqb1, run-route --existing, SR_NO_GLORY=1): with no glory the converse walk from Vyvin's cupboard (castle L2)
    // to Thurgo failed ('thurgo-portrait: walk to (3001,3144) failed' at 2984,3335,L2, both sides). SR_KS_NOGLORY=1 (set only by
    // route/existing.ts) takes glory()'s no-glory hop (noglory.ts: the route planner's spell/walk travel to the Draynor landing)
    // exactly where the route would rub the glory. Unset = unchanged.
    const noGloryHop = process.env.SR_KS_NOGLORY === '1' && process.env.SR_NO_GLORY === '1';
    if (Math.max(Math.abs(bot.tile().x - T.thurgo.x), Math.abs(bot.tile().z - T.thurgo.z)) > 110 && (GLORIES.some(g => bot.count(g) > 0) || noGloryHop)) { await glory(bot, 'draynor'); log.split('tele Draynor'); }
}

/** Sir Vyvin's cupboard (castle L2): open + search with Vyvin not within 1 tile of us (QS:209-217). */
export async function getPortrait(bot: SpeedBot): Promise<void> {
    const has = (k: string) => bot.count(k) > 0;
    if (process.env.FK_STAIRS === 'travel' || bot.minusedlevel === 2) await go(bot, { x: 2985, z: 3335 }, 1, 'castle L2', 600, 2);
    else {
        // own climbs (A/B vs core's multi-level traveller, which walks): stairs 1738 (2954,3338 L0) -> 1722 (2984,3337 L1)
        if (bot.minusedlevel === 0) await climb(bot, { id: 1738, x: 2954, z: 3338, level: 0 }, { x: 2956, z: 3339 }, 'castle L0->L1');
        if (bot.minusedlevel === 1) await climb(bot, { id: 1722, x: 2984, z: 3337, level: 1 }, { x: 2984, z: 3336 }, 'castle L1->L2');
        await go(bot, { x: 2985, z: 3335 }, 1, 'castle L2', 100, 2);
    }
    const shut = locAt(CUPBOARD.shut, CUPBOARD.x, CUPBOARD.z, 2);
    const isOpen = () => bot.liveLocs.get(`2,${CUPBOARD.x},${CUPBOARD.z}`) === CUPBOARD.open;
    const t4 = bot.tickCount; let last = -100;
    // fix 327 (qx101m 'cupboard: no portrait': Vyvin stood within 1 of both stand tiles for the whole 600 t, hp unchanged;
    // the leg retry's glory out + back moved him): blocked 60 t -> stairstop 1723 (2984,3338 L2) down (lands 2984,3336 L1,
    // stairs.rs2:50), stairs 1722 back up, so he wanders off the cupboard; max 2 hops. FK_VYVIN_HOP=0 reverts.
    let blocked = -1, hops = 0;
    while (!has('knights_portrait')) {
        // route runner: Sir Vyvin parked next to both stand tiles for the whole 200 t (sim qrf5m): wait longer
        if (bot.tickCount - t4 > 600) fail(bot, 'cupboard: no portrait');
        if (bot.chatModalId !== -1) { bot.resumeDialogPage(); bot.queueFlush(); }
        else if (bot.tickCount - last >= 4) {
            // Vyvin within 1 tile of US stops the search (QS:209-217): stand on a side of the cupboard 2+ tiles from him
            const v = npc(bot, N.vyvin);
            // the cupboard covers (2984-2985,3336) and is approached from the SOUTH only (forceapproach=east rotated;
            // probe-fk-cup.ts grid: (2985,3336) is blocked, so the old east tile was unreachable and the loop stalled 200 t)
            const stands = [{ x: 2985, z: 3335 }, { x: 2984, z: 3335 }]
                .filter(t => !v || Math.max(Math.abs(t.x - v.x), Math.abs(t.z - v.z)) >= 2);
            const me = bot.tile();
            const here = stands.find(t => t.x === me.x && t.z === me.z);
            if (stands.length) blocked = -1; else if (blocked < 0) blocked = bot.tickCount;
            if (!stands.length && blocked >= 0 && bot.tickCount - blocked >= 60 && hops < 2 && process.env.FK_VYVIN_HOP !== '0') {
                hops++; blocked = -1;
                console.log(`[sword] 327: Vyvin ${v!.x},${v!.z} blocks the cupboard: stairs down + up (hop ${hops})`);
                try {
                    await climb(bot, { id: 1723, x: 2984, z: 3338, level: 2 }, { x: 2984, z: 3337 }, 'castle L2->L1');
                    await bot.tick(6);
                    if (bot.minusedlevel === 1) await climb(bot, { id: 1722, x: 2984, z: 3337, level: 1 }, { x: 2984, z: 3336 }, 'castle L1->L2');
                } catch (e) { console.log(`[sword] 327: hop failed: ${(e as Error).message}`); }
                if (bot.minusedlevel !== 2) await go(bot, { x: 2985, z: 3335 }, 1, 'castle L2', 200, 2).catch(() => undefined);
                last = bot.tickCount; continue;
            }
            if (process.env.FB_DEBUG) console.log(`[cup] me=${JSON.stringify(bot.pos())} v=${v ? v.x + ',' + v.z : '-'} stands=${JSON.stringify(stands)} open=${isOpen()} chat=${bot.chatModalId}`);
            if (!here) { if (stands[0]) await go(bot, stands[0], 0, 'cupboard side', 30, 2).catch(() => undefined); last = bot.tickCount; continue; }
            bot.opLoc(CUPBOARD.x, CUPBOARD.z, isOpen() ? CUPBOARD.open : CUPBOARD.shut, 1); bot.queueFlush();
            last = bot.tickCount;
        }
        await bot.tick(1);
    }
}

export async function run(bot: SpeedBot, o: { log?: boolean } = {}): Promise<Res> {
    await nav();
    bot.holdDialogs = true;
    const log0 = mkLogE(bot, 'sword', o.log !== false);
    const log = { ...log0, split: (k: string) => { log0.split(k); failHook(`knight:${k}`); } } as typeof log0;
    const qp0 = bot.getVarp(101), done = completeCheck(bot, qp0, QUEST.qp);
    // session 11 fix 345 (qx142m 'knight FAILED ... cb 67 | died at 2966,3380': a 10-hp account; an ice warrior (cb 57, str 47 =
    // max hit 6, npc_combat_melee.rs2:2-8) hit it to hp 4 while mining and guard() ate only below 50% (< 5): one more max hit
    // kills). Eat at <= 7 hp (max hit + 1) on a low-hp account; >= 15 hp accounts keep 0.5. FK_EAT_MAXHIT=0 reverts.
    const g = guard(bot, undefined, process.env.FK_EAT_MAXHIT === '0' ? 0.5 : Math.max(0.5, 7.5 / Math.max(1, bot.stat('hitpoints').level)));
    const has = (k: string) => bot.count(k) > 0;
    setRetaliate(bot, false);   // the ice dungeon: never let a hit drag us into a fight on the way to the rock
    try {
        const late = () => has('knights_portrait') || has('faladian_sword');
        const st = { started: false, reldo: false, pie: !has('redberry_pie'), sword: false };
        // session 10: on a retry, the journal stage gates each talk (KS_RESUME=0 = the item checks only, as before)
        let ks = -1;
        if (isResuming(bot) && process.env.KS_RESUME !== '0') {
            if (inDialog(bot)) { bot.closeModal(); bot.queueFlush(); await bot.tick(1); }
            ks = await journalStage(bot, 'squire', KS_STAGES, 0, s => console.log(`[sword] ${s}`));
            console.log(`[sword] resume at stage ${ks} @${JSON.stringify(bot.pos())} pie ${has('redberry_pie')} ore ${has('blurite_ore')} portrait ${has('knights_portrait')} sword ${has('faladian_sword')}`);
            if (ks >= 7) return { ok: true, ticks: bot.tickCount - log.t0, msg: 'journal: quest complete' };
        }
        const RS = ks > 0, at = (n: number) => !RS || ks <= n;
        // ---- 1. squire: start ----
        if (RS && ks <= 3 && !late()) {
            // resume (journal 1-3): only the talks still to do
            if (ks <= 1) {
                if (bot.stat('magic').level >= 25 && runes(bot, { lawrune: 1, airrune: 3, firerune: 1 })) { if ((await tele(bot, 'varrock_teleport')).ok) log.split('tele Varrock'); }
                await chat(bot, N.reldo, T.reldo, [R, M3[2]!, R, R, R, R, R, R, R, R], [/^What do you know about the Imcando dwarves\?$/], 'reldo');
                log.split('reldo');
            }
            await toThurgo(bot, log);
            if (ks <= 2) {
                await converse(bot, N.thurgo, T.thurgo, [M2[1]!, R, R, R, R, R], () => !has('redberry_pie') && !inDialog(bot),
                    [/^Would you like a redberry pie\?$/], 'thurgo-pie', { maxTicks: 30 });
                log.split('thurgo pie');
            }
            await chat(bot, N.thurgo, T.thurgo, [R, R, R, R, R, R], [], 'thurgo-sword', { expect: /ask his squire/ });
            log.split('thurgo sword');
        }
        if (!RS && !late() && has('redberry_pie')) {
            await toFalador(bot, log);
            await chat(bot, N.squire, T.squire, [R, M2[0]!, R, R, M3[1]!, R, R, R, R, M2[0]!, R, R, R, M2[0]!, R, R],
                [/^And how is life as a squire\?$/, /^I can make a new sword if you like\.\.\.$/, /^So would these dwarves make another one\?$/, /^Ok, I'll give it a go\.$/], 'squire1');
            log.split('squire1');
            // ---- 2. Reldo ----
            if (bot.stat('magic').level >= 25 && runes(bot, { lawrune: 1, airrune: 3, firerune: 1 })) { if ((await tele(bot, 'varrock_teleport')).ok) log.split('tele Varrock'); }
            await chat(bot, N.reldo, T.reldo, [R, M3[2]!, R, R, R, R, R, R, R, R], [/^What do you know about the Imcando dwarves\?$/], 'reldo');
            log.split('reldo');
            // ---- 3. Thurgo: pie, then the sword request ----
            await toThurgo(bot, log);
            await converse(bot, N.thurgo, T.thurgo, [M2[1]!, R, R, R, R, R], () => !has('redberry_pie') && !inDialog(bot),
                [/^Would you like a redberry pie\?$/], 'thurgo-pie', { maxTicks: 30 });
            log.split('thurgo pie');
            await chat(bot, N.thurgo, T.thurgo, [R, R, R, R, R, R], [], 'thurgo-sword', { expect: /ask his squire/ });
            log.split('thurgo sword');
        }
        // ---- 4. blurite ----
        if (!has('blurite_ore') && !has('faladian_sword')) {
            if (bot.tile().z < 6400) {
                await go(bot, { x: 3008, z: 3151 }, 1, 'to ice dungeon', 400);
                const l = locAt(LADDER_DOWN.id, LADDER_DOWN.x, LADDER_DOWN.z, 0);
                const t1 = bot.tickCount;
                while (bot.tile().z < 6400) { if (bot.tickCount - t1 > 40) fail(bot, 'ice dungeon ladder'); if ((bot.tickCount - t1) % 5 === 0) opLocGo(bot, l, 1); await bot.tick(1); }
                log.split('dungeon');
            }
            const t2 = bot.tickCount;
            for (let i = 0; !has('blurite_ore'); i++) {
                if (bot.tickCount - t2 > 300) fail(bot, 'blurite: not mined');
                // nearest live rock (a depleted one changes its loc: liveLocs), mine until the ore lands
                const rock = BLURITE.map(r => ({ ...r, l: locAt(2110, r.x, r.z, 0) })).filter(r => bot.locAlive(r.l))
                    .sort((a, b) => Math.max(Math.abs(a.x - bot.tile().x), Math.abs(a.z - bot.tile().z)) - Math.max(Math.abs(b.x - bot.tile().x), Math.abs(b.z - bot.tile().z)))[0];
                if (!rock) { await bot.tick(1); continue; }
                const far = Math.max(Math.abs(rock.x - bot.tile().x), Math.abs(rock.z - bot.tile().z)) > 8;
                if (far) await go(bot, { x: rock.x - 1, z: rock.z }, 2, 'to blurite', 200).catch(() => undefined);
                opLocGo(bot, rock.l, 1);
                await bot.until(() => has('blurite_ore') || !bot.locAlive(rock.l), 12);
            }
            log.split('blurite');
            // session 11 fix 345b (qx142m: '[eat knight] lobster NOT eaten (hp 4)' then hp 0 on the Falador tile, 4 t after the
            // blurite): Falador Teleport is p_delay(1)+p_delay(0) (teleport.rs2:59-64). An eat sent then is dropped, and hits queued
            // meanwhile (queue(combat_damage_player), npc_combat_melee.rs2:47) land after the jump. So top up BEFORE casting while one
            // max hit (6) could kill. FK_PRETELE_EAT=0 reverts; FK_PRETELE_TEST=1 eats here at any hp (proves the path).
            if (process.env.FK_PRETELE_EAT !== '0' && bot.stat('hitpoints').cur > 0 && (bot.stat('hitpoints').cur <= 7 || process.env.FK_PRETELE_TEST === '1')) {
                const f = ['lobster', 'shark', 'swordfish', 'tuna', 'salmon', 'trout', 'bread', 'cake'].find(has);
                if (f) { const n0 = bot.count(f), hp0 = bot.stat('hitpoints').cur; bot.opHeld1(objId(f), bot.slot(objId(f))); bot.queueFlush(); await bot.until(() => bot.count(f) < n0, 3); console.log(`[sword] pre-tele eat ${f} hp ${hp0} -> ${bot.stat('hitpoints').cur} (fix 345)`); }
            }
            // A/B: Falador Teleport straight out of the dungeon (fk2: walking back to the ladder = 53 t)
            await toFalador(bot, log);
        }
        if (bot.tile().z > 6400) {
            const up = locAt(LADDER_UP.id, LADDER_UP.x, LADDER_UP.z, 0);
            await go(bot, { x: 3008, z: 9551 }, 2, 'to ladder', 300).catch(() => undefined);
            const t3 = bot.tickCount;
            while (bot.tile().z > 6400) { if (bot.tickCount - t3 > 60) fail(bot, 'ice dungeon ladder up'); if ((bot.tickCount - t3) % 5 === 0) opLocGo(bot, up, 1); await bot.tick(1); }
            log.split('out of dungeon');
        }
        // ---- 5. squire (portrait permission) + Vyvin's cupboard ----
        if (!late()) {
            await toFalador(bot, log);
            if (at(4)) {
            await chat(bot, N.squire, T.squire, [R, R, R, R, R], [], 'squire2', { expect: /small portrait|portrait of Sir/ });
            log.split('squire2');
            }
            await getPortrait(bot);
            await answerUntil(bot, () => !inDialog(bot), [], 10);
            log.split('portrait');
            // no walk down: the glory works from castle L2 (fk2: the walk down wedged 330 t on an L1 door)
        }
        // ---- 6. Thurgo: portrait, then blurite + 2 iron bars -> sword ----
        if (!has('faladian_sword')) {
            await toThurgo(bot, log);
            if (at(5)) {
            await converse(bot, N.thurgo, T.thurgo, [R, R, R, R, R, R, R, R, R], () => !has('knights_portrait') && !inDialog(bot), [], 'thurgo-portrait', { maxTicks: 30 });
            log.split('thurgo portrait');
            }
            await converse(bot, N.thurgo, T.thurgo, [R, R, R, R, R, R], () => has('faladian_sword') && !inDialog(bot), [], 'thurgo-make', { maxTicks: 30 });
            log.split('sword made');
        }
        // ---- 7. squire: complete ----
        await toFalador(bot, log);
        await openNpc(bot, N.squire, T.squire, 'squire3', { done: () => inDialog(bot) || done() });
        const t5 = bot.tickCount;
        while (!done()) { if (bot.tickCount - t5 > 60) fail(bot, 'squire: no completion'); if (bot.chatModalId !== -1) { bot.resumeDialogPage(); bot.queueFlush(); } await bot.tick(1); }
        log.split('complete');
        void st; void syncLeaves;
        return { ok: true, ticks: bot.tickCount - log.t0, msg: JSON.stringify(log.splits) };
    } catch (e) {
        return { ok: false, ticks: bot.tickCount - log.t0, msg: `${(e as Error).message} | pack ${packStr(bot)}` };
    } finally { g.stop = true; bot.holdDialogs = false; setRetaliate(bot, true); }
}
export { objId };
