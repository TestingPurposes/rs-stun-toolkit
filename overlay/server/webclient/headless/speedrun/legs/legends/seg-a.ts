// =====================================================================================================
// legs/legends/seg-a.ts — Legends' Quest segments A (stage 0 -> 5) and E (stage 45 -> complete). rig.
// =====================================================================================================
// ⛔ CHEATLESS: nothing here calls cheat/localSetup/simSetup/setvar. Items come from `supply` or the game. The quest varps
// are not transmitted: every step is gated on items, positions, dialog text and game messages.
//
// SEGMENT A (stage 0 -> 5), from outside the Legends' Guild gate (2728,3346):
//   A1 guard (legends_guard.rs2): "What is this place?" > "Can I go on the quest?" > "Yes, I'd like to talk to Grand
//      Vizier Erkle." -> the guard opens the gate and puts you inside (2728,3350).
//   A2 Radimus Erkle in his study (2724,3368; radimus_erkle.rs2): "Yes actually, what's involved?" > "Yes, it sounds great!"
//      -> notes + map (thkaramjamap), stage 1.
//   A3 study cupboard (2724,3370): Open, Search -> machete (radimus within 5 tiles).
//   A4 walk to Ardougne docks, Captain Barnaby "Yes please." (30 gp) -> Brimhaven ship (L1 2775,3234) -> gangplank.
//   A5 Hajedy (brimhavencartdriver, 2779,3211; needs Shilo Village done): cart to Shilo (2834,2951), 10 gp min (5% of coins).
//   A6 out of Shilo east: wooden gate (2867,2952) -> metal gate (2875,2952) -> climb the broken cart (op2, 2877,2951) ->
//      (2880,2952) -> walk to the jungle edge (2866,2941).
//   A7 hack into the Kharazi jungle down column x=2866 (tree 2940 -> lands on 2939, tree 2938 -> 2937, walk 2936, bush 2935
//      -> 2934). Jungle chopping needs the notes, an axe and the machete (jungle_tree.rs2); success teleports 2 tiles on.
//   A8 map the three sections (radimus_notes.rs2: opheld2 "Start Mapping", papyrus + charcoal, crafting 50; one papyrus per
//      success): middle at (2866,2934), east at (2882,2932), west at (2812,2932) -> thkaramjamapcomp, stage 2.
//   A9 hack out north up column x=2819 (bush 2937 -> lands on 2938, bush 2939 -> 2940) into the forester pocket.
//   A10 use the completed map on a jungle forester (jungle_forester.rs2) "Yes, go ahead make a copy!" -> bullroarer, stage 3.
//   A11 hack back in down column x=2819, walk to open ground (2840,2925), swing the bullroarer (bullroarer.rs2: 5/6 chance
//      Gujuo comes and opens the dialog himself; if he lands out of reach, talk to him / try the next spot >= 15 tiles away)
//      and talk: "I was hoping to attract..." > "I want to develop friendly relations..." > "Can you get your people
//      together?" > "What can we do instead then?" > "How do we make the totem pole?" > "I will release Ungadulu..." ->
//      stage 5 (gujuo.rs2:648); Gujuo leaves ("Gujuo disappears into the Kharazi Jungle...").
//   EXIT STATE (for segment B): inside the Kharazi jungle, middle section, at/near (2840,2925) L0 (another swing spot
//   (2858,2922)/(2822,2927) only if Gujuo was unreachable at the first). Pack (<= 6 slots): thkaramjamapcomp (KEEP it: Radimus takes
//   it in E), bullroarer, machete, rune axe, <= 2 sharks (6 slots max: B needs room for
//   its 16-slot kit); rune scimitar WORN; logs/papyrus/charcoal/tutorial runes dropped, extra sharks eaten or dropped. Varps:
//   legendsquest 5; legends_bits 0 (the 3 mapped bits are cleared when the map completes, radimus_notes.rs2:608-610).
//   The jungle edge tiles are map-blocked: segment B must hack out/in the same way (jungle loc next tile -> chop op1; the
//   success teleports 2 tiles on). Proven columns: x=2866 (z 2941 <-> 2934, 3 chops) and x=2819 (z 2940 <-> 2936, 2 chops).
//
// SURVIVAL (A and E): whole-segment safety net (eat a shark at <= 50% hp, fail at once on death), rune scimitar wielded in A,
// jungle attackers (oomlie bird/wolf/savage) killed before every chop, mapping, swing and teleport; never swing while hit.
//
// SEGMENT E (stage 45 -> 75 complete), from the jungle (D leaves the trainee there with the gilded totem):
//   E0 fight off attackers; make room (drop non-E items) and take the hand-off (law 1, air 5, coins 40) — verified.
//   E1 Camelot teleport (3 tries, fights first; FALLBACK if impossible: hack out at x=2819, walk to Brimhaven, customs
//      officer's ship to Ardougne, gangplank) -> walk to the Legends' Guild gate; op the gate (stage > 0: "A guard nods", the gate walks you in).
//   E2 Radimus in the study with thtotempolegift + thkaramjamapcomp -> hand-in (radimus_erkle.rs2:349): both taken, stage 50.
//   E3 through the Legends Guild main doors (2728,3373; open at stage >= 50) to Radimus in the main hall: "Yes, I'll train
//      now." then four "* Skill *" picks (each +5 stage and 76500/10 xp), then the queued quest complete (questscroll, qp +4).
//
// Run (sim): LEG_SIM=1 SIM_LOCKSTEP=1 TELEMETRY=false LC_HOST=localhost:8912 bun headless/speedrun/legs/legends/legends.ts --from A --to A
import { SpeedBot, objId, cheb } from '../../core.js';
import { nav, npc, npcsOf, inDialog, log, walkOp, tele, dismiss, dropAllOf, KIT_JUNK, msgsSince, opNpcGo, navSync, turning, levelUpOpen, situation, qp } from '../q-lib.js';
import { densify } from '../../core.js';
import * as locScene from '../../../loc-scene.js';
import { PREREQ, type Seg, type SegCtx } from './common.js';
import { isResuming, journalStage, readJournal, failHook } from '../qp/journal.js';

// npc types (npc.pack)
const GUARDS = [398, 399], RADIMUS = 400, FORESTERS = [401, 402], BARNABY = 381, HAJEDY = 510, GUJUO = 928;
// locs (loc.pack)
const CUPBOARD = 2885, CUPBOARD_OPEN = 2886, GUILD_GATE_L = 2391, GUILD_DOOR_L = 2896, GANGPLANK_BRIM = 2088;
const SHILO_WOODGATE = 2262, SHILO_METALGATE = 2259, SHILO_CART = 2216;
const JUNGLE = new Set([2887, 2889, 2890, 2892, 2893]);   // kharazi_jungle_tree_logs/tree1/tree2/plant1/plant2
const LANDING_BRIM = { x: 2775, z: 3234 }, SHILO_CART_AT = { x: 2834, z: 2951 };

type Ctx = { bot: SpeedBot; t0: number; m: Record<string, unknown>; verbose: boolean };
const fail = (c: Ctx, s: string): never => { throw new Error(`${s} at ${JSON.stringify(c.bot.pos())} | ${situation(c.bot)}`); };
// failHook (resume proofs): SR_FAIL_AT=A:<mark> throws once right after that mark (segments A and E share it)
const mark = (c: Ctx, k: string) => { c.m[k] = c.bot.tickCount - c.t0; if (c.verbose) log(c.bot, c.t0, `${k} pos=${JSON.stringify(c.bot.pos())}`); failHook(`A:${k}`); };

/** Text (IF_SETTEXT changed since `snap`, or a game message since `since`) matching re. */
function seen(bot: SpeedBot, snap: Map<number, string>, since: number, re: RegExp): boolean {
    for (const [k, v] of bot.ifText) if (snap.get(k) !== v && re.test(v)) return true;
    return msgsSince(bot, since).some(t => re.test(t));
}
function watcher(bot: SpeedBot) { const snap = new Map(bot.ifText), since = bot.tickCount; return (re: RegExp) => seen(bot, snap, since, re); }

async function walk(c: Ctx, x: number, z: number, what: string, o: { near?: number; maxTicks?: number } = {}): Promise<void> {
    const opts = { near: o.near ?? 0, maxTicks: o.maxTicks ?? 600 };
    let ok = await walkOp(c.bot, { x, z }, null, () => false, opts);
    // session 11 helper W, W1 (fork qye02 'walk west section (2812,2932)' at (2882,2932): a Jungle Wolf adjacent east, every
    // step out refused 16 t (walled W/N/S -> 'no route'); the retry's 'map middle' walk wedged the same way in 20 t). Cause
    // INFERRED: the auto-retaliate (or killAggressors) attack interaction on the wolf pins the player: walkOp sends
    // MOVE_OPCLICK, which does NOT clear an interaction (MoveClickHandler), and each wolf hit re-queues p_opnpc(2). Fix: a walk
    // that fails next to a jungle animal kills it (killAggressors, then a forced attack <= 60 t), clears the interaction with
    // a MOVE_GAMECLICK step toward the goal, and walks again; 3 rounds. LG_A_WEDGE=0 reverts.
    for (let r = 0; !ok && r < 3 && process.env.LG_A_WEDGE !== '0' && !c.bot.disposed; r++) {
        const near = npcsOf(c.bot, ANIMALS).filter(q => q.d <= 2);
        if (!near.length && !recentlyHit(c.bot, 12)) break;
        log(c.bot, c.t0, `walk ${what}: wedged at ${JSON.stringify(c.bot.tile())} next to ${near.map(q => `${q.type}@${q.x},${q.z} face ${(c.bot.npcs[q.idx] as any)?.faceEntity ?? -1}`).join(' ') || '-'} (hp ${c.bot.stat('hitpoints').cur}): unwedge ${r + 1}`);
        await unwedge(c, x, z);
        ok = await walkOp(c.bot, { x, z }, null, () => false, opts);
    }
    if (!ok) fail(c, `walk ${what} (${x},${z})`);
}
/** W1: kill the jungle animal pinning us, then a MOVE_GAMECLICK step toward (x,z) (clears the attack interaction). */
async function unwedge(c: Ctx, x: number, z: number): Promise<void> {
    const bot = c.bot;
    if (underAttack(bot)) await killAggressors(c, 'unwedge');
    let last = -99; const t = bot.tickCount;
    for (let j = 0; j < 60 && !bot.disposed; j++) {   // forced: an adjacent animal that killAggressors did not count (not facing us)
        const a = npcsOf(bot, ANIMALS).filter(q => q.d <= 1)[0];
        if (!a) break;
        if (bot.tickCount - last >= 4) { bot.opNpc(a.idx, 2); bot.queueFlush(); last = bot.tickCount; }
        await bot.tick(1);
    }
    if (bot.tickCount > t) log(bot, c.t0, `unwedge: forced attack ${bot.tickCount - t} t, adjacent animals left ${npcsOf(bot, ANIMALS).filter(q => q.d <= 1).length}, hp ${bot.stat('hitpoints').cur}`);
    await gameClickToward(c, x, z);
}
/** A MOVE_GAMECLICK route (<= 11 steps) toward (x,z): unlike walkOp's MOVE_OPCLICK it clears the interaction (MoveClickHandler
 *  -> clearPendingAction) and closes a stale modal. */
async function gameClickToward(c: Ctx, x: number, z: number): Promise<void> {
    const bot = c.bot, me = bot.tile(); let pts: Array<{ x: number; z: number }> = [];
    try { pts = navSync().findLongPath(bot.minusedlevel, me.x, me.z, x, z, 500); } catch { pts = []; }
    const dense = densify([me, ...pts]).slice(1, 12);
    if (dense.length) { bot.sendRoute(turning(me, dense), false); bot.queueFlush(); }
    await bot.tick(3);
}

/** Answer an open/coming dialog: resume plain pages, click the first option matching `answers` (one click per page). */
async function converse(c: Ctx, answers: RegExp[], done: () => boolean, maxTicks: number, label: string, start?: () => void): Promise<boolean> {
    const bot = c.bot, end = bot.tickCount + maxTicks;
    let lastSig = '', lastClick = -99, lastStart = -99;
    while (bot.tickCount < end && !bot.disposed) {
        if (done()) return true;
        if (bot.chatModalId !== -1) {
            const opts = bot.dialogOptions();
            if (opts.length) {
                const sig = opts.map(o => o.text).join('|');
                if (sig !== lastSig || bot.tickCount - lastClick >= 4) {
                    let hit = -1;
                    for (const re of answers) { hit = bot.clickDialogByText(re); if (hit > 0) break; }
                    if (hit < 0) console.log(`[legends-a] ${label}: unplanned choice [${sig}]`);
                    else { lastSig = sig; lastClick = bot.tickCount; }
                }
            } else bot.resumeDialogPage();
            bot.queueFlush();
        } else if (start && bot.mainModalId === -1 && bot.tickCount - lastStart >= 6) { start(); lastStart = bot.tickCount; }
        await bot.tick(1);
    }
    return done();
}

/** Route next to an npc and OPNPC1 (re-sent every 6 ticks while no dialog). */
const opNpcStart = (bot: SpeedBot, types: number[]) => () => { const n = npc(bot, types); if (n) opNpcGo(bot, n, 1); };

/** Route next to the nearest npc of `types` and use `obj` on it (OPNPCU), like q-lib opNpcGo. */
function useOnNpcGo(bot: SpeedBot, types: number[], obj: number): boolean {
    const n = npc(bot, types); const slot = bot.slot(obj);
    if (!n || slot < 0) return false;
    const me = bot.tile();
    if (Math.abs(me.x - n.x) + Math.abs(me.z - n.z) !== 1) {
        let pts: Array<{ x: number; z: number }> = [];
        try { pts = navSync().findLongPath(bot.minusedlevel, me.x, me.z, n.x, n.z, 500); } catch { pts = []; }
        const dense = densify([me, ...pts]).slice(1);
        while (dense.length && cheb(dense[dense.length - 1]!, n) === 0) dense.pop();
        if (dense.length) bot.sendRoute(turning(me, dense), true);
    }
    if (levelUpOpen(bot)) bot.resumeDialogPage();
    bot.useItemOnNpc(n.idx, obj, slot); bot.queueFlush();
    return true;
}

// ---------------------------------------------------------------------------------------------------------------------
// survival (coordinator, chains cae1/cae6: A died / walked at hp 8 — the bullroarer and jungle aggro wear it down)
// ---------------------------------------------------------------------------------------------------------------------
/** Whole-segment safety net (as seg-c/seg-d): eat a shark at <= 50% hp (a page is only interrupted when hp is critical), and a
 *  death watcher: "Oh dear, you are dead!" or a jump to the Lumbridge respawn makes every later bot.tick throw at once. */
async function withSafety<T>(bot: SpeedBot, label: string, body: () => Promise<T>): Promise<T> {
    const shark = objId('shark');
    let on = true, lastEat = -9, dead = '';
    const tick0 = bot.tick.bind(bot), since = bot.tickCount;
    (bot as any).tick = async (n = 1) => { await tick0(n); if (dead) throw new Error(dead); };
    (async () => {
        while (on && !bot.disposed) {
            const t = bot.tile();
            if (!dead && (msgsSince(bot, since).some(m => /Oh dear,? you are dead/i.test(m)) || (t.x >= 3200 && t.x <= 3245 && t.z >= 3195 && t.z <= 3240 && bot.minusedlevel === 0)))
                dead = `${label}: DIED (respawned at ${t.x},${t.z})`;
            const hp = bot.stat('hitpoints'), critical = hp.cur <= Math.max(20, Math.floor(hp.level * 0.3));
            if (hp.cur <= Math.floor(hp.level * 0.5) && (critical || bot.chatModalId === -1) && bot.tickCount - lastEat >= 3 && bot.count(shark) > 0) {
                bot.opHeld1(shark, bot.slot(shark)); bot.queueFlush(); lastEat = bot.tickCount;
            }
            await tick0(1);
        }
    })();
    try { return await body(); }
    catch (e) { if (dead) throw new Error(dead); throw e; }
    finally { on = false; (bot as any).tick = tick0; }
}
/** Jungle animals (oomlie bird 48, jungle wolf 143, jungle savage 931; all melee). Attacker = adjacent and facing a player. */
const ANIMALS = [48, 143, 931];
const attackers = (bot: SpeedBot) => npcsOf(bot, ANIMALS).filter(q => q.d <= 1 && ((bot.npcs[q.idx] as any)?.faceEntity ?? -1) >= 32768);
/** Recently hit (damage in the last `t` ticks), tracked by a per-bot damage watermark. */
const dmgSeen = new WeakMap<SpeedBot, { dmg: number; tick: number }>();
function recentlyHit(bot: SpeedBot, t = 6): boolean {
    const r = dmgSeen.get(bot) ?? { dmg: bot.damageTaken, tick: -99 };
    if (bot.damageTaken > r.dmg) { r.dmg = bot.damageTaken; r.tick = bot.tickCount; }
    dmgSeen.set(bot, r);
    return bot.tickCount - r.tick < t;
}
/** Kill whatever jungle animal is hitting us (re-attack every 4 t); ends 8 t after the last hit with no adjacent attacker. */
async function killAggressors(c: Ctx, label: string): Promise<void> {
    const bot = c.bot; let last = -100, lastHit = bot.tickCount, lastDmg = bot.damageTaken, hits = 0; const t = bot.tickCount;
    for (let j = 0; j < 200 && !inDialog(bot); j++) {
        if (bot.damageTaken > lastDmg) lastHit = bot.tickCount;
        lastDmg = bot.damageTaken;
        const recent = bot.tickCount - lastHit < 6;
        const a = attackers(bot)[0] ?? (recent ? npcsOf(bot, ANIMALS).filter(q => q.d <= 3)[0] : undefined);
        if (!a && bot.tickCount - lastHit >= 8) break;
        if (a && bot.tickCount - last >= 4) { bot.opNpc(a.idx, 2); bot.queueFlush(); last = bot.tickCount; hits++; }
        await bot.tick(1);
    }
    if (hits && c.verbose) log(bot, c.t0, `${label}: fought off jungle animals in ${bot.tickCount - t} t (hp ${bot.stat('hitpoints').cur}, sharks ${bot.count('shark')})`);
}
const underAttack = (bot: SpeedBot) => attackers(bot).length > 0 || recentlyHit(bot);
async function wieldScimitar(c: Ctx): Promise<void> {
    const bot = c.bot, SCIM = objId('rune_scimitar');
    for (let k = 0; k < 5 && !bot.isWorn(SCIM); k++) {
        if (bot.slot(SCIM) < 0) break;
        bot.opHeld2(SCIM, bot.slot(SCIM)); bot.queueFlush(); await bot.until(() => bot.isWorn(SCIM), 3);
    }
    if (!bot.isWorn(SCIM) && bot.slot(SCIM) >= 0) fail(c, 'could not wield the rune scimitar');
}

function jungleAt(x: number, z: number): locScene.SceneLoc | null {
    return locScene.getLocsAt(x, z, 0, { includeUnnamed: true }).find(l => JUNGLE.has(l.id)) ?? null;
}

/** Hack along column x (dir -1 = south, +1 = north) until z passes `untilZ`: a jungle tree/bush on the next tile is chopped
 *  (success teleports 2 tiles on, onto the far tile even when that holds another jungle loc), a free tile is walked. */
async function hackColumn(c: Ctx, x: number, dir: -1 | 1, untilZ: number, label: string): Promise<void> {
    const bot = c.bot;
    // fix 418 ( acct9 Legends attempt 1 'in@2819: off column 2819 at (2817,2941)': the walk to the column top
    // too and recovers by walking back onto the stand): off the column = re-walk onto it (the tile level with us, then one or
    // two back toward the start, then one on; tiles holding a jungle loc skipped; walkTo plans around doors/locs; a fight
    // first), up to 4 tries with a growing pause (a blocker moves on), before failing. LG_A_COLUMN_REWALK=0 reverts.
    // TEST: LG_A_COLUMN_TEST=<label> (e.g. in@2819) steps 2 tiles west of that column once before its first hack.
    const reWalk = async (): Promise<boolean> => {
        if (process.env.LG_A_COLUMN_REWALK === '0') return bot.tile().x === x;
        for (let k = 0; k < 4 && bot.tile().x !== x; k++) {
            const me = bot.tile();
            const cands = [me.z, me.z - dir, me.z - 2 * dir, me.z + dir].filter(z => !jungleAt(x, z));
            const tz = cands[k % Math.max(1, cands.length)] ?? me.z;
            log(bot, c.t0, `${label}: 418 off column ${x} at (${me.x},${me.z}) - re-walk to (${x},${tz}), try ${k + 1}`);
            if (underAttack(bot)) await killAggressors(c, label);
            await bot.walkTo(x, tz, { near: 0, maxTicks: 40 });
            if (bot.tile().x !== x) await bot.tick(2 + 2 * k);
        }
        return bot.tile().x === x;
    };
    if (process.env.LG_A_COLUMN_TEST === label && !(globalThis as any).__lg418) {
        (globalThis as any).__lg418 = 1;
        const me = bot.tile(); await bot.walkTo(me.x - 2, me.z, { near: 0, maxTicks: 20 });
        log(bot, c.t0, `${label}: 418 TEST stepped off the column to (${bot.tile().x},${bot.tile().z})`);
    }
    for (let guard = 0; guard < 16; guard++) {
        const me = bot.tile();
        if (dir < 0 ? me.z <= untilZ : me.z >= untilZ) return;
        if (me.x !== x && !(await reWalk())) fail(c, `${label}: off column ${x}`);
        if (bot.tile().z !== me.z) continue;   // the re-walk moved along the column: re-check the end first
        const nz = me.z + dir; const l = jungleAt(x, nz);
        if (!l) {
            const r = await bot.stepTo(x, nz, 12);
            if (c.verbose) log(bot, c.t0, `${label}: step -> (${bot.tile().x},${bot.tile().z}) ${r.ticks} t`);
            if (!r.ok && bot.tile().z !== nz) fail(c, `${label}: step to (${x},${nz})`);
            continue;
        }
        if (underAttack(bot)) await killAggressors(c, label);
        const p0 = bot.tile(); let moved = false, blocked = 0;
        // an op sent the tick a hack-through teleport lands (p_delay) is lost: settle a tick, and re-send every 12 t
        // (measured: a lost op cost a 40 t window per chop from a jungle-loc tile)
        await bot.tick(1);
        for (let k = 0; k < 8 && !moved; k++) {
            const w = watcher(bot);
            dismiss(bot);
            bot.opLoc(l.x, l.z, l.id, 1); bot.queueFlush();
            moved = await bot.until(() => cheb(bot.tile(), p0) >= 2 || w(/blocked off|need an axe|need a machete|get lost in this jungle/i), 12);
            if (w(/need an axe|need a machete|get lost in this jungle/i)) fail(c, `${label}: missing axe/machete/notes`);
            // session 8 (allchaos fork qt45gm 'out@2819: way blocked chopping (2819,2937)': jungle_tree.rs2:149 says 'blocked
            // off' when the landing tile is map_blocked at that moment, e.g. an npc/player standing there): transient, wait and
            // chop again (3 times) before failing. LG_BLOCKED_RETRY=0 reverts.
            if (w(/blocked off/i)) { blocked++; if (process.env.LG_BLOCKED_RETRY === '0' || blocked > 3) fail(c, `${label}: way blocked chopping (${l.x},${l.z})`); log(bot, c.t0, `${label}: blocked off at (${l.x},${l.z}) (${blocked}): waiting`); await bot.tick(4 + 2 * blocked); }
            moved = cheb(bot.tile(), p0) >= 2;
        }
        if (!moved) fail(c, `${label}: chop (${l.x},${l.z}) never went through`);
        if (c.verbose) log(bot, c.t0, `${label}: chopped (${l.x},${l.z}) -> (${bot.tile().x},${bot.tile().z})`);
    }
    fail(c, `${label}: too many steps`);
}

/** Map the section we stand in (opheld2 "Start Mapping" on the notes). Success = the game message "You still have some
 *  sections of the map to complete." (radimus_notes.rs2:614) or the completed map in the pack. Dialog text is NOT used (except
 *  307a's "already completed"): the pages repeat word for word per section, so a changed-text watch misses them. */
// session 11 fix 307 (qx65m 'west: mapping failed 8 times' at 2816,2931, retry 'middle: mapping failed 8 times' -> STOPPED qp 119).
// NOT supplies (CONFIRMED: every attempt line says papyrus 3, the pack holds charcoal x4). Cause CONFIRMED: (1) the sections are
// legends_zones.dbrow x ranges (z 2882-2935): west 2757-2815, middle 2816-2879, east 2880-2974. The bot reached the west anchor
// 2812,2932, but the jungle savage fight in mapHere pulled it to 2816,2931 (optrace 'interact op 4 npc 931@2817,2931 | me
// 2814,2932' -> 'me 2816,2931'), i.e. into the MIDDLE section, already mapped. (2) There radimus_notes.rs2 answers "You have
// already completed this part of the map." + the status page and uses nothing; mapHere read that as a "mess" roll (attempts 15 t
// apart = the 'opened, nothing used, t > 12' branch, not lost ops) and retried in place 8 times. The retry resumed in the jungle
// and re-mapped 'middle' first: the same answer, 8 more times. ('[ack] ACK-NOACK-EQUIP target=714/12' is a false alarm: the ack
// watcher expects a worn change for every opheld2; it fires on successful mappings too, e.g. qzd10.)
//   307a: "already completed this part" = this section is mapped (a resume re-maps middle/east: 2 t each, nothing used).
//   307b: before every attempt (after the fights) the bot must stand inside its section's zone, else it walks back to the anchor.
//   LG_MAP_FIX=0 reverts both. LG_MAP_ZONE_TEST=1 (proof only): the first west attempt is made from 2816,2931 as in qx65m.
const MAP_SECTIONS: Record<string, { x0: number; x1: number; at: { x: number; z: number } }> = {
    west: { x0: 2757, x1: 2815, at: { x: 2812, z: 2932 } }, middle: { x0: 2816, x1: 2879, at: { x: 2866, z: 2934 } }, east: { x0: 2880, x1: 2974, at: { x: 2882, z: 2932 } },
};
let zoneTestUsed = false;
async function mapHere(c: Ctx, label: string): Promise<void> {
    const bot = c.bot, MAP = objId('thkaramjamap'), COMP = objId('thkaramjamapcomp');
    const fix = process.env.LG_MAP_FIX !== '0', sec = MAP_SECTIONS[label];
    for (let k = 0; k < 8; k++) {
        if (bot.count(COMP) > 0) { dismiss(bot); return; }
        if (bot.count(MAP) === 0) fail(c, `${label}: no notes`);
        if (underAttack(bot)) await killAggressors(c, label);
        if (process.env.LG_MAP_ZONE_TEST === '1' && label === 'west' && !zoneTestUsed) {
            zoneTestUsed = true; await walkOp(bot, { x: 2816, z: 2931 }, null, () => false, { maxTicks: 30 });
            log(bot, c.t0, `zone test: mapping west from ${JSON.stringify(bot.tile())}`);
        }
        if (fix && sec) {   // 307b
            const me = bot.tile();
            if (bot.minusedlevel !== 0 || me.x < sec.x0 || me.x > sec.x1 || me.z < 2882 || me.z > 2935) {
                log(bot, c.t0, `${label}: at ${JSON.stringify(me)}, outside the ${label} section (x ${sec.x0}-${sec.x1}): back to ${JSON.stringify(sec.at)}`);
                await walk(c, sec.at.x, sec.at.z, `${label} section (back)`, { maxTicks: 120 });
                if (underAttack(bot)) await killAggressors(c, label);
                continue;
            }
        }
        dismiss(bot);
        await bot.tick(1);
        const since = bot.tickCount, pap0 = bot.count('papyrus'), ch0 = bot.count('charcoal');
        if (pap0 === 0 || ch0 === 0) fail(c, `${label}: out of papyrus/charcoal`);
        if (fix) for (const [key, v] of bot.ifText) if (/already completed this part/i.test(v)) bot.ifText.set(key, '');   // stale page text
        bot.opHeld2(MAP, bot.slot(MAP)); bot.queueFlush();
        const okMsg = () => msgsSince(bot, since).some(t => /You still have some sections of the map/i.test(t));
        let res = '', opened = false, already = false;
        for (let t = 0; t < 25 && !res; t++) {
            await bot.tick(1);
            if (bot.count(COMP) > 0) res = 'done';
            else if (okMsg()) res = 'ok';
            else if (bot.chatModalId !== -1) {
                opened = true;
                const txt = [...bot.ifText.values()].join(' ');
                if (/not even in the Kharazi|Crafting level of at least/i.test(txt)) res = 'err';
                else if (/already completed this part/i.test(txt)) { already = true; if (fix) res = 'ok'; }   // 307a
                if (!bot.dialogOptions().length) { bot.resumeDialogPage(); bot.queueFlush(); }
            } else if (!opened && t >= 5) res = 'retry';   // the opheld was lost (sent on the arrival tick): re-send
            else if (opened && bot.count('papyrus') === pap0 && bot.count('charcoal') === ch0 && t > 12) res = 'retry';   // a "mess" roll: nothing used
        }
        if (res === 'err') fail(c, `${label}: mapping refused (zone/level)`);
        if (res === 'done' || res === 'ok') { if (already) log(bot, c.t0, `${label}: already mapped (section done before)`); await bot.tick(1); dismiss(bot); return; }
        if (c.verbose) log(bot, c.t0, `${label}: mapping attempt ${k + 1} -> ${res || 'timeout'}${already ? ' (already completed)' : ''} at ${JSON.stringify(bot.tile())} (papyrus ${bot.count('papyrus')})`);
    }
    fail(c, `${label}: mapping failed 8 times`);
}

async function segA(bot: SpeedBot, ctx: SegCtx): Promise<Record<string, unknown>> { return withSafety(bot, 'legends-A', () => segABody(bot, ctx)); }
async function segABody(bot: SpeedBot, ctx: SegCtx): Promise<Record<string, unknown>> {
    await nav();
    bot.holdDialogs = true;
    const c: Ctx = { bot, t0: bot.tickCount, m: {}, verbose: ctx.verbose };
    const MAP = objId('thkaramjamap'), COMP = objId('thkaramjamapcomp'), BULL = objId('bullroarer'), MACHETE = objId('machette');
    dropAllOf(bot, KIT_JUNK);   // tutorial junk (the rune axe from supply does the chopping)
    await bot.until(() => !bot.inv().some(sl => KIT_JUNK.map(objId).includes(sl.obj)), 6);
    // a fresh account's tutorial kit fills the pack: whatever of the hand-off did not fit (sim run sa2: the sharks) is
    // handed over again now that there is room, then verified (the scimitar counts when worn)
    const SCIM = objId('rune_scimitar');
    // helper mode (route): the carry-in (HELPER_CARRY) has 4 sharks, not 5 (A ate none in the route-stats sim); no hand-off
    // session 11 (fork qyb06: a retry after 'mapDone' went back to the guild and threw 'supply incomplete' (papyrus spent)):
    // a RESUME on Karamja at the jungle (z <= 2941) holding the machete and the notes or the completed map goes on from there:
    // no guild/ship/cart, no mapping once the map is complete, no papyrus/charcoal/coins check. LG_A_JRESUME=0 reverts.
    const tj = bot.tile();
    const jResume = process.env.LG_A_JRESUME !== '0' && isResuming(bot) && bot.minusedlevel === 0 && tj.x >= 2780 && tj.x <= 2900 && tj.z >= 2880 && tj.z <= 2941
        && bot.count(MACHETE) > 0 && (bot.count(MAP) > 0 || bot.count(COMP) > 0);
    const aNeed0 = ctx.helper ? A_SUPPLY.filter(i => i.name !== 'shark') : A_SUPPLY;
    const aNeed = !jResume ? aNeed0 : aNeed0.filter(i => ['rune_axe', 'rune_scimitar'].includes(i.name) || (bot.count(COMP) === 0 && ['papyrus', 'charcoal'].includes(i.name))).map(i => ({ ...i, n: 1 }));
    const missingA = () => aNeed.filter(i => bot.count(i.name) + (objId(i.name) === SCIM && bot.isWorn(SCIM) ? 1 : 0) < i.n)
        .map(i => ({ name: i.name, n: i.n - bot.count(i.name) }));
    if (missingA().length && ctx.resupply && !ctx.helper) { await ctx.resupply(missingA()); await bot.tick(1); }
    if (missingA().length) fail(c, `supply incomplete: ${JSON.stringify(missingA())}`);
    await wieldScimitar(c);   // fight back in the jungle (auto-retaliate + killAggressors)
    // session 11: a retried A reads the journal first: 'I agreed to help Gujuo' (stage >= 5) = A is done. LG_JOURNAL=0 = as before.
    if (isResuming(bot) && process.env.LG_JOURNAL !== '0' && (await journalStage<number>(bot, 'legends', [[/I agreed to help Gujuo/i, 5]], 0, s2 => log(bot, c.t0, s2))) >= 5) {
        log(bot, c.t0, 'resume: the journal shows the rescue accepted (stage >= 5): segment A done');
        c.m.resumed = 5; c.m.exit = { pos: bot.pos(), sharks: bot.count('shark'), hp: bot.stat('hitpoints').cur, pack: bot.inv().length };
        return c.m;
    }
    if (c.verbose) log(bot, c.t0, `start: hp ${bot.stat('hitpoints').cur}/${bot.stat('hitpoints').level} sharks ${bot.count('shark')} scimitar worn ${bot.isWorn(objId('rune_scimitar'))} pack ${bot.inv().length}/28`);
    if (jResume) { c.m.jResume = 1; log(bot, c.t0, `resume in the jungle at ${JSON.stringify(bot.pos())}: map ${bot.count(COMP) > 0 ? 'complete' : 'notes'}, bullroarer ${bot.count(BULL) > 0}`); }

    if (!jResume) {
    // A1 guard -> inside the gate
    if (bot.tile().z < 3350) {
        if (!(await converse(c, [/^What is this place\?$/, /^Can I go on the quest\?$/, /^Yes, I'd like to talk to Grand Vizier Erkle\.$/],
            () => bot.tile().z >= 3350 && bot.chatModalId === -1, 120, 'guard', opNpcStart(bot, GUARDS)))) fail(c, 'guard: not let in');
    }
    mark(c, 'gate');
    // A2 Radimus (study)
    // session 11 (audit: a retried A waited at Radimus for the notes, which turn into the completed map when the mapping is
    // done: a dead end): with the notes or the map held, Radimus is skipped. LG_A2_SKIP=0 reverts.
    const notesHeld = () => bot.count(MAP) > 0 || (process.env.LG_A2_SKIP !== '0' && bot.count(COMP) > 0);
    if (!notesHeld() || bot.count(MACHETE) === 0) await walk(c, 2725, 3369, 'study');
    if (!(await converse(c, [/^Yes actually, what's involved\?$/, /^Yes, it sounds great!$/], notesHeld, 120, 'radimus',
        opNpcStart(bot, [RADIMUS])))) fail(c, 'radimus: no notes');
    mark(c, 'notes');
    // A3 cupboard (forceapproach east: stand on its east side): open, then search the open one
    for (let k = 0; k < 6 && bot.count(MACHETE) === 0; k++) {
        dismiss(bot);
        const open = bot.liveLocs.get('0,2724,3370') === CUPBOARD_OPEN;
        const stands = [{ x: 2725, z: 3370 }, { x: 2725, z: 3371 }];   // Radimus wanders onto these: take a free one
        const rad = npcsOf(bot, [RADIMUS]);
        const stand = stands.find(t => !rad.some(r => r.x === t.x && r.z === t.z)) ?? stands[k % 2]!;
        await walkOp(bot, stand, () => bot.opLoc(2724, 3370, open ? CUPBOARD_OPEN : CUPBOARD, open ? 2 : 1),
            () => open ? bot.count(MACHETE) > 0 : bot.liveLocs.get('0,2724,3370') === CUPBOARD_OPEN, { maxTicks: 12, quickGiveUp: true });
        // fix 179 (allchaos qt18gm 'cupboard: no machete', 6 walkOps from (2725,3369), one tile off, no progress, a chaos-open
        // study door leaf next to us): raw step onto the stand tile (server collision) + the op, when walkOp made no progress.
        // LG_CUPBOARD_RAW=0 reverts.
        const done = () => open ? bot.count(MACHETE) > 0 : bot.liveLocs.get('0,2724,3370') === CUPBOARD_OPEN;
        if (!done() && process.env.LG_CUPBOARD_RAW !== '0') {
            await bot.stepTo(stand.x, stand.z, 8);
            bot.opLoc(2724, 3370, open ? CUPBOARD_OPEN : CUPBOARD, open ? 2 : 1); bot.queueFlush();
            await bot.until(done, 6);
            console.log(`[legends] cupboard raw try ${k + 1}: ${done()} at ${JSON.stringify(bot.tile())}`);
        }
    }
    if (bot.count(MACHETE) === 0) fail(c, 'cupboard: no machete');
    dismiss(bot);
    mark(c, 'machete');
    // A4 out of the guild gate (op it from inside: stage >= 1 -> the guard nods and the gate walks us out), Ardougne docks
    if (!(await walkOp(bot, { x: 2728, z: 3350 }, () => bot.opLoc(2728, 3349, GUILD_GATE_L, 1), () => bot.tile().z <= 3349, { maxTicks: 80 }))) fail(c, 'guild gate out');
    await walk(c, 2681, 3275, 'barnaby', { near: 3, maxTicks: 400 });
    if (!(await converse(c, [/^Yes please\.$/], () => bot.minusedlevel === 1 && cheb(bot.tile(), LANDING_BRIM) <= 3, 80, 'barnaby',
        opNpcStart(bot, [BARNABY])))) fail(c, 'ship to Brimhaven');
    mark(c, 'ship');
    dismiss(bot);
    for (let k = 0; k < 4 && bot.minusedlevel !== 0; k++) {
        dismiss(bot);
        bot.opLoc(2774, 3234, GANGPLANK_BRIM, 1); bot.queueFlush();
        await bot.until(() => bot.minusedlevel === 0, 8);
    }
    if (bot.minusedlevel !== 0) fail(c, 'gangplank');
    // A5 Hajedy's cart -> Shilo
    await walk(c, 2779, 3213, 'hajedy', { near: 3, maxTicks: 200 });
    if (!(await converse(c, [/^Yes please, I'd like to go to Shilo Village\.$/], () => cheb(bot.tile(), SHILO_CART_AT) <= 3, 60, 'hajedy',
        opNpcStart(bot, [HAJEDY])))) fail(c, 'cart to Shilo');
    dismiss(bot);
    mark(c, 'shilo');
    // A6 out through the east gates and over the broken cart
    if (!(await walkOp(bot, { x: 2867, z: 2952 }, () => bot.opLoc(2867, 2952, SHILO_WOODGATE, 1), () => bot.tile().x >= 2868, { maxTicks: 80 }))) fail(c, 'shilo wooden gate');
    if (!(await walkOp(bot, { x: 2874, z: 2952 }, () => bot.opLoc(2875, 2952, SHILO_METALGATE, 1), () => bot.tile().x >= 2875, { maxTicks: 40 }))) fail(c, 'shilo metal gate');
    if (!(await walkOp(bot, { x: 2876, z: 2952 }, () => bot.opLoc(2877, 2951, SHILO_CART, 2), () => bot.tile().x >= 2880, { maxTicks: 40 }))) fail(c, 'broken cart');
    dismiss(bot);
    await walk(c, 2866, 2941, 'jungle edge', { maxTicks: 80 });
    mark(c, 'edge');
    }
    // A7 + A8 in, map middle / east / west
    if (!jResume || bot.count(COMP) === 0) {
    if (jResume && bot.tile().z >= 2937) await walk(c, 2866, 2941, 'jungle edge', { maxTicks: 80 });
    if (!jResume || bot.tile().z >= 2937) await hackColumn(c, 2866, -1, 2934, 'in@2866');
    else await walk(c, 2866, 2934, 'map middle', { maxTicks: 120 });
    mark(c, 'in1');
    await mapHere(c, 'middle');
    mark(c, 'mapMiddle');
    await walk(c, 2882, 2932, 'east section', { maxTicks: 80 });
    await mapHere(c, 'east');
    mark(c, 'mapEast');
    // W1 proof hook (test only): LG_A_WEDGE_TEST=1 attacks the nearest jungle animal within 12 here, as auto-retaliate did in
    // qye02 (an attack interaction on a wolf), and then walks west as usual
    if (process.env.LG_A_WEDGE_TEST === '1') {
        const a = npcsOf(bot, ANIMALS).sort((p, q) => p.d - q.d)[0];
        log(bot, c.t0, `wedge test: nearest animal ${a ? `${a.type}@${a.x},${a.z} d${a.d}` : 'none'}`);
        if (a && a.d <= 12) { bot.opNpc(a.idx, 2); bot.queueFlush(); await bot.until(() => cheb(bot.tile(), a) <= 1, 12); }
    }
    await walk(c, 2812, 2932, 'west section', { maxTicks: 200 });
    await mapHere(c, 'west');
    if (bot.count(COMP) === 0) fail(c, 'map not complete after 3 sections');
    mark(c, 'mapDone');
    }
    // A9 out north at x=2819, A10 forester
    if (!jResume || bot.count(BULL) === 0) {
    if (!jResume || bot.tile().z <= 2936) {
    await walk(c, 2819, 2936, 'exit column', { maxTicks: jResume ? 120 : 40 });
    await hackColumn(c, 2819, 1, 2940, 'out@2819');
    }
    mark(c, 'out');
    dropAllOf(bot, ['logs']);
    let tries = 0;
    if (!(await converse(c, [/^Yes, go ahead make a copy!$/], () => bot.count(BULL) > 0, 160, 'forester',
        () => { tries++; useOnNpcGo(bot, FORESTERS, COMP); }))) fail(c, `forester: no bullroarer (${tries} tries)`);
    dismiss(bot);
    mark(c, 'bullroarer');
    }
    // A11 back in, swing, Gujuo
    if (!jResume || bot.tile().z >= 2937) {
    await walk(c, 2819, 2940, 'entry column', { maxTicks: 60 });
    await hackColumn(c, 2819, -1, 2936, 'in@2819');
    }
    mark(c, 'in2');
    dropAllOf(bot, ['logs']);
    // Gujuo spawns on a random tile within 7 (map_findsquare) and walks over only when he has line of walk; next to the jungle
    // wall he can land in an unreachable pocket and then blocks new spawns within 14 tiles (bullroarer.rs2:669) — sim run p1b
    // lost 220 t / 17 swings that way at (2819,2934). So swing in open ground, talk to him ourselves if he is reachable but
    // idle, and move on to a spot >= 15 tiles away if he is stuck out of reach.
    const SPOTS = [{ x: 2840, z: 2925 }, { x: 2858, z: 2922 }, { x: 2822, z: 2927 }, { x: 2840, z: 2925 }];
    const w = watcher(bot);
    const accepted = () => w(/Gujuo disappears into the Kharazi Jungle/i);
    const reachable = (g: { x: number; z: number }) => {
        const me = bot.tile(); let pts: Array<{ x: number; z: number }> = [];
        try { pts = navSync().findLongPath(0, me.x, me.z, g.x, g.z, 64); } catch { pts = []; }
        const e = pts[pts.length - 1] ?? me;
        return cheb(e, g) <= 1;
    };
    let swings = 0;
    for (const spot of SPOTS) {
        if (accepted()) break;
        if (underAttack(bot)) await killAggressors(c, 'gujuo');
        await walk(c, spot.x, spot.z, 'swing spot', { near: 1, maxTicks: 80 });
        if (underAttack(bot)) await killAggressors(c, 'gujuo');
        let lastSwing = -99;
        await converse(c, [/^I was hoping to attract the attention of a native\.$/, /^I want to develop friendly relations with your people\.$/,
            /^Can you get your people together\?$/, /^What can we do instead then\?$/, /^How do we make the totem pole\?$/, /^I will release Ungadulu\.\.\.$/],
            accepted, 90, 'gujuo', () => {
                const a = attackers(bot)[0];   // never swing while being hit: fight back (the swing itself angers animals)
                if (a || recentlyHit(bot)) { if (a) { bot.opNpc(a.idx, 2); bot.queueFlush(); } lastSwing = bot.tickCount - 6; return; }
                const g = npc(bot, [GUJUO]);
                if (g && g.d <= 14) { if (reachable(g)) opNpcGo(bot, g, 1); return; }   // idle or stuck: talk if we can reach him
                if (bot.tickCount - lastSwing >= 10) { swings++; lastSwing = bot.tickCount; bot.opHeld1(BULL, bot.slot(BULL)); bot.queueFlush(); }
            });
        if (!accepted() && c.verbose) log(bot, c.t0, `gujuo: nothing at (${spot.x},${spot.z}) after ${swings} swings; ${situation(bot)}`);
    }
    if (!accepted()) fail(c, `gujuo: rescue not accepted (${swings} swings)`);
    dismiss(bot);
    mark(c, 'stage5');
    // room for B (chain ach1: B refuses unless pack + its 16-slot quest kit <= 28, i.e. A may leave <= 6 slots: B's spare scimitar takes one): drop the
    // logs/papyrus/charcoal and the tutorial air/water runes; eat leftover sharks while hurt, keep at most 2
    const SHARK = objId('shark');
    if (ctx.helper) {
        // helper mode: B's quest kit arrives at the anvil (seg-b), so A keeps its sharks (B's fight kit) and E's law/air runes;
        // only the spent mapping kit, the logs and the coins (nothing later pays) go
        dropAllOf(bot, ['logs', 'papyrus', 'charcoal', 'coins']);
        await bot.until(() => bot.count('logs') + bot.count('papyrus') + bot.count('charcoal') + bot.count('coins') === 0, 6);
        c.m.swings = swings;
        c.m.exit = { pos: bot.pos(), sharks: bot.count('shark'), hp: bot.stat('hitpoints').cur, pack: bot.inv().length };
        return c.m;
    }
    for (let k = 0; k < 6 && bot.count(SHARK) > 2 && bot.stat('hitpoints').cur <= bot.stat('hitpoints').level - 20; k++) {
        bot.opHeld1(SHARK, bot.slot(SHARK)); bot.queueFlush(); await bot.tick(3);
    }
    const extra = bot.inv().filter(sl => sl.obj === SHARK).slice(2);
    for (const sl of extra) bot.dropItem(sl.obj, sl.slot);
    dropAllOf(bot, ['logs', 'papyrus', 'charcoal', 'airrune', 'waterrune', 'coins']);   // coins too: 20 gp left, B needs nothing of it
    await bot.until(() => bot.count('logs') + bot.count('papyrus') + bot.count('charcoal') + bot.count('airrune') + bot.count('waterrune') + bot.count('coins') === 0 && bot.count(SHARK) <= 2, 6);
    c.m.swings = swings;
    c.m.exit = { pos: bot.pos(), sharks: bot.count('shark'), scimitarWorn: bot.isWorn(objId('rune_scimitar')), hp: bot.stat('hitpoints').cur, pack: bot.inv().map(s => `${s.obj}x${s.count}`).join(',') };
    return c.m;
}

/** What E must hold to travel: the hand-in items + Camelot runes (+ coins for the no-teleport fallback). */
// session 11 fix 264 (qyb08/qyh06 'out of papyrus/charcoal'): a failed mapping roll (~28% at our crafting) snaps the charcoal
// 63/128 of the time (radimus_notes.rs2:78-93); 2 sticks ran out ~15% of runs, 4 < 1%. LG_CHARCOAL=<n> overrides.
const A_SUPPLY = [{ name: 'coins', n: 60 }, { name: 'papyrus', n: 5 }, { name: 'charcoal', n: Number(process.env.LG_CHARCOAL ?? 4) }, { name: 'rune_axe', n: 1 },
    { name: 'rune_scimitar', n: 1 }, { name: 'shark', n: 5 }];
const E_KEEP = ['thkaramjamapcomp', 'thtotempolegift', 'lawrune', 'airrune', 'coins', 'shark', 'rune_axe', 'machette', 'rune_scimitar'];
const E_SUPPLY = [{ name: 'lawrune', n: 1 }, { name: 'airrune', n: 5 }, { name: 'coins', n: 40 }];

async function segE(bot: SpeedBot, ctx: SegCtx): Promise<Record<string, unknown>> { return withSafety(bot, 'legends-E', () => segEBody(bot, ctx)); }
async function segEBody(bot: SpeedBot, ctx: SegCtx): Promise<Record<string, unknown>> {
    await nav();
    bot.holdDialogs = true;
    const c: Ctx = { bot, t0: bot.tickCount, m: {}, verbose: ctx.verbose };
    const COMP = objId('thkaramjamapcomp'), GIFT = objId('thtotempolegift');
    // session 11 (audit: a throw after the hand-in made every retry fail 'E needs the completed map...'): items gone -> the
    // journal: 'I've handed the totem pole and map over to Radimus' = the hand-in is done (straight to the main hall);
    // QUEST COMPLETE = done. LG_E_RESUME=0 reverts.
    let handed = false;
    if ((bot.count(COMP) === 0 || bot.count(GIFT) === 0) && process.env.LG_E_RESUME !== '0') {
        if (bot.chatModalId !== -1) { bot.closeModal(); bot.queueFlush(); await bot.tick(1); }
        const j = await readJournal(bot, 'legends');
        log(bot, c.t0, `[journal] legends: ${j.ok ? `'${j.open.slice(0, 160)}'` : 'UNREADABLE'} (${j.ticks} t)`);
        if (j.ok && /QUEST COMPLETE/i.test(j.text)) { c.m.resumed = 'complete'; c.m.qp = qp(bot); return c.m; }
        handed = j.ok && /handed the totem pole and map\s+over/i.test(j.text);
    }
    if (!handed && (bot.count(COMP) === 0 || bot.count(GIFT) === 0)) fail(c, 'E needs the completed map and the gilded totem');
    const inGuildGrounds = () => bot.minusedlevel === 0 && bot.tile().z >= 3350 && bot.tile().z <= 3400 && bot.tile().x >= 2700 && bot.tile().x <= 2760;
    if (!handed || !inGuildGrounds()) {
    // E0 (chain cae4: D left a FULL pack, so the hand-off's air runes never arrived and the cast was refused "out of air runes"):
    // fight off attackers, make room (drop what E does not need, from the back), then hand over what is missing, verified.
    if (underAttack(bot)) await killAggressors(c, 'E0');
    // helper mode: the Camelot runes came in with the main (HELPER_CARRY); the coins are only for the no-teleport fallback
    const eNeed = ctx.helper ? E_SUPPLY.filter(i => i.name !== 'coins') : E_SUPPLY;
    const missing = () => eNeed.filter(i => bot.count(i.name) < i.n).map(i => ({ name: i.name, n: i.n - bot.count(i.name) }));
    const need = missing();
    if (need.length && ctx.helper) log(bot, c.t0, `E0 (helper mode): short of ${JSON.stringify(need)} - no hand-off in the jungle; the fallback walks out`);
    if (need.length && !ctx.helper) {
        const keep = new Set(E_KEEP.map(objId));
        const slots = need.filter(i => bot.count(i.name) === 0).length;
        const drop = bot.inv().filter(sl => !keep.has(sl.obj)).reverse().slice(0, Math.max(0, slots + 1 - bot.free()));
        for (const sl of drop) bot.dropItem(sl.obj, sl.slot);
        bot.queueFlush();
        await bot.until(() => bot.free() >= slots, 6);
        if (ctx.resupply) { await ctx.resupply(missing()); await bot.tick(1); }
        if (c.verbose) log(bot, c.t0, `E0: dropped ${drop.length}, resupplied ${JSON.stringify(need)}; still missing ${JSON.stringify(missing())}`);
    }
    // E1 Camelot teleport (fight first; up to 3 tries) -> the guild gate. Fallback (no runes / refused): hack out of the jungle,
    // walk to Brimhaven, the customs officer's ship to Ardougne, walk to the guild.
    let teleOk = false;
    // fix 308b (qx60m: the retry stood at 2740,3342, 10 tiles from the gate, and still cast Camelot Teleport + walked 75 t back):
    // a resume already on the mainland within 40 tiles of the gate skips the teleport (E0 still runs). LG_E_NEAR=0 reverts.
    const nearGuild = process.env.LG_E_NEAR !== '0' && bot.minusedlevel === 0 && cheb(bot.tile(), { x: 2728, z: 3348 }) <= 40;
    if (nearGuild) log(bot, c.t0, `E1: resume near the guild gate at ${JSON.stringify(bot.pos())}: no teleport`);
    if (!nearGuild) {
    for (let k = 0; k < 3 && !teleOk && process.env.LEG_E_FALLBACK !== '1'; k++) {   // LEG_E_FALLBACK=1: test the fallback
        if (bot.count('lawrune') < 1 || bot.count('airrune') < 5) break;
        if (underAttack(bot)) await killAggressors(c, 'tele');
        dismiss(bot);
        teleOk = (await tele(bot, 'camelot_teleport')).ok;
        if (!teleOk && c.verbose) log(bot, c.t0, `camelot teleport try ${k + 1} failed: ${situation(bot)}`);
    }
    if (teleOk) mark(c, 'tele');
    else { c.m.fallback = true; await eFallback(c); mark(c, 'fallback'); }
    }
    // session 11 fix 308a (qx60m 'walk guild gate (2728,3348)' at 2738,3342; CONFIRMED by the engine optrace: 't65125-65358
    // qx60m interact op 4 npc 143@2799,2897 -> target kept | me 2730..2740,3342..3346'): E0 killed an oomlie bird (target
    // cleared t65050), a jungle wolf hit us around the teleport cast and auto-retaliate made it the player's interaction (t65054,
    // already at the Camelot landing); it survived the teleport. walkOp's MOVE_OPCLICK does not clear it, so whenever the sent route
    // ran out the engine pathed toward the wolf ~450 tiles south-east, and the bot see-sawed 2730,3346 <-> 2740,3342 three tiles
    // from the gate until the 300 t walk limit. Clear it with one MOVE_GAMECLICK route toward the gate (as W1's unwedge does).
    // LG_E_CLEAR=0 reverts. No TEST switch: the auto-retaliate timing could not be forced (a player attack is cleared by the
    // cast, qzd06 optrace; waiting up to 60 t for an animal to hit before the cast never got a hit, qzd08/11/12).
    if (process.env.LG_E_CLEAR !== '0') await gameClickToward(c, 2728, 3348);
    await walk(c, 2728, 3348, 'guild gate', { maxTicks: 300 });
    const inGuild = () => bot.tile().z >= 3350 && bot.tile().z <= 3352 && Math.abs(bot.tile().x - 2728) <= 2;
    if (!(await walkOp(bot, { x: 2728, z: 3349 }, () => bot.opLoc(2728, 3349, GUILD_GATE_L, 1), inGuild, { maxTicks: 40 }))) fail(c, 'guild gate');
    mark(c, 'gate');
    }
    // E2 hand in (study)
    if (!handed) {
    await walk(c, 2725, 3369, 'study');
    if (!(await converse(c, [], () => bot.count(GIFT) === 0 && bot.count(COMP) === 0, 80, 'handin', opNpcStart(bot, [RADIMUS])))) fail(c, 'radimus: hand-in');
    dismiss(bot);
    mark(c, 'handin');
    } else log(bot, c.t0, `resume: handed in already (journal): to the main hall from ${JSON.stringify(bot.pos())}`);
    // E3 main hall: training x4, quest complete
    if (!(await walkOp(bot, { x: 2728, z: 3373 }, () => bot.opLoc(2728, 3373, GUILD_DOOR_L, 1), () => bot.tile().z >= 3374, { maxTicks: 60 }))) fail(c, 'main hall doors');
    mark(c, 'hall');
    const want = (process.env.LEG_TRAIN ?? 'attack,defence,strength,hitpoints').split(',').map(s => s.trim().toLowerCase()).filter(Boolean).slice(0, 4);
    const xp0 = new Map(want.map(s => [s, bot.stat(s).xp]));
    const trained = () => want.filter(s => bot.stat(s).xp > xp0.get(s)!);
    const title = (s: string) => s[0]!.toUpperCase() + s.slice(1);
    const hall = () => { const all = npcsOf(bot, [RADIMUS]).filter(n => n.z >= 3373); if (all[0]) opNpcGo(bot, all[0], 1); };
    let lastPick = -99;
    // quest complete: the questscroll main modal (interface 297) opens and ~update_questpoints rewrites %qp (in the sim it is
    // recomputed from the quest varps, so it can even DROP below the cheated 107)
    const QUESTSCROLL = 297;
    // NOT %qp: the sim recomputes it at odd moments (run sf2: it changed during the fallback trip, before any training)
    const wq = watcher(bot);
    const done = () => bot.mainModalId === QUESTSCROLL || (trained().length === want.length && wq(/completed the[\s\S]*Legends Guild Quest/i));
    const end = bot.tickCount + 200;
    let lastStart = -99;
    while (!done() && bot.tickCount < end) {
        if (bot.chatModalId !== -1) {
            const opts = bot.dialogOptions();
            if (opts.length) {
                if (bot.tickCount - lastPick >= 3) {
                    const left = want.filter(s => !trained().includes(s));
                    let hit = bot.clickDialogByText(/^Yes, I'll train now\.$/);
                    for (const s of left) { if (hit > 0) break; hit = bot.clickDialogByText(new RegExp(`^\\* ${title(s)} \\*$`)); }
                    if (hit < 0) hit = bot.clickDialogByText(/Go to Skill Menu/);
                    if (hit > 0) lastPick = bot.tickCount;
                }
            } else bot.resumeDialogPage();
            bot.queueFlush();
        } else if (bot.mainModalId === -1 && bot.tickCount - lastStart >= 8) { hall(); lastStart = bot.tickCount; }
        await bot.tick(1);
    }
    if (!done()) fail(c, `quest not completed (trained ${trained().join(',')})`);
    await bot.tick(2);
    dismiss(bot);
    mark(c, 'complete');
    c.m.trained = trained();
    c.m.qp = qp(bot);
    return c.m;
}

/** E without a teleport: out of the jungle (column x=2819, needs the map/axe/machete), walk to Brimhaven, customs officer
 *  ("Can I journey on this ship?" > "Search away, I have nothing to hide." > "Ok.", 30 gp) to Ardougne, gangplank down. */
async function eFallback(c: Ctx): Promise<void> {
    const bot = c.bot, me = () => bot.tile();
    if (me().z <= 2939 && me().z >= 2880 && me().x >= 2757 && me().x <= 2974) {
        await walk(c, 2819, 2936, 'fallback exit column', { maxTicks: 300 });
        await hackColumn(c, 2819, 1, 2940, 'fallback out@2819');
    }
    await walk(c, 2774, 3228, 'brimhaven customs', { near: 3, maxTicks: 900 });
    const ARD_SHIP = { x: 2683, z: 3268 };
    if (!(await converse(c, [/^Can I journey on this ship\?$/, /^Search away, I have nothing to hide\.$/, /^Ok\.$/],
        () => bot.minusedlevel === 1 && cheb(me(), ARD_SHIP) <= 4, 90, 'customs', opNpcStart(bot, [380])))) fail(c, 'fallback: ship to Ardougne');
    dismiss(bot);
    for (let k = 0; k < 4 && bot.minusedlevel !== 0; k++) {
        const plank = locScene.findNearbyLoc(/gangplank/i, me().x, me().z, 1, 5);
        if (!plank) fail(c, 'fallback: no gangplank on the Ardougne ship');
        dismiss(bot); bot.opLoc(plank!.x, plank!.z, plank!.id, 1); bot.queueFlush();
        await bot.until(() => bot.minusedlevel === 0, 8);
    }
    if (bot.minusedlevel !== 0) fail(c, 'fallback: gangplank');
}

export const SEG_A: Seg = {
    id: 'A', title: "start, map the Kharazi jungle, bullroarer, Gujuo", fromStage: 0, toStage: 5,
    pre: { ...PREREQ, tele: { x: 2728, z: 3346 } },
    supply: A_SUPPLY,
    run: segA,
};
export const SEG_E: Seg = {
    id: 'E', title: 'hand in the totem + map, Radimus training, quest complete', fromStage: 45, toStage: 75,
    pre: {
        ...PREREQ, varps: { ...PREREQ.varps, legendsquest: 45, legends_bits: 0 },
        // D's leftovers that matter to E: the hand-in items, sharks, and the axe + machete (the no-teleport fallback hacks out)
        items: [{ name: 'thtotempolegift', n: 1 }, { name: 'thkaramjamapcomp', n: 1 }, { name: 'shark', n: 3 }, { name: 'rune_axe', n: 1 }, { name: 'machette', n: 1 }],
        tele: { x: 2848, z: 2925 },
    },
    supply: E_SUPPLY,
    run: segE,
};
