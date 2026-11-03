/// <reference types="bun" />
// q-dragon-slayer.ts — DRAGON SLAYER (F2P, 2 QP), cheat-free. Lane spine.
//
// Verified against the rev-289 content (paths relative to server/content/scripts):
//   stages  quests/quest_dragon/configs/quest_dragon.constant:1-17 (%dragonquest 1 guildmaster, 2 oziach, 3 bought ship,
//           7 repaired, 8 map to Ned, 9 sailed; %dragon_oracle 1 knows / 2 spoke / 3 through the door; %dragon_goblin 1).
//   Guildmaster   areas/area_varrock/scripts/guild_master.rs2:5-28 (choice 2 -> %dragonquest 1 after the last page).
//   Oziach        areas/area_edgeville/scripts/oziach.rs2:36-171 (melzarkey on "first piece" :150-154; oracle flag :159;
//                 goblin flag :166; %dragonquest 2 :128). The three map-piece questions are all needed.
//   Oracle        areas/area_edgeville/scripts/oracle.rs2:9-18 (%dragon_oracle 2).
//   Magic door    quests/quest_dragon/scripts/magic_door.rs2:2-27 (mind bomb + unfired bowl + lobster pot + silk consumed);
//                 chest :31-61 (open, then search -> mappart3).
//   Melzar's maze quests/quest_dragon/scripts/melzars_maze.rs2 (melzardoor needs melzarkey, not consumed; every coloured
//                 door eats one key of its colour; each maze npc drops its key 100% to the killer :69-136; chest :140-170).
//                 Regions solved offline on the static collision (probe-maze.ts): rat -> red door (2926,3253) -> ladder
//                 (2928,3256) -> L1 ghost -> orange door (2931,3253) -> ladder (2934,3254) -> L2 skeleton -> yellow door
//                 (2924,3249) -> laddertop (2940,3240) -> L1 -> laddertop (2937,3240) -> L0 -> funladdertop (2932,3240) ->
//                 basement zombie -> blue door (2931,9643) -> Melzar -> magenta door (2929,9652) -> lesser demon -> green
//                 door (2936,9655) -> chest (2935,9657) -> ladder (2939,9657) -> funexit (2938,3252) -> melzardoor (key).
//   Wormbrain     quests/quest_dragon/scripts/wormbrain.rs2:82-141 (talk through the bars, aprange 3; 10,000 gp -> mappart2).
//   Map           quests/quest_dragon/scripts/crandor_map.rs2:12-45 (use a part on a part with all three -> dragonmap).
//   Klarense      areas/area_port_sarim/scripts/klarense.rs2:4-97 (2,000 gp -> %dragonquest 3).
//   Ship          quests/quest_dragon/scripts/lady_lumbridge.rs2 (gangplank :1-18; ladder top :33-41; 3 planks + 12 nails +
//                 hammer on the hole :51-91 -> %dragonquest 7, teleported one level up).
//   Ned           areas/area_draynor/scripts/ned.rs2:131-334 (hire :228-244, then use the map on him :119-125/:325-334 needs
//                 %dragonquest 7 + hired -> 8); on the ship L3: dragonslayer_ned.rs2:1-32 ("Yep lets go!" -> Crandor, 9).
//   Crandor       quests/quest_dragon/scripts/crandor.rs2 (rock opening :3-5 -> 2833,9658; lair gates :31-45 open at 9).
//   Elvarg        quests/quest_dragon/scripts/elvarg.rs2:2-15 (must land the LAST hit), :109-133 (dragonfire 70, 10 with
//                 the antidragon shield worn, 7 with Protect from Magic too); quest_dragon.rs2:26-36 (complete: str/def xp,
//                 teleport out of the lair, quest scroll).
// QP 32 gates only the Champions' Guild door (area_varrock/scripts/champions_guild.rs2:2).
import { SpeedBot, objId, objDebugName, cheb } from '../../../core.js';
import { nav, inDialog, npc, npcsOf, dismiss, msgsSince, trace } from '../../q-lib.js';
import { failHook } from '../journal.js';
import {
    mkLog, fail, go, locHere, openNpc, chat, converse, byText, textWatch, clearModals, useItemOnItem, useOnNpc, pickup,
    glory, teleSpell, wieldAll, guard, startWarningCloser, textLog, untilChat, killNpc, opLocUntil, useOnLocUntil, npcIdOf, packStr, type Item, type Log, type Tile,
    prayKeep,
} from './sp-lib.js';

export const QUEST = { name: 'Dragon Slayer', dir: 'quest_dragon', qp: 2 };
export const REQUIREMENTS = {
    quests: [] as string[],
    qp: 32,   // area_varrock/scripts/champions_guild.rs2:2 (the Guildmaster stands inside the guild)
    skills: {
        magic: [37, 'Falador teleport (dwarven mine -> Melzar\'s maze), magic_spells.dbrow falador_teleport levelrequired 37'],
        prayer: [43, 'Protect from Melee vs the lesser demon and Elvarg (elvarg melee is 3 of 4 attacks, elvarg.rs2:61-65)'],
        attack: [40, 'rune scimitar'],
    } as Record<string, [number, string]>,
    start: { x: 3191, z: 3361, level: 0 },   // just outside the Champions' Guild door (championdoor 3191,3363 a3)
    end: { x: 2846, z: 9636, level: 0 },     // dragon_complete teleports out of the lair (quest_dragon.rs2:27-29)
};
/** Worn at the start (tradeable; the shield is the Duke's but tradeable: shields.obj:244 has no tradeable=no). */
export const WEAR = ['rune_scimitar', 'rune_full_helm', 'rune_chainbody', 'rune_platelegs'];
export const SUPPLY: Item[] = [
    { name: 'rune_scimitar', n: 1 }, { name: 'rune_full_helm', n: 1 }, { name: 'rune_chainbody', n: 1 }, { name: 'rune_platelegs', n: 1 },
    { name: 'antidragonbreathshield', n: 1 },     // worn for Elvarg (elvarg.rs2:111); saves the Lumbridge Duke trip
    { name: 'amulet_of_glory_4', n: 1 },          // Edgeville (Oziach) + Draynor (Ned): 2 charges
    ...(process.env.DS_ORACLE === 'tele' ? [{ name: 'lawrune', n: 2 }, { name: 'airrune', n: 6 }, { name: 'waterrune', n: 2 }]
        : [{ name: 'lawrune', n: 1 }, { name: 'airrune', n: 3 }, { name: 'waterrune', n: 1 }]),   // Falador teleport(s)
    { name: 'wizards_mind_bomb', n: 1 }, { name: 'bowl_unfired', n: 1 }, { name: 'lobster_pot', n: 1 }, { name: 'silk', n: 1 },
    { name: 'coins', n: 12000 },                  // Wormbrain 10,000 + Klarense 2,000
    { name: 'woodplank', n: 3 }, { name: 'nails', n: 12 }, { name: 'hammer', n: 1 },
    { name: 'shark', n: 8 },
];
/** session 11 fix 288b: a spare set in the BANK only (route-legs bankStage) for a re-sail after a death / a teleport off
 *  Crandor: the retry's kit withdraws it (the shield is lost on death; the planks/nails went into the first repair).
 *  DS_RESAIL=0 = none. */
export const RESAIL_SPARE: Item[] = process.env.DS_RESAIL === '0' ? [] : [{ name: 'antidragonbreathshield', n: 1 }, { name: 'woodplank', n: 3 }, { name: 'nails', n: 12 }];

// npc ids (content/pack/npc.pack)
const N = {
    guildmaster: npcIdOf('guildmaster'), oziach: npcIdOf('oziach'), oracle: npcIdOf('oracle'), wormbrain: npcIdOf('wormbrain'),
    klarense: npcIdOf('klarense'), ned: npcIdOf('ned'), shipNed: npcIdOf('dragonslayer_ned'), elvarg: npcIdOf('elvarg'),
    rat: npcIdOf('dragonslayer_giantrat'), ghost: npcIdOf('dragonslayer_ghost'), skeleton: npcIdOf('dragonslayer_skeleton'),
    zombie: npcIdOf('dragonslayer_zombie'), melzar: npcIdOf('melzar_the_mad'), demon: npcIdOf('dragonslayer_demon'),
};
const O = {
    melzarkey: objId('melzarkey'), red: objId('redkey'), orange: objId('orangekey'), yellow: objId('yellowkey'), blue: objId('bluekey'),
    magenta: objId('magentakey'), green: objId('greenkey'), map1: objId('mappart1'), map2: objId('mappart2'), map3: objId('mappart3'),
    map: objId('dragonmap'), shield: objId('antidragonbreathshield'), coins: objId('coins'), plank: objId('woodplank'),
};
// loc tiles (probe-find.ts on the static map)
const L = {
    trapdoor: { id: 1570, x: 3019, z: 3450 }, magicDoor: { id: 2586, x: 3051, z: 9840 }, oracleChest: { id: 2587, x: 3057, z: 9841 },
    melzarDoor: { id: 2595, x: 2941, z: 3248 }, redDoor: { id: 2596, x: 2926, z: 3253 }, ladder1: { id: 1747, x: 2928, z: 3256 },
    orangeDoor: { id: 2597, x: 2931, z: 3253 }, ladder2: { id: 1747, x: 2934, z: 3254 }, yellowDoor: { id: 2598, x: 2924, z: 3249 },
    top3: { id: 1746, x: 2940, z: 3240 }, top4: { id: 1746, x: 2937, z: 3240 }, funLadder: { id: 2605, x: 2932, z: 3240 },
    blueDoor: { id: 2599, x: 2931, z: 9643 }, magentaDoor: { id: 2600, x: 2929, z: 9652 }, greenDoor: { id: 2601, x: 2936, z: 9655 },
    funChest: { id: 2603, x: 2935, z: 9657 }, cellarUp: { id: 1755, x: 2939, z: 9657 }, funExit: { id: 2602, x: 2938, z: 3252 },
    plankOn: { id: 2593, x: 3047, z: 3205 }, shipLadder: { id: 2590, x: 3049, z: 3208 }, hole: { id: 2589, x: 3047, z: 9639 },
    rock: { id: 2609, x: 2833, z: 3255 }, gateR: { id: 2607, x: 2847, z: 9636 },
};
const T = {
    guildmaster: { x: 3191, z: 3362 }, oziach: { x: 3069, z: 3517 }, oracle: { x: 3015, z: 3504 }, wormbrain: { x: 3014, z: 3186 },
    klarense: { x: 3047, z: 3204 }, ned: { x: 3100, z: 3258 }, crandor: { x: 2851, z: 3235 }, lairIn: { x: 2850, z: 9637 },
};

export const PHASES = ['guild', 'oziach', 'oracle', 'mine', 'maze', 'sarim', 'ship', 'ned', 'sail', 'elvarg'] as const;
export type Phase = typeof PHASES[number];

function pray(bot: SpeedBot, name: string, on: boolean): void { prayKeep(bot, on ? name : null); }
const keyOf = (bot: SpeedBot, k: number) => bot.count(k) > 0;

/** Kill a maze npc and pick up its key (the drop is ours, melzars_maze.rs2:69-136). */
async function mazeKill(bot: SpeedBot, g: ReturnType<typeof guard>, type: number, key: number, label: string, anchor: Tile, protect = false): Promise<void> {
    if (keyOf(bot, key)) return;
    if (protect) pray(bot, 'protectfrommelee', true);
    // fix 192 (allchaos qt27m 'ghost: kill not done' at (2928,3247 L1): a plain door (1533 @2928,3246) shut by the chaos between
    // us and the ghost; the maze's coloured doors are static key doors): open plain shut doors within 3 of us / the anchor
    // first. DS_MAZE_DOORS=0 reverts.
    if (process.env.DS_MAZE_DOORS !== '0') {
        const me = bot.tile(), lv = bot.minusedlevel;
        for (const c0 of [me, anchor]) for (let dx = -3; dx <= 3; dx++) for (let dz = -3; dz <= 3; dz++) {
            const x = c0.x + dx, z = c0.z + dz, cd = bot.doorTracker?.closedDoorAt(lv, x, z);
            if (cd && [1530, 1531, 1533, 1534, 1536, 1537].includes(cd.locId)) {
                for (let k = 0; k < 3 && bot.doorTracker?.closedDoorAt(lv, x, z); k++) { bot.opLoc(x, z, cd.locId, cd.op); bot.queueFlush(); await bot.tick(4); }
                console.log(`[ds] ${label}: plain door ${cd.locId} at ${x},${z} L${lv} was shut: opened ${!bot.doorTracker?.closedDoorAt(lv, x, z)}`);
            }
        }
    }
    // session 9 (allchaos qu11m + qu15p 'ghost: kill not done' at (2928,3247 L1) with Door 1533 @2928,3246 CLOSED next to us:
    // the door tracker's closedDoorAt did not report it, 192 skipped it): also open closed plain-door LIVE locs (1530/1533/1536)
    // within 3 by the loc stream, before the kill and again half way (DS_MAZE_LIVEDOORS=0 reverts)
    const liveDoors = async () => {
        if (process.env.DS_MAZE_LIVEDOORS === '0') return;
        const me = bot.tile(), lv = bot.minusedlevel;
        for (let dx = -3; dx <= 3; dx++) for (let dz = -3; dz <= 3; dz++) {
            const x = me.x + dx, z = me.z + dz, id = bot.liveLocs.get(`${lv},${x},${z}`);
            if (id === 1530 || id === 1533 || id === 1536) {
                for (let k = 0; k < 3 && bot.liveLocs.get(`${lv},${x},${z}`) === id; k++) { bot.opLoc(x, z, id, 1); bot.queueFlush(); await bot.tick(3); }
                console.log(`[ds] ${label}: live closed door ${id} at ${x},${z} L${lv}: now ${bot.liveLocs.get(`${lv},${x},${z}`)}`);
            }
        }
    };
    await liveDoors();
    const killDone = () => bot.findGroundItem(key, 12) !== undefined || keyOf(bot, key);
    if (process.env.DS_MAZE_LIVEDOORS !== '0') {
        try { await killNpc(bot, [type], label, { done: killDone, anchor, dead: () => g.dead, maxTicks: 150 }); }
        catch { await liveDoors(); await killNpc(bot, [type], label, { done: killDone, anchor, dead: () => g.dead, maxTicks: 200 }); }
    } else await killNpc(bot, [type], label, { done: killDone, anchor, dead: () => g.dead, maxTicks: 300 });
    // fix 176 (allchaos qt21p 'skeleton: yellowkey not picked up': the key dropped on a door tile (2926,3258 L2) whose door
    // the chaos had shut; every pickup was discarded). Open a closed door on the key's tile first. DS_KEY_DOOR=0 reverts.
    if (!keyOf(bot, key) && process.env.DS_KEY_DOOR !== '0') {
        const gi = bot.findGroundItem(key, 12) as any;
        const cd = gi ? bot.doorTracker?.closedDoorAt(bot.minusedlevel, gi.x, gi.z) : null;
        if (gi && cd) {
            for (let k = 0; k < 3 && bot.doorTracker?.closedDoorAt(bot.minusedlevel, gi.x, gi.z); k++) { bot.opLoc(gi.x, gi.z, cd.locId, cd.op); bot.queueFlush(); await bot.tick(4); }
            console.log(`[ds] ${label}: key on a shut door tile (${gi.x},${gi.z}): opened ${!bot.doorTracker?.closedDoorAt(bot.minusedlevel, gi.x, gi.z)}`);
        }
    }
    if (!keyOf(bot, key)) await pickup(bot, key, label);
    if (protect) pray(bot, 'protectfrommelee', false);
}
/**
 * Use a key on a maze door from an EXACT stand tile, then wait until we are through. open_and_close_door
 * (doors/scripts/open_and_close_doors.rs2:9-38) teleports: standing ON the door's own tile ("entering", check_axis
 * door_procs.rs2:77-88) sends you to the far tile; standing anywhere else sends you ONTO the door tile. Used from a tile
 * two steps away on the door-tile side, the key is eaten and you do not cross (sim sp13: red key lost).
 */
async function keyDoor(bot: SpeedBot, key: number, door: { id: number; x: number; z: number }, level: number, stand: Tile, through: () => boolean, label: string): Promise<void> {
    if (through()) return;
    const loc = locHere(door.id, door.x, door.z, level);
    for (let k = 0; k < 4 && !through(); k++) {
        if (bot.chatModalId !== -1) dismiss(bot);
        if (bot.tile().x !== stand.x || bot.tile().z !== stand.z) await bot.stepTo(stand.x, stand.z, 30);
        const s = bot.slot(key); if (s < 0) fail(bot, `${label}: ${objDebugName(key)} not held`);
        bot.useItemOnLoc(loc.x, loc.z, loc.id, key, s); bot.queueFlush();
        await bot.until(through, 6);
    }
    if (!through()) fail(bot, `${label}: not through`);
}
async function climb(bot: SpeedBot, loc: { id: number; x: number; z: number }, level: number, done: () => boolean, label: string, stand?: Tile): Promise<void> {
    await opLocUntil(bot, locHere(loc.id, loc.x, loc.z, level), 1, done, label, { stand, maxTicks: 40, every: 5 });
}

export async function run(bot: SpeedBot, o: { log?: boolean; from?: Phase } = {}): Promise<{ ok: boolean; ticks: number; msg: string }> {
    await nav();
    bot.holdDialogs = true;
    const log = mkLog(bot, 'ds', o.log !== false);
    const t0 = bot.tickCount;
    const g = guard(bot, 0.5);
    startWarningCloser(bot); textLog(bot); trace(bot, t0);
    const from = PHASES.indexOf(o.from ?? 'guild');
    const doPh = (p: Phase) => PHASES.indexOf(p) >= from;
    try {
        // drop what this quest does not use (carried state): keep SUPPLY items + quest items
        const keep = new Set([...SUPPLY.map(i => objId(i.name)), ...Object.values(O), objId('amulet_of_glory_3'), objId('amulet_of_glory_2'), objId('amulet_of_glory_1')]);
        const junk = bot.inv().filter(s => !keep.has(s.obj)).map(s => s.obj);
        if (junk.length) await bot.dropAll([...new Set(junk)]);
        await wieldAll(bot, WEAR.filter(w => bot.count(w) > 0));

        if (doPh('guild')) await guild(bot, log);
        if (doPh('oziach')) await oziach(bot, log);
        if (doPh('oracle')) await oracle(bot, log);
        if (doPh('mine')) await mine(bot, log);
        if (doPh('maze')) await maze(bot, log, g);
        if (doPh('sarim')) await sarim(bot, log);
        if (doPh('ship')) await ship(bot, log);
        if (doPh('ned')) await ned(bot, log);
        if (doPh('sail')) await sail(bot, log);
        await elvarg(bot, log, g);
        return { ok: true, ticks: bot.tickCount - t0, msg: `splits ${JSON.stringify(log.splits)} ate ${g.ate}` };
    } catch (e) {
        return { ok: false, ticks: bot.tickCount - t0, msg: `${(e as Error).message} | splits ${JSON.stringify(log.splits)}` };
    } finally { g.stop = true; }
}

// ---- phases -----------------------------------------------------------------------------------------------------------
async function guild(bot: SpeedBot, log: Log): Promise<void> {
    const seen = textWatch(bot);
    let said = false;
    const done = () => { if (!said && seen(/Oziach lives in a hut/)) said = true; return said && bot.chatModalId === -1; };
    await converse(bot, N.guildmaster, T.guildmaster, byText(/Rune Plate mail body/i), done, 'guildmaster');
    log.split('guild');
}

async function oziach(bot: SpeedBot, log: Log): Promise<void> {
    await glory(bot, 1, 'glory edgeville');
    log.split('tele-edgeville');
    const asked = new Set<string>();
    const pick = (opts: string[]) => {
        const f = (re: RegExp) => opts.findIndex(t => re.test(t));
        for (const [k, re] of [['1', /first piece/], ['2', /second piece/], ['3', /third piece/]] as const) {
            const i = f(re); if (i >= 0 && !asked.has(k)) { asked.add(k); return i; }
        }
        for (const re of [/try and get everything/, /sell me some Rune/i, /guildmaster of the Champions/i, /how am I meant to prove/i, /sounds like fun/i, /where can I find this dragon/i]) {
            const i = f(re); if (i >= 0) return i;
        }
        return -1;
    };
    const done = () => asked.size === 3 && bot.count(O.melzarkey) > 0 && bot.chatModalId === -1;
    // his hut door (1530 @3070,3515 a3) is usually shut: walk in first (the npc op does not open doors)
    await converse(bot, N.oziach, T.oziach, pick, done, 'oziach', { maxTicks: 90, stand: { x: 3070, z: 3516 } });
    log.split('oziach');
}

async function oracle(bot: SpeedBot, log: Log): Promise<void> {
    // %dragon_oracle = 2 is set right after the choice (oracle.rs2:16-17): leave once it is clicked and the pages are done
    // A/B (DS_ORACLE=tele): Falador teleport + 178 steps instead of walking 216 steps from Oziach's hut (probe-path)
    if (process.env.DS_ORACLE === 'tele') { await clearModals(bot); await teleSpell(bot, 'falador_teleport', 'falador tele (oracle)'); }
    let picked = false;
    const pick = (opts: string[]) => { const i = opts.findIndex(t => /seek a piece of the map/i.test(t)); if (i >= 0) picked = true; return i; };
    await converse(bot, N.oracle, T.oracle, pick, () => picked && bot.chatModalId === -1, 'oracle');
    log.split('oracle');
}

async function mine(bot: SpeedBot, log: Log): Promise<void> {
    dismiss(bot);
    // the trapdoor stands open statically (trapdoor_open 1570); another player may have closed it (trapdoor 1568: Open)
    for (let k = 0; k < 3 && bot.tile().z < 6400; k++) {
        const live = bot.liveLocs.get(`0,${L.trapdoor.x},${L.trapdoor.z}`);
        // route runner: a closed trapdoor we never saw change (liveLocs empty) made climb throw at once (partner sim
        // qrh3p): from the 2nd try, assume closed and Open it first
        if (live === 1568 || k > 0) await opLocUntil(bot, { ...locHere(1570, L.trapdoor.x, L.trapdoor.z, 0), id: 1568 }, 1, () => bot.liveLocs.get(`0,${L.trapdoor.x},${L.trapdoor.z}`) !== 1568, 'trapdoor open', { stand: { x: 3019, z: 3451 }, maxTicks: 30, every: 5 });
        try { await climb(bot, { id: 1570, x: L.trapdoor.x, z: L.trapdoor.z }, 0, () => bot.tile().z > 6400 || bot.liveLocs.get(`0,${L.trapdoor.x},${L.trapdoor.z}`) === 1568, 'trapdoor', { x: 3019, z: 3451 }); } catch (e) { if (k === 2) throw e; }
    }
    if (bot.tile().z < 6400) fail(bot, 'trapdoor');
    log.split('trapdoor');
    const inRoom = () => bot.tile().z > 6400 && bot.tile().x >= 3051 && bot.tile().x <= 3060;
    await opLocUntil(bot, locHere(L.magicDoor.id, L.magicDoor.x, L.magicDoor.z, 0), 1, inRoom, 'magic door', { stand: { x: 3050, z: 9840 }, maxTicks: 120, every: 5 });
    log.split('magic-door');
    const chest = () => ({ ...locHere(2587, L.oracleChest.x, L.oracleChest.z, 0), id: bot.liveLocs.get(`0,${L.oracleChest.x},${L.oracleChest.z}`) === 2588 ? 2588 : 2587 });
    for (let k = process.env.DS_MAP3_TEST === '1' ? 6 : 0; k < 6 && bot.count(O.map3) === 0 && bot.chatModalId === -1; k++) {
        const c = chest();
        await opLocUntil(bot, c, 1, () => bot.count(O.map3) > 0 || bot.chatModalId !== -1 || (c.id === 2587 && bot.liveLocs.get(`0,${c.x},${c.z}`) === 2588), 'oracle chest', { maxTicks: 12, every: 4 }).catch(() => undefined);
    }
    if (bot.count(O.map3) === 0 && bot.chatModalId !== -1) await chat(bot, () => -1, () => bot.count(O.map3) > 0, 'map3 mesbox', 6).catch(() => undefined);
    // session 11 fix 288c (DS_MAP3_MORE): qx34p 'no mappart3' at (3056,9841) = the oracle's chest room (Dwarven Mine, behind
    // the magic door): a ws-1012 drop (38 t offline) hit during the 6 chest tries (12 t each), they ran out ~10 t after the
    // re-login; the retry banked at Edgeville and re-walked the trapdoor (~330 t). CONFIRMED from the log. Still in the room
    // without the part: up to 6 more tries (re-opening the chest's mesbox each time). DS_MAP3_MORE=0 reverts.
    // TEST: DS_MAP3_TEST=1 skips the first 6 tries (the drop) so the extra round runs.
    if (process.env.DS_MAP3_MORE !== '0' && bot.count(O.map3) === 0 && inRoom()) {
        console.log(`[ds] 288c no mappart3 after the chest tries (in the room at ${JSON.stringify(bot.pos())}): 6 more`);
        for (let k = 0; k < 6 && bot.count(O.map3) === 0 && inRoom(); k++) {
            await clearModals(bot);
            const c = chest();
            await opLocUntil(bot, c, 1, () => bot.count(O.map3) > 0 || bot.chatModalId !== -1 || (c.id === 2587 && bot.liveLocs.get(`0,${c.x},${c.z}`) === 2588), 'oracle chest (288c)', { maxTicks: 12, every: 4 }).catch(() => undefined);
            if (bot.count(O.map3) === 0 && bot.chatModalId !== -1) await chat(bot, () => -1, () => bot.count(O.map3) > 0, 'map3 mesbox', 6).catch(() => undefined);
        }
    }
    if (bot.count(O.map3) === 0) fail(bot, 'no mappart3');
    log.split('map3');
}

async function maze(bot: SpeedBot, log: Log, g: ReturnType<typeof guard>): Promise<void> {
    await clearModals(bot);
    await teleSpell(bot, 'falador_teleport', 'falador tele');
    log.split('tele-falador');
    // enter: melzarkey on the front door (2941,3248 a0: outside x>=2941, inside x<=2940)
    await go(bot, { x: 2942, z: 3248 }, 1, 'maze door', 400);
    await keyDoor(bot, O.melzarkey, L.melzarDoor, 0, { x: 2941, z: 3248 }, () => bot.tile().x <= 2940 && bot.tile().z < 6400, 'melzar door');
    log.split('maze-in');
    // L0: giant rat -> red key -> red door (2926,3253) -> ladder (2928,3256)
    await mazeKill(bot, g, N.rat, O.red, 'rat', { x: 2932, z: 3252 });
    await keyDoor(bot, O.red, L.redDoor, 0, { x: 2926, z: 3253 }, () => bot.tile().x <= 2925, 'red door');
    await climb(bot, L.ladder1, 0, () => bot.minusedlevel === 1, 'ladder 1', { x: 2927, z: 3256 });
    log.split('maze-L0');
    // L1: ghost -> orange key -> orange door (2931,3253) -> ladder (2934,3254)
    await mazeKill(bot, g, N.ghost, O.orange, 'ghost', { x: 2927, z: 3250 });
    await keyDoor(bot, O.orange, L.orangeDoor, 1, { x: 2930, z: 3253 }, () => bot.tile().x >= 2931, 'orange door');
    await climb(bot, L.ladder2, 1, () => bot.minusedlevel === 2, 'ladder 2', { x: 2933, z: 3254 });
    log.split('maze-L1');
    // L2: skeleton -> yellow key -> yellow door (2924,3249 a1: from z3250 into the SW room z<=3249) -> laddertop (2940,3240)
    // down into the L1 room x2937-2940 z3237-3241 -> laddertop (2937,3240) down from (2938,3240). (The yellow door at
    // 2931,3249 leads to laddertop 2937,3247, whose L1 room only reaches the laddertop from across a wall: sim sp6.)
    await mazeKill(bot, g, N.skeleton, O.yellow, 'skeleton', { x: 2926, z: 3252 });
    await keyDoor(bot, O.yellow, L.yellowDoor, 2, { x: 2924, z: 3250 }, () => bot.tile().z <= 3249, 'yellow door');
    await climb(bot, L.top3, 2, () => bot.minusedlevel === 1, 'laddertop 3', { x: 2939, z: 3240 });
    await climb(bot, L.top4, 1, () => bot.minusedlevel === 0, 'laddertop 4', { x: 2938, z: 3240 });
    await climb(bot, L.funLadder, 0, () => bot.tile().z > 6400, 'fun ladder', { x: 2933, z: 3240 });
    log.split('maze-L2');
    // basement: zombie -> blue door (2931,9643 a0) -> Melzar -> magenta door (2929,9652 a3) -> demon -> green door -> chest
    await mazeKill(bot, g, N.zombie, O.blue, 'zombie', { x: 2932, z: 9642 });
    await keyDoor(bot, O.blue, L.blueDoor, 0, { x: 2931, z: 9643 }, () => bot.tile().x <= 2930, 'blue door');
    await mazeKill(bot, g, N.melzar, O.magenta, 'melzar', { x: 2929, z: 9647 });
    await keyDoor(bot, O.magenta, L.magentaDoor, 0, { x: 2929, z: 9651 }, () => bot.tile().z >= 9652, 'magenta door');
    await mazeKill(bot, g, N.demon, O.green, 'lesser demon', { x: 2932, z: 9652 }, true);
    await keyDoor(bot, O.green, L.greenDoor, 0, { x: 2936, z: 9655 }, () => bot.tile().z >= 9656, 'green door');
    log.split('maze-basement');
    const chestAt = () => bot.liveLocs.get(`0,${L.funChest.x},${L.funChest.z}`) === 2604 ? 2604 : 2603;
    for (let k = 0; k < 6 && bot.count(O.map1) === 0 && bot.chatModalId === -1; k++) {
        const id = chestAt();
        await opLocUntil(bot, { ...locHere(2603, L.funChest.x, L.funChest.z, 0), id }, 1, () => bot.count(O.map1) > 0 || bot.chatModalId !== -1 || (id === 2603 && chestAt() === 2604), 'maze chest', { maxTicks: 12, every: 4 }).catch(() => undefined);
    }
    if (bot.count(O.map1) === 0 && bot.chatModalId !== -1) await chat(bot, () => -1, () => bot.count(O.map1) > 0, 'map1 mesbox', 6).catch(() => undefined);
    if (bot.count(O.map1) === 0) fail(bot, 'no mappart1');
    log.split('map1');
    await clearModals(bot);
    // out: cellar ladder (2939,9657) -> L0 (2938,3257) -> funexit (2938,3252, opens from inside) -> melzardoor (key)
    await climb(bot, L.cellarUp, 0, () => bot.tile().z < 6400, 'cellar ladder', { x: 2938, z: 9657 });
    // funexit opens only for a player standing ON its tile (check_axis_locactive, melzars_maze.rs2:20-25)
    await bot.stepTo(2938, 3252, 30);
    await opLocUntil(bot, locHere(L.funExit.id, L.funExit.x, L.funExit.z, 0), 1, () => bot.tile().x <= 2937, 'fun exit', { stand: { x: 2938, z: 3252 }, maxTicks: 40, every: 5 });
    await keyDoor(bot, O.melzarkey, L.melzarDoor, 0, { x: 2940, z: 3248 }, () => bot.tile().x >= 2941, 'melzar door out');
    log.split('maze-out');
}

async function sarim(bot: SpeedBot, log: Log): Promise<void> {
    // Wormbrain (Port Sarim jail, talk through the bars: apnpc1 with line of sight, aprange 3)
    // talk through the cell's west railing (x3012): stand outside at x3011 (apnpc1 needs line of sight + aprange 3, wormbrain.rs2:82-88)
    await converse(bot, N.wormbrain, T.wormbrain, byText(/piece of map that I need/i, /could pay you/i, /10,000 it is/i), () => bot.count(O.map2) > 0, 'wormbrain', { near: 3, stand: { x: 3011, z: 3186 } });
    log.split('wormbrain');
    await clearModals(bot);
    useItemOnItem(bot, O.map1, O.map2);
    if (!(await bot.until(() => bot.count(O.map) > 0, 6))) fail(bot, 'map did not combine');
    await clearModals(bot);
    log.split('map');
    const c0 = bot.count(O.coins);
    await converse(bot, N.klarense, T.klarense, byText(/could buy it/i, /Yep, sounds good/i), () => bot.count(O.coins) <= c0 - 2000, 'klarense');
    log.split('klarense');
}

async function ship(bot: SpeedBot, log: Log): Promise<void> {
    await clearModals(bot);
    await opLocUntil(bot, locHere(L.plankOn.id, L.plankOn.x, L.plankOn.z, 0), 1, () => bot.minusedlevel === 1, 'gangplank', { maxTicks: 40, every: 5 });
    await climb(bot, L.shipLadder, 1, () => bot.tile().z > 6400, 'ship ladder');
    log.split('board');
    const hole = locHere(L.hole.id, L.hole.x, L.hole.z, 1);
    for (let k = 0; k < 3 && bot.minusedlevel === 1; k++) {
        const p0 = bot.count(O.plank);
        await useOnLocUntil(bot, O.plank, hole, () => bot.count(O.plank) < p0 || bot.minusedlevel !== 1, `plank ${k + 1}`, { maxTicks: 20, every: 4 });
        await clearModals(bot);
    }
    if (!(await bot.until(() => bot.minusedlevel === 2, 6))) fail(bot, `ship not repaired (planks ${bot.count(O.plank)})`);
    log.split('repair');
}

async function ned(bot: SpeedBot, log: Log): Promise<void> {
    await clearModals(bot);
    await glory(bot, 3, 'glory draynor');
    log.split('tele-draynor');
    const seen = textWatch(bot);
    // standard_ned -> "take me to the island of Crandor" -> hired + (repaired) "Just show me the map" (ned.rs2:228-254)
    // his house door (1530 @3101,3258 a2) is usually shut: stand inside first
    // session 11 (audit): a retry after the hire gets 'So are you going to take me to Crandor Island now then?' (ned.rs2:172,
    // ned_dragon_slayer_hired) and, with the map already given, 'I'll meet you on board' / 'at the ship'. DS_NED_RESUME=0 reverts.
    const nedRe = process.env.DS_NED_RESUME === '0' ? /take me to the island of Crandor/i : /take me to (the island of )?Crandor/i;
    const nedDone = () => seen(/show me the map/i) || (process.env.DS_NED_RESUME !== '0' && (seen(/meet you on board|meet you at the ship/i) || (bot.count(O.map) === 0 && seen(/Hello there lad/i))));
    await converse(bot, N.ned, T.ned, byText(nedRe), nedDone, 'ned hire', { stand: { x: 3100, z: 3258 } });
    failHook('ds-ned-hired');   // TEST mark (session 11 proof): after the hire, before the map hand-over
    await clearModals(bot);
    for (let k = 0; k < 4 && bot.count(O.map) > 0; k++) {
        const n = npc(bot, N.ned); if (!n) { await go(bot, T.ned, 2, 'ned', 60); continue; }
        useOnNpc(bot, O.map, n);
        await untilChat(bot, () => bot.count(O.map) === 0, 8);
    }
    if (bot.count(O.map) > 0) fail(bot, 'Ned did not take the map');
    log.split('ned');
}

async function sail(bot: SpeedBot, log: Log): Promise<void> {
    await clearModals(bot);
    await go(bot, { x: 3047, z: 3203 }, 1, 'dock', 300);
    await opLocUntil(bot, locHere(L.plankOn.id, L.plankOn.x, L.plankOn.z, 0), 1, () => bot.minusedlevel === 1, 'gangplank 2', { maxTicks: 40, every: 5 });
    await climb(bot, L.shipLadder, 1, () => bot.minusedlevel === 3, 'ship ladder 2');
    log.split('board2');
    const onCrandor = () => bot.tile().z < 6400 && cheb(bot.tile(), T.crandor) <= 6;
    await converse(bot, N.shipNed, { x: 3046, z: 9640 }, byText(/Yep lets go/i), onCrandor, 'ship ned', { maxTicks: 60 });
    // arrival: mesbox + Ned + player pages (dragonslayer_ned.rs2:29-31)
    await chat(bot, () => -1, () => bot.chatModalId === -1 && bot.mainModalId === -1, 'crandor arrival', 30).catch(() => undefined);
    await clearModals(bot);
    log.split('sail');
}

/** Crandor isle (surface) / the Crandor dungeon incl. Elvarg's lair (rock opening -> 2833,9658; lair x2847+, z ~9630-9650) */
const onCrandorIsle = (bot: SpeedBot) => { const t = bot.tile(); return bot.minusedlevel === 0 && t.z < 6400 && t.x >= 2810 && t.x <= 2870 && t.z >= 3220 && t.z <= 3310; };
const inCrandorDungeon = (bot: SpeedBot) => { const t = bot.tile(); return t.z > 6400 && t.x >= 2820 && t.x <= 2880 && t.z >= 9590 && t.z <= 9680; };
let dsResailTestDone = false;

// session 11 fix 288b (DS_RESAIL): qx32p STOPPED at qp 41. Elvarg killed the partner (0 sharks, hp 31, then a ws-1012 drop;
// 'DIED while disconnected', Lumbridge, pack 25 -> the 3 rune pieces); the retries resumed at 'elvarg' (fix 181: 'sail' was
// seen) on the MAINLAND and walked for the rock opening on Crandor (Varrock -> 2834,3253: no route, x3). CONFIRMED from the log.
// After the first sail %dragonquest = 9, %dragonquestvar = 0, Ned unhired (dragonslayer_ned.rs2:20-23), so the way back is the
// quest's own: Ned 'Can you take me to Crandor again?' (ned.rs2:196-216 -> hired), Port Sarim: gangplank, ladder (var < 3 ->
// the hold, lady_lumbridge.rs2:33-41), 3 planks + 12 nails + hammer on the hole again (-> L2), hold ladder 2592 up to the
// deck, ladder again (var 3 + hired -> L3), ship Ned 'Yep lets go!'. Needs the shield + planks/nails/hammer: the route stages
// a spare set in the bank (route-legs dragon bankStage). DS_RESAIL=0 reverts (walk for the rock opening).
// TEST: DS_RESAIL_TEST=1 leaves Crandor once by glory (Draynor) at the start of this phase and fails, so the retry resails.
async function resail(bot: SpeedBot, log: Log): Promise<void> {
    console.log(`[ds] 288b on the mainland at ${JSON.stringify(bot.pos())}: re-sail to Crandor (shield ${bot.isWorn(O.shield) || bot.count(O.shield) > 0}, planks ${bot.count(O.plank)}, nails ${bot.count('nails')}, hammer ${bot.count('hammer')})`);
    if (!bot.isWorn(O.shield) && bot.count(O.shield) === 0) fail(bot, 'resail: no antidragon shield');
    await clearModals(bot);
    const onShip = () => bot.tile().z > 6400 && bot.tile().x >= 3040 && bot.tile().x <= 3056 && bot.tile().z >= 9630 && bot.tile().z <= 9650;
    if (!onShip()) {
        if (cheb(bot.tile(), T.ned) > 30) await glory(bot, 3, 'glory draynor (resail)');
        const seen = textWatch(bot);
        await converse(bot, N.ned, T.ned, byText(/take me to Crandor again/i), () => seen(/steer a little better|meet you at the Port Sarim docks/i), 'ned again', { stand: { x: 3100, z: 3258 } });
        await clearModals(bot);
        log.split('ned-again');
        await go(bot, { x: 3047, z: 3203 }, 1, 'dock (resail)', 400);
    }
    const hold = locHere(L.hole.id, L.hole.x, L.hole.z, 1);
    for (let k = 0; k < 6 && !(onShip() && bot.minusedlevel === 3); k++) {
        const lv = bot.minusedlevel, below = bot.tile().z > 6400;
        if (!below && lv === 0) await opLocUntil(bot, locHere(L.plankOn.id, L.plankOn.x, L.plankOn.z, 0), 1, () => bot.minusedlevel === 1, 'gangplank (resail)', { maxTicks: 40, every: 5 });
        else if (!below && lv === 1) await climb(bot, L.shipLadder, 1, () => bot.tile().z > 6400, 'ship ladder (resail)');
        else if (below && lv === 1) {   // the hold: patch the hole again (var 0 -> 3, teleported to L2)
            for (let p = 0; p < 3 && bot.minusedlevel === 1; p++) {
                const p0 = bot.count(O.plank);
                if (p0 === 0) fail(bot, `resail: no planks for the hole (nails ${bot.count('nails')})`);
                await useOnLocUntil(bot, O.plank, hold, () => bot.count(O.plank) < p0 || bot.minusedlevel !== 1, `plank ${p + 1} (resail)`, { maxTicks: 20, every: 4 });
                await clearModals(bot);
            }
            if (!(await bot.until(() => bot.minusedlevel === 2, 6))) fail(bot, `resail: ship not repaired (planks ${bot.count(O.plank)})`);
            log.split('repair-again');
        } else if (below && lv === 2) await climb(bot, { id: 2592, x: 3048, z: 9640 }, 2, () => bot.tile().z < 6400, 'hold ladder up (resail)');
        else fail(bot, `resail: unexpected spot ${JSON.stringify(bot.pos())}`);
    }
    if (!(onShip() && bot.minusedlevel === 3)) fail(bot, `resail: not on the ship's top deck (${JSON.stringify(bot.pos())})`);
    await converse(bot, N.shipNed, { x: 3046, z: 9640 }, byText(/Yep lets go/i), () => onCrandorIsle(bot), 'ship ned (resail)', { maxTicks: 60 });
    await chat(bot, () => -1, () => bot.chatModalId === -1 && bot.mainModalId === -1, 'crandor arrival', 30).catch(() => undefined);
    await clearModals(bot);
    log.split('resail');
}

async function elvarg(bot: SpeedBot, log: Log, g: ReturnType<typeof guard>): Promise<void> {
    await clearModals(bot);
    if (process.env.DS_RESAIL_TEST === '1' && !dsResailTestDone && onCrandorIsle(bot)) {
        dsResailTestDone = true;
        await glory(bot, 3, '288b TEST: glory draynor');
        fail(bot, '288b TEST: left Crandor before the rock opening');
    }
    if (process.env.DS_RESAIL !== '0' && !onCrandorIsle(bot) && !inCrandorDungeon(bot)) await resail(bot, log);
    if (bot.tile().z < 6400) {
        await go(bot, { x: 2834, z: 3253 }, 1, 'rock opening', 300);
        await opLocUntil(bot, locHere(L.rock.id, L.rock.x, L.rock.z, 0), 1, () => bot.tile().z > 6400, 'rock opening', { maxTicks: 30, every: 5 });
    }
    log.split('crandor-dungeon');
    // session 11 fix 288a (DS_REWEAR): in qx32/34/36/37/38 the partner fought Elvarg with the rune helm/body/legs in the PACK:
    // defence < 40 at the bank (the route's wear and the module's wieldAll were refused), 40 came during the maze fights
    // ('You can now wear Rune Armour!', cb 87-91 -> 104) and nothing wore them again; qx32p then ran out of sharks and died
    // (CONFIRMED from the packs in the [stuck] lines; the retry's bank wore all four). Wear WEAR again here. DS_REWEAR=0 reverts.
    if (process.env.DS_REWEAR !== '0') {
        const unworn = WEAR.filter(w => bot.count(w) > 0 && !bot.isWorn(objId(w)));
        if (unworn.length) { await wieldAll(bot, unworn); console.log(`[ds] 288a wore ${unworn.join(',')}: now worn ${unworn.filter(w => bot.isWorn(objId(w))).join(',') || 'none'}`); }
    }
    await wieldAll(bot, ['antidragonbreathshield']);
    if (!bot.isWorn(O.shield)) fail(bot, 'antidragon shield not worn');
    await go(bot, { x: 2846, z: 9636 }, 1, 'lair gate', 300);
    const inLair = () => bot.tile().x >= 2847 && bot.tile().z > 6400;   // gate a0 = west edge of x2847: x2847 is inside
    await opLocUntil(bot, locHere(L.gateR.id, L.gateR.x, L.gateR.z, 0), 1, inLair, 'lair gate', { stand: { x: 2846, z: 9636 }, maxTicks: 40, every: 5 });
    log.split('lair');
    const seen = textWatch(bot);
    const done = () => seen(/completed the.*Dragon Slayer/is) || seen(/Dragon Slayer Quest/i) || bot.mainModalId === 297;
    pray(bot, 'protectfrommelee', true);
    await killNpc(bot, [N.elvarg], 'elvarg', { done, dead: () => g.dead, maxTicks: 600, radius: 20, anchor: T.lairIn });
    pray(bot, 'protectfrommelee', false);
    log.split('elvarg');
    await clearModals(bot);
}
