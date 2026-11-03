// =====================================================================================================
// THE AL KHARID TOLL GATE — as GEOGRAPHY, in one place
// =====================================================================================================
// This is the only scripted obstacle on the mainland that a bot must PAY to cross. The typical failure
// is a bot that wedges at the gate spamming `[fb] dialog: choosing option 1 on modal 2469` —
// option 1 being "No thank you, I'll walk around." (the DECLINE).
//
// ⛔ WHY A SHARED MODULE AND NOT A THIRD COPY OF THE CONSTANTS. trainbot.ts and outfitter.ts each grew
// their own toll block, each with its own idea of which SIDE the crossing goes; the trainee copy was
// written for the pilot's EASTWARD walk (Ardougne -> Al Kharid) and silently did nothing for a bot
// leaving Al Kharid WESTWARD. The planner needs the same geography to say "this route crosses a
// toll", so the numbers now live in exactly one file with the source line for each. (The five
// hand-maintained gear ladders that drifted apart are this project's cautionary precedent.)
//
// SOURCE
//   content/scripts/areas/area_alkharid/scripts/border_gate.rs2
//     [oploc1,border_gate_toll_left|right] -> @find_and_talk_to_border_guard, which branches on
//     `coordx(coord) < coordx(loc_coord)`: WEST of the gate it needs borderguard1 within 1 tile, EAST of
//     it borderguard2. `[opnpc1,borderguard1|2]` both enter @talk_to_border_guard(null) directly.
//     p_choice3("No thank you, I'll walk around."=1, "Who does my money go to?"=2, "Yes, ok."=3);
//     option 3 does `inv_del(inv, coins, 10)` then @pass_toll_gate.
//   @pass_toll_gate / @enter_through_border_gate_toll do the DIRECTION themselves, from the PLAYER's own
//     x: standing west you are teleported 1 tile EAST, standing east you are teleported 1 tile WEST. So
//     both crossings are the same two packets — the only thing a client must get right is which tile to
//     stand on and which guard is on ITS side of the (closed) gate.
//   content/maps/m51_50.jm2  LOC  `0 4 27: 2882` / `0 4 28: 2883`  -> the gate halves at (3268,3227)
//                                  and (3268,3228), angle 0 = wall on the tile's WEST edge.
//                            NPC  `0 3 26|29: 925` (borderguard1, WEST at x=3267)
//                                 `0 4 26|29: 926` (borderguard2, EAST at x=3268)
//                            LOC  `997` (railing) runs x=3267/3268 from z~3204 to z~3238, closed off by
//                                 `1602` (timberwall) at z~3239 — i.e. the fence spans z 3204..3239 and
//                                 ENDS there: north of it the x=3268 line is open road (the Varrock ->
//                                 Al Kharid mine route, which is why "I'll walk around" is a real answer).
// =====================================================================================================

export interface Tile { x: number; z: number }

/** The LEFT gate half and its operable tile pair. `loc` is the one a client OPLOCs (either half works). */
export const TOLL_GATE = { x: 3268, z: 3227, loc: 2882, locRight: 2883, level: 0 } as const;
/** border_gate.rs2:53 — a flat `inv_del(inv, coins, 10)`. 10 is the ONLY boundary that matters. */
export const TOLL_COST = 10;

export type TollSide = 'west' | 'east';

/**
 * Where to stand before asking, per side. Standing exactly here makes BOTH content paths work with no
 * further movement: the same-side guard is inside `npc_find(coord, borderguardN, 1, 0)`, and the gate loc
 * is adjacent for the OPLOC path.
 *  west (3267,3227) -> teleported east to (3268,3227)
 *  east (3268,3227) -> teleported west to (3267,3227)
 */
export const TOLL_STAND: Record<TollSide, Tile> = {
    west: { x: 3267, z: 3227 },
    east: { x: 3268, z: 3227 },
};

/**
 * The guard on each side. ⛔ ASK THE ONE ON YOUR OWN SIDE. The gate is shut, so an OPNPC at the guard
 * across it is "I can't reach that!" forever — and the OPLOC path insists on the same thing anyway
 * (`find_and_talk_to_border_guard` looks for borderguard1 when you are west, borderguard2 when east).
 */
export const BORDER_GUARD: Record<TollSide, number> = { west: 925, east: 926 };

/**
 * The border fence's northern end (m51_50.jm2: railing 997 to z 3238, timberwall 1602 at z 3239).
 * NORTH of this the x=3268 meridian is open road, so "east of the gate" only means "behind the toll"
 * for tiles at or below it. Without this bound a Varrock-east camp would look like a toll crossing.
 */
export const TOLL_FENCE_MAX_Z = 3242;   // 3239 + slack for the wall's own footprint

/** How close to the gate the toll logic (and the toll ACCEPT) is allowed to engage. */
export const TOLL_RADIUS = 8;

export const cheb = (a: Tile, b: Tile): number => Math.max(Math.abs(a.x - b.x), Math.abs(a.z - b.z));

/**
 * Is this tile BEHIND the toll (the Al Kharid / desert side)? The half-plane alone is not enough — the
 * fence ends at z~3239 — so it is bounded in z as well.
 */
export function behindToll(t: Tile): boolean {
    return t.x >= TOLL_GATE.x && t.z <= TOLL_FENCE_MAX_Z;
}

export function tollSideOf(t: Tile): TollSide {
    return behindToll(t) ? 'east' : 'west';
}

/** Does getting from `from` to `to` mean paying the toll? Direction-agnostic, by construction. */
export function crossesToll(from: Tile, to: Tile): boolean {
    return behindToll(from) !== behindToll(to);
}

/** The tile to stand on to cross FROM this tile (i.e. on our own side of the gate). */
export function tollStandFrom(t: Tile): Tile { return TOLL_STAND[tollSideOf(t)]; }

/** The guard to talk to from this tile — always the one on our own side. */
export function tollGuardFrom(t: Tile): number { return BORDER_GUARD[tollSideOf(t)]; }

/** Near enough to the gate that a choice dialog here is the toll and nothing else. */
export function atTollGate(t: Tile, radius = TOLL_RADIUS): boolean {
    return cheb(t, TOLL_GATE) <= radius;
}

/**
 * Is (a)->(b) a step THROUGH the toll gate's wall edge? The gate halves sit at (3268,3227)/(3268,3228)
 * with the wall on their WEST edge, so a crossing is a step between x<=3267 and x>=3268 at those rows
 * (+-1 for a diagonal the densifier may emit next to it). Elsewhere on the fence (z 3204..3239) such a
 * step is impossible anyway, so the narrow band only ever sees the gate.
 */
export function stepCrossesTollGate(a: Tile, b: Tile): boolean {
    if ((a.x < TOLL_GATE.x) === (b.x < TOLL_GATE.x)) return false;
    const lo = Math.min(a.z, b.z), hi = Math.max(a.z, b.z);
    return lo >= TOLL_GATE.z - 1 && hi <= TOLL_GATE.z + 2;
}

/**
 * ⭐ THE ROUTE, NOT THE MAP. Does the REMAINING planned route (from waypoint `fromIdx` on) still step through the
 * toll gate, from the side this bot is standing on now?
 *
 * ⛔ WHY THE GEOGRAPHY ALONE IS NOT ENOUGH. `behindToll` is bounded at the fence's north end (z 3242) because
 * north of it the road is open — but the PLANNER does not know that the gate costs anything (navgrid masks it
 * open, see toll.test.ts defect 1), so a trip from the Lumbridge side to the Al Kharid NORTH mine (3303,3305) —
 * "same side" by the half-plane — is routed straight through the gate. Live, a bot heading there wedged 500+
 * ticks on (3267,3228) with plenty of coins, route-gate saying `NEEDS_PAYMENT ... toll 10 gp
 * (affordable)` and `crossesToll()` saying "no crossing", so tollAssist never armed. The converse is the same
 * bug the other way round: an Al Kharid-side bot heading for that mine is a "crossing" by the map and would pay
 * at the gate for a route that walks around it.
 *
 * ⛔ THE SIDE CHECK IS WHAT STOPS THE BOUNCE. After the toll teleports us across, the waypoint we were walking
 * at can still be the west tile of the crossing step; only a crossing whose FROM tile is on our current side is
 * one we still have to pay for.
 */
export function routeCrossesTollFrom(path: readonly Tile[] | null | undefined, fromIdx: number, me: Tile): boolean {
    if (!path || path.length < 2) return false;
    const west = me.x < TOLL_GATE.x;
    for (let i = Math.max(0, fromIdx - 1); i + 1 < path.length; i++) {
        const a = path[i]!, b = path[i + 1]!;
        if (stepCrossesTollGate(a, b) && (a.x < TOLL_GATE.x) === west) return true;
    }
    return false;
}
