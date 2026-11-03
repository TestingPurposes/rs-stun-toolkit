// DOOR-TRACKER SUITE — proves the tracker keeps CORRECT open/closed state from the zone events the
// server actually sends, through full open->close->open cycles. This is the foundation for door-aware
// navigation: the follower can now KNOW a door's state instead of discovering it by wedging.
import { describe, test, expect } from 'bun:test';
import { DoorTracker, doorDef, isDoorLoc } from '../../../../sdk/navgrid/door-tracker.ts';

// real ids from door-states.json: 1536 poordooropen (wizard tower, closed) <-> 1537 (open);
// 1530 inaccastledoubledoor (closed) <-> 1531 (open).
const WIZ_CLOSED = 1536, WIZ_OPEN = 1537;

describe('door-states data', () => {
    test('the doors this session fought are classified with their pairs', () => {
        expect(doorDef(WIZ_CLOSED)).toMatchObject({ state: 'closed', pair: WIZ_OPEN, op: 1 });
        expect(doorDef(1530)).toMatchObject({ state: 'closed' });
        expect(isDoorLoc(WIZ_CLOSED)).toBe(true);
        expect(isDoorLoc(999999)).toBe(false);
    });
});

describe('DoorTracker — authoritative state from zone events', () => {
    test('seed closed -> OPEN event flips it -> CLOSE event flips it back', () => {
        const t = new DoorTracker();
        t.seed(0, 3107, 3162, WIZ_CLOSED);                 // map-placed closed door
        expect(t.isOpen(0, 3107, 3162)).toBe(false);
        expect(t.closedDoorAt(0, 3107, 3162)).toMatchObject({ locId: WIZ_CLOSED, op: 1 });

        // OPEN: server loc_dels the closed door at the tile -> passable (the open leaf lands elsewhere)
        t.setTick(10); t.onLocDel(0, 3107, 3162);
        expect(t.isOpen(0, 3107, 3162)).toBe(true);
        expect(t.closedDoorAt(0, 3107, 3162)).toBeNull();  // nothing to open now

        // CLOSE: the closed variant re-appears at the tile
        t.setTick(20); t.onLocAddChange(0, 3107, 3162, WIZ_CLOSED);
        expect(t.isOpen(0, 3107, 3162)).toBe(false);
        expect(t.closedDoorAt(0, 3107, 3162)).toMatchObject({ locId: WIZ_CLOSED });
    });

    test('an OPEN-variant LOC_ADD_CHANGE marks the tile open (a door that opened before we saw it closed)', () => {
        const t = new DoorTracker();
        t.onLocAddChange(0, 3208, 3211, 1531);   // open variant appears -> open state
        expect(t.isOpen(0, 3208, 3211)).toBe(true);
    });

    test('non-door loc events are ignored (no phantom door state)', () => {
        const t = new DoorTracker();
        t.onLocAddChange(0, 3100, 3100, 999999);   // not a door id
        expect(t.isOpen(0, 3100, 3100)).toBeUndefined();
        t.onLocDel(0, 3100, 3100);                  // del of an untracked tile -> still nothing
        expect(t.isOpen(0, 3100, 3100)).toBeUndefined();
    });

    test('nearestClosed finds an on-route closed door to open proactively', () => {
        const t = new DoorTracker();
        t.seed(0, 3208, 3211, 1516);   // castle large door (closed)
        t.seed(0, 3107, 3162, WIZ_CLOSED);
        const near = t.nearestClosed(0, 3210, 3212, 4);
        expect(near).toMatchObject({ x: 3208, z: 3211 });
        expect(t.nearestClosed(0, 3210, 3212, 1)).toBeNull();   // wizard door too far, castle door >1
    });

    test('stats reflect the live open/closed split', () => {
        const t = new DoorTracker();
        t.seed(0, 1, 1, WIZ_CLOSED); t.seed(0, 2, 2, WIZ_CLOSED); t.seed(0, 3, 3, WIZ_CLOSED);
        t.onLocDel(0, 1, 1);   // open one
        expect(t.stats()).toMatchObject({ known: 3, open: 1, closed: 2 });
    });
});
