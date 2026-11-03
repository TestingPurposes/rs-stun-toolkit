// q-magearena.ts — Mage Arena (+ the Charge burst), tick-tight (speedrun route leg 18). LOCAL ONLY.
//
// Flow (wilderness_lever.rs2, mage_arena.rs2, kolodion.rs2, kolodion_fight.rs2, chamber.rs2, chamber_guardian.rs2):
//   Ardougne lever 1814 (2561,3311) -> (3154,3924) | knife on the keep web (3158,3951), 50%/try | hut webs (3095,3957),
//   (3093,3957) | ladder 2871 (3091,3957) -> cellar | Kolodion 905: "Can I fight here?" / "Yes indeedy." /
//   "Ok, let's fight." -> arena | Fire Blast every 5 ticks on the 5 forms (331 hp total), Protect from Magic on |
//   finish -> cellar | pool 2878 -> chamber | Guthix statue 2875 -> cape on the ground, pick it up | guardian 904:
//   4 pages -> guthix staff, %magearena = 8 | (q-charge: 163 x Charge) | teleport out (the chamber is no Wilderness).
//
// PRECONDITIONS: magic >= 60 base (80 for Charge; 80 also lifts the Fire Blast hit rate), prayer >= 37 (Protect from
//   Magic), hp high (Kolodion's god spells max 20; protect blocks them). Wielding staff_of_fire 1387 (staffs, capes,
//   amulets, rings and knives are allowed; NO other weapon or armour, mage_arena.rs2:99-136). Pack: knife 946,
//   deathrune 560 x120 + airrune 556 x480 + prayer potion(4) x1 (Fire Blast = 1 death + 5 fire + 4 air; the staff covers fire),
//   1 law + 1 water + 3 air... (teleport out: Falador/Camelot runes), 2 free slots (cape, staff).
//   Start: anywhere on the way to the Ardougne lever (CLI: the Ardougne knights spot, 2655,3307).
// EXIT STATE: Mage Arena chamber (~2508,4697), %magearena = 8, guthix staff + cape in the pack, magic 80 + fight xp.
// SUPPLY (helper -> trainee): staff_of_fire 1387, knife 946, deathrune x120, airrune x480, prayer potion(4) x1, (Charge: bloodrune x489,
//   airrune x489, firerune x0 with the fire staff), teleport-out runes.
//
// Run from server/webclient:  LC_HOST=localhost:8888 bun headless/speedrun/legs/q-magearena.ts [suffix] [nocharge]
import { SpeedBot, runLeg, localSetup, objId, objDebugName, cheb, spellCom } from '../core.js';
import {
    nav, talk, npc, npcsOf, inDialog, log, trace, walkOp, prePlan, locAt, dismiss, dropAllOf, KIT_JUNK, waitText,
    msgsSince, openLoc, opNpcGo, R, M2, M3,
} from './q-lib.js';
import { chargeLeg, chargeCasts } from './q-charge.js';

const KOLODION = 905, GUARDIAN = 904, FORMS = [907, 908, 909, 910, 911];
const KNIGHTS = { x: 2655, z: 3307 }, LEVER_STAND = { x: 2561, z: 3311 }, LEVER_LAND = { x: 3154, z: 3924 };
const WEB1_STAND = { x: 3158, z: 3950 }, HUT_STAND = { x: 3096, z: 3957 }, LADDER_STAND = { x: 3092, z: 3957 };
const CAPE = 2413, STAFF = 2416, KNIFE = 946;
// 120 casts: the fight took 67-70 casts in most runs and more than 80 in LV53 (misses): the 80 ran out with Kolodion's
// last form up, prayer hit 0 at the same time and the trainee died. Air 4 per cast. Plus 1 prayer potion (MAGEARENA_PRAYER)
export const MAGEARENA_SUPPLY = [{ name: 'staff_of_fire', n: 1 }, { name: 'knife', n: 1 }, { name: 'deathrune', n: 120 }, { name: 'airrune', n: 480 }];
export const MAGEARENA_PRAYER = { name: '4doseprayerrestore', n: 1 };   // 4 doses ~124 points: covers the longest fight seen (LV53 drained ~85 in 440 ticks); 1 keeps T0's slot count

export async function magearenaPrep(from = KNIGHTS): Promise<void> { await prePlan(0, from, LEVER_STAND); await prePlan(0, LEVER_LAND, WEB1_STAND); }

export async function magearenaLeg(bot: SpeedBot, o: { verbose?: boolean } = {}): Promise<Record<string, number | boolean>> {
    await nav();
    bot.holdDialogs = true;
    const t0 = bot.tickCount, m: Record<string, number | boolean> = {};
    const at = (k: string) => { m[k] = bot.tickCount - t0; if (o.verbose) log(bot, t0, `${k} pos=${JSON.stringify(bot.pos())} hp=${bot.stat('hitpoints').cur}`); };
    trace(bot, t0);
    const fail = (s: string) => { throw new Error(`${s} at ${JSON.stringify(bot.pos())} msgs: ${msgsSince(bot, t0).slice(-3).join(' | ')}`); };
    const lever = locAt(1814, 2561, 3311, 0), web1 = locAt(733, 3158, 3951, 0), web2 = locAt(733, 3095, 3957, 0), web3 = locAt(733, 3093, 3957, 0);
    const ladder = locAt(2871, 3091, 3957, 0), pool = locAt(2878, 2541, 4719, 0), statue = locAt(2875, 2507, 4724, 0);
    const opN = (type: number) => () => { const n = npc(bot, type); if (!n) return false; opNpcGo(bot, n, 1); return true; };
    const slashed = (w: { x: number; z: number; id: number }) => { const v = bot.liveLocs.get(`0,${w.x},${w.z}`); return v !== undefined && v !== w.id; };
    const cutWeb = async (w: typeof web1, stand: { x: number; z: number }) => {
        const use = () => { const s = bot.slot(KNIFE); if (s >= 0) bot.useItemOnLoc(w.x, w.z, w.id, KNIFE, s); };
        if (!(await walkOp(bot, stand, use, () => slashed(w), { maxTicks: 80 }))) {
            for (let k = 0; k < 12 && !slashed(w); k++) { use(); bot.queueFlush(); await bot.tick(1); }
        }
        if (!slashed(w)) fail(`web ${w.x},${w.z}`);
        openLoc(w);   // the planner still thinks the web blocks the tile
    };

    // 1. the Ardougne lever: arrive + mesbox + choice3 "Yes please, don't show this message again." -> wilderness
    let landed = false;
    const leverPlan = async () => {
        for (let k = 0; k < 20 && !landed; k++) {
            if (inDialog(bot)) {
                if (bot.dialogOptions().length) bot.clickDialogByText(/^Yes please, don't show this message again\.$/);
                else bot.resumeDialogPage();
                bot.queueFlush();
            }
            await bot.tick(1);
            landed = bot.tile().z > 3800;
        }
    };
    if (!(await walkOp(bot, LEVER_STAND, () => bot.opLoc(lever.x, lever.z, lever.id, 1), () => inDialog(bot) || bot.tile().z > 3800, { maxTicks: 120 }))) fail('lever');
    if (inDialog(bot)) {   // first pull: mesbox | choice3 -> one burst
        const { sendToks } = await import('./q-lib.js');
        sendToks(bot, [R, M3[2]!]);
    }
    await leverPlan();
    if (!landed) fail('no wilderness teleport');
    at('wilderness');
    pray(bot, 'protectfrommelee', true);
    // 2. keep web, hut webs, ladder
    await cutWeb(web1, WEB1_STAND);
    at('web1');
    await cutWeb(web2, HUT_STAND);
    await cutWeb(web3, { x: 3094, z: 3957 });
    at('webs');
    if (!(await walkOp(bot, LADDER_STAND, () => bot.opLoc(ladder.x, ladder.z, ladder.id, 1), () => bot.tile().z > 4600, { maxTicks: 20 }))) fail('cellar ladder');
    at('cellar');
    pray(bot, 'protectfrommelee', false);
    // 3. Kolodion: chatplayer | chatnpc | multi3 "Can I fight here?" | chatplayer | chatnpc | chatnpc | multi2 "Yes
    //    indeedy." | chatplayer | chatnpc | chatnpc | chatnpc | multi2 "Ok, let's fight." | chatplayer | chatnpc |
    //    chatplayer | chatnpc -> =1, teleport into the arena
    dismiss(bot);
    const ans = [/^Can I fight here\?$/, /^Yes indeedy\.$/, /^Ok, let's fight\.$/];
    const k1 = await talk(bot, KOLODION, [R, R, M3[0]!, R, R, R, M2[0]!, R, R, R, R, M2[0]!, R, R, R, R], {
        done: () => npcsOf(bot, FORMS).length > 0 || cheb(bot.tile(), { x: 3105, z: 3934 }) <= 8, answers: ans, maxTicks: 40, label: 'kolodion',
    });
    // R27: the blind 16-token burst missed (A4/A7 passed): re-talk adaptively (answers only), verified by the fight starting
    for (let k = 0; !k1.ok && k < 3; k++) {
        dismiss(bot); await bot.tick(1);
        const r = await talk(bot, KOLODION, [], { done: () => npcsOf(bot, FORMS).length > 0 || cheb(bot.tile(), { x: 3105, z: 3934 }) <= 8, answers: ans, maxTicks: 60, label: `kolodion-retry${k + 1}` });
        k1.ok = r.ok;
    }
    if (!k1.ok) fail('kolodion dialog');
    at('arena');
    pray(bot, 'protectfrommagic', true);
    // 4. the fight: Fire Blast on whatever form is up; re-cast as soon as each cast lands (magic xp)
    const blast = spellCom('fire_blast');
    let sendXp = -1, lastSend = -100, casts = 0, xpSeen = bot.stat('magic').xp, lastPot = -100;
    const fightEnd = bot.tickCount + 900;
    while (bot.tickCount < fightEnd && !(bot.tile().z > 4600)) {
        const xp = bot.stat('magic').xp;
        if (xp > xpSeen) { casts++; xpSeen = xp; }
        const f = npcsOf(bot, FORMS)[0];
        // re-target the tick after each cast lands (a new form, or the same one), or every 6 ticks as a fallback
        if (f && (xp !== sendXp || bot.tickCount - lastSend >= 6)) {
            bot.opNpcT(f.idx, blast); bot.queueFlush(); lastSend = bot.tickCount; sendXp = xp;
        }
        if (o.verbose && bot.tickCount % 10 === 0) log(bot, t0, `fight hp=${bot.stat('hitpoints').cur} pray=${bot.stat('prayer').cur} active=${bot.activePrayers().join(',')} form=${f?.type}@${f?.x},${f?.z} d=${f?.d} casts=${casts} mag=${bot.stat('magic').cur}`);
        if (bot.stat('prayer').cur >= 37 && !bot.isPrayerActive('protectfrommagic')) { bot.activatePrayer('protectfrommagic'); bot.queueFlush(); }
        if (bot.stat('hitpoints').cur < 40 && bot.count('shark') > 0) { bot.opHeld1(objId('shark'), bot.slot('shark')); bot.queueFlush(); }
        // keep Protect from Magic up: a prayer potion below 15 points (LV53: prayer 0 at cast 79, then the god spells hit)
        if (bot.stat('prayer').cur < 15 && bot.tickCount - lastPot >= 3) {
            const pp = bot.inv().filter(x => /^[1234]doseprayerrestore$/.test(objDebugName(x.obj))).sort((a, b) => objDebugName(a.obj).localeCompare(objDebugName(b.obj)))[0];
            if (pp) { bot.opHeld1(pp.obj, pp.slot); bot.queueFlush(); lastPot = bot.tickCount; }
        }
        // out of death runes = no way to finish the fight: stop here (a resumable abort) instead of standing in the arena
        // with nothing to cast until Kolodion kills the trainee (LV53)
        if (bot.count('deathrune') === 0) fail(`out of death runes after ${casts} casts (form ${f?.type})`);
        await bot.tick(1);
    }
    m.casts = casts;
    if (!(bot.tile().z > 4600)) fail('fight did not finish');
    at('fight');
    pray(bot, 'protectfrommagic', false);
    // 5. pool -> chamber (mesbox, then the jump), Guthix statue (cape on the ground), pick it up, guardian
    dismiss(bot);
    for (let k = 0; k < 30 && bot.tile().z > 4700 && bot.tile().x > 2520; k++) {
        if (inDialog(bot)) { bot.resumeDialogPage(); bot.queueFlush(); await bot.tick(1); continue; }
        if (k % 6 === 0) { const { opLocGo } = await import('./q-lib.js'); opLocGo(bot, pool, 1); }
        await bot.tick(1);
    }
    if (!(bot.tile().x < 2520)) fail('pool');
    at('chamber');
    dismiss(bot);
    const capeAt = { x: 2507, z: 4723 };
    for (let k = 0; k < 30 && !bot.groundItems.has(`${capeAt.x},${capeAt.z},${CAPE}`) && bot.count(CAPE) === 0; k++) {
        if (inDialog(bot)) { bot.resumeDialogPage(); bot.queueFlush(); }
        else if (k === 0 || k % 8 === 0) { const { opLocGo } = await import('./q-lib.js'); opLocGo(bot, statue, 1); }
        await bot.tick(1);
        if ([...bot.groundItems.values()].some(g => g.obj === CAPE)) break;
    }
    for (let k = 0; k < 12 && bot.count(CAPE) === 0; k++) {
        if (k % 4 === 0) { const { pickupGo } = await import('./q-lib.js'); dismiss(bot); pickupGo(bot, CAPE, capeAt); }
        await bot.tick(1);
    }
    if (bot.count(CAPE) === 0) fail('no cape');
    at('cape');
    dismiss(bot);
    // the guardian drops the staff on the floor when the pack is full: make room (a shark) first
    if (bot.free() === 0) { const sh = objId('shark'); if (bot.count(sh)) { bot.dropItem(sh, bot.slot(sh)); bot.queueFlush(); await bot.tick(1); } }
    if (!(await walkOp(bot, { x: 2508, z: 4697 }, opN(GUARDIAN), () => inDialog(bot), { near: 1, maxTicks: 40 }))) fail('no guardian dialog');
    const g = await talk(bot, GUARDIAN, [R, R, R, R], { noOp: true, done: () => bot.count(STAFF) > 0, maxTicks: 20, label: 'guardian' });
    // fallback: a desynced burst leaves the chain half-read; re-talk and drive pages until the staff lands
    for (let k = 0; k < 4 && !g.ok && bot.count(STAFF) === 0; k++) {
        if (!inDialog(bot)) await walkOp(bot, { x: 2508, z: 4697 }, opN(GUARDIAN), () => inDialog(bot) || bot.count(STAFF) > 0, { near: 1, maxTicks: 30 });
        const { drive } = await import('./q-lib.js');
        await drive(bot, () => bot.count(STAFF) > 0, [], 25, 1);
    }
    for (let k = 0; k < 12 && bot.count(STAFF) === 0 && [...bot.groundItems.values()].some((q: any) => q.obj === STAFF); k++) {
        if (k % 4 === 0) { const { pickupGo } = await import('./q-lib.js'); dismiss(bot); const gi: any = [...bot.groundItems.values()].find((q: any) => q.obj === STAFF); pickupGo(bot, STAFF, { x: gi.x, z: gi.z }); }
        await bot.tick(1);
    }
    if (bot.count(STAFF) === 0) fail('no staff');
    m.ok = true;
    at('staff');
    return m;
}

function pray(bot: SpeedBot, name: string, on: boolean): void {
    if (bot.stat('prayer').cur < 43) return;
    if (on && !bot.isPrayerActive(name)) bot.activatePrayer(name);
    if (!on && bot.isPrayerActive(name)) (bot as any).setPrayer(name, false);
    bot.queueFlush();
}

if (import.meta.main) {
    if (!/^(localhost|127\.)/.test(process.env.LC_HOST ?? '')) { console.error('set LC_HOST=localhost:8888'); process.exit(1); }
    const sfx = process.argv[2] ?? String(Date.now() % 100000);
    const bot = await SpeedBot.create(`qmag${sfx}`);
    dropAllOf(bot, [...KIT_JUNK, 'airrune', 'waterrune']); await bot.tick(5);
    // route state at leg 18: magic 80, prayer 99, hp 99, 99 melee
    await localSetup(bot, { stats: { magic: 80, prayer: 99, hitpoints: 99, attack: 99, strength: 99, defence: 99 }, items: MAGEARENA_SUPPLY, tele: KNIGHTS });
    bot.opHeld2(1387, bot.slot(1387)); bot.queueFlush(); await bot.tick(2);
    await magearenaPrep();
    await bot.tick(2);
    const { rec } = await runLeg(bot, 'q-magearena', b => magearenaLeg(b, { verbose: true }));
    console.log(`[q-magearena] ${rec.ticks} ticks ${JSON.stringify(rec.result)}`);
    if (rec.ok && process.argv[3] !== 'nocharge') {
        const n = chargeCasts(bot.stat('magic').xp);
        await localSetup(bot, { items: [{ name: 'bloodrune', n: 3 * n }, { name: 'airrune', n: 3 * n }] });   // demo: carried in
        const c = await runLeg(bot, 'q-charge-after-arena', b => chargeLeg(b, { verbose: true }));
        console.log(`[q-magearena] charge ${c.rec.ticks} ticks ${JSON.stringify(c.rec.result)}`);
    }
    await bot.logout();
    process.exit(rec.ok ? 0 : 1);
}
