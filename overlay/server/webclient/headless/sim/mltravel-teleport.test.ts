// TELEPORT LEGS in the multi-level follower (LeanBot.mlDrive -> mlTeleportStep), OFFLINE in the CoopWorld.
//
// The world below ports the server's teleport scripts for the standard spellbook, faithfully on the points
// the follower depends on:
//   skill_magic/scripts/spells/teleport.rs2:1-7   the cast is IF_BUTTON on magic:<x>_teleport (1164 = Varrock ...)
//   magic.rs2:12-51 (~check_spell_requirements)   members world / magic level / runes (staff substitutes its
//                                                  element, magic.rs2:53-89) — a failure is a MESSAGE and NOTHING
//                                                  else: no runes taken, no movement
//   teleport.rs2:17-21                             wilderness > 20 -> "A mysterious force blocks ..."
//   teleport.rs2:47-51,54-62                       runes deleted, p_delay(2), p_telejump into
//                                                  map_findsquare(tele_coord, 0, 2) — the landing is SCATTERED
// What it proves: the bot casts (right component), waits out the delay without walking, recognises the
// scattered landing, advances to the next leg and arrives; a REFUSED cast drops the teleport for the session
// and re-plans to the walk; teleports off = the old 2-arg plan call, no cast.
// What it cannot prove: that IF_BUTTON 1164 is visible/accepted live (sidebar state) — a live smoke.
import { describe, test, expect, afterEach } from 'bun:test';
import { CoopWorld, CoopHarness, type CoopPlayer } from './coop.ts';
import { LeanBot, type MlLeg, type MlCoord } from '../leanbot.ts';
import { openField } from './world.ts';
import { linePath } from './harness.ts';
import type { ClientAction } from './protocol.ts';
import { TELEPORTS, usableTeleports, freeRunes, wildernessLevel, type TeleportCaps } from '../../../../sdk/navgrid/teleports.ts';
import { teleportLeg } from '../../../../sdk/navgrid/levels.ts';

const INV = 3214;
const MAGIC = 6;

class TeleWorld extends CoopWorld {
    members = true;
    scatter = { dx: 1, dz: -1 };   // deterministic map_findsquare pick inside radius 2
    private pendingTele = new Map<number, { due: number; to: MlCoord; id: string }>();
    private say(p: CoopPlayer, text: string) { p.outPre.push({ kind: 'msg', text }); this.events.push({ tick: this.tick, kind: 'tele-refused', detail: { player: p.name, text } }); }
    protected override applyAction(p: CoopPlayer, a: ClientAction): void {
        const t = a.type === 'ifbutton' ? TELEPORTS.find(s => s.kind === 'spell' && s.spellCom === a.com) : undefined;
        if (!t) { super.applyAction(p, a); return; }
        this.events.push({ tick: this.tick, kind: 'tele-cast', detail: { player: p.name, id: t.id } });
        if (t.members && !this.members) return this.say(p, "You need to be on a members' server to use this spell.");
        if ((p.stats.get(MAGIC)?.level ?? 1) < t.magicLevel!) return this.say(p, 'Your Magic level is not high enough for this spell.');
        const free = freeRunes(p.worn.get('rhand') ? [p.worn.get('rhand')!.id] : []);
        for (const r of t.runes!) if (!free.has(r.obj) && this.invTotal(p.inv, r.obj) < r.count) return this.say(p, 'You do not have enough Law Runes to cast this spell.');
        if (wildernessLevel({ level: p.level, x: p.x, z: p.z }) > 20) return this.say(p, 'A mysterious force blocks your teleport spell!');
        for (const r of t.runes!) if (!free.has(r.obj)) this.invRemove(p.inv, r.obj, r.count);
        p.outInvs.add(INV);
        p.clearWaypoints();   // p_stopaction
        this.pendingTele.set(p.index, { due: this.tick + 2, to: { level: t.landing.level, x: t.landing.x + this.scatter.dx, z: t.landing.z + this.scatter.dz }, id: t.id });
    }
    override coopTick(actions: Map<number, ClientAction[]>) {
        const out = super.coopTick(actions);
        for (const [idx, pt] of this.pendingTele) {
            if (this.tick < pt.due) continue;
            this.pendingTele.delete(idx);
            const p = this.playersByIndex.get(idx)!;
            p.teleport(pt.to.x, pt.to.z); p.level = pt.to.level;
            const ev = { tick: this.tick, kind: 'tele-landed', detail: { player: p.name, id: pt.id, to: pt.to } };
            this.events.push(ev); out.push(ev);
        }
        return out;
    }
}

class TravelBot extends LeanBot {
    constructor() { super(); this.mode = 'combat'; this.quiet = true; this.arrived = true; }
    protected override doCombat(): void { this.warm(); }
}

const START = { x: 3222, z: 3218 };            // Lumbridge
const GOAL = { level: 0, x: 3213, z: 3440 };   // north of the Varrock landing (3213,3424)
const VARROCK = TELEPORTS.find(t => t.id === 'varrock')!;
const CAMELOT = TELEPORTS.find(t => t.id === 'camelot')!;

// A planner stand-in that uses the REAL requirement predicate on the caps the bot built: it offers the
// teleport `want` only if usableTeleports() passes, else the plain walk.
function mkPlanner(want: string, calls: Array<{ args: number; caps?: TeleportCaps }>) {
    return (from: MlCoord, to: MlCoord, opts?: { teleports?: TeleportCaps }): MlLeg[] | null => {
        calls.push({ args: opts === undefined ? 2 : 3, caps: opts?.teleports });
        const t = usableTeleports(opts?.teleports ?? null, from).find(x => x.id === want);
        if (!t) return [{ waypoints: linePath(from.x, from.z, to.x, to.z) }];
        return [{ waypoints: [{ x: from.x, z: from.z }], teleport: teleportLeg(t) }, { waypoints: linePath(t.landing.x, t.landing.z, to.x, to.z) }];
    };
}

let h: CoopHarness | null = null;
afterEach(async () => { await h?.stop(); h = null; });

async function boot(world: TeleWorld, bot: TravelBot, name: string, index: number, magic: number, inv: Array<{ id: number; count: number }>) {
    h = new CoopHarness(world);
    bot.findLongPathFn = (_l, sx, sz, dx, dz) => linePath(sx, sz, dx, dz);
    h.add({ bot: bot as any, name, index, x: START.x, z: START.z, stats: [{ stat: MAGIC, xp: 13_034_431, level: magic }], inv });
    await h.start();
    for (let i = 0; i < 3; i++) await h.tick();   // stats + inv decoded before the plan is made
}

describe('mlDrive TELEPORT leg', () => {
    test('casts Varrock teleport (IF_BUTTON 1164), lands in the scatter, walks the next leg, arrives', async () => {
        const world = new TeleWorld(openField());
        const bot = new TravelBot();
        bot.mlTeleports = true;
        const calls: Array<{ args: number; caps?: TeleportCaps }> = [];
        bot.multiLevelPlanFn = mkPlanner('varrock', calls);
        await boot(world, bot, 'teler1', 30, 55, [{ id: 556, count: 3 }, { id: 554, count: 1 }, { id: 563, count: 1 }]);
        bot.startMultiTravel(GOAL.level, GOAL.x, GOAL.z);
        let ticks = 0;
        while (!bot.multiTravelDone && ticks < 120) { await h!.tick(); ticks++; }
        const p = h!.playerOf('teler1');
        expect(calls[0]!.args).toBe(3);
        expect(calls[0]!.caps!.magicLevel).toBe(55);                                   // decoded from UPDATE_STAT
        expect(world.events.filter(e => e.kind === 'tele-cast')).toHaveLength(1);      // ONE cast, no spam during p_delay
        expect(world.events.some(e => e.kind === 'tele-landed')).toBe(true);
        expect(bot.multiTravelDone).toBe(true);
        expect(Math.max(Math.abs(p.x - GOAL.x), Math.abs(p.z - GOAL.z))).toBeLessThanOrEqual(6);
        expect(ticks).toBeLessThan(60);                                                // vs ~220 tiles of walking
        expect(world.invTotal(p.inv, 563)).toBe(0);                                    // the law rune was spent
        expect(bot.mlTeleDropped.size).toBe(0);
    }, 30_000);

    test('a staff of air substitutes the 3 air runes (magic.rs2 staff_runes)', async () => {
        const world = new TeleWorld(openField());
        const bot = new TravelBot();
        bot.mlTeleports = true;
        const calls: Array<{ args: number; caps?: TeleportCaps }> = [];
        bot.multiLevelPlanFn = mkPlanner('varrock', calls);
        h = new CoopHarness(world);
        bot.findLongPathFn = (_l, sx, sz, dx, dz) => linePath(sx, sz, dx, dz);
        h.add({ bot: bot as any, name: 'teler2', index: 31, x: START.x, z: START.z, stats: [{ stat: MAGIC, xp: 100_000, level: 40 }],
            inv: [{ id: 1381, count: 1 }, { id: 554, count: 1 }, { id: 563, count: 1 }] });
        world.registerEquippable(1381, { wearpos: 'rhand' });
        await h.start();
        for (let i = 0; i < 2; i++) await h.tick();
        bot.opHeld2(1381, bot.slotOf(1381));   // wield the staff
        for (let i = 0; i < 4; i++) await h!.tick();
        expect(bot.isWorn(1381)).toBe(true);
        bot.startMultiTravel(GOAL.level, GOAL.x, GOAL.z);
        let ticks = 0;
        while (!bot.multiTravelDone && ticks < 120) { await h!.tick(); ticks++; }
        expect(calls[0]!.caps!.worn).toContain(1381);
        expect(world.events.some(e => e.kind === 'tele-landed')).toBe(true);
        expect(bot.multiTravelDone).toBe(true);
    }, 30_000);

    test('REFUSED cast (not a members server): message, no move; the teleport is dropped and the bot re-plans to WALK', async () => {
        const world = new TeleWorld(openField());
        world.members = false;
        const bot = new TravelBot();
        bot.mlTeleports = true;
        const calls: Array<{ args: number; caps?: TeleportCaps }> = [];
        bot.multiLevelPlanFn = mkPlanner('camelot', calls);
        await boot(world, bot, 'teler3', 32, 99, [{ id: 556, count: 5 }, { id: 563, count: 1 }]);
        const goal = { level: 0, x: 2757, z: 3500 };   // Camelot-ish: a long walk without the teleport
        bot.startMultiTravel(goal.level, goal.x, goal.z);
        for (let i = 0; i < 25; i++) await h!.tick();
        const p = h!.playerOf('teler3');
        expect(world.events.filter(e => e.kind === 'tele-cast')).toHaveLength(1);      // refused once, never re-cast
        expect(world.events.some(e => e.kind === 'tele-refused')).toBe(true);
        expect(world.events.some(e => e.kind === 'tele-landed')).toBe(false);
        expect(bot.mlTeleDropped.has('camelot')).toBe(true);
        expect(calls.length).toBeGreaterThanOrEqual(2);                                // re-planned...
        expect(calls[1]!.caps!.deny).toContain('camelot');                             // ...with it denied
        expect(world.invTotal(p.inv, 563)).toBe(1);                                    // no runes taken
        expect(Math.max(Math.abs(p.x - START.x), Math.abs(p.z - START.z))).toBeGreaterThan(5);   // now WALKING
        expect(p.x).toBeLessThan(START.x);                                             // toward the goal (west)
    }, 30_000);

    test('teleports OFF (default): the planner gets the old 2-arg call and nothing is cast', async () => {
        const world = new TeleWorld(openField());
        const bot = new TravelBot();   // mlTeleports null, FB_TELEPORTS unset
        const prev = process.env.FB_TELEPORTS; delete process.env.FB_TELEPORTS;
        try {
            const calls: Array<{ args: number; caps?: TeleportCaps }> = [];
            bot.multiLevelPlanFn = mkPlanner('varrock', calls);
            await boot(world, bot, 'teler4', 33, 99, [{ id: 556, count: 3 }, { id: 554, count: 1 }, { id: 563, count: 1 }]);
            bot.startMultiTravel(GOAL.level, GOAL.x, GOAL.z);
            for (let i = 0; i < 10; i++) await h!.tick();
            expect(calls[0]!.args).toBe(2);
            expect(world.events.some(e => e.kind === 'tele-cast')).toBe(false);
        } finally { if (prev !== undefined) process.env.FB_TELEPORTS = prev; }
    }, 30_000);

    test('no landing (cast swallowed, e.g. a random-event spawn) -> bounded re-casts, then dropped', async () => {
        class SwallowWorld extends TeleWorld {
            protected override applyAction(p: CoopPlayer, a: ClientAction): void {
                if (a.type === 'ifbutton' && a.com === VARROCK.spellCom) { this.events.push({ tick: this.tick, kind: 'tele-cast', detail: {} }); return; }
                super.applyAction(p, a);
            }
        }
        const world = new SwallowWorld(openField());
        const bot = new TravelBot();
        bot.mlTeleports = true;
        bot.multiLevelPlanFn = mkPlanner('varrock', []);
        await boot(world, bot, 'teler5', 34, 99, [{ id: 556, count: 3 }, { id: 554, count: 1 }, { id: 563, count: 1 }]);
        bot.startMultiTravel(GOAL.level, GOAL.x, GOAL.z);
        for (let i = 0; i < 45; i++) await h!.tick();
        expect(world.events.filter(e => e.kind === 'tele-cast')).toHaveLength(3);
        expect(bot.mlTeleDropped.has('varrock')).toBe(true);
    }, 30_000);
});

describe('camelot def sanity (used above)', () => {
    test('camelot is members-only and costs 5 air + 1 law', () => {
        expect(CAMELOT.members).toBe(true);
        expect(CAMELOT.runes).toEqual([{ obj: 556, count: 5 }, { obj: 563, count: 1 }]);
    });
});
