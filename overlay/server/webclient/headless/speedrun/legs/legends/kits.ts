// =====================================================================================================
// legs/legends/kits.ts — Legends' Quest HELPER MODE supply.
// =====================================================================================================
// No kit is handed over inside the Kharazi jungle or the Shaman caves (a helper without Legends progress cannot get there).
//   CARRY  : the main brings HELPER_CARRY from its bank before the quest (A's kit, B's fight kit, E's Camelot runes).
//   MEET B : the helper waits north of the x=2816 jungle belt (2816,2947), on B's way to the anvil (golden bowl): B's quest
//            kit (16 slots, law topped up to 4 for E's Camelot teleport) + sharks to 4.
//   MEET C : the helper waits north of the jungle belt (2816,2947), on C's way to the herbs: C's kit + the prayer/boost kit
//            for C and D (D never leaves the jungle/caves).
// Both meeting points are mainland Karamja, walkable for a fresh account from the Karamja glory teleport / Brimhaven docks,
// and both are on the segments' own path: the main walks 0-7 extra tiles. The old sim hand-offs (ctx.resupply at the
// hand-off points) stay for the standalone launcher (run-legends.ts / legends.ts): helper mode is on only when ctx.helper
// is set.
import { HELPER_CARRY, MEET, type LegHelper } from './common.js';
import { SEG_B_RESUPPLY, B_SHARKS, B_POTS, SEG_B_HELPER_LAW, B_SAFE, B_NEZ_SHARKS } from './seg-b.js';
import { SEG_C_MEET, MIN_SHARKS } from './seg-c.js';

type Item = { name: string; n: number };
type Tile = { x: number; z: number; level?: number };
export { HELPER_CARRY, MEET };
export const HELPER_MEETS: Array<{ seg: 'B' | 'C'; at: Tile; items: Item[]; when: string }> = [
    { seg: 'B', at: MEET.B, items: [...SEG_B_RESUPPLY.map(i => i.name === 'lawrune' ? { ...i, n: SEG_B_HELPER_LAW } : i), { name: 'shark', n: B_SHARKS }, ...(process.env.LG_B_PRAYER === '0' ? [] : [{ name: '4doseprayerrestore', n: B_POTS - 1 }])], when: 'B: north of the jungle belt (2816,2947), on the way to the anvil (golden bowl)' },
    { seg: 'C', at: MEET.C, items: [...SEG_C_MEET, { name: 'shark', n: MIN_SHARKS }], when: 'C: north of the jungle belt (2816,2947), on the way to the herbs' },
];
/** everything the helper brings (its bank stock; also staged in the main's bank by the route) */
export const HELPER_STOCK: Item[] = (() => {
    const m = new Map<string, number>();
    for (const k of HELPER_MEETS) for (const i of k.items) m.set(i.name, (m.get(i.name) ?? 0) + i.n);
    // fix 417: B's food top-up before the dungeon/Nezikchened (seg-b restock: B_NEZ_SHARKS + healing sharks) + 1 prayer potion
    if (B_SAFE) { m.set('shark', (m.get('shark') ?? 0) + B_NEZ_SHARKS + 2); m.set('4doseprayerrestore', (m.get('4doseprayerrestore') ?? 0) + 1); }
    return [...m].map(([name, n]) => ({ name, n }));
})();

/** The segments' LegHelper on top of a route helper. `handoff` trades `items` to the main where it stands (the helper travels
 *  there itself); `dispatch` (optional) sends it ahead to a tile. After B's meeting the helper is sent on to C's meeting at
 *  once (C's meeting comes ~700-800 t later; the helper's bank trip + walk is ~300 t). */
/** `reset` (optional): log the helper out so its next use logs in afresh. A meeting whose trade fails (lgd1: the helper stood
 *  next to the main, saw the trade requests and answered none for 3 x 40 t, then could not teleport or walk either) is retried
 *  ONCE after a reset; a throw from the route's fallback (no bank is reachable from the meeting tiles) counts as a failure. */
export function legHelper(handoff: (items: Item[], label: string) => Promise<boolean>, dispatch?: (at: Tile, items: Item[], label: string) => void, reset?: (label: string) => Promise<void>): LegHelper {
    // one send per meeting (a second one made the helper re-bank for a fresh glory, lgr2); B and C share the tile, so the
    // meeting is told by the segment letter in the label ('legends B ...' / 'legends C ...')
    const sent = new Set<string>();
    const seg = (label: string) => /legends ([BC])/.exec(label)?.[1] ?? label;
    return {
        send: (at, items, label) => { if (sent.has(seg(label))) return; sent.add(seg(label)); dispatch?.(at, items, label); },
        meet: async (at, items, label) => {
            const tryOnce = async (l: string) => { try { return await handoff(items, l); } catch (e) { console.log(`[legends] ${l}: ${(e as Error).message.slice(0, 200)}`); return false; } };
            let ok = await tryOnce(label);
            if (!ok && reset) { console.log(`[legends] ${label}: trade failed - relogging the helper, one retry`); await reset(label); ok = await tryOnce(`${label} (retry)`); }
            if (seg(label) === 'B' && !sent.has('C')) { sent.add('C'); dispatch?.(MEET.C, HELPER_MEETS[1]!.items, 'legends C belt (sent ahead)'); }
            return ok;
        },
    };
}
