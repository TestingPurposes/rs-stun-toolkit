/// <reference types="bun" />
// fk-lib.ts — additive helpers for The Knight's Sword + Pirate's Treasure (lane f2p-b, sub-builder fk). fb-lib.ts is untouched.
import { SpeedBot } from '../../../core.js';
import { mkLog, fail, converse } from './fb-lib.js';
import { nav, walkOp, locAt, opLocGo, R, M2, M3, climb as qClimb, type Tile } from '../../q-lib.js';

/** mkLog whose split lines also print the run energy (A/B: where does a walk run out of energy?). */
export function mkLogE(bot: SpeedBot, tag: string, on = true): ReturnType<typeof mkLog> {
    const log = mkLog(bot, tag, on);
    const s0 = log.split;
    log.split = (k: string) => { s0(k); if (on) console.log(`[${tag}]   energy ${bot.runEnergy}`); };
    return log;
}

/** Climb a stair/ladder `loc` (op `op`) from the tile `stand` next to it: walkOp with the OPLOC on the last chunk, then OPLOC
 *  retries until the level changes. MIGRATED q-lib climb (this was its origin); fails the quest like before. */
export async function climb(bot: SpeedBot, loc: { id: number; x: number; z: number; level: number }, stand: Tile, label: string, op = 1, maxTicks = 300): Promise<void> {
    // session 11 fix 316 TEST (FK_CLIMB_TEST=<label>): skip the q-lib climb once = it came back false far from the stairs
    const test = process.env.FK_CLIMB_TEST === label && !TESTED.has(label);
    if (test) { TESTED.add(label); console.log(`[fk] 316 TEST: ${label}: q-lib climb skipped at ${JSON.stringify(bot.pos())}`); }
    if (!test && await qClimb(bot, loc, stand, op, { maxTicks })) return;
    // session 11 fix 316 (FK_CLIMB_WALK; INFERRED qx75m 'castle L1->L2: climb 1722 failed at 2983,3337 L1' after 62 t from
    // squire2, not the 300 t walk budget: the walkOp gave up early (log off; a no-route bail on the 55-tile L1 detour through
    // doors 2966,3338 + 2990,3337, random sim door states), so q-lib's 30 t OPLOC-retry window was spent WALKING the detour and
    // ran out 2 tiles short of the south approach (2984,3336; stairs forceapproach=south). Retry: route to the exact stand
    // (door-aware) + OPLOC every 4 t; the budget counts only ticks without a position change (30), cap maxTicks.
    // FK_CLIMB_WALK=0 reverts.
    if (process.env.FK_CLIMB_WALK !== '0' && bot.minusedlevel === loc.level) {
        const l = locAt(loc.id, loc.x, loc.z, loc.level), t0 = bot.tickCount;
        let still = 0, last = '', k = 0;
        console.log(`[fk] ${label}: climb retry from ${JSON.stringify(bot.pos())} (316)`);
        while (bot.minusedlevel === loc.level && !bot.disposed && still < 30 && bot.tickCount - t0 < maxTicks) {
            if (bot.chatModalId !== -1) { bot.resumeDialogPage(); bot.queueFlush(); }
            else if (k++ % 4 === 0) opLocGo(bot, l, op, stand);
            await bot.tick(1);
            const key = `${bot.tile().x},${bot.tile().z}`; still = key === last ? still + 1 : 0; last = key;
        }
        if (bot.minusedlevel !== loc.level) { console.log(`[fk] ${label}: climbed on the 316 retry (+${bot.tickCount - t0} t)`); return; }
    }
    fail(bot, `${label}: climb ${loc.id} failed`);
}
const TESTED = new Set<string>();

/** Karamja -> Port Sarim by the customs officer's ship (30 gp; areas/area_karamja/scripts/customs_officer.rs2:1-90): with
 *  %hunt < 2 she searches you first (carry NO karamja_rum: it is confiscated, :45-55). set_sail = ship_journey modal +
 *  p_delay(7) + telejump to the ship deck (1,3032,3217) (interface_boat/scripts/sail.rs2:1-26); cross gangplank 2084
 *  (3031,3217 L1) to the quay. Ends on Port Sarim quay (L0). */
export async function boatKaramjaToSarim(bot: SpeedBot, label = 'boat'): Promise<void> {
    if (bot.count('coins') < 30) fail(bot, `${label}: need 30 coins`);
    const off = () => bot.tile().x > 3000 || bot.mainModalId !== -1;
    await converse(bot, 380, { x: 2954, z: 3146 }, [R, M2[0]!, R, R, M3[1]!, R, R, M2[0]!, R], off,
        [/^Can I journey on this ship\?$/, /^Search away, I have nothing to hide\.$/, /^Ok\.$/], label, { maxTicks: 40 });
    if (!(await bot.until(() => bot.tile().x > 3000, 20))) fail(bot, `${label}: no sail`);
    if (bot.minusedlevel === 1) await climb(bot, { id: 2084, x: 3031, z: 3217, level: 1 }, { x: 3032, z: 3217 }, `${label} gangplank`);
}
