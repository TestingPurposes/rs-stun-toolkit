// q-grandtree.ts — The Grand Tree (quest_grandtree): agility +79,000, attack +184,000, magic +21,500 base tenths
// (x25: agility 1 -> 75, attack +46% of 99). Prerequisite of Monkey Madness. LOCAL ONLY, rev 289 content.
// Static map: `bun plan/tools/quest-contract.ts grandtree` (289 tree). Tested in the offline sim first (plan/SIM.md).
//
// PRECONDITIONS: Tree Gnome Village complete (the village spirit tree is the transport), agility >= 25 (Glough's
//   tree), a melee weapon wielded (Black Demon: def 152, melee), prayer potions + sharks, Varrock teleport runes
//   (law 1, air 3, fire 1), >= 6 free slots.
// STEPS (quest varp %grandtree is not transmitted; each step checks its own evidence):
//   village tree -> stronghold; Narnode ("You seem worried" / "I'd be happy to help!": bark + book) -> Hazelmere
//   (2678,3086 L1: bark -> scroll) -> village tree -> stronghold; Narnode (relay: none, none, King's seal, Daconia
//   rocks, kill the tree) -> Glough (L1) -> Narnode -> Charlie (jail L3) -> Glough's cupboard (journal) -> Glough
//   (arrest -> jail -> Narnode frees you) -> glider "Take me to Karamja please!" (crash 2917,3058) -> shipyard gate
//   ("Glough sent me." Ka Lu Min) -> foreman (wife dead, worm holes, Anita: lumber order) -> Varrock teleport ->
//   young tree -> village tree -> stronghold -> Charlie -> Anita (key) -> Glough's chest (invasion plans) -> Narnode
//   (twigs) -> climb Glough's tree -> twigs T U Z O on the pillars -> trapdoor -> Black Demon -> Narnode (roots) ->
//   search the roots (one of 15, random) -> Narnode (quest complete).
import { startEatWatch } from './k-mcannon-quest.js';
import { SpeedBot, objId, cheb } from '../core.js';
import { nav, npc, npcsOf, drive, inDialog, log, trace, tele, locAt, opLocGo, useOnLocGo, qp, dismiss, talk, type Tile } from './q-lib.js';

export const GRANDTREE_SUPPLY = [{ name: '4doseprayerrestore', n: 3 }, { name: 'shark', n: 6 }];
/** live prerequisites (quest-sharing.md): what an account needs before grandTreeLeg; the launcher prints and checks them */
export const GRANDTREE_REQUIREMENTS = {
    quests: ['Tree Gnome Village'],   // the leg travels by the village spirit tree (king_bolren tree needs %treequest complete)
    // hard = the game refuses below it (checked by the launcher); soft = recommended combat levels (sim-proven levels in the why)
    skills: [
        { skill: 'agility', level: 25, hard: true, why: "climbing Glough's tree to the pillars (quest_grandtree.rs2: stat(agility) < 25 refuses)" },
        { skill: 'magic', level: 25, hard: true, why: 'the Varrock teleport back from Karamja (law 1, air 3, fire 1)' },
        { skill: 'attack', level: 70, hard: false, why: 'the Black Demon (lvl 172, def 152, 157 hp): the sim runs att 92 / str 83' },
        { skill: 'strength', level: 70, hard: false, why: 'same fight' },
        { skill: 'hitpoints', level: 60, hard: false, why: 'the demon (lvl 172, att 145, str 148): the sim runs hp 72 with 6 sharks + 3 prayer restores' },
        { skill: 'prayer', level: 43, hard: false, why: 'Protect from Melee for the demon (the leg prays once it engages and drinks restores below 10)' },
    ],
    gear: 'a melee weapon wielded (the sim wields a rune scimitar); 6 free slots (bark, scroll, order, key, plans, 4 twigs, rock come and go)',
    start: 'inside Tree Gnome Village next to the spirit tree (2542,3170) -- where treeGnomeLeg ends',
};
import { isResuming, journalStage, failHook } from './qp/journal.js';
import { reconnectsOf } from './qp/route/drops.js';   // session 11 fix 382 (b: a reconnect inside the release scene)
const ELKOY = 473, NARNODE = 670, GLOUGH = 671, ANITA = 672, CHARLIE = 673, FOREMAN = 674, PILOT = 170, HAZELMERE = 669, DEMON = 677;
const VILLAGE_TREE = { x: 2543, z: 3168 }, STRONGHOLD_AT = { x: 2461, z: 3444 }, YOUNG_TREE = { x: 3177, z: 3506 };
const NARNODE_AT = { x: 2466, z: 3496 }, HAZEL_AT = { x: 2678, z: 3087 }, GLOUGH_AT = { x: 2478, z: 3462 };
const JAIL_OUT = { x: 2466, z: 3495 }, PILOT_AT = { x: 2465, z: 3501 }, GATE_W = { x: 2944, z: 3041 }, FOREMAN_AT = { x: 2998, z: 3043 };
const ANITA_AT = { x: 2390, z: 3513 }, CUPBOARD = { x: 2476, z: 3465 }, CHEST = { x: 2482, z: 3462 }, CLIMB = { x: 2484, z: 3464 };
const PILLARS: [string, number, Tile][] = [['grandtree_twigt', 2440, { x: 2485, z: 3467 }], ['grandtree_twigu', 2441, { x: 2486, z: 3467 }], ['grandtree_twigz', 2442, { x: 2487, z: 3467 }], ['grandtree_twigo', 2443, { x: 2488, z: 3467 }]];
const TRAPDOOR = { x: 2487, z: 3464 }, NARNODE_UNDER = { x: 2464, z: 9897 };
// daconia_coords.enum (index 1..15 = %daconia_rock_root): x 2432+dx, z 9856+dz
const ROOTS: Tile[] = [[24, 30], [25, 25], [23, 18], [11, 22], [7, 25], [12, 37], [20, 37], [33, 35], [36, 34], [35, 40], [41, 41], [49, 48], [53, 29], [58, 33], [35, 16]].map(([dx, dz]) => ({ x: 2432 + dx!, z: 9856 + dz! }));
const o2 = (n: string) => objId(n);
const ALLNPC = Array.from({ length: 2000 }, (_, i) => i);
const POTS = ['1doseprayerrestore', '2doseprayerrestore', '3doseprayerrestore', '4doseprayerrestore'].map(n => objId(n));

export async function grandTreeLeg(bot: SpeedBot, o: { verbose?: boolean; startAt?: string } = {}): Promise<Record<string, number | boolean>> {
    await nav();
    bot.holdDialogs = true;
    const t0 = bot.tickCount, m: Record<string, number | boolean> = {};
    if (o.verbose) trace(bot, t0);
    // failHook (resume proofs): SR_FAIL_AT=gt:<mark> throws once right after that mark
    const at = (s: string) => { m[s] = bot.tickCount - t0; if (o.verbose) log(bot, t0, `${s} pos=${JSON.stringify(bot.tile())} L${bot.minusedlevel} hp=${bot.stat('hitpoints').cur}`); failHook(`gt:${s}`); };
    const fail = (s: string): never => { throw new Error(`grandtree: ${s} at ${JSON.stringify(bot.pos())}`); };
    const agi0 = bot.stat('agility').xp;   // success = the reward's agility xp (GL1: qp moved because the checkpoint's setvar treequest re-counted quest points)
    const rewarded = () => bot.stat('agility').xp > agi0;
    const walk = async (to: Tile, label: string, near = 1, level = 0) => {
        const r = await bot.walkTo(to.x, to.z, { near, maxTicks: 900, level, log: !!process.env.GT_LOG });
        if (cheb(bot.tile(), to) > near + 2 || bot.minusedlevel !== level) fail(`walk ${label} ${JSON.stringify(r)}`);
    };
    // 285a: a pack can arrive full (qx32m: a TGV retry re-supplied 6 logs, 5 stayed): the foreman's order, Anita's key and
    // Glough's invasion plans all say 'can't carry' / fail silently on a full pack. Free n slots: logs first (no use in this
    // quest), then sharks over 6 / restores over 3, then sharks. Re-sent until it lands (qyt05: a drop the tick after the
    // shipyard gate's script was discarded, the player still delayed).
    const slotFix = process.env.GT_FOREMAN_SLOT !== '0';
    const makeRoom = async (n: number, why: string, lastResort = true) => {
        if (!slotFix) return;
        const SH = o2('shark'), LG = o2('logs');
        for (let r = 0; r < 8 && bot.free() < n; r++) {
            const spare = (ob: number, keep: number) => bot.inv().filter(x => x.obj === ob).slice(keep);
            const pick = [...spare(LG, 0), ...spare(SH, 6), ...POTS.flatMap(p => bot.inv().filter(x => x.obj === p)).slice(3), ...(lastResort ? spare(SH, 0) : [])][0];
            if (!pick) return;
            const f0 = bot.free();
            if (r === 0) log(bot, t0, `285a: pack ${28 - f0}/28 before ${why}: dropping ${pick.obj === LG ? 'logs' : pick.obj === SH ? 'shark' : 'a restore'}...`);
            bot.dropItem(pick.obj, pick.slot); bot.queueFlush(); await bot.until(() => bot.free() > f0, 2);
        }
    };
    const talkTo = async (type: number, stand: Tile | null, level: number, answers: RegExp[], done: () => boolean, label: string, maxTicks = 120) => {
        if (stand && (npc(bot, type) === null || cheb(bot.tile(), stand) > 6 || bot.minusedlevel !== level)) await walk(stand, label, 2, level);
        let opened = false, dbgSig = '';
        const dbg = () => {   // GT_DEBUG=<label>: per-tick dialog trace of that talk (diagnosis only)
            if (process.env.GT_DEBUG !== label) return;
            const ns = npcsOf(bot, ALLNPC).filter(n => n.d <= 15).map(n => `${n.type}@${n.x},${n.z}`).slice(0, 6).join(' ');
            const s = `pos ${bot.tile().x},${bot.tile().z} chat ${bot.chatModalId} main ${bot.mainModalId} opts [${bot.dialogOptions().map(x => x.text).join('|')}] npcs ${ns}`;
            if (s !== dbgSig) { dbgSig = s; log(bot, t0, `[gtdbg ${label}] ${s} | ${[...bot.ifText.values()].slice(-2).join(' / ').slice(0, 160)}`); }
        };
        // TEST 298 (GT_DROP_TEST=<label>): close our socket once, 2 t after that talk's first page opened (the qx53 1012 drop)
        let dropAt = -1;
        const dropTest = () => {
            if (process.env.GT_DROP_TEST !== label || (globalThis as any).__gtDropTest) return;
            if (dropAt < 0 && inDialog(bot)) dropAt = bot.tickCount;
            if (dropAt >= 0 && bot.tickCount - dropAt >= 2) { (globalThis as any).__gtDropTest = 1; log(bot, t0, `TEST 298: closing the socket in '${label}'`); try { (bot as any).stream?.socket?.close?.(); } catch { /* gone */ } }
        };
        const r = await talk(bot, type, [], { done: () => { dbg(); dropTest(); if (inDialog(bot)) opened = true; return opened && done(); }, answers, maxTicks, label });
        if (!r.ok) fail(`${label} dialog (npc ${type} ${npc(bot, type) ? 'visible' : 'NOT visible'}; near: ${Array.from(bot.npcIndices.slice(0, bot.npcCount), i => bot.npcs[i]).filter(Boolean).map(n => n!.typeId).slice(0, 12).join(',')})`);
        dismiss(bot); at(label);
    };
    // the Grand Tree trunk: a walled room entered through the tree doors (1967/1968, centrepiece locs: no planner route,
    // G2) from (2465,3491); ladders 1747 (L0) -> 1748 (L1) -> 2884 (L2) -> 1746 laddertop (L3), all at (2466,3495)
    const TRUNK_LADDER = { x: 2466, z: 3495 };
    const inTrunk = () => { const t = bot.tile(); return t.x >= 2460 && t.x <= 2470 && t.z >= 3493 && t.z <= 3500 && (bot.minusedlevel > 0 || (t.x >= 2463 && t.x <= 2468 && t.z <= 3498)); };
    const ladder = async (id: number, at: Tile, level: number, op: number, toLevel: number, label: string) => {
        for (let k = 0; k < 4 && bot.minusedlevel !== toLevel; k++) { opLocGo(bot, locAt(id, at.x, at.z, level), op); bot.queueFlush(); await bot.until(() => bot.minusedlevel === toLevel, 12); dismiss(bot); }
        if (bot.minusedlevel !== toLevel) fail(`ladder ${label} L${level}->L${toLevel}`);
    };
    const trunkDoor = async (enter: boolean) => {
        const stand = enter ? { x: 2465, z: 3491 } : { x: 2465, z: 3493 };
        if (cheb(bot.tile(), stand) > 0) await walk(stand, enter ? 'trunk-door-out' : 'trunk-door-in', 0);
        for (let k = 0; k < 3 && inTrunk() !== enter; k++) { opLocGo(bot, locAt(1967, 2464, 3492), 1, stand); bot.queueFlush(); await bot.until(() => inTrunk() === enter, 8); }
        if (inTrunk() !== enter) fail(`tree door ${enter ? 'in' : 'out'}`);
    };
    const trunkTo = async (level: number) => {
        // 285c (qyt05: the retry after 'invasion plans' resumed in Glough's house L1 and walked for the trunk ladder on L1: 'walk
        // trunk-ladder-L1', ROUTE STOPPED): down his ladder first. GT_GLOUGH_LEAVE=0 = as before.
        if (process.env.GT_GLOUGH_LEAVE !== '0' && bot.minusedlevel === 1 && cheb(bot.tile(), GLOUGH_AT) <= 8) await ladder(1746, { x: 2476, z: 3463 }, 1, 1, 0, 'glough-down');
        if (bot.minusedlevel === 0 && !inTrunk()) await trunkDoor(true);
        const ids: Record<number, number> = { 0: 1747, 1: 1748, 2: 2884, 3: 1746 };
        while (bot.minusedlevel !== level) {
            const cur = bot.minusedlevel, up = level > cur;
            if (cheb(bot.tile(), TRUNK_LADDER) > 1) await walk({ x: 2466, z: 3494 }, `trunk-ladder-L${cur}`, 1, cur);
            await ladder(ids[cur]!, TRUNK_LADDER, cur, cur === 0 || cur === 3 ? 1 : up ? 2 : 3, up ? cur + 1 : cur - 1, 'trunk');   // middle ladders: op2 Climb-up, op3 Climb-down
        }
    };
    const leaveTrunk = async () => { if (inTrunk() || bot.minusedlevel > 0) { await trunkTo(0); await trunkDoor(false); } };
    // Glough's tree house: ladder (2476,3463) L0 1747 -> L1 1746
    const toGloughHouse = async () => {
        if (bot.minusedlevel === 1 && cheb(bot.tile(), GLOUGH_AT) <= 8) return;
        await leaveTrunk();
        await walk({ x: 2476, z: 3462 }, 'glough-ladder', 1);
        await ladder(1747, { x: 2476, z: 3463 }, 0, 1, 1, 'glough');
    };
    const leaveGloughHouse = async () => { if (bot.minusedlevel === 1 && cheb(bot.tile(), GLOUGH_AT) <= 8) await ladder(1746, { x: 2476, z: 3463 }, 1, 1, 0, 'glough-down'); };
    const toNarnode = async () => { await leaveGloughHouse(); await trunkTo(0); };
    // walk a chain of waypoints (long trips the planners cannot route in one go: G3/G4, Hazelmere's island)
    const via = async (pts: Tile[], label: string) => { for (let i = 0; i < pts.length; i++) await walk(pts[i]!, `${label}-${i}`, i === pts.length - 1 ? 1 : 2); };
    // the stronghold gate (190 at 2459,3383): a scripted gate (no planner route); north (2461,3385) <-> south (2461,3382)
    const strongholdGate = async (out: boolean) => {
        const stand = out ? { x: 2461, z: 3385 } : { x: 2461, z: 3382 };
        await walk(stand, out ? 'gate-north' : 'gate-south', 1);
        const done = () => out ? bot.tile().z <= 3382 : bot.tile().z >= 3385;
        for (let k = 0; k < 3 && !done(); k++) { opLocGo(bot, locAt(190, 2459, 3383), 1); bot.queueFlush(); await bot.until(done, 10); dismiss(bot); }
        if (!done()) fail(`stronghold gate ${out ? 'out' : 'in'}`);
    };
    // Tree Gnome Village from outside: Elkoy (2504,3191) jumps you in, the railing, Bolren's tree (TGV complete)
    const villageViaElkoy = async () => {
        await talkTo(ELKOY, { x: 2504, z: 3190 }, 0, [/^Yes please\.$/], () => cheb(bot.tile(), { x: 2515, z: 3159 }) <= 2 && !inDialog(bot), 'elkoy');
        for (let k = 0; k < 3 && !(bot.tile().x === 2515 && bot.tile().z === 3161); k++) {
            if (cheb(bot.tile(), { x: 2515, z: 3160 }) > 0) await walk({ x: 2515, z: 3160 }, 'railing-s', 0);
            opLocGo(bot, locAt(2186, 2515, 3161), 1, { x: 2515, z: 3160 }); bot.queueFlush();
            await bot.until(() => bot.tile().x === 2515 && bot.tile().z === 3161, 8);
        }
        await walk({ x: 2541, z: 3168 }, 'village-tree', 2);
    };
    const opTree = async (tree: Tile, answers: RegExp[], dest: Tile, label: string) => {
        if (cheb(bot.tile(), tree) > 2) await walk(tree, label, 1);
        let ok = false;
        for (let k = 0; k < 3 && !ok; k++) {
            opLocGo(bot, locAt(tree === YOUNG_TREE ? 1317 : tree === VILLAGE_TREE ? 1294 : 1293, tree.x, tree.z), 1); bot.queueFlush();
            ok = await drive(bot, () => cheb(bot.tile(), dest) <= 3 && !inDialog(bot), answers, 40);
        }
        if (!ok) fail(`${label}`);
        at(label);
    };
    const toStronghold = () => opTree(VILLAGE_TREE, [/^Where can I go\?$/, /^Gnome stronghold\.$/], STRONGHOLD_AT, 'tree-stronghold');
    // session 11 (so the route may retry it): on a retry with no startAt, the stage the JOURNAL shows (grandtree_journal.rs2,
    // latest first). 'roots' with 'searching' = Narnode already sent us to the roots (skip his talk); 'arrest' = Glough's journal
    // found (in the jail: Charlie runs the release scene). GT_RESUME=0 = from the top as before.
    let searching = false, jStage: string | undefined;
    if (!o.startAt && isResuming(bot) && process.env.GT_RESUME !== '0') {
        if (bot.chatModalId !== -1) { bot.closeModal(); bot.queueFlush(); await bot.tick(1); }
        // session 11 fix 382c (qx295m attempt 3: the read came back UNREADABLE (9 t, inside a 223 s server stall) -> 'start' ->
        // toStronghold walked for the village tree from the trunk top L3: 0 tiles, ROUTE STOPPED): quest items held = a 'start'
        // is suspect: read once more. GT_JOURNAL_REREAD=0 = one read as before.
        const held382 = process.env.GT_JOURNAL_REREAD !== '0' && bot.count(o2('grandtree_translationbook')) + bot.count(o2('grandtree_journal')) > 0;
        for (let k = 0; k < (held382 ? 2 : 1) && (k === 0 || jStage === 'start'); k++) {
        if (k > 0) await bot.tick(2);
        jStage = await journalStage<string>(bot, 'grandtree', [
            [/QUEST COMPLETE/i, 'done'], [/hidden amongst the\s+Grand Tree's roots/i, 'search'], [/He should be in these caves/i, 'roots'],
            [/investigate what's behind the\s+trap door/i, 'demon'], [/gave me some\s+twigs|talk to the King and see what he says/i, 'twigs'],
            [/ask\s+Anita\s+for the\s+keys/i, 'evidence'], [/foreman had\. I need to find\s+more proof of Glough's plans\.$/i, 'lumber'],
            [/told me to use the\s+glider/i, 'glider'], [/found\s+Glough's journal\s+in his tree house/i, 'arrest'],
            [/Daconia rocks are killing the Grand tree/i, 'relay'], [/translate|bark sample/i, 'hazel'],
        ], 'start', s2 => log(bot, t0, k ? `382c re-read: ${s2}` : s2));
        }
        if (jStage === 'done') return { ...m, ok: true, resumed: true };
        if (jStage === 'search') { searching = true; jStage = 'roots'; }
        // the invoice in hand: on Karamja the way back first, else straight to Charlie
        if (jStage === 'lumber') jStage = bot.tile().x > 2800 && bot.tile().z < 3300 ? 'return' : 'evidence';
        log(bot, t0, `resume at stage '${jStage}'${searching ? ' (searching the roots)' : ''}`);
    }
    const stage = o.startAt ?? jStage ?? 'start';
    const order = ['start', 'hazel', 'relay', 'arrest', 'glider', 'return', 'evidence', 'twigs', 'demon', 'roots'];
    const from = (s: string) => order.indexOf(stage) <= order.indexOf(s);
    if (from('start')) {
        await toStronghold();
        await toNarnode();
        await talkTo(NARNODE, NARNODE_AT, 0, [/^You seem worried, what's up\?$/, /^I'd be happy to help!$/], () => bot.count(o2('grandtree_barksample')) > 0 && bot.tile().z < 6400 && !inDialog(bot), 'narnode-start');
    }
    if (from('hazel')) {
        await leaveTrunk();
        await strongholdGate(true);
        // the island is reached over the pier north of it (2652..2672, 3109..3111); planners do not route it (G3/G4)
        await via([{ x: 2575, z: 3140 }, { x: 2606, z: 3093 }, { x: 2643, z: 3090 }, { x: 2652, z: 3103 }, { x: 2656, z: 3111 }, { x: 2670, z: 3111 }, { x: 2678, z: 3101 }, { x: 2677, z: 3089 }], 'to-hazel');
        // Hazelmere's house: door 1536 (north wall of 2677,3088), ladder 1747 (2677,3087) -> L1
        for (let k = 0; k < 3 && bot.tile().z > 3088; k++) { opLocGo(bot, locAt(1536, 2677, 3088), 1, { x: 2677, z: 3089 }); bot.queueFlush(); await bot.tick(3); bot.sendRoute([{ x: 2677, z: 3088 }]); bot.queueFlush(); await bot.until(() => bot.tile().z <= 3088, 6); }
        await ladder(1747, { x: 2677, z: 3087 }, 0, 1, 1, 'hazelmere');
        await talkTo(HAZELMERE, null, 1, [], () => bot.count(o2('grandtree_scroll')) > 0 && !inDialog(bot), 'hazelmere');
        await ladder(1746, { x: 2677, z: 3087 }, 1, 1, 0, 'hazelmere-down');
        if (bot.tile().z <= 3088) { opLocGo(bot, locAt(1536, 2677, 3088), 1); bot.queueFlush(); await bot.tick(3); }
        await via([{ x: 2678, z: 3101 }, { x: 2670, z: 3111 }, { x: 2656, z: 3111 }, { x: 2652, z: 3103 }, { x: 2643, z: 3090 }, { x: 2575, z: 3140 }, { x: 2504, z: 3192 }], 'hazel-back');
        await villageViaElkoy();
        await toStronghold();
    }
    if (from('relay')) {
        const relay = [/^I think so!$/, /^A man came to me with the King's seal\.$/, /^I gave the man Daconia rocks\.$/, /^And Daconia rocks will kill the tree!$/, /^None of the above\.$/];
        await toNarnode();
        await talkTo(NARNODE, NARNODE_AT, 0, relay, () => !inDialog(bot), 'narnode-relay');
        await toGloughHouse();
        await talkTo(GLOUGH, GLOUGH_AT, 1, [], () => !inDialog(bot), 'glough-1');
        await toNarnode();
        await talkTo(NARNODE, NARNODE_AT, 0, [], () => !inDialog(bot), 'narnode-prisoner');
        await trunkTo(3);
        await talkTo(CHARLIE, JAIL_OUT, 3, [], () => !inDialog(bot), 'charlie-1');
        await toGloughHouse();
        // Glough's cupboard: open (2434) then search (2435, dynamic)
        await walk({ x: 2477, z: 3465 }, 'cupboard', 1, 1);
        for (let k = 0; k < 4 && !bot.count(o2('grandtree_journal')); k++) {
            const open = bot.liveLocs.get(`1,${CUPBOARD.x},${CUPBOARD.z}`) === 2435;
            if (open) bot.opLoc(CUPBOARD.x, CUPBOARD.z, 2435, 2); else opLocGo(bot, locAt(2434, CUPBOARD.x, CUPBOARD.z, 1), 1);
            bot.queueFlush(); await bot.until(() => bot.count(o2('grandtree_journal')) > 0 || (!open && bot.liveLocs.get(`1,${CUPBOARD.x},${CUPBOARD.z}`) === 2435), 10);
            await drive(bot, () => !inDialog(bot), [/.*/], 6);
        }
        if (!bot.count(o2('grandtree_journal'))) fail('journal');
        at('journal');
    }
    if (from('arrest')) {
        // Glough: arrest -> jail -> Charlie -> Narnode frees you (scripted, ~20 ticks of cutscene)
        // a resume IN the jail (3_38_54_32_40 = 2464,3496 L3, the scene cut by a drop): Charlie's talk runs it (charlie.rs2:24-31,65-83)
        const inJail = () => bot.minusedlevel === 3 && bot.tile().x === 2464 && bot.tile().z === 3496;
        // session 11 fix 382 (qx295m: a 1012 drop inside the release scene, after charlie.rs2:81 p_teleport(2465,3496) but before
        // king_narnode.rs2:423 %grandtree = released_prison, left the quest at found_journal OUTSIDE the cell: the pilot offered only
        // "What's Gnome Air?.." (160 t), then every retry walked cross-level from the trunk top (2465,3501 L3; trunk ladders/doors
        // are not in the planners, G2) = travel 0 tiles in 900 t, ROUTE STOPPED).
        // (a) out of the trunk + up Glough's ladder before his talk. GT_ARREST_TRUNK=0 = as before.
        // (b) a reconnect inside the scene: re-read the journal, still 'arrest' -> arrest once more. GT_ARREST_RECHECK=0 = as before.
        // TEST 382 (GT_DROP_TEST_382=1): close our socket once on the first scene page after the cell-door teleport (the qx295 cut).
        const acct382 = String((bot as any).loginUser ?? '').toLowerCase();
        const arrest = async (again: boolean): Promise<boolean> => {
            const rc0 = reconnectsOf(acct382);
            if ((stage === 'arrest' || again) && inJail()) await talkTo(CHARLIE, null, 3, [], () => !inJail() && !inDialog(bot), 'charlie-jail', 160);
            else {
                if (process.env.GT_ARREST_TRUNK !== '0' && !(bot.minusedlevel === 1 && cheb(bot.tile(), GLOUGH_AT) <= 8)) await toGloughHouse();
                await talkTo(GLOUGH, stage === 'arrest' && bot.minusedlevel !== 1 ? GLOUGH_AT : null, 1, [], () => bot.minusedlevel === 3 && !inDialog(bot), 'glough-arrest', 160);
            }
            // Charlie's cutscene -> Narnode walks in and frees you (narnode_trust_glough sets released_prison): several chats with
            // p_delays between them; leaving early aborts it (G18: the pilot then had nothing to say). Wait for 8 quiet ticks.
            let quiet = 0; const end = bot.tickCount + 120;
            while (quiet < 8 && bot.tickCount < end) {
                if (inDialog(bot)) {
                    quiet = 0; bot.resumeDialogPage(); bot.queueFlush();
                    if (process.env.GT_DROP_TEST_382 === '1' && !(globalThis as any).__gt382 && bot.minusedlevel === 3 && !inJail()) {
                        (globalThis as any).__gt382 = 1; log(bot, t0, 'TEST 382: closing the socket in the release scene');
                        try { (bot as any).stream?.socket?.close?.(); } catch { /* gone */ }
                    }
                } else quiet++;
                await bot.tick(1);
            }
            return reconnectsOf(acct382) !== rc0;
        };
        if (await arrest(false) && process.env.GT_ARREST_RECHECK !== '0') {
            const js = await journalStage<string>(bot, 'grandtree', [[/told me to use the\s+glider/i, 'glider'], [/found\s+Glough's journal\s+in his tree house/i, 'arrest']], 'glider', s2 => log(bot, t0, `382b: ${s2}`));
            if (js === 'arrest') { log(bot, t0, `382b: release scene cut by a reconnect (found_journal at ${JSON.stringify(bot.tile())} L${bot.minusedlevel}): arrest again`); await arrest(true); }
        }
        at('released');
    }
    if (from('glider')) {
        // 285b (qx32m: the foreman failed in his office, the retry resumed at 'glider' and walked for the tree trunk from Karamja:
        // 'no route (island)', ROUTE STOPPED): a 'glider' resume already on Karamja skips the trunk + glider and carries on at the
        // shipyard gate (skipped too once inside). GT_KARAMJA_RESUME=0 = as before.
        const onKaramja = bot.minusedlevel === 0 && bot.tile().x > 2800 && bot.tile().z < 3300;
        if (stage === 'glider' && onKaramja && process.env.GT_KARAMJA_RESUME !== '0') log(bot, t0, `285b: resume on Karamja at ${JSON.stringify(bot.tile())}: no glider`);
        else {
        await trunkTo(3);
        await talkTo(PILOT, PILOT_AT, 3, [/^Take me to Karamja please!$/], () => bot.tile().x > 2800 && !inDialog(bot), 'glider', 160);
        }
        if (bot.tile().x < 2945) {
        // shipyard gate: "Glough sent me." Ka Lu Min
        await walk(GATE_W, 'shipyard-gate', 0);
        for (let k = 0; k < 3 && bot.tile().x < 2945; k++) {
            opLocGo(bot, locAt(2438, 2945, 3041), 1); bot.queueFlush();
            await drive(bot, () => bot.tile().x >= 2945 && !inDialog(bot), [/^Glough sent me\.$/, /^Ka\.$/, /^Lu\.$/, /^Min\.$/], 60);
        }
        if (bot.tile().x < 2945) fail('shipyard gate');
        at('shipyard');
        }
        // 285a (qx32m CONFIRMED by fork qyt02 + GT_DEBUG trace: the whole interrogation ran and was answered right, then the
        // dialog closed with no order: the pack was 28/28 (5 spare logs from a TGV retry's re-supply + the quest's scroll, book,
        // journal) and foreman.rs2 says "It seems you can't carry anymore" and returns): free a slot before the talk (logs have
        // no use here, then sharks over 6 / restores over 3, then a shark), and a 2nd round after a talk that ended orderless.
        // GT_FOREMAN_SLOT=0 = as before (one talk, no slot check; also turns off makeRoom at Anita + the chest).
        const ORDER = () => bot.count(o2('grandtree_order')) > 0;
        for (let k = 0; k < (slotFix ? 2 : 1) && !ORDER(); k++) {
            if (slotFix) { if (bot.chatModalId !== -1) { dismiss(bot); await bot.tick(1); } await makeRoom(1, 'foreman'); }
            // a round ends 25 t after the last open page without the order (the office cutscene's gap is ~17 t), not after 200 t
            let lastOpen = -1;
            const roundOver = () => { if (inDialog(bot)) lastOpen = bot.tickCount; return slotFix && lastOpen > 0 && !ORDER() && bot.tickCount - lastOpen >= 25; };
            try {
                await talkTo(FOREMAN, FOREMAN_AT, 0, [/^Sadly his wife is no longer with us!$/, /^He loves worm holes\.$/, /^Anita\.$/], () => (ORDER() && !inDialog(bot)) || roundOver(), 'foreman', 200);
                if (!ORDER()) throw new Error('foreman: dialog over, no order');
            } catch (e) { if (!slotFix || k === 1) throw e; log(bot, t0, `285a: foreman round ${k + 1} without the order (free ${bot.free()}): again`); }
        }
    }
    if (from('return')) {
        if (!(await tele(bot, 'varrock_teleport')).ok) fail('varrock teleport');
        await opTree(YOUNG_TREE, [/^Yes please\.$/], VILLAGE_TREE, 'young-tree');
        await toStronghold();
    }
    if (from('evidence')) {
        await trunkTo(3);
        await talkTo(CHARLIE, JAIL_OUT, 3, [], () => !inDialog(bot), 'charlie-2');
        await leaveTrunk();
        // Anita: upstairs in her house, spiral stairs 1742 (2389,3512) L0 -> 1744 (2389,3513) L1 (G10: a level-1 walk
        // target sent the walker out of the stronghold)
        await walk({ x: 2389, z: 3511 }, 'anita-stairs', 1);
        await ladder(1742, { x: 2389, z: 3512 }, 0, 1, 1, 'anita-up');
        if (!bot.count(o2('grandtree_gloughskey'))) await makeRoom(1, 'anita');
        await talkTo(ANITA, ANITA_AT, 1, [], () => bot.count(o2('grandtree_gloughskey')) > 0 && !inDialog(bot), 'anita');
        await ladder(1744, { x: 2389, z: 3513 }, 1, 1, 0, 'anita-down');
        await toGloughHouse();
        await walk({ x: 2481, z: 3462 }, 'chest', 1, 1);
        if (!bot.count(o2('grandtree_invasionplans'))) await makeRoom(1, 'the chest');   // 285a (qyt05/qyt06: 'invasion plans' on 28/28)
        for (let k = 0; k < 3 && !bot.count(o2('grandtree_invasionplans')); k++) {
            useOnLocGo(bot, 'grandtree_gloughskey', locAt(2436, CHEST.x, CHEST.z, 1)); bot.queueFlush();
            await bot.until(() => bot.count(o2('grandtree_invasionplans')) > 0, 10);
            await drive(bot, () => !inDialog(bot), [/.*/], 6);
        }
        if (!bot.count(o2('grandtree_invasionplans'))) fail('invasion plans');
        at('plans');
    }
    if (from('twigs')) {
        // Narnode hands over 4 twigs: a chained run (TGV food left over) can arrive with 1 free slot (TGd sim lane).
        // Make room from the surplus food, keeping 6 sharks + 3 restores for the demon.
        await makeRoom(4, 'the twigs', false);   // 285a: logs first (the drop below never counted them); keeps 6 sharks
        const SH = o2('shark');
        const spare = (o: number, keep: number) => bot.inv().filter(x => x.obj === o).slice(keep);
        const drop = [...spare(SH, 6), ...POTS.flatMap(p => bot.inv().filter(x => x.obj === p)).slice(3)].slice(0, Math.max(0, 4 - bot.free()));
        if (drop.length) { bot.burst(drop.map(x => () => bot.dropItem(x.obj, x.slot))); await bot.until(() => bot.free() >= 4, 6); }
        await toNarnode();
        await talkTo(NARNODE, NARNODE_AT, 0, [], () => bot.count(o2('grandtree_twigt')) > 0 && !inDialog(bot), 'narnode-twigs');
        // session 11 fix 369b GT_AGI_FAST (qx202m: agility 1 after Tourist Trap's picks both went to Thieving; 3 refused
        // clicks + the mesbox per attempt (quest_grandtree.rs2:23-28), 2 attempts, STOP): below 25 the tree always refuses:
        // fail at once and say the level. GT_AGI_FAST=0 reverts.
        if (process.env.GT_AGI_FAST !== '0' && bot.stat('agility').level < 25) fail(`climb tree: agility ${bot.stat('agility').level} < 25 (Tourist Trap picks?)`);
        await toGloughHouse();
        await walk({ x: 2483, z: 3464 }, 'climb', 1, 1);
        for (let k = 0; k < 3 && bot.minusedlevel === 1; k++) { opLocGo(bot, locAt(2447, CLIMB.x, CLIMB.z, 1), 1); bot.queueFlush(); await bot.until(() => bot.minusedlevel === 2, 12); }
        if (bot.minusedlevel !== 2) fail('climb tree (agility 25)');
        for (const [twig, id, p] of PILLARS) {
            for (let k = 0; k < 3 && bot.count(o2(twig)); k++) { useOnLocGo(bot, twig, locAt(id, p.x, p.z, 2)); bot.queueFlush(); await bot.until(() => bot.count(o2(twig)) === 0, 10); }
            if (bot.count(o2(twig))) fail(`pillar ${twig}`);
        }
        await drive(bot, () => !inDialog(bot), [/.*/], 6);
        at('pillars');
    }
    if (from('demon')) {
        // 322 (qx91m: Glough's cutscene started (npc 671 came) but was cut before npc_add(blackdemon) (glough.rs2:92-119); no
        // demon ever came, 1,500 t x2 (the retry resumed in the cave and waited again), STOPPED). The cutscene only plays from
        // the L2 trapdoor (quest_grandtree.rs2:53-62, %grandtree still unlocked_trapdoor): no demon 80 t after landing -> out
        // by the cellar ladder (1755 at 2463,9897), up to L2 again, trapdoor again (max 2 more). GT_DEMON_RETRIGGER=0 reverts.
        let killed = false, demonTestDone = false;
        for (let attempt = 0; attempt < 3 && !killed; attempt++) {
        if (attempt > 0) {
            log(bot, t0, `322 demon: none came (attempt ${attempt}): out by the cellar ladder, trapdoor again`);
            if (bot.tile().z > 6400) {
                await walk({ x: 2463, z: 9896 }, 'cellar-ladder', 1);
                for (let k = 0; k < 4 && bot.tile().z > 6400; k++) { opLocGo(bot, locAt(1755, 2463, 9897), 1); bot.queueFlush(); await bot.until(() => bot.tile().z < 6400, 12); dismiss(bot); }
                if (bot.tile().z > 6400) fail('cellar ladder (demon retrigger)');
            }
            await toGloughHouse();
            await walk({ x: 2483, z: 3464 }, 'climb', 1, 1);
            for (let k = 0; k < 3 && bot.minusedlevel === 1; k++) { opLocGo(bot, locAt(2447, CLIMB.x, CLIMB.z, 1), 1); bot.queueFlush(); await bot.until(() => bot.minusedlevel === 2, 12); }
            if (bot.minusedlevel !== 2) fail('climb tree (agility 25, demon retrigger)');
        }
        for (let k = 0; k < 3 && bot.tile().z < 6400; k++) { opLocGo(bot, locAt(2444, TRAPDOOR.x, TRAPDOOR.z, 2), 1); bot.queueFlush(); await bot.until(() => bot.tile().z > 6400, 12); }
        if (bot.tile().z < 6400) fail('trapdoor');
        at('trapdoor');
        const stopEat = startEatWatch(bot, Math.max(12, Math.floor(bot.stat('hitpoints').level * 0.45)));
        const landed = bot.tickCount, retrigger = process.env.GT_DEMON_RETRIGGER !== '0';
        let lastOp = -99, lastPot = -99, firstSeen = -1, seenDemon = false; const end = bot.tickCount + 1500;
        try {
            while (bot.tickCount < end) {
                if (retrigger && !seenDemon && bot.tickCount - landed >= 80 && !inDialog(bot)) break;
                // 322 TEST: GT_DEMON_TEST=1 closes Glough's first chat on the first landing (cuts the cutscene before the demon)
                if (process.env.GT_DEMON_TEST === '1' && attempt === 0 && inDialog(bot) && !demonTestDone) { demonTestDone = true; log(bot, t0, '322 TEST: closing the cutscene chat'); bot.closeModal(); bot.activatePrayer('protectfrommelee'); bot.queueFlush(); await bot.tick(1); continue; }
                if (inDialog(bot)) { bot.resumeDialogPage(); bot.queueFlush(); }
                if (seenDemon && bot.stat('prayer').cur < 10 && bot.tickCount - lastPot > 3) {
                    const pot = bot.inv().find(x => POTS.includes(x.obj));
                    if (pot) { bot.opHeld1(pot.obj, pot.slot); bot.queueFlush(); lastPot = bot.tickCount; }
                }
                const d = npc(bot, DEMON);
                // prayer clicks close the cutscene's chat and abort it before the demon spawns (G12-G14): pray only once it is here
                // ...and the cutscene still has p_delays after the demon appears (npc_retaliate comes last): a click before that
                // can cut it, leaving a demon that is 'not after you' and cannot be attacked (G20). Wait ~12 ticks after it shows.
                if (d && firstSeen < 0) firstSeen = bot.tickCount;
                const engaged = d !== null && bot.tickCount - firstSeen >= 12;
                if (engaged && bot.stat('prayer').cur > 0 && !bot.isPrayerActive('protectfrommelee')) bot.activatePrayer('protectfrommelee');
                if (o.verbose && (bot.tickCount - t0) % 25 === 0) log(bot, t0, `demon loop: demon ${d ? `${d.x},${d.z} d${d.d}` : 'none'} npcs ${npcsOf(bot, ALLNPC).map(n => `${n.type}@${n.x},${n.z}`).slice(0, 8).join(' ')} hp ${bot.stat('hitpoints').cur} pray ${bot.stat('prayer').cur}`);
                if (d) { seenDemon = true; if (engaged && bot.tickCount - lastOp > 6) { bot.opNpc(d.idx, 2); bot.queueFlush(); lastOp = bot.tickCount; } }
                else if (seenDemon) { killed = true; break; }
                await bot.tick(1);
            }
        } finally { stopEat(); bot.deactivatePrayer('protectfrommelee'); bot.queueFlush(); }
        if (!killed && (seenDemon || !retrigger)) break;
        }
        if (!killed) fail('black demon');
        at('demon');
    }
    if (from('roots')) {
        if (!searching) {
        // session 11 fix 396b (qx348m: an engine restart mid-talk; after the reconnect talkTo saw no chat, the guard scene never came
        // (guard +14 t; 22/22 other runs +2 t), %grandtree stayed 'demon defeated', 3 root tours found nothing: 'daconia rock' after
        // ~1000 t). No guard chat within 14 t = the scene did not run: talk to Narnode once more.
        // GT_396B=0 = one talk as before; GT_396B_TEST=1 skips the first talk (= the qx348 state)
        for (let k = 0; k < (process.env.GT_396B === '0' ? 1 : 2); k++) {
        if (k === 0 && process.env.GT_396B_TEST === '1') log(bot, t0, '396b TEST: skipping the first Narnode talk');
        else await talkTo(NARNODE, NARNODE_UNDER, 0, [], () => !inDialog(bot), 'narnode-roots', 160);
        // king_narnode.rs2: if_close, p_delay(6), then the guard's two lines set %grandtree = searching + the random root.
        // Walking away closes that chat and aborts it (G16: all 15 roots empty). Stand still until it has played out.
        if (await bot.until(() => inDialog(bot), 14)) { await drive(bot, () => !inDialog(bot), [/.*/], 30); break; }
        if (process.env.GT_396B !== '0') log(bot, t0, `396b: no guard scene within 14 t of the Narnode talk (try ${k + 1})`);
        }
        at('guard');
        }
        // nearest-first tour of the 15 roots until the Daconia rock turns up
        // route runner: one 15-root tour came back empty (sim qre5m 'daconia rock'): up to 3 tours
        let left = [...ROOTS]; let tours = 1;
        while (!bot.count(o2('grandtree_daconiarock')) && (left.length || (tours < 3 && (left = [...ROOTS], ++tours)))) {
            left.sort((a, b) => cheb(a, bot.tile()) - cheb(b, bot.tile()));
            const r = left.shift()!;
            // roots are static locs largeroot_gnome (1985) / largeroot2_gnome (1986) (G15: liveLocs only holds changed locs)
            let root; try { root = locAt(1985, r.x, r.z); } catch { try { root = locAt(1986, r.x, r.z); } catch { if (o.verbose) log(bot, t0, `no root loc at ${r.x},${r.z}`); continue; } }
            opLocGo(bot, root, 1); bot.queueFlush();
            await bot.until(() => bot.count(o2('grandtree_daconiarock')) > 0 || cheb(bot.tile(), r) <= 1, 30);
            await bot.tick(3); await drive(bot, () => !inDialog(bot), [/.*/], 6);
        }
        if (!bot.count(o2('grandtree_daconiarock'))) fail('daconia rock');
        at('daconia');
        await talkTo(NARNODE, NARNODE_UNDER, 0, [], () => !bot.count(o2('grandtree_daconiarock')), 'narnode-done', 160);
        await drive(bot, () => !inDialog(bot) && rewarded(), [/.*/], 40);   // the reward is a queued script: wait for it (G19)
        if (!rewarded()) fail('no Grand Tree reward');
    }
    m.ticks = bot.tickCount - t0; m.ok = rewarded();
    if (o.verbose) log(bot, t0, `done ${JSON.stringify(m)}`);
    return m;
}
