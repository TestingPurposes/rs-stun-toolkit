// q-biohazard.ts — Biohazard (quest_biohazard), cheat-free. Max-QP build, ardougne lane.
//
// Content (rev 289, server/content/scripts/): quests/quest_biohazard/scripts/*.rs2, areas/area_ardougne_east/scripts/
// {elena,king_lathas}.rs2, areas/area_ardougne_west/scripts/{omart,kilron,mourner,nurse_sarah,doors,manhole}.rs2,
// areas/area_varrock/scripts/east_gate.rs2. Stage varp %biohazard (quest_biohazard.constant:1-12), NOT transmitted.
//
// PREREQUISITE: Plague City complete (Elena's door elenadoor2 opens only at %elenaquest >= elena_complete,
//   area_ardougne_east/scripts/doors.rs2:1-5). ORDER TRAP: Plague City must be finished BEFORE this starts
//   (quest_elena/scripts/mud_patch.rs2:15).
// Flow (file:line):
//   Elena (2592,3336) "I'll try to retrieve it for you."                  -> started          elena.rs2:118-134
//   Jerico (2612,3324)                                                    -> spoken_jerico    jerico.rs2:36-45
//   Jerico's cupboard (2611,3326): Open, Search -> birdfeed               quest_biohazard.rs2:44-60
//   pigeons: ground spawn (2618,3323..3325) behind Jerico's house          (map m40_51 OBJ 424)
//   birdfeed on the watch tower (2559..2563,3301..3306)                    -> used_birdfeed    quest_biohazard.rs2:32-42
//   open the pigeon cage inside (2559..2565,3299..3307)                    -> released_pigeons quest_biohazard.rs2:63-77
//   Omart (2559,3266) "Ok, lets do it." -> rope ladder to (2556,3267)      -> climbed_ladder   omart.rs2:149-176, quest_biohazard.rs2:79-93
//   rotten apple: ground spawn (2535,3333); climb the yard fence (2541,3331, fence.rs2); apple on the cauldron (2543,3332)
//     -> poisoned_stew  quest_biohazard.rs2:95-106
//   nurse's cupboard (2517,3276): Open, Search -> doctor's gown (worn)    quest_biohazard.rs2:109-116
//   mourner HQ door (2551,3320) "In you go doc." (gown worn)              doors.rs2:115-123
//   spiral stairs (2542,3324) -> L1; door (2547,3325) (gown); kill a sick mourner (cl 13) -> key  mourner.rs2:35-80
//   key on the gate (2551,3326); crate (2554,3327) -> distillator         -> found_distillator quest_biohazard.rs2:118-156
//   back east: manhole (2529,3303) -> sewer -> mud pile -> Edmond's garden (no stage checks: manhole.rs2, mud_pile.rs2),
//     or Kilron's ladder (kilron.rs2) [A/B: BIO_RETURN=kilron|manhole]
//   Elena with the distillator: 3 vials + plague sample (needs free slots: elena.rs2:83-94) -> given_distillator
//   NO TELEPORT until Guidor has the plague sample: post_tele_checks deletes it (teleport.rs2:94-97). Ships keep it.
//   ship Ardougne -> Brimhaven (Barnaby, 30 gp), walk to Musa Point, customs -> Port Sarim (30 gp), walk to Rimmington:
//   chemist (2934,3210) "It's ok, I'm Elena's friend." / "I just need some touch paper for a guy called Guidor."
//                                                                         -> spoken_chemist   chemist.rs2:43-84
//   walk to Varrock from the south-west: the vial search only runs at the EAST gate (east_gate.rs2:14-39, bioguard1 at
//     3263,3407), so the chemist's errand boys are not needed. Priest gown + robe worn -> Guidor's door (3282,3382)
//   Guidor (3285,3381) "I've come to ask your assistance..." / "I've been sent by your old pupil Elena." -> found_secret guidor.rs2:78-137
//   Ardougne teleport, Elena                                              -> reported_elena   elena.rs2:18-28
//   King Lathas (2578,3293, castle L1) "I don't understand..."            -> complete         king_lathas.rs2:41-68
//   Completion: quest_biohazard.rs2:158-162 (thieving 12,500 tenths), %biohazard = ^biohazard_complete = 16.
import { SpeedBot, objId, cheb } from '../../../core.js';
import { qp, inDialog, dismiss, locAt, opLocGo, nav, trace, npc, opNpcGo, tele, npcsOf, type Tile, type NpcRef } from '../../q-lib.js';
import { type Item, type Ctx, ctx, mark, fail, talkTo, finishDialog, opLocUntil, useOnLocUntil, pickup, wear, textWatch, deathWatch, walkLive } from './ar-lib.js';
import { isResuming, journalStage, failHook } from '../journal.js';

export const QUEST = { name: 'Biohazard', dir: 'quest_biohazard', qp: 3 };
export const REQUIREMENTS = {
    quests: ['Plague City'], qp: 0,
    skills: {
        magic: [51, 'Ardougne Teleport back from Varrock (magic_spells.dbrow:98-105; needs Plague City + its scroll read, teleport.rs2:22-38)'],
    } as Record<string, [number, string]>,
    start: { x: 2591, z: 3340, level: 0 },   // outside Elena's door (elenadoor2 2592,3339), East Ardougne
    end: { x: 2578, z: 3292, level: 1 },     // King Lathas, Ardougne castle L1
};
/** priest gown/robe: no spawn in the 289 maps, helpered (tradeable). Runes: Ardougne Teleport back from Varrock (2 law,
 *  2 water). Coins: two 30 gp ship fares (sailors.rs2:12-31, customs_officer.rs2:72-85). */
export const SUPPLY: Item[] = [
    { name: 'priest_gown', n: 1 }, { name: 'priest_robe', n: 1 },
    { name: 'lawrune', n: 2 }, { name: 'waterrune', n: 2 }, { name: 'coins', n: 60 },
];

const ELENA = 335, JERICO = 366, OMART = 350, KILRON = 349, SICK_MOURNER = 370, CHEMIST = 367, GUIDOR = 343, LATHAS = 364;
const ELENA_DOOR = { id: 2054, x: 2592, z: 3339 }, ELENA_DOOR_OUT = { x: 2592, z: 3339 }, ELENA_DOOR_IN = { x: 2592, z: 3338 };
const ELENA_AT = { x: 2592, z: 3336 }, JERICO_AT = { x: 2612, z: 3324 };
// cupboards: length 2, angle 1, forceapproach=east (quest_biohazard.loc:65-84) -> rotated: approach from the SOUTH
const CUPBOARD_SHUT = { id: 2056, x: 2611, z: 3326 }, CUPBOARD_OPEN = 2057, CUPBOARD_STAND = { x: 2611, z: 3325 };
const PIGEONS_AT = { x: 2618, z: 3324 }, TOWER = { id: 2067, x: 2563, z: 3304 };
const OMART_AT = { x: 2559, z: 3266 }, KILRON_AT = { x: 2556, z: 3266 };
const APPLE_AT = { x: 2535, z: 3333 }, CAULDRON = { id: 2043, x: 2543, z: 3332 }, FENCE = { id: 2068, x: 2541, z: 3331 };
const NURSE_SHUT = { id: 2062, x: 2517, z: 3276 }, NURSE_OPEN = 2063, NURSE_STAND = { x: 2517, z: 3275 };
/** npcs within 2 of a tile: [type, x, z] (read via npcTileOf, the route tile) */
function nearNpcs(bot: SpeedBot, at: { x: number; z: number }): Array<[number, number, number]> {
    const out: Array<[number, number, number]> = [];
    for (let i = 0; i < bot.npcCount; i++) { const n = bot.npcs[bot.npcIndices[i]!]; if (!n) continue; const t = bot.npcTileOf(n); if (t && cheb(t, at) <= 2) out.push([n.typeId, t.x, t.z]); }
    return out;
}
/** fix 187 (allchaos qt25m: 10 door ops + 6 toggles all from (2547,3324), never on (2547,3325), with no npc and no loc on
 *  it: the edge (2547,3324)-(2547,3325) is blocked in that door state, the static path only knows that edge). Reach the
 *  door's stand tile round the east side, one tile per step: (2548,3324) -> (2548,3325) -> (2547,3325). BIO_HQ_EAST=0 reverts. */
async function toInnerStand(bot: SpeedBot): Promise<boolean> {
    const at = () => bot.tile().x === 2547 && bot.tile().z === 3325;
    if (at()) return true;
    await bot.stepTo(2547, 3325, 8);
    // qt30m: frozen on (2547,3324) for 1,000 t, no step in any direction (npcs never on the targets): a server-side dialog left
    // suspended by the HQ door's mourner ("In you go doc.") blocks moves the client sends. Close + page it, then step again.
    if (!at() && process.env.BIO_HQ_EAST !== '0') { bot.closeModal(); bot.resumeDialogPage(); bot.queueFlush(); await bot.tick(2); dismiss(bot); await bot.stepTo(2547, 3325, 8); }
    if (at() || process.env.BIO_HQ_EAST === '0') return at();
    for (const t of [{ x: 2548, z: 3324 }, { x: 2548, z: 3325 }, { x: 2547, z: 3325 }]) await bot.stepTo(t.x, t.z, 6);
    console.log(`[biohazard] inner stand via the east side: ${at()} at ${JSON.stringify(bot.tile())}`);
    return at();
}
/** SIM ONLY (session 8 HQ diagnosis): the engine's view of the inner door (GET /simcoll, plan/tools/add-simcoll.py): server
 *  position vs ours, the walls on the stand tile's edges and every door leaf the zones hold there. No-op off the sim. */
async function srvProbe(bot: SpeedBot, label: string): Promise<void> {
    if (process.env.SIM_LOCKSTEP !== '1' || !/^(localhost|127\.)/.test(process.env.LC_HOST ?? '') || process.env.BIO_PROBE === '0') return;
    try {
        const r = await fetch(`http://${process.env.LC_HOST}/simcoll?level=0&x0=2545&z0=3323&x1=2549&z1=3326&user=${bot.loginUser.toLowerCase()}`);
        if (!r.ok) { console.log(`[bioprobe] ${label}: /simcoll ${r.status}`); return; }
        const c = await r.json() as { tick: number; tiles: Array<{ x: number; z: number; f: string; locs: Array<{ t: number; a: number; act: boolean; lc: number }> }>; player: any };
        const t = (x: number, z: number) => c.tiles.find(q => q.x === x && q.z === z);
        const fl = (x: number, z: number) => parseInt(t(x, z)?.f ?? '0', 16);
        const leaves = c.tiles.flatMap(q => q.locs.filter(l => l.t === 1530 || l.t === 1531).map(l => `${l.t}@${q.x},${q.z}/a${l.a}${l.act ? '' : '(off)'}/lc${l.lc}`)).join(' ');
        const p = c.player;
        console.log(`[bioprobe] ${label}: me ${JSON.stringify(bot.tile())} SERVER ${p ? `${p.x},${p.z} L${p.level} delayed ${p.delayed} busy ${p.busy} modal ${p.modalMain}/${p.modalChat} script ${p.script} wp ${p.wp}` : '?'} | edge 3324.N ${!!(fl(2547, 3324) & 0x2)} 3325.S ${!!(fl(2547, 3325) & 0x20)} doorway 2546.E ${!!(fl(2546, 3325) & 0x8)} 2547.W ${!!(fl(2547, 3325) & 0x80)} flags 2547,3324=${t(2547, 3324)?.f} 2547,3325=${t(2547, 3325)?.f} 2546,3325=${t(2546, 3325)?.f} 2548,3324=${t(2548, 3324)?.f} | ents ${JSON.stringify((c as any).ents ?? [])} | leaves ${leaves || '-'} | client live 2546,3325=${bot.liveLocs.get('0,2546,3325')} 2547,3325=${bot.liveLocs.get('0,2547,3325')} tracker ${bot.doorTracker?.closedDoorAt(0, 2546, 3325) ? 'shut' : 'open/unknown'}`);
    } catch (e) { console.log(`[bioprobe] ${label}: ${(e as Error).message.slice(0, 80)}`); }
}
/** fix 196 (session 8 ROOT CAUSE of open item #1, caught in allchaos qt33m with the engine probe /simcoll): at (2547,3324)
 *  with the inner door shut the walls were clear (3324.N / 3325.S false), server and client agreed on the tile, no delay or
 *  modal, but the ground-floor mourners (369 mournerstew3 / 371 mournerstew1, 13-25 hp, respawn 140 t) stood on the stand
 *  tile (2547,3325), the doorway (2546,3325) and round them. A player's step is blocked by any npc tile
 *  (Player.blockWalkFlag = BLOCK_NPC_AND_PLAYERS, which npcs set: CollisionEngine.changeNpc). After ~20k engine ticks the
 *  mourners have wandered into the 1-wide door corridor; a fork restarts the engine (spawn positions) = why forks passed.
 *  Kill the mourners on the corridor tiles (op2 Attack; we are cb 100+), then step. BIO_HQ_CLEAR=0 reverts. */
const HQ_MOURNERS = [369, 370, 371];
// the path tiles through the inner doorway only (qt35m: attacking mourners on (2546,3324)/(2545,3324) behind the SHUT door was
// pointless, 'moved off'/'still there' 3-16 t each); with the door shut only the entrance-room tile is reachable
const CORRIDOR = [{ x: 2547, z: 3325 }, { x: 2546, z: 3325 }, { x: 2545, z: 3325 }, { x: 2544, z: 3325 }];
async function clearCorridor(bot: SpeedBot, label: string): Promise<number> {
    if (process.env.BIO_HQ_CLEAR === '0' || bot.minusedlevel !== 0) return 0;
    let kills = 0;
    for (let k = 0; k < 6; k++) {
        const shutNow = !!bot.doorTracker?.closedDoorAt(0, 2546, 3325), east = bot.tile().x >= 2547;
        const on = npcsOf(bot, HQ_MOURNERS).filter(n => CORRIDOR.some(t => t.x === n.x && t.z === n.z) && (!shutNow || (n.x >= 2547) === east))
            .sort((a, b) => cheb(bot.tile(), a) - cheb(bot.tile(), b));
        const m = on[0]; if (!m) break;
        const t0 = bot.tickCount, idx = m.idx;
        dismiss(bot);
        opNpcGo(bot, m, 2); bot.queueFlush();
        const gone = () => !npcsOf(bot, HQ_MOURNERS).some(n => n.idx === idx);
        const off = () => !npcsOf(bot, HQ_MOURNERS).some(n => n.idx === idx && CORRIDOR.some(t => t.x === n.x && t.z === n.z));
        await bot.until(() => gone() || off(), 16);
        if (gone()) kills++;
        console.log(`[biohazard] ${label}: mourner ${m.type} on (${m.x},${m.z}) attacked: ${gone() ? 'dead' : off() ? 'moved off' : 'still there'} (${bot.tickCount - t0} t)`);
    }
    return kills;
}
/** fix 207 (allchaos qt38m/qt40m: 3 attempts each lost at 'hq-up' with fixes 172-196 in place: the toggle/step pile ops the
 *  shut door from the DIAGONAL tile (discarded), steps toward tiles a mourner stands on and gives up after a few ticks). One
 *  state machine for entrance room -> stairs room, one tile and one op per tick, up to 240 t:
 *    on (2547,3324): door open (leaf 1531 walls our N edge) -> close it from here (the wall is on our edge: in reach);
 *                    door shut -> mourner on (2547,3325)? attack it : step N
 *    on (2547,3325): door shut -> open it (we stand on its tile's east side: in reach);
 *                    door open -> mourner on (2546,3325)? attack it : step W
 *    on (2546,3325): mourner on (2545,3325)? attack it : step W;  x <= 2545: done.
 *    anywhere else in the entrance room: walk to (2547,3324).
 *  The door state is the tracker's; the ops alternate when a state reading does not change for 6 t. BIO_HQ_FSM=0 reverts. */
async function crossInnerDoor(bot: SpeedBot): Promise<boolean> {
    const t0 = bot.tickCount; let lastOp = -10, lastKey = '', same = 0, kills = 0;
    const done = () => bot.minusedlevel === 0 && bot.tile().x <= 2545 && bot.tile().z >= 3322 && bot.tile().z <= 3328;
    const at = (x: number, z: number) => bot.tile().x === x && bot.tile().z === z;
    const mourner = (x: number, z: number) => npcsOf(bot, HQ_MOURNERS).find(n => n.x === x && n.z === z);
    while (!done() && bot.tickCount - t0 < 240 && bot.minusedlevel === 0) {
        if (bot.chatModalId !== -1 || bot.mainModalId !== -1) { dismiss(bot); bot.closeModal(); bot.queueFlush(); await bot.tick(1); continue; }
        const shut = !!bot.doorTracker?.closedDoorAt(0, 2546, 3325) || bot.liveLocs.get('0,2546,3325') === 1530;
        const open = !shut && bot.liveLocs.get('0,2547,3325') === 1531;
        const key = `${bot.tile().x},${bot.tile().z},${shut ? 's' : open ? 'o' : '?'}`;
        same = key === lastKey ? same + 1 : 0; lastKey = key;
        const flip = Math.floor(same / 6) % 2 === 1;   // a reading that does not change for 6 t: try the other op
        const attack = async (m: NpcRef) => { opNpcGo(bot, m, 2); bot.queueFlush(); await bot.until(() => !mourner(m.x, m.z), 12); if (!npcsOf(bot, HQ_MOURNERS).some(n => n.idx === m.idx)) kills++; };
        if (at(2547, 3324)) {
            if ((open && !flip) || (!open && !shut && flip)) { if (bot.tickCount - lastOp >= 3) { bot.opLoc(2547, 3325, 1531, 1); bot.queueFlush(); lastOp = bot.tickCount; } await bot.tick(1); continue; }
            const m = mourner(2547, 3325); if (m) { await attack(m); continue; }
            bot.sendRoute([{ x: 2547, z: 3325 }]); await bot.tick(1); continue;
        }
        if (at(2547, 3325)) {
            if ((shut && !flip) || (!shut && !open && !flip)) { if (bot.tickCount - lastOp >= 3) { bot.opLoc(2546, 3325, 1530, 1); bot.queueFlush(); lastOp = bot.tickCount; } await bot.tick(1); continue; }
            const m = mourner(2546, 3325); if (m) { await attack(m); continue; }
            bot.sendRoute([{ x: 2546, z: 3325 }]); await bot.tick(1); continue;
        }
        if (at(2546, 3325)) { const m = mourner(2545, 3325); if (m) { await attack(m); continue; } bot.sendRoute([{ x: 2545, z: 3325 }]); await bot.tick(1); continue; }
        if (inHQ0(bot) && bot.tile().x >= 2547) { await bot.stepTo(2547, 3324, 8); continue; }
        break;
    }
    console.log(`[biohazard] inner door FSM: ${done() ? 'through' : 'NOT through'} in ${bot.tickCount - t0} t at ${JSON.stringify(bot.tile())} (mourners killed ${kills})`);
    if (!done()) await srvProbe(bot, 'FSM end');
    return done();
}
const HQ_DOOR_S = { id: 2036, x: 2551, z: 3320 }, HQ_STAIRS = { id: 1738, x: 2542, z: 3324 }, HQ_STAIRS_TOP = { id: 1740, x: 2543, z: 3325, level: 1 };
const HQ_DOOR_UP = { id: 2034, x: 2547, z: 3325, level: 1 }, HQ_GATE = { id: 2058, x: 2551, z: 3326, level: 1 }, HQ_CRATE = { id: 2064, x: 2554, z: 3327, level: 1 };
const MANHOLE = { id: 2543, x: 2529, z: 3303 }, MANHOLE_OPEN = 2544, MANHOLE_STAND = { x: 2530, z: 3303 }, MUD_PILE = { id: 2533, x: 2561, z: 9738 };
const BARNABY = 381, CUSTOMS = 380, BARNABY_AT = { x: 2679, z: 3275 }, MUSA_CUSTOMS_AT = { x: 2954, z: 3147 };
// disembark planks are named for the DESTINATION city (gangplank.loc; gangplank.rs2:28-39 _gangplank_disembark)
const PLANK_BRIM = { id: 2088, x: 2774, z: 3234, level: 1 }, PLANK_SARIM = { id: 2084, x: 3031, z: 3217, level: 1 };
const HOPS1 = 340, HOPS2 = 341, CHANCY1 = 338, CHANCY2 = 339, DAVINCI1 = 336, DAVINCI2 = 337;
const HOPS1_AT = { x: 2931, z: 3219 }, CHANCY1_AT = { x: 2935, z: 3219 }, DAVINCI1_AT = { x: 2933, z: 3219 };
const HOPS2_AT = { x: 3268, z: 3389 }, CHANCY2_AT = { x: 3270, z: 3391 }, DAVINCI2_AT = { x: 3274, z: 3390 };
// the gate into Guidor's quarter (varrock_gate category, east_gate.rs2:4-47; bioguard1 at 3263,3407 searches from the west)
const VGATE = { id: 2050, x: 3264, z: 3405 }, GATE_WEST = { x: 3263, z: 3405 };
const CHEMIST_AT = { x: 2934, z: 3210 }, GUIDOR_DOOR = { id: 2032, x: 3282, z: 3382 }, GUIDOR_AT = { x: 3285, z: 3381 };
const CASTLE_STAIRS = { id: 1722, x: 2571, z: 3295 }, LATHAS_AT = { x: 2578, z: 3293 };

const inSewer = (b: SpeedBot) => b.tile().z > 9000;
const inWest = (b: SpeedBot) => { const t = b.tile(); return !inSewer(b) && t.x <= 2557 && t.z <= 3340 && t.z >= 3260; };
/** Elena's house: door on the S edge of (2592,3339) -> inside = z <= 3338 */
const inElena = (b: SpeedBot) => { const t = b.tile(); return t.x >= 2587 && t.x <= 2597 && t.z >= 3332 && t.z <= 3338; };
const inHQ0 = (b: SpeedBot) => { const t = b.tile(); return b.minusedlevel === 0 && t.x >= 2540 && t.x <= 2557 && t.z >= 3321 && t.z <= 3327; };

export async function run(bot: SpeedBot, o: { log?: boolean } = {}): Promise<{ ok: boolean; ticks: number; msg: string; marks?: Record<string, number> }> {
    await nav();
    const c = ctx(bot, o.log ?? true);
    trace(bot, c.t0);
    const qp0 = qp(bot);
    bot.holdDialogs = true;
    const dw = deathWatch(c);
    try {
        await body(c, qp0, dw.dead);
        return { ok: true, ticks: bot.tickCount - c.t0, msg: `quest points ${qp0} -> ${qp(bot)}`, marks: c.marks };
    } catch (e) {
        return { ok: false, ticks: bot.tickCount - c.t0, msg: (e as Error).message, marks: c.marks };
    } finally { dw.stop(); bot.holdDialogs = false; }
}

/** Enter Elena's house (scripted door: from the door tile it teleports us in) */
async function enterElena(c: Ctx): Promise<void> {
    const bot = c.bot;
    if (inElena(bot)) return;
    if (!(await opLocUntil(c, ELENA_DOOR, 1, () => inElena(bot), { label: 'elena-door-in', stand: ELENA_DOOR_OUT }))) fail(c, 'elena-door-in');
}
async function leaveElena(c: Ctx): Promise<void> {
    const bot = c.bot;
    if (!inElena(bot)) return;
    if (!(await opLocUntil(c, ELENA_DOOR, 1, () => !inElena(bot), { label: 'elena-door-out', stand: ELENA_DOOR_IN }))) fail(c, 'elena-door-out');
}

/** session 10 resume, the stages after the distillator (BIO_RESUME covers 4/6/7 by held items): the quest JOURNAL
 *  (quest_biohazard/scripts/biohazard_journal.rs2) -> %biohazard, first match wins (latest first) */
const BIO_STAGES: Array<[RegExp, number]> = [
    [/QUEST COMPLETE/i, 16], [/confront the\s+King of East Ardougne/i, 15], [/see what Elena thinks of this/i, 14],
    [/smuggle the items to\s+Guidor/i, 12], [/take the following items to\s+Guidor/i, 10],
];
/** the overland/ship leg to Rimmington from wherever a stage-10 resume stands. NEVER a teleport: it deletes the plague
 *  sample (teleport.rs2:94-97). */
async function toRimmington(c: Ctx, need: (ok: boolean, label: string) => void): Promise<void> {
    const bot = c.bot, t = () => bot.tile();
    const nearRimm = () => t().x >= 2880 && t().x <= 3070 && t().z >= 3140 && t().z <= 3300 && bot.minusedlevel === 0;
    const onKaramja = () => t().x >= 2740 && t().x < 2970 && t().z >= 3120 && t().z <= 3250 && bot.minusedlevel === 0;
    if (nearRimm()) return;
    if (bot.minusedlevel === 1 && t().x > 3000) { need(await opLocUntil(c, PLANK_SARIM, 1, () => bot.minusedlevel === 0, { label: 'plank-sarim (resume)' }), 'plank-sarim (resume)'); return; }
    if (bot.minusedlevel === 1 && t().x > 2700 && t().x < 2800) need(await opLocUntil(c, PLANK_BRIM, 1, () => bot.minusedlevel === 0, { label: 'plank-brimhaven (resume)' }), 'plank-brimhaven (resume)');
    if (!onKaramja()) {
        // East Ardougne (Elena's house, the docks): Captain Barnaby
        if (!(t().x >= 2560 && t().x <= 2720 && t().z >= 3250 && t().z <= 3400)) fail(c, `resume: no overland route to Rimmington from ${JSON.stringify(bot.pos())}`);
        await leaveElena(c);
        need(await talkTo(c, BARNABY, BARNABY_AT, [/^Yes please\.$/], () => bot.minusedlevel === 1 && bot.tile().x > 2700, { label: 'ship-brimhaven', maxTicks: 300 }), 'ship-brimhaven');
        dismiss(bot);
        need(await opLocUntil(c, PLANK_BRIM, 1, () => bot.minusedlevel === 0, { label: 'plank-brimhaven' }), 'plank-brimhaven');
    }
    await walkLive(bot, { x: MUSA_CUSTOMS_AT.x - 1, z: MUSA_CUSTOMS_AT.z + 1 }, { near: 3, maxTicks: 400 });
    need(await talkTo(c, CUSTOMS, MUSA_CUSTOMS_AT, [/^Can I journey on this ship\?$/, /^Search away, I have nothing to hide\.$/, /^Ok\.$/],
        () => bot.minusedlevel === 1 && bot.tile().x > 3000, { label: 'ship-sarim', maxTicks: 400 }), 'ship-sarim');
    dismiss(bot);
    need(await opLocUntil(c, PLANK_SARIM, 1, () => bot.minusedlevel === 0, { label: 'plank-sarim' }), 'plank-sarim');
}
/** stages 10-15 on a resume (the fresh path below is unchanged) */
async function lateBody(c: Ctx, need: (ok: boolean, label: string) => void, st: number): Promise<void> {
    const bot = c.bot;
    if (st <= 10) {
        if (!bot.count('plaguesample')) {
            // lost (a teleport deletes it): Elena replaces the sample and any missing vial (elena.rs2:29-56)
            await enterElena(c);
            need(await talkTo(c, ELENA, ELENA_AT, [/^I'm afraid I've lost some of the stuff/], () => bot.count('plaguesample') > 0, { label: 'elena-replace', maxTicks: 160 }), 'elena-replace');
            dismiss(bot);
        }
        await toRimmington(c, need);
        need(await talkTo(c, CHEMIST, CHEMIST_AT, [/^It's ok, I'm Elena's friend\.$/, /^I just need some touch paper for a guy called Guidor\.$/], () => bot.count('touch_paper') > 0, { label: 'chemist', maxTicks: 300 }), 'chemist');
        dismiss(bot);
    }
    if (st <= 12) {
        const inVarrockEast = () => bot.tile().x >= 3264 && bot.tile().x <= 3300 && bot.tile().z >= 3370 && bot.tile().z < 3420;
        // the errand boys: only the vials still held (a given one waits with the twin at the Dancing Donkey Inn)
        if (!inVarrockEast()) {
            for (const [type, at, vial, re] of [
                [HOPS1, HOPS1_AT, 'sulphuric_broline', /^You give him the vial of sulphuric broline/],
                [CHANCY1, CHANCY1_AT, 'liquid_honey', /^You give him the vial of liquid honey/],
                [DAVINCI1, DAVINCI1_AT, 'ethenea', /^You give him the vial of ethenea/],
            ] as Array<[number, Tile, string, RegExp]>) {
                if (!bot.count(vial)) continue;
                need(await talkTo(c, type, at, [re], () => bot.count(vial) === 0, { label: `errand-${vial}` }), `errand-${vial}`);
                dismiss(bot);
            }
            await walkLive(bot, { x: GATE_WEST.x, z: GATE_WEST.z }, { near: 0, maxTicks: 1500 });
            mark(c, 'walk-varrock');
            need(await opLocUntil(c, VGATE, 1, () => bot.tile().x >= 3264 && bot.tile().z < 3420, { label: 'varrock-gate', stand: GATE_WEST, answers: [/.*/], maxTicks: 8 }), 'varrock-gate');
            dismiss(bot);
        }
        for (const [type, at, vial] of [[HOPS2, HOPS2_AT, 'sulphuric_broline'], [CHANCY2, CHANCY2_AT, 'liquid_honey'], [DAVINCI2, DAVINCI2_AT, 'ethenea']] as Array<[number, Tile, string]>) {
            if (bot.count(vial)) continue;
            need(await talkTo(c, type, at, [/.*/], () => bot.count(vial) > 0, { label: `collect-${vial}` }), `collect-${vial}`);
            dismiss(bot);
        }
        need(await wear(bot, ['priest_gown', 'priest_robe']), 'wear-priest');
        need(await opLocUntil(c, GUIDOR_DOOR, 1, () => bot.tile().x >= 3283, { label: 'guidor-door', stand: { x: 3282, z: 3382 } }), 'guidor-door');
        need(await talkTo(c, GUIDOR, GUIDOR_AT, [/^I've come to ask your assistance/, /^I've been sent by your old pupil Elena\.$/, /^So what does that mean exactly\?$/],
            () => bot.count('plaguesample') === 0 && bot.count('touch_paper') === 0, { label: 'guidor' }), 'guidor');
        dismiss(bot);
    }
    if (st <= 14) {
        if (cheb(bot.tile(), ELENA_AT) > 40) { need((await tele(bot, 'ardougne_teleport')).ok, 'ardougne-tele'); mark(c, 'ardougne-tele'); }
        await enterElena(c);
        const king = textWatch(bot, /see the King of East Ardougne/i);
        need(await talkTo(c, ELENA, ELENA_AT, [/.*/], () => king(), { label: 'elena-report' }), 'elena-report');
        dismiss(bot);
    }
    await leaveElena(c);
    if (bot.minusedlevel !== 1) {
        await walkLive(bot, { x: CASTLE_STAIRS.x + 2, z: CASTLE_STAIRS.z }, { near: 2, maxTicks: 200 });
        need(await opLocUntil(c, CASTLE_STAIRS, 1, () => bot.minusedlevel === 1, { label: 'castle-up' }), 'castle-up');
    }
    const thv0 = bot.stat('thieving').xp;
    need(await talkTo(c, LATHAS, LATHAS_AT, [/^I don't understand\.\.\.$/], () => bot.stat('thieving').xp > thv0, { label: 'lathas' }), 'lathas');
    dismiss(bot);
}

async function body(c: Ctx, qp0: number, dead: () => boolean): Promise<void> {
    const bot = c.bot;
    const need = (ok: boolean, label: string) => { if (dead()) fail(c, `${label} (DIED)`); if (!ok) fail(c, label); failHook(`biohazard:${label}`); };
    // session 10: on a retry past the distillator, the journal stage drives the rest (BIO_LATE_RESUME=0 reverts)
    if (isResuming(bot) && process.env.BIO_LATE_RESUME !== '0' && process.env.BIO_RESUME !== '0') {
        dismiss(bot);
        const js = await journalStage(bot, 'biohazard', BIO_STAGES, 0, s => console.log(`[biohazard] ${s}`));
        if (js >= 16) return;
        if (js >= 10) { console.log(`[biohazard] late resume at stage ${js} from ${JSON.stringify(bot.pos())} L${bot.minusedlevel} sample ${bot.count('plaguesample')}`); return lateBody(c, need, js); }
    }
    for (const it of SUPPLY) if (bot.count(it.name) < it.n) fail(c, `missing ${it.name} ${bot.count(it.name)}/${it.n}`);
    const returnBy = (globalThis as any).process?.env?.BIO_RETURN === 'kilron' ? 'kilron' : 'manhole';
    // session 8 STAGE RESUME (the module had none: every retry died at 'elena-start', qt19-qt31). %biohazard is not
    // transmitted, so the stage is read from what we hold: distillator = found_distillator (7: out of the HQ, back east);
    // doctor's gown = poisoned_stew (6: the HQ; in our order the gown comes after the stew); the pigeon cage = released_pigeons
    // (4: Omart). East of the wall at stage 6/7 Omart lets us over again (omart.rs2:6-9). BIO_RESUME=0 reverts.
    const has = (n: string) => bot.count(n) > 0 || bot.isWorn(objId(n));
    const S = process.env.BIO_RESUME === '0' ? 0 : has('distillator') ? 7 : has('doctor_gown') ? 6 : has('pigeoncage') ? 4 : 0;
    if (S) console.log(`[biohazard] resume at stage ${S} (${S === 7 ? 'found_distillator' : S === 6 ? 'poisoned_stew' : 'released_pigeons'}) from ${JSON.stringify(bot.tile())} L${bot.minusedlevel}`);
    if (S === 6 && !inWest(bot) && !inHQ0(bot) && bot.minusedlevel === 0) {
        need(await talkTo(c, OMART, OMART_AT, [/^Ok, lets do it\.$/], () => inWest(bot), { label: 'omart-ladder (resume)', maxTicks: 160 }), 'omart-ladder (resume)');
        dismiss(bot);
    }
    if (S === 6 && !bot.isWorn(objId('doctor_gown'))) need(await wear(bot, ['doctor_gown']), 'wear-gown (resume)');

    if (S < 4) {
        // 1. Elena: start
        await enterElena(c);
        const started = textWatch(bot, /Jerico is in communication|lives next to the chapel/i);
        need(await talkTo(c, ELENA, ELENA_AT, [/^I'll try to retrieve it for you\.$/], () => started(), { label: 'elena-start' }), 'elena-start');
        dismiss(bot);
        await leaveElena(c);
        // 2. Jerico, his cupboard (birdfeed), the pigeons
        const omartTxt = textWatch(bot, /Omart is waiting for you/i);
        need(await talkTo(c, JERICO, JERICO_AT, [/.*/], () => omartTxt(), { label: 'jerico' }), 'jerico');
        dismiss(bot);
        for (let k = 0; k < 4 && !bot.count('birdfeed'); k++) {
            const open = bot.liveLocs.get(`0,${CUPBOARD_SHUT.x},${CUPBOARD_SHUT.z}`) === CUPBOARD_OPEN;
            if (!open) await opLocUntil(c, CUPBOARD_SHUT, 1, () => bot.liveLocs.get(`0,${CUPBOARD_SHUT.x},${CUPBOARD_SHUT.z}`) === CUPBOARD_OPEN, { label: 'cupboard-open', tries: 2, stand: CUPBOARD_STAND });
            else {
                const l = { ...locAt(CUPBOARD_SHUT.id, CUPBOARD_SHUT.x, CUPBOARD_SHUT.z), id: CUPBOARD_OPEN };
                opLocGo(bot, l, 1, CUPBOARD_STAND);
                await bot.until(() => inDialog(bot) || bot.count('birdfeed') > 0, 8);
                await finishDialog(bot, [/.*/], 10, () => bot.count('birdfeed') > 0);
            }
        }
        need(bot.count('birdfeed') > 0, 'birdfeed'); mark(c, 'birdfeed');
        dismiss(bot);
        if (!bot.count('pigeons')) need(await pickup(c, 'pigeons', PIGEONS_AT), 'pigeons');
        // 3. birdfeed on the watch tower, release the pigeons inside the zone
        need(await useOnLocUntil(c, 'birdfeed', TOWER, () => bot.count('birdfeed') === 0, { label: 'tower-feed' }), 'tower-feed');
        await bot.tick(2);   // p_delay(2) before the stage is set (quest_biohazard.rs2:37-38)
        const inZone = () => { const t = bot.tile(); return t.x >= 2559 && t.x <= 2565 && t.z >= 3299 && t.z <= 3307; };
        if (!inZone()) await walkLive(bot, { x: 2564, z: 3303 }, { near: 1, maxTicks: 30 });
        for (let k = 0; k < 4 && !bot.count('pigeoncage'); k++) {
            dismiss(bot);
            bot.opHeld1(objId('pigeons'), bot.slot('pigeons')); bot.queueFlush();
            await bot.until(() => bot.count('pigeoncage') > 0, 4);
        }
        need(bot.count('pigeoncage') > 0, 'pigeons-released'); mark(c, 'pigeons-released');
    }
    if (S < 6) {
        // 4. Omart: over the wall
        need(await talkTo(c, OMART, OMART_AT, [/^Ok, lets do it\.$/], () => inWest(bot), { label: 'omart-ladder', maxTicks: 120 }), 'omart-ladder');
        dismiss(bot);
        // 5. rotten apple in the stew, doctor's gown
        if (!bot.count('rottenapples')) need(await pickup(c, 'rottenapples', APPLE_AT), 'apple');
        // the cauldron stands in the mourners' yard behind a railing: climb the fence (2541,3331) in and out
        // (general_use/scripts/fence.rs2:1-20; the planners see the fence as a wall)
        const inYard = () => { const t = bot.tile(); return t.x >= 2542 && t.x <= 2555 && t.z >= 3329 && t.z <= 3333; };
        need(await opLocUntil(c, FENCE, 1, inYard, { label: 'fence-in', stand: { x: 2541, z: 3331 }, maxTicks: 4 }), 'fence-in');
        const stew = textWatch(bot, /quickly dissolves into the stew/i), nice = textWatch(bot, /That wasn't very nice/i);
        need(await useOnLocUntil(c, 'rottenapples', CAULDRON, () => bot.count('rottenapples') === 0, { label: 'cauldron' }), 'cauldron');
        await bot.until(() => nice(), 10);   // p_delay(3) + p_delay(2) (quest_biohazard.rs2:99-105): ops sent before the end are lost
        need(stew(), 'stew-poisoned');
        need(await opLocUntil(c, FENCE, 1, () => !inYard(), { label: 'fence-out', stand: { x: 2542, z: 3331 }, maxTicks: 4 }), 'fence-out');
        for (let k = 0; k < 4 && !bot.count('doctor_gown') && !bot.isWorn(objId('doctor_gown')); k++) {
            const open = bot.liveLocs.get(`0,${NURSE_SHUT.x},${NURSE_SHUT.z}`) === NURSE_OPEN;
            if (!open) await opLocUntil(c, NURSE_SHUT, 1, () => bot.liveLocs.get(`0,${NURSE_SHUT.x},${NURSE_SHUT.z}`) === NURSE_OPEN, { label: 'nurse-open', tries: 2, stand: NURSE_STAND });
            else {
                const l = { ...locAt(NURSE_SHUT.id, NURSE_SHUT.x, NURSE_SHUT.z), id: NURSE_OPEN };
                opLocGo(bot, l, 1, NURSE_STAND);
                await bot.until(() => bot.count('doctor_gown') > 0, 8);
            }
        }
        need(bot.count('doctor_gown') > 0 || bot.isWorn(objId('doctor_gown')), 'doctor-gown'); mark(c, 'doctor-gown');
        need(await wear(bot, ['doctor_gown']), 'wear-gown');
    }
    // session 6 (allchaos qt2m 'hq-up' 552 t at (2540,3327)): the HQ's inner door 1530 (2546,3325, east edge) between the
    // entrance room and the stairs room was shut by the chaos doors; the walker went round outside and every stairs op
    // was discarded. Open it from our side when the door tracker says it is closed. BIO_HQ_INNER=0 reverts.
    const innerDoor = async (stand: { x: number; z: number }) => {
        const shut = () => !!bot.doorTracker?.closedDoorAt(0, 2546, 3325);
        if (process.env.BIO_HQ_INNER === '0' || bot.minusedlevel !== 0 || !shut()) return;
        if (cheb(bot.tile(), stand) > 0) await bot.walkTo(stand.x, stand.z, { maxTicks: 40, log: false });
        // fix 177 (allchaos qt20m: 4 ops from the DIAGONAL tile (2547,3324) with a mourner in the doorway: STILL shut): stand on
        // the exact tile (walkTo's default 'near' accepted the diagonal) and keep trying while the doorway npc wanders off.
        const tries = process.env.BIO_HQ_RAW === '0' ? 4 : 10;
        for (let k = 0; k < tries && shut(); k++) {
            if (process.env.BIO_HQ_RAW !== '0' && cheb(bot.tile(), stand) > 0) { await clearCorridor(bot, `inner door try ${k + 1}`); await toInnerStand(bot); }
            bot.opLoc(2546, 3325, 1530, 1); bot.queueFlush(); await bot.until(() => !shut(), k < 4 ? 4 : 8);
            if (shut() && (k === 3 || k === 9)) console.log(`[biohazard] inner door try ${k + 1}: at ${JSON.stringify(bot.tile())}, npcs ${JSON.stringify(nearNpcs(bot, stand))}`);
        }
        console.log(`[biohazard] HQ inner door was shut: ${shut() ? 'STILL shut' : 'opened'} from ${JSON.stringify(bot.tile())}`);
    };
    // 6. mourner HQ: door (gown), stairs, door up, kill a sick mourner for the key, gate, crate
    if (S < 7) {
        if (bot.minusedlevel === 0) {   // a resumed attempt may already stand upstairs (L1)
        need(await opLocUntil(c, HQ_DOOR_S, 1, () => inHQ0(bot), { label: 'hq-door', stand: { x: 2551, z: 3320 }, answers: [/.*/] }), 'hq-door');
        dismiss(bot);
        await srvProbe(bot, 'after hq-door');
        // session 6 (allchaos qt11m 'hq-up' 2,613 t ON the south door tile (2551,3320): hq-door's done (inHQ0) is already true
        // there and every stairs op from the doorway was discarded): one step inside first. BIO_HQ_INNER=0 reverts.
        if (process.env.BIO_HQ_INNER !== '0' && bot.minusedlevel === 0 && bot.tile().x === 2551 && bot.tile().z === 3320) {
            for (let k = 0; k < 3 && bot.tile().z === 3320; k++) { await bot.walkTo(2551, 3321, { near: 0, maxTicks: 8, log: false }); }
            console.log(`[biohazard] off the HQ doorway: ${JSON.stringify(bot.tile())}`);
        }
        const fsmOk = process.env.BIO_HQ_FSM !== '0' && bot.minusedlevel === 0 && inHQ0(bot) && await crossInnerDoor(bot);
        if (!fsmOk) await innerDoor({ x: 2547, z: 3325 });
        // fix 172 (allchaos qt19m 'hq-up' 564 t: inner door 1530 OPEN (leaf 1531 on 2547,3325) by the chaos doors; the live planner
        // walls the open leaf and routed out through the south door, wedged, wandered round outside). The static path through the
        // inner doorway is 9 tiles: send it raw (server collision decides) into the stairs room; if that does not get us past the
        // doorway, toggle the leaf (op1) and try again, twice. BIO_HQ_RAW=0 reverts.
        if (!fsmOk && process.env.BIO_HQ_RAW !== '0' && inHQ0(bot) && bot.tile().x >= 2547) {
            let r = await bot.stepTo(2545, 3325, 20);
            if (!r.ok) { await srvProbe(bot, 'raw path stuck'); await clearCorridor(bot, 'raw path'); r = await bot.stepTo(2545, 3325, 20); }
            if (!r.ok) console.log(`[biohazard] raw path stuck at ${JSON.stringify(bot.tile())}: inner door ${bot.doorTracker?.closedDoorAt(0, 2546, 3325) ? 'shut' : 'open/unknown'}, live loc 2546,3325=${bot.liveLocs.get('0,2546,3325')} 2547,3325=${bot.liveLocs.get('0,2547,3325')}, npcs ${JSON.stringify(nearNpcs(bot, { x: 2547, z: 3325 }))}`);
            // qt23/qt23f: stuck at (2547,3324) with the chaos-OPEN leaf 1531 standing on (2547,3325); one close + step got through
            // in qt23f, two toggles (close, re-open) did not in qt23: up to 6 toggles, a pause for the doorway mourners between
            for (let k = 0; k < 6 && bot.tile().x >= 2547 && inHQ0(bot); k++) {
                const lf = bot.doorTracker?.closedDoorAt(0, 2546, 3325) ? { x: 2546, z: 3325, id: 1530 } : { x: 2547, z: 3325, id: 1531 };
                await clearCorridor(bot, `toggle ${k + 1}`);
                if (process.env.BIO_HQ_EAST !== '0') await toInnerStand(bot);
                bot.opLoc(lf.x, lf.z, lf.id, 1); bot.queueFlush(); await bot.tick(3);
                r = await bot.stepTo(2545, 3325, 20);
                if (!r.ok) await srvProbe(bot, `toggle ${k + 1} (${lf.id})`);
                if (!r.ok) { console.log(`[biohazard] toggle ${k + 1} (${lf.id}): still at ${JSON.stringify(bot.tile())}, npcs ${JSON.stringify(nearNpcs(bot, { x: 2547, z: 3325 }))}`); await bot.tick(k % 2 ? 4 : 1); }
            }
            console.log(`[biohazard] into the stairs room (raw): ${r.ok} at ${JSON.stringify(bot.tile())}`);
        }
        need(await opLocUntil(c, HQ_STAIRS, 1, () => bot.minusedlevel === 1, { label: 'hq-up' }), 'hq-up');
        }
        need(await opLocUntil(c, HQ_DOOR_UP, 1, () => bot.minusedlevel === 1 && bot.tile().x >= 2547, { label: 'hq-door-up', stand: { x: 2546, z: 3325 } }), 'hq-door-up');
        // the sick mourners (npc 370, cl 13, mourner.rs2:35-80): melee sets %npc_aggressive_player (player_melee.rs2:49), the
        // death queue then gives the key (mourner.rs2:68-80)
        // session 11 fix 365 (qx190m/qx191m 'mourner-key failed at (2551,3326,L1)', +817/+804 t, same batch): the pick below was
        // re-made every 4 t from npcsOf (distance order, ties by slot) and flipped to a 2nd mourner after the first hit (the 1st
        // stepped to x 2552, or a d1 tie). The 1st fought back; this room is single-way, so every OPNPC on the 2nd was refused
        // ('I'm already under attack!', player_combat.rs2:116-119; optrace 'target cleared' every 4 t from eng-qx190 t21743) and each
        // re-op cancelled our retaliation: 120 tries, hp 76 -> 62, no kill. Stay on the mourner fighting us (adjacent, facing a
        // player) or the last one attacked. BH_STICKY=0 reverts.
        let lastM = -1;
        for (let k = 0; k < 120 && !bot.count('mournerkeytw'); k++) {
            if (dead()) fail(c, 'mourner fight (DIED)');
            dismiss(bot);
            // route runner (fix 136, qrq9m 'mourner-key' after 480 t, no detail): after 20 tries also any sick mourner within 8 on
            // this floor; a diagnostic line every 30 tries
            const all = npcsOf(bot, SICK_MOURNER);
            const sticky = process.env.BH_STICKY === '0' ? undefined
                : all.find(q => q.d <= 1 && Number((bot.npcs[q.idx] as any)?.faceEntity ?? -1) >= 32768) ?? all.find(q => q.idx === lastM);
            const m = sticky ?? all.find(q => q.x >= 2547 && q.x <= 2551) ?? (k >= 20 ? all.find(q => Math.max(Math.abs(q.x - bot.tile().x), Math.abs(q.z - bot.tile().z)) <= 8) : undefined);
            if (k % 30 === 29) console.log(`[biohazard] mourner-key try ${k + 1}: me ${JSON.stringify(bot.tile())} L${bot.minusedlevel} hp ${bot.stat('hitpoints').level} mourners ${all.map(q => `${q.x},${q.z}`).join(' ') || '-'} free ${bot.free()}`);
            if (m) { opNpcGo(bot, m, 2); lastM = m.idx; }
            await bot.until(() => bot.count('mournerkeytw') > 0, 4);
        }
        need(bot.count('mournerkeytw') > 0, 'mourner-key'); mark(c, 'mourner-key');
        need(await useOnLocUntil(c, 'mournerkeytw', HQ_GATE, () => bot.tile().x >= 2552, { label: 'hq-gate', stand: { x: 2551, z: 3326 } }), 'hq-gate');
        need(await opLocUntil(c, HQ_CRATE, 1, () => bot.count('distillator') > 0, { label: 'crate', maxTicks: 4 }), 'crate');
    }
    // 7. out of the HQ
    // session 8 (allchaos qt35m: 'hq-door-out' failed in the mourner-crowded corridor after the crate; its retry teleported to
    // Ardougne WITH the distillator and finished in 721 t): the distillator survives a teleport (only the plague sample is
    // deleted, teleport.rs2:94-97), so leave by Ardougne Teleport straight to Elena: no inner door, no south door, no manhole
    // and sewer. Needs 2 law + 2 water on top of the Varrock-return pair (the travel kit carries 12+). BIO_OUT=walk reverts.
    if (process.env.BIO_OUT !== 'walk' && bot.count('distillator') > 0 && (bot.minusedlevel === 1 || inHQ0(bot) || inWest(bot)) && bot.count('lawrune') >= 4 && bot.count('waterrune') >= 4) {
        dismiss(bot);
        const r = await tele(bot, 'ardougne_teleport');
        console.log(`[biohazard] out of the HQ by Ardougne Teleport: ${r.ok} -> ${JSON.stringify(bot.tile())}`);
    }
    if ((S < 7 && !(process.env.BIO_OUT !== 'walk' && !inWest(bot) && !inHQ0(bot) && bot.minusedlevel === 0)) || bot.minusedlevel === 1 || inHQ0(bot)) {
        need(await opLocUntil(c, HQ_GATE, 1, () => bot.tile().x <= 2551, { label: 'hq-gate-out', stand: { x: 2552, z: 3326 } }), 'hq-gate-out');
        need(await opLocUntil(c, HQ_DOOR_UP, 1, () => bot.tile().x <= 2546, { label: 'hq-door-up-out', stand: { x: 2547, z: 3325 } }), 'hq-door-up-out');
        need(await opLocUntil(c, HQ_STAIRS_TOP, 1, () => bot.minusedlevel === 0, { label: 'hq-down' }), 'hq-down');
        await innerDoor({ x: 2546, z: 3325 });
        need(await opLocUntil(c, HQ_DOOR_S, 1, () => !inHQ0(bot), { label: 'hq-door-out', stand: { x: 2551, z: 3321 } }), 'hq-door-out');
    }
    // 8. back east
    if (inWest(bot) || inHQ0(bot) || inSewer(bot)) {
        if (returnBy === 'kilron') {
            need(await talkTo(c, KILRON, KILRON_AT, [/^Yes I do\.$/], () => !inWest(bot), { label: 'kilron-ladder', maxTicks: 120 }), 'kilron-ladder');
        } else {
            for (let k = 0; k < 5 && !inSewer(bot); k++) {
                dismiss(bot);
                const live = bot.liveLocs.get(`0,${MANHOLE.x},${MANHOLE.z}`);
                const id = live === MANHOLE_OPEN ? MANHOLE_OPEN : MANHOLE.id;
                const l = { ...locAt(MANHOLE.id, MANHOLE.x, MANHOLE.z), id };
                if (cheb(bot.tile(), MANHOLE_STAND) > 2) await walkLive(bot, { x: MANHOLE_STAND.x, z: MANHOLE_STAND.z }, { near: 1, maxTicks: 80 });
                opLocGo(bot, l, 1, MANHOLE_STAND);
                await bot.until(() => inSewer(bot) || (id !== MANHOLE_OPEN && bot.liveLocs.get(`0,${MANHOLE.x},${MANHOLE.z}`) === MANHOLE_OPEN), 8);
            }
            need(inSewer(bot), 'manhole'); mark(c, 'manhole');
            need(await opLocUntil(c, MUD_PILE, 1, () => !inSewer(bot), { label: 'mud-pile' }), 'mud-pile');
        }
        dismiss(bot);
    }
    // 9. Elena: distillator -> vials + sample (each needs > 1 free slot)
    if (bot.free() < 5) fail(c, `need 5 free slots for Elena's vials, have ${bot.free()}`);
    await enterElena(c);
    need(await talkTo(c, ELENA, ELENA_AT, [/.*/], () => bot.count('plaguesample') > 0 && bot.count('ethenea') > 0, { label: 'elena-distillator', maxTicks: 120 }), 'elena-distillator');
    dismiss(bot);
    // 10. To the Rimmington chemist WITHOUT teleporting: any teleport destroys the plague sample (teleport.rs2:94-97,
    //     post_tele_checks; ships use p_telejump and keep it). Overland Ardougne -> Rimmington is 697 tiles (navgrid);
    //     ship: Ardougne -> Brimhaven (Captain Barnaby), walk Karamja to Musa Point (211 tiles), customs officer ->
    //     Port Sarim, walk to Rimmington (98 tiles). [A/B: BIO_RIMM=walk|ship]
    await leaveElena(c);
    if ((globalThis as any).process?.env?.BIO_RIMM === 'walk') {
        await walkLive(bot, { x: CHEMIST_AT.x, z: CHEMIST_AT.z + 3 }, { near: 3, maxTicks: 1500 });
    } else {
        need(await talkTo(c, BARNABY, BARNABY_AT, [/^Yes please\.$/], () => bot.minusedlevel === 1 && bot.tile().x > 2700, { label: 'ship-brimhaven', maxTicks: 300 }), 'ship-brimhaven');
        dismiss(bot);
        need(await opLocUntil(c, PLANK_BRIM, 1, () => bot.minusedlevel === 0, { label: 'plank-brimhaven' }), 'plank-brimhaven');
        // walk to Musa Point first: the nearest customs officer at the Brimhaven landing sails back to ARDOUGNE
        // (customs_officer.rs2:81-85: npc x < 2815)
        await walkLive(bot, { x: MUSA_CUSTOMS_AT.x - 1, z: MUSA_CUSTOMS_AT.z + 1 }, { near: 3, maxTicks: 400 });
        need(await talkTo(c, CUSTOMS, MUSA_CUSTOMS_AT, [/^Can I journey on this ship\?$/, /^Search away, I have nothing to hide\.$/, /^Ok\.$/],
            () => bot.minusedlevel === 1 && bot.tile().x > 3000, { label: 'ship-sarim', maxTicks: 400 }), 'ship-sarim');
        dismiss(bot);
        need(await opLocUntil(c, PLANK_SARIM, 1, () => bot.minusedlevel === 0, { label: 'plank-sarim' }), 'plank-sarim');
    }
    need(await talkTo(c, CHEMIST, CHEMIST_AT, [/^It's ok, I'm Elena's friend\.$/, /^I just need some touch paper for a guy called Guidor\.$/], () => bot.count('touch_paper') > 0, { label: 'chemist', maxTicks: 300 }), 'chemist');
    dismiss(bot);
    // the errand boys outside take one vial each to the Dancing Donkey Inn (their twins already stand there): the guard at
    // the gate into Guidor's quarter (3264,3405) confiscates any vial we carry (east_gate.rs2:14-39). Correct vial per
    // boy: Hops <- sulphuric broline (hops.rs2:150-160), Chancy <- liquid honey (chancy.rs2:32-42), Da Vinci <- ethenea
    // (devinci.rs2:20-28); a wrong one is lost.
    for (const [type, at, vial, re] of [
        [HOPS1, HOPS1_AT, 'sulphuric_broline', /^You give him the vial of sulphuric broline/],
        [CHANCY1, CHANCY1_AT, 'liquid_honey', /^You give him the vial of liquid honey/],
        [DAVINCI1, DAVINCI1_AT, 'ethenea', /^You give him the vial of ethenea/],
    ] as Array<[number, Tile, string, RegExp]>) {
        need(await talkTo(c, type, at, [re], () => bot.count(vial) === 0, { label: `errand-${vial}` }), `errand-${vial}`);
        dismiss(bot);
    }
    // 11. walk to Varrock with the sample (no teleport), through the gate (searched, nothing to take), the Inn, Guidor
    await walkLive(bot, { x: GATE_WEST.x, z: GATE_WEST.z }, { near: 0, maxTicks: 1500 });
    mark(c, 'walk-varrock');
    need(await opLocUntil(c, VGATE, 1, () => bot.tile().x >= 3264 && bot.tile().z < 3420, { label: 'varrock-gate', stand: GATE_WEST, answers: [/.*/], maxTicks: 8 }), 'varrock-gate');
    dismiss(bot);
    for (const [type, at, vial] of [[HOPS2, HOPS2_AT, 'sulphuric_broline'], [CHANCY2, CHANCY2_AT, 'liquid_honey'], [DAVINCI2, DAVINCI2_AT, 'ethenea']] as Array<[number, Tile, string]>) {
        need(await talkTo(c, type, at, [/.*/], () => bot.count(vial) > 0, { label: `collect-${vial}` }), `collect-${vial}`);
        dismiss(bot);
    }
    need(await wear(bot, ['priest_gown', 'priest_robe']), 'wear-priest');
    need(await opLocUntil(c, GUIDOR_DOOR, 1, () => bot.tile().x >= 3283, { label: 'guidor-door', stand: { x: 3282, z: 3382 } }), 'guidor-door');
    need(await talkTo(c, GUIDOR, GUIDOR_AT, [/^I've come to ask your assistance/, /^I've been sent by your old pupil Elena\.$/, /^So what does that mean exactly\?$/],
        () => bot.count('plaguesample') === 0 && bot.count('touch_paper') === 0, { label: 'guidor' }), 'guidor');
    dismiss(bot);
    // 12. Ardougne teleport -> Elena -> King Lathas
    need((await tele(bot, 'ardougne_teleport')).ok, 'ardougne-tele'); mark(c, 'ardougne-tele');
    await enterElena(c);
    const king = textWatch(bot, /see the King of East Ardougne/i);
    need(await talkTo(c, ELENA, ELENA_AT, [/.*/], () => king(), { label: 'elena-report' }), 'elena-report');
    dismiss(bot);
    await leaveElena(c);
    if (bot.minusedlevel !== 1) {
        await walkLive(bot, { x: CASTLE_STAIRS.x + 2, z: CASTLE_STAIRS.z }, { near: 2, maxTicks: 200 });
        need(await opLocUntil(c, CASTLE_STAIRS, 1, () => bot.minusedlevel === 1, { label: 'castle-up' }), 'castle-up');
    }
    // completion observable: the reward thieving xp (quest_biohazard.rs2:159; qp is recounted from all quest varps, so a
    // sim-set prerequisite can move it earlier)
    const thv0 = bot.stat('thieving').xp;
    need(await talkTo(c, LATHAS, LATHAS_AT, [/^I don't understand\.\.\.$/], () => bot.stat('thieving').xp > thv0, { label: 'lathas' }), 'lathas');
    dismiss(bot);
}
