// TRAVEL NETWORK — transports.json `phase: 4` rows (gnome gliders, spirit trees, Shilo carts, Captain Shanks,
// Fremennik longships, Holgart's rowboat, the Ardougne + KBD levers, Zanaris, Brimhaven agility arena, Mage Arena ladders,
// Elkoy) and two teleports (ring of dueling -> Castle Wars, enchanted lyre -> Rellekka). Every row is cited to the rev-289
// content in its `cite`. Real rsmod collision (all planes), ~25 s.
// Per edge: the planner PICKS it where it is the way (or the cheaper way: the travel pass, levels.ts planTravel) and SKIPS it
// when the requirement is missing. Plus: v2/default never see a phase-4 row, and travel:false leaves v3 plans as they were.
import { describe, test, expect, setDefaultTimeout } from 'bun:test';
import { planMultiLevel, planCost, describePlan, allTransports, type Leg, type TransportCaps, type PlanOpts } from '../../../../sdk/navgrid/levels.ts';
import { isTileWalkable, reachedLoc } from '../../../../sdk/pathfinding.ts';
import { locDims, locForceApproach } from '../../../../sdk/navgrid/locmeta.ts';
import { teleportById } from '../../../../sdk/navgrid/teleports.ts';

setDefaultTimeout(120_000);   // the first test pays the pathfinder + reach index boot
const C = (level: number, x: number, z: number) => ({ level, x, z });
const BASE: TransportCaps = { items: [995], coins: 5000, stats: { agility: 1, woodcutting: 1 }, hasAxe: false };
const Q = (...quests: string[]): TransportCaps => ({ ...BASE, quests });
const V3 = (caps: TransportCaps, extra: Partial<PlanOpts> = {}): PlanOpts => ({ graph: 'v3', reachGate: true, maxPortals: 8, transports: caps, cache: false, ...extra });
const ids = (p: Leg[] | null) => (p ?? []).flatMap(l => (l.portal?.id ? [l.portal.id] : []));
const end = (p: Leg[]) => p[p.length - 1]!.waypoints.at(-1)!;
const cheb = (a: { x: number; z: number }, b: { x: number; z: number }) => Math.max(Math.abs(a.x - b.x), Math.abs(a.z - b.z));
const P4 = allTransports().filter(t => t.phase === 4);

function uses(from: ReturnType<typeof C>, to: ReturnType<typeof C>, caps: TransportCaps, id: string, extra: Partial<PlanOpts> = {}) {
    const p = planMultiLevel(from, to, V3(caps, extra));
    expect(p).not.toBeNull();
    expect(ids(p)).toContain(id);
    expect(cheb(end(p!), to)).toBeLessThanOrEqual(1);
    return p!;
}
function skips(from: ReturnType<typeof C>, to: ReturnType<typeof C>, caps: TransportCaps, id: string) {
    const p = planMultiLevel(from, to, V3(caps));
    expect(ids(p)).not.toContain(id);
    return p;
}

describe('travel network: rows', () => {
    test('34 phase-4 rows, unique ids, every one cited; stands and landings walkable; loc rows operable', () => {
        expect(P4).toHaveLength(34);
        expect(new Set(allTransports().map(t => t.id)).size).toBe(allTransports().length);
        for (const t of P4) {
            expect((t as any).cite?.length ?? 0).toBeGreaterThan(20);
            expect(isTileWalkable(t.dest.level, t.dest.x, t.dest.z)).toBe(true);
            if (t.stand) {
                expect(isTileWalkable(t.level, t.stand.x, t.stand.z)).toBe(true);
                if (t.locId !== undefined) {
                    const { w, l } = locDims(t.locId);
                    expect(reachedLoc(t.level, t.stand.x, t.stand.z, t.x, t.z, w, l, t.angle ?? 0, t.shape ?? 10, locForceApproach(t.locId))).toBe(true);
                }
            } else if (t.locId !== undefined) {
                const { w, l } = locDims(t.locId);
                let face = false;
                for (let dx = -1; dx <= w && !face; dx++) for (let dz = -1; dz <= l && !face; dz++)
                    face = isTileWalkable(t.level, t.x + dx, t.z + dz) && reachedLoc(t.level, t.x + dx, t.z + dz, t.x, t.z, w, l, t.angle ?? 0, t.shape ?? 10, locForceApproach(t.locId));
                expect(face).toBe(true);
            }
        }
    });
    test("v2 and the default graph never see a phase-4 row (Ardougne lever, Zanaris)", () => {
        const all: TransportCaps = { ...BASE, worn: [772], items: [995, 772], wilderness: true };
        expect(ids(planMultiLevel(C(0, 2565, 3310), C(0, 3155, 3925), { graph: 'v2', reachGate: true, maxPortals: 8, transports: all, cache: false }))).not.toContain('lever-ardougne-wilderness');
        expect(planMultiLevel(C(0, 3200, 3175), C(0, 3220, 9592), { graph: 'v2', reachGate: true, maxPortals: 8, transports: all, cache: false })).toBeNull();
        expect(planMultiLevel(C(0, 3200, 3175), C(0, 3220, 9592))).toBeNull();
    });
});

describe('travel network: each edge picked when it is the way, skipped without its requirement', () => {
    test('gnome gliders (Grand Tree complete): Ta Quir Priw <-> Kar-Hewo', () => {
        uses(C(3, 2465, 3500), C(0, 3290, 3200), Q('grandtree'), 'glider-taquirpriw-karhewo');
        skips(C(3, 2465, 3500), C(0, 3290, 3200), Q(), 'glider-taquirpriw-karhewo');
        uses(C(0, 3285, 3208), C(3, 2465, 3500), Q('grandtree'), 'glider-karhewo-taquirpriw');
        skips(C(0, 3285, 3208), C(3, 2465, 3500), Q(), 'glider-karhewo-taquirpriw');
        expect(planMultiLevel(C(3, 2465, 3500), C(0, 3290, 3200), V3({ ...Q('grandtree'), members: false }))?.flatMap(l => l.portal?.id ?? [])).not.toContain('glider-taquirpriw-karhewo');
    });
    test('spirit trees: Stronghold -> Varrock (Grand Tree), Varrock -> Tree Gnome Village (Tree Gnome Village)', () => {
        uses(C(0, 2461, 3440), C(0, 3180, 3500), Q('grandtree'), 'spirittree-stronghold-varrock');
        skips(C(0, 2461, 3440), C(0, 3180, 3500), Q(), 'spirittree-stronghold-varrock');
        uses(C(0, 3180, 3500), C(0, 2540, 3170), Q('tree'), 'spirittree-varrock-village');
        skips(C(0, 3180, 3500), C(0, 2540, 3170), Q('grandtree'), 'spirittree-varrock-village');
    });
    test('Ardougne lever only with the wilderness opt-in; the keep lever brings you back', () => {
        uses(C(0, 2565, 3310), C(0, 3155, 3925), { ...BASE, wilderness: true }, 'lever-ardougne-wilderness');
        expect(planMultiLevel(C(0, 2565, 3310), C(0, 3155, 3925), V3(BASE))).toBeNull();   // the keep is sealed: no opt-in, no route
        uses(C(0, 3154, 3924), C(0, 2565, 3310), BASE, 'lever-wilderness-ardougne');
    });
    test('Zanaris: the shed door needs the dramen staff WORN; the ladder out asks first', () => {
        uses(C(0, 3200, 3175), C(0, 3220, 9592), { ...BASE, items: [995, 772], worn: [772] }, 'zanaris-shed-in');
        expect(planMultiLevel(C(0, 3200, 3175), C(0, 3220, 9592), V3({ ...BASE, items: [995, 772], worn: [] }))).toBeNull();
        const out = uses(C(0, 3253, 9592), C(0, 3260, 3171), BASE, 'zanaris-ladder-out');
        expect(out[0]!.portal!.action).toEqual({ kind: 'oploc', choose: ["^Yes, I'm ready to leave"] });
    });
    test('Shilo carts: Hajedy needs Shilo Village + 10 gp; Vigroy only the fare', () => {
        uses(C(0, 2770, 3220), C(0, 2840, 2960), Q('zombiequeen'), 'cart-brimhaven-shilo');
        expect(planMultiLevel(C(0, 2770, 3220), C(0, 2840, 2960), V3(Q()))).toBeNull();
        uses(C(0, 2840, 2960), C(0, 2770, 3220), BASE, 'cart-shilo-brimhaven');
        skips(C(0, 2840, 2960), C(0, 2770, 3220), { ...BASE, coins: 5 }, 'cart-shilo-brimhaven');
    });
    test('Captain Shanks (Cairn Isle ship): Port Sarim with Shilo Village + 45 gp', () => {
        uses(C(0, 2775, 3220), C(0, 3047, 3236), Q('zombiequeen'), 'ship-cairn-sarim');
        skips(C(0, 2775, 3220), C(0, 3047, 3236), Q(), 'ship-cairn-sarim');
        skips(C(0, 2775, 3220), C(0, 3047, 3236), { ...Q('zombiequeen'), coins: 40 }, 'ship-cairn-sarim');
    });
    test('Fremennik longships: Rellekka -> Miscellania needs the Fremennik Trials; back is free', () => {
        uses(C(0, 2625, 3690), C(0, 2582, 3846), Q('viking'), 'longship-rellekka-miscellania');
        expect(planMultiLevel(C(0, 2625, 3690), C(0, 2582, 3846), V3(Q()))).toBeNull();
        uses(C(0, 2582, 3846), C(0, 2625, 3690), BASE, 'longship-miscellania-rellekka');
    });
    test("Holgart's rowboat: Witchaven -> Fishing Platform needs Sea Slug", () => {
        uses(C(0, 2719, 3302), C(0, 2782, 3277), Q('seaslug'), 'rowboat-witchaven-platform');
        expect(planMultiLevel(C(0, 2719, 3302), C(0, 2782, 3277), V3(Q()))).toBeNull();
        uses(C(0, 2782, 3277), C(0, 2719, 3302), BASE, 'rowboat-platform-witchaven');
    });
    test('Brimhaven Agility Arena: 200 gp to Cap\'n Izzy, then the ladder', () => {
        uses(C(0, 2805, 3190), C(3, 2804, 9590), BASE, 'agilityarena-ladder-down');
        expect(planMultiLevel(C(0, 2805, 3190), C(3, 2804, 9590), V3({ ...BASE, coins: 150 }))).toBeNull();
    });
    test('Mage Arena cellar ladders (down: wilderness opt-in; from inside the ladder house, whose way in the base graph lacks)', () => {
        uses(C(0, 3091, 3958), C(0, 2542, 4712), { ...BASE, wilderness: true }, 'magearena-ladder-down');
        expect(planMultiLevel(C(0, 3091, 3958), C(0, 2542, 4712), V3(BASE))).toBeNull();
        uses(C(0, 2542, 4712), C(0, 3091, 3958), BASE, 'magearena-ladder-up');
    });
    test('KBD levers (in: wilderness opt-in)', () => {
        uses(C(0, 3067, 10254), C(0, 2717, 9803), { ...BASE, wilderness: true }, 'lever-kbd-in');
        expect(planMultiLevel(C(0, 3067, 10254), C(0, 2717, 9803), V3(BASE))).toBeNull();
        uses(C(0, 2717, 9803), C(0, 3067, 10254), BASE, 'lever-kbd-out');
    });
});

describe('travel network: the travel pass weighs a long-haul row against a walk that works', () => {
    test('Varrock -> Battlefield of Khazard: the young spirit tree (Tree Gnome Village) beats a ~600-tile walk', () => {
        const from = C(0, 3180, 3500), to = C(0, 2560, 3250);
        const walk = planMultiLevel(from, to, V3(Q('tree'), { travel: false }));
        expect(walk).not.toBeNull();
        expect(ids(walk)).not.toContain('spirittree-varrock-village');
        const tr = uses(from, to, Q('tree'), 'spirittree-varrock-village');
        expect(planCost(tr)).toBeLessThan(planCost(walk) - 100);
        skips(from, to, Q(), 'spirittree-varrock-village');
    });
    test('Elkoy beats the Tree Gnome Village maze walk (Tree Gnome Village complete)', () => {
        const from = C(0, 2504, 3195), to = C(0, 2515, 3159);
        const walk = planMultiLevel(from, to, V3(Q('tree'), { travel: false }));
        const tr = uses(from, to, Q('tree'), 'elkoy-maze-in');
        if (walk) expect(planCost(tr)).toBeLessThan(planCost(walk));
        skips(from, to, Q(), 'elkoy-maze-in');
    });
    test('travel:false and callers without a usable travel row get the same plan as before', () => {
        const routes: Array<[ReturnType<typeof C>, ReturnType<typeof C>]> = [
            [C(0, 3222, 3219), C(0, 3290, 3200)], [C(0, 3180, 3500), C(0, 2560, 3250)], [C(0, 2775, 3220), C(0, 3047, 3236)]];
        for (const [a, b] of routes) {
            const off = describePlan(planMultiLevel(a, b, V3(Q(), { travel: false })));
            expect(describePlan(planMultiLevel(a, b, V3(Q())))).toBe(off);
        }
    });
});

describe('travel network: teleports', () => {
    test('ring of dueling -> Castle Wars and the enchanted lyre (OPHELD1) -> Rellekka', () => {
        expect(teleportById('dueling-castlewars')!.landing).toEqual({ level: 0, x: 2440, z: 3090 });   // 0_38_48_8_18
        expect(teleportById('lyre-rellekka')!.landing).toEqual({ level: 0, x: 2662, z: 3644 });       // 0_41_56_38_60
        const cw = planMultiLevel(C(0, 3222, 3219), C(0, 2440, 3095), { teleports: { inv: { 2566: 1 } }, cache: false });
        expect(cw?.[0]?.teleport?.id).toBe('dueling-castlewars');
        expect(cw?.[0]?.teleport?.choice).toBe('Castle Wars');
        const ly = planMultiLevel(C(0, 3222, 3219), C(0, 2660, 3650), { teleports: { inv: { 3691: 1 } }, cache: false });
        expect(ly?.[0]?.teleport?.id).toBe('lyre-rellekka');
        expect(ly?.[0]?.teleport?.itemOp).toBe(1);
        expect(planMultiLevel(C(0, 3222, 3219), C(0, 2660, 3650), { teleports: { inv: { 3689: 1 } }, cache: false })?.[0]?.teleport).toBeUndefined();   // uncharged lyre
    });
});
