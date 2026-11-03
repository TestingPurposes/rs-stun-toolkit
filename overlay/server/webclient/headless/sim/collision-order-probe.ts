// Subprocess helper for collision-oracle.test.ts "init order" (one init ORDER per process: the rsmod WASM map and the
// init-once flags of sdk/pathfinding + sdk/navgrid are process-wide singletons, so orders cannot share a process).
//
//   bun headless/sim/collision-order-probe.ts <order> <out.json>
//
// Orders (what each entry point does, in sequence):
//   raw        rsmod zones + tiles straight from collision-data.json (doors CLOSED = engine boot state)
//   open       pf.initPathfinding() only (doors open; the SDK model blocked-tiles.ts was generated against)
//   speedrun   pf.initPathfinding -> applyBlockedEdges(pf.blockDoor) -> navgrid.init   (speedrun initNav, quest-runner,
//              and most other entry points)
//   pf-ae     pf.initPathfinding -> applyBlockedEdges(pf.blockDoor)                    (no navgrid)
//   nav-first  navgrid.init -> applyBlockedEdges(pf.blockDoor) -> pf.initPathfinding
//   ae-first   applyBlockedEdges(pf.blockDoor) -> pf.initPathfinding -> navgrid.init
//
// Output: per-tile 8-direction canTravel masks over the blocked-tiles corridor (L0), and for every door the
// pathfinder unmasks (pf.knownDoorCoords) a 16-bit mask (8 steps out of the door tile, 8 steps into it) plus whether
// pf.getDoorAt / navgrid.getDoorAt know it. `speedrun` also re-measures after a findLongPath temporary-door-block
// cycle (setDoorClosed true -> false), which must not erode the edge mask.
import fs from 'fs';
import path from 'path';

const HERE = import.meta.dir;
export const BOX = { x0: 2590, x1: 3270, z0: 3190, z1: 3530 };
export const DIRS: ReadonlyArray<readonly [number, number]> = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
/** Doors temp-blocked in the `speedrun` order's findLongPath cycle: a Varrock lockeddoor1 and an Ardougne diagonal door. */
export const TEMP_BLOCK = [{ level: 0, x: 3209, z: 3458 }, { level: 0, x: 2669, z: 3316 }];

if (import.meta.main) {
    const order = process.argv[2]!;
    const out = process.argv[3]!;
    const rsmod = await import('../../../vendor/rsmod-pathfinder');
    const { CollisionType } = rsmod;
    const can = (l: number, x: number, z: number, dx: number, dz: number) => rsmod.canTravel(l, x, z, dx, dz, 1, 0, CollisionType.NORMAL);

    let pf: typeof import('../../../../sdk/pathfinding') | null = null;
    let nav: typeof import('../../../../sdk/navgrid/index') | null = null;
    if (order === 'raw') {
        const data = JSON.parse(fs.readFileSync(path.resolve(HERE, '../../../../sdk/collision-data.json'), 'utf8')) as { tiles: number[][]; zones: number[][] };
        for (const [l, x, z] of data.zones) rsmod.allocateIfAbsent(x!, z!, l!);
        for (const [l, x, z, f] of data.tiles) rsmod.__set(x!, z!, l!, f!);
    } else {
        pf = await import('../../../../sdk/pathfinding');
        nav = await import('../../../../sdk/navgrid/index');
        const ae = async () => (await import('../blocked-edges')).applyBlockedEdges(pf!.blockDoor);
        const steps: Record<string, Array<() => unknown>> = {
            open: [() => pf!.initPathfinding()],
            speedrun: [() => pf!.initPathfinding(), ae, () => nav!.init()],
            'pf-ae': [() => pf!.initPathfinding(), ae],
            'nav-first': [() => nav!.init(), ae, () => pf!.initPathfinding()],
            'ae-first': [ae, () => pf!.initPathfinding(), () => nav!.init()],
        };
        if (!steps[order]) throw new Error(`unknown order ${order}`);
        for (const s of steps[order]!) await s();
    }

    const boxMask = (): string => {
        const W = BOX.x1 - BOX.x0 + 1, H = BOX.z1 - BOX.z0 + 1;
        const m = new Uint8Array(W * H);
        for (let x = BOX.x0; x <= BOX.x1; x++)
            for (let z = BOX.z0; z <= BOX.z1; z++) {
                let v = 0;
                DIRS.forEach(([dx, dz], i) => { if (can(0, x, z, dx, dz)) v |= 1 << i; });
                m[(x - BOX.x0) * H + (z - BOX.z0)] = v;
            }
        return Buffer.from(m).toString('base64');
    };
    const doorMask = (l: number, x: number, z: number): number => {
        let v = 0;
        DIRS.forEach(([dx, dz], i) => {
            if (can(l, x, z, dx, dz)) v |= 1 << i;                    // out of the door tile
            if (can(l, x - dx, z - dz, dx, dz)) v |= 1 << (8 + i);    // into the door tile
        });
        return v;
    };
    // Door list: the same static set pf unmasks (wall doors from collision-data + diagonal doors, minus one-way).
    const doorCoords = [...(await import('../../../../sdk/pathfinding')).knownDoorCoords()].map(k => k.split(',').map(Number) as [number, number, number]);
    const doors = doorCoords.map(([l, x, z]) => ({
        k: `${l},${x},${z}`,
        m: doorMask(l, x, z),
        pf: pf ? !!pf.getDoorAt(l, x, z) : false,
        nav: nav && order !== 'open' && order !== 'pf-ae' ? !!nav.getDoorAt(l, x, z) : null,
    }));
    const res: Record<string, unknown> = { order, box: boxMask(), doors };
    if (order === 'speedrun' && pf) {
        const blocked = TEMP_BLOCK.map(t => pf!.getDoorAt(t.level, t.x, t.z)).filter(Boolean) as any[];
        pf.findLongPath(0, 3210, 3462, 3210, 3450, 500, blocked);   // closes each door for the query, then re-opens it
        res.tempBlocked = blocked.length;
        res.boxAfterTempBlock = boxMask();
    }
    fs.writeFileSync(out, JSON.stringify(res));
    process.exit(0);
}
