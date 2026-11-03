// q-horror.ts — Horror from the Deep (2 QP). CHEAT-FREE. Content: server/content/scripts/quests/quest_horror/scripts/*.rs2
// (paths below are relative to that dir unless noted), area_barbarian_outpost/scripts/gunnjorn.rs2,
// skill_agility/scripts/barbarian_course.rs2, skill_combat/scripts/npc/npc_combat.rs2.
//
// Varbits (quest_horror.varbit, base %deephorror): horrorquest bits 0-10 (1 started, 2 entered, 4 repaired, 5 dagjr, 10 done),
// bridgeleft 12, bridgeright 13, agilitykey 14, lighthouseentrance 15, door items 16-21, tar 22, glass 23, light 24.
// Flow (this file's segments, in order):
//   gate     the outpost gate (Barcrawl complete: outpost_gate.rs2:2 lets you through) -> inside.
//   basaltN  the basalt rocks to the lighthouse causeway: jumping spots 1,3,5,7,9 (basalt_rocks.rs2:1-59; a slip on spots 3/7
//            = stat_random(agility,5,255) sweeps you back to shore, 1-10 damage).
//   start    Larrissa (horror_girlfriend_prequest 1336 @ 2508,3635), horror_girlfriend.rs2:49-93: "With what?" / "But how can
//            I help?" / "Okay, I'll help!" -> horrorquest = started.
//   basaltS  spots 10,8,6,4,2 back to the outpost.
//   key      Gunnjorn (607) stands inside the Barbarian agility course (enclosed pen ~2537-2542,3544-3549): obstacle pipe
//            (agility 35, barbarian_course.rs2:125-147) -> rope swing -> talk (gunnjorn.rs2:14-27, needs horrorquest > 0) ->
//            net -> ledge -> ladder -> 3 crumbling walls (west -> east) back out.
//   bridge   planks (woodplank) + 4 nails each + hammer on the broken bridge spots 4615 (2596,3608) / 4616 (2598,3608)
//            (quest_horror.rs2:110-166); op1 on a spot jumps the gap (quest_horror.rs2:66-108).
//   door     lighthouse doorway 4577 (2509,3636): op1 with the key unlocks it (:42-47), op1 again with both bridge halves
//            enters (:22-37, teleports into the m38_71 copy, (2445,4597)).
//   light    spiral stairs to L2, use swamp tar, tinderbox, molten glass on the lighting mechanism 4588 (2443,4599) (:245-288)
//            -> horrorquest = repaired, you are moved to the real lighthouse top (2507,3639).
//   cave     spiral stairs top -> m38_71 L1 -> down -> ladder 4380 -> cave L1 (2518,4618) (:168-179); the strange wall: use
//            1 each fire/water/earth/air rune, a stab/slash weapon and an arrow on the mid door (:332-432); far right door
//            (:308-321); ladder 4485 down to Jossik (2518,4633).
//   fight    Jossik (horror_lighthousekeeper.rs2:9-19) -> Dagannoth jr (melee) -> the mother (horror_dagannoth.rs2:228-256):
//            cycles air -> water -> melee -> earth -> fire -> ranged every 30 t (npc timer=30, :113-214); only the matching
//            style damages her (npc_combat.rs2:401-437). Protect from Missiles turns her to melee (:64-76).
//   reward   quest_horror_complete (:485-497): 2 QP, casket, magic/strength/ranged xp.
import { SpeedBot, objId, objDebugName, cheb, spellCom } from '../../../core.js';
import { npc, npcsOf, inDialog, sendToks, locAt, opLocGo, opNpcGo, useOnLocGo, dismiss, qp, R, M2, M3, type FTok, type Tile } from '../../q-lib.js';
import { Ctx, QuestFail, go, walk, converse, sawMsg, dead, eatIfLow, nav, packStr, obstacle, locAny, talkTo, type Item } from './lib-troll.js';
import { isResuming, readJournal, failHook } from '../journal.js';

export const QUEST = { name: 'Horror from the Deep', dir: 'quest_horror', qp: 2 };
export const REQUIREMENTS = {
    quests: ["Alfred Grimhand's Barcrawl"] as string[],   // the outpost gate (outpost_gate.rs2:2) leads to the basalt rocks and Gunnjorn
    qp: 0,
    skills: {
        agility: [35, 'the Barbarian course pipe to reach Gunnjorn (barbarian_course.rs2:126); basalt/ledge/log slips cost time only'],
        prayer: [40, 'Protect from Missiles in the mother fight (her ranged volley rolls 12 twice, horror_dagannoth.rs2:76-109)'],
        magic: [75, 'Fire Wave (and wind/water/earth waves) for the mother\'s elemental forms (npc_combat.rs2:401-425)'],
    } as Record<string, [number, string]>,
    start: { x: 2546, z: 3569, level: 0 },   // outside the Barbarian Outpost gate (where the Barcrawl ends)
    end: { x: 2515, z: 10001, level: 1 },    // quest_horror_complete teleports to 1_39_156_19_17
};
const WAVES = { air: 'wind_wave', water: 'water_wave', earth: 'earth_wave', fire: 'fire_wave' } as const;
/** quest inputs + the strange wall's items + fight supplies. Waves (magic_combat_spells.dbrow): wind 1 blood + 5 air, water/earth/
 *  fire 1 blood + 7 element + 5 air. Mother: up to 7 casts per element (6 per 30-tick form); the Dagannoth (120 hp): 16 Fire
 *  Waves (sim: ~7.7 damage per cast). Door: 1 each of fire/water/earth/air, a stab/slash weapon, an arrow. */
export const SUPPLY: Item[] = [
    { name: 'woodplank', n: 2 }, { name: 'nails', n: 8 }, { name: 'hammer', n: 1 }, { name: 'swamp_tar', n: 1 },
    { name: 'molten_glass', n: 1 }, { name: 'tinderbox', n: 1 }, { name: 'bronze_dagger', n: 1 }, { name: 'bronze_arrow', n: 1 },
    { name: 'bloodrune', n: 44 }, { name: 'airrune', n: 221 }, { name: 'waterrune', n: 50 }, { name: 'earthrune', n: 50 }, { name: 'firerune', n: 162 },
    { name: 'shark', n: 8 }, { name: '4doseprayerrestore', n: 1 },
];

const GATE = { id: 2116, x: 2545, z: 3569 };
// basalt jumping spots (loc id, coord, the coord you land on): basalt_rocks.rs2:1-10 (final_dest)
type Spot = { id: number; x: number; z: number; land: Tile };
const SPOTS_N: Spot[] = [
    { id: 4550, x: 2522, z: 3595, land: { x: 2522, z: 3598 } }, { id: 4552, x: 2522, z: 3600, land: { x: 2522, z: 3603 } },
    { id: 4554, x: 2518, z: 3611, land: { x: 2515, z: 3611 } }, { id: 4556, x: 2514, z: 3613, land: { x: 2514, z: 3616 } },
    { id: 4558, x: 2514, z: 3617, land: { x: 2514, z: 3620 } },
];
const SPOTS_S: Spot[] = [
    { id: 4559, x: 2514, z: 3619, land: { x: 2514, z: 3616 } }, { id: 4557, x: 2514, z: 3615, land: { x: 2514, z: 3612 } },
    { id: 4555, x: 2516, z: 3611, land: { x: 2518, z: 3610 } }, { id: 4553, x: 2522, z: 3602, land: { x: 2522, z: 3599 } },
    { id: 4551, x: 2522, z: 3597, land: { x: 2522, z: 3594 } },
];
const LARRISSA = 1336, GUNNJORN = 607, JOSSIK = 1335;
const JR = [1344, 1345, 1346, 1347];
const MOTHER: Record<number, 'air' | 'water' | 'earth' | 'fire' | 'melee' | 'ranged' | 'spawn'> = {
    1348: 'spawn', 1349: 'spawn', 1350: 'spawn', 1351: 'air', 1352: 'water', 1353: 'fire', 1354: 'earth', 1355: 'ranged', 1356: 'melee',
};
const MOTHER_IDS = Object.keys(MOTHER).map(Number);

export interface HorrorOpts { log?: boolean; from?: string; to?: string; spells?: 'wave' | 'blast'; jr?: 'magic' | 'melee' }
export const STAGES = ['gate', 'basaltN', 'start', 'basaltS', 'key', 'basaltN2', 'bridge', 'door', 'light', 'cave', 'fight'] as const;

type Stage = typeof STAGES[number];
const inCopy = (b: SpeedBot) => b.tile().z > 4500 && b.tile().x < 2500;                                   // the m38_71 lighthouse copy
const inCaveJossik = (b: SpeedBot) => { const t = b.tile(); return t.z > 4500 && t.x > 2500 && b.minusedlevel === 0; };
const inCaveL1 = (b: SpeedBot) => { const t = b.tile(); return t.z > 4500 && t.x > 2500 && b.minusedlevel === 1; };
/** north of the basalt rocks (Larrissa, the lighthouse door, the bridge to Rellekka) */
const lighthouseSide = (b: SpeedBot) => { const t = b.tile(); return t.z >= 3595 && t.z < 4000 && t.x >= 2490 && t.x <= 2620; };
/** session 10 resume: the quest JOURNAL (quest_horror/scripts/horror_journal.rs2) + where we stand -> the stages still to run.
 *  undefined = from the top (not started / unreadable). */
async function journalPlan(bot: SpeedBot): Promise<Stage[] | 'done' | undefined> {
    const j = await readJournal(bot, 'horror');
    const t = j.text;
    const stage = !j.ok ? 'unreadable' : /QUEST COMPLETE/i.test(t) ? 'done' : /defeat these sea monsters/i.test(t) ? 'dagjr'
        : /search this place/i.test(t) ? 'repaired' : /fixing\s+the\s+lighthouse\s+lamp|fixed the lighthouse lens|re-tarred|relit the lighthouse torch/i.test(t) ? 'entered'
        : /Larrissa is very worried/i.test(t) ? 'started' : 'none';
    const key = /use the key I got from Gunnjorn/i.test(t);
    const bi = j.lines.findIndex(l => /repair the bridge/i.test(l));
    // done = the struck version, which has no @dre@ highlight (j.struck misses a '@str@@bla@' carried-colour prefix, seen on cog)
    const bridge = bi >= 0 && (j.struck[bi]! || !/@dre@/i.test(j.raw[bi] ?? ''));
    const side = lighthouseSide(bot) ? 'L' : 'O';
    console.log(`[horror] [journal] horror: ${j.ok ? `stage ${stage} key ${key} bridge ${bridge} side ${side} | open '${j.open.slice(0, 160)}'` : 'UNREADABLE'} (${j.ticks} t) @${JSON.stringify(bot.pos())}`);
    const toLight: Stage[] = side === 'O' && !(bot.tile().z > 4000) ? ['gate', 'basaltN2'] : [];
    switch (stage) {
        case 'done': return 'done';
        case 'dagjr': case 'repaired':
            if (inCaveJossik(bot)) return ['fight'];
            if (inCaveL1(bot) || inCopy(bot) || (bot.minusedlevel === 2 && bot.tile().z < 4000)) return ['cave', 'fight'];
            return [...toLight, 'door', 'cave', 'fight'];
        case 'entered':
            if (inCopy(bot)) return ['light', 'cave', 'fight'];
            return [...toLight, 'door', 'light', 'cave', 'fight'];
        case 'started':
            if (!key) return [...(side === 'L' ? ['basaltS' as Stage] : []), 'key', 'basaltN2', ...(bridge ? [] : ['bridge' as Stage]), 'door', 'light', 'cave', 'fight'];
            return [...toLight, ...(bridge ? [] : ['bridge' as Stage]), 'door', 'light', 'cave', 'fight'];
        default: return undefined;
    }
}

export async function run(bot: SpeedBot, o: HorrorOpts = {}): Promise<{ ok: boolean; ticks: number; msg: string }> {
    const c = new Ctx(bot, 'horror', o);
    await nav();
    bot.holdDialogs = true;
    const qp0 = qp(bot);
    try {
        const from = STAGES.indexOf((o.from ?? 'gate') as typeof STAGES[number]);
        if (from < 0) c.fail(`unknown stage ${o.from}`);
        // session 10: on a retry (route runner: plain std(), no `from`), the stages the journal + position leave (HORROR_RESUME=0 reverts)
        let plan: Stage[] = STAGES.slice(from);
        if (!o.from && isResuming(bot) && process.env.HORROR_RESUME !== '0') {
            if (inDialog(bot)) { dismiss(bot); await bot.tick(1); }
            const jp = await journalPlan(bot);
            if (jp === 'done') return { ok: true, ticks: c.t, msg: 'journal: quest complete' };
            if (jp) { plan = jp; console.log(`[horror] resume plan ${plan.join(',')}`); }
        }
        for (const st of plan) {
            if (dead(bot)) c.fail('died');
            await STEP[st](c, o);
            c.mark(st); failHook(`horror:${st}`);
            if (st === o.to) return { ok: false, ticks: c.t, msg: `stopped after ${st} (probe); marks ${JSON.stringify(c.marks)}` };
        }
        const done = () => bot.count('horror_casket') > 0 || qp(bot) >= qp0 + QUEST.qp;
        if (!(await bot.until(done, 20))) c.fail(`no completion observable (qp ${qp0} -> ${qp(bot)}, pack ${packStr(bot)})`);
        return { ok: true, ticks: c.t, msg: `qp ${qp0} -> ${qp(bot)}, casket ${bot.count('horror_casket')}; marks ${JSON.stringify(c.marks)}` };
    } catch (e) {
        if (!(e instanceof QuestFail)) throw e;
        return { ok: false, ticks: c.t, msg: e.message };
    }
}

const STEP: Record<typeof STAGES[number], (c: Ctx, o: HorrorOpts) => Promise<void>> = {
    gate: async c => {
        const bot = c.bot, inside = () => bot.tile().x <= 2545 && bot.tile().z > 3540;
        const gate = locAt(GATE.id, GATE.x, GATE.z, 0);
        for (let k = 0; k < 4 && !inside(); k++) {
            await walk(bot, { x: 2546, z: 3569 }, () => { opLocGo(bot, gate, 1); }, inside, { near: 0, maxTicks: k ? 20 : 600 });
            if (inDialog(bot)) { await converse(bot, () => !inDialog(bot), [], 10); }   // only before the Barcrawl is complete
        }
        if (!inside()) c.fail('outpost gate (Barcrawl complete?)');
    },
    basaltN: c => basalt(c, SPOTS_N, 'N'),
    basaltS: c => basalt(c, SPOTS_S, 'S'),
    basaltN2: c => basalt(c, SPOTS_N, 'N2'),
    start: async c => {
        const bot = c.bot;
        const started = () => [...bot.ifText.values()].some(v => /THANK YOU SO MUCH/.test(v)) || bot.dialogOptions().some(x => /^Where is your cousin\?$/.test(x.text));
        // chatplayer | chatnpc | multi2 "With what?" | 7 pages | multi2 "But how can I help?" | 4 pages | multi2 "Okay, I'll help!"
        // -> started | chatplayer | chatnpc (horror_girlfriend.rs2:49-93)
        const plan: FTok[] = [R, R, M2[0]!, R, R, R, R, R, R, R, M2[0]!, R, R, R, R, M2[0]!, R, R];
        await talkTo(c, LARRISSA, { x: 2508, z: 3634 }, plan, [/^With what\?$/, /^But how can I help\?$/, /^Okay, I'll help!$/], started, 'larrissa');
        dismiss(bot);
    },
    key: async c => {
        const bot = c.bot, KEY = 'horror_key';
        // out through the gate (the pipe is east of the outpost wall), pipe (from the north), rope swing, Gunnjorn, net, ledge,
        // ladder, 3 crumbling walls (they end inside the outpost again)
        if (bot.tile().x <= 2545 && bot.tile().z >= 3555) await obstacle(c, GATE, { x: 2545, z: 3569 }, () => bot.tile().x >= 2546, 'gate (out)');   // the gate wall is on the EAST edge of (2545,3569)
        await obstacle(c, { id: 2287, x: 2552, z: 3559 }, { x: 2552, z: 3561 }, () => bot.tile().z <= 3558 && bot.tile().z > 3540, 'pipe');
        // the planner walks from the pipe's south end to Gunnjorn's pen past the rope-swing pit (x 2553): no swing, log, net,
        // ledge or walls needed (sim: talk, then straight back to the pipe). Fallback: the rope swing.
        await bot.until(() => npc(bot, GUNNJORN) !== null, 5);
        // chatnpc | chatplayer | chatnpc | chatplayer | chatnpc | chatplayer | (key) chatnpc   (gunnjorn.rs2:1-27)
        await talkTo(c, GUNNJORN, { x: 2545, z: 3550 }, [R, R, R, R, R, R, R], [], () => bot.count(KEY) > 0, 'gunnjorn');
        dismiss(bot);
        // back: pipe from the south (start (2552,3558), barbarian_course.rs2:133-136) -> (2552,3561), then the gate in
        await obstacle(c, { id: 2287, x: 2552, z: 3559 }, { x: 2552, z: 3558 }, () => bot.tile().z >= 3561, 'pipe back');
        await obstacle(c, GATE, { x: 2546, z: 3569 }, () => bot.tile().x <= 2545, 'gate (in)');
    },
    bridge: async c => {
        const bot = c.bot, L = { id: 4615, x: 2596, z: 3608 }, Rt = { id: 4616, x: 2598, z: 3608 };
        const plank = () => bot.count('woodplank');
        await go(c, { x: 2595, z: 3608 }, 'bridge west', { near: 0 });
        const p0 = plank();
        for (let k = 0; k < 3 && plank() === p0; k++) { useOnLocGo(bot, 'woodplank', locAny(L.id, L.x, L.z, 1), { x: 2595, z: 3608 }); await bot.until(() => plank() < p0, 6); }
        if (plank() === p0) c.fail('left bridge plank');
        dismiss(bot); await bot.tick(1);
        // jump the half-fixed gap east (agility roll; a slip still lands you 2 tiles east)
        for (let k = 0; k < 3 && bot.tile().x < 2598; k++) { opLocGo(bot, locAny(L.id, L.x, L.z, 1), 1); await bot.until(() => bot.tile().x >= 2598, 10); }
        if (bot.tile().x < 2598) c.fail('bridge jump east');
        await bot.until(() => bot.tile().x >= 2599, 3);
        const p1 = plank();
        for (let k = 0; k < 3 && plank() === p1; k++) { useOnLocGo(bot, 'woodplank', locAny(Rt.id, Rt.x, Rt.z, 1), { x: 2599, z: 3608 }); await bot.until(() => plank() < p1, 6); }
        if (plank() === p1) c.fail('right bridge plank');
        dismiss(bot); await bot.tick(1);
        for (let k = 0; k < 3 && bot.tile().x > 2595; k++) { opLocGo(bot, locAny(Rt.id, Rt.x, Rt.z, 1), 1); await bot.until(() => bot.tile().x <= 2595, 10); }
        if (bot.tile().x > 2595) c.fail('bridge walk west');
    },
    door: async c => {
        const bot = c.bot, door = locAt(4577, 2509, 3636, 0), inside = () => bot.tile().z > 4500;
        for (let k = 0; k < 5 && !inside(); k++) {
            await walk(bot, { x: 2509, z: 3635 }, () => { opLocGo(bot, door, 1); }, inside, { near: 0, maxTicks: k ? 12 : 600 });
            await bot.until(inside, 4);
        }
        if (!inside()) c.fail(`lighthouse door (key ${bot.count('horror_key')})`);
    },
    light: async c => {
        const bot = c.bot;
        // (a resume may already stand upstairs: each flight only from below)
        if (bot.minusedlevel < 1) await obstacle(c, { id: 4568, x: 2442, z: 4600 }, null, () => bot.minusedlevel === 1, 'stairs L0->L1');
        if (bot.minusedlevel < 2) await obstacle(c, { id: 4569, x: 2442, z: 4600, level: 1 }, null, () => bot.minusedlevel === 2, 'stairs L1->L2', 2);
        const cog = locAt(4588, 2443, 4599, 2);
        const repaired = () => bot.tile().z < 4000;
        for (const it of ['swamp_tar', 'tinderbox', 'molten_glass']) {
            if (repaired()) break;
            const before = bot.count('swamp_tar') + bot.count('molten_glass');
            const since = bot.tickCount;
            for (let k = 0; k < 3; k++) {
                useOnLocGo(bot, it, cog);
                const ok = await bot.until(() => repaired() || (it === 'tinderbox' ? sawMsg(bot, /You light the torch|already lit/, since) : bot.count('swamp_tar') + bot.count('molten_glass') < before), 8);
                if (ok) break;
            }
        }
        if (!(await bot.until(repaired, 4))) c.fail('lighting mechanism not repaired');
    },
    cave: async c => {
        const bot = c.bot;
        // real lighthouse top -> spiral stairs top -> the m38_71 copy L1 -> climb down -> ladder -> cave L1 (2518,4618)
        await obstacle(c, { id: 4570, x: 2506, z: 3641, level: 2 }, null, () => bot.tile().z > 4500, 'stairs top');
        if (bot.minusedlevel === 1 && bot.tile().x < 2500) await obstacle(c, { id: 4569, x: 2442, z: 4600, level: 1 }, null, () => bot.minusedlevel === 0, 'stairs L1->L0', 3);
        await obstacle(c, { id: 4383, x: 2445, z: 4604 }, null, () => bot.minusedlevel === 1 && bot.tile().x > 2500, 'ladder to the cave');   // horror_ladder_top (op1 Climb); 4380 has no op
        // (resume: already through the far right door -> straight to the ladder)
        if (!(bot.tile().z >= 4627 && bot.tile().x > 2500)) {
        // the strange wall: one of each element rune, a stab/slash weapon and an arrow into the mid door (from the south)
        await go(c, { x: 2514, z: 4626 }, 'mid door', { near: 0, level: 1 });
        const door = locAt(4543, 2514, 4627, 1);
        for (const it of ['firerune', 'waterrune', 'earthrune', 'airrune', 'bronze_dagger', 'bronze_arrow']) {
            const n0 = bot.count(it);
            // (resume: a slot filled by the failed attempt answers "There is no space to put ..." (quest_horror.rs2:347-424))
            const since = bot.tickCount, full = () => sawMsg(bot, /There is no space to put/, since);
            if (n0 === 0) c.fail(`no ${it} for the strange wall`);
            for (let k = 0; k < 3 && bot.count(it) === n0 && !full(); k++) {
                useOnLocGo(bot, it, door, { x: 2514, z: 4626 });
                if (await bot.until(() => inDialog(bot) || full(), 4)) { if (!full()) sendToks(bot, [R, M2[0]!]); }   // chatplayer | p_choice2_header Yes
                if (!full()) await converse(bot, () => bot.count(it) < n0 || full(), [/^Yes$/], 6);
            }
            if (bot.count(it) === n0 && !full()) c.fail(`strange wall refused ${it}`);
            dismiss(bot);
        }
        await obstacle(c, { id: 4545, x: 2516, z: 4627, level: 1 }, { x: 2516, z: 4626 }, () => bot.tile().z >= 4627, 'far right door');
        }
        await obstacle(c, { id: 4485, x: 2515, z: 4630, level: 1 }, null, () => bot.minusedlevel === 0, 'ladder to Jossik');
    },
    fight: async (c, o) => fight(c, o),
};

/** Basalt rocks: op each jumping spot until we stand on its landing tile; a slip sweeps us back, so redo from the first
 *  spot we are not yet past. */
async function basalt(c: Ctx, spots: Spot[], dir: string): Promise<void> {
    const bot = c.bot;
    const north = dir !== 'S';
    const past = (s: Spot) => north ? bot.tile().z >= s.land.z : bot.tile().z <= s.land.z;
    const end = bot.tickCount + 400;
    let lastSend = -99, lastPos = '', still = 0, since = bot.tickCount;
    while (bot.tickCount < end) {
        const next = spots.find(s => !past(s));
        if (!next) return;
        const p = `${bot.tile().x},${bot.tile().z}`;
        still = p === lastPos ? still + 1 : 0; lastPos = p;
        if (sawMsg(bot, /tide sweeps you back/, since)) { c.log(`basalt ${dir}: slipped before spot ${next.id}`); since = bot.tickCount; }
        // an OPLOC sent while the last jump's exactmove/forcemove still runs is dropped (the player is delayed): re-send as soon
        // as we have stood still for a tick, at most every 2 ticks (sim: a fixed 14-tick wait cost ~15 t per spot)
        if (still >= 1 && bot.tickCount - lastSend >= 2) { opLocGo(bot, locAny(next.id, next.x, next.z, 1), 1); lastSend = bot.tickCount; }
        eatIfLow(bot);
        await bot.tick(1);
    }
    if (spots.some(s => !past(s))) c.fail(`basalt ${dir}`);
}

// ---------------------------------------------------------------------------------------------------------------------
// the fight: Jossik -> Dagannoth jr (melee) -> the mother (style by form)
// ---------------------------------------------------------------------------------------------------------------------
function pray(bot: SpeedBot, name: string, on: boolean): void {
    if (bot.isPrayerActive(name) === on) return;
    if (on) bot.activatePrayer(name); else bot.deactivatePrayer(name);
    bot.queueFlush();
}
function topUpPrayer(bot: SpeedBot, below = 15): void {
    if (bot.stat('prayer').cur >= below) return;
    const pp = bot.inv().filter(x => /^[1234]doseprayerrestore$/.test(objDebugName(x.obj))).sort((a, b) => objDebugName(a.obj).localeCompare(objDebugName(b.obj)))[0];
    if (pp) { bot.opHeld1(pp.obj, pp.slot); bot.queueFlush(); }
}

async function fight(c: Ctx, o: HorrorOpts): Promise<void> {
    const bot = c.bot;
    const tier = o.spells ?? 'wave';
    const spell = (el: 'air' | 'water' | 'earth' | 'fire') => spellCom(tier === 'wave' ? WAVES[el] : `${el === 'air' ? 'wind' : el}_blast`);
    // 1. Jossik: chatnpcnoturn | chatplayer | 4x chatnpcnoturn | 2x chatplayer -> queue(dagannoth_jr_attack) | chatnpcnoturn
    const jrSeen = () => npcsOf(bot, JR).length > 0;
    const motherUp = () => npcsOf(bot, MOTHER_IDS).length > 0;
    // (resume at defeated_dagjr: the same talk spawns the mother instead, horror_lighthousekeeper.rs2:3-8)
    await talkTo(c, JOSSIK, { x: 2517, z: 4632 }, [R, R, R, R, R, R, R, R, R], [], () => jrSeen() || motherUp(), 'jossik');
    c.mark('jr-spawned');
    // 2. the Dagannoth (horror_dagannoth_jr4: 120 hp, defence 81, no defence bonuses; quest_horror.npc): o.jr = 'magic'
    //    (Fire Wave: magic defence 0, any spell damages it, npc_combat.rs2:438) or 'melee'
    let lastAtk = -99;
    let end1 = bot.tickCount + 300;
    let jrMagic = (o.jr ?? 'magic') === 'magic';
    // session 11 fix 402 (qx423m STOP x2: the jr outlived all 23 Fire Waves the 164 fire runes buy (~1/420), then every cast was
    // REFUSED until end1, and the in-place retry did the same): once a wave can't be paid for, melee the jr (rune_scimitar worn)
    // with a fresh 240 t window. HQ_HORROR_JR_FB=0 reverts; TEST: HQ_HORROR_TEST_JRCASTS=N acts as if out of runes after N casts.
    const fb402 = process.env.HQ_HORROR_JR_FB !== '0';
    const test402 = Number(process.env.HQ_HORROR_TEST_JRCASTS ?? -1);
    let jrCasts = 0;
    const canWave = () => (tier === 'wave'
        ? bot.count('firerune') >= 7 && bot.count('airrune') >= 5 && bot.count('bloodrune') >= 1
        : bot.count('firerune') >= 5 && bot.count('airrune') >= 4 && bot.count('deathrune') >= 1) && !(test402 >= 0 && jrCasts >= test402);
    let jrXp = -1;
    while (!motherUp() && bot.tickCount < end1) {
        if (dead(bot)) c.fail('died (jr)');
        eatIfLow(bot);
        if (bot.stat('prayer').cur > 0) pray(bot, 'protectfrommissiles', true);   // its ranged attack (horror_dagannoth.rs2:258-268)
        if (inDialog(bot)) { bot.resumeDialogPage(); bot.queueFlush(); }
        if (fb402 && jrMagic && !canWave()) {   // session 11 fix 402 (out of wave runes -> melee)
            jrMagic = false; end1 = Math.max(end1, bot.tickCount + 240);
            c.log(`jr: no runes for a wave after ${jrCasts} casts (fire ${bot.count('firerune')}, blood ${bot.count('bloodrune')}) -> melee (fix 402)`);
        }
        const j = npcsOf(bot, [1347])[0];
        // magic: re-cast the tick after each cast lands (magic xp), else every 6 ticks (q-magearena.ts pattern: re-sending
        // OPNPCT every 2 ticks never let a cast through, sim)
        const mxp = bot.stat('magic').xp;
        if (j && (jrMagic ? (mxp !== jrXp || bot.tickCount - lastAtk >= 6) : bot.tickCount - lastAtk >= 4)) {
            if (jrMagic) { bot.opNpcT(j.idx, spell('fire')); jrCasts++; } else bot.opNpc(j.idx, 2);   // session 11 fix 402 (count casts)
            if (process.env.QTRACE === '1') c.log(`jr: send (xp ${mxp !== jrXp ? 'changed' : 'same'}) jr ${j.x},${j.z} d${j.d} hp ${(bot.npcs[j.idx] as any)?.hpCur}/${(bot.npcs[j.idx] as any)?.hpMax} me ${JSON.stringify(bot.tile())}`);
            bot.queueFlush(); lastAtk = bot.tickCount; jrXp = mxp;
        }
        await bot.tick(1);
    }
    if (!motherUp()) c.fail('the mother never appeared (jr not killed?)');
    c.mark('mother-spawned');
    // 3. the mother: Protect from Missiles (she then melees, max ~9), the matching style per form
    const end2 = bot.tickCount + 900;
    let lastForm = '', lastSend = -99, sendXp = -1, xp0 = bot.stat('magic').xp + bot.stat('attack').xp + bot.stat('strength').xp + bot.stat('defence').xp, casts = 0;
    const done = () => bot.count('horror_casket') > 0 || bot.tile().z > 9000;
    while (!done() && bot.tickCount < end2) {
        if (dead(bot)) c.fail('died (mother)');
        eatIfLow(bot);
        topUpPrayer(bot);
        if (bot.stat('prayer').cur > 0) pray(bot, 'protectfrommissiles', true);
        if (inDialog(bot)) { bot.resumeDialogPage(); bot.queueFlush(); }
        const m = npcsOf(bot, MOTHER_IDS)[0];
        const form = m ? MOTHER[m.type]! : '';
        const xp = bot.stat('magic').xp + bot.stat('attack').xp + bot.stat('strength').xp + bot.stat('defence').xp;
        if (xp !== xp0) { casts++; xp0 = xp; }
        const mxp = bot.stat('magic').xp;
        if (m && form !== 'spawn' && form !== 'ranged' && (form !== lastForm || (form === 'melee' ? bot.tickCount - lastSend >= 4 : mxp !== sendXp || bot.tickCount - lastSend >= 6))) {
            sendXp = mxp;
            if (form === 'melee') bot.opNpc(m.idx, 2); else bot.opNpcT(m.idx, spell(form as 'air' | 'water' | 'earth' | 'fire'));
            bot.queueFlush(); lastSend = bot.tickCount;
            if (form !== lastForm) c.log(`mother -> ${form} (hp ${(bot.npcs[m.idx] as any)?.hpCur ?? '?'}/${(bot.npcs[m.idx] as any)?.hpMax ?? '?'}, my hp ${bot.stat('hitpoints').cur}, hits ${casts})`);
        }
        lastForm = form;
        await bot.tick(1);
    }
    pray(bot, 'protectfrommissiles', false);
    if (!done()) c.fail('the mother did not die');
}
export { objId };
