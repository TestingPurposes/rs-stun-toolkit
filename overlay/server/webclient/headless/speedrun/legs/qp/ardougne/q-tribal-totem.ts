// q-tribal-totem.ts — Tribal Totem (quest_totem), cheat-free. Max-QP build, ardougne lane.
//
// Content (rev 289, server/content/scripts/): quests/quest_totem/scripts/quest_totem.rs2, areas/area_brimhaven/scripts/
// kangai_mau.rs2, areas/area_ardougne_east/scripts/{rdpt_employee,wizard_cromperty}.rs2. Stage varp %totemquest
// (quest_totem.constant:1-5; complete = 5, general/configs/quest.constant:56), NOT transmitted.
// Flow (file:line):
//   Kangai Mau (2791,3182, Brimhaven) "I'm in search of adventure!" / "Ok, I will get it back."   -> started   kangai_mau.rs2:16-54
//   to Ardougne: Ardougne Teleport (magic 51, Plague City) or the Brimhaven customs ship (customs_officer.rs2:81-82)
//   RPDT depot: Investigate the crate (2650,3273) -> address label (quest_totem.rs2:8-17); label on the crate
//     (2650,3271)                                                                               -> crate_marked :19-30
//   RPDT employee "So, when are you going to deliver this crate?"                              -> crate_delivered rdpt_employee.rs2:1-13
//   Wizard Cromperty (2683,3326) "So what have you invented?" / "Can I be teleported please?" / "Yes, that sounds good.
//     Teleport me!" -> p_delay(4), telejump into the mansion (2638,3321)                        -> teleported  wizard_cromperty.rs2:23-81
//   door (2636,3323) -> combination door (2634,3323): K U R T on interface tribal_door2 (quest_totem.rs2:36-96; dials
//     start at A after the reset in clear_tribaldoor_inter): dial 1 right x10, dials 2/3/4 left x6/x9/x7, ENTER
//   stairs (2631,3322): Investigate (thieving 21, stat(): quest_totem.rs2:120-132) THEN Climb-up -> L1 (2631,3321)
//     (without the note the stairs drop you in the sewer for 20% hp + 1, :98-118)
//   L1: doors (2632,3319) and (2638,3319); chest (2638,3324): Open, Search -> tribal totem (no stage check, :134-146)
//   out: stairs down, combination door, one-way door (2635,3321, opens only from the north, :1-6)
//   back to Brimhaven: Captain Barnaby (2679,3275) 30 gp; Kangai with the totem                  -> complete  kangai_mau.rs2:66-74
//   Completion: quest_totem.rs2:159-164 (thieving 17,750 tenths, 5 swordfish).
import { SpeedBot, objId, cheb, componentId } from '../../../core.js';
import { qp, inDialog, dismiss, locAt, nav, trace, tele, type Tile } from '../../q-lib.js';
import { type Item, type Ctx, ctx, mark, fail, talkTo, finishDialog, opLocUntil, useOnLocUntil, textWatch, deathWatch, walkShort, StepError } from './ar-lib.js';
import { isResuming, journalStage, failHook } from '../journal.js';

export const QUEST = { name: 'Tribal Totem', dir: 'quest_totem', qp: 1 };
export const REQUIREMENTS = {
    quests: [] as string[], qp: 0,
    skills: {
        thieving: [21, 'spot the stair trap: stat(thieving) >= 21 (quest_totem.rs2:125); boostable'],
    } as Record<string, [number, string]>,
    /** not a gate: magic 51 + Plague City (scroll read) = Ardougne Teleport from Brimhaven (fast); otherwise the leg takes the
     *  Brimhaven customs ship (+30 gp, measured slower: see STATUS.md A/B) */
    recommended: { magic: 51 },
    start: { x: 2790, z: 3184, level: 0 },   // next to Kangai Mau, Brimhaven
    end: { x: 2790, z: 3184, level: 0 },
};
export const SUPPLY: Item[] = [{ name: 'lawrune', n: 2 }, { name: 'waterrune', n: 2 }, { name: 'coins', n: 30 }];

const KANGAI = 846, RPDT = 843, CROMPERTY = 844, BARNABY = 381, CUSTOMS = 380;
const KANGAI_AT = { x: 2791, z: 3182 }, RPDT_AT = { x: 2644, z: 3274 }, CROMPERTY_AT = { x: 2683, z: 3326 };
const BARNABY_AT = { x: 2679, z: 3275 }, BRIM_CUSTOMS_AT = { x: 2772, z: 3229 };
const HORNCRATE = { id: 2707, x: 2650, z: 3273 }, TELECRATE = { id: 2708, x: 2650, z: 3271 };
const HALL_DOOR = { id: 1533, x: 2636, z: 3323 }, COMBO = { id: 2705, x: 2634, z: 3323 }, ONEWAY = { id: 2706, x: 2635, z: 3321 };
const STAIRS = { id: 2711, x: 2631, z: 3322 }, STAIRS_TOP = { id: 1723, x: 2631, z: 3322, level: 1 };
const CHEST_SHUT = { id: 2709, x: 2638, z: 3324, level: 1 }, CHEST_OPEN = 2710;
const PLANK_BRIM = { id: 2088, x: 2774, z: 3234, level: 1 }, PLANK_ARDY = { id: 2086, x: 2683, z: 3269, level: 1 };

const inMansion = (b: SpeedBot) => { const t = b.tile(); return t.x >= 2627 && t.x <= 2643 && t.z >= 3318 && t.z <= 3326; };
const inHall = (b: SpeedBot) => { const t = b.tile(); return b.minusedlevel === 0 && t.x >= 2634 && t.x <= 2636 && t.z >= 3322 && t.z <= 3325; };
const inWestRoom = (b: SpeedBot) => { const t = b.tile(); return b.minusedlevel === 0 && t.x >= 2627 && t.x <= 2633 && t.z >= 3320 && t.z <= 3325; };

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

/** totem_journal.rs2 open lines -> stage, latest first (session 10) */
const TOTEM_STAGES: Array<[RegExp, string]> = [
    [/QUEST COMPLETE/i, 'done'], [/take the tribal totem back|find the Tribal Totem and return|combination for the security door/i, 'teleported'],
    [/get Wizard Cromperty to teleport me/i, 'delivered'], [/get the R\.P\.D\.T\. men to deliver the crate now/i, 'marked'],
    [/get into Lord Handelmorts Mansion/i, 'started'], [/I can start this quest/i, 'none'],
];
const inArdy = (b: SpeedBot) => { const t = b.tile(); return t.x >= 2560 && t.x <= 2730 && t.z >= 3240 && t.z <= 3340; };

async function body(c: Ctx, dead: () => boolean): Promise<void> {
    const bot = c.bot;
    const need = (ok: boolean, label: string) => { if (dead()) fail(c, `${label} (DIED)`); if (!ok) fail(c, label); failHook(label); };
    if (bot.count('coins') < 30) fail(c, `need 30 coins for the boat back, have ${bot.count('coins')}`);
    const canTele = bot.stat('magic').level >= 51 && bot.count('lawrune') >= 2 && bot.count('waterrune') >= 2;
    // session 10: on a retry / resume, the section the quest JOURNAL + the totem + position show (1 Kangai .. 7 the boat back,
    // 8 = Kangai's hand-in only). 1 on a fresh attempt. TOTEM_RESUME=0 reverts.
    let from = 1;
    if (isResuming(bot) && process.env.TOTEM_RESUME !== '0') {
        if (bot.chatModalId !== -1 || bot.mainModalId !== -1) { dismiss(bot); await bot.tick(1); }
        const st = await journalStage<string>(bot, 'totem', TOTEM_STAGES, 'none', s => mark(c, s));
        if (st === 'done') return;
        const brim = bot.tile().x >= 2700 && bot.tile().z < 3300 && bot.minusedlevel === 0;
        from = bot.count('tribal_totem') > 0 ? (inMansion(bot) ? 6 : brim ? 8 : 7)
            : st === 'teleported' ? (inMansion(bot) ? 5 : 4) : st === 'delivered' ? 4 : st === 'marked' ? 3.5 : st === 'started' ? 2 : 1;
        mark(c, `resume from section ${from} (journal '${st}', totem ${bot.count('tribal_totem')})`);
    }
    const F = (n: number) => from <= n;

    // 1. Kangai Mau: start
    if (F(1)) {
    const started = textWatch(bot, /Best of luck with that adventurer/i);
    need(await talkTo(c, KANGAI, KANGAI_AT, [/^I'm in search of adventure!$/, /^Ok, I will get it back\.$/], () => started(), { label: 'kangai-start' }), 'kangai-start');
    dismiss(bot);
    }
    // 2. to Ardougne
    if (!(F(2) || (F(4) && !inArdy(bot)))) { /* there already, or past it */ }
    else if (canTele) {
        need((await tele(bot, 'ardougne_teleport')).ok, 'ardougne-tele'); mark(c, 'ardougne-tele');
    } else {
        if (bot.count('coins') < 60) fail(c, 'no Ardougne Teleport: need 60 coins for two boats');
        need(await talkTo(c, CUSTOMS, BRIM_CUSTOMS_AT, [/^Can I journey on this ship\?$/, /^Search away, I have nothing to hide\.$/, /^Ok\.$/],
            () => bot.minusedlevel === 1 && bot.tile().x < 2700, { label: 'ship-ardougne', maxTicks: 300 }), 'ship-ardougne');
        dismiss(bot);
        need(await opLocUntil(c, PLANK_ARDY, 1, () => bot.minusedlevel === 0, { label: 'plank-ardougne' }), 'plank-ardougne');
    }
    // 3. RPDT depot: label, crate, employee
    if (F(3)) {
    for (let k = 0; k < 4 && !bot.count('tribal_totem_label'); k++) {
        await opLocUntil(c, HORNCRATE, 2, () => bot.count('tribal_totem_label') > 0, { label: 'label', tries: 2 });
    }
    need(bot.count('tribal_totem_label') > 0, 'label');
    dismiss(bot);
    const marked = textWatch(bot, /Now I just need someone to deliver it/i);
    need(await useOnLocUntil(c, 'tribal_totem_label', TELECRATE, () => bot.count('tribal_totem_label') === 0, { label: 'crate-marked' }), 'crate-marked');
    await finishDialog(bot, [/.*/], 6, () => marked() && !inDialog(bot));
    }
    if (F(3.5)) {
    const delivered = textWatch(bot, /I guess we could do it now/i);
    need(await talkTo(c, RPDT, RPDT_AT, [/^So, when are you going to deliver this crate\?$/], () => delivered(), { label: 'rpdt' }), 'rpdt');
    dismiss(bot);
    }
    // 4. Cromperty's teleport into the mansion
    if (F(4)) {
    need(await talkTo(c, CROMPERTY, CROMPERTY_AT, [/^So what have you invented\?$/, /^Can I be teleported please\?$/, /^Yes, that sounds good\. Teleport me!$/],
        () => inMansion(bot), { label: 'cromperty-tele', maxTicks: 200 }), 'cromperty-tele');
    dismiss(bot);
    }
    if (F(5)) {
    // 5. hall door, combination lock (KURT), stairs (investigate, climb), chest
    // the hall door (2636,3323) is an ordinary door: walk through it (opened when closed, a swung leaf closed when in the way)
    need(await walkShort(bot, { x: 2635, z: 3323 }), 'hall-door'); mark(c, 'hall');
    for (let k = 0; k < 3 && !inWestRoom(bot); k++) {
        const ok = await opLocUntil(c, COMBO, 1, () => bot.mainModalId !== -1 || inWestRoom(bot), { label: 'combo-open', stand: { x: 2634, z: 3323 }, tries: 2 });
        if (!ok) continue;
        if (inWestRoom(bot)) break;
        // dials reset to A (0) on open (clear_tribaldoor_inter); K=10 U=20 R=17 T=19 (quest_totem.rs2:39)
        const right = (d: number) => componentId(`tribal_door2:com_${46 + 2 * d}`), left = (d: number) => componentId(`tribal_door2:com_${45 + 2 * d}`);
        const clicks: number[] = [...Array(10).fill(right(1)), ...Array(6).fill(left(2)), ...Array(9).fill(left(3)), ...Array(7).fill(left(4)), componentId('tribal_door2:com_57')];
        const okText = textWatch(bot, /The combination seems correct/i);
        bot.burst(clicks.map(id => () => bot.ifButton(id)));   // 33 IF_BUTTONs: the engine runs 5 per tick in order
        await bot.until(() => okText() || bot.mainModalId === -1, 12);
        if (!okText()) { dismiss(bot); continue; }
        mark(c, 'combo-solved');
        await opLocUntil(c, COMBO, 1, () => inWestRoom(bot), { label: 'combo-door', stand: { x: 2634, z: 3323 } });
    }
    need(inWestRoom(bot), 'combo-door');
    const noted = textWatch(bot, /there is a trap in these stairs|make a note of its location/i);
    need(await opLocUntil(c, STAIRS, 2, () => noted(), { label: 'stairs-investigate', maxTicks: 8 }), 'stairs-investigate');
    dismiss(bot);
    need(await opLocUntil(c, STAIRS, 1, () => bot.minusedlevel === 1, { label: 'stairs-up', maxTicks: 8 }), 'stairs-up');
    for (let k = 0; k < 5 && !bot.count('tribal_totem'); k++) {
        const open = bot.liveLocs.get(`1,${CHEST_SHUT.x},${CHEST_SHUT.z}`) === CHEST_OPEN;
        if (!open) await opLocUntil(c, CHEST_SHUT, 1, () => bot.liveLocs.get(`1,${CHEST_SHUT.x},${CHEST_SHUT.z}`) === CHEST_OPEN || bot.count('tribal_totem') > 0, { label: 'chest-open', tries: 2 });
        else await opLocUntil(c, { ...CHEST_SHUT, id: CHEST_OPEN }, 1, () => bot.count('tribal_totem') > 0, { label: 'chest-search', tries: 2 });
    }
    need(bot.count('tribal_totem') > 0, 'totem');
    dismiss(bot);
    }
    // 6. out: stairs down, combination door (solved: walks through), one-way door (from the north)
    if (F(6)) {
    need(await opLocUntil(c, STAIRS_TOP, 1, () => bot.minusedlevel === 0, { label: 'stairs-down' }), 'stairs-down');
    need(await opLocUntil(c, COMBO, 1, () => inHall(bot), { label: 'combo-out', stand: { x: 2633, z: 3323 } }), 'combo-out');
    need(await opLocUntil(c, ONEWAY, 1, () => bot.tile().z <= 3321 && !inHall(bot), { label: 'oneway-out', stand: { x: 2635, z: 3322 } }), 'oneway-out');
    }
    // 7. Captain Barnaby -> Brimhaven -> Kangai
    if (F(7)) {
    need(await talkTo(c, BARNABY, BARNABY_AT, [/^Yes please\.$/], () => bot.minusedlevel === 1 && bot.tile().x > 2700, { label: 'ship-brimhaven', maxTicks: 300 }), 'ship-brimhaven');
    dismiss(bot);
    need(await opLocUntil(c, PLANK_BRIM, 1, () => bot.minusedlevel === 0, { label: 'plank-brimhaven' }), 'plank-brimhaven');
    }
    // completion observable: the reward thieving xp (quest_totem.rs2:161)
    const thv0 = bot.stat('thieving').xp;
    need(await talkTo(c, KANGAI, KANGAI_AT, [/.*/], () => bot.stat('thieving').xp > thv0, { label: 'kangai-complete' }), 'kangai-complete');
    dismiss(bot);
    void objId; void cheb; void locAt; void HALL_DOOR;
}
export { StepError };
