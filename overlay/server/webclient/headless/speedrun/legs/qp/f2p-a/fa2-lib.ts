// fa2-lib.ts — f2p-a agent 2 helpers (Romeo & Juliet, Vampire Slayer). Builds on fa-lib.ts (not modified). Cheat-free.
import type { SpeedBot } from '../../../core.js';
import { cheb } from '../../../core.js';
import { msgsSince, doorOpen as qDoorOpen } from '../../q-lib.js';
import { getLocsAt } from '../../../../loc-scene.js';
import { walk, closeChat, fail, dead } from './fa-lib.js';
import DOOR_STATES from '../../../../../../../sdk/navgrid/door-states.json';

const DS = DOOR_STATES as unknown as Record<string, { state: string; op?: number }>;
/** a door at (level,x,z) is OPEN. MIGRATED to q-lib doorOpen's exact leaf-tile rule
 *  for the static door on that tile (the old "an open leaf on its tile or ANY neighbour" test took a neighbouring door's
 *  leaf for this door's: the BKF L1 pair, sim fgb4). No static door there: the old neighbour test. */
export function doorOpen(bot: SpeedBot, level: number, x: number, z: number): boolean {
    const st = getLocsAt(x, z, level, { includeUnnamed: true }).find(q => q.shape === 0 && DS[String(q.id)]?.state === 'closed');
    if (st) return qDoorOpen(bot, st.id, x, z, level);
    for (const [k, id] of bot.liveLocs) {
        const [l, lx, lz] = k.split(',').map(Number);
        if (l === level && Math.abs(lx! - x) <= 1 && Math.abs(lz! - z) <= 1 && DS[String(id)]?.state === 'open') return true;
    }
    return false;
}

/**
 * Stand on an exact tile, then send a RAW OPLOC (no client route: the engine's own reach check decides) until `done`.
 * For locs the client reach model gets wrong (Juliet's staircase 1722: forceapproach + rotation; the client says the north
 * side reaches, the engine says "I can't reach that!").
 */
export async function opLocFromTile(bot: SpeedBot, stand: { x: number; z: number; level?: number }, loc: { id: number; x: number; z: number }, op: number,
    done: () => boolean, what: string, maxTicks = 120): Promise<void> {
    const end = bot.tickCount + maxTicks;
    for (let k = 0; k < 4 && !done() && bot.tickCount < end; k++) {
        if (cheb(bot.tile(), stand) > 0) {
            await walk(bot, stand, 0, what, Math.max(20, end - bot.tickCount));
            if (cheb(bot.tile(), stand) > 0) await bot.walkTo(stand.x, stand.z, { near: 0, maxTicks: 10, log: false });
        }
        closeChat(bot);
        const t = bot.tickCount;
        bot.opLoc(loc.x, loc.z, loc.id, op); bot.queueFlush();
        await bot.until(done, 5);
        if (!done()) console.log(`[fa2] ${what}: op ${k + 1} from ${JSON.stringify(bot.pos())} no effect; msgs ${JSON.stringify(msgsSince(bot, t))}`);
        if (dead(bot)) fail(bot, `died at ${what}`);
    }
    if (!done()) fail(bot, what);
}

// Juliet's house (west Varrock). Staircase 1722 (3156,3435) L0 -> (1,3155,3435) (stairs.rs2:31), climbable from its EAST
// side only (3159,3435..3436); 1723 (1,3156,3435) -> (0,3159,3435) (stairs.rs2:76), from the WEST (3155,3435..3436).
export async function juliHouseUp(bot: SpeedBot, L: (s: string) => void): Promise<void> {
    if (bot.minusedlevel === 1) return;
    await opLocFromTile(bot, { x: 3159, z: 3436, level: 0 }, { id: 1722, x: 3156, z: 3435 }, 1, () => bot.minusedlevel === 1, 'Juliet stairs up', 300);
    L(`juliet L1 ${JSON.stringify(bot.pos())}`);
}
/** Juliet spawns at (1,3158,3425), SOUTH of the L1 wall door 1533 (3159,3427) (shape 0 angle 3 = the tile's south edge);
 *  closed (its default), an OPNPC from the north route fails and converse's retry walk burned 28 t on chaos seed 1101 (fc8).
 *  Open it first from (3159,3427). */
export async function juliDoor(bot: SpeedBot, L: (s: string) => void): Promise<void> {
    if (bot.minusedlevel !== 1) return;
    if (!doorOpen(bot, 1, 3159, 3427)) {
        await opLocFromTile(bot, { x: 3159, z: 3427, level: 1 }, { id: 1533, x: 3159, z: 3427 }, 1, () => doorOpen(bot, 1, 3159, 3427), 'Juliet room door', 40);
        L('juliet door opened');
    }
    // the OPEN leaf 1534 stands on (3159,3426) and walls off its west edge: an OPNPC routed through (3159,3426) towards Juliet
    // gets "I can't reach that!" (probe2-jdoor, chaos 1101; fc10 lost 38 t). Step into the room past the leaf first.
    if (cheb(bot.tile(), { x: 3159, z: 3425 }) > 0) {
        await walk(bot, { x: 3159, z: 3425, level: 1 }, 0, 'into the Juliet room', 30);
        if (cheb(bot.tile(), { x: 3159, z: 3425 }) > 0) await bot.walkTo(3159, 3425, { near: 0, maxTicks: 8, log: false });
    }
}
export async function juliHouseDown(bot: SpeedBot, L: (s: string) => void): Promise<void> {
    if (bot.minusedlevel === 0) return;
    await opLocFromTile(bot, { x: 3155, z: 3435, level: 1 }, { id: 1723, x: 3156, z: 3435 }, 1, () => bot.minusedlevel === 0, 'Juliet stairs down', 120);
    L(`juliet L0 ${JSON.stringify(bot.pos())}`);
}

// ---- amulet of glory: OPHELD4 "Rub" from the pack, then the p_choice5_header destination (amulet_of_glory.rs2:1-35:
// Edgeville (3087,3504), Karamja (2918,3176), Draynor Village (3105,3251), Al Kharid (3293,3163); ~player_teleport_normal)
import { ClientProt } from '#/io/ClientProt.js';
import { objId } from '../../../core.js';
import { NO_GLORY, noGloryHop } from '../noglory.js';
export const GLORIES = ['amulet_of_glory_4', 'amulet_of_glory_3', 'amulet_of_glory_2', 'amulet_of_glory_1'];
export function gloryHeld(bot: SpeedBot): string | null { return GLORIES.find(g => bot.count(objId(g)) > 0) ?? null; }
export async function gloryTele(bot: SpeedBot, dest: RegExp, maxTicks = 20): Promise<{ ok: boolean; ticks: number }> {
    const t0 = bot.tickCount, p0 = bot.pos();
    if (NO_GLORY()) { const okN = await noGloryHop(bot, dest, `gloryTele ${dest.source}`); return { ok: okN, ticks: bot.tickCount - t0 }; }   // charger pair (noglory.ts)
    const moved = () => cheb(bot.tile(), p0) > 8 || bot.minusedlevel !== p0.level;
    for (let k = 0; k < 3 && !moved() && bot.tickCount - t0 < maxTicks; k++) {
        const g = gloryHeld(bot); if (!g) break;
        // a rub sent in the same tick as the CLOSE_MODAL of a still-open npc chat prints "You rub the amulet..." but the
        // destination choice never shows (fc25, right after Harlow's stake page): close first, rub on the next tick
        if (bot.chatModalId !== -1 || bot.mainModalId !== -1) { closeChat(bot); bot.queueFlush(); await bot.tick(1); }
        const id = objId(g), slot = bot.slot(id), o = (bot as any).out;
        o.p1Enc(ClientProt.OPHELD4); o.p2(id); o.p2(slot); o.p2(3214);   // 3214 = inventory:inv
        bot.queueFlush();
        let chose = false;
        const end = bot.tickCount + 4, tr = bot.tickCount;
        while (!moved() && bot.tickCount < end) {
            if (!chose && bot.dialogOptions().some(x => x.text)) { chose = bot.clickDialogByText(dest) > 0; bot.queueFlush(); console.log(`[fa2] glory: rub ${k + 1} choice clicked=${chose} at +${bot.tickCount - t0}`); }
            await bot.tick(1);
        }
        if (!chose) console.log(`[fa2] glory: rub ${k + 1} no destination choice in 4 t; modal ${bot.mainModalId}/${bot.chatModalId} msgs ${JSON.stringify(msgsSince(bot, tr))}`);
        else { await bot.until(moved, 8); }
    }
    return { ok: moved(), ticks: bot.tickCount - t0 };
}
