// rsmod edge blocks for the steps the engine refuses (see blocked-tiles.ts and sdk/navgrid/edge-blocks.ts)
import { BLOCKED_EDGES } from './blocked-tiles.js';
import { addDirectedBlocks } from '../../../sdk/navgrid/edge-blocks.js';
import liveAcceptedEdges from '../../../sdk/navgrid/live-accepted-edges.json';

// Block every fake-gap edge in rsmod so findLongPath / findPathToLoc / reachedLoc stop routing through steps
// the server will never let us take — PER DIRECTION, exactly the steps blocked-tiles.ts lists (one entry wall on
// the destination tile, sdk/navgrid/edge-blocks.ts), and ORDER-INDEPENDENT (re-applied after navgrid.init() /
// initPathfinding() re-__set the shared map). Returns the number of directed edges applied.
//
// ⛔ (collision oracle): this used to call blockDoor() on both endpoints of every edge, which CLOSED THE
// WHOLE DOOR (all directions, incl. 13 openable diagonal doors — the shop-room over-mask) and deleted it
// from pf's door index; then navgrid.init(), called right after by ~80 entry points, re-opened all 35 of them. Net
// effect: rsmod never saw the mask, and pf.getDoorAt said "no door" at 35 tiles rsmod routed through.
// The parameter is kept so the ~90 call sites `applyBlockedEdges(blockDoor)` compile unchanged; it is NOT called —
// never close a whole door for one masked direction.
//
// ⛔ 55 of the 83 BLOCKED_EDGES are steps the ENGINE ACCEPTS (sim probe, sdk/navgrid/live-accepted-edges.json): the
// generator over-masks openable doors (Witchaven platform 2765,3277/3287 = the Sea Slug glass room, 4 Catherby-area
// houses + a gate, most diagonal-door steps). Blocking those in rsmod would seal rooms our legs walk into (Sea Slug
// "no glass"), so rsmod gets only the steps the engine really refuses (28: Varrock lockeddoor1 pair, guild doors,
// diagonal cuts past door corners, ...). navgrid.planRoute still masks all 83 (unchanged).
const LIVE_ACCEPTED = new Set((liveAcceptedEdges as { edges: number[][] }).edges.map(e => e.join(',')));
export const RSMOD_BLOCKED_EDGES: ReadonlyArray<[number, number, number, number]> = BLOCKED_EDGES.filter(e => !LIVE_ACCEPTED.has(e.join(',')));
export function applyBlockedEdges(_blockDoor?: (level: number, x: number, z: number) => boolean): number {
    return addDirectedBlocks(RSMOD_BLOCKED_EDGES, 0);
}
