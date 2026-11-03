// =====================================================================================================
// legs/g1-clock.ts — the FLETCH CLOCK: 3-tick rolls for woodcutting, fishing and mining (owner: g1)
// =====================================================================================================
//
// ⭐ THE TRICK (measured locally, see g1-knife.ts probe). Every gathering script rolls when
// `%action_delay = map_clock` and, when it finds `%action_delay < map_clock`, re-arms it to clock+3
// (woodcutting), clock+4 (fly fishing) or clock+rate (mining). The roll period is therefore 4 / 5 /
// rate+1 ticks. `process_fletch_logs` (cut_logs.rs2) sets `%action_delay = map_clock + 2` (only when it
// is < map_clock) and weak-queues the cut. So, the tick AFTER a roll (R+1), ONE burst:
//     [drop the product] + OPHELDU(knife -> normal logs) + IF_BUTTON(skill_multi3:make1_a) + OP(resource)
//   * OPHELDU + IF_BUTTON run inside packet decoding (IfButtonHandler resumes the paused skill_multi3
//     script at once): %action_delay = R+3.
//   * the OPLOC/OPNPC handler's clearPendingAction() closes the chat modal AND clears the weak queue:
//     the log is never cut (no fletching xp, nothing consumed) and level-up dialogs are dismissed too.
//   * the resource script sees %action_delay > clock (no re-arm) and rolls at R+3.
// => a roll every 3 ticks whatever the tool's own rate: willow/oak 4 -> 3 (+33%), fly fishing 5 -> 3
//    (+67%), any pickaxe -> 3 (a bronze pickaxe mines like rune). Bonus: the op may need up to ~4 tiles
//    of movement and still roll at R+3 (arrival R+1/R+2 -> op at R+2/R+3; at R+3 `%action_delay =
//    map_clock` rolls straight from the first-swing / attempt label), so rock/tree switches are free.
// Needs: a knife + one NORMAL log (oak/willow logs open skill_multi2 and fail the fletching level check
// before the clock is set), a members world (fletching), <=5 USER_EVENT packets per burst.
// ⛔ Never send anything in the roll tick R: any OPHELD/OPLOC/OPNPC there clears the interaction first.
// ⛔ Normal rocks (copper/tin) p_delay(0) on success: the R+1 burst is refused while delayed. Iron is
//    `mining_rock_fast` (no delay). Use the clock only on iron.

import { SpeedBot, objId, componentId, cheb } from '../core.js';
import * as ls from '../../loc-scene.js';

export const KNIFE = 'knife';
export const CLOCK_LOG = 'logs';
let MAKE1: number | null = null;
const make1 = () => (MAKE1 ??= componentId('skill_multi3:make1_a'));

export function clockReady(bot: SpeedBot): boolean {
    return bot.count(KNIFE) > 0 && bot.count(CLOCK_LOG) > 0;
}
/** The two clock packets (no flush). Call FIRST in the R+1 burst, before the resource op. */
export function clockSends(bot: SpeedBot): Array<() => void> {
    const k = bot.slot(KNIFE), l = bot.slot(CLOCK_LOG);
    if (k < 0 || l < 0) return [];
    return [() => bot.useItemOnItem(objId(KNIFE), k, objId(CLOCK_LOG), l), () => bot.ifButton(make1())];
}

/** A gathering target: something we can re-op and check. */
export interface Target { key: string; op(): void; alive(): boolean; tile: { x: number; z: number }; willMove?(): boolean }

export interface GatherOpts {
    skill: string;                         // stat whose xp marks a success
    done: () => boolean;                   // stop condition (checked every tick)
    maxTicks: number;
    pick: (prev: Target | null, isBad: (key: string) => boolean) => Target | null;   // choose the next target (prev = current; skip isBad keys)
    drop: number[];                        // obj ids to power-drop
    keepOne?: number[];                    // ...but keep the first stack of these (the clock log)
    clock: boolean;                        // fletch clock (3-tick) or plain re-click
    maxDropsPerBurst?: number;             // USER_EVENT budget: 5 per tick; clock uses 2 + op (+MOVE)
    depleteOnSuccess?: number;             // the target always depletes on success (iron): blacklist it this many ticks at once (the zone update can lag the xp)
    successDelay?: number;                 // extra ticks after a success before the burst (copper/tin p_delay: 1)
    split?: boolean;                       // clock: send the resource op 2 ticks AFTER the clock packets, so the attempt label runs with
                                           // %action_delay = map_clock and rolls at once (net/bait labels only continue from their +3 branch)
    reanchor?: boolean;                    // clock: re-anchor the 3-tick schedule on each observed success (default off: purely periodic, robust to a constant link delay)
    lagMs?: number;                        // TEST: delay every burst by this many ms (simulates demo RTT locally)
    stallTicks?: number;                   // no success for this long -> re-pick
    log?: (t: number, msg: string) => void;
    onTick?: () => void;
}
export interface GatherStats { fuel?: string; ticks: number; successes: number; bursts: number; repicks: number; drops: number; gaps: Record<number, number> }

/**
 * The tick-tight gathering loop. CLOCK mode: one burst every 3 ticks, anchored to the last observed
 * success (a success seen at our tick k happened in server tick k; a burst sent now is processed in
 * k+1 = R+1). PLAIN mode: re-op only when needed (target gone, product to drop, stall), the engine's
 * own skill clock does the rest.
 */
export async function gather(bot: SpeedBot, o: GatherOpts): Promise<GatherStats> {
    const t0 = bot.tickCount;
    const st: GatherStats = { ticks: 0, successes: 0, bursts: 0, repicks: 0, drops: 0, gaps: {} };
    const dropSet = new Set(o.drop);
    const maxDrops = o.maxDropsPerBurst ?? 1;   // drop + OPHELDU + IF_BUTTON + (MOVE|CLOSE) + OP = 5 = the USER_EVENT cap
    const stall = o.stallTicks ?? (o.clock ? 24 : 30);
    const fuel0 = bot.count(CLOCK_LOG), home = bot.tile();
    let splitAt = -1;
    const bad = new Map<string, number>();
    const isBad = (k: string) => (bad.get(k) ?? -1) > bot.tickCount;
    let target: Target | null = o.pick(null, isBad);
    let lastXp = bot.stat(o.skill).xp, lastSuccess = bot.tickCount, lastBurst = -100, next = bot.tickCount;
    bot.ifButton(151); bot.queueFlush();   // controls:com_3 = auto-retaliate OFF: an npc hit must not swap our interaction to combat
    const prevHold = bot.holdDialogs;
    bot.holdDialogs = o.clock;             // the clock burst closes level-up dialogs itself
    try {
        while (!o.done() && bot.tickCount - t0 < o.maxTicks && !bot.disposed) {
            const t = bot.tickCount;
            if (cheb(bot.tile(), home) > 60) throw new Error(`gather: moved ${cheb(bot.tile(), home)} tiles from the spot (died?) at ${JSON.stringify(bot.pos())}`);
            const xp = bot.stat(o.skill).xp;
            if (xp > lastXp) {
                st.successes++;
                const g = t - lastSuccess; st.gaps[g] = (st.gaps[g] ?? 0) + 1;
                lastSuccess = t;
                if (o.depleteOnSuccess && target) { bad.set(target.key, t + o.depleteOnSuccess); target = o.pick(null, isBad); st.repicks++; }
                if (o.clock && (o.reanchor || o.successDelay)) next = t + (o.successDelay ?? 0);   // re-anchor on the observed roll
            }
            lastXp = xp;
            if (!target || !target.alive()) { target = o.pick(target, isBad); st.repicks++; if (o.clock) next = Math.min(next, t); }
            // every visible target blacklisted (moving fishing spots: FB10 idled 326 ticks next to three spots): forget the
            // blacklist and start over instead of waiting out 150 ticks per entry
            if (!target && bad.size && t - lastSuccess >= stall) {
                if (process.env.G1_DBG) console.log(`[g1] t${t} all ${bad.size} targets blacklisted: reset`);
                bad.clear(); bot.closeModal(); target = o.pick(null, isBad); lastSuccess = t; next = t;
            }
            if (t - lastSuccess >= stall) {   // no success for a while: blacklist this target for 150 ticks, take another
                if (target) bad.set(target.key, t + 150);
                if (process.env.G1_DBG) console.log(`[g1] t${t} STALL on ${target?.key}`);
                target = o.pick(null, isBad); st.repicks++; next = t; lastSuccess = t;
            }
            o.onTick?.();
            const kept = new Set<number>();
            const prods = bot.inv().filter(s => { if (!dropSet.has(s.obj)) return false; if (o.keepOne?.includes(s.obj) && !kept.has(s.obj)) { kept.add(s.obj); return false; } return true; });
            if (o.clock) {
                if (o.split && t === splitAt && target) { const tg = target; bot.burst([() => tg.op()]); }
                if (t >= next && target) {
                    const sends: Array<() => void> = [];
                    for (const s of prods.slice(0, maxDrops)) sends.push(() => bot.dropItem(s.obj, s.slot));
                    st.drops += Math.min(prods.length, maxDrops);
                    sends.push(...clockSends(bot));
                    const tg = target;
                    // ⛔ FUEL GUARD: if the op packet is refused (stale target: a rock/tree that just depleted) nothing
                    // clears the weak queue and the clock log gets cut at R+3. A MOVE (opLocReach adds one when it walks)
                    // clears it; otherwise CLOSE_MODAL does (Player.processQueues -> closeModal -> weakQueue.clear()).
                    if (o.split || !tg.willMove || !tg.willMove()) sends.push(() => bot.closeModal());
                    if (o.split) splitAt = t + 2; else sends.push(() => tg.op());
                    const lag = o.lagMs ?? Number(process.env.G1_LAG_MS ?? 0);
                    if (lag > 0) setTimeout(() => bot.burst(sends), lag); else bot.burst(sends);
                    if (process.env.G1_DBG) console.log(`[g1] t${t} burst n=${sends.length} target=${target.key} xp=${xp}`);
                    st.bursts++; lastBurst = t; next = t + 3;
                }
            } else {
                // plain: re-op with every drop (a drop clears the interaction), on a new target, or when idle
                const idle = t - Math.max(lastSuccess, lastBurst) >= 8;
                if (target && (prods.length || idle || t === next)) {
                    const sends: Array<() => void> = prods.slice(0, 3).map(s => () => bot.dropItem(s.obj, s.slot));
                    st.drops += Math.min(prods.length, 3);
                    const tg = target; sends.push(() => tg.op());
                    bot.burst(sends);
                    st.bursts++; lastBurst = t; next = -1;
                }
            }
            await bot.tick(1);
        }
    } finally {
        bot.holdDialogs = prevHold;
    }
    st.ticks = bot.tickCount - t0;
    st.fuel = `${fuel0}->${bot.count(CLOCK_LOG)}`;   // clock logs: a log is only lost when an op packet is refused (weak queue not cleared)
    return st;
}

// ---- targets ------------------------------------------------------------------------------------------
/** A scenery target (tree, rock) operated with opLocReach (MOVE_OPCLICK + OPLOC in one tick). */
export function locTarget(bot: SpeedBot, l: ls.SceneLoc, op: RegExp, nav?: any): Target {
    return { key: `${l.x},${l.z}`, tile: { x: l.x, z: l.z }, op: () => { bot.opLocReach(l, op); }, alive: () => bot.locAlive(l),
        willMove: nav ? () => locPathLen(bot, l, nav) > 0 : undefined };
}
/** Path length (tiles) from us to an interaction tile of loc `l` (0 = in reach). */
export function locPathLen(bot: SpeedBot, l: ls.SceneLoc, nav: any): number {
    const me = bot.tile();
    const fa = nav.locForceApproach(l.id);
    if (nav.reachedLoc(bot.minusedlevel, me.x, me.z, l.x, l.z, l.width, l.length, l.angle, l.shape, fa)) return 0;
    const p = nav.findPathToLoc(bot.minusedlevel, me.x, me.z, l.x, l.z, l.width, l.length, l.angle, l.shape, 500, fa);
    if (!p.length) return 999;
    let n = 0, cur = me;
    for (const w of p) { n += cheb(cur, w); cur = w; }
    return n;
}
/** An NPC target (fishing spot) by npc slot index; alive while the slot holds that type on the same tile. */
export function npcTarget(bot: SpeedBot, idx: number, op: number): Target {
    const n0 = bot.npcs[idx]!; const type = n0.typeId; const tile = bot.npcTileOf(n0);
    return {
        key: `${idx}@${tile.x},${tile.z}`, tile,
        op: () => { bot.opNpc(idx, op); },
        alive: () => { const n = bot.npcs[idx]; if (!n || n.typeId !== type) return false; const t = bot.npcTileOf(n); return t.x === tile.x && t.z === tile.z; },
    };
}
export function nearbyNpcs(bot: SpeedBot, re: RegExp, radius = 15): Array<{ idx: number; typeId: number; x: number; z: number; d: number; ops: string[] }> {
    const me = bot.tile(); const out = [];
    for (let i = 0; i < bot.npcCount; i++) {
        const idx = bot.npcIndices[i]!; const n = bot.npcs[idx]; if (!n) continue;
        const def = ls.npcDef(n.typeId); if (!def || !re.test(def.name)) continue;
        const t = bot.npcTileOf(n); const d = cheb(t, me); if (d > radius) continue;
        out.push({ idx, typeId: n.typeId, x: t.x, z: t.z, d, ops: def.options });
    }
    return out.sort((a, b) => a.d - b.d);
}
