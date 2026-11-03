// levelup-modal.test.ts — the level-up splash + the rev 289 MOVE_OPCLICK change, modelled from the engine.
//
// What the cloud runner saw on 289: "an open level-up modal blocks movement". The mechanism, read from source:
//   * levelup.rs2 [label,levelup]: if_openchat(levelup_<stat>) + p_pausebutton — a CHAT modal held by a paused script.
//   * Player.statAdvance: each advance that raises a base level enqueues [advancestat,<stat>] on the ENGINE queue,
//     which only runs while !busy(). A second level-up (combat: attack + hitpoints) stays QUEUED behind the splash.
//   * Player.updateMovement: `moveClickRequest && busy() && (queue || engineQueue)` -> no step this tick.
//   * MoveClickHandler, REV 289: `if (!message.opClick) player.clearPendingAction();` — 274 cleared on EVERY move.
//     So on 289 a MOVE_OPCLICK (the walk half of every walk-then-op a bot sends) leaves the splash open and
//     the walk is refused; a plain MOVE (GAMECLICK) still closes it, as do resume/close and every OP packet.
import { describe, test, expect } from 'bun:test';
import { readFileSync } from 'fs';
import { join } from 'path';
import { CoopWorld } from './coop.js';
import { SkillWorld } from './skills.js';
import { openField, type SimEvent } from './world.js';
import type { ClientAction } from './protocol.js';
import { ClientProt } from '#/io/ClientProt.js';

const S_ATTACK = 0, S_HITPOINTS = 3, S_FISHING = 10;
const PACK = join(import.meta.dir, '../../../content/pack/interface.pack');
const ifId = (name: string) => Number(readFileSync(PACK, 'utf8').split(/\r?\n/).find(l => l.endsWith(`=${name}`))!.split('=')[0]);
const move = (opclick: boolean, path: Array<{ x: number; z: number }>): ClientAction =>
    ({ type: 'move', opcode: opclick ? ClientProt.MOVE_OPCLICK : ClientProt.MOVE_GAMECLICK, opclick, ctrl: 0, path });

function rig(levelUpModals = true) {
    const w = new SkillWorld(openField(), 7);
    w.levelUpModals = levelUpModals;
    const p = w.addPlayer(10, 'lvl', 3200, 3200);
    const step = (a: ClientAction[] = []): SimEvent[] => w.coopTick(new Map([[10, a]]));
    return { w, p, step };
}
const kinds = (e: SimEvent[]) => e.map(x => x.kind);

describe('level-up splash (levelup.rs2) and the engine queue', () => {
    test('the splash interface comes from levelup.dbrow + interface.pack, per stat', () => {
        expect(CoopWorld.levelUpInterface(S_FISHING)).toBe(ifId('levelup_fishing'));
        expect(CoopWorld.levelUpInterface(S_ATTACK)).toBe(ifId('levelup_attack'));
        expect(CoopWorld.levelUpInterface(S_HITPOINTS)).toBe(ifId('levelup_hitpoints'));
    });

    test('a real stat advance that raises the level queues ONE [advancestat]; the splash opens next turn', () => {
        const { w, p, step } = rig();
        (w as unknown as { advanceStat(p: unknown, stat: number, units: number): void }).advanceStat(p, S_FISHING, 2_000);
        expect(p.engineQueue).toEqual([{ kind: 'levelup', stat: S_FISHING }]);
        const e = step();
        expect(kinds(e)).toContain('levelup-open');
        expect(p.chatModal).toBe(ifId('levelup_fishing'));
        expect(p.engineQueue.length).toBe(0);
    });

    test('default OFF: no splash, no queue (every older fixture keeps its meaning)', () => {
        const { w, p, step } = rig(false);
        (w as unknown as { advanceStat(p: unknown, stat: number, units: number): void }).advanceStat(p, S_FISHING, 2_000);
        step();
        expect(p.chatModal).toBe(-1);
        expect(p.engineQueue.length).toBe(0);
    });

    test('⭐ rev 289: splash open + a level-up still queued -> a MOVE_OPCLICK walk is REFUSED and the splash stays', () => {
        const { w, p, step } = rig();
        w.enqueueLevelUp(p, S_ATTACK); w.enqueueLevelUp(p, S_HITPOINTS);   // one combat kill, two levels
        step();
        expect(p.chatModal).toBe(ifId('levelup_attack'));
        expect(p.engineQueue.length).toBe(1);                              // hitpoints waits: busy()
        const e = [...step([move(true, [{ x: 3205, z: 3200 }])]), ...step(), ...step()];
        expect(kinds(e)).toContain('move-opclick-modal-kept');
        expect(kinds(e)).toContain('move-refused-busy');
        expect({ x: p.x, z: p.z }).toEqual({ x: 3200, z: 3200 });          // has not moved in 3 ticks
        expect(p.chatModal).toBe(ifId('levelup_attack'));
        // dismissing it lets the queued splash run, which is still a modal but with an EMPTY queue -> the walk goes
        const e2 = step([{ type: 'resume', com: ifId('levelup_attack') } as unknown as ClientAction]);
        expect(kinds(e2)).toContain('chatmodal-closed');
        step();
        expect(p.chatModal).toBe(ifId('levelup_hitpoints'));
        expect(p.engineQueue.length).toBe(0);
        for (let i = 0; i < 4; i++) step();
        expect(p.x).toBeGreaterThan(3200);                                 // walking now: busy() but nothing queued
    });

    test('a plain MOVE (GAMECLICK) still closes the splash (clearPendingAction) and walks', () => {
        const { w, p, step } = rig();
        w.enqueueLevelUp(p, S_ATTACK); w.enqueueLevelUp(p, S_HITPOINTS);
        step();
        const e = step([move(false, [{ x: 3205, z: 3200 }])]);
        expect(kinds(e)).toContain('chatmodal-closed');
        for (let i = 0; i < 4; i++) step();
        expect(p.x).toBeGreaterThan(3200);
    });

    test('any OP packet closes the splash too (every op handler runs clearPendingAction)', () => {
        const { w, p, step } = rig();
        w.enqueueLevelUp(p, S_ATTACK);
        step();
        expect(p.chatModal).not.toBe(-1);
        const e = step([{ type: 'oploc', op: 1, x: 3201, z: 3200, locId: 1276 } as ClientAction]);
        expect(kinds(e)).toContain('chatmodal-closed');
        expect(p.chatModal).toBe(-1);
    });
});
