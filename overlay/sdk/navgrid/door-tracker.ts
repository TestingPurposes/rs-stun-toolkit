// DOOR-STATE TRACKER — authoritative live open/closed state, read from the SERVER'S zone stream, not
// guessed. Every door bug this session traced to the bot being STATELESS about doors: the pathfinder
// pretends all doors are open, so the bot only discovers a shut one by wedging, then blind-opens by a
// radius heuristic. This tracks the truth.
//
// HOW IT'S CORRECT: opening a door is a scripted loc swap the client SEES —
//   open:  LOC_DEL at the door tile (the closed loc removed -> tile passable)
//        + LOC_ADD_CHANGE at the swing tile (the OPEN variant appears -> that tile now blocks)
//   close: the reverse.
// The variants are paired offline in door-states.json (category *_closed/*_opened + next_loc_stage).
// Feed onLocAddChange / onLocDel from the zone decode (LeanBot) and query doorAt / closedDoorAt.
import RAW from './door-states.json';

export interface DoorDef { state: 'closed' | 'open'; pair: number | null; op: number; name: string }
const STATES = RAW as Record<string, DoorDef>;

/** Is this loc id a tracked door variant, and which state does it represent? */
export function doorDef(locId: number): DoorDef | undefined { return STATES[String(locId)]; }
export function isDoorLoc(locId: number): boolean { return String(locId) in STATES; }

interface TileState { open: boolean; locId: number | null; tick: number }

export class DoorTracker {
    private tiles = new Map<string, TileState>();   // "level,x,z" -> current door state at that tile
    private seeds = new Map<string, number>();      // "level,x,z" -> the STATIC map placement's loc id
    private zoneTiles = new Map<string, Set<string>>();   // "level,zx,zz" (8x8 zone) -> tile keys we track there
    private tick = 0;
    private key(level: number, x: number, z: number): string { return `${level},${x},${z}`; }
    private index(level: number, x: number, z: number, k: string): void {
        const zk = `${level},${x >> 3},${z >> 3}`;
        let s = this.zoneTiles.get(zk);
        if (!s) { s = new Set(); this.zoneTiles.set(zk, s); }
        s.add(k);
    }
    setTick(t: number): void { this.tick = t; }

    // Seed from a static map placement (door-table / jm2). A placed door starts in its variant's state
    // (closed for a closed-variant placement). Only seeds tiles we don't already have live truth for.
    seed(level: number, x: number, z: number, locId: number): void {
        const d = doorDef(locId); if (!d) return;
        const k = this.key(level, x, z);
        this.seeds.set(k, locId);
        this.index(level, x, z, k);
        if (!this.tiles.has(k)) this.tiles.set(k, { open: d.state === 'open', locId, tick: 0 });
    }

    // Zone LOC_ADD_CHANGE: a loc appeared / changed at this tile. If it's a door variant, that tile now
    // holds a door in that variant's state (a CLOSED variant re-appearing = the door shut again).
    onLocAddChange(level: number, x: number, z: number, locId: number): void {
        const d = doorDef(locId); if (!d) return;
        const k = this.key(level, x, z);
        this.tiles.set(k, { open: d.state === 'open', locId, tick: this.tick });
        this.index(level, x, z, k);
    }

    /**
     * Zone UPDATE_ZONE_FULL_FOLLOWS: the server is RESETTING this 8x8 zone to the static map and will
     * re-send only what currently differs from it (Zone.writeFullFollows; the real client drops every
     * loc change in the zone — Client.ts UPDATE_ZONE_FULL_FOLLOWS). A door that is back in its DEFAULT
     * (closed) state is therefore never re-announced: without this reset, a bot that saw it opened, left
     * the zone's view (a level change sends FULL for every zone) and came back after the 500-tick revert
     * would believe it OPEN forever and never operate it (the Lumbridge castle (3215,3211) wedge).
     * (zoneX, zoneZ) = the zone's world SW tile; level = the viewer's plane.
     */
    resetZone(level: number, zoneX: number, zoneZ: number): void {
        const s = this.zoneTiles.get(`${level},${zoneX >> 3},${zoneZ >> 3}`);
        if (!s) return;
        for (const k of s) {
            const seeded = this.seeds.get(k);
            const d = seeded !== undefined ? doorDef(seeded) : undefined;
            if (seeded !== undefined && d) this.tiles.set(k, { open: d.state === 'open', locId: seeded, tick: this.tick });
            else { this.tiles.delete(k); s.delete(k); }   // a live-only entry (an open leaf) — not on the static map
        }
    }

    // Zone LOC_DEL: the loc at this tile was removed. If we knew a door there, the tile is now PASSABLE
    // (the open script loc_dels the CLOSED door; the open leaf is added elsewhere via LOC_ADD_CHANGE).
    onLocDel(level: number, x: number, z: number): void {
        const k = this.key(level, x, z);
        const cur = this.tiles.get(k);
        if (cur) this.tiles.set(k, { open: true, locId: null, tick: this.tick });
    }

    /** true = door here is open/passable; false = closed; undefined = no known door at this tile. */
    isOpen(level: number, x: number, z: number): boolean | undefined { return this.tiles.get(this.key(level, x, z))?.open; }

    /** A CLOSED door at this tile the follower must OPLOC — {locId, op} — or null if open/none. */
    closedDoorAt(level: number, x: number, z: number): { locId: number; op: number } | null {
        const cur = this.tiles.get(this.key(level, x, z));
        if (cur && !cur.open && cur.locId != null) { const d = doorDef(cur.locId); if (d) return { locId: cur.locId, op: d.op }; }
        return null;
    }

    /** Nearest CLOSED door within `radius` of (x,z) on the given level — for on-route proactive opening. */
    nearestClosed(level: number, x: number, z: number, radius: number): { x: number; z: number; locId: number; op: number } | null {
        let best: { x: number; z: number; locId: number; op: number } | null = null, bestD = Infinity;
        for (const [k, s] of this.tiles) {
            if (s.open || s.locId == null) continue;
            const [l, tx, tz] = k.split(',').map(Number);
            if (l !== level) continue;
            const cheb = Math.max(Math.abs(tx - x), Math.abs(tz - z));
            // TIE-BREAK ON MANHATTAN: a two-leaf gate puts both leaves at Chebyshev 1 from a bot beside
            // it; picking the DIAGONAL leaf (Death Plateau fence gate 3726 vs 3725) gets every OPLOC silently discarded.
            const d = cheb + (Math.abs(tx - x) + Math.abs(tz - z)) * 0.01;
            if (cheb <= radius && d < bestD) { const def = doorDef(s.locId); if (def) { bestD = d; best = { x: tx, z: tz, locId: s.locId, op: def.op }; } }
        }
        return best;
    }

    stats(): { known: number; open: number; closed: number } {
        let open = 0, closed = 0;
        for (const s of this.tiles.values()) { if (s.locId == null || s.open) open++; else closed++; }
        return { known: this.tiles.size, open, closed };
    }
    clear(): void { this.tiles.clear(); }
}
