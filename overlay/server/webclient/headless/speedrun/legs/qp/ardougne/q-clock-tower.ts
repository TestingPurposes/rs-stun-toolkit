// q-clock-tower.ts — Clock Tower (quest_cog), cheat-free. Max-QP build, ardougne lane.
//
// Content (rev 289, server/content/scripts/): quests/quest_cog/scripts/{quest_cog,npcs/brother_kojo,objs/cogs,
// locs/quest_cog_spindles,locs/quest_cog_gates_and_levers,locs/quest_cog_food_trough}.rs2; quest_ikov/scripts/
// ikov_dungeon.rs2:1 (secret wall). Stage = bits 0-3 of %cogquest (quest_cog.constant), NOT transmitted.
// Flow (file:line):
//   Brother Kojo (2569,3249) "OK old monk, what can I do?"                     -> tasked     brother_kojo.rs2:9-18
//   BLUE: ladder (2621,3261) down, corridor to the secret wall (2575,9631, Push), blue cog (2574,9633), ladder (2572,9631)
//     up (one-way, lands south of the tower), tower stairs -> L1, cog on the blue spindle (2569,3240,1)  spindles.rs2
//   BLACK: tower cellar ladder (2566,3242); bucket of water on the black cog (2613,9639) cools it (cogs.rs2:30-37), take it,
//     black spindle in the cellar (2570,9642)
//   RED: red cog (2583,9613), back to the cellar ladder, red spindle on the ground floor (2568,3243)
//   WHITE: rat poison (2564,9662), lever (2591,9661) opens the cage gate (2595,9657) for 500 t (gates_and_levers.rs2:28-42),
//     poison in the trough (2586,9654) (food_trough.rs2:1-15), the far gate (2579,9656) then opens (:1-8), white cog
//     (2577,9655), ladder (2575,9655) up, tower L2: white spindle (2567,3241,2)
//   Only ONE cog may be carried (cogs.rs2:53-56).
//   Kojo                                                                       -> complete   brother_kojo.rs2:44-48; quest_cog.rs2:3-7 (500 coins)
import { SpeedBot, objId, cheb } from '../../../core.js';
import { ClientProt } from '#/io/ClientProt.js';
import { qp, inDialog, dismiss, nav, trace, navSync, turning, type Tile } from '../../q-lib.js';
import { densify } from '../../../core.js';
import { type Item, type Ctx, ctx, mark, fail, talkTo, opLocUntil, useOnLocUntil, pickup, textWatch, deathWatch, walkLive, walkShort, StepError } from './ar-lib.js';
import { isResuming, readJournal, failHook } from '../journal.js';

export const QUEST = { name: 'Clock Tower', dir: 'quest_cog', qp: 1 };
export const REQUIREMENTS = {
    quests: [] as string[], qp: 0,
    skills: {} as Record<string, [number, string]>,   // no skill checks in quest_cog
    start: { x: 2569, z: 3251, level: 0 },              // next to Brother Kojo, north of the Clock Tower
    end: { x: 2569, z: 3251, level: 0 },
};
/** bucket_water cools the black cog (cogs.rs2:30-37); ice gloves (worn) would do it on pickup but are a Hero's Quest drop. */
export const SUPPLY: Item[] = [{ name: 'bucket_water', n: 1 }];

const KOJO = 223, KOJO_AT = { x: 2569, z: 3249 };
const NE_LADDER = { id: 1754, x: 2621, z: 3261 }, SECRET_WALL = { id: 1586, x: 2575, z: 9631 }, BLUE_LADDER = { id: 1755, x: 2572, z: 9631 };
const BLUE_AT = { x: 2574, z: 9633 }, BLACK_AT = { x: 2613, z: 9639 }, RED_AT = { x: 2583, z: 9613 }, WHITE_AT = { x: 2577, z: 9655 }, POISON_AT = { x: 2564, z: 9662 };
const STAIRS0 = { id: 1738, x: 2572, z: 3240 }, STAIRS1 = { id: 1739, x: 2572, z: 3240, level: 1 }, STAIRS2 = { id: 1740, x: 2572, z: 3241, level: 2 };
const CELLAR_DOWN = { id: 1754, x: 2566, z: 3242 }, CELLAR_UP = { id: 1755, x: 2566, z: 9642 };
const POLE_BLUE = { id: 32, x: 2569, z: 3240, level: 1 }, POLE_BLACK = { id: 30, x: 2570, z: 9642 }, POLE_RED = { id: 29, x: 2568, z: 3243 }, POLE_WHITE = { id: 31, x: 2567, z: 3241, level: 2 };
const LEVER = { id: 33, x: 2591, z: 9661 }, LEVER_DOWN = 35, GATE_OPEN = 1541, TROUGH = { id: 40, x: 2586, z: 9654 }, GATE_C = { id: 39, x: 2579, z: 9656 }, WHITE_LADDER = { id: 1755, x: 2575, z: 9655 };
const INV = 3214;   // inventory:inv
const CLOSET_WALL = [{ level: 0, x: 2566, z: 3237, shape: 0, angle: 2, blockrange: false }];

const under = (b: SpeedBot) => b.tile().z > 9000;

export async function run(bot: SpeedBot, o: { log?: boolean } = {}): Promise<{ ok: boolean; ticks: number; msg: string; marks?: Record<string, number> }> {
    await nav();
    const c = ctx(bot, o.log ?? true);
    trace(bot, c.t0);
    const qp0 = qp(bot);
    bot.holdDialogs = true;
    const dw = deathWatch(c);
    try {
        await body(c, dw.dead);
        return { ok: true, ticks: bot.tickCount - c.t0, msg: `quest points ${qp0} -> ${qp(bot)}`, marks: c.marks };
    } catch (e) {
        return { ok: false, ticks: bot.tickCount - c.t0, msg: (e as Error).message, marks: c.marks };
    } finally { dw.stop(); bot.holdDialogs = false; }
}

/** OPOBJU (use a held item on a ground obj): route onto the obj's tile + the packet in one tick (OpObjUDecoder order). */
function useOnObjGo(bot: SpeedBot, item: string, obj: string, at: Tile): void {
    const me = bot.tile();
    if (me.x !== at.x || me.z !== at.z) {
        let pts: Tile[] = [];
        try { pts = navSync().findLongPath(bot.minusedlevel, me.x, me.z, at.x, at.z, 500); } catch { pts = []; }
        const dense = densify([me, ...pts]).slice(1);
        if (dense.length) bot.sendRoute(turning(me, dense), true);
    }
    const out = (bot as any).out;
    out.p1Enc(ClientProt.OPOBJU); out.p2(at.x); out.p2(at.z); out.p2(objId(obj)); out.p2(objId(item)); out.p2(bot.slot(item)); out.p2(INV);
    bot.queueFlush();
}

async function body(c: Ctx, dead: () => boolean): Promise<void> {
    const bot = c.bot;
    const need = (ok: boolean, label: string) => { if (dead()) fail(c, `${label} (DIED)`); if (!ok) fail(c, label); failHook(`clock:${label}`); };
    // session 10: on a retry, the journal (quest_cog/scripts/cog_journal.rs2) lists each placed cog (struck); a held cog is
    // placed first, then only the missing colours (CT_RESUME=0 = always from the top)
    let rs: { blue: boolean; black: boolean; red: boolean; white: boolean } | null = null;
    if (isResuming(bot) && process.env.CT_RESUME !== '0') {
        dismiss(bot);
        const j = await readJournal(bot, 'cog');
        if (j.ok && /QUEST COMPLETE/i.test(j.text)) { console.log('[clock] [journal] cog: QUEST COMPLETE'); return; }
        if (j.ok && /agreed to help him repair/i.test(j.text)) {
            const all = /placed all four cogs/i.test(j.text);
            // the placed line's own text ("I have successfully placed ..."): j.struck misses its '@str@@bla@' prefix (fork qwa09)
            const placed = (col: string) => all || new RegExp(`successfully placed the ${col} Cog`, 'i').test(j.text);
            rs = { blue: placed('Blue'), black: placed('Black'), red: placed('Red'), white: placed('White') };
        }
        console.log(`[clock] [journal] cog: ${j.ok ? `placed ${JSON.stringify(rs)} | open '${j.open.slice(0, 160)}'` : 'UNREADABLE'} (${j.ticks} t) @${JSON.stringify(bot.pos())} held ${['bluecog', 'blackcog', 'redcog', 'whitecog'].filter(n => bot.count(n) > 0)}`);
    }
    const R = !!rs;
    if (!R) for (const it of SUPPLY) if (bot.count(it.name) < it.n) fail(c, `missing ${it.name}`);
    const hasCog = () => ['bluecog', 'blackcog', 'redcog', 'whitecog'].some(n => bot.count(n) > 0);
    if (!R && hasCog()) fail(c, 'already carrying a cog');

    if (!R) {
    // 1. Kojo
    const tasked = textWatch(bot, /cellar is full of strange beasts|In the cellar below/i);
    need(await talkTo(c, KOJO, KOJO_AT, [/^OK old monk, what can I do\?$/], () => tasked(), { label: 'kojo-start' }), 'kojo-start');
    dismiss(bot);
    }
    if (!rs || !rs.blue) {
    if (!R || !bot.count('bluecog')) {
    if (R && under(bot)) need(await opLocUntil(c, CELLAR_UP, 1, () => !under(bot), { label: 'cellar-up (resume)' }), 'cellar-up (resume)');
    // 2. BLUE via the north-east ladder and the secret wall
    need(await opLocUntil(c, NE_LADDER, 1, () => under(bot), { label: 'ne-ladder' }), 'ne-ladder');
    need(await opLocUntil(c, SECRET_WALL, 1, () => bot.tile().x <= 2575 && bot.tile().z < 9640, { label: 'secret-wall', stand: { x: 2576, z: 9631 } }), 'secret-wall');
    need(await pickup(c, 'bluecog', BLUE_AT), 'blue-cog');
    need(await opLocUntil(c, BLUE_LADDER, 1, () => !under(bot), { label: 'blue-ladder' }), 'blue-ladder');
    }
    // into the tower by its NORTH door (2567,3245): the planners treat the boarded-up closet door (2566,3237, loc 131,
    // door-states "door") as passable and route through it from the south
    need(await walkShort(bot, { x: 2570, z: 3241 }, 6, CLOSET_WALL), 'tower-in'); mark(c, 'tower-in');
    need(await opLocUntil(c, STAIRS0, 1, () => bot.minusedlevel === 1, { label: 'tower-up-1' }), 'tower-up-1');
    need(await useOnLocUntil(c, 'bluecog', POLE_BLUE, () => bot.count('bluecog') === 0, { label: 'blue-placed' }), 'blue-placed');
    // 3. down to the cellar
    need(await opLocUntil(c, STAIRS1, 3, () => bot.minusedlevel === 0, { label: 'tower-down-0' }), 'tower-down-0');
    }
    if (!rs || !rs.black) {
    if (!R || !under(bot)) need(await opLocUntil(c, CELLAR_DOWN, 1, () => under(bot), { label: 'cellar-down' }), 'cellar-down');
    if (!R || !bot.count('blackcog')) {
    // 4. BLACK: cool it with the bucket, take it, cellar spindle (resume: the cooled bit may already be set, no bucket needed)
    for (let k = 0; k < 4 && bot.count('bucket_water') > 0; k++) {
        dismiss(bot);
        if (cheb(bot.tile(), BLACK_AT) > 2) await walkLive(bot, { x: BLACK_AT.x, z: BLACK_AT.z }, { near: 1, maxTicks: 120 });
        useOnObjGo(bot, 'bucket_water', 'blackcog', BLACK_AT);
        await bot.until(() => bot.count('bucket_water') === 0, 6);
    }
    if (!R || bot.count('bucket_water') === 0) need(bot.count('bucket_water') === 0, 'black-cooled');
    mark(c, 'black-cooled');
    dismiss(bot);
    need(await pickup(c, 'blackcog', BLACK_AT), 'black-cog');
    }
    need(await useOnLocUntil(c, 'blackcog', POLE_BLACK, () => bot.count('blackcog') === 0, { label: 'black-placed' }), 'black-placed');
    }
    if (!rs || !rs.red) {
    if (!R || !bot.count('redcog')) {
    if (R && !under(bot)) need(await opLocUntil(c, CELLAR_DOWN, 1, () => under(bot), { label: 'cellar-down (resume)' }), 'cellar-down (resume)');
    // 5. RED: take it, back up the cellar ladder, ground-floor spindle
    need(await pickup(c, 'redcog', RED_AT), 'red-cog');
    }
    if (!R || under(bot)) need(await opLocUntil(c, CELLAR_UP, 1, () => !under(bot), { label: 'cellar-up' }), 'cellar-up');
    need(await useOnLocUntil(c, 'redcog', POLE_RED, () => bot.count('redcog') === 0, { label: 'red-placed' }), 'red-placed');
    }
    if (!rs || !rs.white) {
    if (!R || !bot.count('whitecog')) {
    // 6. WHITE: poison, lever, trough, far gate, cog, ladder up, tower L2
    if (!R || !under(bot)) need(await opLocUntil(c, CELLAR_DOWN, 1, () => under(bot), { label: 'cellar-down-2' }), 'cellar-down-2');
    need(await pickup(c, 'rat_poison', POISON_AT), 'poison');
    // the cage gate is open while loc_1541 stands at (2596,9657) (gates_and_levers.rs2:38-42, 500 t). The lever state is
    // shared: someone else's pull can be about to time out (CT7 walked in and the gate shut). If the lever is down
    // (ctlevera2) but the gate shut, push it up first; then pull it and use the gate while it is fresh.
    const gateOpen = () => bot.liveLocs.get(`0,2596,9657`) === GATE_OPEN;
    for (let k = 0; k < 4 && !gateOpen(); k++) {
        if (bot.liveLocs.get(`0,${LEVER.x},${LEVER.z}`) === LEVER_DOWN) {
            await opLocUntil(c, { ...LEVER, id: LEVER_DOWN }, 1, () => bot.liveLocs.get(`0,${LEVER.x},${LEVER.z}`) !== LEVER_DOWN, { label: 'lever-reset', maxTicks: 4, tries: 2 });
        }
        await opLocUntil(c, LEVER, 1, gateOpen, { label: 'lever', maxTicks: 4, tries: 2 });
    }
    need(gateOpen(), 'cage-gate-open');
    const ratsDying = textWatch(bot, /devour it hungrily|They seem to be dying/i);
    need(await useOnLocUntil(c, 'rat_poison', TROUGH, () => bot.count('rat_poison') === 0, { label: 'trough' }), 'trough');
    need(await opLocUntil(c, GATE_C, 1, () => bot.tile().x <= 2578, { label: 'gate-c', stand: { x: 2579, z: 9656 }, answers: [/.*/] }), 'gate-c');
    void ratsDying;
    dismiss(bot);
    need(await pickup(c, 'whitecog', WHITE_AT), 'white-cog');
    need(await opLocUntil(c, WHITE_LADDER, 1, () => !under(bot), { label: 'white-ladder' }), 'white-ladder');
    }
    if (R && under(bot)) need(await opLocUntil(c, CELLAR_UP, 1, () => !under(bot), { label: 'cellar-up (resume)' }), 'cellar-up (resume)');
    if (R && bot.minusedlevel === 0 && !(bot.tile().x >= 2565 && bot.tile().x <= 2575 && bot.tile().z >= 3238 && bot.tile().z <= 3245)) need(await walkShort(bot, { x: 2570, z: 3241 }, 6, CLOSET_WALL), 'tower-in (resume)');
    if (!R || bot.minusedlevel === 0) need(await opLocUntil(c, STAIRS0, 1, () => bot.minusedlevel === 1, { label: 'tower-up-1b' }), 'tower-up-1b');
    if (!R || bot.minusedlevel === 1) need(await opLocUntil(c, STAIRS1, 2, () => bot.minusedlevel === 2, { label: 'tower-up-2' }), 'tower-up-2');
    need(await useOnLocUntil(c, 'whitecog', POLE_WHITE, () => bot.count('whitecog') === 0, { label: 'white-placed' }), 'white-placed');
    }
    // 7. down and Kojo (completion observable: the 500 coins, quest_cog.rs2:5)
    if (!R || bot.minusedlevel === 2) need(await opLocUntil(c, STAIRS2, 1, () => bot.minusedlevel === 1, { label: 'tower-down-1' }), 'tower-down-1');
    if (!R || bot.minusedlevel === 1) need(await opLocUntil(c, STAIRS1, 3, () => bot.minusedlevel === 0, { label: 'tower-down-0b' }), 'tower-down-0b');
    if (R && under(bot)) need(await opLocUntil(c, CELLAR_UP, 1, () => !under(bot), { label: 'cellar-up (resume)' }), 'cellar-up (resume)');
    const coins0 = bot.count('coins');
    need(await talkTo(c, KOJO, KOJO_AT, [/.*/], () => bot.count('coins') >= coins0 + 500, { label: 'kojo-complete' }), 'kojo-complete');
    dismiss(bot);
    void walkShort; void inDialog;
}
export { StepError };
